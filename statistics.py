#!/usr/bin/env python3
"""Generate statistics from analyzed chess opening mistakes."""

import json
import sys
from collections import defaultdict
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
MISTAKES_FILE = DATA_DIR / "mistakes.json"
STATISTICS_FILE = DATA_DIR / "statistics.json"


def load_mistakes() -> list[dict]:
    """Load mistakes from file."""
    if not MISTAKES_FILE.exists():
        print(f"Error: {MISTAKES_FILE} not found. Run analyze_games.py first.")
        sys.exit(1)

    with open(MISTAKES_FILE) as f:
        return json.load(f)


def analyze_by_opening(mistakes: list[dict]) -> dict:
    """Analyze mistakes grouped by opening."""
    openings = defaultdict(list)

    for mistake in mistakes:
        opening = mistake.get("opening", "Unknown") or "Unknown"
        openings[opening].append(mistake)

    results = {}
    for opening, opening_mistakes in openings.items():
        results[opening] = {
            "count": len(opening_mistakes),
            "avg_eval_drop": sum(m["eval_drop"] for m in opening_mistakes) / len(opening_mistakes),
            "mistakes": opening_mistakes,
        }

    return dict(sorted(results.items(), key=lambda x: x[1]["count"], reverse=True))


def analyze_by_move_sequence(mistakes: list[dict]) -> dict:
    """Analyze mistakes grouped by move sequence."""
    sequences = defaultdict(list)

    for mistake in mistakes:
        # Use the sequence up to and including the mistake
        seq = " ".join(mistake.get("move_sequence", []))
        sequences[seq].append(mistake)

    results = {}
    for seq, seq_mistakes in sequences.items():
        results[seq] = {
            "count": len(seq_mistakes),
            "openings": list(set(m.get("opening", "Unknown") for m in seq_mistakes)),
            "avg_eval_drop": sum(m["eval_drop"] for m in seq_mistakes) / len(seq_mistakes),
        }

    return dict(sorted(results.items(), key=lambda x: x[1]["count"], reverse=True))


def analyze_by_move_number(mistakes: list[dict]) -> dict:
    """Analyze which move numbers have the most mistakes."""
    move_numbers = defaultdict(int)

    for mistake in mistakes:
        move_num = mistake.get("move_number", 0)
        move_numbers[move_num] += 1

    return dict(sorted(move_numbers.items()))


def analyze_by_color(mistakes: list[dict]) -> dict:
    """Analyze mistakes by player color."""
    colors = defaultdict(int)

    for mistake in mistakes:
        color = mistake.get("player_color", "unknown")
        colors[color] += 1

    return dict(colors)


def analyze_by_time_class(mistakes: list[dict]) -> dict:
    """Analyze mistakes by time class."""
    time_classes = defaultdict(int)

    for mistake in mistakes:
        tc = mistake.get("time_class", "unknown")
        time_classes[tc] += 1

    return dict(sorted(time_classes.items(), key=lambda x: x[1], reverse=True))


def print_report(stats: dict):
    """Print a formatted report to console."""
    print("\n" + "=" * 60)
    print("CHESS OPENING MISTAKES ANALYSIS")
    print("=" * 60)

    print(f"\nTotal mistakes found: {stats['total_mistakes']}")

    # By color
    print("\n--- Mistakes by Color ---")
    for color, count in stats["by_color"].items():
        print(f"  {color}: {count}")

    # By time class
    print("\n--- Mistakes by Time Class ---")
    for tc, count in stats["by_time_class"].items():
        print(f"  {tc}: {count}")

    # By move number
    print("\n--- Mistakes by Move Number ---")
    for move_num, count in stats["by_move_number"].items():
        print(f"  Move {move_num}: {count}")

    # Top openings with mistakes
    print("\n--- Top 10 Openings with Most Mistakes ---")
    for i, (opening, data) in enumerate(list(stats["by_opening"].items())[:10]):
        avg_drop = data["avg_eval_drop"]
        print(f"  {i + 1}. {opening}: {data['count']} mistakes (avg drop: {avg_drop:.0f} cp)")

    # Most common mistake sequences
    print("\n--- Top 10 Most Repeated Mistake Sequences ---")
    for i, (seq, data) in enumerate(list(stats["by_sequence"].items())[:10]):
        if data["count"] > 1:  # Only show repeated mistakes
            print(f"  {i + 1}. [{data['count']}x] {seq}")
            print(f"      Openings: {', '.join(data['openings'][:3])}")

    print("\n" + "=" * 60)


def main():
    mistakes = load_mistakes()

    if not mistakes:
        print("No mistakes found in the data.")
        return

    print(f"Analyzing {len(mistakes)} mistakes...")

    stats = {
        "total_mistakes": len(mistakes),
        "by_opening": analyze_by_opening(mistakes),
        "by_sequence": analyze_by_move_sequence(mistakes),
        "by_move_number": analyze_by_move_number(mistakes),
        "by_color": analyze_by_color(mistakes),
        "by_time_class": analyze_by_time_class(mistakes),
    }

    # Remove full mistake details from by_opening for the saved file
    stats_for_file = stats.copy()
    stats_for_file["by_opening"] = {
        opening: {"count": data["count"], "avg_eval_drop": data["avg_eval_drop"]}
        for opening, data in stats["by_opening"].items()
    }

    # Save statistics
    with open(STATISTICS_FILE, "w") as f:
        json.dump(stats_for_file, f, indent=2)

    print(f"Statistics saved to {STATISTICS_FILE}")

    # Print report
    print_report(stats)


if __name__ == "__main__":
    main()
