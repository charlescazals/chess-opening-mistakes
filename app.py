#!/usr/bin/env python3
"""Flask web application for visualizing chess opening mistakes."""

import json
from pathlib import Path

from flask import Flask, jsonify, render_template

app = Flask(__name__)

DATA_DIR = Path(__file__).parent / "data"
MISTAKES_FILE = DATA_DIR / "mistakes.json"
STATISTICS_FILE = DATA_DIR / "statistics.json"


def load_mistakes() -> list[dict]:
    """Load mistakes from file."""
    if MISTAKES_FILE.exists():
        with open(MISTAKES_FILE) as f:
            return json.load(f)
    return []


def load_statistics() -> dict:
    """Load statistics from file."""
    if STATISTICS_FILE.exists():
        with open(STATISTICS_FILE) as f:
            return json.load(f)
    return {}


@app.route("/")
def index():
    """Render the main page."""
    return render_template("index.html")


@app.route("/api/mistakes")
def api_mistakes():
    """Get all mistakes."""
    mistakes = load_mistakes()
    return jsonify(mistakes)


@app.route("/api/statistics")
def api_statistics():
    """Get statistics."""
    stats = load_statistics()
    return jsonify(stats)


@app.route("/api/mistakes/by-opening")
def api_mistakes_by_opening():
    """Get mistakes grouped by opening."""
    mistakes = load_mistakes()

    by_opening = {}
    for mistake in mistakes:
        opening = mistake.get("opening", "Unknown") or "Unknown"
        if opening not in by_opening:
            by_opening[opening] = []
        by_opening[opening].append(mistake)

    # Sort by count
    sorted_openings = sorted(by_opening.items(), key=lambda x: len(x[1]), reverse=True)

    return jsonify([{"opening": k, "count": len(v), "mistakes": v} for k, v in sorted_openings])


@app.route("/api/mistakes/by-sequence")
def api_mistakes_by_sequence():
    """Get mistakes grouped by move sequence."""
    mistakes = load_mistakes()

    by_sequence = {}
    for mistake in mistakes:
        seq = " ".join(mistake.get("move_sequence", []))
        if seq not in by_sequence:
            by_sequence[seq] = {
                "sequence": seq,
                "move_count": len(mistake.get("move_sequence", [])),
                "opening": mistake.get("opening", "Unknown") or "Unknown",
                "player_color": mistake.get("player_color", "unknown"),
                "games": [],
            }

        # All data is now stored directly in mistakes.json
        by_sequence[seq]["games"].append({
            "game_url": mistake.get("game_url", ""),
            "time_class": mistake.get("time_class", ""),
            "time_control": mistake.get("time_control", ""),
            "end_time": mistake.get("end_time", 0),
            "eval_before": mistake.get("eval_before", 0),
            "eval_after": mistake.get("eval_after", 0),
            "eval_drop": mistake.get("eval_drop", 0),
            "fen": mistake.get("fen", ""),
            "move_sequence": mistake.get("move_sequence", []),
            "best_move": mistake.get("best_move", ""),
            "result": mistake.get("result", ""),
            "white": mistake.get("white", {}),
            "black": mistake.get("black", {}),
        })

    # Add occurrence count and average eval drop
    for seq_data in by_sequence.values():
        seq_data["occurrences"] = len(seq_data["games"])
        # Calculate average eval drop (in centipawns, negative value)
        total_drop = sum(g["eval_drop"] for g in seq_data["games"])
        seq_data["avg_eval_drop"] = total_drop / len(seq_data["games"]) if seq_data["games"] else 0

    # Sort by occurrences descending
    sorted_sequences = sorted(by_sequence.values(), key=lambda x: x["occurrences"], reverse=True)

    return jsonify(sorted_sequences)


if __name__ == "__main__":
    print("Starting Chess Mistakes Analyzer Web UI...")
    print("Open http://localhost:5001 in your browser")
    app.run(debug=True, host="0.0.0.0", port=5001)
