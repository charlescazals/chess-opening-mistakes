// Event handlers module for the Chess Mistakes Analyzer

function setupEventHandlers() {
    // Table header sort click handlers
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => handleSort(th.dataset.sort));
    });

    // Filter input event listeners
    document.getElementById('filter-seq').addEventListener('input', applyFilters);
    document.getElementById('filter-opening').addEventListener('input', applyFilters);
    document.getElementById('filter-color').addEventListener('change', applyFilters);
    document.getElementById('filter-min-occ').addEventListener('input', applyFilters);
    document.getElementById('filter-max-moves').addEventListener('input', applyFilters);
    document.getElementById('filter-impact').addEventListener('change', applyFilters);
    document.getElementById('filter-opponent').addEventListener('input', applyFilters);

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') prevMove();
        else if (e.key === 'ArrowRight') nextMove();
        else if (e.key === 'Home') goToStart();
        else if (e.key === 'End') goToEnd();
        else if (e.key === 'Escape') closeDetail();
    });

    // Close panel when clicking outside of it and the table
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('detail-panel');
        const tableContainer = document.querySelector('.table-container');
        if (panel.classList.contains('open') &&
            !panel.contains(e.target) &&
            !tableContainer.contains(e.target)) {
            closeDetail();
        }
    });
}
