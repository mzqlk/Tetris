import { describe, it, expect } from 'vitest';
import { linearScale, niceTicks, extent } from './scales';

describe('linearScale', () => {
  it('maps the domain onto the range', () => {
    const s = linearScale(0, 10, 0, 100);
    expect(s(0)).toBe(0);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(100);
  });

  it('supports an inverted range, as SVG y axes need', () => {
    const s = linearScale(0, 10, 200, 0);
    expect(s(0)).toBe(200);
    expect(s(10)).toBe(0);
  });

  it('does not divide by zero on a degenerate domain', () => {
    const s = linearScale(5, 5, 0, 100);
    expect(Number.isFinite(s(5))).toBe(true);
  });
});

describe('niceTicks', () => {
  it('produces round numbers inside the domain', () => {
    const ticks = niceTicks(0, 100, 5);
    expect(ticks[0]).toBeGreaterThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(100);
    expect(ticks).toContain(50);
  });

  it('handles small ranges', () => {
    expect(niceTicks(0, 1, 5).length).toBeGreaterThan(1);
  });

  it('handles a degenerate range without looping forever', () => {
    expect(niceTicks(7, 7)).toEqual([7]);
  });

  it('handles negative domains', () => {
    const ticks = niceTicks(-1, 1, 4);
    expect(ticks).toContain(0);
  });
});

describe('extent', () => {
  it('returns min and max', () => {
    expect(extent([3, 1, 4, 1, 5])).toEqual([1, 5]);
  });

  it('returns [0, 1] for an empty list', () => {
    expect(extent([])).toEqual([0, 1]);
  });

  it('ignores non-finite values', () => {
    expect(extent([1, NaN, 3, Infinity])).toEqual([1, 3]);
  });
});
