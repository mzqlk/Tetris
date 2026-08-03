import { describe, it, expect } from 'vitest';
import { SERIES_COLORS, sigmaColor } from './chartColors';
import { FEATURE_NAMES } from '../../ai/features';

describe('SERIES_COLORS', () => {
  it('has one distinct colour per feature', () => {
    expect(SERIES_COLORS).toHaveLength(FEATURE_NAMES.length);
    expect(new Set(SERIES_COLORS).size).toBe(FEATURE_NAMES.length);
  });

  it('are all valid hex colours', () => {
    for (const c of SERIES_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('sigmaColor', () => {
  it('returns a valid rgb string across the whole range', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sigmaColor(t)).toMatch(/^rgb\(\d{1,3}, ?\d{1,3}, ?\d{1,3}\)$/);
    }
  });

  it('clamps out-of-range input instead of producing garbage', () => {
    expect(sigmaColor(-5)).toBe(sigmaColor(0));
    expect(sigmaColor(5)).toBe(sigmaColor(1));
  });

  it('gets brighter as sigma grows', () => {
    const brightness = (c: string) =>
      c.match(/\d+/g)!.map(Number).reduce((s, x) => s + x, 0);
    expect(brightness(sigmaColor(1))).toBeGreaterThan(brightness(sigmaColor(0)));
  });
});
