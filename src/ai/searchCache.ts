import type { Board, Piece } from '../types';
import { createPiece } from '../engine/piece';
import { FEATURE_COUNT } from './features';
import { enumeratePlacements, type Placement } from './placements';
import {
  evaluatePlacement,
} from './stateTransitions';
import type { PendingPreviewState, PublicSearchState } from './publicState';

export const MAX_TRANSPOSITION_ENTRIES = 65_536;
export const MAX_PLACEMENT_CACHE_ENTRIES = 16_384;

export interface PlacementPrototype {
  placement: Placement;
  enumerationIndex: number;
  immediateHeuristic: number;
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

  get(key: string): V | undefined {
    if (!this.enabled) return undefined;
    const value = this.values.get(key);
    if (value !== undefined) this.hitCount++;
    return value;
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
  ].join('|');
}

export function pendingStateKey(
  state: PendingPreviewState,
  remainingDepth: number,
  root: boolean,
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
  ].join('|');
}

export class PlacementPrototypeCache {
  private readonly values: CappedCache<readonly PlacementPrototype[]>;

  constructor(
    private readonly weights: number[],
    enabled: boolean,
  ) {
    if (weights.length !== FEATURE_COUNT || weights.some((weight) => !Number.isFinite(weight))) {
      throw new Error(`placement cache weights must contain exactly ${FEATURE_COUNT} finite values`);
    }
    this.values = new CappedCache(MAX_PLACEMENT_CACHE_ENTRIES, enabled);
  }

  get(state: PublicSearchState): readonly PlacementPrototype[] {
    const key = placementPrototypeKey(state.board, state.current);
    const cached = this.values.get(key);
    if (cached !== undefined) return cached;

    const prototypes = enumeratePlacements(state.board, state.current).map((placement, enumerationIndex) => {
      const evaluated = evaluatePlacement(state, placement, this.weights);
      return Object.freeze({
        placement,
        enumerationIndex,
        immediateHeuristic: evaluated.heuristic,
        boardAfter: evaluated.boardAfter,
      });
    });
    this.values.set(key, prototypes);
    return prototypes;
  }

  get size(): number {
    return this.values.size;
  }

  get hits(): number {
    return this.values.hits;
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
