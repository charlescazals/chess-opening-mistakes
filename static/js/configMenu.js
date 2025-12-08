// Config Menu - settings and data management

let configMenuOpen = false;

function toggleConfigMenu() {
    const menu = document.getElementById('config-menu');
    if (!menu) return;

    configMenuOpen = !configMenuOpen;

    if (configMenuOpen) {
        updateConfigMenuStats();
        menu.classList.add('open');
    } else {
        menu.classList.remove('open');
    }
}

function closeConfigMenu() {
    const menu = document.getElementById('config-menu');
    if (menu) {
        menu.classList.remove('open');
        configMenuOpen = false;
    }
}

function updateConfigMenuStats() {
    const stats = getDataStats();

    const usernameEl = document.getElementById('config-username');
    const gamesEl = document.getElementById('config-games');
    const mistakesEl = document.getElementById('config-mistakes');
    const lastFetchEl = document.getElementById('config-last-fetch');
    const lastAnalysisEl = document.getElementById('config-last-analysis');

    if (usernameEl) usernameEl.textContent = stats.username || 'Not set';
    if (gamesEl) gamesEl.textContent = stats.gameCount;
    if (mistakesEl) mistakesEl.textContent = stats.mistakeCount;
    if (lastFetchEl) lastFetchEl.textContent = stats.lastFetch;
    if (lastAnalysisEl) lastAnalysisEl.textContent = stats.lastAnalysis;
}

async function handleRefreshGames() {
    const username = getUsername();
    if (!username) {
        alert('No username set. Please set up your account first.');
        return;
    }

    if (!confirm('This will fetch your latest games and re-analyze them. Continue?')) {
        return;
    }

    closeConfigMenu();

    try {
        // Fetch new games
        await runWithProgress('Fetching Games', async (onProgress) => {
            return await fetchAllGames(username, onProgress);
        });

        // Analyze new games (only unprocessed ones)
        await runWithProgress('Analyzing Games', async (onProgress) => {
            return await analyzeAllGames(onProgress);
        });

        // Reload the data in the UI
        loadDataFromStorage();
        applyFilters();

    } catch (error) {
        console.error('Refresh error:', error);
        alert('Error refreshing games: ' + error.message);
    }
}

async function handleChangeUsername() {
    const currentUsername = getUsername();
    const newUsername = prompt('Enter new Chess.com username:', currentUsername || '');

    if (!newUsername || newUsername.trim() === '') {
        return;
    }

    if (newUsername.toLowerCase() === currentUsername?.toLowerCase()) {
        return;
    }

    if (!confirm(`Change username to "${newUsername}"? This will clear all existing data and fetch games for the new user.`)) {
        return;
    }

    closeConfigMenu();

    // Clear all existing data
    clearAllData();

    try {
        // Save new username
        setUsername(newUsername.trim());

        // Fetch games for new user
        await runWithProgress('Fetching Games', async (onProgress) => {
            return await fetchAllGames(newUsername.trim(), onProgress);
        });

        const games = getGames();
        if (games.length === 0) {
            alert('No valid games found for this user.');
            clearAllData();
            showSetupScreen();
            return;
        }

        // Analyze games
        await runWithProgress('Analyzing Games', async (onProgress) => {
            return await analyzeAllGames(onProgress);
        });

        // Reload the data in the UI
        loadDataFromStorage();
        applyFilters();

    } catch (error) {
        console.error('Change username error:', error);
        alert('Error: ' + error.message);
        clearAllData();
        showSetupScreen();
    }
}

function handleClearData() {
    if (!confirm('Are you sure you want to clear all data? This cannot be undone.')) {
        return;
    }

    clearAllData();
    closeConfigMenu();
    showSetupScreen();
}

function setupConfigMenu() {
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('config-menu');
        const btn = document.getElementById('config-btn');

        if (configMenuOpen && menu && btn) {
            if (!menu.contains(e.target) && !btn.contains(e.target)) {
                closeConfigMenu();
            }
        }
    });
}
