// Board controller module for the Chess Mistakes Analyzer

let board = null;
let game = null;
let currentMoveIndex = 0;
let selectedGame = null;

function initBoard() {
    game = new Chess();
    board = Chessboard('board', {
        position: 'start',
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    });
}

function getBoard() {
    return board;
}

function getGame() {
    return game;
}

function setSelectedGame(gameData) {
    selectedGame = gameData;
}

function getSelectedGame() {
    return selectedGame;
}

function getCurrentMoveIndex() {
    return currentMoveIndex;
}

function setCurrentMoveIndex(idx) {
    currentMoveIndex = idx;
}

function updateMoveDisplay() {
    if (!selectedGame) return;

    const moves = selectedGame.move_sequence;
    const mistakeIdx = moves.length - 1;

    let html = '';
    for (let i = 0; i < moves.length; i++) {
        const isWhite = i % 2 === 0;
        const moveNum = Math.floor(i / 2) + 1;

        if (isWhite) {
            html += `<strong>${moveNum}.</strong> `;
        }

        let classes = [];
        if (i === currentMoveIndex - 1) classes.push('current');
        if (i === mistakeIdx) classes.push('mistake');

        html += `<span class="${classes.join(' ')}">${moves[i]}</span> `;
    }

    document.getElementById('move-display').innerHTML = html;

    // Enable Best Move button at the position before the mistake OR after it
    const bestMoveBtn = document.getElementById('best-move-btn');
    const enableBestMoveBtn = currentMoveIndex === mistakeIdx || currentMoveIndex === moves.length;
    bestMoveBtn.disabled = !enableBestMoveBtn;

    // Clear highlights when navigating
    clearHighlights();

    // Highlight mistake move when at end position
    if (currentMoveIndex === moves.length) {
        highlightMistakeMove();
    }
}

function highlightMistakeMove() {
    if (!selectedGame) return;

    const moves = selectedGame.move_sequence;
    const mistakeMove = moves[moves.length - 1];

    // We need to get the from/to squares of the last move
    // Create a temp game, play up to the move before mistake, then get move info
    const tempGame = new Chess();
    for (let i = 0; i < moves.length - 1; i++) {
        tempGame.move(moves[i]);
    }
    const moveObj = tempGame.move(mistakeMove);

    if (moveObj) {
        const fromSquare = document.querySelector(`.square-${moveObj.from}`);
        const toSquare = document.querySelector(`.square-${moveObj.to}`);

        if (fromSquare) fromSquare.classList.add('highlight-mistake');
        if (toSquare) toSquare.classList.add('highlight-mistake');
    }
}

function goToStart() {
    if (!selectedGame) return;
    game.reset();
    currentMoveIndex = 0;
    board.position('start', false);
    updateMoveDisplay();
}

function goToEnd() {
    if (!selectedGame) return;
    game.reset();
    const moves = selectedGame.move_sequence;
    for (let i = 0; i < moves.length; i++) {
        game.move(moves[i]);
    }
    currentMoveIndex = moves.length;
    board.position(game.fen(), false);
    updateMoveDisplay();
}

function nextMove() {
    if (!selectedGame) return;
    const moves = selectedGame.move_sequence;
    if (currentMoveIndex >= moves.length) return;

    game.move(moves[currentMoveIndex]);
    currentMoveIndex++;
    board.position(game.fen(), false);
    updateMoveDisplay();
}

function prevMove() {
    if (!selectedGame) return;
    if (currentMoveIndex <= 0) return;

    game.undo();
    currentMoveIndex--;
    board.position(game.fen(), false);
    updateMoveDisplay();
    clearHighlights();
}

function showBestMove() {
    if (!selectedGame) return;

    const moves = selectedGame.move_sequence;

    // If we're at the end (after mistake), go back one move first
    if (currentMoveIndex === moves.length) {
        game.undo();
        currentMoveIndex--;
        board.position(game.fen(), false);
        updateMoveDisplay();
    }

    // Clear previous highlights
    clearHighlights();

    // Parse the best move to get from/to squares
    const tempGame = new Chess(game.fen());
    const moveObj = tempGame.move(selectedGame.best_move);

    if (moveObj) {
        // Highlight the from and to squares
        const fromSquare = document.querySelector(`.square-${moveObj.from}`);
        const toSquare = document.querySelector(`.square-${moveObj.to}`);

        if (fromSquare) fromSquare.classList.add('highlight-best');
        if (toSquare) toSquare.classList.add('highlight-best');
    }
}

function clearHighlights() {
    document.querySelectorAll('.highlight-best').forEach(el => {
        el.classList.remove('highlight-best');
    });
    document.querySelectorAll('.highlight-mistake').forEach(el => {
        el.classList.remove('highlight-mistake');
    });
}
