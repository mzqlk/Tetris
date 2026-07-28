import { describe, it, expect } from 'vitest';
import {
  initCem, gaussian, sampleCandidates, noiseAt, updateCem, nextMaxPieces, median,
  aggregateFitness, eliteCount,
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

describe('eliteCount', () => {
  it('takes ceil(eliteFrac * population) for a normal case', () => {
    expect(eliteCount(0.1, 100)).toBe(10);
    expect(eliteCount(0.1, 95)).toBe(10);
  });

  it('floors at 1 even for a tiny fraction or population', () => {
    expect(eliteCount(0.001, 4)).toBe(1);
    expect(eliteCount(0.5, 1)).toBe(1);
  });
});

describe('nextMaxPieces', () => {
  // The trigger is the ELITES' SURVIVED PIECES, and both halves are measured
  // rather than assumed. Lines can never exceed 0.4 per piece (4 cells vs 10),
  // so a lines-based trigger of "0.8 * maxPieces" is unreachable. And across 15
  // real generations the POPULATION median sat at 18-59 pieces against a 240
  // threshold and never fired, while the best candidate was already pinned at
  // 99% of the ceiling from generation 0.
  it('doubles once the elite games are bumping against the cap', () => {
    expect(nextMaxPieces(300, 250, 100000)).toBe(600);
  });

  it('holds steady while the elites still die on their own', () => {
    expect(nextMaxPieces(300, 100, 100000)).toBe(300);
  });

  it('respects the absolute cap', () => {
    expect(nextMaxPieces(80000, 79000, 100000)).toBe(100000);
  });
});

describe('aggregateFitness', () => {
  // results[i * gamesPerCandidate + j] belongs to candidate i, game j.
  const results = [
    { lines: 10, pieces: 100 }, { lines: 20, pieces: 200 }, // candidate 0
    { lines: 1, pieces: 11 }, { lines: 3, pieces: 13 },     // candidate 1
    { lines: 0, pieces: 5 }, { lines: 0, pieces: 7 },       // candidate 2
  ];

  it('averages each candidate over its own games', () => {
    const { fitness, meanPieces } = aggregateFitness(results, 3, 2);
    expect(fitness).toEqual([15, 2, 0]);
    expect(meanPieces).toEqual([150, 12, 6]);
  });

  it('would notice a transposed flattening', () => {
    // If the loop read results[j * population + i] instead, candidate 0 would
    // average games 0 and 2 (10 and 1) giving 5.5 rather than 15. Pin the
    // correct attribution down so a refactor cannot silently swap it.
    const { fitness } = aggregateFitness(results, 3, 2);
    expect(fitness[0]).toBe(15);
    expect(fitness[0]).not.toBe(5.5);
  });

  it('rejects a result count that does not match population x games', () => {
    expect(() => aggregateFitness(results, 3, 3)).toThrow(/expected 9/);
    expect(() => aggregateFitness(results.slice(1), 3, 2)).toThrow(/expected 6/);
  });

  it('handles a single game per candidate', () => {
    const { fitness } = aggregateFitness(
      [{ lines: 4, pieces: 40 }, { lines: 8, pieces: 80 }], 2, 1,
    );
    expect(fitness).toEqual([4, 8]);
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
