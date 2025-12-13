const { spawn } = require('child_process');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { Chess } = require('chess.js');
const { v4: uuidv4 } = require('uuid');

const ANALYSIS_DEPTH = 18;
const MOVES_TO_ANALYZE = 14;
const MISTAKE_THRESHOLD = 100;
const STOCKFISH_PATH = '/usr/local/bin/stockfish';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const JOBS_TABLE = process.env.JOBS_TABLE_NAME;

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
          resolve({ eval: evalScore, bestMove: bestMove, depth: currentDepth });
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

async function createJob(jobId, totalGames) {
  const ttl = Math.floor(Date.now() / 1000) + 3600;

  await docClient.send(new PutCommand({
    TableName: JOBS_TABLE,
    Item: {
      jobId,
      status: 'processing',
      currentGame: 0,
      totalGames,
      mistakesFound: 0,
      mistakes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ttl
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

async function handleAnalyze(body) {
  const { games } = body;

  if (!games || !Array.isArray(games) || games.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'No games provided' })
    };
  }

  const jobId = uuidv4();
  await createJob(jobId, games.length);

  // Process games synchronously within this Lambda invocation
  const engine = new StockfishEngine();
  await engine.init();

  const allMistakes = [];

  try {
    for (let i = 0; i < games.length; i++) {
      const gameData = games[i];

      try {
        const mistakes = await analyzeGame(engine, gameData);
        if (mistakes && mistakes.length > 0) {
          allMistakes.push(...mistakes);
        }
      } catch (error) {
        console.warn('Error analyzing game:', error);
      }

      await updateJobProgress(jobId, i + 1, games.length, allMistakes.length);
    }

    await saveJobResults(jobId, allMistakes);

    return {
      statusCode: 200,
      body: JSON.stringify({
        jobId,
        status: 'completed',
        mistakesFound: allMistakes.length,
        mistakes: allMistakes
      })
    };
  } finally {
    engine.quit();
  }
}

async function handleStatus(jobId) {
  const job = await getJob(jobId);

  if (!job) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Job not found' })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      jobId: job.jobId,
      status: job.status,
      currentGame: job.currentGame,
      totalGames: job.totalGames,
      mistakesFound: job.mistakesFound,
      mistakes: job.status === 'completed' ? job.mistakes : undefined
    })
  };
}

exports.handler = async (event) => {
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
      const result = await handleAnalyze(body);
      return { ...result, headers };
    }

    // GET /api/status/{jobId}
    if (method === 'GET' && path.includes('/status/')) {
      const jobId = event.pathParameters?.jobId || path.split('/status/')[1];
      const result = await handleStatus(jobId);
      return { ...result, headers };
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
