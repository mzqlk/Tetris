import { create } from 'zustand';
import type { GameState, Piece, PieceType, Position, Board } from '../types';
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

    // Calculate timer updates
    const newFlashTimer = state.flashTimer > 0 ? state.flashTimer - deltaTime : 0;
    const flashRows = newFlashTimer > 0 ? state.flashRows : [];
    const flashTimer = Math.max(newFlashTimer, 0);

    const newTrailTimer = state.trailTimer > 0 ? state.trailTimer - deltaTime : 0;
    const hardDropTrail = newTrailTimer > 0 ? state.hardDropTrail : [];
    const trailTimer = Math.max(newTrailTimer, 0);

    // Gravity
    const { shouldDrop: drop, newTimer } = shouldDrop(state.dropTimer, state.level, deltaTime);
    if (drop) {
      const moved = movePiece(state.board, state.currentPiece, 0, 1);
      if (moved) {
        set({ currentPiece: moved, dropTimer: newTimer, flashRows, flashTimer, hardDropTrail, trailTimer });
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
          hardDropTrail: [],
          trailTimer: 0,
          status: result.gameOver ? 'gameover' : 'playing',
        });
      }
    } else {
      set({ dropTimer: newTimer, flashRows, flashTimer, hardDropTrail, trailTimer });
    }
  },

  clearFlashRows: () => set({ flashRows: [], flashTimer: 0 }),
  clearHardDropTrail: () => set({ hardDropTrail: [], trailTimer: 0 }),
}));