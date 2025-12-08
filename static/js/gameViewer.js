// Game viewer module for the Chess Mistakes Analyzer

function selectSequence(seqData) {
    if (!seqData) return;
    setSelectedSequence(seqData.sequence);
    setSelectedGame(null);
    setCurrentMoveIndex(0);

    // Orient board based on player color
    getBoard().orientation(seqData.player_color);

    // Update table selection
    document.querySelectorAll('#table-body tr').forEach(tr => tr.classList.remove('selected'));
    document.querySelector(`#table-body tr[data-idx="${filteredData.indexOf(seqData)}"]`)?.classList.add('selected');

    // Update detail panel
    document.getElementById('detail-title').textContent = seqData.opening || 'Unknown Opening';
    document.getElementById('games-count').textContent = seqData.games.length;

    // Sort games by date (most recent first)
    const sortedGames = [...seqData.games].sort((a, b) => (b.end_time || 0) - (a.end_time || 0));

    // Render games list
    const container = document.getElementById('games-container');
    container.innerHTML = sortedGames.map((game, idx) => {
        const evalDrop = Math.abs(game.eval_drop);
        const resultClass = game.result === 'Win' ? 'result-win' :
                           game.result === 'Loss' ? 'result-loss' :
                           game.result === 'Draw' ? 'result-draw' : '';
        const whiteName = game.white?.username || 'Unknown';
        const whiteRating = game.white?.rating || '?';
        const blackName = game.black?.username || 'Unknown';
        const blackRating = game.black?.rating || '?';
        const borderClass = game.result === 'Win' ? 'game-win' :
                           game.result === 'Loss' ? 'game-loss' :
                           game.result === 'Draw' ? 'game-draw' : '';
        return `
            <div class="game-item ${borderClass}" data-idx="${idx}">
                <div class="game-left">
                    <div class="game-time-icon">
                        ${getTimeIcon(game.time_class)}
                        <span class="time-control-text">${formatTimeControl(game.time_control)}</span>
                    </div>
                    <div class="game-players">
                        <div class="player-row">
                            <span class="color-icon color-icon-white"></span>
                            <span class="player-name">${escapeHtml(whiteName)}</span>
                            <span class="player-rating">(${whiteRating})</span>
                        </div>
                        <div class="player-row">
                            <span class="color-icon color-icon-black"></span>
                            <span class="player-name">${escapeHtml(blackName)}</span>
                            <span class="player-rating">(${blackRating})</span>
                        </div>
                    </div>
                </div>
                <div class="game-right">
                    ${game.result ? `<span class="game-result ${resultClass}">${game.result}</span>` : ''}
                    <span class="game-date">${formatDate(game.end_time)}</span>
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers to games - open Chess.com link
    container.querySelectorAll('.game-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.idx);
            const game = sortedGames[idx];
            if (game.game_url) {
                window.open(game.game_url, '_blank');
            }
        });
    });

    // Auto-select first game
    if (sortedGames.length > 0) {
        selectGame(sortedGames[0], container.querySelector('.game-item'));
    }

    // Show panel
    document.getElementById('detail-panel').classList.add('open');
    document.getElementById('detail-overlay').classList.add('open');
}

function selectGame(gameData, element) {
    setSelectedGame(gameData);
    setCurrentMoveIndex(0);

    // Update selection
    document.querySelectorAll('.game-item').forEach(el => el.classList.remove('selected'));
    element?.classList.add('selected');

    // Reset board
    getGame().reset();
    getBoard().position('start', false);
    updateMoveDisplay();
}

function closeDetail() {
    document.getElementById('detail-panel').classList.remove('open');
    document.getElementById('detail-overlay').classList.remove('open');
    setSelectedSequence(null);
    document.querySelectorAll('#table-body tr').forEach(tr => tr.classList.remove('selected'));
}
