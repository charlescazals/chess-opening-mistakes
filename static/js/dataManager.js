// Data management module for the Chess Mistakes Analyzer

let allData = [];
let filteredData = [];
let currentSort = { field: 'occurrences', direction: 'desc' };

function groupMistakesBySequence(mistakes) {
    // Group mistakes by move sequence (replicates Flask /api/mistakes/by-sequence logic)
    const bySequence = {};

    for (const mistake of mistakes) {
        const seq = (mistake.move_sequence || []).join(' ');
        if (!bySequence[seq]) {
            bySequence[seq] = {
                sequence: seq,
                move_count: (mistake.move_sequence || []).length,
                opening: mistake.opening || 'Unknown',
                player_color: mistake.player_color || 'unknown',
                games: []
            };
        }

        bySequence[seq].games.push({
            game_url: mistake.game_url || '',
            time_class: mistake.time_class || '',
            time_control: mistake.time_control || '',
            end_time: mistake.end_time || 0,
            eval_before: mistake.eval_before || 0,
            eval_after: mistake.eval_after || 0,
            eval_drop: mistake.eval_drop || 0,
            fen: mistake.fen || '',
            move_sequence: mistake.move_sequence || [],
            best_move: mistake.best_move || '',
            result: mistake.result || '',
            white: mistake.white || {},
            black: mistake.black || {}
        });
    }

    // Add occurrence count and average eval drop
    for (const seqData of Object.values(bySequence)) {
        seqData.occurrences = seqData.games.length;
        const totalDrop = seqData.games.reduce((sum, g) => sum + g.eval_drop, 0);
        seqData.avg_eval_drop = seqData.games.length > 0 ? totalDrop / seqData.games.length : 0;
    }

    // Sort by occurrences descending
    return Object.values(bySequence).sort((a, b) => b.occurrences - a.occurrences);
}

function loadDataFromStorage() {
    const mistakes = getMistakes();

    if (mistakes.length === 0) {
        document.getElementById('table-body').innerHTML =
            '<tr><td colspan="6" class="no-results">No mistakes found. Set up your account to get started.</td></tr>';
        return;
    }

    allData = groupMistakesBySequence(mistakes);
    filteredData = [...allData];
    updateStats();
    applyFilters();
}

function loadData() {
    // Legacy function - now loads from localStorage
    loadDataFromStorage();
}

function updateStats() {
    const totalGames = filteredData.reduce((sum, s) => sum + s.occurrences, 0);
    document.getElementById('total-games').textContent = totalGames;
}

function applyFilters() {
    const seqFilter = document.getElementById('filter-seq')?.value.toLowerCase() || '';
    const openingFilter = document.getElementById('filter-opening')?.value.toLowerCase() || '';
    const colorFilter = document.getElementById('filter-color')?.value || '';
    const minOcc = parseInt(document.getElementById('filter-min-occ')?.value) || 0;
    const maxMoves = parseInt(document.getElementById('filter-max-moves')?.value) || Infinity;
    const impactFilter = document.getElementById('filter-impact')?.value || '';
    const opponentFilter = document.getElementById('filter-opponent')?.value.toLowerCase() || '';

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
        const icon = th.querySelector('.sort-icon');
        if (icon) icon.textContent = '↕';
    });
    const th = document.querySelector(`th[data-sort="${field}"]`);
    if (th) {
        th.classList.add('sorted');
        const icon = th.querySelector('.sort-icon');
        if (icon) icon.textContent = currentSort.direction === 'asc' ? '↑' : '↓';
    }

    applySort();
    renderTable();
}

function getFilteredData() {
    return filteredData;
}
