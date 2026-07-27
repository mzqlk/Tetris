import { create } from 'zustand';
import type { GameState, Piece, PieceType, Position, Board, HardDropTrail } from '../types';
import { createEmptyBoard, lockPiece, clearLines, isGameOver } from '../engine/board';
import { createPiece, rotatePiece, generateBag, movePiece } from '../engine/piece';
import { calculateScore, calculateSoftDropScore, calculateHardDropScore, calculateLevel } from '../engine/scorer';
import { shouldDrop } from '../engine/gravity';

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

/**
 * Shared lock → clear → score → spawn pipeline.
 * Used by both hardDrop and gravity-lock to avoid duplicated logic.
 */
function lockAndSpawn(
  board: Board,
  piece: Piece,
  bag: PieceType[],
  score: number,
  level: number,
  lines: number
): {
  board: Board;
  currentPiece: Piece;
  nextPiece: Piece;
  bag: PieceType[];
  score: number;
  level: number;
  lines: number;
  status: 'playing' | 'gameover';
  flashRows: number[];
} {
  const newBoard = lockPiece(board, piece);
  const { clearedRows, newBoard: boardAfterClear } = clearLines(newBoard);
  const linesCleared = clearedRows.length;
  const lineScore = calculateScore(linesCleared, level);
  const totalLines = lines + linesCleared;
  const newLevel = calculateLevel(totalLines);

  const result = spawnNextPiece(bag, boardAfterClear);

  return {
    board: boardAfterClear,
    currentPiece: result.currentPiece,
    nextPiece: result.nextPiece,
    bag: result.bag,
    score: score + lineScore,
    level: newLevel,
    lines: totalLines,
    status: result.gameOver ? 'gameover' : 'playing',
    flashRows: clearedRows,
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
  hardDropTrail: null,
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
      hardDropTrail: null,
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

    const hardDropScore = calculateHardDropScore(cellsDropped);
    const trail: HardDropTrail = {
      positions: trailPositions,
      pieceType: currentPiece.type,
      rotation: currentPiece.rotation,
    };

    const spawned = lockAndSpawn(board, dropped, get().bag, score + hardDropScore, get().level, get().lines);

    set({
      ...spawned,
      dropTimer: 0,
      flashTimer: 300,
      hardDropTrail: trail,
      trailTimer: 200,
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

    // Always update timers — even during gameover, so trails and flashes fade out
    const newFlashTimer = state.flashTimer > 0 ? state.flashTimer - deltaTime : 0;
    const flashRows = newFlashTimer > 0 ? state.flashRows : [];
    const flashTimer = Math.max(newFlashTimer, 0);

    const newTrailTimer = state.trailTimer > 0 ? state.trailTimer - deltaTime : 0;
    const hardDropTrail: HardDropTrail | null = newTrailTimer > 0 ? state.hardDropTrail : null;
    const trailTimer = Math.max(newTrailTimer, 0);

    if (state.status !== 'playing' || !state.currentPiece) {
      // Still apply timer updates so trails / flashes decay during gameover
      set({ flashRows, flashTimer, hardDropTrail, trailTimer });
      return;
    }

    // Gravity
    const { shouldDrop: drop, newTimer } = shouldDrop(state.dropTimer, state.level, deltaTime);
    if (drop) {
      const moved = movePiece(state.board, state.currentPiece, 0, 1);
      if (moved) {
        set({ currentPiece: moved, dropTimer: newTimer, flashRows, flashTimer, hardDropTrail, trailTimer });
      } else {
        // Piece can't move down — lock it
        const spawned = lockAndSpawn(
          state.board, state.currentPiece, state.bag, state.score, state.level, state.lines
        );

        set({
          ...spawned,
          dropTimer: 0,
          flashTimer: 300,
          hardDropTrail: null,
          trailTimer: 0,
        });
      }
    } else {
      set({ dropTimer: newTimer, flashRows, flashTimer, hardDropTrail, trailTimer });
    }
  },

  clearFlashRows: () => set({ flashRows: [], flashTimer: 0 }),
  clearHardDropTrail: () => set({ hardDropTrail: null, trailTimer: 0 }),
}));