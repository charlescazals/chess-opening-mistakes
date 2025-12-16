// Storage Manager - handles all localStorage operations

const STORAGE_KEYS = {
    USERNAME: 'chess_username',
    GAMES: 'chess_games',
    MISTAKES: 'chess_mistakes',
    ANALYSIS_PROGRESS: 'chess_analysis_progress',
    LAST_FETCH: 'chess_last_fetch',
    LAST_ANALYSIS: 'chess_last_analysis'
};

function getUsername() {
    return localStorage.getItem(STORAGE_KEYS.USERNAME);
}

function setUsername(username) {
    localStorage.setItem(STORAGE_KEYS.USERNAME, username);
}

function getGames() {
    const data = localStorage.getItem(STORAGE_KEYS.GAMES);
    if (!data) return [];
    try {
        return JSON.parse(data);
    } catch (e) {
        console.warn('Corrupted games data, clearing...');
        localStorage.removeItem(STORAGE_KEYS.GAMES);
        return [];
    }
}

// Strip PGN from games to reduce storage size (PGN is only needed during analysis)
function stripPgnFromGames(games) {
    return games.map(game => {
        const { pgn, ...gameWithoutPgn } = game;
        return gameWithoutPgn;
    });
}

function setGames(games) {
    // Strip PGN before storing - it's large and only needed during analysis
    const gamesWithoutPgn = stripPgnFromGames(games);
    const jsonData = JSON.stringify(gamesWithoutPgn);

    console.log(`setGames: ${games.length} games, size without PGN: ${(jsonData.length / 1024).toFixed(1)} KB`);

    try {
        localStorage.setItem(STORAGE_KEYS.GAMES, jsonData);
        localStorage.setItem(STORAGE_KEYS.LAST_FETCH, Date.now().toString());
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.message.includes('quota')) {
            console.error('localStorage quota exceeded. Clearing old data and retrying...');
            // Clear all chess data and retry
            clearAllData();
            try {
                localStorage.setItem(STORAGE_KEYS.GAMES, jsonData);
                localStorage.setItem(STORAGE_KEYS.LAST_FETCH, Date.now().toString());
            } catch (e2) {
                console.error('Still cannot store games after clearing. Size:', jsonData.length);
                throw e2;
            }
        } else {
            throw e;
        }
    }
}

function getMistakes() {
    const data = localStorage.getItem(STORAGE_KEYS.MISTAKES);
    if (!data) return [];
    try {
        return JSON.parse(data);
    } catch (e) {
        console.warn('Corrupted mistakes data, clearing...');
        localStorage.removeItem(STORAGE_KEYS.MISTAKES);
        return [];
    }
}

function setMistakes(mistakes) {
    localStorage.setItem(STORAGE_KEYS.MISTAKES, JSON.stringify(mistakes));
    localStorage.setItem(STORAGE_KEYS.LAST_ANALYSIS, Date.now().toString());
}

function getAnalysisProgress() {
    const data = localStorage.getItem(STORAGE_KEYS.ANALYSIS_PROGRESS);
    if (!data) return [];
    try {
        return JSON.parse(data);
    } catch (e) {
        console.warn('Corrupted analysis progress data, clearing...');
        localStorage.removeItem(STORAGE_KEYS.ANALYSIS_PROGRESS);
        return [];
    }
}

function setAnalysisProgress(processedUrls) {
    localStorage.setItem(STORAGE_KEYS.ANALYSIS_PROGRESS, JSON.stringify(processedUrls));
}

function addToAnalysisProgress(gameUrl) {
    const progress = getAnalysisProgress();
    if (!progress.includes(gameUrl)) {
        progress.push(gameUrl);
        setAnalysisProgress(progress);
    }
}

function getLastFetch() {
    const timestamp = localStorage.getItem(STORAGE_KEYS.LAST_FETCH);
    return timestamp ? parseInt(timestamp) : null;
}

function getLastAnalysis() {
    const timestamp = localStorage.getItem(STORAGE_KEYS.LAST_ANALYSIS);
    return timestamp ? parseInt(timestamp) : null;
}

function clearAllData() {
    Object.values(STORAGE_KEYS).forEach(key => {
        localStorage.removeItem(key);
    });
}

function hasData() {
    // Show main content if we have username and either games or mistakes
    // This handles the case where analysis was interrupted mid-way
    return getUsername() !== null && (getMistakes().length > 0 || getGames().length > 0);
}

function hasGames() {
    return getGames().length > 0;
}

function getDataStats() {
    const games = getGames();
    const mistakes = getMistakes();
    const progress = getAnalysisProgress();
    const lastFetch = getLastFetch();
    const lastAnalysis = getLastAnalysis();

    return {
        username: getUsername(),
        gameCount: games.length,
        mistakeCount: mistakes.length,
        analyzedCount: progress.length,
        lastFetch: lastFetch ? new Date(lastFetch).toLocaleString() : 'Never',
        lastAnalysis: lastAnalysis ? new Date(lastAnalysis).toLocaleString() : 'Never'
    };
}

function getStorageUsage() {
    let total = 0;
    Object.values(STORAGE_KEYS).forEach(key => {
        const item = localStorage.getItem(key);
        if (item) {
            total += item.length * 2; // UTF-16 = 2 bytes per char
        }
    });
    return {
        used: total,
        usedMB: (total / (1024 * 1024)).toFixed(2),
        limit: 5 * 1024 * 1024, // ~5MB typical limit
        limitMB: 5
    };
}
