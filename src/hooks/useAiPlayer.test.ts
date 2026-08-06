import { describe, it, expect } from 'vitest';
import {
  advanceAiPlan,
  type AiPlan,
  expectedPose,
  isPlanValid,
  planPlacement,
} from './useAiPlayer';
import { boardFrom } from '../ai/testUtils';
import { toVector, HANDCRAFTED_WEIGHTS } from '../ai/weights';
import { samePiece } from '../ai/replay';
import { createEmptyBoard } from '../engine/board';
import { createPiece, movePiece } from '../engine/piece';
import { cellKey, projectHardDrop } from '../ai/placements';

const W = toVector(HANDCRAFTED_WEIGHTS);

describe('planPlacement', () => {
  it('returns a plan whose path matches its move list', () => {
    const board = createEmptyBoard();
    const plan = planPlacement(board, createPiece(3), createPiece(5), W, 2)!;
    expect(plan).not.toBeNull();
    expect(plan.path).toHaveLength(plan.moves.length);
    expect(plan.cursor).toBe(0);
  });

  it('stores a locked target reached by hard-dropping the path endpoint', () => {
    const board = boardFrom(['..#.......', '##.#####.#']);
    const origin = createPiece(7);
    const plan = planPlacement(board, origin, null, W, 1)!;
    const preDrop = plan.path.at(-1) ?? origin;

    expect(cellKey(projectHardDrop(board, preDrop))).toBe(cellKey(plan.target));
    expect(movePiece(board, plan.target, 0, 1)).toBeNull();
  });

  it('returns null when the piece cannot be placed anywhere', () => {
    const full = boardFrom(Array(22).fill('##########'));
    expect(planPlacement(full, createPiece(1), null, W, 1)).toBeNull();
  });
});

describe('advanceAiPlan', () => {
  it('hard-drops in the same call as the final positioning move', () => {
    const origin = createPiece(1);
    const plan: AiPlan = {
      moves: ['rotate'],
      path: [{ ...origin, rotation: 1 }],
      cursor: 0,
      origin,
      target: { ...origin, rotation: 1, position: { x: 3, y: 18 } },
    };
    const events: string[] = [];

    const placed = advanceAiPlan(
      plan,
      (move) => events.push(move),
      () => events.push('hardDrop'),
    );

    expect(placed).toBe(true);
    expect(events).toEqual(['rotate', 'hardDrop']);
    expect(plan.cursor).toBe(1);
  });

  it('hard-drops an empty positioning plan immediately', () => {
    const origin = createPiece(2);
    const plan: AiPlan = { moves: [], path: [], cursor: 0, origin, target: origin };
    const events: string[] = [];

    expect(advanceAiPlan(plan, () => events.push('move'), () => events.push('hardDrop')))
      .toBe(true);
    expect(events).toEqual(['hardDrop']);
  });

  it('waits after a non-final positioning move', () => {
    const origin = createPiece(2);
    const plan: AiPlan = {
      moves: ['left', 'left'],
      path: [origin, origin],
      cursor: 0,
      origin,
      target: origin,
    };
    const events: string[] = [];

    expect(advanceAiPlan(plan, (move) => events.push(move), () => events.push('hardDrop')))
      .toBe(false);
    expect(events).toEqual(['left']);
    expect(plan.cursor).toBe(1);
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
