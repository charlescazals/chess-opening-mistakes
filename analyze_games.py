#!/usr/bin/env python3
"""Analyze Chess.com games with Stockfish to detect opening mistakes."""

import json
import sys
from pathlib import Path

import chess
import chess.engine
import chess.pgn
import io

DATA_DIR = Path(__file__).parent / "data"
GAMES_FILE = DATA_DIR / "games.json"
PROGRESS_FILE = DATA_DIR / "analysis_progress.json"
MISTAKES_FILE = DATA_DIR / "mistakes.json"

# Analysis parameters
ANALYSIS_DEPTH = 15
MOVES_TO_ANALYZE = 14  # First 14 half-moves (7 per player)
MISTAKE_THRESHOLD = 100  # Centipawns (1 pawn)

# Stockfish path - try common locations
STOCKFISH_PATHS = [
    "stockfish",  # System PATH
    "/usr/local/bin/stockfish",  # Homebrew (Intel Mac)
    "/opt/homebrew/bin/stockfish",  # Homebrew (Apple Silicon)
    "/usr/bin/stockfish",  # Linux
    "C:/Program Files/Stockfish/stockfish.exe",  # Windows
]


def extract_result_from_pgn(pgn: str) -> str:
    """Extract the Result from PGN header."""
    for line in pgn.split("\n"):
        if line.startswith('[Result "'):
            try:
                return line.split('"')[1]
            except IndexError:
                pass
    return ""


def get_player_result(pgn_result: str, player_color: str) -> str:
    """Convert PGN result to Win/Draw/Loss based on player color."""
    if pgn_result == "1-0":
        return "Win" if player_color == "white" else "Loss"
    elif pgn_result == "0-1":
        return "Loss" if player_color == "white" else "Win"
    elif pgn_result == "1/2-1/2":
        return "Draw"
    return ""


def find_stockfish() -> str:
    """Find Stockfish binary."""
    import shutil

    for path in STOCKFISH_PATHS:
        if shutil.which(path):
            return path

    raise FileNotFoundError(
        "Stockfish not found. Please install it:\n"
        "  macOS: brew install stockfish\n"
        "  Linux: sudo apt install stockfish\n"
        "  Windows: Download from https://stockfishchess.org/download/"
    )


def load_progress() -> set:
    """Load set of processed game URLs from file."""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            data = json.load(f)
            # Handle both old format (dict) and new format (list)
            if isinstance(data, dict):
                return set(data.get("processed_urls", []))
            return set(data)
    return set()


def save_progress(processed_urls: set):
    """Save set of processed game URLs to file."""
    with open(PROGRESS_FILE, "w") as f:
        json.dump(list(processed_urls), f, indent=2)


def save_mistakes(mistakes: list):
    """Save detected mistakes to file."""
    with open(MISTAKES_FILE, "w") as f:
        json.dump(mistakes, f, indent=2)


def parse_pgn(pgn_string: str) -> chess.pgn.Game | None:
    """Parse PGN string into a game object."""
    try:
        return chess.pgn.read_game(io.StringIO(pgn_string))
    except Exception:
        return None


def get_evaluation(
    engine: chess.engine.SimpleEngine, board: chess.Board
) -> tuple[int | None, str | None]:
    """Get position evaluation in centipawns from White's perspective and best move."""
    try:
        info = engine.analyse(board, chess.engine.Limit(depth=ANALYSIS_DEPTH))
        score = info.get("score")

        if score is None:
            return None, None

        # Get score from White's perspective
        pov_score = score.white()

        if pov_score.is_mate():
            # Return large value for mate
            mate_in = pov_score.mate()
            if mate_in > 0:
                eval_score = 10000 - mate_in * 100
            else:
                eval_score = -10000 - mate_in * 100
        else:
            eval_score = pov_score.score()

        # Get best move from principal variation
        best_move = None
        pv = info.get("pv", [])
        if pv:
            best_move = board.san(pv[0])

        return eval_score, best_move

    except Exception:
        return None, None


def analyze_game(
    engine: chess.engine.SimpleEngine, game_data: dict
) -> list[dict] | None:
    """
    Analyze a game and return any mistakes found.

    A mistake is when the player's move drops evaluation by >= MISTAKE_THRESHOLD.
    """
    pgn = game_data.get("pgn", "")
    game = parse_pgn(pgn)

    if game is None:
        return None

    player_color = game_data.get("player_color", "white")
    is_white = player_color == "white"

    # Player moves are at even indices (0, 2, 4, ...) for white, odd (1, 3, 5, ...) for black
    player_move_indices = (
        range(0, MOVES_TO_ANALYZE, 2) if is_white else range(1, MOVES_TO_ANALYZE, 2)
    )

    board = game.board()
    moves = list(game.mainline_moves())

    if len(moves) < MOVES_TO_ANALYZE:
        # Game too short
        return None

    mistakes = []
    evaluations = []

    # Get initial evaluation
    prev_eval, _ = get_evaluation(engine, board)
    evaluations.append({"move": 0, "eval": prev_eval})

    # Analyze first N moves
    move_sequence = []

    for i, move in enumerate(moves[:MOVES_TO_ANALYZE]):
        san = board.san(move)
        move_sequence.append(san)

        # For player moves, capture the best move BEFORE pushing
        best_move_before = None
        if i in player_move_indices:
            _, best_move_before = get_evaluation(engine, board)

        board.push(move)

        current_eval, _ = get_evaluation(engine, board)
        evaluations.append({"move": i + 1, "eval": current_eval})

        # Check if this was a player move and if it was a mistake
        if (
            i in player_move_indices
            and prev_eval is not None
            and current_eval is not None
        ):
            # Calculate evaluation change from player's perspective
            if is_white:
                eval_change = current_eval - prev_eval
            else:
                eval_change = prev_eval - current_eval  # Flip for black

            if eval_change <= -MISTAKE_THRESHOLD:
                # Get game result from player's perspective
                pgn = game_data.get("pgn", "")
                pgn_result = extract_result_from_pgn(pgn)
                result = get_player_result(pgn_result, player_color)

                mistake = {
                    "move_number": (i // 2) + 1,
                    "move": san,
                    "best_move": best_move_before,
                    "move_sequence": move_sequence.copy(),
                    "eval_before": prev_eval,
                    "eval_after": current_eval,
                    "eval_drop": eval_change,
                    "opening": game_data.get("opening", ""),
                    "eco": game_data.get("eco", ""),
                    "player_color": player_color,
                    "game_url": game_data.get("url", ""),
                    "time_class": game_data.get("time_class", ""),
                    "time_control": game_data.get("time_control", ""),
                    "end_time": game_data.get("end_time", 0),
                    "fen": board.fen(),
                    "result": result,
                    "white": game_data.get("white", {}),
                    "black": game_data.get("black", {}),
                }
                mistakes.append(mistake)

        prev_eval = current_eval

    return mistakes


def main():
    # Load games
    if not GAMES_FILE.exists():
        print(f"Error: {GAMES_FILE} not found. Run fetch_games.py first.")
        sys.exit(1)

    with open(GAMES_FILE) as f:
        games = json.load(f)

    print(f"Loaded {len(games)} games")

    # Load progress
    processed_urls = load_progress()
    all_mistakes = []

    # Load existing mistakes if resuming
    if MISTAKES_FILE.exists() and processed_urls:
        with open(MISTAKES_FILE) as f:
            all_mistakes = json.load(f)

    print(f"Already processed: {len(processed_urls)} games")
    print(f"Mistakes found so far: {len(all_mistakes)}")

    # Find Stockfish
    stockfish_path = find_stockfish()
    print(f"Using Stockfish: {stockfish_path}")

    # Filter games not yet processed
    games_to_process = [g for g in games if g.get("url") not in processed_urls]
    print(f"Games to process: {len(games_to_process)}")

    if not games_to_process:
        print("All games already processed!")
        save_mistakes(all_mistakes)
        return

    # Start engine
    try:
        engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)
    except Exception as e:
        print(f"Error starting Stockfish: {e}")
        sys.exit(1)

    try:
        for i, game_data in enumerate(games_to_process):
            game_url = game_data.get("url", f"game_{i}")
            opening = game_data.get("opening", "Unknown")[:40]
            color = game_data.get("player_color", "?")

            print(
                f"\r[{i + 1}/{len(games_to_process)}] Analyzing: {opening}... ({color})",
                end="",
                flush=True,
            )

            try:
                mistakes = analyze_game(engine, game_data)

                if mistakes:
                    all_mistakes.extend(mistakes)
                    print(f" -> {len(mistakes)} mistake(s) found!")
                else:
                    print(" -> OK")

            except Exception as e:
                print(f" -> Error: {e}")

            # Update progress
            processed_urls.add(game_url)

            # Save progress every 10 games
            if (i + 1) % 10 == 0:
                save_progress(processed_urls)
                save_mistakes(all_mistakes)

    except KeyboardInterrupt:
        print("\n\nInterrupted! Saving progress...")

    finally:
        engine.quit()
        save_progress(processed_urls)
        save_mistakes(all_mistakes)

    print(f"\n\nAnalysis complete!")
    print(f"Total games processed: {len(processed_urls)}")
    print(f"Total mistakes found: {len(all_mistakes)}")
    print(f"Results saved to {MISTAKES_FILE}")


if __name__ == "__main__":
    main()
