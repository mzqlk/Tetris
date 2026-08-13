import { describe, it, expect } from 'vitest';
import {
  toVector, fromVector, normalize, parseWeightsFile,
  HANDCRAFTED_WEIGHTS, DEFAULT_WEIGHTS, type Weights,
} from './weights';
import {
  LEGACY_FEATURE_NAMES, SCORE_RATE_V2_FEATURE_NAMES, FEATURE_NAMES, FEATURE_COUNT,
} from './features';

const sample: Weights = {
  aggregateHeight: -1, holes: -2, bumpiness: -3, maxHeight: -4, linesCleared: 5,
  landingHeight: -6, rowTransitions: -7, colTransitions: -8, wellDepth: -9, lineClearValue: -10,
  cleanWellDepth: 0, tetrisSetupProgress: 0, tetrisReadyRows: 0,
};

const l2 = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe('toVector / fromVector', () => {
  it('round-trips a weights object', () => {
    expect(fromVector(toVector(sample))).toEqual(sample);
  });

  it('orders the vector by FEATURE_NAMES', () => {
    expect(toVector(sample)).toEqual([-1, -2, -3, -4, 5, -6, -7, -8, -9, -10, 0, 0, 0]);
  });

  it('rejects a vector of the wrong length', () => {
    expect(() => fromVector([1, 2, 3])).toThrow();
  });
});

describe('normalize', () => {
  it('produces a unit vector', () => {
    expect(l2(normalize([3, 4, ...Array(FEATURE_COUNT - 2).fill(0)]))).toBeCloseTo(1, 12);
    expect(l2(normalize(toVector(sample)))).toBeCloseTo(1, 12);
  });

  it('preserves direction', () => {
    const n = normalize([2, ...Array(FEATURE_COUNT - 1).fill(0)]);
    expect(n[0]).toBeCloseTo(1, 12);
  });

  it('returns the zero vector unchanged instead of NaN', () => {
    const zeros = Array(FEATURE_COUNT).fill(0);
    expect(normalize(zeros)).toEqual(zeros);
    expect(normalize(zeros).every(Number.isFinite)).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = [3, 4, ...Array(FEATURE_COUNT - 2).fill(0)];
    normalize(input);
    expect(input).toEqual([3, 4, ...Array(FEATURE_COUNT - 2).fill(0)]);
  });
});

describe('parseWeightsFile', () => {
  const valid = {
    version: 1,
    weights: Object.fromEntries(LEGACY_FEATURE_NAMES.map((n, i) => [n, i - 4])),
    meanLines: 100, evalGames: 30, gen: 12, searchDepth: 2,
    trainedAt: '2026-07-27T10:00:00.000Z',
  };

  const historical = {
    weights: { ...valid.weights },
    meanLines: valid.meanLines,
    evalGames: valid.evalGames,
    gen: valid.gen,
    searchDepth: valid.searchDepth,
    trainedAt: valid.trainedAt,
  };

  const meanClearCounts = { singles: 2, doubles: 1, triples: 0, tetrises: 3 };
  const v2File = {
    version: 3,
    objective: 'score-rate-v2',
    weights: Object.fromEntries(SCORE_RATE_V2_FEATURE_NAMES.map((name, index) => [name, index])),
    meanScore: 123456,
    evalMaxPieces: 5000,
    meanLines: 16,
    meanHeight: 4,
    meanClearCounts,
    tetrisLineShare: 12 / 16,
    evalGames: 30,
    gen: 1,
    searchDepth: 2,
    trainedAt: '2026-08-06T00:00:00.000Z',
  };

  const v3File = {
    version: 3,
    objective: 'score-rate-v2',
    weights: Object.fromEntries(SCORE_RATE_V2_FEATURE_NAMES.map((name, index) => [name, index])),
    meanScore: 3_289_243.3333333335,
    evalMaxPieces: 5000,
    meanLines: 1998,
    meanHeight: 4,
    meanClearCounts: { singles: 1456, doubles: 265, triples: 4, tetrises: 0 },
    tetrisLineShare: 0,
    evalGames: 30,
    gen: 40,
    searchDepth: 2,
    trainedAt: '2026-08-10T12:21:46.191Z',
  };

  const v4File = {
    ...v3File,
    version: 4,
    objective: 'score-rate-v3',
    weights: Object.fromEntries(FEATURE_NAMES.map((name, index) => [name, index / 13])),
    strategyDiagnostics: {
      meanCleanWellDepth: 3,
      meanTetrisSetupProgress: 2.5,
      meanTetrisReadyRows: 1,
    },
    survivalDiagnostics: { pieceCapGames: 30, gameoverGames: 0 },
  };

  const v5File = {
    ...v4File,
    version: 5,
    objective: 'score-rate-v4',
    searchContract: 'bag-expectimax-hold-v1',
    searchDepth: 4,
    rootBeamWidth: 64,
    childBeamWidth: 32,
    searchDiagnostics: {
      holdActions: 10, holdRate: 0.1, meanCompletedDepth: 4,
      minCompletedDepth: 4, expandedDecisionNodes: 100,
      expandedChanceNodes: 50, cacheHits: 5, abortedSearches: 0,
    },
  };

  it('accepts a complete file', () => {
    const parsed = parseWeightsFile(valid);
    expect(parsed).not.toBeNull();
    expect(parsed!.weights.holes).toBe(valid.weights.holes);
    expect(parsed!.gen).toBe(12);
  });

  it('accepts a historical nine-key file with no version or objective declaration', () => {
    expect(parseWeightsFile(historical)).not.toBeNull();
  });

  it('adapts an exact score-rate-v1 file with a zero nonlinear coefficient', () => {
    const legacyWeights = Object.fromEntries(
      LEGACY_FEATURE_NAMES.map((name, index) => [name, index - 4]),
    );
    const parsed = parseWeightsFile({
      version: 2,
      objective: 'score-rate-v1',
      weights: legacyWeights,
      meanScore: 123,
      evalMaxPieces: 5000,
    });

    expect(parsed).not.toBeNull();
    expect(parsed!.weights.lineClearValue).toBe(0);
    expect(Object.keys(parsed!.weights)).toEqual([...FEATURE_NAMES]);
    expect(parsed!.meanClearCounts).toBeNull();
    expect(parsed!.tetrisLineShare).toBeNull();
  });

  it('accepts a complete score-rate-v2 file with consistent diagnostics', () => {
    expect(parseWeightsFile(v2File)).toMatchObject({
      version: 3,
      objective: 'score-rate-v2',
      meanScore: 123456,
      evalMaxPieces: 5000,
      meanLines: 16,
      meanHeight: 4,
      meanClearCounts,
      tetrisLineShare: 0.75,
      evalGames: 30,
      gen: 1,
      searchDepth: 2,
      trainedAt: '2026-08-06T00:00:00.000Z',
    });
  });

  it('zero-extends score-rate-v2 weights without rewriting metadata', () => {
    const parsed = parseWeightsFile(v3File)!;
    expect(parsed.objective).toBe('score-rate-v2');
    expect(parsed.weights.cleanWellDepth).toBe(0);
    expect(parsed.weights.tetrisSetupProgress).toBe(0);
    expect(parsed.weights.tetrisReadyRows).toBe(0);
    expect(Object.keys(parsed.weights)).toEqual([...FEATURE_NAMES]);
  });

  it('requires exact version-4 strategy and survival metadata', () => {
    expect(parseWeightsFile(v4File)).toMatchObject({
      version: 4,
      objective: 'score-rate-v3',
      strategyDiagnostics: v4File.strategyDiagnostics,
      survivalDiagnostics: v4File.survivalDiagnostics,
    });
    expect(parseWeightsFile({ ...v4File, strategyDiagnostics: null })).toBeNull();
    expect(parseWeightsFile({
      ...v4File,
      survivalDiagnostics: { pieceCapGames: 31, gameoverGames: 0 },
    })).toBeNull();
  });

  it('accepts exact version-5 score-rate-v4 metadata', () => {
    expect(parseWeightsFile(v5File)).toMatchObject({
      version: 5,
      objective: 'score-rate-v4',
      searchContract: 'bag-expectimax-hold-v1',
      searchDepth: 4,
      rootBeamWidth: 64,
      childBeamWidth: 32,
    });
  });

  it.each(['searchContract', 'searchDepth', 'rootBeamWidth', 'childBeamWidth'])('rejects version-5 weights missing %s', (key) => {
      const payload = { ...v5File } as Record<string, unknown>;
      Reflect.deleteProperty(payload, key);
      expect(parseWeightsFile(payload)).toBeNull();
    });

  it.each([
    'meanScore',
    'evalMaxPieces',
    'meanLines',
    'meanHeight',
    'meanClearCounts',
    'tetrisLineShare',
    'evalGames',
    'gen',
    'searchDepth',
    'trainedAt',
  ])('rejects a score-rate-v2 file missing %s', (field) => {
    const missing = { ...v2File } as Record<string, unknown>;
    Reflect.deleteProperty(missing, field);
    expect(parseWeightsFile(missing)).toBeNull();
  });

  it.each([
    ['meanScore', -1],
    ['evalMaxPieces', 0],
    ['meanLines', -1],
    ['meanHeight', -1],
    ['meanClearCounts', { ...meanClearCounts, singles: -1 }],
    ['tetrisLineShare', -0.1],
    ['evalGames', 0],
    ['gen', -2],
    ['searchDepth', 3],
    ['trainedAt', 'not-an-iso-timestamp'],
  ])('rejects malformed score-rate-v2 %s metadata', (field, value) => {
    expect(parseWeightsFile({ ...v2File, [field]: value })).toBeNull();
  });

  it('accepts the score-rate-v2 baseline generation sentinel', () => {
    expect(parseWeightsFile({ ...v2File, gen: -1 })).toMatchObject({ gen: -1 });
  });

  it('accepts derived diagnostics inside the relative consistency tolerance', () => {
    expect(parseWeightsFile({
      ...v2File,
      meanLines: 16 + 8e-12,
      tetrisLineShare: 0.75 + 5e-13,
    })).not.toBeNull();
  });

  it('accepts only an exact ten-key score-rate-v2 weight vector', () => {
    const missing = { ...v2File.weights };
    Reflect.deleteProperty(missing, 'lineClearValue');
    expect(parseWeightsFile({ ...v2File, weights: missing })).toBeNull();
    expect(parseWeightsFile({
      ...v2File,
      weights: { ...v2File.weights, extra: 1 },
    })).toBeNull();
  });

  it('rejects inconsistent score-rate-v2 diagnostics', () => {
    expect(parseWeightsFile({ ...v2File, meanLines: 15 })).toBeNull();
    expect(parseWeightsFile({ ...v2File, tetrisLineShare: 0 })).toBeNull();
  });

  it.each([
    ['a missing key', { singles: 2, doubles: 1, tetrises: 3 }],
    ['an extra key', { ...meanClearCounts, extra: 0 }],
    ['a negative value', { ...meanClearCounts, triples: -1 }],
    ['a non-finite value', { ...meanClearCounts, doubles: Number.NaN }],
  ])('rejects score-rate-v2 clear counts with %s', (_label, counts) => {
    expect(parseWeightsFile({ ...v2File, meanClearCounts: counts })).toBeNull();
  });

  it('returns null when finite clear counts overflow their derived totals', () => {
    const overflowingCounts = {
      singles: Number.MAX_VALUE,
      doubles: Number.MAX_VALUE,
      triples: Number.MAX_VALUE,
      tetrises: Number.MAX_VALUE,
    };
    expect(() => parseWeightsFile({
      ...v2File,
      meanClearCounts: overflowingCounts,
    })).not.toThrow();
    expect(parseWeightsFile({
      ...v2File,
      meanClearCounts: overflowingCounts,
    })).toBeNull();
  });

  it('does not downgrade a declared version 2 file with missing objective', () => {
    const weights = Object.fromEntries(LEGACY_FEATURE_NAMES.map((name) => [name, 0]));
    expect(parseWeightsFile({ version: 2, weights })).toBeNull();
  });

  it.each([Number.NaN, '2'])('rejects a malformed declared version %s', (version) => {
    const weights = Object.fromEntries(LEGACY_FEATURE_NAMES.map((name) => [name, 0]));
    expect(parseWeightsFile({ version, weights })).toBeNull();
  });

  it('carries the mean stack height the model was selected on', () => {
    expect(parseWeightsFile({ ...valid, meanHeight: 4.25 })!.meanHeight).toBe(4.25);
  });

  it('defaults meanHeight to 0 for a file written before that metric existed', () => {
    expect(parseWeightsFile(valid)!.meanHeight).toBe(0);
  });

  it('carries score-goal metadata from a newly published file', () => {
    const parsed = parseWeightsFile({
      ...valid,
      version: 2,
      objective: 'score-rate-v1',
      meanScore: 123456.5,
      evalMaxPieces: 5000,
    });

    expect(parsed).toMatchObject({
      version: 2,
      objective: 'score-rate-v1',
      meanScore: 123456.5,
      evalMaxPieces: 5000,
    });
  });

  it('normalises score metadata to null for a legacy weights file', () => {
    const parsed = parseWeightsFile(valid);
    expect(parsed).not.toBeNull();
    expect(parsed!.objective).toBeNull();
    expect(parsed!.meanScore).toBeNull();
    expect(parsed!.evalMaxPieces).toBeNull();
    expect(parsed!.meanClearCounts).toBeNull();
    expect(parsed!.tetrisLineShare).toBeNull();
  });

  it.each([7, null, undefined, 'score-rate-v1'])(
    'rejects a version 1 file with malformed objective declaration %s',
    (objective) => {
      expect(parseWeightsFile({ ...valid, objective })).toBeNull();
    },
  );

  it('rejects a missing feature key', () => {
    const withoutHoles = Object.fromEntries(
      Object.entries(valid.weights).filter(([name]) => name !== 'holes'),
    );
    expect(parseWeightsFile({ ...valid, weights: withoutHoles })).toBeNull();
  });

  it('rejects an unknown extra key', () => {
    expect(parseWeightsFile({ ...valid, weights: { ...valid.weights, tspins: 1 } })).toBeNull();
  });

  it('rejects non-finite and non-numeric values', () => {
    expect(parseWeightsFile({ ...valid, weights: { ...valid.weights, holes: NaN } })).toBeNull();
    expect(parseWeightsFile({ ...valid, weights: { ...valid.weights, holes: 'x' } })).toBeNull();
  });

  it('rejects junk', () => {
    expect(parseWeightsFile(null)).toBeNull();
    expect(parseWeightsFile('nope')).toBeNull();
    expect(parseWeightsFile({})).toBeNull();
  });
});

describe('built-in weights', () => {
  it('are complete and finite', () => {
    for (const w of [HANDCRAFTED_WEIGHTS, DEFAULT_WEIGHTS]) {
      expect(Object.keys(w).sort()).toEqual([...FEATURE_NAMES].sort());
      expect(toVector(w).every(Number.isFinite)).toBe(true);
    }
  });

  it('are normalised', () => {
    expect(l2(toVector(HANDCRAFTED_WEIGHTS))).toBeCloseTo(1, 6);
    expect(l2(toVector(DEFAULT_WEIGHTS))).toBeCloseTo(1, 6);
  });

  it('penalise holes and reward line clears', () => {
    expect(HANDCRAFTED_WEIGHTS.holes).toBeLessThan(0);
    expect(HANDCRAFTED_WEIGHTS.linesCleared).toBeGreaterThan(0);
  });
});
