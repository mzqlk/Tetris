import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../engine/board';
import { createPiece } from '../engine/piece';
import type { PieceType } from '../types';
import { enumeratePlacements } from './placements';
import type { PublicSearchState } from './publicState';
import { applyHold, lockPlacement, revealPreview } from './stateTransitions';

function publicState(overrides: Partial<PublicSearchState> = {}): PublicSearchState {
  return {
    board: createEmptyBoard(),
    current: createPiece(1),
    next: 2,
    hold: null,
    holdAvailable: true,
    unseenBagMask: 0b1111111,
    ...overrides,
  };
}

describe('standard Hold transitions', () => {
  it('empty Hold promotes next and requests exactly one preview', () => {
    const result = applyHold(publicState({ current: createPiece(1), next: 4, hold: null }));

    expect(result).toMatchObject({
      kind: 'pending-preview',
      state: { current: createPiece(4), hold: 1, holdAvailable: false },
    });
  });

  it('non-empty Hold swaps without consuming next or bag mask', () => {
    const before = publicState({
      current: createPiece(2),
      next: 6,
      hold: 1,
      unseenBagMask: 0b1010100,
    });

    const result = applyHold(before);

    expect(result).toMatchObject({
      kind: 'ready',
      state: {
        current: createPiece(1),
        next: 6,
        hold: 2,
        holdAvailable: false,
        unseenBagMask: 0b1010100,
      },
    });
    expect(before.current.type).toBe(2);
  });

  it('returns unavailable for a spent Hold without mutating the public state', () => {
    const before = publicState({ holdAvailable: false, hold: 1 });
    const snapshot = structuredClone(before);
    expect(applyHold(before)).toEqual({ kind: 'unavailable' });
    expect(before).toEqual(snapshot);
  });
});

describe('lock and preview transitions', () => {
  it('locking restores Hold and never mutates shared board rows', () => {
    const before = publicState({ holdAvailable: false });
    const row = before.board[21];
    const transition = lockPlacement(
      before,
      enumeratePlacements(before.board, before.current)[0],
    );

    expect(transition.pending.holdAvailable).toBe(true);
    expect(before.board[21]).toBe(row);
    expect(transition.boardAfter[21]).not.toBe(row);
  });

  it('rejects a placement for a piece other than the current piece', () => {
    const state = publicState({ current: createPiece(1) });
    const wrongPiecePlacement = enumeratePlacements(state.board, createPiece(2))[0];

    expect(() => lockPlacement(state, wrongPiecePlacement)).toThrow(/current piece/i);
  });

  it('reveals the required preview and rejects a contradictory public reveal', () => {
    const pending = lockPlacement(
      publicState({ next: 4, unseenBagMask: 0b0001000 }),
      enumeratePlacements(createEmptyBoard(), createPiece(1))[0],
    ).pending;

    expect(revealPreview(pending, 4 as PieceType)).toMatchObject({ next: 4, unseenBagMask: 0 });
    expect(() => revealPreview(pending, 3 as PieceType)).toThrow(/public bag/i);
  });

  it('returns null when the promoted current cannot spawn after revealing a preview', () => {
    const pending = lockPlacement(
      publicState({ next: 4 }),
      enumeratePlacements(createEmptyBoard(), createPiece(1))[0],
    ).pending;
    const blockedBoard = pending.board.map((row) => [...row]);
    blockedBoard[0][4] = 7;

    expect(revealPreview({ ...pending, board: blockedBoard }, 5)).toBeNull();
  });
});
