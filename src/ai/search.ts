import type { Board, Piece } from '../types';
import { isValidPosition } from '../engine/board';
import { createPiece } from '../engine/piece';
import { FEATURE_COUNT } from './features';
import { enumeratePlacements, type Placement } from './placements';
import {
  applyHold,
  evaluatePlacement,
  revealPreview,
} from './stateTransitions';
import {
  assertPublicSearchState,
  enumerateBagOutcomes,
  type PendingPreviewState,
  type PublicSearchState,
} from './publicState';

export type SearchAction =
  | { kind: 'place'; placement: Placement }
  | { kind: 'hold' };

export interface SearchValue {
  survivalProbability: number;
  expectedHeuristicValue: number;
}

export interface SearchDiagnostics {
  completedDepth: number;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
  aborted: boolean;
}

export interface SearchBudget {
  maxRootPlacements: number;
  maxChildPlacements: number;
  maxLockedDepth: 1 | 2 | 3 | 4;
  shouldAbort: () => boolean;
  cacheEnabled?: boolean;
}

export interface SearchDecision {
  action: SearchAction;
  value: SearchValue;
  diagnostics: SearchDiagnostics;
}

export const FIXED_SEARCH_LIMITS = Object.freeze({
  maxRootPlacements: 64,
  maxChildPlacements: 32,
  maxLockedDepth: 4 as const,
});

const TERMINAL_VALUE: SearchValue = Object.freeze({
  survivalProbability: 0,
  expectedHeuristicValue: 0,
});

interface SearchContext {
  weights: number[];
  budget: SearchBudget;
  diagnostics: SearchDiagnostics;
  cache: Map<string, SearchValue>;
}

interface NodeResult {
  value: SearchValue;
  completed: boolean;
  action: SearchAction | null;
}

interface RankedPlacement {
  placement: Placement;
  immediateHeuristic: number;
  pending: PendingPreviewState;
  enumerationIndex: number;
}

export function compareSearchValues(a: SearchValue, b: SearchValue): number {
  if (a.survivalProbability !== b.survivalProbability) {
    return a.survivalProbability - b.survivalProbability;
  }
  return a.expectedHeuristicValue - b.expectedHeuristicValue;
}

function validateBudget(budget: SearchBudget): void {
  if (!Number.isInteger(budget.maxRootPlacements) || budget.maxRootPlacements < 1) {
    throw new Error('maxRootPlacements must be a positive integer');
  }
  if (!Number.isInteger(budget.maxChildPlacements) || budget.maxChildPlacements < 1) {
    throw new Error('maxChildPlacements must be a positive integer');
  }
  if (![1, 2, 3, 4].includes(budget.maxLockedDepth)) {
    throw new Error('maxLockedDepth must be between 1 and 4');
  }
  if (typeof budget.shouldAbort !== 'function') {
    throw new Error('shouldAbort must be a function');
  }
}

function stateKey(
  kind: 'decision' | 'chance' | 'pending-leaf',
  state: PublicSearchState | PendingPreviewState,
  remainingDepth: number,
  root: boolean,
  budget: SearchBudget,
): string {
  const board = state.board.map((row) => row.join(',')).join(';');
  const current = state.current;
  const next = 'next' in state ? state.next : '-';
  return [
    kind,
    board,
    current.type,
    current.rotation,
    current.position.x,
    current.position.y,
    next,
    state.hold ?? '-',
    state.holdAvailable ? 1 : 0,
    state.unseenBagMask,
    remainingDepth,
    root ? 1 : 0,
    budget.maxRootPlacements,
    budget.maxChildPlacements,
  ].join('|');
}

function cachedResult(context: SearchContext, key: string): NodeResult | null {
  if (context.budget.cacheEnabled === false) return null;
  const value = context.cache.get(key);
  if (value === undefined) return null;
  context.diagnostics.cacheHits++;
  return { value, completed: true, action: null };
}

function cacheComplete(context: SearchContext, key: string, result: NodeResult): void {
  if (context.budget.cacheEnabled !== false && result.completed) {
    context.cache.set(key, result.value);
  }
}

function abortResult(context: SearchContext, best: NodeResult | null = null): NodeResult {
  context.diagnostics.aborted = true;
  return {
    value: best?.value ?? TERMINAL_VALUE,
    action: best?.action ?? null,
    completed: false,
  };
}

function rankPlacements(
  state: PublicSearchState,
  context: SearchContext,
  root: boolean,
): RankedPlacement[] {
  const limit = root
    ? context.budget.maxRootPlacements
    : context.budget.maxChildPlacements;
  return enumeratePlacements(state.board, state.current)
    .map((placement, enumerationIndex) => {
      const evaluated = evaluatePlacement(state, placement, context.weights);
      return {
        placement,
        immediateHeuristic: evaluated.heuristic,
        pending: evaluated.pending,
        enumerationIndex,
      };
    })
    .sort((a, b) =>
      b.immediateHeuristic - a.immediateHeuristic
      || a.enumerationIndex - b.enumerationIndex)
    .slice(0, limit);
}

function addImmediate(immediateHeuristic: number, future: SearchValue): SearchValue {
  return {
    survivalProbability: future.survivalProbability,
    expectedHeuristicValue:
      immediateHeuristic + future.expectedHeuristicValue,
  };
}

function betterResult(candidate: NodeResult, best: NodeResult | null): boolean {
  return best === null || compareSearchValues(candidate.value, best.value) > 0;
}

function searchChance(
  pending: PendingPreviewState,
  remainingDepth: number,
  root: boolean,
  context: SearchContext,
): NodeResult {
  if (context.budget.shouldAbort()) return abortResult(context);
  const key = stateKey('chance', pending, remainingDepth, root, context.budget);
  const cached = cachedResult(context, key);
  if (cached !== null) return cached;

  context.diagnostics.expandedChanceNodes++;
  let survivalProbability = 0;
  let expectedHeuristicValue = 0;
  for (const outcome of enumerateBagOutcomes(pending.unseenBagMask)) {
    if (context.budget.shouldAbort()) return abortResult(context);
    const revealed = revealPreview(pending, outcome.piece);
    const child = revealed === null
      ? { value: TERMINAL_VALUE, completed: true, action: null }
      : searchDecision(revealed, remainingDepth, root, context);
    if (!child.completed) return abortResult(context);
    survivalProbability += outcome.probability * child.value.survivalProbability;
    expectedHeuristicValue += outcome.probability * child.value.expectedHeuristicValue;
  }

  const result: NodeResult = {
    value: { survivalProbability, expectedHeuristicValue },
    completed: true,
    action: null,
  };
  cacheComplete(context, key, result);
  return result;
}

function searchPendingLeaf(
  pending: PendingPreviewState,
  root: boolean,
  context: SearchContext,
): NodeResult {
  if (context.budget.shouldAbort()) return abortResult(context);
  const key = stateKey('pending-leaf', pending, 1, root, context.budget);
  const cached = cachedResult(context, key);
  if (cached !== null) return cached;

  context.diagnostics.expandedDecisionNodes++;
  const syntheticState: PublicSearchState = {
    ...pending,
    // Depth-one evaluation never consumes this value; evaluatePlacement only
    // needs it to construct the unused post-lock pending state.
    next: pending.current.type,
  };
  let best: NodeResult | null = null;
  for (const ranked of rankPlacements(syntheticState, context, root)) {
    if (context.budget.shouldAbort()) return abortResult(context, best);
    const candidate: NodeResult = {
      value: {
        survivalProbability: 1,
        expectedHeuristicValue: ranked.immediateHeuristic,
      },
      completed: true,
      action: { kind: 'place', placement: ranked.placement },
    };
    if (betterResult(candidate, best)) best = candidate;
  }

  const result = best ?? { value: TERMINAL_VALUE, completed: true, action: null };
  cacheComplete(context, key, result);
  return result;
}

function searchDecision(
  state: PublicSearchState,
  remainingDepth: number,
  root: boolean,
  context: SearchContext,
): NodeResult {
  if (context.budget.shouldAbort()) return abortResult(context);
  const key = stateKey('decision', state, remainingDepth, root, context.budget);
  const cached = cachedResult(context, key);
  if (cached !== null) return cached;

  context.diagnostics.expandedDecisionNodes++;
  let best: NodeResult | null = null;
  for (const ranked of rankPlacements(state, context, root)) {
    if (context.budget.shouldAbort()) return abortResult(context, best);
    let future: NodeResult;
    if (remainingDepth === 1) {
      future = {
        value: { survivalProbability: 1, expectedHeuristicValue: 0 },
        completed: true,
        action: null,
      };
    } else {
      future = searchChance(ranked.pending, remainingDepth - 1, false, context);
    }
    if (!future.completed) return abortResult(context, best);

    const candidate: NodeResult = {
      value: addImmediate(ranked.immediateHeuristic, future.value),
      completed: true,
      action: { kind: 'place', placement: ranked.placement },
    };
    if (betterResult(candidate, best)) best = candidate;
  }

  const hold = applyHold(state);
  if (hold.kind !== 'unavailable') {
    if (context.budget.shouldAbort()) return abortResult(context, best);
    let held: NodeResult;
    if (hold.kind === 'ready') {
      held = searchDecision(hold.state, remainingDepth, root, context);
    } else if (remainingDepth === 1) {
      held = searchPendingLeaf(hold.state, root, context);
    } else {
      held = searchChance(hold.state, remainingDepth, root, context);
    }
    if (!held.completed) return abortResult(context, best);
    const candidate: NodeResult = {
      value: held.value,
      completed: true,
      action: { kind: 'hold' },
    };
    if (betterResult(candidate, best)) best = candidate;
  }

  const result = best ?? { value: TERMINAL_VALUE, completed: true, action: null };
  cacheComplete(context, key, result);
  return result;
}

export function searchFixed(
  state: PublicSearchState,
  weights: number[],
  budget: SearchBudget = {
    ...FIXED_SEARCH_LIMITS,
    shouldAbort: () => false,
  },
): SearchDecision | null {
  assertPublicSearchState(state);
  validateBudget(budget);
  if (weights.length !== FEATURE_COUNT || weights.some((weight) => !Number.isFinite(weight))) {
    throw new Error(`search weights must contain exactly ${FEATURE_COUNT} finite values`);
  }

  const diagnostics: SearchDiagnostics = {
    completedDepth: 0,
    expandedDecisionNodes: 0,
    expandedChanceNodes: 0,
    cacheHits: 0,
    aborted: false,
  };
  const context: SearchContext = {
    weights,
    budget,
    diagnostics,
    cache: new Map(),
  };
  const result = searchDecision(state, budget.maxLockedDepth, true, context);
  if (result.completed) diagnostics.completedDepth = budget.maxLockedDepth;
  if (result.action === null) return null;
  return { action: result.action, value: result.value, diagnostics };
}

export interface EvalResult {
  score: number;
  boardAfter: Board;
  linesCleared: number;
}

export interface Decision {
  placement: Placement;
  score: number;
}

/** lock -> clear -> extract features -> dot with the weight vector. */
export function evalMove(board: Board, placement: Placement, w: number[]): EvalResult {
  const transition = evaluatePlacement({
    board,
    current: placement.piece,
    next: placement.piece.type,
    hold: null,
    holdAvailable: true,
    unseenBagMask: 0,
  }, placement, w);
  return {
    score: transition.heuristic,
    boardAfter: transition.boardAfter,
    linesCleared: transition.linesCleared,
  };
}

/**
 * depth 1: argmax over placements of the current piece.
 * depth 2: argmax over p1 of [score(p1) + max over p2 of score(p2)].
 *
 * A p1 that leaves the next piece unable to spawn scores -Infinity. If every
 * branch is a dead end we still return the first placement rather than null —
 * null means "nowhere to put this piece at all", which is the game-over signal.
 *
 * Search depth and weights are coupled: weights trained at depth 1 misbehave at
 * depth 2, because the two value behaviours like "keep a well open for an I"
 * differently. Train and play at the same depth.
 */
export function bestPlacement(
  board: Board,
  current: Piece,
  next: Piece | null,
  w: number[],
  depth: 1 | 2,
): Decision | null {
  const options = enumeratePlacements(board, current);
  if (options.length === 0) return null;

  const lookahead = depth === 2 && next !== null;
  let best: Decision | null = null;

  for (const placement of options) {
    const { score, boardAfter } = evalMove(board, placement, w);
    let total = score;

    if (lookahead) {
      const nextSpawn = createPiece(next!.type);
      if (!isValidPosition(boardAfter, nextSpawn)) {
        total = -Infinity;
      } else {
        const followUps = enumeratePlacements(boardAfter, nextSpawn);
        if (followUps.length === 0) {
          total = -Infinity;
        } else {
          let bestNext = -Infinity;
          for (const followUp of followUps) {
            const s = evalMove(boardAfter, followUp, w).score;
            if (s > bestNext) bestNext = s;
          }
          total = score + bestNext;
        }
      }
    }

    if (best === null || total > best.score) best = { placement, score: total };
  }

  return best;
}
