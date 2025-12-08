// Setup Screen - handles initial setup when no data exists

function showSetupScreen() {
    const setupScreen = document.getElementById('setup-screen');
    const mainContent = document.getElementById('main-content');

    if (setupScreen) setupScreen.style.display = 'flex';
    if (mainContent) mainContent.style.display = 'none';
}

function hideSetupScreen() {
    const setupScreen = document.getElementById('setup-screen');
    const mainContent = document.getElementById('main-content');

    if (setupScreen) setupScreen.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';
}

function setupSetupScreen() {
    const form = document.getElementById('setup-form');
    const usernameInput = document.getElementById('setup-username');
    const errorDiv = document.getElementById('setup-error');

    if (!form) return;

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

            // Fetch games
            await runWithProgress('Fetching Games', async (onProgress) => {
                return await fetchAllGames(username, onProgress);
            });

            const games = getGames();
            if (games.length === 0) {
                showSetupError('No valid games found. Make sure the username is correct and has played blitz/rapid games.');
                return;
            }

            // Analyze games
            await runWithProgress('Analyzing Games', async (onProgress) => {
                return await analyzeAllGames(onProgress);
            });

            // Hide setup and show main content
            hideSetupScreen();

            // Initialize the main app
            initializeMainApp();

        } catch (error) {
            console.error('Setup error:', error);
            showSetupError(error.message || 'An error occurred during setup');
        }
    });
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
