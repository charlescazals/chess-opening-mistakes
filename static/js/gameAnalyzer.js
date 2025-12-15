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

            // Ensure userdata is saved to cloud even when all games were already analyzed
            const username = getUsername();
            if (username && allMistakes.length > 0) {
                await saveUserDataToCloud(username, allMistakes, games);
            }

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

        // If completed immediately (all cached)
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

        // Async processing started - show message and start polling
        if (onProgress) {
            onProgress({
                stage: 'analyzing',
                message: 'Analysis started, processing games...',
                current: 0,
                total: gamesToProcess.length,
                mistakes: allMistakes.length
            });
        }

        // Poll for progress
        return await pollForResults(currentJobId, gamesToProcess, allMistakes, onProgress);

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Analysis cancelled');
            // Use partial results if available
            const partialMistakes = error.partialMistakes || getMistakes();
            if (onProgress) {
                onProgress({
                    stage: 'cancelled',
                    message: `Analysis cancelled. Saved ${error.partialMistakes ? error.partialMistakes.length : 0} partial results.`,
                    mistakes: partialMistakes.length
                });
            }
            return partialMistakes;
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
    let lastSavedMistakeCount = 0; // Track to avoid redundant cloud saves
    const username = getUsername();
    const allGames = getGames();

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
                let message = 'Starting analysis...';
                const currentGame = gamesToProcess[status.currentGame - 1];

                if (currentGame) {
                    const opening = currentGame.opening || 'Unknown opening';
                    const color = currentGame.player_color || '';
                    message = color ? `${opening.substring(0, 30)}... (${color})` : `${opening.substring(0, 30)}...`;
                }

                onProgress({
                    stage: 'analyzing',
                    message,
                    current: status.currentGame,
                    total: status.totalGames,
                    mistakes: existingMistakes.length + status.mistakesFound
                });
            }

            // Save partial results to cloud periodically (when new mistakes are found)
            const partialMistakes = status.mistakes || [];
            if (partialMistakes.length > lastSavedMistakeCount && username) {
                const allMistakes = [...existingMistakes, ...partialMistakes];
                setMistakes(allMistakes);
                await saveUserDataToCloud(username, allMistakes, allGames);
                lastSavedMistakeCount = partialMistakes.length;
                console.log(`Saved ${allMistakes.length} mistakes to cloud (partial save)`);
            }

            if (status.status === 'completed') {
                const newMistakes = status.mistakes || [];
                const allMistakes = [...existingMistakes, ...newMistakes];

                // Mark all games as processed
                for (const game of gamesToProcess) {
                    addToAnalysisProgress(game.url);
                }

                setMistakes(allMistakes);

                // Final save to cloud
                if (username) {
                    await saveUserDataToCloud(username, allMistakes, allGames);
                }

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
                // On cancel, fetch partial results and save to cloud
                const partialResults = await fetchPartialResults(jobId, existingMistakes);
                if (partialResults.newMistakes > 0) {
                    setMistakes(partialResults.allMistakes);
                    // Save partial results to cloud on cancel
                    if (username) {
                        await saveUserDataToCloud(username, partialResults.allMistakes, allGames);
                        console.log(`Saved ${partialResults.allMistakes.length} mistakes to cloud (cancelled)`);
                    }
                }
                error.partialMistakes = partialResults.allMistakes;
                throw error;
            }
            console.warn('Poll error:', error);
            // Continue polling on transient errors
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }
    }

    // Also fetch partial results when loop exits normally (isAnalyzing set to false)
    const partialResults = await fetchPartialResults(jobId, existingMistakes);
    if (partialResults.newMistakes > 0) {
        setMistakes(partialResults.allMistakes);
        // Save to cloud when loop exits
        if (username) {
            await saveUserDataToCloud(username, partialResults.allMistakes, allGames);
            console.log(`Saved ${partialResults.allMistakes.length} mistakes to cloud (loop exit)`);
        }
    }
    return partialResults.allMistakes;
}

// Fetch partial results from server (for cancel/error scenarios)
async function fetchPartialResults(jobId, existingMistakes) {
    try {
        const response = await fetch(`${API_BASE_URL}/status/${jobId}`);
        if (response.ok) {
            const status = await response.json();
            const partialMistakes = status.mistakes || [];
            if (partialMistakes.length > 0) {
                console.log(`Fetched ${partialMistakes.length} partial mistakes from cancelled job`);
                return {
                    allMistakes: [...existingMistakes, ...partialMistakes],
                    newMistakes: partialMistakes.length
                };
            }
        }
    } catch (e) {
        console.warn('Could not fetch partial results:', e);
    }
    return { allMistakes: existingMistakes, newMistakes: 0 };
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

// Fetch existing user data from DynamoDB (for returning users on new browsers)
async function fetchUserData(username) {
    try {
        const response = await fetch(`${API_BASE_URL}/userdata/${encodeURIComponent(username)}`);

        if (response.status === 404) {
            // No existing data for this user
            return null;
        }

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        // Verify response is JSON before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.warn('User data endpoint returned non-JSON response');
            return null;
        }

        return await response.json();
    } catch (error) {
        console.warn('Error fetching user data:', error);
        return null;
    }
}

// Check which games are already cached in DynamoDB
async function checkCachedGames(games) {
    try {
        const response = await fetch(`${API_BASE_URL}/check-cache`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ games })
        });

        if (!response.ok) {
            console.warn('Cache check failed:', response.status);
            return { cachedUrls: [], cachedCount: 0 };
        }

        return await response.json();
    } catch (error) {
        console.warn('Error checking cached games:', error);
        return { cachedUrls: [], cachedCount: 0 };
    }
}

// Save user data to DynamoDB (after analysis completes)
async function saveUserDataToCloud(username, mistakes, games) {
    try {
        const response = await fetch(`${API_BASE_URL}/userdata/${encodeURIComponent(username)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ mistakes, games })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();
        console.log('User data saved to cloud:', result);
        return result;
    } catch (error) {
        console.warn('Error saving user data to cloud:', error);
        return null;
    }
}
