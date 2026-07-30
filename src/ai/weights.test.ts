import { describe, it, expect } from 'vitest';
import {
  toVector, fromVector, normalize, parseWeightsFile,
  HANDCRAFTED_WEIGHTS, DEFAULT_WEIGHTS, type Weights,
} from './weights';
import { FEATURE_NAMES, FEATURE_COUNT } from './features';

const sample: Weights = {
  aggregateHeight: -1, holes: -2, bumpiness: -3, maxHeight: -4, linesCleared: 5,
  landingHeight: -6, rowTransitions: -7, colTransitions: -8, wellDepth: -9,
};

const l2 = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe('toVector / fromVector', () => {
  it('round-trips a weights object', () => {
    expect(fromVector(toVector(sample))).toEqual(sample);
  });

  it('orders the vector by FEATURE_NAMES', () => {
    expect(toVector(sample)).toEqual([-1, -2, -3, -4, 5, -6, -7, -8, -9]);
  });

  it('rejects a vector of the wrong length', () => {
    expect(() => fromVector([1, 2, 3])).toThrow();
  });
});

describe('normalize', () => {
  it('produces a unit vector', () => {
    expect(l2(normalize([3, 4, 0, 0, 0, 0, 0, 0, 0]))).toBeCloseTo(1, 12);
    expect(l2(normalize(toVector(sample)))).toBeCloseTo(1, 12);
  });

  it('preserves direction', () => {
    const n = normalize([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(n[0]).toBeCloseTo(1, 12);
  });

  it('returns the zero vector unchanged instead of NaN', () => {
    const zeros = Array(FEATURE_COUNT).fill(0);
    expect(normalize(zeros)).toEqual(zeros);
    expect(normalize(zeros).every(Number.isFinite)).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = [3, 4, 0, 0, 0, 0, 0, 0, 0];
    normalize(input);
    expect(input).toEqual([3, 4, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('parseWeightsFile', () => {
  const valid = {
    version: 1,
    weights: Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, i - 4])),
    meanLines: 100, evalGames: 30, gen: 12, searchDepth: 2,
    trainedAt: '2026-07-27T10:00:00.000Z',
  };

  it('accepts a complete file', () => {
    const parsed = parseWeightsFile(valid);
    expect(parsed).not.toBeNull();
    expect(parsed!.weights.holes).toBe(valid.weights.holes);
    expect(parsed!.gen).toBe(12);
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
  });

  it('does not turn malformed score metadata into a false numeric baseline', () => {
    const parsed = parseWeightsFile({
      ...valid,
      objective: 7,
      meanScore: '123456',
      evalMaxPieces: Number.NaN,
    });
    expect(parsed).toMatchObject({ objective: null, meanScore: null, evalMaxPieces: null });
  });

  it('rejects a missing feature key', () => {
    const { holes, ...rest } = valid.weights;
    expect(parseWeightsFile({ ...valid, weights: rest })).toBeNull();
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
