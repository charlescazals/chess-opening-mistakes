// Table rendering module for the Chess Mistakes Analyzer

let selectedSequence = null;

function renderTable() {
    const tbody = document.getElementById('table-body');

    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="no-results">No results found</td></tr>';
        return;
    }

    tbody.innerHTML = filteredData.map((row, idx) => {
        const impactValue = Math.abs(row.avg_eval_drop) / 100;
        const impactClass = getImpactClass(row.avg_eval_drop);
        return `
        <tr data-idx="${idx}" class="${selectedSequence === row.sequence ? 'selected' : ''}">
            <td class="sequence-cell">${escapeHtml(row.sequence)}</td>
            <td><span class="occurrences-value">${row.occurrences}</span></td>
            <td><span class="impact-badge ${impactClass}">-${impactValue.toFixed(1)}</span></td>
            <td>${row.move_count}</td>
            <td>${escapeHtml(row.opening)}</td>
            <td><span class="color-badge color-${row.player_color}">${row.player_color === 'white' ? 'W' : 'B'}</span></td>
        </tr>
    `}).join('');

    // Add click handlers
    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
            const idx = parseInt(tr.dataset.idx);
            selectSequence(filteredData[idx]);
        });
    });
}

function setSelectedSequence(sequence) {
    selectedSequence = sequence;
}

function getSelectedSequence() {
    return selectedSequence;
}
