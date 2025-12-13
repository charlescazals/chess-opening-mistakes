// Game Analyzer - analyzes games using AWS Lambda backend with Stockfish

const ANALYSIS_DEPTH = 18;
const MOVES_TO_ANALYZE = 14;
const MISTAKE_THRESHOLD = 100;

// API configuration - uses relative path through CloudFront
const API_BASE_URL = '/api';
const POLL_INTERVAL = 3000; // Poll every 3 seconds

let analysisAbortController = null;
let isAnalyzing = false;
let currentJobId = null;

async function analyzeAllGames(onProgress) {
    isAnalyzing = true;
    analysisAbortController = new AbortController();

    try {
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
                stage: 'init',
                message: 'Starting analysis...',
                current: 0,
                total: gamesToProcess.length,
                mistakes: allMistakes.length
            });
        }

        // Send games to Lambda for analysis
        const response = await fetch(`${API_BASE_URL}/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ games: gamesToProcess }),
            signal: analysisAbortController.signal
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();
        currentJobId = result.jobId;

        // If completed immediately (synchronous response)
        if (result.status === 'completed') {
            const newMistakes = result.mistakes || [];
            allMistakes = [...allMistakes, ...newMistakes];

            // Mark all games as processed
            for (const game of gamesToProcess) {
                addToAnalysisProgress(game.url);
            }

            setMistakes(allMistakes);

            if (onProgress) {
                onProgress({
                    stage: 'complete',
                    message: `Analysis complete! Found ${newMistakes.length} new mistakes.`,
                    mistakes: allMistakes.length
                });
            }

            return allMistakes;
        }

        // Poll for progress
        return await pollForResults(currentJobId, gamesToProcess, allMistakes, onProgress);

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Analysis cancelled');
            if (onProgress) {
                onProgress({ stage: 'cancelled', message: 'Analysis cancelled' });
            }
        } else {
            console.error('Analysis error:', error);
            if (onProgress) {
                onProgress({ stage: 'error', message: `Error: ${error.message}` });
            }
        }
        return getMistakes();
    } finally {
        isAnalyzing = false;
        currentJobId = null;
    }
}

async function pollForResults(jobId, gamesToProcess, existingMistakes, onProgress) {
    while (isAnalyzing) {
        try {
            const response = await fetch(`${API_BASE_URL}/status/${jobId}`, {
                signal: analysisAbortController.signal
            });

            if (!response.ok) {
                throw new Error(`Status check failed: ${response.status}`);
            }

            const status = await response.json();

            if (onProgress) {
                const opening = gamesToProcess[status.currentGame - 1]?.opening || 'Analyzing...';
                const color = gamesToProcess[status.currentGame - 1]?.player_color || '';

                onProgress({
                    stage: 'analyzing',
                    message: `${opening.substring(0, 30)}... (${color})`,
                    current: status.currentGame,
                    total: status.totalGames,
                    mistakes: existingMistakes.length + status.mistakesFound
                });
            }

            if (status.status === 'completed') {
                const newMistakes = status.mistakes || [];
                const allMistakes = [...existingMistakes, ...newMistakes];

                // Mark all games as processed
                for (const game of gamesToProcess) {
                    addToAnalysisProgress(game.url);
                }

                setMistakes(allMistakes);

                if (onProgress) {
                    onProgress({
                        stage: 'complete',
                        message: `Analysis complete! Found ${newMistakes.length} new mistakes.`,
                        mistakes: allMistakes.length
                    });
                }

                return allMistakes;
            }

            if (status.status === 'error') {
                throw new Error('Analysis failed on server');
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

        } catch (error) {
            if (error.name === 'AbortError') {
                throw error;
            }
            console.warn('Poll error:', error);
            // Continue polling on transient errors
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }
    }

    return existingMistakes;
}

function cancelAnalysis() {
    isAnalyzing = false;
    if (analysisAbortController) {
        analysisAbortController.abort();
        analysisAbortController = null;
    }
}

function isAnalysisRunning() {
    return isAnalyzing;
}

// Legacy function compatibility - no longer needed but kept for interface
function initStockfish() {
    return Promise.resolve();
}

function terminateStockfish() {
    // No-op - Stockfish runs on server now
}
