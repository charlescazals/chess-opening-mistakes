# Chess Opening Mistakes Analyzer

Analyze your Chess.com games to identify recurring opening mistakes using Stockfish running directly in your browser.

## Features

- Fetches your blitz and rapid games from Chess.com
- Analyzes openings using Stockfish WASM (no installation required)
- Identifies recurring mistakes across your games
- Filter by opening, color, impact, and more

## Usage

### Online

Visit the hosted version (if deployed via GitHub Pages).

### Local Development

Serve the static files with any HTTP server:

```bash
# Using Python
python3 -m http.server 8000

# Using Node.js
npx serve
```

Then open http://localhost:8000

## How It Works

1. Enter your Chess.com username
2. The app fetches your recent games via the Chess.com API
3. Stockfish WASM analyzes the first 14 half-moves of each game
4. Mistakes (eval drops >= 1 pawn) are grouped by move sequence
5. Browse and filter your recurring opening mistakes

All data is stored locally in your browser (localStorage).
