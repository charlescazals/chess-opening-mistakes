// Data management module for the Chess Mistakes Analyzer

let allData = [];
let filteredData = [];
let currentSort = { field: 'occurrences', direction: 'desc' };

function loadData() {
    return fetch('/api/mistakes/by-sequence')
        .then(res => res.json())
        .then(data => {
            allData = data;
            filteredData = [...data];
            updateStats();
            applyFilters();
        })
        .catch(err => {
            document.getElementById('table-body').innerHTML =
                '<tr><td colspan="5" class="loading">Error loading data. Run analyze_games.py first.</td></tr>';
        });
}

function updateStats() {
    const totalGames = filteredData.reduce((sum, s) => sum + s.occurrences, 0);
    document.getElementById('total-games').textContent = totalGames;
}

function applyFilters() {
    const seqFilter = document.getElementById('filter-seq').value.toLowerCase();
    const openingFilter = document.getElementById('filter-opening').value.toLowerCase();
    const colorFilter = document.getElementById('filter-color').value;
    const minOcc = parseInt(document.getElementById('filter-min-occ').value) || 0;
    const maxMoves = parseInt(document.getElementById('filter-max-moves').value) || Infinity;
    const impactFilter = document.getElementById('filter-impact').value;
    const opponentFilter = document.getElementById('filter-opponent').value.toLowerCase();

    filteredData = allData.filter(row => {
        if (seqFilter && !row.sequence.toLowerCase().includes(seqFilter)) return false;
        if (openingFilter && !row.opening.toLowerCase().includes(openingFilter)) return false;
        if (colorFilter && row.player_color !== colorFilter) return false;
        if (row.occurrences < minOcc) return false;
        if (row.move_count > maxMoves) return false;
        if (impactFilter && getImpactCategory(row.avg_eval_drop) !== impactFilter) return false;
        if (opponentFilter) {
            // Check if any game has an opponent matching the filter
            const hasMatchingOpponent = row.games.some(game => {
                const opponent = row.player_color === 'white'
                    ? game.black?.username
                    : game.white?.username;
                return opponent && opponent.toLowerCase().includes(opponentFilter);
            });
            if (!hasMatchingOpponent) return false;
        }
        return true;
    });

    applySort();
    renderTable();
    updateStats();
}

function applySort() {
    const { field, direction } = currentSort;
    filteredData.sort((a, b) => {
        let valA = a[field];
        let valB = b[field];

        if (typeof valA === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });
}

function handleSort(field) {
    if (currentSort.field === field) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.field = field;
        currentSort.direction = 'desc';
    }

    // Update header icons
    document.querySelectorAll('th').forEach(th => {
        th.classList.remove('sorted');
        th.querySelector('.sort-icon').textContent = '↕';
    });
    const th = document.querySelector(`th[data-sort="${field}"]`);
    th.classList.add('sorted');
    th.querySelector('.sort-icon').textContent = currentSort.direction === 'asc' ? '↑' : '↓';

    applySort();
    renderTable();
}

function getFilteredData() {
    return filteredData;
}
