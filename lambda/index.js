const { spawn } = require('child_process');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, BatchGetCommand } = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { Chess } = require('chess.js');
const { v4: uuidv4 } = require('uuid');

const lambdaClient = new LambdaClient({});

const ANALYSIS_DEPTH = 18;
const MOVES_TO_ANALYZE = 14;
const MISTAKE_THRESHOLD = 100;
const STOCKFISH_PATH = '/usr/local/bin/stockfish';
const BATCH_SIZE = 20; // Games per parallel Lambda invocation
const MAX_PARALLEL_LAMBDAS = 50; // Maximum concurrent Lambda invocations

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const JOBS_TABLE = process.env.JOBS_TABLE_NAME;
const CACHE_TABLE = process.env.CACHE_TABLE_NAME;
const USERDATA_TABLE = process.env.USERDATA_TABLE_NAME;

// Stockfish process management
class StockfishEngine {
  constructor() {
    this.process = null;
    this.ready = false;
    this.messageQueue = [];
    this.currentResolver = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.process = spawn(STOCKFISH_PATH);

      this.process.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            this.handleMessage(line.trim());
          }
        }
      });

      this.process.stderr.on('data', (data) => {
        console.error('Stockfish stderr:', data.toString());
      });

      this.process.on('error', (err) => {
        reject(new Error(`Failed to start Stockfish: ${err.message}`));
      });

      this.process.on('close', (code) => {
        console.log(`Stockfish process exited with code ${code}`);
      });

      // Initialize UCI
      this.send('uci');

      const checkReady = (line) => {
        if (line === 'uciok') {
          this.send('setoption name Hash value 128');
          this.send('setoption name Threads value 2');
          this.send('isready');
        }
        if (line === 'readyok') {
          this.ready = true;
          resolve();
        }
      };

      this.onMessage = checkReady;
    });
  }

  handleMessage(line) {
    if (this.onMessage) {
      this.onMessage(line);
    }
  }

  send(command) {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write(command + '\n');
    }
  }

  async getEvaluation(fen) {
    return new Promise((resolve) => {
      let evalScore = null;
      let bestMove = null;
      let currentDepth = 0;

      this.onMessage = (line) => {
        if (line.startsWith('info') && line.includes('score')) {
          const depthMatch = line.match(/depth (\d+)/);
          const depth = depthMatch ? parseInt(depthMatch[1]) : 0;

          if (depth >= ANALYSIS_DEPTH) {
            currentDepth = depth;

            const mateMatch = line.match(/score mate (-?\d+)/);
            if (mateMatch) {
              const mateIn = parseInt(mateMatch[1]);
              evalScore = mateIn > 0 ? 10000 - mateIn * 100 : -10000 - mateIn * 100;
            } else {
              const cpMatch = line.match(/score cp (-?\d+)/);
              if (cpMatch) {
                evalScore = parseInt(cpMatch[1]);
              }
            }

            const pvMatch = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbnQRBN]?)/);
            if (pvMatch) {
              bestMove = pvMatch[1];
            }
          }
        }

        if (line.startsWith('bestmove')) {
          // CRITICAL: Normalize eval to White's perspective
          // Stockfish returns eval from side-to-move's perspective
          // FEN format: "position w/b ..." - second field is side to move
          const sideToMove = fen.split(' ')[1];
          const normalizedEval = (sideToMove === 'b' && evalScore !== null)
            ? -evalScore
            : evalScore;

          resolve({ eval: normalizedEval, bestMove: bestMove, depth: currentDepth });
        }
      };

      this.send(`position fen ${fen}`);
      this.send(`go depth ${ANALYSIS_DEPTH}`);
    });
  }

  quit() {
    if (this.process) {
      this.send('quit');
      this.process.kill();
      this.process = null;
    }
  }
}

function extractResultFromPgn(pgn) {
  for (const line of pgn.split('\n')) {
    if (line.startsWith('[Result "')) {
      try {
        return line.split('"')[1];
      } catch (e) {
        return '';
      }
    }
  }
  return '';
}

function getPlayerResult(pgnResult, playerColor) {
  if (pgnResult === '1-0') {
    return playerColor === 'white' ? 'Win' : 'Loss';
  } else if (pgnResult === '0-1') {
    return playerColor === 'white' ? 'Loss' : 'Win';
  } else if (pgnResult === '1/2-1/2') {
    return 'Draw';
  }
  return '';
}

function uciToSan(uciMove, chess) {
  const from = uciMove.substring(0, 2);
  const to = uciMove.substring(2, 4);
  const promotion = uciMove.length > 4 ? uciMove[4] : undefined;

  const move = chess.move({ from, to, promotion });
  if (move) {
    chess.undo();
    return move.san;
  }
  return uciMove;
}

async function analyzeGame(engine, gameData) {
  const pgn = gameData.pgn || '';
  const playerColor = gameData.player_color || 'white';
  const isWhite = playerColor === 'white';

  const chess = new Chess();
  const loaded = chess.load_pgn(pgn);

  if (!loaded) {
    return null;
  }

  const history = chess.history();
  chess.reset();

  if (history.length < MOVES_TO_ANALYZE) {
    return null;
  }

  const playerMoveIndices = isWhite
    ? [...Array(Math.floor(MOVES_TO_ANALYZE / 2)).keys()].map(i => i * 2)
    : [...Array(Math.floor(MOVES_TO_ANALYZE / 2)).keys()].map(i => i * 2 + 1);

  const mistakes = [];
  const moveSequence = [];

  let prevEval = (await engine.getEvaluation(chess.fen())).eval;

  for (let i = 0; i < Math.min(MOVES_TO_ANALYZE, history.length); i++) {
    const move = history[i];
    moveSequence.push(move);

    let bestMoveBefore = null;
    if (playerMoveIndices.includes(i)) {
      const result = await engine.getEvaluation(chess.fen());
      if (result.bestMove) {
        bestMoveBefore = uciToSan(result.bestMove, chess);
      }
    }

    chess.move(move);

    const currentResult = await engine.getEvaluation(chess.fen());
    const currentEval = currentResult.eval;

    if (playerMoveIndices.includes(i) && prevEval !== null && currentEval !== null) {
      const evalChange = isWhite
        ? currentEval - prevEval
        : prevEval - currentEval;

      if (evalChange <= -MISTAKE_THRESHOLD) {
        const pgnResult = extractResultFromPgn(pgn);
        const result = getPlayerResult(pgnResult, playerColor);

        mistakes.push({
          move_number: Math.floor(i / 2) + 1,
          move: move,
          best_move: bestMoveBefore,
          move_sequence: [...moveSequence],
          eval_before: prevEval,
          eval_after: currentEval,
          eval_drop: evalChange,
          opening: gameData.opening || '',
          eco: gameData.eco || '',
          player_color: playerColor,
          game_url: gameData.url || '',
          time_class: gameData.time_class || '',
          time_control: gameData.time_control || '',
          end_time: gameData.end_time || 0,
          fen: chess.fen(),
          result: result,
          white: gameData.white || {},
          black: gameData.black || {}
        });
      }
    }

    prevEval = currentEval;
  }

  return mistakes;
}

async function updateJobProgress(jobId, current, total, mistakes, status = 'processing') {
  const ttl = Math.floor(Date.now() / 1000) + 3600; // 1 hour TTL

  await docClient.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId },
    UpdateExpression: 'SET #status = :status, currentGame = :current, totalGames = :total, mistakesFound = :mistakes, updatedAt = :updatedAt, #ttl = :ttl',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#ttl': 'ttl'
    },
    ExpressionAttributeValues: {
      ':status': status,
      ':current': current,
      ':total': total,
      ':mistakes': mistakes,
      ':updatedAt': new Date().toISOString(),
      ':ttl': ttl
    }
  }));
}

async function createJob(jobId, totalGames, totalBatches = 1) {
  const ttl = Math.floor(Date.now() / 1000) + 7200; // 2 hours for long jobs

  await docClient.send(new PutCommand({
    TableName: JOBS_TABLE,
    Item: {
      jobId,
      status: 'processing',
      currentGame: 0,
      totalGames,
      totalBatches,
      completedBatches: 0,
      mistakesFound: 0,
      mistakes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ttl
    }
  }));
}

// Create a batch record for parallel processing
async function createBatch(jobId, batchIndex, gamesCount) {
  const ttl = Math.floor(Date.now() / 1000) + 7200;
  const batchId = `${jobId}#batch-${batchIndex}`;

  await docClient.send(new PutCommand({
    TableName: JOBS_TABLE,
    Item: {
      jobId: batchId,
      parentJobId: jobId,
      batchIndex,
      status: 'processing',
      gamesProcessed: 0,
      totalGames: gamesCount,
      mistakesFound: 0,
      mistakes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ttl
    }
  }));
}

// Update batch progress
async function updateBatchProgress(jobId, batchIndex, gamesProcessed, mistakes) {
  const batchId = `${jobId}#batch-${batchIndex}`;
  const ttl = Math.floor(Date.now() / 1000) + 7200;

  await docClient.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId: batchId },
    UpdateExpression: 'SET gamesProcessed = :processed, mistakesFound = :count, updatedAt = :updatedAt, #ttl = :ttl',
    ExpressionAttributeNames: { '#ttl': 'ttl' },
    ExpressionAttributeValues: {
      ':processed': gamesProcessed,
      ':count': mistakes,
      ':updatedAt': new Date().toISOString(),
      ':ttl': ttl
    }
  }));
}

// Complete a batch and update parent job
async function completeBatch(jobId, batchIndex, mistakes) {
  const batchId = `${jobId}#batch-${batchIndex}`;
  const ttl = Math.floor(Date.now() / 1000) + 7200;

  // Update batch as completed
  await docClient.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId: batchId },
    UpdateExpression: 'SET #status = :status, mistakes = :mistakes, mistakesFound = :count, updatedAt = :updatedAt, #ttl = :ttl',
    ExpressionAttributeNames: { '#status': 'status', '#ttl': 'ttl' },
    ExpressionAttributeValues: {
      ':status': 'completed',
      ':mistakes': mistakes,
      ':count': mistakes.length,
      ':updatedAt': new Date().toISOString(),
      ':ttl': ttl
    }
  }));

  // Atomically increment completedBatches on parent job
  const result = await docClient.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId },
    UpdateExpression: 'SET completedBatches = completedBatches + :one, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':one': 1,
      ':updatedAt': new Date().toISOString()
    },
    ReturnValues: 'ALL_NEW'
  }));

  // Check if all batches are complete
  const job = result.Attributes;
  if (job.completedBatches >= job.totalBatches) {
    // Aggregate all batch results
    await aggregateJobResults(jobId, job.totalBatches);
  }
}

// Aggregate results from all batches into the main job
async function aggregateJobResults(jobId, totalBatches) {
  const allMistakes = [];

  // Fetch all batch results
  for (let i = 0; i < totalBatches; i++) {
    const batchId = `${jobId}#batch-${i}`;
    const result = await docClient.send(new GetCommand({
      TableName: JOBS_TABLE,
      Key: { jobId: batchId }
    }));
    if (result.Item && result.Item.mistakes) {
      allMistakes.push(...result.Item.mistakes);
    }
  }

  // Update main job as completed
  const ttl = Math.floor(Date.now() / 1000) + 7200;
  await docClient.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId },
    UpdateExpression: 'SET #status = :status, mistakes = :mistakes, mistakesFound = :count, updatedAt = :updatedAt, #ttl = :ttl',
    ExpressionAttributeNames: { '#status': 'status', '#ttl': 'ttl' },
    ExpressionAttributeValues: {
      ':status': 'completed',
      ':mistakes': allMistakes,
      ':count': allMistakes.length,
      ':updatedAt': new Date().toISOString(),
      ':ttl': ttl
    }
  }));
}

async function saveJobResults(jobId, mistakes) {
  const ttl = Math.floor(Date.now() / 1000) + 3600;

  await docClient.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId },
    UpdateExpression: 'SET #status = :status, mistakes = :mistakes, mistakesFound = :count, updatedAt = :updatedAt, #ttl = :ttl',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#ttl': 'ttl'
    },
    ExpressionAttributeValues: {
      ':status': 'completed',
      ':mistakes': mistakes,
      ':count': mistakes.length,
      ':updatedAt': new Date().toISOString(),
      ':ttl': ttl
    }
  }));
}

async function getJob(jobId) {
  const result = await docClient.send(new GetCommand({
    TableName: JOBS_TABLE,
    Key: { jobId }
  }));
  return result.Item;
}

// Cache functions for persistent storage of analyzed games
async function getCachedAnalysis(gameUrl) {
  if (!CACHE_TABLE) return null;

  try {
    const result = await docClient.send(new GetCommand({
      TableName: CACHE_TABLE,
      Key: { gameUrl }
    }));
    return result.Item;
  } catch (error) {
    console.warn('Cache read error:', error);
    return null;
  }
}

async function cacheAnalysis(gameUrl, mistakes, gameMetadata) {
  if (!CACHE_TABLE) return;

  try {
    await docClient.send(new PutCommand({
      TableName: CACHE_TABLE,
      Item: {
        gameUrl,
        mistakes,
        analyzedAt: new Date().toISOString(),
        // Store metadata for debugging/auditing
        timeClass: gameMetadata.time_class || '',
        opening: gameMetadata.opening || '',
        eco: gameMetadata.eco || '',
      }
    }));
  } catch (error) {
    console.warn('Cache write error:', error);
  }
}

// User data functions for storing/retrieving user's analyzed data
async function getUserData(username) {
  if (!USERDATA_TABLE) return null;

  try {
    const result = await docClient.send(new GetCommand({
      TableName: USERDATA_TABLE,
      Key: { username: username.toLowerCase() }
    }));
    return result.Item;
  } catch (error) {
    console.warn('User data read error:', error);
    return null;
  }
}

async function saveUserData(username, mistakes, games) {
  if (!USERDATA_TABLE) return;

  try {
    await docClient.send(new PutCommand({
      TableName: USERDATA_TABLE,
      Item: {
        username: username.toLowerCase(),
        mistakes,
        games,
        mistakesCount: mistakes.length,
        gamesCount: games.length,
        updatedAt: new Date().toISOString(),
      }
    }));
    console.log(`Saved user data for ${username}: ${mistakes.length} mistakes, ${games.length} games`);
  } catch (error) {
    console.warn('User data write error:', error);
  }
}

// Process games - the actual analysis work
async function processGames(jobId, games) {
  // Separate games into cached and uncached
  const allMistakes = [];
  const gamesToAnalyze = [];

  // Check cache for each game
  // Cache key includes player_color since analysis is player-specific
  for (const gameData of games) {
    const gameUrl = gameData.url;
    const playerColor = gameData.player_color || 'white';
    const cacheKey = gameUrl ? `${gameUrl}:${playerColor}` : null;

    if (cacheKey) {
      const cached = await getCachedAnalysis(cacheKey);
      if (cached && cached.mistakes) {
        console.log(`Cache hit for game: ${cacheKey}`);
        allMistakes.push(...cached.mistakes);
      } else {
        gamesToAnalyze.push(gameData);
      }
    } else {
      gamesToAnalyze.push(gameData);
    }
  }

  // If all games were cached, save and return
  if (gamesToAnalyze.length === 0) {
    await saveJobResults(jobId, allMistakes);
    return { allMistakes, cached: true };
  }

  // Process uncached games with Stockfish
  const engine = new StockfishEngine();
  await engine.init();

  try {
    for (let i = 0; i < gamesToAnalyze.length; i++) {
      const gameData = gamesToAnalyze[i];

      try {
        const mistakes = await analyzeGame(engine, gameData);
        const gameMistakes = mistakes || [];

        // Cache the analysis result (even if no mistakes found)
        // Cache key includes player_color since analysis is player-specific
        if (gameData.url) {
          const playerColor = gameData.player_color || 'white';
          const cacheKey = `${gameData.url}:${playerColor}`;
          await cacheAnalysis(cacheKey, gameMistakes, gameData);
          console.log(`Cached analysis for game: ${cacheKey}`);
        }

        if (gameMistakes.length > 0) {
          allMistakes.push(...gameMistakes);
        }
      } catch (error) {
        console.warn('Error analyzing game:', error);
      }

      await updateJobProgress(jobId, i + 1, gamesToAnalyze.length, allMistakes.length);
    }

    await saveJobResults(jobId, allMistakes);
    return { allMistakes, cached: false };
  } finally {
    engine.quit();
  }
}

// Handle batch processing invocation (called by Lambda self-invoke for parallel processing)
async function handleBatchProcessing(body) {
  const { jobId, batchIndex, games } = body;
  console.log(`Batch ${batchIndex} processing started for job ${jobId} with ${games.length} games`);

  try {
    // Process games in this batch
    const allMistakes = [];
    const gamesToAnalyze = [];

    // Check cache for each game
    for (const gameData of games) {
      const gameUrl = gameData.url;
      const playerColor = gameData.player_color || 'white';
      const cacheKey = gameUrl ? `${gameUrl}:${playerColor}` : null;

      if (cacheKey) {
        const cached = await getCachedAnalysis(cacheKey);
        if (cached && cached.mistakes) {
          console.log(`Cache hit for game: ${cacheKey}`);
          allMistakes.push(...cached.mistakes);
        } else {
          gamesToAnalyze.push(gameData);
        }
      } else {
        gamesToAnalyze.push(gameData);
      }
    }

    // Process uncached games with Stockfish
    if (gamesToAnalyze.length > 0) {
      const engine = new StockfishEngine();
      await engine.init();

      try {
        for (let i = 0; i < gamesToAnalyze.length; i++) {
          const gameData = gamesToAnalyze[i];

          try {
            const mistakes = await analyzeGame(engine, gameData);
            const gameMistakes = mistakes || [];

            // Cache the analysis result
            if (gameData.url) {
              const playerColor = gameData.player_color || 'white';
              const cacheKey = `${gameData.url}:${playerColor}`;
              await cacheAnalysis(cacheKey, gameMistakes, gameData);
              console.log(`Cached analysis for game: ${cacheKey}`);
            }

            if (gameMistakes.length > 0) {
              allMistakes.push(...gameMistakes);
            }
          } catch (error) {
            console.warn('Error analyzing game:', error);
          }

          // Update batch progress
          await updateBatchProgress(jobId, batchIndex, i + 1, allMistakes.length);
        }
      } finally {
        engine.quit();
      }
    }

    // Complete this batch and trigger aggregation if all batches done
    await completeBatch(jobId, batchIndex, allMistakes);
    console.log(`Batch ${batchIndex} completed for job ${jobId} with ${allMistakes.length} mistakes`);

  } catch (error) {
    console.error(`Batch ${batchIndex} failed for job ${jobId}:`, error);
    // Mark batch as error
    const batchId = `${jobId}#batch-${batchIndex}`;
    await docClient.send(new UpdateCommand({
      TableName: JOBS_TABLE,
      Key: { jobId: batchId },
      UpdateExpression: 'SET #status = :status, errorMessage = :error, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'error',
        ':error': error.message,
        ':updatedAt': new Date().toISOString()
      }
    }));
  }
}

// Handle single-batch async processing (for backward compatibility with small jobs)
async function handleAsyncProcessing(body) {
  const { jobId, games } = body;
  console.log(`Async processing started for job ${jobId} with ${games.length} games`);

  try {
    await processGames(jobId, games);
    console.log(`Async processing completed for job ${jobId}`);
  } catch (error) {
    console.error(`Async processing failed for job ${jobId}:`, error);
    await docClient.send(new UpdateCommand({
      TableName: JOBS_TABLE,
      Key: { jobId },
      UpdateExpression: 'SET #status = :status, errorMessage = :error, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'error',
        ':error': error.message,
        ':updatedAt': new Date().toISOString()
      }
    }));
  }
}

// Split array into batches
function splitIntoBatches(array, batchSize) {
  const batches = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

async function handleAnalyze(body, functionName) {
  const { games } = body;

  if (!games || !Array.isArray(games) || games.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'No games provided' })
    };
  }

  // Quick check: are all games already cached?
  let allCached = true;
  const cachedMistakes = [];

  for (const gameData of games) {
    const gameUrl = gameData.url;
    const playerColor = gameData.player_color || 'white';
    const cacheKey = gameUrl ? `${gameUrl}:${playerColor}` : null;

    if (cacheKey) {
      const cached = await getCachedAnalysis(cacheKey);
      if (cached && cached.mistakes) {
        cachedMistakes.push(...cached.mistakes);
      } else {
        allCached = false;
        break; // No need to check more, we'll need async processing
      }
    } else {
      allCached = false;
      break;
    }
  }

  // If all games were cached, return immediately
  if (allCached) {
    const jobId = uuidv4();
    await createJob(jobId, games.length, 1);
    await saveJobResults(jobId, cachedMistakes);
    return {
      statusCode: 200,
      body: JSON.stringify({
        jobId,
        status: 'completed',
        mistakesFound: cachedMistakes.length,
        mistakes: cachedMistakes,
        cached: true
      })
    };
  }

  // Split games into batches for parallel processing
  const batches = splitIntoBatches(games, BATCH_SIZE);

  // If we have more batches than max parallel, redistribute
  let finalBatches = batches;
  if (batches.length > MAX_PARALLEL_LAMBDAS) {
    // Redistribute games evenly across max parallel lambdas
    const gamesPerLambda = Math.ceil(games.length / MAX_PARALLEL_LAMBDAS);
    finalBatches = splitIntoBatches(games, gamesPerLambda);
  }

  const jobId = uuidv4();
  await createJob(jobId, games.length, finalBatches.length);

  console.log(`Invoking ${finalBatches.length} parallel workers for job ${jobId} (${games.length} games)`);

  // Create batch records and invoke workers in parallel
  const invocations = finalBatches.map(async (batch, index) => {
    // Create batch record
    await createBatch(jobId, index, batch.length);

    // Invoke worker Lambda
    await lambdaClient.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify({
        batchProcessing: true,
        jobId,
        batchIndex: index,
        games: batch
      })
    }));

    console.log(`Invoked batch ${index} with ${batch.length} games`);
  });

  await Promise.all(invocations);

  // Return immediately with job ID - client will poll /status
  return {
    statusCode: 202,
    body: JSON.stringify({
      jobId,
      status: 'processing',
      totalBatches: finalBatches.length,
      message: `Analysis started with ${finalBatches.length} parallel workers. Poll /api/status/{jobId} for progress.`
    })
  };
}

async function handleStatus(jobId) {
  const job = await getJob(jobId);

  if (!job) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Job not found' })
    };
  }

  // If job is completed, return final results
  if (job.status === 'completed') {
    return {
      statusCode: 200,
      body: JSON.stringify({
        jobId: job.jobId,
        status: 'completed',
        currentGame: job.totalGames,
        totalGames: job.totalGames,
        completedBatches: job.totalBatches,
        totalBatches: job.totalBatches,
        mistakesFound: job.mistakesFound,
        mistakes: job.mistakes
      })
    };
  }

  // Aggregate progress from all batches using BatchGetItem (max 100 items per call)
  let totalProcessed = 0;
  let totalMistakes = 0;
  let completedBatches = 0;
  const partialMistakes = []; // Collect mistakes from completed batches

  const batchKeys = [];
  for (let i = 0; i < job.totalBatches; i++) {
    batchKeys.push({ jobId: `${jobId}#batch-${i}` });
  }

  // BatchGetItem supports up to 100 keys per request
  for (let i = 0; i < batchKeys.length; i += 100) {
    const chunk = batchKeys.slice(i, i + 100);
    try {
      const result = await docClient.send(new BatchGetCommand({
        RequestItems: {
          [JOBS_TABLE]: {
            Keys: chunk
          }
        }
      }));

      const items = result.Responses?.[JOBS_TABLE] || [];
      for (const item of items) {
        totalProcessed += item.gamesProcessed || 0;
        totalMistakes += item.mistakesFound || 0;
        if (item.status === 'completed') {
          completedBatches++;
          // Collect mistakes from completed batches for partial results
          if (item.mistakes && Array.isArray(item.mistakes)) {
            partialMistakes.push(...item.mistakes);
          }
        }
      }
    } catch (error) {
      console.warn(`Error fetching batch chunk:`, error);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      jobId: job.jobId,
      status: job.status,
      currentGame: totalProcessed,
      totalGames: job.totalGames,
      completedBatches,
      totalBatches: job.totalBatches,
      mistakesFound: totalMistakes,
      mistakes: partialMistakes // Include partial mistakes for cancel/resume scenarios
    })
  };
}

exports.handler = async (event, context) => {
  // Handle batch processing invocation (parallel worker)
  if (event.batchProcessing) {
    console.log(`Batch processing invocation received for batch ${event.batchIndex}`);
    await handleBatchProcessing(event);
    return; // No response needed for async invocation
  }

  // Handle single-job async processing (legacy, for small jobs)
  if (event.asyncProcessing) {
    console.log('Async processing invocation received');
    await handleAsyncProcessing(event);
    return; // No response needed for async invocation
  }

  console.log('Event:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  };

  try {
    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method || '';

    // Handle OPTIONS preflight
    if (method === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    // POST /api/analyze
    if (method === 'POST' && path.includes('/analyze')) {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      const result = await handleAnalyze(body, context.functionName);
      return { ...result, headers };
    }

    // GET /api/status/{jobId}
    if (method === 'GET' && path.includes('/status/')) {
      const jobId = event.pathParameters?.jobId || path.split('/status/')[1];
      const result = await handleStatus(jobId);
      return { ...result, headers };
    }

    // GET /api/userdata/{username} - Fetch existing user data
    if (method === 'GET' && path.includes('/userdata/')) {
      const username = event.pathParameters?.username || path.split('/userdata/')[1];
      if (!username) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Username required' })
        };
      }
      const userData = await getUserData(username);
      if (!userData) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'No data found for user', username })
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          username: userData.username,
          mistakes: userData.mistakes,
          games: userData.games,
          mistakesCount: userData.mistakesCount,
          gamesCount: userData.gamesCount,
          updatedAt: userData.updatedAt
        })
      };
    }

    // POST /api/userdata/{username} - Save user data
    if (method === 'POST' && path.includes('/userdata/')) {
      const username = event.pathParameters?.username || path.split('/userdata/')[1];
      if (!username) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Username required' })
        };
      }
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      const { mistakes, games } = body;
      if (!mistakes || !Array.isArray(mistakes)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Mistakes array required' })
        };
      }
      if (!games || !Array.isArray(games)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Games array required' })
        };
      }
      await saveUserData(username, mistakes, games);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          username: username.toLowerCase(),
          mistakesCount: mistakes.length,
          gamesCount: games.length
        })
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' })
    };
  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
