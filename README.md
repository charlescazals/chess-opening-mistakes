# Chess Opening Mistakes Analyzer

Analyze your Chess.com games to identify opening mistakes using Stockfish.

## Get Started

### 1. Install dependencies

Set up Python virtual environment:
```bash
python3.13 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

Install Stockfish:
- macOS: `brew install stockfish`
- Linux: `sudo apt install stockfish`
- Windows: Download from https://stockfishchess.org/download/

### 2. Fetch games
```bash
python fetch_games.py
```

### 3. Analyze with Stockfish
```bash
python analyze_games.py
```
This can be interrupted and resumed - progress is saved automatically.

### 4. View statistics
```bash
python statistics.py
```

### 5. Launch web UI
```bash
python app.py
```
Open http://localhost:5001

## Configuration

Edit the username in `fetch_games.py` to analyze a different player's games.

## Output Files

- `data/games.json` - Raw game data from Chess.com
- `data/analysis_progress.json` - Progress tracking for resumable analysis
- `data/mistakes.json` - Detected opening mistakes
- `data/statistics.json` - Aggregated statistics
