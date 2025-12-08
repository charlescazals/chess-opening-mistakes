#!/usr/bin/env python3
"""Fetch and filter Chess.com games for analysis."""

import json
import requests
import time
from pathlib import Path

USERNAME = "charlescazals"
DATA_DIR = Path(__file__).parent / "data"
GAMES_FILE = DATA_DIR / "games.json"

# Valid time classes for analysis
VALID_TIME_CLASSES = {"blitz", "rapid"}

# Variant games to exclude
EXCLUDED_RULES = {
    "bullet",
    "chess960",
    "bughouse",
    "crazyhouse",
    "threecheck",
    "kingofthehill",
}


def get_archives(username: str) -> list[str]:
    """Get list of monthly archive URLs for a player."""
    url = f"https://api.chess.com/pub/player/{username}/games/archives"
    headers = {"User-Agent": "ChessMistakesAnalyzer/1.0"}

    response = requests.get(url, headers=headers)
    response.raise_for_status()

    return response.json().get("archives", [])


def fetch_games_from_archive(archive_url: str) -> list[dict]:
    """Fetch all games from a monthly archive."""
    headers = {"User-Agent": "ChessMistakesAnalyzer/1.0"}

    response = requests.get(archive_url, headers=headers)
    response.raise_for_status()

    return response.json().get("games", [])


def filter_game(game: dict) -> bool:
    """Check if game should be included in analysis."""
    # Check time class
    time_class = game.get("time_class", "")
    if time_class not in VALID_TIME_CLASSES:
        return False

    # Check for variant rules
    rules = game.get("rules", "chess")
    if rules in EXCLUDED_RULES:
        return False

    # Must have PGN data
    if "pgn" not in game:
        return False

    return True


def extract_game_data(game: dict, username: str) -> dict:
    """Extract relevant data from a game."""
    white = game.get("white", {})
    black = game.get("black", {})

    # Determine player color
    if white.get("username", "").lower() == username.lower():
        player_color = "white"
    else:
        player_color = "black"

    # Extract opening from PGN headers if available
    pgn = game.get("pgn", "")
    opening = ""
    eco = ""

    for line in pgn.split("\n"):
        if line.startswith('[ECOUrl "'):
            # Extract opening name from ECOUrl
            # Format: [ECOUrl "https://www.chess.com/openings/Kings-Pawn-Opening"]
            try:
                url_part = line.split('"')[1]
                opening = url_part.split("/openings/")[-1].replace("-", " ")
            except (IndexError, AttributeError):
                pass
        elif line.startswith('[ECO "'):
            try:
                eco = line.split('"')[1]
            except IndexError:
                pass

    return {
        "url": game.get("url", ""),
        "pgn": pgn,
        "time_class": game.get("time_class", ""),
        "time_control": game.get("time_control", ""),
        "end_time": game.get("end_time", 0),
        "player_color": player_color,
        "opening": opening,
        "eco": eco,
        "white": {
            "username": white.get("username", ""),
            "rating": white.get("rating", 0),
        },
        "black": {
            "username": black.get("username", ""),
            "rating": black.get("rating", 0),
        },
    }


def main():
    print(f"Fetching games for user: {USERNAME}")

    # Get all archives
    print("Fetching archive list...")
    archives = get_archives(USERNAME)
    print(f"Found {len(archives)} monthly archives")

    # Fetch from most recent archives first
    archives = sorted(archives, reverse=True)

    all_games = []
    target_count = 15

    for archive_url in archives:
        if len(all_games) >= target_count:
            break

        month = archive_url.split("/")[-2] + "/" + archive_url.split("/")[-1]
        print(f"Fetching {month}...", end=" ")

        try:
            games = fetch_games_from_archive(archive_url)
            filtered = [g for g in games if filter_game(g)]

            for game in filtered:
                if len(all_games) >= target_count:
                    break
                extracted = extract_game_data(game, USERNAME)
                all_games.append(extracted)

            print(f"found {len(filtered)} valid games (total: {len(all_games)})")

            # Rate limiting
            time.sleep(0.5)

        except requests.RequestException as e:
            print(f"Error: {e}")
            continue

    # Save games
    DATA_DIR.mkdir(exist_ok=True)

    with open(GAMES_FILE, "w") as f:
        json.dump(all_games, f, indent=2)

    print(f"\nSaved {len(all_games)} games to {GAMES_FILE}")

    # Print summary
    time_classes = {}
    for game in all_games:
        tc = game["time_class"]
        time_classes[tc] = time_classes.get(tc, 0) + 1

    print("\nBreakdown by time class:")
    for tc, count in sorted(time_classes.items()):
        print(f"  {tc}: {count}")


if __name__ == "__main__":
    main()
