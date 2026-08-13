import type { Board, Piece, PieceType } from '../types';
import { createEmptyBoard, lockPiece, clearLines, isGameOver } from '../engine/board';
import { createPiece, generateBag, movePiece, rotatePiece } from '../engine/piece';
import {
  calculateScore, calculateSoftDropScore, calculateHardDropScore, calculateLevel,
} from '../engine/scorer';
import { FEATURE_COUNT, columnHeights } from './features';
import {
  emptyLineClearCounts,
  recordLineClear,
  type LineClearCounts,
} from './lineClears';
import { mulberry32 } from './rng';
import {
  FIXED_SEARCH_LIMITS,
  searchFixed,
  type SearchDiagnostics,
} from './search';
import {
  initialUnseenBagMask,
  revealPiece,
  type BagMask,
  type PublicSearchState,
} from './publicState';
import { applyHold as applyPublicHold } from './stateTransitions';
import {
  addStrategyDiagnostics,
  diagnosticsFromWell,
  divideStrategyDiagnostics,
  emptyStrategyDiagnostics,
  summarizeTetrisWell,
  type StrategyDiagnostics,
} from './tetrisStrategy';

export type SimAction = 'left' | 'right' | 'rotate' | 'softDrop' | 'hardDrop' | 'hold';

export interface FixedSearchConfig {
  maxLockedDepth: 1 | 2 | 3 | 4;
  maxRootPlacements: number;
  maxChildPlacements: number;
}

export interface SimulationSearchDiagnostics {
  holdActions: number;
  holdRate: number;
  meanCompletedDepth: number;
  minCompletedDepth: number;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
  abortedSearches: number;
}

export interface SimState {
  board: Board;
  currentPiece: Piece | null;
  nextPiece: Piece | null;
  holdPiece: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: BagMask;
  bag: PieceType[];
  score: number;
  level: number;
  lines: number;
  clearCounts: LineClearCounts;
  status: 'playing' | 'gameover';
  pieces: number;
  /** Sum of the stack height sampled after every lock; see `meanHeight`. */
  heightSum: number;
  /** Sum of the strategy diagnostics sampled after every post-clear board. */
  strategyDiagnosticSum: StrategyDiagnostics;
  searchCalls: number;
  holdActions: number;
  completedDepthSum: number;
  minCompletedDepth: number;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
  abortedSearches: number;
  rng: () => number;
}

export interface SimResult {
  lines: number;
  clearCounts: LineClearCounts;
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
  /** Per-piece strategy diagnostics sampled from the post-clear board. */
  strategyDiagnostics: StrategyDiagnostics;
  searchDiagnostics: SimulationSearchDiagnostics;
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
    holdPiece: null,
    holdAvailable: true,
    unseenBagMask: 0,
    bag: generateBag(rng),
    score: 0,
    level: 1,
    lines: 0,
    clearCounts: emptyLineClearCounts(),
    status: 'playing',
    pieces: 0,
    heightSum: 0,
    strategyDiagnosticSum: emptyStrategyDiagnostics(),
    searchCalls: 0,
    holdActions: 0,
    completedDepthSum: 0,
    minCompletedDepth: 0,
    expandedDecisionNodes: 0,
    expandedChanceNodes: 0,
    cacheHits: 0,
    abortedSearches: 0,
    rng,
  };

  const first = drawFromBag(state);
  const second = drawFromBag(state);
  state.currentPiece = createPiece(first);
  state.nextPiece = createPiece(second);
  state.unseenBagMask = initialUnseenBagMask(first, second);
  if (isGameOver(state.board, state.currentPiece)) state.status = 'gameover';

  return state;
}

/** Mirrors gameStore's lockAndSpawn: lock, clear, score, promote the preview. */
function lockAndSpawn(state: SimState, piece: Piece): void {
  const locked = lockPiece(state.board, piece);
  const { clearedRows, newBoard } = clearLines(locked);
  const linesCleared = clearedRows.length;
  state.clearCounts = recordLineClear(state.clearCounts, linesCleared);

  // Line score uses the level from BEFORE this clear, same as the store.
  state.score += calculateScore(linesCleared, state.level);
  state.lines += linesCleared;
  state.level = calculateLevel(state.lines);
  state.board = newBoard;
  state.pieces += 1;
  state.holdAvailable = true;
  // Sampled AFTER the clear, so a move that fills four rows is credited with
  // the low board it leaves behind rather than the tall one it briefly made.
  state.heightSum += stackHeight(newBoard);
  state.strategyDiagnosticSum = addStrategyDiagnostics(
    state.strategyDiagnosticSum,
    diagnosticsFromWell(summarizeTetrisWell(newBoard)),
  );

  const preview = state.nextPiece;
  const current = createPiece(preview ? preview.type : drawFromBag(state));
  state.currentPiece = current;
  const next = drawFromBag(state);
  state.nextPiece = createPiece(next);
  state.unseenBagMask = revealPiece(state.unseenBagMask, next);
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
    case 'hold': {
      const transition = applyPublicHold(projectPublicSearchState(state));
      if (transition.kind === 'unavailable') break;
      if (transition.kind === 'ready') {
        state.currentPiece = transition.state.current;
        state.nextPiece = createPiece(transition.state.next);
        state.holdPiece = transition.state.hold;
        state.holdAvailable = transition.state.holdAvailable;
        state.unseenBagMask = transition.state.unseenBagMask;
      } else {
        const preview = drawFromBag(state);
        state.currentPiece = transition.state.current;
        state.nextPiece = createPiece(preview);
        state.holdPiece = transition.state.hold;
        state.holdAvailable = transition.state.holdAvailable;
        state.unseenBagMask = revealPiece(transition.state.unseenBagMask, preview);
      }
      if (isGameOver(state.board, state.currentPiece)) state.status = 'gameover';
      break;
    }
  }
}

export function projectPublicSearchState(state: SimState): PublicSearchState {
  if (state.currentPiece === null || state.nextPiece === null) {
    throw new Error('cannot project a simulator state without current and next pieces');
  }
  return {
    board: state.board,
    current: state.currentPiece,
    next: state.nextPiece.type,
    hold: state.holdPiece,
    holdAvailable: state.holdAvailable,
    unseenBagMask: state.unseenBagMask,
  };
}

function recordSearchDiagnostics(state: SimState, diagnostics: SearchDiagnostics): void {
  state.searchCalls++;
  state.completedDepthSum += diagnostics.completedDepth;
  state.minCompletedDepth = state.searchCalls === 1
    ? diagnostics.completedDepth
    : Math.min(state.minCompletedDepth, diagnostics.completedDepth);
  state.expandedDecisionNodes += diagnostics.expandedDecisionNodes;
  state.expandedChanceNodes += diagnostics.expandedChanceNodes;
  state.cacheHits += diagnostics.cacheHits;
  if (diagnostics.aborted) state.abortedSearches++;
}

function simulationSearchDiagnostics(state: SimState): SimulationSearchDiagnostics {
  return {
    holdActions: state.holdActions,
    holdRate: state.pieces === 0 ? 0 : state.holdActions / state.pieces,
    meanCompletedDepth: state.searchCalls === 0 ? 0 : state.completedDepthSum / state.searchCalls,
    minCompletedDepth: state.searchCalls === 0 ? 0 : state.minCompletedDepth,
    expandedDecisionNodes: state.expandedDecisionNodes,
    expandedChanceNodes: state.expandedChanceNodes,
    cacheHits: state.cacheHits,
    abortedSearches: state.abortedSearches,
  };
}

/**
 * The simulator skips real-time gravity and assigns the chosen landing pose
 * directly before locking it. Its score therefore uses the engine's line-clear
 * rules but omits the per-input soft/hard-drop bonuses a browser replay can
 * accumulate. Score-rate-v2 continues to use that deterministic scalar-score
 * contract; it is not a per-second metric or a byte-for-byte prediction of the UI score.
 */
export function simulateFromState(
  state: SimState,
  opts: { weights: number[]; maxPieces: number; search: FixedSearchConfig },
): SimResult {
  if (opts.weights.length !== FEATURE_COUNT) {
    throw new Error(`expected ${FEATURE_COUNT} weights, got ${opts.weights.length}`);
  }

  while (state.status === 'playing' && state.pieces < opts.maxPieces) {
    const decision = searchFixed(projectPublicSearchState(state), opts.weights, {
      ...opts.search,
      shouldAbort: () => false,
    });
    if (decision === null) {
      state.status = 'gameover';
      break;
    }
    recordSearchDiagnostics(state, decision.diagnostics);
    if (decision.action.kind === 'hold') {
      applyAction(state, 'hold');
      // Count only Holds that complete a valid decision cycle. A Hold may
      // promote a blocked piece and end the game before any lock; recording it
      // against the locked-piece denominator would make the diagnostic rate
      // inconsistent (and can exceed one).
      if (state.status === 'playing') state.holdActions++;
      continue;
    }
    state.currentPiece = decision.action.placement.piece;
    applyAction(state, 'hardDrop');
  }

  return {
    lines: state.lines,
    clearCounts: { ...state.clearCounts },
    score: state.score,
    pieces: state.pieces,
    meanHeight: state.pieces === 0 ? 0 : state.heightSum / state.pieces,
    strategyDiagnostics: state.pieces === 0
      ? emptyStrategyDiagnostics()
      : divideStrategyDiagnostics(state.strategyDiagnosticSum, state.pieces),
    searchDiagnostics: simulationSearchDiagnostics(state),
    reason: state.status === 'gameover' ? 'gameover' : 'pieceCap',
  };
}

export function simulateGame(opts: {
  weights: number[];
  seed: number;
  maxPieces: number;
  search?: FixedSearchConfig;
  /** Legacy caller metadata; fixed search intentionally ignores this value. */
  depth?: 1 | 2;
}): SimResult {
  const state = createSimState(opts.seed);
  return simulateFromState(state, {
    weights: opts.weights,
    maxPieces: opts.maxPieces,
    search: opts.search ?? FIXED_SEARCH_LIMITS,
  });
}
