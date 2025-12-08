// Main application entry point for the Chess Mistakes Analyzer

function initializeMainApp() {
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
    // Setup the setup screen form handler
    setupSetupScreen();

    // Check if setup is required
    if (checkSetupRequired()) {
        // Setup screen is shown, wait for user to complete setup
        return;
    }

    // Initialize the main app
    initializeMainApp();
});
