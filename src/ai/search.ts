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
import {
  CappedCache,
  chanceSurvivalUpperBound,
  collapseEquivalentPlacements,
  decisionStateKey,
  materializePending,
  MAX_TRANSPOSITION_ENTRIES,
  PlacementPrototypeCache,
  pendingStateKey,
  shouldPruneChance,
  SURVIVAL_EPSILON,
} from './searchCache';

export { SURVIVAL_EPSILON } from './searchCache';

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
  placementCacheHits: number;
  placementCacheEntries: number;
  transpositionEntries: number;
  equivalentPlacementsRemoved: number;
  prunedChanceBranches: number;
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

/**
 * Floating-point tolerance for the survival-first ordering. A depth-four
 * seven-bag path has probability denominator at most 7*6*5*4 = 840, so the
 * smallest genuine rational gap is >= 1/840. This 1e-12 tolerance is many
 * orders smaller and only absorbs IEEE-754 accumulation noise.
 */
const TERMINAL_VALUE: SearchValue = Object.freeze({
  survivalProbability: 0,
  expectedHeuristicValue: 0,
});

interface SearchContext {
  budget: SearchBudget;
  diagnostics: SearchDiagnostics;
  cache: CappedCache<SearchValue>;
  placementCache: PlacementPrototypeCache;
}

interface NodeResult {
  value: SearchValue;
  completed: boolean;
  action: SearchAction | null;
  dominated?: boolean;
}

interface RankedPlacement {
  placement: Placement;
  immediateHeuristic: number;
  pending: PendingPreviewState;
  enumerationIndex: number;
}

export interface PlacementBeamEntry {
  immediateHeuristic: number;
  enumerationIndex: number;
}

export function selectPlacementBeam<T extends PlacementBeamEntry>(
  entries: T[],
  root: boolean,
  budget: SearchBudget,
): T[] {
  const limit = root ? budget.maxRootPlacements : budget.maxChildPlacements;
  return [...entries]
    .sort((a, b) => b.immediateHeuristic - a.immediateHeuristic
      || a.enumerationIndex - b.enumerationIndex)
    .slice(0, limit);
}

export function compareSearchValues(a: SearchValue, b: SearchValue): number {
  const normalizeSurvival = (value: number): number => {
    if (Math.abs(value) <= SURVIVAL_EPSILON) return 0;
    if (Math.abs(1 - value) <= SURVIVAL_EPSILON) return 1;
    return value;
  };
  const survivalDelta = normalizeSurvival(a.survivalProbability)
    - normalizeSurvival(b.survivalProbability);
  if (Math.abs(survivalDelta) > SURVIVAL_EPSILON) return survivalDelta;
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

function cachedResult(context: SearchContext, key: string): NodeResult | null {
  const value = context.cache.get(key);
  if (value === undefined) return null;
  return { value, completed: true, action: null };
}

function cacheComplete(context: SearchContext, key: string, result: NodeResult): void {
  if (result.completed && result.dominated !== true) {
    context.cache.set(key, result.value);
  }
}

function abortResult(context: SearchContext, best: NodeResult | null = null): NodeResult {
  void best;
  context.diagnostics.aborted = true;
  return {
    value: TERMINAL_VALUE,
    action: null,
    completed: false,
  };
}

function rankPlacements(
  state: PublicSearchState,
  context: SearchContext,
  root: boolean,
  remainingDepth: number,
): RankedPlacement[] {
  const entries = context.placementCache.get(state).map((prototype) => ({
    placement: prototype.placement,
    immediateHeuristic: prototype.immediateHeuristic,
    pending: materializePending(prototype, state),
    enumerationIndex: prototype.enumerationIndex,
  }));
  const beam = selectPlacementBeam(entries, root, context.budget);
  if (context.budget.cacheEnabled === false) return beam;
  const reduced = collapseEquivalentPlacements(beam, remainingDepth);
  context.diagnostics.equivalentPlacementsRemoved += beam.length - reduced.length;
  return reduced;
}

function dominatedResult(context: SearchContext): NodeResult {
  context.diagnostics.prunedChanceBranches++;
  return {
    value: TERMINAL_VALUE,
    action: null,
    completed: true,
    dominated: true,
  };
}

function syncCacheDiagnostics(context: SearchContext): void {
  context.diagnostics.cacheHits = context.cache.hits;
  context.diagnostics.placementCacheHits = context.placementCache.hits;
  context.diagnostics.placementCacheEntries = context.placementCache.size;
  context.diagnostics.transpositionEntries = context.cache.size;
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
  incumbentSurvival: number | null = null,
): NodeResult {
  if (context.budget.shouldAbort()) return abortResult(context);
  const key = `chance|${pendingStateKey(pending, remainingDepth, root)}`;
  const cached = cachedResult(context, key);
  if (cached !== null) return cached;

  context.diagnostics.expandedChanceNodes++;
  let survivalProbability = 0;
  let expectedHeuristicValue = 0;
  let remainingProbability = 1;
  for (const outcome of enumerateBagOutcomes(pending.unseenBagMask)) {
    if (context.budget.shouldAbort()) return abortResult(context);
    const revealed = revealPreview(pending, outcome.piece);
    const child = revealed === null
      ? { value: TERMINAL_VALUE, completed: true, action: null }
      : searchDecision(revealed, remainingDepth, root, context);
    if (!child.completed) return abortResult(context);
    survivalProbability += outcome.probability * child.value.survivalProbability;
    expectedHeuristicValue += outcome.probability * child.value.expectedHeuristicValue;
    remainingProbability -= outcome.probability;
    if (context.budget.cacheEnabled !== false && incumbentSurvival !== null && shouldPruneChance(
      chanceSurvivalUpperBound(survivalProbability, remainingProbability),
      incumbentSurvival,
    )) {
      return dominatedResult(context);
    }
  }

  const result: NodeResult = {
    value: {
      survivalProbability: Math.abs(survivalProbability) <= SURVIVAL_EPSILON
        ? 0
        : Math.abs(1 - survivalProbability) <= SURVIVAL_EPSILON ? 1 : survivalProbability,
      expectedHeuristicValue,
    },
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
  const key = `pending-leaf|${pendingStateKey(pending, 1, root)}`;
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
  for (const ranked of rankPlacements(syntheticState, context, root, 1)) {
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
  const key = decisionStateKey(state, remainingDepth, root);
  const cached = cachedResult(context, key);
  if (cached !== null) return cached;

  context.diagnostics.expandedDecisionNodes++;
  let best: NodeResult | null = null;
  for (const ranked of rankPlacements(state, context, root, remainingDepth)) {
    if (context.budget.shouldAbort()) return abortResult(context, best);
    let future: NodeResult;
    if (remainingDepth === 1) {
      future = {
        value: { survivalProbability: 1, expectedHeuristicValue: 0 },
        completed: true,
        action: null,
      };
    } else {
      future = searchChance(
        ranked.pending,
        remainingDepth - 1,
        false,
        context,
        best?.value.survivalProbability ?? null,
      );
    }
    if (!future.completed) return abortResult(context, best);
    if (future.dominated === true) continue;

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
      held = searchChance(
        hold.state,
        remainingDepth,
        root,
        context,
        best?.value.survivalProbability ?? null,
      );
    }
    if (!held.completed) return abortResult(context, best);
    if (held.dominated === true) {
      const result = best ?? { value: TERMINAL_VALUE, completed: true, action: null };
      cacheComplete(context, key, result);
      return result;
    }
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

function emptySearchDiagnostics(): SearchDiagnostics {
  return {
    completedDepth: 0,
    expandedDecisionNodes: 0,
    expandedChanceNodes: 0,
    cacheHits: 0,
    placementCacheHits: 0,
    placementCacheEntries: 0,
    transpositionEntries: 0,
    equivalentPlacementsRemoved: 0,
    prunedChanceBranches: 0,
    aborted: false,
  };
}

function createSearchContext(
  weights: number[],
  budget: SearchBudget,
  diagnostics: SearchDiagnostics,
): SearchContext {
  const cacheEnabled = budget.cacheEnabled !== false;
  return {
    budget,
    diagnostics,
    cache: new CappedCache(MAX_TRANSPOSITION_ENTRIES, cacheEnabled),
    placementCache: new PlacementPrototypeCache(weights, cacheEnabled),
  };
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

  const diagnostics = emptySearchDiagnostics();
  const context = createSearchContext(weights, budget, diagnostics);
  const result = searchDecision(state, budget.maxLockedDepth, true, context);
  syncCacheDiagnostics(context);
  if (result.completed) diagnostics.completedDepth = budget.maxLockedDepth;
  if (result.completed && result.action !== null) {
    return { action: result.action, value: result.value, diagnostics };
  }
  if (!result.completed) {
    const fallbackDiagnostics = emptySearchDiagnostics();
    const fallbackBudget: SearchBudget = {
      ...budget,
      maxLockedDepth: 1,
      shouldAbort: () => false,
    };
    const fallbackContext = createSearchContext(weights, fallbackBudget, fallbackDiagnostics);
    const fallback = searchDecision(state, 1, true, fallbackContext);
    syncCacheDiagnostics(fallbackContext);
    diagnostics.expandedDecisionNodes += fallbackDiagnostics.expandedDecisionNodes;
    diagnostics.expandedChanceNodes += fallbackDiagnostics.expandedChanceNodes;
    diagnostics.cacheHits += fallbackDiagnostics.cacheHits;
    diagnostics.placementCacheHits += fallbackDiagnostics.placementCacheHits;
    diagnostics.placementCacheEntries += fallbackDiagnostics.placementCacheEntries;
    diagnostics.transpositionEntries += fallbackDiagnostics.transpositionEntries;
    diagnostics.completedDepth = fallback.completed ? 1 : 0;
    if (fallback.action !== null) {
      return { action: fallback.action, value: fallback.value, diagnostics };
    }
  }
  return null;
}

function completePlacementFallback(
  state: PublicSearchState,
  weights: number[],
): { action: SearchAction; value: SearchValue } | null {
  const placements = enumeratePlacements(state.board, state.current);
  let best: { action: SearchAction; value: SearchValue; index: number } | null = null;
  placements.forEach((placement, index) => {
    const evaluated = evaluatePlacement(state, placement, weights);
    const candidate = {
      action: { kind: 'place' as const, placement },
      value: { survivalProbability: 1, expectedHeuristicValue: evaluated.heuristic },
      index,
    };
    if (best === null
      || compareSearchValues(candidate.value, best.value) > 0
      || (compareSearchValues(candidate.value, best.value) === 0 && index < best.index)) {
      best = candidate;
    }
  });
  if (best === null) return null;
  const selected = best as { action: SearchAction; value: SearchValue; index: number };
  return { action: selected.action, value: selected.value };
}

/** Browser entry point: progressively deepen and publish only complete depths. */
export function searchIterative(
  state: PublicSearchState,
  weights: number[],
  budget: SearchBudget,
): SearchDecision | null {
  assertPublicSearchState(state);
  validateBudget(budget);
  if (weights.length !== FEATURE_COUNT || weights.some((weight) => !Number.isFinite(weight))) {
    throw new Error(`search weights must contain exactly ${FEATURE_COUNT} finite values`);
  }

  const diagnostics = emptySearchDiagnostics();
  const context = createSearchContext(weights, budget, diagnostics);
  let committed: SearchDecision | null = null;
  let aborted = false;
  for (let depth = 1; depth <= budget.maxLockedDepth; depth++) {
    const result = searchDecision(state, depth, true, context);
    if (!result.completed) {
      aborted = true;
      diagnostics.aborted = true;
      break;
    }
    if (result.action !== null) {
      diagnostics.completedDepth = depth;
      committed = { action: result.action, value: result.value, diagnostics };
    }
  }
  syncCacheDiagnostics(context);
  if (committed !== null) return committed;

  diagnostics.aborted = aborted;
  const fallback = completePlacementFallback(state, weights);
  if (fallback === null) return null;
  return { ...fallback, diagnostics };
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
