import type { Board, Position } from '../types';
import { BOARD_WIDTH, TOTAL_ROWS } from '../constants';
import { lineClearValue } from './lineClears';
import {
  columnHeights,
  diagnosticsFromWell,
  summarizeTetrisWell,
} from './tetrisStrategy';

export { columnHeights } from './tetrisStrategy';

export const LEGACY_FEATURE_NAMES = [
  'aggregateHeight', 'holes', 'bumpiness', 'maxHeight', 'linesCleared',
  'landingHeight', 'rowTransitions', 'colTransitions', 'wellDepth',
] as const;

export const SCORE_RATE_V2_FEATURE_NAMES = [
  ...LEGACY_FEATURE_NAMES, 'lineClearValue',
] as const;

export const FEATURE_NAMES = [
  ...SCORE_RATE_V2_FEATURE_NAMES,
  'cleanWellDepth', 'tetrisSetupProgress', 'tetrisReadyRows',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureVector = number[];
export const FEATURE_COUNT = FEATURE_NAMES.length;

/** Empty cells with at least one filled cell somewhere above them in the same column. */
export function countHoles(board: Board): number {
  let holes = 0;
  for (let c = 0; c < BOARD_WIDTH; c++) {
    let covered = false;
    for (let r = 0; r < TOTAL_ROWS; r++) {
      if (board[r][c] !== 0) covered = true;
      else if (covered) holes++;
    }
  }
  return holes;
}

/** Filled/empty flips scanning each row, with both side walls counted as filled. */
export function rowTransitions(board: Board): number {
  let transitions = 0;
  for (let r = 0; r < TOTAL_ROWS; r++) {
    let prev = 1;
    for (let c = 0; c < BOARD_WIDTH; c++) {
      const cur = board[r][c] !== 0 ? 1 : 0;
      if (cur !== prev) transitions++;
      prev = cur;
    }
    if (prev !== 1) transitions++;
  }
  return transitions;
}

/** Filled/empty flips scanning each column, with the floor filled and the ceiling empty. */
export function colTransitions(board: Board): number {
  let transitions = 0;
  for (let c = 0; c < BOARD_WIDTH; c++) {
    let prev = 0;
    for (let r = 0; r < TOTAL_ROWS; r++) {
      const cur = board[r][c] !== 0 ? 1 : 0;
      if (cur !== prev) transitions++;
      prev = cur;
    }
    if (prev !== 1) transitions++;
  }
  return transitions;
}

/**
 * Cumulative well depth. A column is a well to the extent it sits below both
 * neighbours; the side walls count as infinitely tall. A well of depth d costs
 * d(d+1)/2 so deep single-column wells are penalised super-linearly.
 */
export function wellDepth(_board: Board, heights: number[]): number {
  let total = 0;
  for (let c = 0; c < BOARD_WIDTH; c++) {
    const left = c === 0 ? TOTAL_ROWS : heights[c - 1];
    const right = c === BOARD_WIDTH - 1 ? TOTAL_ROWS : heights[c + 1];
    const depth = Math.min(left, right) - heights[c];
    if (depth > 0) total += (depth * (depth + 1)) / 2;
  }
  return total;
}

/**
 * `boardAfter` is the board once the piece has locked and full rows have been
 * cleared. `linesCleared` and `placedCells` describe the move itself, so
 * `placedCells` carries PRE-clear row indices.
 */
export function extractFeatures(
  boardAfter: Board,
  linesCleared: number,
  placedCells: Position[],
): FeatureVector {
  const heights = columnHeights(boardAfter);

  let aggregateHeight = 0;
  let maxHeight = 0;
  let bumpiness = 0;
  for (let c = 0; c < BOARD_WIDTH; c++) {
    aggregateHeight += heights[c];
    if (heights[c] > maxHeight) maxHeight = heights[c];
    if (c < BOARD_WIDTH - 1) bumpiness += Math.abs(heights[c] - heights[c + 1]);
  }

  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const cell of placedCells) {
    if (cell.y < minRow) minRow = cell.y;
    if (cell.y > maxRow) maxRow = cell.y;
  }
  const landingHeight = TOTAL_ROWS - (minRow + maxRow) / 2;
  const strategy = diagnosticsFromWell(summarizeTetrisWell(boardAfter));

  return [
    aggregateHeight,
    countHoles(boardAfter),
    bumpiness,
    maxHeight,
    linesCleared,
    landingHeight,
    rowTransitions(boardAfter),
    colTransitions(boardAfter),
    wellDepth(boardAfter, heights),
    lineClearValue(linesCleared),
    strategy.meanCleanWellDepth,
    strategy.meanTetrisSetupProgress,
    strategy.meanTetrisReadyRows,
  ];
}
