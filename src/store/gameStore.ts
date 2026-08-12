import { create } from 'zustand';
import type { GameState, Piece, PieceType, Position, Board, HardDropTrail } from '../types';
import { createEmptyBoard, lockPiece, clearLines, isGameOver } from '../engine/board';
import { createPiece, rotatePiece, generateBag, movePiece } from '../engine/piece';
import { calculateScore, calculateSoftDropScore, calculateHardDropScore, calculateLevel } from '../engine/scorer';
import { shouldDrop } from '../engine/gravity';
import { initialUnseenBagMask, revealPiece } from '../ai/publicState';

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

/** Initial spawn: draw two pieces — one to play, one to preview. */
function spawnInitial(bag: PieceType[], board: Board): {
  currentPiece: Piece;
  nextPiece: Piece;
  bag: PieceType[];
  unseenBagMask: number;
  gameOver: boolean;
} {
  const first = drawFromBag(bag);
  const second = drawFromBag(first.newBag);

  const currentPiece = createPiece(first.type);
  const nextPiece = createPiece(second.type);

  return {
    currentPiece,
    nextPiece,
    bag: second.newBag,
    unseenBagMask: initialUnseenBagMask(first.type, second.type),
    gameOver: isGameOver(board, currentPiece),
  };
}

/**
 * After a lock: the piece the player was shown becomes the piece they play,
 * and exactly one new piece is drawn for the preview. Drawing two here would
 * silently discard the previewed piece and break the 7-bag guarantee.
 */
function promoteNextPiece(bag: PieceType[], board: Board, preview: Piece, unseenBagMask: number): {
  currentPiece: Piece;
  nextPiece: Piece;
  bag: PieceType[];
  unseenBagMask: number;
  gameOver: boolean;
} {
  const currentPiece = createPiece(preview.type);
  const drawn = drawFromBag(bag);
  let nextMask: number;
  try {
    nextMask = revealPiece(unseenBagMask, drawn.type);
  } catch (error) {
    if (!(error instanceof Error) || !/public bag/i.test(error.message)) throw error;
    nextMask = initialUnseenBagMask(currentPiece.type, drawn.type);
  }

  return {
    currentPiece,
    nextPiece: createPiece(drawn.type),
    bag: drawn.newBag,
    unseenBagMask: nextMask,
    gameOver: isGameOver(board, currentPiece),
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
  unseenBagMask: number,
  score: number,
  level: number,
  lines: number,
  preview: Piece | null
): {
  board: Board;
  currentPiece: Piece;
  nextPiece: Piece;
  bag: PieceType[];
  unseenBagMask: number;
  score: number;
  level: number;
  lines: number;
  status: 'playing' | 'gameover';
  flashRows: number[];
} {
  const publicMask = Number.isInteger(unseenBagMask)
    ? unseenBagMask
    : preview
      ? initialUnseenBagMask(piece.type, preview.type)
      : 0;
  const newBoard = lockPiece(board, piece);
  const { clearedRows, newBoard: boardAfterClear } = clearLines(newBoard);
  const linesCleared = clearedRows.length;
  const lineScore = calculateScore(linesCleared, level);
  const totalLines = lines + linesCleared;
  const newLevel = calculateLevel(totalLines);

  const result = preview
    ? promoteNextPiece(bag, boardAfterClear, preview, publicMask)
    : spawnInitial(bag, boardAfterClear);

  return {
    board: boardAfterClear,
    currentPiece: result.currentPiece,
    nextPiece: result.nextPiece,
    bag: result.bag,
    unseenBagMask: result.unseenBagMask,
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
  holdPiece: null,
  holdAvailable: true,
  unseenBagMask: 0,
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
    const result = spawnInitial(initialBag, board);
    set({
      board,
      currentPiece: result.currentPiece,
      nextPiece: result.nextPiece,
      holdPiece: null,
      holdAvailable: true,
      bag: result.bag,
      unseenBagMask: result.unseenBagMask,
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

    const spawned = lockAndSpawn(
      board, dropped, get().bag, get().unseenBagMask, score + hardDropScore, get().level, get().lines, get().nextPiece
    );

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
          state.board, state.currentPiece, state.bag, state.unseenBagMask, state.score, state.level, state.lines, state.nextPiece
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
