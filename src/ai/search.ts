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
import {
  DEPTH_ONE_REQUIRED_WORK_UNITS,
  DETERMINISTIC_SEARCH_LIMITS,
  WorkBudgetLedger,
  type SearchLimits,
} from './searchBudget';
import type { WorkBudgetSnapshot } from './searchBudget';
import {
  selectHorizonPlacementBeam,
  type BeamSource,
  type HorizonBeamLimits,
  type TargetWellColumn,
} from './horizonPolicy';

export { SURVIVAL_EPSILON } from './searchCache';
/** @deprecated Protected v1 probe compatibility only. */
export {
  MAX_PLACEMENT_CACHE_ENTRIES,
  MAX_TRANSPOSITION_ENTRIES,
} from './searchCache';

export type SearchAction =
  | { kind: 'place'; placement: Placement }
  | { kind: 'hold' };

export interface SearchValue {
  survivalProbability: number;
  expectedHeuristicValue: number;
}

export interface SearchDiagnostics {
  completedDepth: 0 | 1 | 2 | 3 | 4;
  attemptedDepth: 1 | 2 | 3 | 4;
  workUnitsUsed: number;
  workUnitsLimit: number;
  placementEvaluationUnits: number;
  chanceExpansionUnits: number;
  cacheHitUnits: number;
  budgetExhausted: boolean;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
  placementCacheHits: number;
  placementCacheEntries: number;
  transpositionEntries: number;
  equivalentPlacementsRemoved: number;
  prunedChanceBranches: number;
  /** @deprecated Protected probe compile compatibility only. */
  aborted: boolean;
}

/** @deprecated Protected v1 probe compatibility only. */
export interface LegacyFixedSearchBudget {
  maxRootPlacements: number;
  maxChildPlacements: number;
  maxLockedDepth: 1 | 2 | 3 | 4;
  shouldAbort: () => boolean;
  cacheEnabled?: boolean;
}

/** @deprecated Protected v1 probe compatibility only. */
export type SearchBudget = LegacyFixedSearchBudget;

export interface SearchDecision {
  action: SearchAction;
  value: SearchValue;
  diagnostics: SearchDiagnostics;
}

export interface HorizonSearchLimits extends HorizonBeamLimits {
  maxLockedDepth: 1 | 2 | 3 | 4;
  maxWorkUnits: number;
  transpositionCacheEntries: number;
  placementCacheEntries: number;
}

export interface CompletedDepthTrace {
  depth: 1 | 2 | 3 | 4;
  actionKind: 'place' | 'hold';
  beamSource: BeamSource | 'hold';
  targetWellColumn: TargetWellColumn;
  value: SearchValue;
  work: WorkBudgetSnapshot;
}

export interface HorizonSearchTrace {
  completedDepths: readonly CompletedDepthTrace[];
  rootStrategyTargetColumns: readonly number[];
  strategySlotsRetained: number;
  strategySlotsDeduplicated: number;
  strategySlotsPruned: number;
  targetWellEstablished: number;
  targetWellReset: number;
  targetWellInvalidated: number;
}

interface MutableHorizonTrace {
  completedDepths: CompletedDepthTrace[];
  rootStrategyTargetColumns: number[];
  strategySlotsRetained: number;
  strategySlotsDeduplicated: number;
  strategySlotsPruned: number;
  targetWellEstablished: number;
  targetWellReset: number;
  targetWellInvalidated: number;
}

export interface HorizonSearchDecision extends SearchDecision {
  trace: HorizonSearchTrace;
}

/** @deprecated Protected v1 caller compatibility only. */
export interface LegacySearchDiagnostics {
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

/** @deprecated Protected v1 caller compatibility only. */
export interface LegacySearchDecision {
  action: SearchAction;
  value: SearchValue;
  diagnostics: LegacySearchDiagnostics;
}

/** @deprecated Protected v1 probe compatibility only. */
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
  budget: InternalSearchBudget;
  diagnostics: SearchDiagnostics;
  ledger: WorkBudgetLedger;
  cache: CappedCache<SearchValue>;
  placementCache: PlacementPrototypeCache;
  policy: SearchPolicy;
}

type SearchPolicy =
  | { kind: 'score-only'; root: number; child: number }
  | { kind: 'horizon'; limits: HorizonBeamLimits; trace: MutableHorizonTrace };

interface InternalSearchBudget {
  maxRootPlacements: number;
  maxChildPlacements: number;
  maxLockedDepth: 1 | 2 | 3 | 4;
  transpositionCacheEntries: number;
  placementCacheEntries: number;
  cacheEnabled: boolean;
}

interface NodeResult {
  value: SearchValue;
  completed: boolean;
  action: SearchAction | null;
  dominated?: boolean;
  enumerationIndex?: number;
  beamSource?: BeamSource;
  targetWellColumn?: TargetWellColumn;
}

interface RankedPlacement {
  placement: Placement;
  immediateHeuristic: number;
  pending: PendingPreviewState;
  enumerationIndex: number;
  linesCleared: number;
  boardAfter: Board;
  beamSource: BeamSource;
  targetWellColumn: TargetWellColumn;
}

export function summarizeStrategySlotAccounting<T extends { beamSource: BeamSource }>(
  beam: readonly T[],
  reduced: readonly T[],
): {
  strategySlotsRetained: number;
  strategySlotsDeduplicated: number;
  strategySlotsPruned: number;
} {
  return {
    strategySlotsRetained: beam.filter((entry) => entry.beamSource === 'strategy').length,
    strategySlotsDeduplicated: beam.filter((entry) => entry.beamSource === 'both').length,
    strategySlotsPruned: beam.filter((entry) =>
      (entry.beamSource === 'strategy' || entry.beamSource === 'both') && !reduced.includes(entry)).length,
  };
}

export interface PlacementBeamEntry {
  immediateHeuristic: number;
  enumerationIndex: number;
}

export function selectPlacementBeam<T extends PlacementBeamEntry>(
  entries: T[],
  root: boolean,
  budget: Pick<SearchLimits, 'maxRootPlacements' | 'maxChildPlacements'>,
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

function validateLimits(budget: Pick<SearchLimits,
  'maxLockedDepth' | 'maxWorkUnits' | 'transpositionCacheEntries' | 'placementCacheEntries'>): void {
  if (![1, 2, 3, 4].includes(budget.maxLockedDepth)) {
    throw new Error('maxLockedDepth must be between 1 and 4');
  }
  if (!Number.isSafeInteger(budget.maxWorkUnits) || budget.maxWorkUnits < 1) {
    throw new Error('maxWorkUnits must be a positive safe integer');
  }
  if (budget.maxWorkUnits < DEPTH_ONE_REQUIRED_WORK_UNITS) {
    throw new Error('work budget must cover depth one');
  }
  for (const [name, value] of [
    ['transpositionCacheEntries', budget.transpositionCacheEntries],
    ['placementCacheEntries', budget.placementCacheEntries],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }
}

function validateScorePolicy(policy: Extract<SearchPolicy, { kind: 'score-only' }>): void {
  if (!Number.isInteger(policy.root) || policy.root < 1) {
    throw new Error('maxRootPlacements must be a positive integer');
  }
  if (!Number.isInteger(policy.child) || policy.child < 1) {
    throw new Error('maxChildPlacements must be a positive integer');
  }
}

function cachedResult(context: SearchContext, key: string): NodeResult | null {
  const lookup = context.cache.get(key, context.ledger);
  if (lookup.kind === 'miss') return null;
  if (lookup.kind === 'exhausted') return budgetExhaustedResult(context);
  return { value: lookup.value, completed: true, action: null };
}

function cacheComplete(context: SearchContext, key: string, result: NodeResult): void {
  if (result.completed && result.dominated !== true) {
    context.cache.set(key, result.value);
  }
}

function budgetExhaustedResult(context: SearchContext): NodeResult {
  context.diagnostics.budgetExhausted = true;
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
  currentIntent: TargetWellColumn,
): RankedPlacement[] | null {
  const lookup = context.placementCache.get(state, context.ledger);
  if (lookup.kind === 'exhausted') return null;
  const entries = lookup.prototypes.map((prototype) => ({
    placement: prototype.placement,
    immediateHeuristic: prototype.immediateHeuristic,
    pending: materializePending(prototype, state),
    enumerationIndex: prototype.enumerationIndex,
    linesCleared: prototype.linesCleared,
    boardAfter: prototype.boardAfter,
  }));
  const beam: RankedPlacement[] = context.policy.kind === 'score-only'
    ? selectPlacementBeam(entries, root, {
      maxRootPlacements: context.policy.root,
      maxChildPlacements: context.policy.child,
    }).map((entry) => ({ ...entry, beamSource: 'score' as const, targetWellColumn: null }))
    : selectHorizonPlacementBeam(
      entries.map((entry) => ({
        value: entry,
        enumerationIndex: entry.enumerationIndex,
        immediateHeuristic: entry.immediateHeuristic,
        linesCleared: entry.linesCleared,
        boardAfter: entry.boardAfter,
      })),
      state.board,
      root,
      currentIntent,
      context.policy.limits,
    ).map((entry) => ({
      ...entry.value,
      beamSource: entry.beamSource,
      targetWellColumn: entry.targetWellColumn,
    }));
  if (context.policy.kind === 'horizon') {
    const trace = context.policy.trace;
    if (root) {
      for (const column of beam
        .filter((entry) =>
          (entry.beamSource === 'strategy' || entry.beamSource === 'both')
          && entry.targetWellColumn !== null)
        .map((entry) => entry.targetWellColumn as number)) {
        if (!trace.rootStrategyTargetColumns.includes(column)) {
          trace.rootStrategyTargetColumns.push(column);
          trace.rootStrategyTargetColumns.sort((left, right) => left - right);
        }
      }
    }
    const unprunedAccounting = summarizeStrategySlotAccounting(beam, beam);
    trace.strategySlotsRetained += unprunedAccounting.strategySlotsRetained;
    trace.strategySlotsDeduplicated += unprunedAccounting.strategySlotsDeduplicated;
    for (const entry of beam) {
      if (currentIntent === null && entry.targetWellColumn !== null) {
        trace.targetWellEstablished++;
      } else if (currentIntent !== null && entry.targetWellColumn === null) {
        if (entry.linesCleared === 4) trace.targetWellReset++;
        else trace.targetWellInvalidated++;
      }
    }
  }
  if (context.budget.cacheEnabled === false) return beam;
  const reduced = collapseEquivalentPlacements(beam, remainingDepth);
  context.diagnostics.equivalentPlacementsRemoved += beam.length - reduced.length;
  if (context.policy.kind === 'horizon') {
    context.policy.trace.strategySlotsPruned += summarizeStrategySlotAccounting(
      beam,
      reduced,
    ).strategySlotsPruned;
  }
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

function betterResult(
  candidate: NodeResult,
  best: NodeResult | null,
  context: SearchContext,
): boolean {
  if (best === null) return true;
  const comparison = compareSearchValues(candidate.value, best.value);
  if (comparison !== 0) return comparison > 0;
  if (context.policy.kind === 'score-only') return false;
  if (candidate.action?.kind !== 'place') return false;
  if (best.action?.kind === 'hold') return true;
  return best.action?.kind === 'place'
    && (candidate.enumerationIndex ?? Number.MAX_SAFE_INTEGER)
      < (best.enumerationIndex ?? Number.MAX_SAFE_INTEGER);
}

function searchChance(
  pending: PendingPreviewState,
  remainingDepth: number,
  root: boolean,
  context: SearchContext,
  currentIntent: TargetWellColumn,
  incumbentSurvival: number | null = null,
): NodeResult {
  const key = `chance|${pendingStateKey(pending, remainingDepth, root, currentIntent)}`;
  const cached = cachedResult(context, key);
  if (cached !== null) return cached;

  context.diagnostics.expandedChanceNodes++;
  let survivalProbability = 0;
  let expectedHeuristicValue = 0;
  let remainingProbability = 1;
  for (const outcome of enumerateBagOutcomes(pending.unseenBagMask)) {
    if (!context.ledger.tryConsume('chanceExpansion')) return budgetExhaustedResult(context);
    const revealed = revealPreview(pending, outcome.piece);
    const child = revealed === null
      ? { value: TERMINAL_VALUE, completed: true, action: null }
      : searchDecision(revealed, remainingDepth, root, context, currentIntent);
    if (!child.completed) return child;
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
  currentIntent: TargetWellColumn,
): NodeResult {
  const key = `pending-leaf|${pendingStateKey(pending, 1, root, currentIntent)}`;
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
  const rankedPlacements = rankPlacements(syntheticState, context, root, 1, currentIntent);
  if (rankedPlacements === null) return budgetExhaustedResult(context);
  for (const ranked of rankedPlacements) {
    const candidate: NodeResult = {
      value: {
        survivalProbability: 1,
        expectedHeuristicValue: ranked.immediateHeuristic,
      },
      completed: true,
      action: { kind: 'place', placement: ranked.placement },
      enumerationIndex: ranked.enumerationIndex,
      beamSource: ranked.beamSource,
      targetWellColumn: ranked.targetWellColumn,
    };
    if (betterResult(candidate, best, context)) best = candidate;
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
  currentIntent: TargetWellColumn,
): NodeResult {
  const key = decisionStateKey(state, remainingDepth, root, currentIntent);
  const cached = cachedResult(context, key);
  if (cached !== null) return cached;

  context.diagnostics.expandedDecisionNodes++;
  let best: NodeResult | null = null;
  const rankedPlacements = rankPlacements(state, context, root, remainingDepth, currentIntent);
  if (rankedPlacements === null) return budgetExhaustedResult(context);
  for (const ranked of rankedPlacements) {
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
        ranked.targetWellColumn,
        best?.value.survivalProbability ?? null,
      );
    }
    if (!future.completed) return future;
    if (future.dominated === true) continue;

    const candidate: NodeResult = {
      value: addImmediate(ranked.immediateHeuristic, future.value),
      completed: true,
      action: { kind: 'place', placement: ranked.placement },
      enumerationIndex: ranked.enumerationIndex,
      beamSource: ranked.beamSource,
      targetWellColumn: ranked.targetWellColumn,
    };
    if (betterResult(candidate, best, context)) best = candidate;
  }

  const hold = applyHold(state);
  if (hold.kind !== 'unavailable') {
    let held: NodeResult;
    if (hold.kind === 'ready') {
      held = searchDecision(hold.state, remainingDepth, root, context, currentIntent);
    } else if (remainingDepth === 1) {
      held = searchPendingLeaf(hold.state, root, context, currentIntent);
    } else {
      held = searchChance(
        hold.state,
        remainingDepth,
        root,
        context,
        currentIntent,
        best?.value.survivalProbability ?? null,
      );
    }
    if (!held.completed) return held;
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
    if (betterResult(candidate, best, context)) best = candidate;
  }

  const result = best ?? { value: TERMINAL_VALUE, completed: true, action: null };
  cacheComplete(context, key, result);
  return result;
}

function emptySearchDiagnostics(): SearchDiagnostics {
  return {
    completedDepth: 0,
    attemptedDepth: 1,
    workUnitsUsed: 0,
    workUnitsLimit: 0,
    placementEvaluationUnits: 0,
    chanceExpansionUnits: 0,
    cacheHitUnits: 0,
    budgetExhausted: false,
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
  budget: InternalSearchBudget,
  ledger: WorkBudgetLedger,
  diagnostics: SearchDiagnostics,
  policy: SearchPolicy,
): SearchContext {
  return {
    budget,
    ledger,
    diagnostics,
    cache: new CappedCache(budget.transpositionCacheEntries, budget.cacheEnabled),
    placementCache: new PlacementPrototypeCache(
      weights,
      budget.cacheEnabled,
      budget.placementCacheEntries,
    ),
    policy,
  };
}

function finishDiagnostics(context: SearchContext): void {
  syncCacheDiagnostics(context);
  const snapshot = context.ledger.snapshot();
  context.diagnostics.workUnitsUsed = snapshot.used;
  context.diagnostics.workUnitsLimit = snapshot.limit;
  context.diagnostics.placementEvaluationUnits = snapshot.placementEvaluationUnits;
  context.diagnostics.chanceExpansionUnits = snapshot.chanceExpansionUnits;
  context.diagnostics.cacheHitUnits = snapshot.cacheHitUnits;
  context.diagnostics.aborted = context.diagnostics.budgetExhausted;
}

function validateWeights(weights: number[]): void {
  if (weights.length !== FEATURE_COUNT || weights.some((weight) => !Number.isFinite(weight))) {
    throw new Error(`search weights must contain exactly ${FEATURE_COUNT} finite values`);
  }
}

function legacyLimits(budget: LegacyFixedSearchBudget): SearchLimits {
  return {
    maxRootPlacements: budget.maxRootPlacements,
    maxChildPlacements: budget.maxChildPlacements,
    maxLockedDepth: budget.maxLockedDepth,
    maxWorkUnits: Number.MAX_SAFE_INTEGER,
    transpositionCacheEntries: MAX_TRANSPOSITION_ENTRIES,
    placementCacheEntries: 16_384,
  };
}

/** @deprecated Never import from production consumers or execute in verification. */
export function searchFixed(
  state: PublicSearchState,
  weights: number[],
  budget: LegacyFixedSearchBudget = {
    ...FIXED_SEARCH_LIMITS,
    shouldAbort: () => false,
  },
): SearchDecision | null {
  const limits = legacyLimits(budget);
  return runBudgeted(state, weights, limits, budget.cacheEnabled !== false, {
    kind: 'score-only', root: limits.maxRootPlacements, child: limits.maxChildPlacements,
  });
}

/** Browser entry point: progressively deepen and publish only complete depths. */
export function searchBudgeted(
  state: PublicSearchState,
  weights: number[],
  limits: SearchLimits = DETERMINISTIC_SEARCH_LIMITS,
): SearchDecision | null {
  return runBudgeted(state, weights, limits, true, {
    kind: 'score-only', root: limits.maxRootPlacements, child: limits.maxChildPlacements,
  });
}

export function searchHorizonBudgeted(
  state: PublicSearchState,
  weights: number[],
  limits: HorizonSearchLimits,
): HorizonSearchDecision | null {
  const trace: MutableHorizonTrace = {
    completedDepths: [],
    rootStrategyTargetColumns: [],
    strategySlotsRetained: 0,
    strategySlotsDeduplicated: 0,
    strategySlotsPruned: 0,
    targetWellEstablished: 0,
    targetWellReset: 0,
    targetWellInvalidated: 0,
  };
  const decision = runBudgeted(state, weights, limits, true, {
    kind: 'horizon', limits, trace,
  });
  return decision === null ? null : {
    ...decision,
    trace: {
      ...trace,
      completedDepths: [...trace.completedDepths],
      rootStrategyTargetColumns: [...trace.rootStrategyTargetColumns],
    },
  };
}

function runBudgeted(
  state: PublicSearchState,
  weights: number[],
  limits: Pick<SearchLimits,
    'maxLockedDepth' | 'maxWorkUnits' | 'transpositionCacheEntries' | 'placementCacheEntries'>,
  cacheEnabled: boolean,
  policy: SearchPolicy,
): SearchDecision | null {
  assertPublicSearchState(state);
  validateLimits(limits);
  validateWeights(weights);
  if (policy.kind === 'score-only') {
    validateScorePolicy(policy);
  } else {
    selectHorizonPlacementBeam([], state.board, true, null, policy.limits);
  }

  const diagnostics = emptySearchDiagnostics();
  const context = createSearchContext(weights, {
    maxRootPlacements: policy.kind === 'score-only' ? policy.root : 0,
    maxChildPlacements: policy.kind === 'score-only' ? policy.child : 0,
    maxLockedDepth: limits.maxLockedDepth,
    transpositionCacheEntries: limits.transpositionCacheEntries,
    placementCacheEntries: limits.placementCacheEntries,
    cacheEnabled,
  }, new WorkBudgetLedger(limits.maxWorkUnits), diagnostics, policy);
  let committed: SearchDecision | null = null;
  for (let depth = 1; depth <= limits.maxLockedDepth; depth++) {
    const cacheCheckpoint = policy.kind === 'horizon' ? {
      transposition: context.cache.snapshotEntries(),
      placement: context.placementCache.snapshotEntries(),
    } : null;
    diagnostics.attemptedDepth = depth as 1 | 2 | 3 | 4;
    const result = searchDecision(state, depth, true, context, null);
    if (!result.completed) {
      if (cacheCheckpoint !== null) {
        context.cache.restoreEntries(cacheCheckpoint.transposition);
        context.placementCache.restoreEntries(cacheCheckpoint.placement);
      }
      diagnostics.budgetExhausted = true;
      if (depth === 1) throw new Error('depth-one work budget invariant violated');
      break;
    }
    diagnostics.completedDepth = depth as 1 | 2 | 3 | 4;
    if (result.action !== null) {
      committed = { action: result.action, value: result.value, diagnostics };
      if (policy.kind === 'horizon') {
        policy.trace.completedDepths.push({
          depth: depth as 1 | 2 | 3 | 4,
          actionKind: result.action.kind,
          beamSource: result.action.kind === 'hold' ? 'hold' : result.beamSource ?? 'score',
          targetWellColumn: result.action.kind === 'hold' ? null : result.targetWellColumn ?? null,
          value: result.value,
          work: context.ledger.snapshot(),
        });
      }
    }
  }
  finishDiagnostics(context);
  return committed;
}

/** @deprecated Protected v1 caller compatibility only. */
export function searchIterative(
  state: PublicSearchState,
  weights: number[],
  budget: LegacyFixedSearchBudget,
): LegacySearchDecision | null {
  return searchFixed(state, weights, budget);
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
