import type { Board, Piece } from '../types';
import { createPiece } from '../engine/piece';
import { FEATURE_COUNT } from './features';
import { enumeratePlacements, type Placement } from './placements';
import {
  evaluatePlacement,
} from './stateTransitions';
import type { PendingPreviewState, PublicSearchState } from './publicState';
import type { WorkBudgetLedger } from './searchBudget';
import type { TargetWellColumn } from './horizonPolicy';

/** @deprecated Protected v1 probe compatibility only. */
export const MAX_TRANSPOSITION_ENTRIES = 65_536;
/** @deprecated Protected v1 probe compatibility only. */
export const MAX_PLACEMENT_CACHE_ENTRIES = 16_384;
export const SURVIVAL_EPSILON = 1e-12;

export type CacheLookup<V> =
  | { kind: 'hit'; value: V }
  | { kind: 'miss' }
  | { kind: 'exhausted' };

export type PlacementPrototypeLookup =
  | { kind: 'complete'; prototypes: readonly PlacementPrototype[] }
  | { kind: 'exhausted' };

export interface PlacementPrototype {
  placement: Placement;
  enumerationIndex: number;
  immediateHeuristic: number;
  linesCleared: number;
  boardAfter: Board;
}

/**
 * A bounded exact cache. Eviction is intentionally not used: retaining the
 * first complete values keeps hit behavior deterministic, while a miss after
 * the cap simply recomputes the same pure subproblem.
 */
export class CappedCache<V> {
  private readonly values = new Map<string, V>();
  private hitCount = 0;

  constructor(
    private readonly limit: number,
    private readonly enabled: boolean,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error('cache limit must be a non-negative safe integer');
    }
  }

  get(key: string, ledger?: WorkBudgetLedger): CacheLookup<V> {
    if (!this.enabled) return { kind: 'miss' };
    const value = this.values.get(key);
    if (value === undefined) return { kind: 'miss' };
    if (ledger !== undefined && !ledger.tryConsume('cacheHit')) {
      return { kind: 'exhausted' };
    }
    this.hitCount++;
    return { kind: 'hit', value };
  }

  set(key: string, value: V): void {
    if (!this.enabled || this.values.size >= this.limit || this.values.has(key)) return;
    this.values.set(key, value);
  }

  get size(): number {
    return this.values.size;
  }

  get hits(): number {
    return this.hitCount;
  }

  snapshotEntries(): [string, V][] {
    return [...this.values.entries()];
  }

  restoreEntries(entries: readonly (readonly [string, V])[]): void {
    this.values.clear();
    for (const [key, value] of entries) this.values.set(key, value);
  }
}

/**
 * The search reads occupancy only; locked piece type values do not affect any
 * engine validity or feature calculation. A 0x400 offset keeps packed row
 * characters away from the ASCII separators used by composite keys.
 */
export function occupancyBoardKey(board: Board): string {
  return String.fromCharCode(...board.map((row) => {
    let mask = 0;
    for (let column = 0; column < row.length; column++) {
      if (row[column] !== 0) mask |= 1 << column;
    }
    return mask + 0x400;
  }));
}

function pieceKey(piece: Piece): string {
  return `${piece.type},${piece.rotation},${piece.position.x},${piece.position.y}`;
}

export function placementPrototypeKey(board: Board, current: Piece): string {
  return `${occupancyBoardKey(board)}|${pieceKey(current)}`;
}

export function decisionStateKey(
  state: PublicSearchState,
  remainingDepth: number,
  root: boolean,
  targetWellColumn: TargetWellColumn = null,
): string {
  const usesNext = remainingDepth > 1
    || (state.holdAvailable && state.hold === null);
  const usesHold = remainingDepth > 1 || state.holdAvailable;
  const usesMask = remainingDepth > 1;
  return [
    'decision',
    occupancyBoardKey(state.board),
    pieceKey(state.current),
    usesNext ? state.next : '-',
    usesHold ? (state.hold ?? '-') : '-',
    state.holdAvailable ? 1 : 0,
    usesMask ? state.unseenBagMask : '-',
    remainingDepth,
    root ? 1 : 0,
    'intent',
    targetWellColumn ?? '-',
  ].join('|');
}

export function pendingStateKey(
  state: PendingPreviewState,
  remainingDepth: number,
  root: boolean,
  targetWellColumn: TargetWellColumn = null,
): string {
  return [
    'pending',
    occupancyBoardKey(state.board),
    pieceKey(state.current),
    state.hold ?? '-',
    state.holdAvailable ? 1 : 0,
    remainingDepth,
    root ? 1 : 0,
    // Pending states always feed an exact chance node, so the public mask is
    // relevant even when the revealed preview is not later consumed by Hold.
    state.unseenBagMask,
    'intent',
    targetWellColumn ?? '-',
  ].join('|');
}

export function collapseEquivalentPlacements<T extends {
  pending: PendingPreviewState;
  immediateHeuristic: number;
  enumerationIndex: number;
  targetWellColumn: TargetWellColumn;
}>(entries: readonly T[], remainingDepth: number): T[] {
  const dominant = new Map<string, T>();
  for (const entry of entries) {
    const key = pendingStateKey(entry.pending, remainingDepth, false, entry.targetWellColumn);
    const existing = dominant.get(key);
    if (existing === undefined
      || entry.immediateHeuristic > existing.immediateHeuristic
      || (entry.immediateHeuristic === existing.immediateHeuristic
        && entry.enumerationIndex < existing.enumerationIndex)) {
      dominant.set(key, entry);
    }
  }
  return [...dominant.values()].sort((left, right) =>
    right.immediateHeuristic - left.immediateHeuristic
    || left.enumerationIndex - right.enumerationIndex);
}

export function chanceSurvivalUpperBound(
  accumulatedSurvival: number,
  remainingProbability: number,
): number {
  return accumulatedSurvival + Math.max(0, remainingProbability);
}

export function shouldPruneChance(
  survivalUpperBound: number,
  incumbentSurvival: number,
): boolean {
  return survivalUpperBound < incumbentSurvival - SURVIVAL_EPSILON;
}

export class PlacementPrototypeCache {
  private readonly values: CappedCache<readonly PlacementPrototype[]>;

  constructor(
    private readonly weights: number[],
    enabled: boolean,
    placementCacheEntries = MAX_PLACEMENT_CACHE_ENTRIES,
  ) {
    if (weights.length !== FEATURE_COUNT || weights.some((weight) => !Number.isFinite(weight))) {
      throw new Error(`placement cache weights must contain exactly ${FEATURE_COUNT} finite values`);
    }
    this.values = new CappedCache(placementCacheEntries, enabled);
  }

  get(
    state: PublicSearchState,
    ledger: WorkBudgetLedger,
  ): PlacementPrototypeLookup {
    const key = placementPrototypeKey(state.board, state.current);
    const cached = this.values.get(key, ledger);
    if (cached.kind === 'hit') return { kind: 'complete', prototypes: cached.value };
    if (cached.kind === 'exhausted') return cached;

    const placements = enumeratePlacements(state.board, state.current);
    const prototypes: PlacementPrototype[] = [];
    for (const [enumerationIndex, placement] of placements.entries()) {
      if (!ledger.tryConsume('placementEvaluation')) return { kind: 'exhausted' };
      const evaluated = evaluatePlacement(state, placement, this.weights);
      prototypes.push(Object.freeze({
        placement,
        enumerationIndex,
        immediateHeuristic: evaluated.heuristic,
        linesCleared: evaluated.linesCleared,
        boardAfter: evaluated.boardAfter,
      }));
    }
    this.values.set(key, prototypes);
    return { kind: 'complete', prototypes };
  }

  get size(): number {
    return this.values.size;
  }

  get hits(): number {
    return this.values.hits;
  }

  snapshotEntries(): [string, readonly PlacementPrototype[]][] {
    return this.values.snapshotEntries();
  }

  restoreEntries(entries: readonly (readonly [string, readonly PlacementPrototype[]])[]): void {
    this.values.restoreEntries(entries);
  }
}

export function materializePending(
  prototype: PlacementPrototype,
  state: PublicSearchState,
): PendingPreviewState {
  return {
    board: prototype.boardAfter,
    current: createPiece(state.next),
    hold: state.hold,
    holdAvailable: true,
    unseenBagMask: state.unseenBagMask,
  };
}
