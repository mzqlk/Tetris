import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../engine/board';
import { createPiece } from '../engine/piece';
import { TOTAL_ROWS } from '../constants';
import type { PieceType } from '../types';
import type { PendingPreviewState, PublicSearchState } from './publicState';
import { WorkBudgetLedger } from './searchBudget';
import {
  CappedCache,
  PlacementPrototypeCache,
  chanceSurvivalUpperBound,
  collapseEquivalentPlacements,
  decisionStateKey,
  occupancyBoardKey,
  pendingStateKey,
  placementPrototypeKey,
  materializePending,
  shouldPruneChance,
} from './searchCache';

const zeros = () => Array(13).fill(0);

function publicState(overrides: Partial<PublicSearchState> = {}): PublicSearchState {
  return {
    board: createEmptyBoard(),
    current: createPiece(1),
    next: 2,
    hold: null,
    holdAvailable: false,
    unseenBagMask: 0b1111100,
    ...overrides,
  };
}

function uniqueBoard(index: number) {
  const board = createEmptyBoard();
  const row = TOTAL_ROWS - 1 - (index % (TOTAL_ROWS - 1));
  const column = Math.floor(index / (TOTAL_ROWS - 1)) % 10;
  board[row][column] = 1;
  return board;
}

function pendingState(
  overrides: Partial<PendingPreviewState> = {},
): PendingPreviewState {
  return {
    board: createEmptyBoard(),
    current: createPiece(2),
    hold: null,
    holdAvailable: true,
    unseenBagMask: 0b1111100,
    ...overrides,
  };
}

function entry(
  pending: PendingPreviewState,
  immediateHeuristic: number,
  enumerationIndex: number,
  targetWellColumn: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | null = null,
) {
  return { pending, immediateHeuristic, enumerationIndex, targetWellColumn };
}

describe('search cache primitives', () => {
  it('encodes occupancy without retaining locked piece identities', () => {
    const left = createEmptyBoard();
    const sameOccupancy = createEmptyBoard();
    left[21][0] = 1;
    sameOccupancy[21][0] = 7;
    expect(occupancyBoardKey(left)).toBe(occupancyBoardKey(sameOccupancy));

    const differentCell = createEmptyBoard();
    differentCell[21][1] = 1;
    expect(occupancyBoardKey(left)).not.toBe(occupancyBoardKey(differentCell));
    expect(occupancyBoardKey(left)).toHaveLength(TOTAL_ROWS);
  });

  it('includes the complete current pose in the placement key', () => {
    const board = createEmptyBoard();
    const current = createPiece(1);
    expect(placementPrototypeKey(board, current)).not.toBe(
      placementPrototypeKey(board, {
        ...current,
        rotation: 1,
        position: { ...current.position, x: current.position.x + 1 },
      }),
    );
  });

  it('keeps continuation intent in decision and pending cache identities', () => {
    const decision = publicState();
    const pending = pendingState();

    expect(decisionStateKey(decision, 3, false, 4))
      .not.toBe(decisionStateKey(decision, 3, false, null));
    expect(pendingStateKey(pending, 2, false, 4))
      .not.toBe(pendingStateKey(pending, 2, false, 5));
  });

  it('reuses geometry and features across visible preview changes', () => {
    const cache = new PlacementPrototypeCache(zeros(), true);
    const firstState = publicState({ next: 2, hold: null, unseenBagMask: 0b1111100 });
    const secondState = {
      ...firstState,
      next: 3 as PieceType,
      hold: 7 as PieceType,
    };

    const first = cache.get(firstState, new WorkBudgetLedger(17));
    expect(first.kind).toBe('complete');
    if (first.kind !== 'complete') throw new Error('expected complete prototypes');
    const second = cache.get(secondState, new WorkBudgetLedger(1));
    expect(second.kind).toBe('complete');
    if (second.kind !== 'complete') throw new Error('expected complete prototypes');

    expect(second.prototypes).toBe(first.prototypes);
    expect(cache.hits).toBe(1);
    const pending = materializePending(second.prototypes[0], secondState);
    expect(pending.current).toEqual(createPiece(3));
    expect(pending.hold).toBe(7);
    expect(pending.unseenBagMask).toBe(secondState.unseenBagMask);
    expect(pending.holdAvailable).toBe(true);
  });

  it('does not retain more than its configured placement cache cap', () => {
    const cache = new PlacementPrototypeCache(zeros(), true, 2);
    for (let index = 0; index < 3; index++) {
      cache.get(
        publicState({ board: uniqueBoard(index) }),
        new WorkBudgetLedger(Number.MAX_SAFE_INTEGER),
      );
    }
    expect(cache.size).toBe(2);
  });

  it('never exceeds a capped cache and charges exactly one unit for a hit', () => {
    const cache = new CappedCache<number>(2, true);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.size).toBe(2);
    const ledger = new WorkBudgetLedger(1);
    expect(cache.get('a', ledger)).toEqual({ kind: 'hit', value: 1 });
    expect(cache.get('b', new WorkBudgetLedger(1))).toEqual({ kind: 'hit', value: 2 });
    expect(cache.get('c', new WorkBudgetLedger(1))).toEqual({ kind: 'miss' });
    expect(cache.hits).toBe(2);
    expect(ledger.snapshot()).toMatchObject({
      used: 1,
      cacheHitUnits: 1,
    });
  });

  it('does not insert or report hits when a capped cache is disabled', () => {
    const cache = new CappedCache<number>(2, false);
    cache.set('a', 1);
    expect(cache.get('a', new WorkBudgetLedger(1))).toEqual({ kind: 'miss' });
    expect(cache.size).toBe(0);
    expect(cache.hits).toBe(0);
  });

  it('does not publish a partial placement prototype cache entry', () => {
    const cache = new PlacementPrototypeCache(zeros(), true);
    const searchState = publicState({ current: createPiece(1) });
    const exhaustedLedger = new WorkBudgetLedger(16);

    expect(cache.get(searchState, exhaustedLedger)).toEqual({ kind: 'exhausted' });
    expect(cache.size).toBe(0);
    expect(cache.hits).toBe(0);
    expect(exhaustedLedger.snapshot()).toMatchObject({
      placementEvaluationUnits: 16,
      cacheHitUnits: 0,
    });

    const completeLedger = new WorkBudgetLedger(17);
    const rebuilt = cache.get(searchState, completeLedger);
    expect(rebuilt.kind).toBe('complete');
    if (rebuilt.kind !== 'complete') throw new Error('expected complete prototypes');
    expect(rebuilt.prototypes).toHaveLength(17);
    expect(cache.size).toBe(1);
    expect(completeLedger.snapshot()).toMatchObject({
      placementEvaluationUnits: 17,
      cacheHitUnits: 0,
    });

    const hitLedger = new WorkBudgetLedger(1);
    expect(cache.get(searchState, hitLedger).kind).toBe('complete');
    expect(hitLedger.snapshot()).toMatchObject({
      placementEvaluationUnits: 0,
      cacheHitUnits: 1,
    });
  });

  it('keeps only the dominant placement for an equivalent public future', () => {
    const shared = pendingState();
    const reduced = collapseEquivalentPlacements([
      entry(shared, 3, 4),
      entry(shared, 5, 7),
      entry({ ...shared, hold: 2 }, 4, 1),
    ], 3);

    expect(reduced.map(({ immediateHeuristic, enumerationIndex }) =>
      [immediateHeuristic, enumerationIndex])).toEqual([[5, 7], [4, 1]]);
  });

  it('keeps the earlier enumeration index when equivalent heuristics tie', () => {
    const shared = pendingState();
    expect(collapseEquivalentPlacements([
      entry(shared, 5, 2), entry(shared, 5, 1),
    ], 3)[0].enumerationIndex).toBe(1);
  });

  it('does not collapse placements with distinct continuation intents', () => {
    const shared = pendingState();
    expect(collapseEquivalentPlacements([
      entry(shared, 5, 1, 4), entry(shared, 5, 2, 5),
    ], 3)).toHaveLength(2);
  });

  it('prunes only a strictly worse survival upper bound', () => {
    expect(chanceSurvivalUpperBound(0.25, 0.5)).toBe(0.75);
    expect(shouldPruneChance(0.75, 0.8)).toBe(true);
    expect(shouldPruneChance(0.8, 0.8)).toBe(false);
    expect(shouldPruneChance(0.8 - 5e-13, 0.8)).toBe(false);
  });
});
