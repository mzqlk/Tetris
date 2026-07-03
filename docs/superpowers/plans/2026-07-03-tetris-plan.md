# Tetris Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-based Tetris game with cyberpunk visuals using React + TypeScript + Vite + Canvas + Zustand.

**Architecture:** Engine layer (pure functions for board/piece/scoring logic) → Zustand store (state + engine orchestration) → Renderer layer (Canvas drawing) → React components (composition). Each layer depends only on the one below it.

**Tech Stack:** React 18, TypeScript, Vite, Zustand, HTML Canvas, CSS Modules

## Global Constraints

- Board: 10 columns × 20 rows visible + 2-row hidden buffer (22 total rows)
- Board representation: `number[][]` — 0 = empty, 1–7 = piece type ID
- 7-bag random piece generation
- SRS rotation with wall kicks
- Speed curve: `Math.max(100, 800 - (level - 1) * 50)` ms
- Level range: 1–15, level up every 10 lines
- NES-style scoring: single=100×lvl, double=300×lvl, triple=500×lvl, tetris=800×lvl, soft drop=1/cell, hard drop=2/cell
- Controls: ←→ move, ↑ rotate, ↓ soft drop, Space hard drop, P pause
- Game states: idle → playing → paused → gameover → idle
- Cyberpunk palette: background `#0a0e1a`, grid `#1a1e3a`, neon piece colors
- Ghost piece with dashed border + low opacity

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/types.ts` | All shared TypeScript types |
| `src/constants.ts` | Board dims, colors, speed table, piece matrices, wall kick data |
| `src/engine/board.ts` | Board creation, collision detection, line clearing, piece merging |
| `src/engine/piece.ts` | Piece creation, rotation, 7-bag generation, ghost piece |
| `src/engine/scorer.ts` | Score calculation |
| `src/engine/gravity.ts` | Speed curve, drop timing |
| `src/store/gameStore.ts` | Zustand store with all game state and actions |
| `src/renderer/drawBoard.ts` | Draw grid lines and locked blocks |
| `src/renderer/drawPiece.ts` | Draw active piece and ghost piece |
| `src/renderer/effects.ts` | Glow, line clear flash, hard drop trail, background particles |
| `src/hooks/useGameLoop.ts` | RAF loop + keyboard handler |
| `src/components/GameCanvas.tsx` | Canvas element + renderer orchestration |
| `src/components/NextPiece.tsx` | Small canvas showing next piece |
| `src/components/ScoreBoard.tsx` | Score / level / lines display |
| `src/components/GameOverlay.tsx` | Start / pause / gameover overlay |
| `src/components/Game.tsx` | Main layout composing all sub-components |
| `src/App.tsx` | Root app component |
| `src/main.tsx` | Vite entry point |
| `src/App.module.css` | App-level styles |
| `src/components/Game.module.css` | Game layout styles |
| `src/components/GameOverlay.module.css` | Overlay styles |
| `src/components/ScoreBoard.module.css` | Scoreboard styles |

---

### Task 1: Project Scaffold + Types + Constants

**Files:**
- Create: `src/types.ts`
- Create: `src/constants.ts`
- Modify: `package.json` (via `npm create vite`)
- Modify: `index.html`

**Interfaces:**
- Produces: `PieceType`, `GameStatus`, `Piece`, `Board`, `GameState` types; `BOARD_WIDTH`, `BOARD_HEIGHT`, `BOARD_BUFFER`, `CELL_SIZE`, `PIECE_COLORS`, `PIECE_MATRICES`, `WALL_KICK_DATA`, `SPEED_CURVE` constants — all later tasks depend on these

- [ ] **Step 1: Scaffold Vite project**

```bash
cd D:/WorkSpace/Tetris
npm create vite@latest . -- --template react-ts
npm install
npm install zustand
```

- [ ] **Step 2: Clean scaffold files**

Delete default Vite boilerplate: remove `src/App.css`, `src/assets/`, content of `src/App.tsx`. Keep `src/main.tsx`, `src/App.tsx` (emptied), `index.html`, `tsconfig.json`, `vite.config.ts`.

- [ ] **Step 3: Create `src/types.ts`**

```typescript
export type PieceType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type GameStatus = 'idle' | 'playing' | 'paused' | 'gameover';

export interface Position {
  x: number;
  y: number;
}

export interface Piece {
  type: PieceType;
  rotation: number; // 0-3
  position: Position;
}

export type Board = number[][];

export interface ClearResult {
  clearedRows: number[];
  newBoard: Board;
}

export interface ScoreResult {
  points: number;
  linesCleared: number;
}

export interface GameState {
  board: Board;
  currentPiece: Piece | null;
  nextPiece: Piece | null;
  bag: PieceType[];
  score: number;
  level: number;
  lines: number;
  status: GameStatus;
  dropTimer: number;
  flashRows: number[];
  flashTimer: number;
  hardDropTrail: Position[];
  trailTimer: number;
}
```

- [ ] **Step 4: Create `src/constants.ts`**

```typescript
import type { PieceType } from './types';

export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;
export const BOARD_BUFFER = 2;
export const TOTAL_ROWS = BOARD_HEIGHT + BOARD_BUFFER;
export const CELL_SIZE = 32;

export const PIECE_COLORS: Record<PieceType, string> = {
  1: '#00f0ff', // I - Cyan
  2: '#f0f000', // O - Yellow
  3: '#b000ff', // T - Purple
  4: '#00ff60', // S - Green
  5: '#ff0040', // Z - Red
  6: '#0060ff', // J - Blue
  7: '#ff8000', // L - Orange
};

export const PIECE_GLOW_COLORS: Record<PieceType, string> = {
  1: 'rgba(0, 240, 255, 0.6)',
  2: 'rgba(240, 240, 0, 0.6)',
  3: 'rgba(176, 0, 255, 0.6)',
  4: 'rgba(0, 255, 96, 0.6)',
  5: 'rgba(255, 0, 64, 0.6)',
  6: 'rgba(0, 96, 255, 0.6)',
  7: 'rgba(255, 128, 0, 0.6)',
};

// Each piece type maps to 4 rotation states, each a 4x4 matrix
// 1=I, 2=O, 3=T, 4=S, 5=Z, 6=J, 7=L
export const PIECE_MATRICES: Record<PieceType, number[][][]> = {
  1: [ // I
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
    [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
    [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
  ],
  2: [ // O
    [[0,2,2,0],[0,2,2,0],[0,0,0,0],[0,0,0,0]],
    [[0,2,2,0],[0,2,2,0],[0,0,0,0],[0,0,0,0]],
    [[0,2,2,0],[0,2,2,0],[0,0,0,0],[0,0,0,0]],
    [[0,2,2,0],[0,2,2,0],[0,0,0,0],[0,0,0,0]],
  ],
  3: [ // T
    [[0,3,0,0],[3,3,3,0],[0,0,0,0],[0,0,0,0]],
    [[0,3,0,0],[0,3,3,0],[0,3,0,0],[0,0,0,0]],
    [[0,0,0,0],[3,3,3,0],[0,3,0,0],[0,0,0,0]],
    [[0,3,0,0],[3,3,0,0],[0,3,0,0],[0,0,0,0]],
  ],
  4: [ // S
    [[0,4,4,0],[4,4,0,0],[0,0,0,0],[0,0,0,0]],
    [[0,4,0,0],[0,4,4,0],[0,0,4,0],[0,0,0,0]],
    [[0,0,0,0],[0,4,4,0],[4,4,0,0],[0,0,0,0]],
    [[4,0,0,0],[4,4,0,0],[0,4,0,0],[0,0,0,0]],
  ],
  5: [ // Z
    [[5,5,0,0],[0,5,5,0],[0,0,0,0],[0,0,0,0]],
    [[0,0,5,0],[0,5,5,0],[0,5,0,0],[0,0,0,0]],
    [[0,0,0,0],[5,5,0,0],[0,5,5,0],[0,0,0,0]],
    [[0,5,0,0],[5,5,0,0],[5,0,0,0],[0,0,0,0]],
  ],
  6: [ // J
    [[6,0,0,0],[6,6,6,0],[0,0,0,0],[0,0,0,0]],
    [[0,6,6,0],[0,6,0,0],[0,6,0,0],[0,0,0,0]],
    [[0,0,0,0],[6,6,6,0],[0,0,6,0],[0,0,0,0]],
    [[0,6,0,0],[0,6,0,0],[6,6,0,0],[0,0,0,0]],
  ],
  7: [ // L
    [[0,0,7,0],[7,7,7,0],[0,0,0,0],[0,0,0,0]],
    [[0,7,0,0],[0,7,0,0],[0,7,7,0],[0,0,0,0]],
    [[0,0,0,0],[7,7,7,0],[7,0,0,0],[0,0,0,0]],
    [[7,7,0,0],[0,7,0,0],[0,7,0,0],[0,0,0,0]],
  ],
};

// SRS Wall Kick Data
// For J, L, S, T, Z pieces
export const WALL_KICK_JLSTZ: Record<string, [number, number][]> = {
  '0>1': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '1>0': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  '1>2': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  '2>1': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '2>3': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  '3>2': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '3>0': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '0>3': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
};

// For I piece
export const WALL_KICK_I: Record<string, [number, number][]> = {
  '0>1': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  '1>0': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  '1>2': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
  '2>1': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  '2>3': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  '3>2': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  '3>0': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  '0>3': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
};

export function getSpeedInterval(level: number): number {
  return Math.max(100, 800 - (level - 1) * 50);
}

export const MAX_LEVEL = 15;
export const LINES_PER_LEVEL = 10;
```

- [ ] **Step 5: Verify build compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold project with types and constants"
```

---

### Task 2: Board Engine

**Files:**
- Create: `src/engine/board.ts`

**Interfaces:**
- Consumes: `Board`, `Piece`, `ClearResult`, `Position` from `types.ts`; `BOARD_WIDTH`, `TOTAL_ROWS`, `PIECE_MATRICES` from `constants.ts`
- Produces: `createEmptyBoard()`, `isValidPosition()`, `lockPiece()`, `clearLines()`, `getGhostPosition()` — used by gameStore and renderer

- [ ] **Step 1: Create `src/engine/board.ts`**

```typescript
import type { Board, Piece, ClearResult, Position } from '../types';
import { BOARD_WIDTH, TOTAL_ROWS, PIECE_MATRICES } from '../constants';

export function createEmptyBoard(): Board {
  return Array.from({ length: TOTAL_ROWS }, () =>
    Array(BOARD_WIDTH).fill(0)
  );
}

export function getPieceCells(piece: Piece): Position[] {
  const matrix = PIECE_MATRICES[piece.type][piece.rotation];
  const cells: Position[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      if (matrix[row][col] !== 0) {
        cells.push({
          x: piece.position.x + col,
          y: piece.position.y + row,
        });
      }
    }
  }
  return cells;
}

export function isValidPosition(board: Board, piece: Piece): boolean {
  const cells = getPieceCells(piece);
  for (const cell of cells) {
    if (cell.x < 0 || cell.x >= BOARD_WIDTH || cell.y < 0 || cell.y >= TOTAL_ROWS) {
      return false;
    }
    if (board[cell.y][cell.x] !== 0) {
      return false;
    }
  }
  return true;
}

export function lockPiece(board: Board, piece: Piece): Board {
  const newBoard = board.map(row => [...row]);
  const cells = getPieceCells(piece);
  for (const cell of cells) {
    if (cell.y >= 0 && cell.y < TOTAL_ROWS && cell.x >= 0 && cell.x < BOARD_WIDTH) {
      newBoard[cell.y][cell.x] = piece.type;
    }
  }
  return newBoard;
}

export function clearLines(board: Board): ClearResult {
  const clearedRows: number[] = [];
  for (let row = 0; row < TOTAL_ROWS; row++) {
    if (board[row].every(cell => cell !== 0)) {
      clearedRows.push(row);
    }
  }

  if (clearedRows.length === 0) {
    return { clearedRows: [], newBoard: board };
  }

  const newBoard = board
    .filter((_, idx) => !clearedRows.includes(idx))
    .filter(row => row.some(cell => cell !== 0)); // remove empty buffer rows that might slip in

  // Add empty rows at top to maintain board height
  while (newBoard.length < TOTAL_ROWS) {
    newBoard.unshift(Array(BOARD_WIDTH).fill(0));
  }

  return { clearedRows, newBoard };
}

export function getGhostPosition(board: Board, piece: Piece): Position {
  let ghostY = piece.position.y;
  const ghostPiece: Piece = { ...piece, position: { x: piece.position.x, y: ghostY } };

  while (isValidPosition(board, { ...ghostPiece, position: { x: piece.position.x, y: ghostY + 1 } })) {
    ghostY++;
  }

  return { x: piece.position.x, y: ghostY };
}

export function isGameOver(board: Board, piece: Piece): boolean {
  // Game over if the piece is at spawn position and can't be placed
  return !isValidPosition(board, piece);
}
```

- [ ] **Step 2: Verify build compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/engine/board.ts
git commit -m "feat: add board engine with collision, locking, and line clearing"
```

---

### Task 3: Piece Engine

**Files:**
- Create: `src/engine/piece.ts`

**Interfaces:**
- Consumes: `Piece`, `PieceType`, `Board` from `types.ts`; `PIECE_MATRICES`, `WALL_KICK_JLSTZ`, `WALL_KICK_I`, `BOARD_WIDTH` from `constants.ts`; `isValidPosition` from `board.ts`
- Produces: `createPiece()`, `rotatePiece()`, `generateBag()` — used by gameStore

- [ ] **Step 1: Create `src/engine/piece.ts`**

```typescript
import type { Piece, PieceType, Board } from '../types';
import {
  PIECE_MATRICES,
  WALL_KICK_JLSTZ,
  WALL_KICK_I,
  BOARD_WIDTH,
} from '../constants';
import { isValidPosition } from './board';

export function createPiece(type: PieceType): Piece {
  const spawnX = Math.floor((BOARD_WIDTH - 4) / 2);
  return {
    type,
    rotation: 0,
    position: { x: spawnX, y: 0 },
  };
}

export function rotatePiece(board: Board, piece: Piece, clockwise: boolean = true): Piece {
  const newRotation = clockwise
    ? (piece.rotation + 1) % 4
    : (piece.rotation + 3) % 4;

  const key = `${piece.rotation}>${newRotation}`;
  const kickData = piece.type === 1 ? WALL_KICK_I : WALL_KICK_JLSTZ;
  const kicks = kickData[key];

  if (!kicks) {
    return piece; // O piece or no kick data — return original
  }

  for (const [dx, dy] of kicks) {
    const candidate: Piece = {
      ...piece,
      rotation: newRotation,
      position: {
        x: piece.position.x + dx,
        y: piece.position.y - dy, // SRS uses y-up, board uses y-down
      },
    };
    if (isValidPosition(board, candidate)) {
      return candidate;
    }
  }

  return piece; // No valid position found — rotation fails
}

export function generateBag(): PieceType[] {
  const bag: PieceType[] = [1, 2, 3, 4, 5, 6, 7];
  // Fisher-Yates shuffle
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export function movePiece(board: Board, piece: Piece, dx: number, dy: number): Piece | null {
  const candidate: Piece = {
    ...piece,
    position: {
      x: piece.position.x + dx,
      y: piece.position.y + dy,
    },
  };
  return isValidPosition(board, candidate) ? candidate : null;
}
```

- [ ] **Step 2: Verify build compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/engine/piece.ts
git commit -m "feat: add piece engine with SRS rotation and 7-bag generation"
```

---

### Task 4: Scorer + Gravity

**Files:**
- Create: `src/engine/scorer.ts`
- Create: `src/engine/gravity.ts`

**Interfaces:**
- Consumes: `ScoreResult` from `types.ts`; `getSpeedInterval`, `LINES_PER_LEVEL`, `MAX_LEVEL` from `constants.ts`
- Produces: `calculateScore()`, `calculateLevel()`, `shouldDrop()` — used by gameStore

- [ ] **Step 1: Create `src/engine/scorer.ts`**

```typescript
import type { ScoreResult } from '../types';
import { LINES_PER_LEVEL, MAX_LEVEL } from '../constants';

const LINE_SCORES: Record<number, number> = {
  1: 100,
  2: 300,
  3: 500,
  4: 800,
};

export function calculateScore(linesCleared: number, level: number): number {
  if (linesCleared === 0) return 0;
  return (LINE_SCORES[linesCleared] ?? 0) * level;
}

export function calculateSoftDropScore(cellsDropped: number): number {
  return cellsDropped;
}

export function calculateHardDropScore(cellsDropped: number): number {
  return cellsDropped * 2;
}

export function calculateLevel(currentLevel: number, totalLines: number): number {
  const newLevel = Math.floor(totalLines / LINES_PER_LEVEL) + 1;
  return Math.min(newLevel, MAX_LEVEL);
}
```

- [ ] **Step 2: Create `src/engine/gravity.ts`**

```typescript
import { getSpeedInterval } from '../constants';

export function shouldDrop(dropTimer: number, level: number, deltaTime: number): { shouldDrop: boolean; newTimer: number } {
  const newTimer = dropTimer + deltaTime;
  const interval = getSpeedInterval(level);

  if (newTimer >= interval) {
    return { shouldDrop: true, newTimer: newTimer - interval };
  }

  return { shouldDrop: false, newTimer };
}
```

- [ ] **Step 3: Verify build compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/engine/scorer.ts src/engine/gravity.ts
git commit -m "feat: add scorer and gravity engines"
```

---

### Task 5: Zustand Game Store

**Files:**
- Create: `src/store/gameStore.ts`

**Interfaces:**
- Consumes: `GameState`, `Piece`, `PieceType`, `GameStatus`, `Position` from `types.ts`; all engine functions from `board.ts`, `piece.ts`, `scorer.ts`, `gravity.ts`; constants from `constants.ts`
- Produces: `useGameStore` — used by all React components and the game loop hook

- [ ] **Step 1: Create `src/store/gameStore.ts`**

```typescript
import { create } from 'zustand';
import type { GameState, Piece, PieceType, GameStatus, Position } from '../types';
import { createEmptyBoard, lockPiece, clearLines, getGhostPosition, isGameOver } from '../engine/board';
import { createPiece, rotatePiece, generateBag, movePiece } from '../engine/piece';
import { calculateScore, calculateSoftDropScore, calculateHardDropScore, calculateLevel } from '../engine/scorer';
import { shouldDrop } from '../engine/gravity';
import { BOARD_BUFFER } from '../constants';

interface GameActions {
  startGame: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  moveLeft: () => void;
  moveRight: () => void;
  softDrop: () => void;
  hardDrop: () => void;
  rotate: () => void;
  tick: (deltaTime: number) => void;
  clearFlashRows: () => void;
  clearHardDropTrail: () => void;
}

type GameStore = GameState & GameActions;

function drawFromBag(bag: PieceType[]): { type: PieceType; newBag: PieceType[] } {
  let currentBag = [...bag];
  if (currentBag.length === 0) {
    currentBag = generateBag();
  }
  const type = currentBag.shift()!;
  return { type, newBag: currentBag };
}

function spawnNextPiece(bag: PieceType[], board: Board): {
  currentPiece: Piece;
  nextPiece: Piece;
  bag: PieceType[];
  gameOver: boolean;
} {
  const first = drawFromBag(bag);
  const second = drawFromBag(first.newBag);

  const currentPiece = createPiece(first.type);
  const nextPiece = createPiece(second.type);

  const gameOver = isGameOver(board, currentPiece);

  return {
    currentPiece,
    nextPiece,
    bag: second.newBag,
    gameOver,
  };
}

export const useGameStore = create<GameStore>((set, get) => ({
  board: createEmptyBoard(),
  currentPiece: null,
  nextPiece: null,
  bag: [],
  score: 0,
  level: 1,
  lines: 0,
  status: 'idle',
  dropTimer: 0,
  flashRows: [],
  flashTimer: 0,
  hardDropTrail: [],
  trailTimer: 0,

  startGame: () => {
    const board = createEmptyBoard();
    const initialBag = generateBag();
    const result = spawnNextPiece(initialBag, board);
    set({
      board,
      currentPiece: result.currentPiece,
      nextPiece: result.nextPiece,
      bag: result.bag,
      score: 0,
      level: 1,
      lines: 0,
      status: 'playing',
      dropTimer: 0,
      flashRows: [],
      flashTimer: 0,
      hardDropTrail: [],
      trailTimer: 0,
    });
  },

  pauseGame: () => {
    if (get().status === 'playing') {
      set({ status: 'paused' });
    }
  },

  resumeGame: () => {
    if (get().status === 'paused') {
      set({ status: 'playing' });
    }
  },

  moveLeft: () => {
    const { board, currentPiece, status } = get();
    if (status !== 'playing' || !currentPiece) return;
    const moved = movePiece(board, currentPiece, -1, 0);
    if (moved) set({ currentPiece: moved });
  },

  moveRight: () => {
    const { board, currentPiece, status } = get();
    if (status !== 'playing' || !currentPiece) return;
    const moved = movePiece(board, currentPiece, 1, 0);
    if (moved) set({ currentPiece: moved });
  },

  softDrop: () => {
    const { board, currentPiece, status, score } = get();
    if (status !== 'playing' || !currentPiece) return;
    const moved = movePiece(board, currentPiece, 0, 1);
    if (moved) {
      set({ currentPiece: moved, score: score + calculateSoftDropScore(1), dropTimer: 0 });
    }
  },

  hardDrop: () => {
    const { board, currentPiece, status, score } = get();
    if (status !== 'playing' || !currentPiece) return;

    let dropped = currentPiece;
    let cellsDropped = 0;
    const trailPositions: Position[] = [];

    while (true) {
      const next = movePiece(board, dropped, 0, 1);
      if (!next) break;
      trailPositions.push({ x: dropped.position.x, y: dropped.position.y });
      dropped = next;
      cellsDropped++;
    }

    const newScore = score + calculateHardDropScore(cellsDropped);
    const newBoard = lockPiece(board, dropped);
    const { clearedRows, newBoard: boardAfterClear } = clearLines(newBoard);
    const linesCleared = clearedRows.length;
    const lineScore = calculateScore(linesCleared, get().level);
    const totalLines = get().lines + linesCleared;
    const newLevel = calculateLevel(get().level, totalLines);

    const result = spawnNextPiece(get().bag, boardAfterClear);

    set({
      board: boardAfterClear,
      currentPiece: result.currentPiece,
      nextPiece: result.nextPiece,
      bag: result.bag,
      score: newScore + lineScore,
      level: newLevel,
      lines: totalLines,
      dropTimer: 0,
      flashRows: clearedRows,
      flashTimer: 300,
      hardDropTrail: trailPositions,
      trailTimer: 200,
      status: result.gameOver ? 'gameover' : 'playing',
    });
  },

  rotate: () => {
    const { board, currentPiece, status } = get();
    if (status !== 'playing' || !currentPiece) return;
    const rotated = rotatePiece(board, currentPiece);
    if (rotated !== currentPiece) {
      set({ currentPiece: rotated });
    }
  },

  tick: (deltaTime: number) => {
    const state = get();
    if (state.status !== 'playing' || !state.currentPiece) return;

    // Update flash timer
    if (state.flashTimer > 0) {
      const newFlashTimer = state.flashTimer - deltaTime;
      if (newFlashTimer <= 0) {
        set({ flashRows: [], flashTimer: 0 });
      } else {
        set({ flashTimer: newFlashTimer });
      }
    }

    // Update trail timer
    if (state.trailTimer > 0) {
      const newTrailTimer = state.trailTimer - deltaTime;
      if (newTrailTimer <= 0) {
        set({ hardDropTrail: [], trailTimer: 0 });
      } else {
        set({ trailTimer: newTrailTimer });
      }
    }

    // Gravity
    const { shouldDrop: drop, newTimer } = shouldDrop(state.dropTimer, state.level, deltaTime);
    if (drop) {
      const moved = movePiece(state.board, state.currentPiece, 0, 1);
      if (moved) {
        set({ currentPiece: moved, dropTimer: newTimer });
      } else {
        // Piece can't move down — lock it
        const newBoard = lockPiece(state.board, state.currentPiece);
        const { clearedRows, newBoard: boardAfterClear } = clearLines(newBoard);
        const linesCleared = clearedRows.length;
        const lineScore = calculateScore(linesCleared, state.level);
        const totalLines = state.lines + linesCleared;
        const newLevel = calculateLevel(state.level, totalLines);

        const result = spawnNextPiece(state.bag, boardAfterClear);

        set({
          board: boardAfterClear,
          currentPiece: result.currentPiece,
          nextPiece: result.nextPiece,
          bag: result.bag,
          score: state.score + lineScore,
          level: newLevel,
          lines: totalLines,
          dropTimer: 0,
          flashRows: clearedRows,
          flashTimer: 300,
          status: result.gameOver ? 'gameover' : 'playing',
        });
      }
    } else {
      set({ dropTimer: newTimer });
    }
  },

  clearFlashRows: () => set({ flashRows: [], flashTimer: 0 }),
  clearHardDropTrail: () => set({ hardDropTrail: [], trailTimer: 0 }),
}));
```

- [ ] **Step 2: Verify build compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/store/gameStore.ts
git commit -m "feat: add Zustand game store with all game actions"
```

---

### Task 6: Canvas Renderer

**Files:**
- Create: `src/renderer/drawBoard.ts`
- Create: `src/renderer/drawPiece.ts`
- Create: `src/renderer/effects.ts`

**Interfaces:**
- Consumes: `Board`, `Piece`, `Position` from `types.ts`; `PIECE_COLORS`, `PIECE_GLOW_COLORS`, `BOARD_WIDTH`, `BOARD_HEIGHT`, `BOARD_BUFFER`, `CELL_SIZE` from `constants.ts`; `getPieceCells`, `getGhostPosition` from `engine/board`
- Produces: `drawBoard()`, `drawPiece()`, `drawGhostPiece()`, `drawEffects()`, `initBackgroundParticles()`, `updateAndDrawParticles()` — used by GameCanvas

- [ ] **Step 1: Create `src/renderer/drawBoard.ts`**

```typescript
import type { Board } from '../types';
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  BOARD_BUFFER,
  CELL_SIZE,
  PIECE_COLORS,
} from '../constants';

const BG_COLOR = '#0a0e1a';
const GRID_COLOR = '#1a1e3a';

export function drawBoard(ctx: CanvasRenderingContext2D, board: Board): void {
  const canvasWidth = BOARD_WIDTH * CELL_SIZE;
  const canvasHeight = BOARD_HEIGHT * CELL_SIZE;

  // Clear and fill background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Draw grid lines
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  for (let col = 0; col <= BOARD_WIDTH; col++) {
    ctx.beginPath();
    ctx.moveTo(col * CELL_SIZE, 0);
    ctx.lineTo(col * CELL_SIZE, canvasHeight);
    ctx.stroke();
  }
  for (let row = 0; row <= BOARD_HEIGHT; row++) {
    ctx.beginPath();
    ctx.moveTo(0, row * CELL_SIZE);
    ctx.lineTo(canvasWidth, row * CELL_SIZE);
    ctx.stroke();
  }

  // Draw locked blocks
  for (let row = BOARD_BUFFER; row < BOARD_BUFFER + BOARD_HEIGHT; row++) {
    for (let col = 0; col < BOARD_WIDTH; col++) {
      const cellValue = board[row][col];
      if (cellValue !== 0) {
        const color = PIECE_COLORS[cellValue as keyof typeof PIECE_COLORS];
        drawBlock(ctx, col, row - BOARD_BUFFER, color);
      }
    }
  }
}

export function drawBlock(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  color: string,
  opacity: number = 1.0
): void {
  const x = col * CELL_SIZE;
  const y = row * CELL_SIZE;
  const size = CELL_SIZE;
  const inset = 2;

  ctx.globalAlpha = opacity;

  // Main fill
  ctx.fillStyle = color;
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);

  // Inner glow — bright top-left edge
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);

  // Border
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = opacity * 0.8;
  ctx.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);

  ctx.globalAlpha = 1.0;
}
```

- [ ] **Step 2: Create `src/renderer/drawPiece.ts`**

```typescript
import type { Board, Piece } from '../types';
import { BOARD_BUFFER, CELL_SIZE, PIECE_COLORS } from '../constants';
import { getPieceCells, getGhostPosition } from '../engine/board';
import { drawBlock } from './drawBoard';

export function drawPiece(ctx: CanvasRenderingContext2D, piece: Piece): void {
  const cells = getPieceCells(piece);
  const color = PIECE_COLORS[piece.type];

  for (const cell of cells) {
    const displayRow = cell.y - BOARD_BUFFER;
    if (displayRow >= 0) {
      drawBlock(ctx, cell.x, displayRow, color);
    }
  }
}

export function drawGhostPiece(ctx: CanvasRenderingContext2D, board: Board, piece: Piece): void {
  const ghostPos = getGhostPosition(board, piece);
  const ghostPiece: Piece = { ...piece, position: ghostPos };
  const cells = getPieceCells(ghostPiece);
  const color = PIECE_COLORS[piece.type];

  for (const cell of cells) {
    const displayRow = cell.y - BOARD_BUFFER;
    if (displayRow >= 0) {
      const x = cell.x * CELL_SIZE;
      const y = displayRow * CELL_SIZE;
      const size = CELL_SIZE;
      const inset = 2;

      // Dashed border
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = color;
      ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);

      ctx.globalAlpha = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
      ctx.setLineDash([]);

      ctx.globalAlpha = 1.0;
    }
  }
}
```

- [ ] **Step 3: Create `src/renderer/effects.ts`**

```typescript
import { BOARD_WIDTH, BOARD_HEIGHT, BOARD_BUFFER, CELL_SIZE, PIECE_COLORS } from '../constants';
import type { Position } from '../types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
}

let particles: Particle[] = [];

export function initBackgroundParticles(): void {
  particles = [];
  const canvasWidth = BOARD_WIDTH * CELL_SIZE;
  const canvasHeight = BOARD_HEIGHT * CELL_SIZE;
  for (let i = 0; i < 30; i++) {
    particles.push({
      x: Math.random() * canvasWidth,
      y: Math.random() * canvasHeight,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -Math.random() * 0.3 - 0.1,
      size: Math.random() * 2 + 0.5,
      alpha: Math.random() * 0.5 + 0.1,
      life: Math.random() * 200 + 100,
    });
  }
}

export function updateAndDrawParticles(ctx: CanvasRenderingContext2D, deltaTime: number): void {
  const canvasWidth = BOARD_WIDTH * CELL_SIZE;
  const canvasHeight = BOARD_HEIGHT * CELL_SIZE;

  for (const p of particles) {
    p.x += p.vx * deltaTime * 0.06;
    p.y += p.vy * deltaTime * 0.06;
    p.life -= deltaTime * 0.01;

    // Wrap around
    if (p.y < 0) p.y = canvasHeight;
    if (p.x < 0) p.x = canvasWidth;
    if (p.x > canvasWidth) p.x = 0;

    // Fade when life is low
    const drawAlpha = p.life < 30 ? p.alpha * (p.life / 30) : p.alpha;

    ctx.globalAlpha = drawAlpha;
    ctx.fillStyle = '#4488ff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1.0;

  // Respawn dead particles
  particles = particles.filter(p => p.life > 0);
  while (particles.length < 30) {
    particles.push({
      x: Math.random() * canvasWidth,
      y: canvasHeight,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -Math.random() * 0.3 - 0.1,
      size: Math.random() * 2 + 0.5,
      alpha: Math.random() * 0.5 + 0.1,
      life: Math.random() * 200 + 100,
    });
  }
}

export function drawLineClearFlash(
  ctx: CanvasRenderingContext2D,
  flashRows: number[],
  flashTimer: number
): void {
  if (flashRows.length === 0) return;

  const alpha = Math.min(flashTimer / 150, 1.0) * 0.8;

  for (const row of flashRows) {
    const displayRow = row - BOARD_BUFFER;
    if (displayRow >= 0) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, displayRow * CELL_SIZE, BOARD_WIDTH * CELL_SIZE, CELL_SIZE);
    }
  }

  ctx.globalAlpha = 1.0;
}

export function drawHardDropTrail(
  ctx: CanvasRenderingContext2D,
  trail: Position[],
  trailTimer: number,
  pieceType: number
): void {
  if (trail.length === 0) return;

  const color = PIECE_COLORS[pieceType as keyof typeof PIECE_COLORS];
  const alpha = Math.min(trailTimer / 100, 1.0) * 0.4;

  for (const pos of trail) {
    const displayRow = pos.y - BOARD_BUFFER;
    if (displayRow >= 0) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.fillRect(pos.x * CELL_SIZE, displayRow * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1.0;
}
```

- [ ] **Step 4: Verify build compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/drawBoard.ts src/renderer/drawPiece.ts src/renderer/effects.ts
git commit -m "feat: add canvas renderer with board, piece, and cyberpunk effects"
```

---

### Task 7: Game Loop Hook

**Files:**
- Create: `src/hooks/useGameLoop.ts`

**Interfaces:**
- Consumes: `useGameStore` from `store/gameStore.ts`
- Produces: `useGameLoop(canvasRef)` — used by GameCanvas component

- [ ] **Step 1: Create `src/hooks/useGameLoop.ts`**

```typescript
import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { drawBoard } from '../renderer/drawBoard';
import { drawPiece, drawGhostPiece } from '../renderer/drawPiece';
import {
  initBackgroundParticles,
  updateAndDrawParticles,
  drawLineClearFlash,
  drawHardDropTrail,
} from '../renderer/effects';
import { BOARD_WIDTH, BOARD_HEIGHT, CELL_SIZE } from '../constants';

export function useGameLoop(canvasRef: React.RefObject<HTMLCanvasElement | null>): void {
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const particlesInitRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!particlesInitRef.current) {
      initBackgroundParticles();
      particlesInitRef.current = true;
    }

    const gameLoop = (timestamp: number) => {
      const deltaTime = lastTimeRef.current === 0 ? 16 : timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      // Tick game state
      useGameStore.getState().tick(deltaTime);

      // Get current state for rendering
      const state = useGameStore.getState();

      // Draw everything
      drawBoard(ctx, state.board);
      updateAndDrawParticles(ctx, deltaTime);

      if (state.currentPiece && state.status === 'playing') {
        drawGhostPiece(ctx, state.board, state.currentPiece);
        drawPiece(ctx, state.currentPiece);
      }

      drawLineClearFlash(ctx, state.flashRows, state.flashTimer);
      drawHardDropTrail(ctx, state.hardDropTrail, state.trailTimer, state.currentPiece?.type ?? 0);

      rafRef.current = requestAnimationFrame(gameLoop);
    };

    rafRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [canvasRef]);
}
```

- [ ] **Step 2: Create keyboard event handler. Update `src/hooks/useGameLoop.ts` — add keyboard hook**

Replace the file content with:

```typescript
import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { drawBoard } from '../renderer/drawBoard';
import { drawPiece, drawGhostPiece } from '../renderer/drawPiece';
import {
  initBackgroundParticles,
  updateAndDrawParticles,
  drawLineClearFlash,
  drawHardDropTrail,
} from '../renderer/effects';

export function useGameLoop(canvasRef: React.RefObject<HTMLCanvasElement | null>): void {
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const particlesInitRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!particlesInitRef.current) {
      initBackgroundParticles();
      particlesInitRef.current = true;
    }

    const gameLoop = (timestamp: number) => {
      const deltaTime = lastTimeRef.current === 0 ? 16 : timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      useGameStore.getState().tick(deltaTime);

      const state = useGameStore.getState();

      drawBoard(ctx, state.board);
      updateAndDrawParticles(ctx, deltaTime);

      if (state.currentPiece && state.status === 'playing') {
        drawGhostPiece(ctx, state.board, state.currentPiece);
        drawPiece(ctx, state.currentPiece);
      }

      drawLineClearFlash(ctx, state.flashRows, state.flashTimer);
      drawHardDropTrail(ctx, state.hardDropTrail, state.trailTimer, state.currentPiece?.type ?? 0);

      rafRef.current = requestAnimationFrame(gameLoop);
    };

    rafRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [canvasRef]);
}

export function useKeyboardControls(): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const store = useGameStore.getState();

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          store.moveLeft();
          break;
        case 'ArrowRight':
          e.preventDefault();
          store.moveRight();
          break;
        case 'ArrowDown':
          e.preventDefault();
          store.softDrop();
          break;
        case 'ArrowUp':
          e.preventDefault();
          store.rotate();
          break;
        case ' ':
          e.preventDefault();
          store.hardDrop();
          break;
        case 'p':
        case 'P':
          if (store.status === 'playing') {
            store.pauseGame();
          } else if (store.status === 'paused') {
            store.resumeGame();
          }
          break;
        case 'Enter':
          if (store.status === 'idle' || store.status === 'gameover') {
            store.startGame();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
```

- [ ] **Step 3: Verify build compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useGameLoop.ts
git commit -m "feat: add game loop and keyboard controls hooks"
```

---

### Task 8: React Components

**Files:**
- Create: `src/components/GameCanvas.tsx`
- Create: `src/components/NextPiece.tsx`
- Create: `src/components/ScoreBoard.tsx`
- Create: `src/components/GameOverlay.tsx`
- Create: `src/components/Game.tsx`
- Modify: `src/App.tsx`
- Create: `src/components/Game.module.css`
- Create: `src/components/GameOverlay.module.css`
- Create: `src/components/ScoreBoard.module.css`
- Create: `src/App.module.css`

**Interfaces:**
- Consumes: `useGameStore` from `store/gameStore.ts`; `useGameLoop`, `useKeyboardControls` from `hooks/useGameLoop.ts`; constants from `constants.ts`; renderer functions

- [ ] **Step 1: Create `src/components/GameCanvas.tsx`**

```tsx
import { useRef } from 'react';
import { useGameLoop } from '../hooks/useGameLoop';
import { BOARD_WIDTH, BOARD_HEIGHT, CELL_SIZE } from '../constants';

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useGameLoop(canvasRef);

  return (
    <canvas
      ref={canvasRef}
      width={BOARD_WIDTH * CELL_SIZE}
      height={BOARD_HEIGHT * CELL_SIZE}
      style={{ display: 'block' }}
    />
  );
}
```

- [ ] **Step 2: Create `src/components/NextPiece.tsx`**

```tsx
import { useRef, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { PIECE_COLORS, CELL_SIZE } from '../constants';
import { getPieceCells } from '../engine/board';

export default function NextPiece() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nextPiece = useGameStore(s => s.nextPiece);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !nextPiece) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cells = getPieceCells(nextPiece);
    const color = PIECE_COLORS[nextPiece.type];

    // Center the piece in the preview canvas
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of cells) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
    const pieceW = (maxX - minX + 1) * CELL_SIZE;
    const pieceH = (maxY - minY + 1) * CELL_SIZE;
    const offsetX = (canvas.width - pieceW) / 2 - minX * CELL_SIZE;
    const offsetY = (canvas.height - pieceH) / 2 - minY * CELL_SIZE;

    for (const cell of cells) {
      const x = cell.x * CELL_SIZE + offsetX;
      const y = cell.y * CELL_SIZE + offsetY;
      const inset = 2;
      ctx.fillStyle = color;
      ctx.fillRect(x + inset, y + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2);

      const gradient = ctx.createLinearGradient(x, y, x + CELL_SIZE, y + CELL_SIZE);
      gradient.addColorStop(0, 'rgba(255,255,255,0.3)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x + inset, y + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.8;
      ctx.strokeRect(x + inset, y + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2);
      ctx.globalAlpha = 1.0;
    }
  }, [nextPiece]);

  return (
    <canvas
      ref={canvasRef}
      width={4 * CELL_SIZE}
      height={4 * CELL_SIZE}
      style={{ display: 'block' }}
    />
  );
}
```

- [ ] **Step 3: Create `src/components/ScoreBoard.tsx` and `src/components/ScoreBoard.module.css`**

`src/components/ScoreBoard.module.css`:
```css
.board {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 160px;
}

.label {
  font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 12px;
  color: #4488aa;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 4px;
}

.value {
  font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 28px;
  color: #00f0ff;
  text-shadow: 0 0 10px rgba(0, 240, 255, 0.5), 0 0 20px rgba(0, 240, 255, 0.3);
}

.section {
  display: flex;
  flex-direction: column;
}

.nextLabel {
  font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 12px;
  color: #4488aa;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 8px;
}

.nextCanvasWrapper {
  background: #0a0e1a;
  border: 1px solid #1a1e3a;
  border-radius: 4px;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

`src/components/ScoreBoard.tsx`:
```tsx
import { useGameStore } from '../store/gameStore';
import NextPiece from './NextPiece';
import styles from './ScoreBoard.module.css';

export default function ScoreBoard() {
  const score = useGameStore(s => s.score);
  const level = useGameStore(s => s.level);
  const lines = useGameStore(s => s.lines);

  return (
    <div className={styles.board}>
      <div className={styles.section}>
        <div className={styles.nextLabel}>Next</div>
        <div className={styles.nextCanvasWrapper}>
          <NextPiece />
        </div>
      </div>
      <div className={styles.section}>
        <div className={styles.label}>Score</div>
        <div className={styles.value}>{score.toLocaleString()}</div>
      </div>
      <div className={styles.section}>
        <div className={styles.label}>Level</div>
        <div className={styles.value}>{level}</div>
      </div>
      <div className={styles.section}>
        <div className={styles.label}>Lines</div>
        <div className={styles.value}>{lines}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/GameOverlay.tsx` and `src/components/GameOverlay.module.css`**

`src/components/GameOverlay.module.css`:
```css
.overlay {
  position: absolute;
  inset: 0;
  background: rgba(10, 14, 26, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.title {
  font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 36px;
  color: #00f0ff;
  text-shadow: 0 0 20px rgba(0, 240, 255, 0.6), 0 0 40px rgba(0, 240, 255, 0.3);
  margin-bottom: 16px;
}

.subtitle {
  font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 16px;
  color: #4488aa;
  margin-bottom: 8px;
}

.finalScore {
  font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 24px;
  color: #f0f000;
  text-shadow: 0 0 10px rgba(240, 240, 0, 0.5);
  margin-bottom: 24px;
}

.prompt {
  font-family: 'Fira Code', 'JetBrains Mono', 'Courier New', monospace;
  font-size: 14px;
  color: #00ff60;
  text-shadow: 0 0 8px rgba(0, 255, 96, 0.5);
  animation: blink 1.2s ease-in-out infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

`src/components/GameOverlay.tsx`:
```tsx
import { useGameStore } from '../store/gameStore';
import styles from './GameOverlay.module.css';

export default function GameOverlay() {
  const status = useGameStore(s => s.status);
  const score = useGameStore(s => s.score);

  if (status === 'playing') return null;

  return (
    <div className={styles.overlay}>
      {status === 'idle' && (
        <>
          <div className={styles.title}>TETRIS</div>
          <div className={styles.prompt}>PRESS ENTER TO START</div>
        </>
      )}
      {status === 'paused' && (
        <>
          <div className={styles.title}>PAUSED</div>
          <div className={styles.prompt}>PRESS P TO RESUME</div>
        </>
      )}
      {status === 'gameover' && (
        <>
          <div className={styles.title}>GAME OVER</div>
          <div className={styles.subtitle}>FINAL SCORE</div>
          <div className={styles.finalScore}>{score.toLocaleString()}</div>
          <div className={styles.prompt}>PRESS ENTER TO RESTART</div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create `src/components/Game.tsx` and `src/components/Game.module.css`**

`src/components/Game.module.css`:
```css
.gameContainer {
  display: flex;
  gap: 24px;
  align-items: flex-start;
  justify-content: center;
  padding: 40px;
  min-height: 100vh;
  background: #0a0e1a;
}

.canvasWrapper {
  position: relative;
  border: 2px solid #00f0ff;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.3), 0 0 30px rgba(0, 240, 255, 0.1),
    inset 0 0 15px rgba(0, 240, 255, 0.1);
  border-radius: 2px;
}
```

`src/components/Game.tsx`:
```tsx
import { useKeyboardControls } from '../hooks/useGameLoop';
import GameCanvas from './GameCanvas';
import ScoreBoard from './ScoreBoard';
import GameOverlay from './GameOverlay';
import styles from './Game.module.css';

export default function Game() {
  useKeyboardControls();

  return (
    <div className={styles.gameContainer}>
      <div className={styles.canvasWrapper}>
        <GameCanvas />
        <GameOverlay />
      </div>
      <ScoreBoard />
    </div>
  );
}
```

- [ ] **Step 6: Create `src/App.module.css` and update `src/App.tsx`**

`src/App.module.css`:
```css
.app {
  margin: 0;
  padding: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
```

`src/App.tsx`:
```tsx
import Game from './components/Game';
import styles from './App.module.css';

export default function App() {
  return (
    <div className={styles.app}>
      <Game />
    </div>
  );
}
```

- [ ] **Step 7: Update `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 8: Update `index.html` — add monospace font and reset styles**

Replace the `<head>` section with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TETRIS — Cyberpunk</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap" rel="stylesheet" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #0a0e1a; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: Verify build and run**

```bash
npx tsc --noEmit
npm run dev
```

Expected: dev server starts, game renders at localhost:5173

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add all React components with cyberpunk styling"
```

---

### Task 9: Polish + Final Integration Test

**Files:**
- Modify: `src/renderer/effects.ts` — tune visual parameters
- Modify: `src/App.module.css` — add body-level styling fallback
- Modify: `src/main.tsx` — ensure clean startup

**Interfaces:**
- Consumes: all previous tasks

- [ ] **Step 1: Run the game and verify all features**

```bash
npm run dev
```

Manually verify:
- [ ] Game starts on Enter key
- [ ] All 7 piece types appear
- [ ] Pieces rotate with wall kicks (SRS)
- [ ] Ghost piece shows below active piece
- [ ] Soft drop works (Arrow Down)
- [ ] Hard drop works (Space) with trail effect
- [ ] Line clear with flash effect
- [ ] Score, level, lines update correctly
- [ ] Speed increases with level
- [ ] P pauses/resumes
- [ ] Game over triggers when piece locks above visible area
- [ ] Enter restarts after game over
- [ ] Next piece preview updates
- [ ] Background particles drift
- [ ] Neon glow on all blocks

- [ ] **Step 2: Fix any issues found during testing**

Address any bugs or visual inconsistencies discovered in Step 1.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: polish visuals and fix integration issues"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| 10×20 board + 2-row buffer | Task 1 (constants), Task 2 (board engine) |
| 7 tetrominoes with SRS | Task 1 (matrices, wall kicks), Task 3 (rotation) |
| 7-bag random | Task 3 (generateBag) |
| Controls (←→↑↓ Space P) | Task 7 (keyboard hook) |
| Ghost piece | Task 2 (getGhostPosition), Task 6 (drawGhostPiece) |
| Collision detection | Task 2 (isValidPosition) |
| Line clearing | Task 2 (clearLines) |
| NES scoring | Task 4 (scorer) |
| Level system (10 lines/level, max 15) | Task 4 (scorer) |
| Speed curve | Task 1 (getSpeedInterval), Task 4 (gravity) |
| Game states (idle/playing/paused/gameover) | Task 5 (store), Task 8 (overlay) |
| Cyberpunk colors | Task 1 (PIECE_COLORS), Task 6 (renderer) |
| Glow blocks | Task 6 (drawBlock gradient) |
| Ghost piece dashed border | Task 6 (drawGhostPiece) |
| Line clear flash | Task 6 (drawLineClearFlash) |
| Hard drop trail | Task 6 (drawHardDropTrail) |
| Background particles | Task 6 (particles) |
| Neon glow text | Task 8 (CSS text-shadow) |
| Monospace font (Fira Code) | Task 8 (Google Fonts link) |
| Layout (game left, info right) | Task 8 (Game.module.css) |
| Glowing border | Task 8 (Game.module.css box-shadow) |
| Next piece preview | Task 8 (NextPiece component) |
| ScoreBoard | Task 8 (ScoreBoard component) |
| Zustand store | Task 5 |
| React + TypeScript + Vite | Task 1 |
| CSS Modules | Task 8 |
