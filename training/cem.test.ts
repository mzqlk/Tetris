import { describe, it, expect } from 'vitest';
import {
  initCem, gaussian, sampleCandidates, noiseAt, updateCem, nextMaxPieces, median,
  aggregateFitness, eliteCount,
} from './cem';
import { mulberry32 } from '../src/ai/rng';
import { FEATURE_COUNT } from '../src/ai/features';
import type { LineClearCounts } from '../src/ai/lineClears';
import type { StrategyDiagnostics } from '../src/ai/tetrisStrategy';

const l2 = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

const result = (overrides: Partial<{
  score: number;
  lines: number;
  pieces: number;
  meanHeight: number;
  clearCounts: LineClearCounts;
  strategyDiagnostics: StrategyDiagnostics;
  reason: 'gameover' | 'pieceCap' | 'error';
}> = {}) => {
  const lines = overrides.lines ?? 0;
  return {
    score: 0,
    lines,
    pieces: 0,
    meanHeight: 0,
    clearCounts: overrides.clearCounts ?? {
      singles: lines, doubles: 0, triples: 0, tetrises: 0,
    },
    strategyDiagnostics: overrides.strategyDiagnostics ?? {
      meanCleanWellDepth: 0,
      meanTetrisSetupProgress: 0,
      meanTetrisReadyRows: 0,
    },
    reason: 'pieceCap' as const,
    ...overrides,
  };
};

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
    result({ score: 900, lines: 10, pieces: 100, meanHeight: 4 }),
    result({ score: 1500, lines: 20, pieces: 200, meanHeight: 6 }),
    result({ score: 600, lines: 1, pieces: 20, meanHeight: 8 }),
    result({ score: 900, lines: 3, pieces: 30, meanHeight: 10 }),
  ];

  it('aggregates mean score and diagnostics candidate by candidate', () => {
    const stats = aggregateFitness(results, 2, 2, 300);
    expect(stats.meanScore).toEqual([1200, 750]);
    expect(stats.meanLines).toEqual([15, 2]);
    expect(stats.meanPieces).toEqual([150, 25]);
    expect(stats.meanHeight).toEqual([5, 9]);
  });

  it('uses meanScore divided by the scheduled maxPieces as fitness', () => {
    const stats = aggregateFitness(results, 2, 2, 300);
    expect(stats.fitness).toEqual([4, 2.5]);
  });

  it('keeps height diagnostic instead of subtracting it from fitness', () => {
    const tidy = result({ score: 900, lines: 10, pieces: 300, meanHeight: 2 });
    const messy = result({ score: 900, lines: 10, pieces: 300, meanHeight: 18 });
    const stats = aggregateFitness([tidy, messy], 2, 1, 300);
    expect(stats.fitness).toEqual([3, 3]);
    expect(stats.meanHeight).toEqual([2, 18]);
  });

  it('does not reward an early death by dividing by actual survived pieces', () => {
    const quitter = result({ score: 600, lines: 1, pieces: 20, meanHeight: 3 });
    const survivor = result({ score: 1200, lines: 100, pieces: 300, meanHeight: 9 });
    const { fitness } = aggregateFitness([quitter, survivor], 2, 1, 300);

    expect(quitter.score / quitter.pieces).toBeGreaterThan(survivor.score / survivor.pieces);
    expect(fitness[1]).toBeGreaterThan(fitness[0]);
    expect(fitness).toEqual([2, 4]);
  });

  it('would notice a transposed flattening', () => {
    const rowMajor = [
      ...results,
      result({ score: 0, lines: 0, pieces: 5, meanHeight: 2 }),
      result({ score: 0, lines: 0, pieces: 7, meanHeight: 4 }),
    ];
    // If the loop read results[j * population + i] instead, candidate 0 would
    // average games 0 and 3 (10 and 3) giving 6.5 rather than 15. Pin the
    // correct attribution down so a refactor cannot silently swap it.
    const { meanLines } = aggregateFitness(rowMajor, 3, 2, 300);
    expect(meanLines[0]).toBe(15);
    expect(meanLines[0]).not.toBe(6.5);
  });

  it('rejects a result count that does not match population x games', () => {
    expect(() => aggregateFitness(results, 2, 3, 300)).toThrow(/expected 6/);
    expect(() => aggregateFitness(results.slice(1), 2, 2, 300)).toThrow(/expected 4/);
  });

  it('handles a single game per candidate', () => {
    const { meanScore, meanLines } = aggregateFitness(
      [
        result({ score: 400, lines: 4, pieces: 40, meanHeight: 3 }),
        result({ score: 800, lines: 8, pieces: 80, meanHeight: 3 }),
      ], 2, 1, 300,
    );
    expect(meanScore).toEqual([400, 800]);
    expect(meanLines).toEqual([4, 8]);
  });

  it('rejects a non-positive scheduled piece cap', () => {
    expect(() => aggregateFitness(results, 2, 2, 0)).toThrow(/maxPieces/);
  });

  it('aggregates clear counts and tetris share without changing fitness', () => {
    const stats = aggregateFitness([
      result({
        score: 900, lines: 4, pieces: 100,
        clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 1 },
      }),
      result({
        score: 1100, lines: 4, pieces: 100,
        clearCounts: { singles: 4, doubles: 0, triples: 0, tetrises: 0 },
      }),
    ], 1, 2, 100);

    expect(stats.meanScore).toEqual([1000]);
    expect(stats.fitness).toEqual([10]);
    expect(stats.meanClearCounts).toEqual([
      { singles: 2, doubles: 0, triples: 0, tetrises: 0.5 },
    ]);
    expect(stats.tetrisLineShares).toEqual([0.5]);
  });

  it('averages strategy diagnostics per game and counts exact end reasons', () => {
    const stats = aggregateFitness([
      result({
        score: 1000,
        reason: 'pieceCap',
        strategyDiagnostics: {
          meanCleanWellDepth: 4,
          meanTetrisSetupProgress: 3,
          meanTetrisReadyRows: 2,
        },
      }),
      result({
        score: 800,
        reason: 'gameover',
        strategyDiagnostics: {
          meanCleanWellDepth: 2,
          meanTetrisSetupProgress: 1,
          meanTetrisReadyRows: 0,
        },
      }),
    ], 1, 2, 300);

    expect(stats.meanStrategyDiagnostics).toEqual([{
      meanCleanWellDepth: 3,
      meanTetrisSetupProgress: 2,
      meanTetrisReadyRows: 1,
    }]);
    expect(stats.survivalDiagnostics).toEqual([{ pieceCapGames: 1, gameoverGames: 1 }]);
    expect(stats.fitness).toEqual([3]);
  });

  it('accepts error results without counting them as survival outcomes', () => {
    const stats = aggregateFitness([
      result({ reason: 'error' }),
    ], 1, 1, 300);

    expect(stats.survivalDiagnostics).toEqual([{ pieceCapGames: 0, gameoverGames: 0 }]);
    expect(stats.fitness).toEqual([0]);
  });

  it('rejects a worker result whose line total disagrees with its histogram', () => {
    expect(() => aggregateFitness([
      result({
        lines: 4,
        clearCounts: { singles: 1, doubles: 0, triples: 0, tetrises: 0 },
      }),
    ], 1, 1, 100)).toThrow(/clearCounts.*lines/);
  });

  it.each([
    ['fractional', 0.5, 0.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1],
    ['negative', -1, -1],
    ['NaN', Number.NaN, 0],
    ['infinite', Number.POSITIVE_INFINITY, 0],
  ])('rejects %s raw per-game clear counts', (_label, singles, lines) => {
    expect(() => aggregateFitness([
      result({
        lines,
        clearCounts: { singles, doubles: 0, triples: 0, tetrises: 0 },
      }),
    ], 1, 1, 100)).toThrow(/clearCounts|integer|finite|non-negative/);
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
