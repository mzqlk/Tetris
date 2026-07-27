import { describe, it, expect } from 'vitest';
import { enumeratePlacements, cellKey } from './placements';
import { projectPath, samePiece } from './replay';
import { boardFrom } from './testUtils';
import { createEmptyBoard, isValidPosition } from '../engine/board';
import { createPiece, movePiece } from '../engine/piece';
import { BOARD_WIDTH } from '../constants';
import type { Board, Piece, PieceType } from '../types';

const EMPTY = createEmptyBoard();
const ALL_TYPES: PieceType[] = [1, 2, 3, 4, 5, 6, 7];

/** Rotate-then-hard-drop enumeration: the naive alternative BFS has to beat. */
function naiveKeys(board: Board, spawn: Piece): Set<string> {
  const out = new Set<string>();
  for (let rotation = 0; rotation < 4; rotation++) {
    for (let x = -3; x <= BOARD_WIDTH; x++) {
      const start: Piece = { type: spawn.type, rotation, position: { x, y: spawn.position.y } };
      if (!isValidPosition(board, start)) continue;
      let cur = start;
      for (;;) {
        const down = movePiece(board, cur, 0, 1);
        if (!down) break;
        cur = down;
      }
      out.add(cellKey(cur));
    }
  }
  return out;
}

describe('enumeratePlacements on an empty board', () => {
  // Verified against the real engine. Without cell-set dedup O would be 36
  // (four identical rotations) and I would be 34 (two identical bar states).
  const EXPECTED: Record<PieceType, number> = { 1: 17, 2: 9, 3: 34, 4: 17, 5: 17, 6: 34, 7: 34 };

  for (const type of ALL_TYPES) {
    it(`finds ${EXPECTED[type]} deduplicated placements for piece ${type}`, () => {
      expect(enumeratePlacements(EMPTY, createPiece(type))).toHaveLength(EXPECTED[type]);
    });
  }

  it('returns no duplicate cell sets', () => {
    for (const type of ALL_TYPES) {
      const placements = enumeratePlacements(EMPTY, createPiece(type));
      expect(new Set(placements.map((p) => cellKey(p.piece))).size).toBe(placements.length);
    }
  });
});

describe('placement invariants', () => {
  const BOARDS: [string, Board][] = [
    ['empty', EMPTY],
    ['tuck', boardFrom(['....######', '....######', '.....#####'])],
    ['jagged', boardFrom(['..#.......', '..#....#..', '##.#####.#'])],
  ];

  for (const [name, board] of BOARDS) {
    it(`every placement on the ${name} board is a resting position`, () => {
      for (const type of ALL_TYPES) {
        for (const p of enumeratePlacements(board, createPiece(type))) {
          expect(isValidPosition(board, p.piece)).toBe(true);
          expect(movePiece(board, p.piece, 0, 1)).toBeNull();
        }
      }
    });

    it(`replaying the move sequence on the ${name} board reproduces the placement`, () => {
      for (const type of ALL_TYPES) {
        const spawn = createPiece(type);
        for (const p of enumeratePlacements(board, spawn)) {
          const path = projectPath(board, spawn, p.moves);
          expect(path).toHaveLength(p.moves.length);
          const landed = path.length === 0 ? spawn : path[path.length - 1];
          expect(samePiece(landed, p.piece)).toBe(true);
        }
      }
    });
  }
});

describe('reachability', () => {
  it('returns an empty array when the spawn position is blocked', () => {
    const full = boardFrom(Array(22).fill('##########'));
    expect(enumeratePlacements(full, createPiece(1))).toEqual([]);
  });

  it('finds tuck placements that rotate-then-hard-drop cannot reach', () => {
    //  row 19:  ....######
    //  row 20:  ....######
    //  row 21:  .....#####     <- (21,4) is roofed over by (19,4)/(20,4)
    const board = boardFrom(['....######', '....######', '.....#####']);
    const spawn = createPiece(1); // I piece

    const bfs = new Set(enumeratePlacements(board, spawn).map((p) => cellKey(p.piece)));
    const naive = naiveKeys(board, spawn);

    // Slide down columns 0-3, then step right to tuck into the roofed cell.
    const tuck = [21 * BOARD_WIDTH + 1, 21 * BOARD_WIDTH + 2,
                  21 * BOARD_WIDTH + 3, 21 * BOARD_WIDTH + 4].join(',');

    expect(bfs.has(tuck)).toBe(true);
    expect(naive.has(tuck)).toBe(false);
    expect(bfs.size).toBeGreaterThan(naive.size);
  });

  it('gives the shortest key sequence for each placement', () => {
    // The far-left O placement needs exactly four lefts from spawn x=3.
    const placements = enumeratePlacements(EMPTY, createPiece(2));
    const leftmost = placements.reduce((a, b) =>
      a.piece.position.x <= b.piece.position.x ? a : b);
    expect(leftmost.moves.filter((m) => m === 'left')).toHaveLength(4);
    expect(leftmost.moves.filter((m) => m === 'right')).toHaveLength(0);
  });
});

describe('samePiece', () => {
  it('compares type, rotation and position', () => {
    const a = createPiece(3);
    expect(samePiece(a, { ...a, position: { ...a.position } })).toBe(true);
    expect(samePiece(a, { ...a, rotation: 1 })).toBe(false);
    expect(samePiece(a, { ...a, position: { x: 9, y: 0 } })).toBe(false);
    expect(samePiece(a, null)).toBe(false);
    expect(samePiece(null, null)).toBe(false);
  });
});
