import type { Board } from '../types';
import { BOARD_WIDTH, TOTAL_ROWS } from '../constants';

export interface TetrisWellSummary {
  column: number;
  usableDepth: number;
  setupCells: number;
  readyRows: number;
}

export interface StrategyDiagnostics {
  meanCleanWellDepth: number;
  meanTetrisSetupProgress: number;
  meanTetrisReadyRows: number;
}

export interface SurvivalDiagnostics {
  pieceCapGames: number;
  gameoverGames: number;
}

/** Height of each column: TOTAL_ROWS minus the row index of its topmost filled cell. */
export function columnHeights(board: Board): number[] {
  const heights = new Array<number>(BOARD_WIDTH).fill(0);
  for (let column = 0; column < BOARD_WIDTH; column++) {
    for (let row = 0; row < TOTAL_ROWS; row++) {
      if (board[row][column] !== 0) {
        heights[column] = TOTAL_ROWS - row;
        break;
      }
    }
  }
  return heights;
}

const zeroSummary = (column: number): TetrisWellSummary => ({
  column, usableDepth: 0, setupCells: 0, readyRows: 0,
});

const better = (left: TetrisWellSummary, right: TetrisWellSummary): boolean =>
  left.readyRows > right.readyRows ||
  (left.readyRows === right.readyRows && left.setupCells > right.setupCells) ||
  (left.readyRows === right.readyRows && left.setupCells === right.setupCells &&
    left.usableDepth > right.usableDepth) ||
  (left.readyRows === right.readyRows && left.setupCells === right.setupCells &&
    left.usableDepth === right.usableDepth && left.column < right.column);

export function summarizeTetrisWell(board: Board): TetrisWellSummary {
  const heights = columnHeights(board);
  let best = zeroSummary(0);
  for (let column = 0; column < BOARD_WIDTH; column++) {
    const targetHeight = heights[column];
    if (targetHeight + 4 > TOTAL_ROWS) continue;
    const left = column === 0 ? TOTAL_ROWS : heights[column - 1];
    const right = column === BOARD_WIDTH - 1 ? TOTAL_ROWS : heights[column + 1];
    const bottom = TOTAL_ROWS - targetHeight - 1;
    let setupCells = 0;
    let readyRows = 0;
    for (let row = bottom - 3; row <= bottom; row++) {
      let outside = 0;
      for (let c = 0; c < BOARD_WIDTH; c++) {
        if (c !== column && board[row][c] !== 0) outside++;
      }
      setupCells += outside;
      if (board[row][column] === 0 && outside === BOARD_WIDTH - 1) readyRows++;
    }
    const candidate = {
      column,
      usableDepth: Math.max(0, Math.min(4, Math.min(left, right) - targetHeight)),
      setupCells,
      readyRows,
    };
    if (better(candidate, best)) best = candidate;
  }
  return best;
}

export const diagnosticsFromWell = (well: TetrisWellSummary): StrategyDiagnostics => ({
  meanCleanWellDepth: well.usableDepth,
  meanTetrisSetupProgress: well.setupCells / 9,
  meanTetrisReadyRows: well.readyRows,
});

export const emptyStrategyDiagnostics = (): StrategyDiagnostics => ({
  meanCleanWellDepth: 0,
  meanTetrisSetupProgress: 0,
  meanTetrisReadyRows: 0,
});

export const addStrategyDiagnostics = (
  left: StrategyDiagnostics,
  right: StrategyDiagnostics,
): StrategyDiagnostics => ({
  meanCleanWellDepth: left.meanCleanWellDepth + right.meanCleanWellDepth,
  meanTetrisSetupProgress: left.meanTetrisSetupProgress + right.meanTetrisSetupProgress,
  meanTetrisReadyRows: left.meanTetrisReadyRows + right.meanTetrisReadyRows,
});

export function divideStrategyDiagnostics(
  value: StrategyDiagnostics,
  divisor: number,
): StrategyDiagnostics {
  if (!Number.isFinite(divisor) || divisor <= 0) throw new Error('divisor must be positive');
  return {
    meanCleanWellDepth: value.meanCleanWellDepth / divisor,
    meanTetrisSetupProgress: value.meanTetrisSetupProgress / divisor,
    meanTetrisReadyRows: value.meanTetrisReadyRows / divisor,
  };
}
