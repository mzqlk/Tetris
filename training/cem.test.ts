import { describe, it, expect } from 'vitest';
import {
  initCem, gaussian, sampleCandidates, noiseAt, updateCem, nextMaxPieces, median,
} from './cem';
import { mulberry32 } from '../src/ai/rng';
import { FEATURE_COUNT } from '../src/ai/features';

const l2 = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe('initCem', () => {
  it('starts at the origin with unit sigma and no prior', () => {
    const s = initCem();
    expect(s.mu).toEqual(Array(FEATURE_COUNT).fill(0));
    expect(s.sigma).toEqual(Array(FEATURE_COUNT).fill(1));
    expect(s.gen).toBe(0);
  });
});

describe('gaussian', () => {
  it('has mean 0 and standard deviation 1', () => {
    const rng = mulberry32(4);
    const n = 200000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x = gaussian(rng);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    expect(mean).toBeCloseTo(0, 1);
    expect(Math.sqrt(sumSq / n - mean * mean)).toBeCloseTo(1, 1);
  });

  it('never returns a non-finite value', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 50000; i++) expect(Number.isFinite(gaussian(rng))).toBe(true);
  });
});

describe('sampleCandidates', () => {
  it('returns normalised vectors of the right shape', () => {
    const candidates = sampleCandidates(initCem(), 25, mulberry32(1));
    expect(candidates).toHaveLength(25);
    for (const c of candidates) {
      expect(c).toHaveLength(FEATURE_COUNT);
      expect(l2(c)).toBeCloseTo(1, 10);
    }
  });

  it('is deterministic for a given rng seed', () => {
    expect(sampleCandidates(initCem(), 5, mulberry32(2)))
      .toEqual(sampleCandidates(initCem(), 5, mulberry32(2)));
  });

  it('spreads more widely when sigma is larger', () => {
    const mu = Array(FEATURE_COUNT).fill(0);
    mu[0] = 10;
    const tight = sampleCandidates({ mu, sigma: Array(FEATURE_COUNT).fill(0.01), gen: 0 }, 40, mulberry32(3));
    const loose = sampleCandidates({ mu, sigma: Array(FEATURE_COUNT).fill(5), gen: 0 }, 40, mulberry32(3));
    const spread = (xs: number[][]) => Math.max(...xs.map((c) => c[1])) - Math.min(...xs.map((c) => c[1]));
    expect(spread(loose)).toBeGreaterThan(spread(tight));
  });
});

describe('noiseAt', () => {
  const opts = { initialNoise: 0.5, noiseDecay: 0.95, noiseFloor: 0.01 };

  it('decays geometrically from the initial value', () => {
    expect(noiseAt(0, opts)).toBeCloseTo(0.5, 10);
    expect(noiseAt(1, opts)).toBeCloseTo(0.475, 10);
  });

  it('never drops below the floor', () => {
    expect(noiseAt(1000, opts)).toBe(0.01);
  });
});

describe('updateCem', () => {
  const dim = FEATURE_COUNT;
  const vec = (first: number) => {
    const v = Array(dim).fill(0);
    v[0] = first;
    return v;
  };

  it('moves mu toward the elites', () => {
    const candidates = [vec(10), vec(9), vec(-9), vec(-10)];
    const fitness = [100, 90, 5, 1];
    const next = updateCem(initCem(), candidates, fitness, { eliteFrac: 0.5, noise: 0 });
    expect(next.mu[0]).toBeCloseTo(9.5, 10);
  });

  it('advances the generation counter', () => {
    const next = updateCem(initCem(), [vec(1), vec(2)], [1, 2], { eliteFrac: 0.5, noise: 0 });
    expect(next.gen).toBe(1);
  });

  it('keeps at least one elite even with a tiny fraction', () => {
    const next = updateCem(initCem(), [vec(3), vec(7)], [1, 99], { eliteFrac: 0.001, noise: 0 });
    expect(next.mu[0]).toBeCloseTo(7, 10);
  });

  it('adds the noise floor to the variance so the distribution cannot collapse', () => {
    // All elites identical => zero variance; sigma must still be sqrt(noise).
    const next = updateCem(initCem(), [vec(5), vec(5)], [1, 1], { eliteFrac: 1, noise: 0.25 });
    for (const s of next.sigma) expect(s).toBeCloseTo(0.5, 10);
  });

  it('shrinks sigma as the elites agree', () => {
    const spread = updateCem(initCem(), [vec(-8), vec(8)], [1, 1], { eliteFrac: 1, noise: 0 });
    const tight = updateCem(initCem(), [vec(-0.1), vec(0.1)], [1, 1], { eliteFrac: 1, noise: 0 });
    expect(tight.sigma[0]).toBeLessThan(spread.sigma[0]);
  });

  it('rejects mismatched candidate and fitness lengths', () => {
    expect(() => updateCem(initCem(), [vec(1)], [1, 2], { eliteFrac: 0.5, noise: 0 })).toThrow();
  });
});

describe('nextMaxPieces', () => {
  // The trigger is SURVIVED PIECES, not lines. Each piece is 4 cells and a line
  // is 10, so lines/pieces can never exceed 0.4 — a lines-based trigger of
  // "0.8 * maxPieces" is mathematically unreachable and would never fire.
  it('doubles once the median game is bumping against the cap', () => {
    expect(nextMaxPieces(300, 250, 100000)).toBe(600);
  });

  it('holds steady while games still end on their own', () => {
    expect(nextMaxPieces(300, 100, 100000)).toBe(300);
  });

  it('respects the absolute cap', () => {
    expect(nextMaxPieces(80000, 79000, 100000)).toBe(100000);
  });
});

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('returns 0 for an empty list', () => {
    expect(median([])).toBe(0);
  });

  it('does not mutate its input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});
