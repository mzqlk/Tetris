import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../engine/board';
import { createPiece } from '../engine/piece';
import {
  assertPublicSearchState,
  enumerateBagOutcomes,
  FULL_BAG_MASK,
  initialUnseenBagMask,
  revealPiece,
} from './publicState';
import type { PublicSearchState } from './publicState';

describe('public seven-bag state', () => {
  it('tracks two initial reveals from one seven-bag', () => {
    const mask = initialUnseenBagMask(1, 4);
    expect(enumerateBagOutcomes(mask).map((o) => o.piece)).toEqual([2, 3, 5, 6, 7]);
  });

  it('opens a fresh bag only when the visible bag is exhausted', () => {
    const outcomes = enumerateBagOutcomes(0);
    expect(outcomes).toHaveLength(7);
    expect(outcomes.every((o) => o.probability === 1 / 7)).toBe(true);
    expect(outcomes.find((o) => o.piece === 3)!.nextMask).toBe(
      FULL_BAG_MASK & ~(1 << (3 - 1)),
    );
  });

  it('rejects a reveal that contradicts a non-empty public mask', () => {
    expect(() => revealPiece(1 << (2 - 1), 3)).toThrow(/public bag/i);
  });

  it('rejects invalid public search state values without changing the state', () => {
    const state = {
      board: createEmptyBoard(),
      current: createPiece(1),
      next: 2,
      hold: null,
      holdAvailable: true,
      unseenBagMask: FULL_BAG_MASK,
    };

    expect(() => assertPublicSearchState({ ...state, unseenBagMask: 128 } as PublicSearchState)).toThrow();
    expect(() => assertPublicSearchState({ ...state, board: [[Infinity]] } as PublicSearchState)).toThrow();
    expect(() => assertPublicSearchState({ ...state, next: 8 } as unknown as PublicSearchState)).toThrow();
    expect(() => assertPublicSearchState({ ...state, holdAvailable: 1 } as unknown as PublicSearchState)).toThrow();
    expect(state).toEqual({
      board: createEmptyBoard(),
      current: createPiece(1),
      next: 2,
      hold: null,
      holdAvailable: true,
      unseenBagMask: FULL_BAG_MASK,
    });
  });
});
