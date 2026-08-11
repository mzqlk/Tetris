import { describe, expect, it } from 'vitest';
import {
  evaluatePairedAcceptance,
  pairedInterval30,
  type PairedGameResult,
} from './pairedStats';

const game = (
  score: number,
  tetrisLineShare: 0 | 0.25,
  reason: 'pieceCap' | 'gameover' = 'pieceCap',
): PairedGameResult => ({
  score,
  reason,
  clearCounts: tetrisLineShare === 0
    ? { singles: 16, doubles: 0, triples: 0, tetrises: 0 }
    : { singles: 12, doubles: 0, triples: 0, tetrises: 1 },
});

describe('pairedInterval30', () => {
  it('computes the fixed 30-pair 95 percent interval from hand-derived values', () => {
    const values = Array.from({ length: 30 }, (_, index) => 8 + (index % 3) - 1);
    const interval = pairedInterval30(values);

    expect(interval.mean).toBe(8);
    expect(interval.lower).toBeCloseTo(7.689903, 5);
    expect(interval.upper).toBeCloseTo(8.310097, 5);
  });

  it.each([
    ['too few', Array.from({ length: 29 }, () => 1)],
    ['too many', Array.from({ length: 31 }, () => 1)],
    ['non-finite', [...Array.from({ length: 29 }, () => 1), Number.NaN]],
  ])('rejects %s values', (_label, values) => {
    expect(() => pairedInterval30(values)).toThrow(
      'paired acceptance requires exactly 30 finite values',
    );
  });
});

describe('evaluatePairedAcceptance', () => {
  it('accepts only when all four global gates pass', () => {
    const baseline = Array.from({ length: 30 }, () => game(3_000_000, 0));
    const candidate = Array.from({ length: 30 }, () => game(3_100_000, 0.25));

    expect(evaluatePairedAcceptance(baseline, candidate, 5000)).toMatchObject({
      accepted: true,
      candidateTetrisLineShare: 0.25,
      baselinePieceCapGames: 30,
      candidatePieceCapGames: 30,
    });
  });

  it('uses the scheduled denominator for every paired score rate', () => {
    const baseline = Array.from({ length: 30 }, () => game(5000, 0));
    const candidate = Array.from({ length: 30 }, () => game(10_000, 0.25));
    const result = evaluatePairedAcceptance(baseline, candidate, 5000);

    expect(result.scoreRateInterval.mean).toBe(1);
    expect(result.scoreRateDelta).toBe(1);
  });

  it('counts exact cap reasons and rejects a survival regression', () => {
    const baseline = Array.from({ length: 30 }, () => game(3_000_000, 0));
    const candidate = Array.from({ length: 30 }, (_, index) =>
      game(3_100_000, 0.25, index === 29 ? 'gameover' : 'pieceCap'));

    const result = evaluatePairedAcceptance(baseline, candidate, 5000);

    expect(result.baselinePieceCapGames).toBe(30);
    expect(result.candidatePieceCapGames).toBe(29);
    expect(result.accepted).toBe(false);
  });

  it('rejects a candidate below the aggregate Tetris share threshold', () => {
    const baseline = Array.from({ length: 30 }, () => game(3_000_000, 0));
    const candidate = Array.from({ length: 30 }, () => game(3_100_000, 0));

    expect(evaluatePairedAcceptance(baseline, candidate, 5000)).toMatchObject({
      accepted: false,
      candidateTetrisLineShare: 0,
    });
  });

  it('rejects a candidate whose paired Tetris share interval does not clear zero', () => {
    const baseline = Array.from({ length: 30 }, () => game(3_000_000, 0.25));
    const candidate = Array.from({ length: 30 }, () => game(3_100_000, 0.25));

    const result = evaluatePairedAcceptance(baseline, candidate, 5000);

    expect(result.candidateTetrisLineShare).toBeGreaterThan(0.2);
    expect(result.tetrisLineShareInterval.lower).toBeLessThanOrEqual(0);
    expect(result.accepted).toBe(false);
  });

  it('rejects a candidate whose paired score interval does not clear zero', () => {
    const baseline = Array.from({ length: 30 }, () => game(3_000_000, 0));
    const candidate = Array.from({ length: 30 }, (_, index) =>
      game(index % 2 === 0 ? 3_000_100 : 2_999_900, 0.25));

    const result = evaluatePairedAcceptance(baseline, candidate, 5000);

    expect(result.scoreRateInterval.lower).toBeLessThanOrEqual(0);
    expect(result.accepted).toBe(false);
  });
});
