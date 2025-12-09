// Main application entry point for the Chess Mistakes Analyzer

function initializeMainApp() {
    // Show main content, hide setup screen
    const setupScreen = document.getElementById('setup-screen');
    const mainContent = document.getElementById('main-content');
    if (setupScreen) setupScreen.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';

    // Initialize the chess board
    initBoard();

    // Setup event handlers
    setupEventHandlers();

    // Setup config menu
    setupConfigMenu();

    // Load data from localStorage
    loadDataFromStorage();
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    try {
        // Setup the setup screen form handler
        setupSetupScreen();

        // Check if setup is required
        if (checkSetupRequired()) {
            // Setup screen is shown, wait for user to complete setup
            return;
        }

        // Initialize the main app
        initializeMainApp();
    } catch (error) {
        console.error('Initialization error:', error);
        // On any error, show setup screen as fallback and clear corrupted data
        clearAllData();
        const setupScreen = document.getElementById('setup-screen');
        if (setupScreen) setupScreen.style.display = 'flex';
    }
});
