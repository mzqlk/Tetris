import type { Board, Piece, PieceType } from '../types';
import { createEmptyBoard, lockPiece, clearLines, isGameOver } from '../engine/board';
import { createPiece, generateBag, movePiece, rotatePiece } from '../engine/piece';
import {
  calculateScore, calculateSoftDropScore, calculateHardDropScore, calculateLevel,
} from '../engine/scorer';
import { FEATURE_COUNT, columnHeights } from './features';
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
  /** Sum of the stack height sampled after every lock; see `meanHeight`. */
  heightSum: number;
  rng: () => number;
}

export interface SimResult {
  lines: number;
  score: number;
  pieces: number;
  /**
   * Mean stack height across the game — the tallest column measured after each
   * lock, averaged over every piece played. 0 for a game that locked nothing.
   *
   * This exists because `lines` cannot rank competent players. A piece is 4
   * cells and a row is 10, so lines can never exceed 0.4 per piece; a candidate
   * that never dies therefore scores exactly 0.4 x maxPieces no matter how well
   * it actually plays, and measurement confirms it — three separate runs landed
   * within 1% of that ceiling, and hand-tuned weights were indistinguishable
   * from trained ones. Height has no such ceiling: playing at an average of 3
   * rows and surviving on the brink at 15 are both fully expressible, so this
   * still separates two players who both survive forever.
   */
  meanHeight: number;
  reason: 'gameover' | 'pieceCap';
}

/** Tallest column on the board — the same quantity as the `maxHeight` feature. */
function stackHeight(board: Board): number {
  let max = 0;
  for (const h of columnHeights(board)) if (h > max) max = h;
  return max;
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
    heightSum: 0,
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
  // Sampled AFTER the clear, so a move that fills four rows is credited with
  // the low board it leaves behind rather than the tall one it briefly made.
  state.heightSum += stackHeight(newBoard);

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
 * The simulator skips real-time gravity, but it returns the engine score used
 * by training's fixed-schedule score-rate objective. No per-second metric is
 * derived here.
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
    meanHeight: state.pieces === 0 ? 0 : state.heightSum / state.pieces,
    reason: state.status === 'gameover' ? 'gameover' : 'pieceCap',
  };
}
