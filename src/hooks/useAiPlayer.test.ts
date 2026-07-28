import { describe, it, expect } from 'vitest';
import { planPlacement, expectedPose, isPlanValid } from './useAiPlayer';
import { boardFrom } from '../ai/testUtils';
import { toVector, HANDCRAFTED_WEIGHTS } from '../ai/weights';
import { samePiece } from '../ai/replay';
import { createEmptyBoard } from '../engine/board';
import { createPiece, movePiece } from '../engine/piece';

const W = toVector(HANDCRAFTED_WEIGHTS);

describe('planPlacement', () => {
  it('returns a plan whose path matches its move list', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(3), createPiece(5), W, 2)!;
    expect(plan).not.toBeNull();
    expect(plan.path).toHaveLength(plan.moves.length);
    expect(plan.cursor).toBe(0);
  });

  it('ends at a pose that cannot move down', () => {
    const board = boardFrom(['..#.......', '##.#####.#']);
    const plan = planPlacement(board, createPiece(7), null, W, 1)!;
    const last = plan.path.length === 0 ? plan.origin : plan.path[plan.path.length - 1];
    expect(movePiece(board, last, 0, 1)).toBeNull();
  });

  it('returns null when the piece cannot be placed anywhere', () => {
    const full = boardFrom(Array(22).fill('##########'));
    expect(planPlacement(full, createPiece(1), null, W, 1)).toBeNull();
  });
});

describe('plan validation', () => {
  it('expects the origin pose before the first move', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(6), null, W, 1)!;
    expect(samePiece(expectedPose(plan), plan.origin)).toBe(true);
  });

  it('expects the previous path entry once execution has started', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(6), null, W, 1)!;
    plan.cursor = 2;
    expect(samePiece(expectedPose(plan), plan.path[1])).toBe(true);
  });

  it('accepts a plan while the piece is where the plan expects it', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(6), null, W, 1)!;
    expect(isPlanValid(plan, plan.origin)).toBe(true);
  });

  it('rejects a plan once gravity has pulled the piece down', () => {
    const board = createEmptyBoard();
    const origin = createPiece(6);
    const plan = planPlacement(board, origin, null, W, 1)!;
    const pulled = movePiece(board, origin, 0, 1)!;
    expect(isPlanValid(plan, pulled)).toBe(false);
  });

  it('rejects a plan when the piece type changed underneath it', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(6), null, W, 1)!;
    expect(isPlanValid(plan, createPiece(7))).toBe(false);
  });

  it('rejects a finished plan so the caller hard-drops instead of stepping past the end', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(6), null, W, 1)!;
    plan.cursor = plan.moves.length + 1;
    expect(isPlanValid(plan, plan.origin)).toBe(false);
  });
});
