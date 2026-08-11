import { describe, it, expect } from 'vitest';
import { evalMove, bestPlacement } from './search';
import { enumeratePlacements, cellKey } from './placements';
import { boardFrom } from './testUtils';
import { FEATURE_NAMES, FEATURE_COUNT } from './features';
import { createEmptyBoard, isValidPosition } from '../engine/board';
import { createPiece } from '../engine/piece';

const zeros = () => Array(FEATURE_COUNT).fill(0);
const only = (name: (typeof FEATURE_NAMES)[number], value = 1) => {
  const w = zeros();
  w[FEATURE_NAMES.indexOf(name)] = value;
  return w;
};

describe('evalMove', () => {
  it('scores the dot product of features and weights', () => {
    const board = boardFrom(['.#########']);
    const placement = enumeratePlacements(board, createPiece(1))
      .find((p) => cellKey(p.piece).includes(String(21 * 10 + 0)))!;
    expect(placement).toBeDefined();
    expect(evalMove(board, placement, only('linesCleared')).score).toBe(1);
  });

  it('reports the cleared line count and the post-clear board', () => {
    const board = boardFrom(['.#########']);
    let cleared = 0;
    for (const p of enumeratePlacements(board, createPiece(1))) {
      const r = evalMove(board, p, zeros());
      if (r.linesCleared > 0) {
        cleared = r.linesCleared;
        // old row 20 (piece cell in column 0 only) must have shifted down into index 21
        expect(r.boardAfter[21][0]).toBe(1);
        expect(r.boardAfter[21].slice(1).every((c) => c === 0)).toBe(true);
      }
    }
    expect(cleared).toBe(1);
  });

  it('does not mutate the board it is given', () => {
    const board = boardFrom(['.#########']);
    const before = JSON.stringify(board);
    for (const p of enumeratePlacements(board, createPiece(1))) {
      evalMove(board, p, only('holes'));
    }
    expect(JSON.stringify(board)).toBe(before);
  });
});

describe('bestPlacement', () => {
  it('selects the legal placement with the greatest Tetris setup progress', () => {
    const board = boardFrom(['#########.', '#########.']);
    const piece = createPiece(2);
    const weights = only('tetrisSetupProgress');
    const optionScores = enumeratePlacements(board, piece)
      .map((placement) => evalMove(board, placement, weights).score);
    const decision = bestPlacement(board, piece, null, weights, 1)!;
    expect(decision.score).toBe(Math.max(...optionScores));
    expect(decision.score).toBeGreaterThan(0);
  });

  it('returns null when there is nowhere to put the piece', () => {
    const full = boardFrom(Array(22).fill('##########'));
    expect(bestPlacement(full, createPiece(1), null, zeros(), 1)).toBeNull();
  });

  it('picks the line clear when line clears are all that is rewarded', () => {
    const board = boardFrom(['.#########']);
    const decision = bestPlacement(board, createPiece(1), null, only('linesCleared'), 1)!;
    expect(evalMove(board, decision.placement, only('linesCleared')).linesCleared).toBe(1);
  });

  it('always returns one of the enumerated placements', () => {
    const board = boardFrom(['..#.......', '..#....#..', '##.#####.#']);
    const legal = new Set(
      enumeratePlacements(board, createPiece(6)).map((p) => cellKey(p.piece)),
    );
    const decision = bestPlacement(board, createPiece(6), createPiece(3), only('holes', -1), 2)!;
    expect(legal.has(cellKey(decision.placement.piece))).toBe(true);
  });

  it('falls back to depth 1 when there is no next piece', () => {
    const board = boardFrom(['..#.......', '##.#####.#']);
    const w = only('holes', -1);
    const d1 = bestPlacement(board, createPiece(7), null, w, 1)!;
    const d2 = bestPlacement(board, createPiece(7), null, w, 2)!;
    expect(cellKey(d2.placement.piece)).toBe(cellKey(d1.placement.piece));
    expect(d2.score).toBe(d1.score);
  });

  it('avoids a placement that leaves the next piece unable to spawn', () => {
    // Rows 2..21 are full except column 0, so column 0 is a 20-deep shaft.
    // Weights reward a TALLER board, which lures depth 1 into resting a
    // horizontal I on top of the stack — that fills the spawn area and ends
    // the game. Depth 2 sees the dead end and drops into the shaft instead.
    const board = boardFrom(Array(20).fill('.#########'));
    const piece = createPiece(1);
    const w = only('maxHeight');

    const d1 = bestPlacement(board, piece, piece, w, 1)!;
    const d2 = bestPlacement(board, piece, piece, w, 2)!;

    const after1 = evalMove(board, d1.placement, w);
    const after2 = evalMove(board, d2.placement, w);

    expect(isValidPosition(after1.boardAfter, createPiece(1))).toBe(false);
    expect(isValidPosition(after2.boardAfter, createPiece(1))).toBe(true);
    expect(after2.linesCleared).toBe(4);
  });

  it('still returns a placement when every branch is a dead end', () => {
    const board = boardFrom(Array(20).fill('.#########'));
    // No next piece can ever spawn, so every 2-ply branch scores -Infinity.
    const decision = bestPlacement(board, createPiece(2), createPiece(2), zeros(), 2);
    expect(decision).not.toBeNull();
  });
});

describe('empty board sanity', () => {
  it('keeps the board flat when bumpiness is penalised', () => {
    const w = only('bumpiness', -1);
    const decision = bestPlacement(createEmptyBoard(), createPiece(1), null, w, 1)!;
    // A horizontal I on a flat floor leaves bumpiness at 4; vertical leaves 8.
    expect(decision.placement.piece.rotation % 2).toBe(0);
  });
});
