import type { Board } from '../types';
import { BOARD_WIDTH, TOTAL_ROWS } from '../constants';
import { createEmptyBoard } from '../engine/board';

/**
 * Build a board from bottom-anchored ASCII rows: '#' filled, '.' empty.
 * The LAST string is the bottom row, so a 3-row argument describes rows
 * 19, 20, 21 and leaves everything above empty.
 */
export function boardFrom(rows: string[]): Board {
  const board = createEmptyBoard();
  rows.forEach((row, i) => {
    if (row.length !== BOARD_WIDTH) {
      throw new Error(`row ${i} has ${row.length} chars, expected ${BOARD_WIDTH}`);
    }
    const r = TOTAL_ROWS - rows.length + i;
    for (let c = 0; c < BOARD_WIDTH; c++) {
      board[r][c] = row[c] === '#' ? 1 : 0;
    }
  });
  return board;
}
