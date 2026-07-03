# Tetris — Design Spec

## Overview

A browser-based Tetris game built with React + TypeScript + Vite, using Canvas rendering and Zustand state management. Cyberpunk visual style with neon colors and glow effects.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | React 18 + TypeScript |
| Build Tool | Vite |
| State Management | Zustand |
| Rendering | HTML Canvas (game) + React DOM (HUD) |
| Styling | CSS Modules |

## Project Structure

```
src/
├── components/
│   ├── Game.tsx          # Main game component, holds Canvas and HUD
│   ├── GameCanvas.tsx    # Canvas rendering layer, binds game loop
│   ├── NextPiece.tsx     # Preview next piece (small Canvas)
│   ├── ScoreBoard.tsx    # Score/level/lines display
│   └── GameOverlay.tsx   # Start/pause/game-over overlay
├── store/
│   └── gameStore.ts      # Zustand store, all game state
├── engine/
│   ├── board.ts          # Board logic (collision, line clear, merge)
│   ├── piece.ts          # Piece definitions, rotation (SRS)
│   ├── gravity.ts        # Drop timing, speed curve
│   └── scorer.ts         # Scoring rules
├── renderer/
│   ├── drawBoard.ts      # Draw grid and locked blocks
│   ├── drawPiece.ts      # Draw active piece + ghost piece
│   └── effects.ts        # Cyberpunk effects (glow, line clear flash, background particles)
├── hooks/
│   └── useGameLoop.ts    # requestAnimationFrame loop + keyboard events
├── constants.ts          # Board dimensions, colors, speed table
├── types.ts              # TypeScript type definitions
├── App.tsx
└── main.tsx
```

### Architecture Layers

- **engine/** — Pure functions, no side effects, no DOM/Canvas dependency, independently testable
- **store/** — Zustand store, holds state and calls engine to update state
- **renderer/** — Reads state from store, draws to Canvas
- **components/** — Combines the three layers above, React view layer

## Game Logic

### Board

- 10 columns × 20 rows standard board
- 2-row hidden buffer above the visible board for piece spawn
- Representation: `number[][]` — 0 = empty, 1-7 = locked block color index

### Pieces

- 7 standard tetrominoes: I, O, T, S, Z, J, L
- Each has 4 rotation states encoded as 4×4 matrices
- Rotation system: **SRS (Super Rotation System)** with standard wall kicks

### Piece Generation

- **7-bag random system**: shuffle all 7 piece types into a bag, draw sequentially; when bag is empty, generate a new shuffled bag
- Guarantees all 7 types appear every 7 pieces

### Controls

| Key | Action |
|-----|--------|
| ← → | Move left/right |
| ↑ | Rotate (clockwise) |
| ↓ | Soft drop |
| Space | Hard drop |
| P | Pause/Resume |

- Ghost Piece: semi-transparent projection showing where the piece would land after hard drop

### Collision Detection

- Before every move/rotate, check if target position overlaps with walls or locked blocks
- Invalid moves are rejected; rotation attempts wall kicks per SRS rules

### Line Clearing

- Check for fully filled rows every frame
- On clear: flash effect, remove row, rows above fall down
- Support simultaneous multi-line clears

## Scoring & Difficulty

### Scoring (NES-style)

| Action | Points |
|--------|--------|
| Single (1 line) | 100 × level |
| Double (2 lines) | 300 × level |
| Triple (3 lines) | 500 × level |
| Tetris (4 lines) | 800 × level |
| Soft drop | 1 per cell |
| Hard drop | 2 per cell |

### Level System

- Every 10 lines cleared → level +1
- Level range: 1-15

### Speed Curve

- Drop interval = `Math.max(100, 800 - (level - 1) * 50)` ms
- Level 1: 800ms, Level 15: 100ms
- Accumulated time counter (not setTimeout) to avoid timing drift

## Visual Design — Cyberpunk

### Color Palette

- **Background**: Deep blue-black `#0a0e1a`, with faint grid lines `#1a1e3a`
- **Piece colors**: Neon palette
  - I: Cyan `#00f0ff`
  - O: Yellow `#f0f000`
  - T: Purple `#b000ff`
  - S: Green `#00ff60`
  - Z: Red `#ff0040`
  - J: Blue `#0060ff`
  - L: Orange `#ff8000`
- **Block rendering**: Each cell has inner glow (bright edge + dark corner), not flat fill
- **Typography**: Monospace font (JetBrains Mono / Fira Code), neon glow text effect

### Effects

- **Ghost Piece**: Dashed border + low opacity fill
- **Line Clear Flash**: Full-row white flash on clear, then fade out
- **Hard Drop Trail**: Brief glow trail along the drop path
- **Background Particles**: Slowly drifting tiny light dots for deep-space atmosphere

### Layout

- Centered layout: game Canvas on the left, info panel on the right
- Info panel: next piece preview, score, level, lines cleared
- Glowing border around game area

## Game States

| State | Description |
|-------|-------------|
| idle | Game not started, showing start overlay |
| playing | Active gameplay |
| paused | Game paused, showing pause overlay |
| gameover | Game over, showing final score overlay |

Transitions:
- idle → playing (press Enter or click Start)
- playing → paused (press P)
- paused → playing (press P)
- playing → gameover (piece locks above visible board)
- gameover → idle (press Enter or click Restart)
