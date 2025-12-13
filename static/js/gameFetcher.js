// Game Fetcher - fetches games from Chess.com API (ported from fetch_games.py)

const VALID_TIME_CLASSES = new Set(['blitz', 'rapid']);
const EXCLUDED_RULES = new Set([
    'bullet', 'chess960', 'bughouse', 'crazyhouse', 'threecheck', 'kingofthehill'
]);

let fetchAbortController = null;

async function getArchives(username) {
    const url = `https://api.chess.com/pub/player/${username}/games/archives`;

    const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: fetchAbortController?.signal
    });

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`User "${username}" not found on Chess.com`);
        }
        throw new Error(`Failed to fetch archives: ${response.status}`);
    }

    const data = await response.json();
    return data.archives || [];
}

async function fetchGamesFromArchive(archiveUrl) {
    const response = await fetch(archiveUrl, {
        headers: { 'Accept': 'application/json' },
        signal: fetchAbortController?.signal
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch archive: ${response.status}`);
    }

    const data = await response.json();
    return data.games || [];
}

function filterGame(game) {
    // Check time class
    const timeClass = game.time_class || '';
    if (!VALID_TIME_CLASSES.has(timeClass)) {
        return false;
    }

    // Check for variant rules
    const rules = game.rules || 'chess';
    if (EXCLUDED_RULES.has(rules)) {
        return false;
    }

    // Must have PGN data
    if (!game.pgn) {
        return false;
    }

    return true;
}

function extractGameData(game, username) {
    const white = game.white || {};
    const black = game.black || {};

    // Determine player color
    const playerColor = white.username?.toLowerCase() === username.toLowerCase()
        ? 'white'
        : 'black';

    // Extract opening from PGN headers
    const pgn = game.pgn || '';
    let opening = '';
    let eco = '';

    for (const line of pgn.split('\n')) {
        if (line.startsWith('[ECOUrl "')) {
            try {
                const urlPart = line.split('"')[1];
                opening = urlPart.split('/openings/').pop().replace(/-/g, ' ');
            } catch (e) {
                // Ignore parsing errors
            }
        } else if (line.startsWith('[ECO "')) {
            try {
                eco = line.split('"')[1];
            } catch (e) {
                // Ignore parsing errors
            }
        }
    }

    return {
        url: game.url || '',
        pgn: pgn,
        time_class: game.time_class || '',
        time_control: game.time_control || '',
        end_time: game.end_time || 0,
        player_color: playerColor,
        opening: opening,
        eco: eco,
        white: {
            username: white.username || '',
            rating: white.rating || 0
        },
        black: {
            username: black.username || '',
            rating: black.rating || 0
        }
    };
}

const MAX_GAMES = 25;

async function fetchAllGames(username, onProgress) {
    fetchAbortController = new AbortController();

    try {
        // Get all archives
        if (onProgress) onProgress({ stage: 'archives', message: 'Fetching archive list...' });

        const archives = await getArchives(username);
        if (archives.length === 0) {
            throw new Error('No game archives found for this user');
        }

        // Sort archives most recent first
        const sortedArchives = [...archives].sort().reverse();

        const allGames = [];

        for (let i = 0; i < sortedArchives.length; i++) {
            // Stop if we've reached the limit
            if (allGames.length >= MAX_GAMES) {
                break;
            }

            const archiveUrl = sortedArchives[i];
            const month = archiveUrl.split('/').slice(-2).join('/');

            if (onProgress) {
                onProgress({
                    stage: 'fetching',
                    message: `Fetching ${month}...`,
                    current: i + 1,
                    total: sortedArchives.length,
                    gamesFound: allGames.length
                });
            }

            try {
                const games = await fetchGamesFromArchive(archiveUrl);
                const filtered = games.filter(filterGame);

                for (const game of filtered) {
                    if (allGames.length >= MAX_GAMES) {
                        break;
                    }
                    const extracted = extractGameData(game, username);
                    allGames.push(extracted);
                }

                // Small delay to be nice to the API
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.warn(`Error fetching ${month}:`, error);
                // Continue with other archives
            }
        }

        if (onProgress) {
            onProgress({
                stage: 'complete',
                message: `Found ${allGames.length} games`,
                gamesFound: allGames.length
            });
        }

        // Save to localStorage
        setGames(allGames);

        return allGames;

    } finally {
        fetchAbortController = null;
    }
}

function cancelFetch() {
    if (fetchAbortController) {
        fetchAbortController.abort();
        fetchAbortController = null;
    }
}
