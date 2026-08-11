import { describe, it, expect } from 'vitest';
import {
  LEGACY_FEATURE_NAMES, SCORE_RATE_V2_FEATURE_NAMES, FEATURE_NAMES, FEATURE_COUNT,
  extractFeatures, columnHeights,
  countHoles, rowTransitions, colTransitions, wellDepth,
} from './features';
import { boardFrom } from './testUtils';
import { createEmptyBoard } from '../engine/board';

const idx = (name: (typeof FEATURE_NAMES)[number]) => FEATURE_NAMES.indexOf(name);

describe('FEATURE_NAMES', () => {
  it('keeps the legacy order and appends stable Tetris setup features', () => {
    expect(LEGACY_FEATURE_NAMES).toEqual([
      'aggregateHeight', 'holes', 'bumpiness', 'maxHeight', 'linesCleared',
      'landingHeight', 'rowTransitions', 'colTransitions', 'wellDepth',
    ]);
    expect(SCORE_RATE_V2_FEATURE_NAMES).toEqual([
      ...LEGACY_FEATURE_NAMES, 'lineClearValue',
    ]);
    expect(FEATURE_NAMES).toEqual([
      ...SCORE_RATE_V2_FEATURE_NAMES,
      'cleanWellDepth', 'tetrisSetupProgress', 'tetrisReadyRows',
    ]);
    expect(FEATURE_COUNT).toBe(13);
    expect(new Set(FEATURE_NAMES).size).toBe(13);
  });
});

it('appends nonlinear clear value after the established nine features', () => {
  const board = createEmptyBoard();
  const placedCells = [
    { x: 0, y: 18 }, { x: 0, y: 19 }, { x: 0, y: 20 }, { x: 0, y: 21 },
  ];
  const features = extractFeatures(board, 4, placedCells);
  expect(features[FEATURE_NAMES.indexOf('linesCleared')]).toBe(4);
  expect(features[FEATURE_NAMES.indexOf('lineClearValue')]).toBe(8);
});

it('extracts complete Tetris setup features after line clearing', () => {
  const features = extractFeatures(
    boardFrom(['#########.', '#########.', '#########.', '#########.']),
    0,
    [{ x: 0, y: 0 }],
  );
  expect(features[FEATURE_NAMES.indexOf('cleanWellDepth')]).toBe(4);
  expect(features[FEATURE_NAMES.indexOf('tetrisSetupProgress')]).toBe(4);
  expect(features[FEATURE_NAMES.indexOf('tetrisReadyRows')]).toBe(4);
});

it.each([
  [1, 1], [2, 3], [3, 5], [4, 8],
])('maps %i cleared rows to nonlinear value %i', (linesCleared, expectedValue) => {
  const features = extractFeatures(
    createEmptyBoard(),
    linesCleared,
    [{ x: 0, y: 21 }],
  );
  expect(features[FEATURE_NAMES.indexOf('lineClearValue')]).toBe(expectedValue);
});

describe('empty board', () => {
  const empty = createEmptyBoard();

  it('has zero height, holes and wells', () => {
    expect(columnHeights(empty)).toEqual(Array(10).fill(0));
    expect(countHoles(empty)).toBe(0);
    expect(wellDepth(empty, columnHeights(empty))).toBe(0);
  });

  it('counts 44 row transitions — 22 rows x 2 wall boundaries', () => {
    expect(rowTransitions(empty)).toBe(44);
  });

  it('counts 10 column transitions — one floor boundary per column', () => {
    expect(colTransitions(empty)).toBe(10);
  });
});

describe('overhang board', () => {
  //  row 19:  ..#.......
  //  row 20:  ..........
  //  row 21:  ##.#######
  const board = boardFrom([
    '..#.......',
    '..........',
    '##.#######',
  ]);
  const h = columnHeights(board);

  it('measures column heights from the topmost filled cell', () => {
    expect(h).toEqual([1, 1, 3, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('counts the two cells buried under the overhang', () => {
    expect(countHoles(board)).toBe(2);
  });

  it('counts row transitions with both walls treated as filled', () => {
    // 19 empty rows x 2 = 38, plus row19 = 4, row20 = 2, row21 = 2
    expect(rowTransitions(board)).toBe(46);
  });

  it('counts column transitions with a filled floor and an empty ceiling', () => {
    // nine 1-transition columns + column 2 contributing 3
    expect(colTransitions(board)).toBe(12);
  });

  it('reports the full feature vector', () => {
    const f = extractFeatures(board, 0, [{ x: 2, y: 18 }, { x: 2, y: 19 }]);
    expect(f).toHaveLength(13);
    expect(f[idx('aggregateHeight')]).toBe(12);
    expect(f[idx('holes')]).toBe(2);
    expect(f[idx('bumpiness')]).toBe(4);
    expect(f[idx('maxHeight')]).toBe(3);
    expect(f[idx('linesCleared')]).toBe(0);
    expect(f[idx('landingHeight')]).toBe(22 - 18.5);
    expect(f[idx('rowTransitions')]).toBe(46);
    expect(f[idx('colTransitions')]).toBe(12);
    expect(f[idx('wellDepth')]).toBe(0);
    expect(f[idx('lineClearValue')]).toBe(0);
    expect(f[idx('cleanWellDepth')]).toBe(0);
    expect(f[idx('tetrisSetupProgress')]).toBe(1 / 9);
    expect(f[idx('tetrisReadyRows')]).toBe(0);
  });
});

describe('wellDepth', () => {
  it('sums d(d+1)/2 for an interior well', () => {
    // column 1 is a depth-2 well between two height-2 stacks
    const board = boardFrom(['#.#.......', '#.#.......']);
    expect(wellDepth(board, columnHeights(board))).toBe(3);
  });

  it('treats the side walls as infinitely tall', () => {
    // column 0 is a depth-3 well against the left wall
    const board = boardFrom(['.#........', '.#........', '.#........']);
    expect(wellDepth(board, columnHeights(board))).toBe(6);
  });

  it('ignores columns that are not wells', () => {
    const board = boardFrom(['##########']);
    expect(wellDepth(board, columnHeights(board))).toBe(0);
  });
});

describe('landingHeight', () => {
  it('measures the centre of the placed cells above the floor', () => {
    const f = extractFeatures(createEmptyBoard(), 0, [
      { x: 4, y: 20 }, { x: 5, y: 20 }, { x: 4, y: 21 }, { x: 5, y: 21 },
    ]);
    expect(f[idx('landingHeight')]).toBe(22 - 20.5);
  });

  it('uses the pre-clear rows it was handed, not the post-clear board', () => {
    // the board is empty because the row cleared; the placement still landed low
    const f = extractFeatures(createEmptyBoard(), 1, [{ x: 0, y: 21 }]);
    expect(f[idx('landingHeight')]).toBe(1);
    expect(f[idx('linesCleared')]).toBe(1);
    expect(f[idx('lineClearValue')]).toBe(1);
  });
});
