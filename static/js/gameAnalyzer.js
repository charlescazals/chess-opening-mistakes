// Game Analyzer - analyzes games using Stockfish WASM (ported from analyze_games.py)

const ANALYSIS_DEPTH = 15;
const MOVES_TO_ANALYZE = 14;  // First 14 half-moves (7 per player)
const MISTAKE_THRESHOLD = 100;  // Centipawns (1 pawn)

let stockfish = null;
let analysisAbortController = null;
let isAnalyzing = false;

function initStockfish() {
    return new Promise((resolve, reject) => {
        if (stockfish) {
            resolve(stockfish);
            return;
        }

        try {
            // Use local stockfish.js file
            stockfish = new Worker('static/js/stockfish.js');

            let initialized = false;

            stockfish.onmessage = (event) => {
                if (event.data === 'uciok' && !initialized) {
                    initialized = true;
                    // Set options for better performance
                    stockfish.postMessage('setoption name Hash value 32');
                    stockfish.postMessage('isready');
                }
                if (event.data === 'readyok' && initialized) {
                    resolve(stockfish);
                }
            };

            stockfish.onerror = (error) => {
                reject(new Error('Failed to initialize Stockfish: ' + error.message));
            };

            stockfish.postMessage('uci');

        } catch (error) {
            reject(new Error('Failed to create Stockfish worker: ' + error.message));
        }
    });
}

function terminateStockfish() {
    if (stockfish) {
        stockfish.terminate();
        stockfish = null;
    }
}

function getEvaluation(fen) {
    return new Promise((resolve) => {
        if (!stockfish) {
            resolve({ eval: null, bestMove: null });
            return;
        }

        let evalScore = null;
        let bestMove = null;

        const messageHandler = (event) => {
            const line = event.data;

            // Parse evaluation from info line
            if (line.startsWith('info') && line.includes('score')) {
                const depthMatch = line.match(/depth (\d+)/);
                const depth = depthMatch ? parseInt(depthMatch[1]) : 0;

                if (depth >= ANALYSIS_DEPTH) {
                    // Check for mate score
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

                    // Extract principal variation for best move
                    const pvMatch = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbnQRBN]?)/);
                    if (pvMatch) {
                        bestMove = pvMatch[1];
                    }
                }
            }

            // Analysis complete
            if (line.startsWith('bestmove')) {
                stockfish.removeEventListener('message', messageHandler);
                resolve({ eval: evalScore, bestMove: bestMove });
            }
        };

        stockfish.addEventListener('message', messageHandler);
        stockfish.postMessage('position fen ' + fen);
        stockfish.postMessage('go depth ' + ANALYSIS_DEPTH);
    });
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
    // Convert UCI move (e2e4) to SAN (e4)
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

async function analyzeGame(gameData, onProgress) {
    const pgn = gameData.pgn || '';
    const playerColor = gameData.player_color || 'white';
    const isWhite = playerColor === 'white';

    // Parse PGN using chess.js
    const chess = new Chess();
    const loaded = chess.load_pgn(pgn);

    if (!loaded) {
        return null;
    }

    // Get moves
    const history = chess.history();
    chess.reset();

    if (history.length < MOVES_TO_ANALYZE) {
        return null;  // Game too short
    }

    // Player moves at even indices for white, odd for black
    const playerMoveIndices = isWhite
        ? [...Array(Math.floor(MOVES_TO_ANALYZE / 2)).keys()].map(i => i * 2)
        : [...Array(Math.floor(MOVES_TO_ANALYZE / 2)).keys()].map(i => i * 2 + 1);

    const mistakes = [];
    const moveSequence = [];

    // Get initial evaluation
    let prevEval = (await getEvaluation(chess.fen())).eval;

    // Analyze first N moves
    for (let i = 0; i < Math.min(MOVES_TO_ANALYZE, history.length); i++) {
        const move = history[i];
        moveSequence.push(move);

        // For player moves, get best move BEFORE making the move
        let bestMoveBefore = null;
        if (playerMoveIndices.includes(i)) {
            const result = await getEvaluation(chess.fen());
            if (result.bestMove) {
                bestMoveBefore = uciToSan(result.bestMove, chess);
            }
        }

        // Make the move
        chess.move(move);

        // Get evaluation after move
        const currentResult = await getEvaluation(chess.fen());
        const currentEval = currentResult.eval;

        // Check if this was a player move and if it was a mistake
        if (playerMoveIndices.includes(i) && prevEval !== null && currentEval !== null) {
            // Calculate eval change from player's perspective
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

        if (onProgress) {
            onProgress({
                moveIndex: i + 1,
                totalMoves: Math.min(MOVES_TO_ANALYZE, history.length)
            });
        }
    }

    return mistakes;
}

async function analyzeAllGames(onProgress) {
    isAnalyzing = true;

    try {
        // Initialize Stockfish
        if (onProgress) onProgress({ stage: 'init', message: 'Initializing Stockfish...' });
        await initStockfish();

        // Get games and progress
        const games = getGames();
        const processedUrls = new Set(getAnalysisProgress());
        let allMistakes = getMistakes();

        // Filter games not yet processed
        const gamesToProcess = games.filter(g => !processedUrls.has(g.url));

        if (gamesToProcess.length === 0) {
            if (onProgress) onProgress({ stage: 'complete', message: 'All games already analyzed!' });
            return allMistakes;
        }

        if (onProgress) {
            onProgress({
                stage: 'analyzing',
                message: `Analyzing ${gamesToProcess.length} games...`,
                current: 0,
                total: gamesToProcess.length,
                mistakes: allMistakes.length
            });
        }

        for (let i = 0; i < gamesToProcess.length; i++) {
            if (!isAnalyzing) break;  // Check for cancellation

            const gameData = gamesToProcess[i];
            const opening = (gameData.opening || 'Unknown').substring(0, 30);
            const color = gameData.player_color || '?';

            if (onProgress) {
                onProgress({
                    stage: 'analyzing',
                    message: `${opening}... (${color})`,
                    current: i + 1,
                    total: gamesToProcess.length,
                    mistakes: allMistakes.length
                });
            }

            try {
                const mistakes = await analyzeGame(gameData);

                if (mistakes && mistakes.length > 0) {
                    allMistakes = [...allMistakes, ...mistakes];
                }
            } catch (error) {
                console.warn('Error analyzing game:', error);
            }

            // Update progress
            addToAnalysisProgress(gameData.url);

            // Save progress periodically
            if ((i + 1) % 5 === 0 || i === gamesToProcess.length - 1) {
                setMistakes(allMistakes);
            }
        }

        // Final save
        setMistakes(allMistakes);

        if (onProgress) {
            onProgress({
                stage: 'complete',
                message: `Analysis complete! Found ${allMistakes.length} mistakes.`,
                mistakes: allMistakes.length
            });
        }

        return allMistakes;

    } finally {
        isAnalyzing = false;
    }
}

function cancelAnalysis() {
    isAnalyzing = false;
}

function isAnalysisRunning() {
    return isAnalyzing;
}
