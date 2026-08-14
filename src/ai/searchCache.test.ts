import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../engine/board';
import { createPiece } from '../engine/piece';
import { TOTAL_ROWS } from '../constants';
import type { PieceType } from '../types';
import type { PublicSearchState } from './publicState';
import {
  MAX_PLACEMENT_CACHE_ENTRIES,
  PlacementPrototypeCache,
  occupancyBoardKey,
  placementPrototypeKey,
  materializePending,
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

  it('reuses geometry and features across visible preview changes', () => {
    const cache = new PlacementPrototypeCache(zeros(), true);
    const firstState = publicState({ next: 2, hold: null, unseenBagMask: 0b1111100 });
    const secondState = {
      ...firstState,
      next: 3 as PieceType,
      hold: 7 as PieceType,
    };

    const first = cache.get(firstState);
    const second = cache.get(secondState);

    expect(second).toBe(first);
    expect(cache.hits).toBe(1);
    const pending = materializePending(second[0], secondState);
    expect(pending.current).toEqual(createPiece(3));
    expect(pending.hold).toBe(7);
    expect(pending.unseenBagMask).toBe(secondState.unseenBagMask);
    expect(pending.holdAvailable).toBe(true);
  });

  it('does not retain more than the production placement cache cap', () => {
    const cache = new PlacementPrototypeCache(zeros(), true);
    for (let index = 0; index < MAX_PLACEMENT_CACHE_ENTRIES + 1; index++) {
      cache.get(publicState({ board: uniqueBoard(index) }));
    }
    expect(cache.size).toBeLessThanOrEqual(MAX_PLACEMENT_CACHE_ENTRIES);
  });
});
