import { describe, expect, it } from 'vitest';
import { boardFrom } from './testUtils';
import {
  diagnosticsFromWell,
  hasVerticalIBand,
  summarizeTetrisWellAt,
  summarizeTetrisWell,
} from './tetrisStrategy';

describe('summarizeTetrisWell', () => {
  it('returns a deterministic zero summary on an empty board', () => {
    expect(summarizeTetrisWell(boardFrom([]))).toEqual({
      column: 0, usableDepth: 0, setupCells: 0, readyRows: 0,
    });
  });

  it('summarizes a specified column without searching other wells', () => {
    expect(summarizeTetrisWellAt(boardFrom([
      '####.#####', '####.#####', '####.#####', '####.#####',
    ]), 4)).toEqual({
      column: 4, usableDepth: 4, setupCells: 36, readyRows: 4,
    });
  });

  it.each([
    ['left edge', ['.#########', '.#########', '.#########', '.#########'], 0],
    ['middle', ['####.#####', '####.#####', '####.#####', '####.#####'], 4],
    ['right edge', ['#########.', '#########.', '#########.', '#########.'], 9],
  ])('summarizes a complete %s Tetris well', (_label, rows, column) => {
    expect(summarizeTetrisWell(boardFrom(rows))).toEqual({
      column, usableDepth: 4, setupCells: 36, readyRows: 4,
    });
  });

  it('keeps all values tied to the same selected column', () => {
    const summary = summarizeTetrisWell(boardFrom([
      '####.#####', '####.#####', '####.#####', '####.####.',
    ]));
    expect(summary.column).toBe(4);
    expect(summary.readyRows).toBe(3);
    expect(summary.setupCells).toBe(35);
    expect(summary.usableDepth).toBe(4);
  });

  it('converts setup cells to a zero-to-four progress signal', () => {
    expect(diagnosticsFromWell({
      column: 9, usableDepth: 2, setupCells: 18, readyRows: 1,
    })).toEqual({
      meanCleanWellDepth: 2,
      meanTetrisSetupProgress: 2,
      meanTetrisReadyRows: 1,
    });
  });

  it('detects whether a specific column still has a vertical I band', () => {
    const board = boardFrom([
      '####.#####', '####.#####', '####.#####', '####.#####',
    ]);
    expect(hasVerticalIBand(board, 4)).toBe(true);
    expect(hasVerticalIBand(board, 3)).toBe(false);
  });

  it('rejects columns outside the board', () => {
    expect(() => summarizeTetrisWellAt(boardFrom([]), -1 as 0)).toThrow(/column/i);
    expect(() => hasVerticalIBand(boardFrom([]), 10 as 0)).toThrow(/column/i);
  });
});
