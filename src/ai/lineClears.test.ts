import { describe, expect, it } from 'vitest';
import {
  addLineClearCounts,
  assertLineClearCounts,
  divideLineClearCounts,
  emptyLineClearCounts,
  lineClearValue,
  recordLineClear,
  tetrisLineShare,
  totalLinesFromCounts,
} from './lineClears';

describe('lineClearValue', () => {
  it('uses the engine single/double/triple/tetris proportions', () => {
    expect([0, 1, 2, 3, 4].map(lineClearValue)).toEqual([0, 1, 3, 5, 8]);
  });

  it.each([-1, 1.5, 5, Number.NaN])('rejects invalid clear count %s', (value) => {
    expect(() => lineClearValue(value)).toThrow(/integer from 0 to 4/);
  });
});

describe('LineClearCounts', () => {
  it('starts at independent all-zero objects', () => {
    const a = emptyLineClearCounts();
    const b = emptyLineClearCounts();
    expect(a).toEqual({ singles: 0, doubles: 0, triples: 0, tetrises: 0 });
    expect(a).not.toBe(b);
  });

  it('records clear events without mutating the input', () => {
    const start = emptyLineClearCounts();
    const afterSingle = recordLineClear(start, 1);
    const afterTetris = recordLineClear(afterSingle, 4);
    expect(start).toEqual({ singles: 0, doubles: 0, triples: 0, tetrises: 0 });
    expect(afterTetris).toEqual({ singles: 1, doubles: 0, triples: 0, tetrises: 1 });
    expect(recordLineClear(afterTetris, 0)).toEqual(afterTetris);
  });

  it('adds and averages counts component-wise', () => {
    const total = addLineClearCounts(
      { singles: 2, doubles: 1, triples: 0, tetrises: 3 },
      { singles: 4, doubles: 3, triples: 2, tetrises: 1 },
    );
    expect(total).toEqual({ singles: 6, doubles: 4, triples: 2, tetrises: 4 });
    expect(divideLineClearCounts(total, 2)).toEqual({
      singles: 3, doubles: 2, triples: 1, tetrises: 2,
    });
  });

  it('rejects a non-positive averaging divisor', () => {
    expect(() => divideLineClearCounts(emptyLineClearCounts(), 0)).toThrow(/positive/);
  });

  it('rejects negative, non-finite, and fractional raw counts', () => {
    expect(() => assertLineClearCounts(
      { singles: -1, doubles: 0, triples: 0, tetrises: 0 }, false,
    )).toThrow(/non-negative/);
    expect(() => assertLineClearCounts(
      { singles: Number.NaN, doubles: 0, triples: 0, tetrises: 0 }, false,
    )).toThrow(/finite/);
    expect(() => assertLineClearCounts(
      { singles: 0.5, doubles: 0, triples: 0, tetrises: 0 }, true,
    )).toThrow(/integer/);
  });

  it('derives lines and tetris line share', () => {
    const counts = { singles: 2, doubles: 1, triples: 0, tetrises: 2 };
    expect(totalLinesFromCounts(counts)).toBe(12);
    expect(tetrisLineShare(counts)).toBeCloseTo(8 / 12, 12);
    expect(tetrisLineShare(emptyLineClearCounts())).toBe(0);
  });
});
