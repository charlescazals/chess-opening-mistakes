// Setup Screen - handles initial setup when no data exists

let fetchedGamesForSelection = [];

function showSetupScreen() {
    const setupScreen = document.getElementById('setup-screen');
    const dateSelectionScreen = document.getElementById('date-selection-screen');
    const mainContent = document.getElementById('main-content');

    if (setupScreen) setupScreen.style.display = 'flex';
    if (dateSelectionScreen) dateSelectionScreen.style.display = 'none';
    if (mainContent) mainContent.style.display = 'none';
}

function hideSetupScreen() {
    const setupScreen = document.getElementById('setup-screen');
    const dateSelectionScreen = document.getElementById('date-selection-screen');
    const mainContent = document.getElementById('main-content');

    if (setupScreen) setupScreen.style.display = 'none';
    if (dateSelectionScreen) dateSelectionScreen.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';
}

function showDateSelectionScreen(games) {
    const setupScreen = document.getElementById('setup-screen');
    const dateSelectionScreen = document.getElementById('date-selection-screen');
    const mainContent = document.getElementById('main-content');

    if (setupScreen) setupScreen.style.display = 'none';
    if (dateSelectionScreen) dateSelectionScreen.style.display = 'flex';
    if (mainContent) mainContent.style.display = 'none';

    fetchedGamesForSelection = games;
    initializeDateSelection(games);
}

function hideDateSelectionScreen() {
    const dateSelectionScreen = document.getElementById('date-selection-screen');
    if (dateSelectionScreen) dateSelectionScreen.style.display = 'none';
}

function getGameDate(game) {
    // Games have end_time as Unix timestamp (seconds)
    return new Date(game.end_time * 1000);
}

function formatDate(date) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

function getYearsAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    return diffMs / (365.25 * 24 * 60 * 60 * 1000);
}

function formatYearsLabel(years) {
    if (years === 0.5) return '6 months';
    if (years === 1) return '1 year';
    if (years === 1.5) return '1.5 years';
    return `${years} years`;
}

function initializeDateSelection(games) {
    if (games.length === 0) return;

    // Find oldest and newest game dates
    const sortedGames = [...games].sort((a, b) => a.end_time - b.end_time);
    const oldestGame = sortedGames[0];
    const newestGame = sortedGames[sortedGames.length - 1];

    const oldestDate = getGameDate(oldestGame);
    const newestDate = getGameDate(newestGame);

    // Calculate how many years back the oldest game is (round to nearest 0.5)
    const oldestYearsAgo = Math.min(5, Math.ceil(getYearsAgo(oldestDate) * 2) / 2);
    const maxYears = Math.max(0.5, oldestYearsAgo);

    // Update UI elements
    document.getElementById('total-games-found').textContent = games.length;
    document.getElementById('games-date-range').textContent =
        `(${formatDate(oldestDate)} - ${formatDate(newestDate)})`;

    // Configure slider
    const slider = document.getElementById('date-range-slider');
    slider.min = 0.5;
    slider.max = maxYears;
    slider.value = 1; // Default to 1 year

    // Update max label
    const maxLabel = document.getElementById('slider-max-label');
    maxLabel.textContent = formatYearsLabel(maxYears);

    // Initial update
    updateSelectionDisplay(1, games);

    // Add slider event listener
    slider.oninput = function() {
        updateSelectionDisplay(parseFloat(this.value), games);
    };
}

function updateSelectionDisplay(yearsBack, games) {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (yearsBack * 365.25 * 24 * 60 * 60 * 1000));

    // Count games within range
    const gamesInRange = games.filter(game => getGameDate(game) >= cutoffDate);
    const count = gamesInRange.length;

    // Update display
    const rangeText = `Last ${formatYearsLabel(yearsBack)}`;
    document.getElementById('selected-range-display').textContent = rangeText;
    document.getElementById('selected-games-count').textContent = `${count} games to analyze`;
    document.getElementById('analyze-count').textContent = count;
}

function getSelectedGames() {
    const slider = document.getElementById('date-range-slider');
    const yearsBack = parseFloat(slider.value);

    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (yearsBack * 365.25 * 24 * 60 * 60 * 1000));

    return fetchedGamesForSelection.filter(game => getGameDate(game) >= cutoffDate);
}

function setupSetupScreen() {
    const form = document.getElementById('setup-form');
    const usernameInput = document.getElementById('setup-username');
    const errorDiv = document.getElementById('setup-error');
    const analyzeBtn = document.getElementById('analyze-btn');

    if (!form) return;

    // Handle initial username submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = usernameInput.value.trim();
        if (!username) {
            showSetupError('Please enter a Chess.com username');
            return;
        }

        // Clear any previous error
        hideSetupError();

        try {
            // Save username
            setUsername(username);

            // First, check if we have existing data in the cloud for this user
            let existingData = null;
            await runWithProgress('Checking for existing data', async (onProgress) => {
                onProgress({ stage: 'init', message: 'Checking for existing analysis...' });
                existingData = await fetchUserData(username);
                if (existingData) {
                    onProgress({ stage: 'complete', message: 'Found existing data!' });
                } else {
                    onProgress({ stage: 'complete', message: 'No existing data found' });
                }
            });

            if (existingData && existingData.mistakes && existingData.games) {
                // Load existing data from cloud into localStorage
                setGames(existingData.games);
                setMistakes(existingData.mistakes);

                // Mark all games as analyzed
                for (const game of existingData.games) {
                    if (game.url) {
                        addToAnalysisProgress(game.url);
                    }
                }

                console.log(`Loaded ${existingData.gamesCount} games and ${existingData.mistakesCount} mistakes from cloud`);

                // Hide setup and show main content
                hideSetupScreen();

                // Initialize the main app
                initializeMainApp();
                return;
            }

            // No existing data - fetch games
            let fetchedGames = [];
            await runWithProgress('Fetching Games', async (onProgress) => {
                fetchedGames = await fetchAllGames(username, onProgress);
                return fetchedGames;
            });

            if (fetchedGames.length === 0) {
                showSetupError('No valid games found. Make sure the username is correct and has played blitz/rapid games.');
                return;
            }

            // Show date selection screen instead of immediately analyzing
            showDateSelectionScreen(fetchedGames);

        } catch (error) {
            console.error('Setup error:', error);
            showSetupError(error.message || 'An error occurred during setup');
        }
    });

    // Handle analyze button click (from date selection screen)
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', async () => {
            try {
                const username = getUsername();
                const selectedGames = getSelectedGames();

                if (selectedGames.length === 0) {
                    return;
                }

                // Save filtered games to localStorage
                setGames(selectedGames);

                // Hide date selection screen and show progress
                hideDateSelectionScreen();

                // Analyze games
                await runWithProgress('Analyzing Games', async (onProgress) => {
                    return await analyzeAllGames(onProgress);
                });

                // Save data to cloud for future sessions
                const mistakes = getMistakes();
                await saveUserDataToCloud(username, mistakes, selectedGames);

                // Show main content
                hideSetupScreen();

                // Initialize the main app
                initializeMainApp();

            } catch (error) {
                console.error('Analysis error:', error);
                showSetupError(error.message || 'An error occurred during analysis');
                showSetupScreen();
            }
        });
    }
}

function showSetupError(message) {
    const errorDiv = document.getElementById('setup-error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

function hideSetupError() {
    const errorDiv = document.getElementById('setup-error');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
}

function checkSetupRequired() {
    // Check if we have data
    if (!hasData()) {
        showSetupScreen();
        return true;
    }
    return false;
}
