import { afterEach, describe, it, expect, vi } from 'vitest';
import { enumeratePlacements, cellKey, projectHardDrop } from './placements';
import { projectPath, samePiece } from './replay';
import { boardFrom } from './testUtils';
import { createEmptyBoard, isValidPosition } from '../engine/board';
import { createPiece, movePiece, rotatePiece } from '../engine/piece';
import { BOARD_WIDTH } from '../constants';
import type { Board, Piece, PieceType } from '../types';

const EMPTY = createEmptyBoard();
const ALL_TYPES: PieceType[] = [1, 2, 3, 4, 5, 6, 7];

afterEach(() => {
  vi.restoreAllMocks();
});

const EMPTY_I_ORDER = [
  '185,195,205,215', '184,194,204,214', '186,196,206,216',
  '213,214,215,216', '183,193,203,213', '212,213,214,215',
  '187,197,207,217', '214,215,216,217', '182,192,202,212',
  '211,212,213,214', '188,198,208,218', '215,216,217,218',
  '210,211,212,213', '181,191,201,211', '216,217,218,219',
  '189,199,209,219', '180,190,200,210',
];

const TUCK_I_ORDER = [
  '155,165,175,185', '154,164,174,184', '156,166,176,186',
  '183,184,185,186', '182,183,184,185', '157,167,177,187',
  '184,185,186,187', '181,182,183,184', '158,168,178,188',
  '185,186,187,188', '183,193,203,213', '182,192,202,212',
  '186,187,188,189', '159,169,179,189', '181,191,201,211',
  '210,211,212,213', '180,190,200,210', '211,212,213,214',
];

const JAGGED_T_ORDER = [
  '174,182,183,184', '173,181,182,183', '162,172,182,183',
  '172,173,174,182', '195,203,204,205', '184,194,204,205',
  '172,180,181,182', '161,171,181,182', '183,193,203,204',
  '187,195,196,197', '176,186,196,197', '196,204,205,206',
  '185,195,205,206', '193,194,195,203', '181,182,183,191',
  '161,162,172,182', '188,196,197,198', '177,187,197,198',
  '194,195,196,204', '183,184,194,204', '180,190,200,201',
  '180,181,182,190', '182,183,193,203', '189,197,198,199',
  '195,196,197,205', '184,185,195,205', '188,198,208,209',
  '187,188,189,197', '196,197,198,206', '176,177,187,197',
  '185,186,196,206', '180,181,191,201', '188,189,199,209',
  '197,198,208,218',
];

const BOARDS: [string, Board][] = [
  ['empty', EMPTY],
  ['tuck', boardFrom(['....######', '....######', '.....#####'])],
  ['jagged', boardFrom(['..#.......', '..#....#..', '##.#####.#'])],
];

it('keeps representative resting placements in their established order', () => {
  const tuck = boardFrom(['....######', '....######', '.....#####']);
  const jagged = boardFrom(['..#.......', '..#....#..', '##.#####.#']);

  expect(enumeratePlacements(EMPTY, createPiece(1)).map((p) => cellKey(p.piece)))
    .toEqual(EMPTY_I_ORDER);
  expect(enumeratePlacements(tuck, createPiece(1)).map((p) => cellKey(p.piece)))
    .toEqual(TUCK_I_ORDER);
  expect(enumeratePlacements(jagged, createPiece(7)).map((p) => cellKey(p.piece)))
    .toEqual(JAGGED_T_ORDER);
});

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
  for (const [name, board] of BOARDS) {
    it(`every placement on the ${name} board is a resting position`, () => {
      for (const type of ALL_TYPES) {
        for (const p of enumeratePlacements(board, createPiece(type))) {
          expect(isValidPosition(board, p.piece)).toBe(true);
          expect(movePiece(board, p.piece, 0, 1)).toBeNull();
        }
      }
    });

  }

  it.each(BOARDS)('replay plus hard drop reproduces every %s placement', (_name, board) => {
    for (const type of ALL_TYPES) {
      const spawn = createPiece(type);
      for (const placement of enumeratePlacements(board, spawn)) {
        const path = projectPath(board, spawn, placement.moves);
        expect(path).toHaveLength(placement.moves.length);
        const preDrop = path.at(-1) ?? spawn;
        expect(cellKey(projectHardDrop(board, preDrop))).toBe(cellKey(placement.piece));
      }
    }
  });

  it('rotates the centre I at spawn and hard-drops without unnecessary down moves', () => {
    const vertical = enumeratePlacements(EMPTY, createPiece(1))
      .find((placement) => cellKey(placement.piece) === '185,195,205,215');

    expect(vertical).toBeDefined();
    expect(vertical!.moves).toEqual(['rotate']);
  });

  it('retains only the downward moves needed for the roofed tuck', () => {
    const board = boardFrom(['....######', '....######', '.....#####']);
    const tuck = enumeratePlacements(board, createPiece(1))
      .find((placement) => cellKey(placement.piece) === '211,212,213,214');

    expect(tuck).toBeDefined();
    expect(tuck!.moves).toContain('down');
    const path = projectPath(board, createPiece(1), tuck!.moves);
    expect(cellKey(projectHardDrop(board, path.at(-1)!))).toBe('211,212,213,214');
  });

  it('does not mutate a representative board while enumerating or hard-dropping', () => {
    const board = boardFrom(['..#.......', '..#....#..', '##.#####.#']);
    const snapshot = board.map((row) => [...row]);

    enumeratePlacements(board, createPiece(7));
    expect(board).toEqual(snapshot);

    projectHardDrop(board, createPiece(7));
    expect(board).toEqual(snapshot);
  });

  it('reaches the left-shaft I landing through a real SRS kick', () => {
    const board = boardFrom(Array(20).fill('.#########'));
    const landingKey = '180,190,200,210';
    const placement = enumeratePlacements(board, createPiece(1))
      .find((candidate) => cellKey(candidate.piece) === landingKey);

    expect(placement).toBeDefined();
    expect(placement!.moves).toEqual(['left', 'left', 'left', 'rotate']);
    const path = projectPath(board, createPiece(1), placement!.moves);
    const beforeKick = path.at(-2)!;
    const kicked = path.at(-1)!;
    expect(isValidPosition(board, { ...beforeKick, rotation: 1 })).toBe(false);
    expect(rotatePiece(board, beforeKick)).toEqual(kicked);
    expect(kicked).toMatchObject({ rotation: 1, position: { x: -2, y: 0 } });
    expect(cellKey(projectHardDrop(board, kicked))).toBe(landingKey);
  });

  it('throws a placement-specific error if the pre-drop projection is missing', () => {
    const board = boardFrom(Array(20).fill('.#########'));
    vi.spyOn(Map.prototype, 'get').mockReturnValueOnce(undefined);

    expect(() => enumeratePlacements(board, createPiece(1)))
      .toThrow('missing pre-drop path for reachable placement 13,14,15,16');
  });
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
