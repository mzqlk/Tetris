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
  searchBudgeted,
  type SearchDecision,
  type SearchDiagnostics,
} from './search';
import { DETERMINISTIC_SEARCH_LIMITS, type SearchLimits } from './searchBudget';

import {
  assertPublicSearchState,
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

export interface SimulationSearchDiagnostics {
  searchCalls: number;
  holdActions: number;
  holdRate: number;
  meanCompletedDepth: number;
  minCompletedDepth: number;
  completedDepthHistogram: [number, number, number, number, number];
  totalWorkUnitsUsed: number;
  meanWorkUnitsUsed: number;
  maxWorkUnitsUsed: number;
  budgetExhaustedSearches: number;
  budgetExhaustionRate: number;
  placementEvaluationUnits: number;
  chanceExpansionUnits: number;
  cacheHitUnits: number;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
}

export interface SimulationDecisionObservation {
  publicState: PublicSearchState;
  decision: SearchDecision;
  scheduledPieceNumber: number;
  score: number;
  lines: number;
  level: number;
  searchDiagnostics: SimulationSearchDiagnostics;
}

export interface SimulateFromStateOptions {
  weights: number[];
  maxPieces: number;
  limits?: SearchLimits;
  onDecision?: (observation: SimulationDecisionObservation) => void;
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
  completedDepthHistogram: [number, number, number, number, number];
  totalWorkUnitsUsed: number;
  maxWorkUnitsUsed: number;
  budgetExhaustedSearches: number;
  placementEvaluationUnits: number;
  chanceExpansionUnits: number;
  cacheHitUnits: number;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
  rng: () => number;
}

export interface FrozenContinuationCapture {
  state: PublicSearchState;
  score: number;
  lines: number;
  level: number;
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
    completedDepthHistogram: [0, 0, 0, 0, 0],
    totalWorkUnitsUsed: 0,
    maxWorkUnitsUsed: 0,
    budgetExhaustedSearches: 0,
    placementEvaluationUnits: 0,
    chanceExpansionUnits: 0,
    cacheHitUnits: 0,
    expandedDecisionNodes: 0,
    expandedChanceNodes: 0,
    cacheHits: 0,
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

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative integer`);
  }
}

function assertFrozenPieceType(value: number, name: string): asserts value is PieceType {
  if (!Number.isInteger(value) || value < 1 || value > 7) {
    throw new Error(`${name} must be a piece type`);
  }
}

export function createFrozenContinuationState(
  capture: FrozenContinuationCapture,
  futurePieces: readonly PieceType[],
): SimState {
  assertPublicSearchState(capture.state);
  assertNonNegativeInteger(capture.score, 'score');
  assertNonNegativeInteger(capture.lines, 'lines');
  assertNonNegativeInteger(capture.level, 'level');
  if (capture.level !== calculateLevel(capture.lines)) {
    throw new Error('level must match calculated level');
  }
  if (futurePieces.length === 0) throw new Error('at least one future piece is required');
  futurePieces.forEach((piece, index) => assertFrozenPieceType(piece, `future piece ${index}`));

  const board = capture.state.board.map((row) => [...row]);
  const currentPiece = clonePiece(capture.state.current);
  return {
    board,
    currentPiece,
    nextPiece: createPiece(capture.state.next),
    holdPiece: capture.state.hold,
    holdAvailable: capture.state.holdAvailable,
    unseenBagMask: capture.state.unseenBagMask,
    bag: [...futurePieces],
    score: capture.score,
    level: capture.level,
    lines: capture.lines,
    clearCounts: emptyLineClearCounts(),
    status: isGameOver(board, currentPiece) ? 'gameover' : 'playing',
    pieces: 0,
    heightSum: 0,
    strategyDiagnosticSum: emptyStrategyDiagnostics(),
    searchCalls: 0,
    holdActions: 0,
    completedDepthSum: 0,
    minCompletedDepth: 0,
    completedDepthHistogram: [0, 0, 0, 0, 0],
    totalWorkUnitsUsed: 0,
    maxWorkUnitsUsed: 0,
    budgetExhaustedSearches: 0,
    placementEvaluationUnits: 0,
    chanceExpansionUnits: 0,
    cacheHitUnits: 0,
    expandedDecisionNodes: 0,
    expandedChanceNodes: 0,
    cacheHits: 0,
    rng: () => { throw new Error('frozen future stream exhausted'); },
  };
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
  state.completedDepthHistogram[diagnostics.completedDepth]++;
  state.totalWorkUnitsUsed += diagnostics.workUnitsUsed;
  state.maxWorkUnitsUsed = Math.max(state.maxWorkUnitsUsed, diagnostics.workUnitsUsed);
  if (diagnostics.budgetExhausted) state.budgetExhaustedSearches++;
  state.placementEvaluationUnits += diagnostics.placementEvaluationUnits;
  state.chanceExpansionUnits += diagnostics.chanceExpansionUnits;
  state.cacheHitUnits += diagnostics.cacheHitUnits;
  state.expandedDecisionNodes += diagnostics.expandedDecisionNodes;
  state.expandedChanceNodes += diagnostics.expandedChanceNodes;
  state.cacheHits += diagnostics.cacheHits;
}

function clonePiece(piece: Piece): Piece {
  return { ...piece, position: { ...piece.position } };
}

function clonePublicSearchState(state: PublicSearchState): PublicSearchState {
  return {
    ...state,
    board: state.board.map((row) => [...row]),
    current: clonePiece(state.current),
  };
}

function cloneSearchDecision(decision: SearchDecision): SearchDecision {
  return {
    action: decision.action.kind === 'hold'
      ? { kind: 'hold' }
      : {
        kind: 'place',
        placement: {
          piece: clonePiece(decision.action.placement.piece),
          moves: [...decision.action.placement.moves],
        },
      },
    value: { ...decision.value },
    diagnostics: { ...decision.diagnostics },
  };
}

function simulationSearchDiagnostics(state: SimState): SimulationSearchDiagnostics {
  return {
    searchCalls: state.searchCalls,
    holdActions: state.holdActions,
    holdRate: state.searchCalls === 0 ? 0 : state.holdActions / state.searchCalls,
    meanCompletedDepth: state.searchCalls === 0 ? 0 : state.completedDepthSum / state.searchCalls,
    minCompletedDepth: state.searchCalls === 0 ? 0 : state.minCompletedDepth,
    completedDepthHistogram: [...state.completedDepthHistogram] as [number, number, number, number, number],
    totalWorkUnitsUsed: state.totalWorkUnitsUsed,
    meanWorkUnitsUsed: state.searchCalls === 0 ? 0 : state.totalWorkUnitsUsed / state.searchCalls,
    maxWorkUnitsUsed: state.maxWorkUnitsUsed,
    budgetExhaustedSearches: state.budgetExhaustedSearches,
    budgetExhaustionRate: state.searchCalls === 0 ? 0 : state.budgetExhaustedSearches / state.searchCalls,
    placementEvaluationUnits: state.placementEvaluationUnits,
    chanceExpansionUnits: state.chanceExpansionUnits,
    cacheHitUnits: state.cacheHitUnits,
    expandedDecisionNodes: state.expandedDecisionNodes,
    expandedChanceNodes: state.expandedChanceNodes,
  cacheHits: state.cacheHits,
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
  opts: SimulateFromStateOptions,
): SimResult {
  if (opts.weights.length !== FEATURE_COUNT) {
    throw new Error(`expected ${FEATURE_COUNT} weights, got ${opts.weights.length}`);
  }

  while (state.status === 'playing' && state.pieces < opts.maxPieces) {
    const publicState = projectPublicSearchState(state);
    const decision = searchBudgeted(publicState, opts.weights, opts.limits ?? DETERMINISTIC_SEARCH_LIMITS);
    if (decision === null) {
      state.status = 'gameover';
      break;
    }
    recordSearchDiagnostics(state, decision.diagnostics);
    opts.onDecision?.({
      publicState: clonePublicSearchState(publicState),
      decision: cloneSearchDecision(decision),
      scheduledPieceNumber: state.pieces + 1,
      score: state.score,
      lines: state.lines,
      level: state.level,
      searchDiagnostics: simulationSearchDiagnostics(state),
    });
    if (decision.action.kind === 'hold') {
      applyAction(state, 'hold');
      // Count only Holds that complete a valid decision cycle. A Hold may
      // promote a blocked piece and end the game before the action completes.
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
  depth?: 1 | 2;
}): SimResult {
  const state = createSimState(opts.seed);
  return simulateFromState(state, {
    weights: opts.weights,
    maxPieces: opts.maxPieces,
  });
}

/** Test-only shallow search injection; production callers use frozen limits. */
export function simulateGameWithSearchForTest(
  opts: { weights: number[]; seed: number; maxPieces: number },
  limits: SearchLimits,
): SimResult {
  return simulateFromState(createSimState(opts.seed), {
    weights: opts.weights,
    maxPieces: opts.maxPieces,
    limits,
  });
}
