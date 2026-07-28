import type { Board, Piece, PieceType } from '../types';
import { createEmptyBoard, lockPiece, clearLines, isGameOver } from '../engine/board';
import { createPiece, generateBag, movePiece, rotatePiece } from '../engine/piece';
import {
  calculateScore, calculateSoftDropScore, calculateHardDropScore, calculateLevel,
} from '../engine/scorer';
import { FEATURE_COUNT } from './features';
import { mulberry32 } from './rng';
import { bestPlacement } from './search';

export type SimAction = 'left' | 'right' | 'rotate' | 'softDrop' | 'hardDrop';

export interface SimState {
  board: Board;
  currentPiece: Piece | null;
  nextPiece: Piece | null;
  bag: PieceType[];
  score: number;
  level: number;
  lines: number;
  status: 'playing' | 'gameover';
  pieces: number;
  rng: () => number;
}

export interface SimResult {
  lines: number;
  score: number;
  pieces: number;
  reason: 'gameover' | 'pieceCap';
}

function drawFromBag(state: SimState): PieceType {
  if (state.bag.length === 0) state.bag = generateBag(state.rng);
  return state.bag.shift()!;
}

export function createSimState(seed: number): SimState {
  const rng = mulberry32(seed);
  const state: SimState = {
    board: createEmptyBoard(),
    currentPiece: null,
    nextPiece: null,
    bag: generateBag(rng),
    score: 0,
    level: 1,
    lines: 0,
    status: 'playing',
    pieces: 0,
    rng,
  };

  const first = drawFromBag(state);
  const second = drawFromBag(state);
  state.currentPiece = createPiece(first);
  state.nextPiece = createPiece(second);
  if (isGameOver(state.board, state.currentPiece)) state.status = 'gameover';

  return state;
}

/** Mirrors gameStore's lockAndSpawn: lock, clear, score, promote the preview. */
function lockAndSpawn(state: SimState, piece: Piece): void {
  const locked = lockPiece(state.board, piece);
  const { clearedRows, newBoard } = clearLines(locked);
  const linesCleared = clearedRows.length;

  // Line score uses the level from BEFORE this clear, same as the store.
  state.score += calculateScore(linesCleared, state.level);
  state.lines += linesCleared;
  state.level = calculateLevel(state.lines);
  state.board = newBoard;
  state.pieces += 1;

  const preview = state.nextPiece;
  const current = createPiece(preview ? preview.type : drawFromBag(state));
  state.currentPiece = current;
  state.nextPiece = createPiece(drawFromBag(state));
  if (isGameOver(state.board, current)) state.status = 'gameover';
}

/** One player action, with exactly the semantics of the matching store action. */
export function applyAction(state: SimState, action: SimAction): void {
  if (state.status !== 'playing' || state.currentPiece === null) return;
  const { board, currentPiece } = state;

  switch (action) {
    case 'left': {
      const moved = movePiece(board, currentPiece, -1, 0);
      if (moved) state.currentPiece = moved;
      break;
    }
    case 'right': {
      const moved = movePiece(board, currentPiece, 1, 0);
      if (moved) state.currentPiece = moved;
      break;
    }
    case 'rotate': {
      const rotated = rotatePiece(board, currentPiece);
      if (rotated !== currentPiece) state.currentPiece = rotated;
      break;
    }
    case 'softDrop': {
      const moved = movePiece(board, currentPiece, 0, 1);
      if (moved) {
        state.currentPiece = moved;
        state.score += calculateSoftDropScore(1);
      }
      break;
    }
    case 'hardDrop': {
      let dropped = currentPiece;
      let cellsDropped = 0;
      for (;;) {
        const next = movePiece(board, dropped, 0, 1);
        if (!next) break;
        dropped = next;
        cellsDropped++;
      }
      state.score += calculateHardDropScore(cellsDropped);
      lockAndSpawn(state, dropped);
      break;
    }
  }
}

/**
 * Headless game driven entirely by the evaluator. Gravity and timing are
 * skipped: the AI always hard-drops, so gravity could never be what locks a
 * piece — simulating it would change nothing and cost tens of times the runtime.
 *
 * The planned pose is assigned directly rather than replayed key by key, so the
 * hard-drop and soft-drop bonuses differ from a browser game. Fitness is measured
 * in lines, not score, so this does not affect training.
 */
export function simulateGame(opts: {
  weights: number[];
  seed: number;
  maxPieces: number;
  depth: 1 | 2;
}): SimResult {
  if (opts.weights.length !== FEATURE_COUNT) {
    throw new Error(`expected ${FEATURE_COUNT} weights, got ${opts.weights.length}`);
  }

  const state = createSimState(opts.seed);

  while (state.status === 'playing' && state.pieces < opts.maxPieces) {
    const decision = bestPlacement(
      state.board, state.currentPiece!, state.nextPiece, opts.weights, opts.depth,
    );
    if (decision === null) {
      state.status = 'gameover';
      break;
    }
    state.currentPiece = decision.placement.piece;
    applyAction(state, 'hardDrop');
  }

  return {
    lines: state.lines,
    score: state.score,
    pieces: state.pieces,
    reason: state.status === 'gameover' ? 'gameover' : 'pieceCap',
  };
}
