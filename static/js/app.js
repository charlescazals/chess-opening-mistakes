// Main application entry point for the Chess Mistakes Analyzer

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize the chess board
    initBoard();

    // Setup event handlers
    setupEventHandlers();

    // Load data from API
    loadData();
});
