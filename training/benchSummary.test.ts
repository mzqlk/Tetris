import { describe, expect, it } from 'vitest';
import { formatLineClearCounts, summarizeBench } from './benchSummary';

describe('summarizeBench', () => {
  const games = [
    {
      score: 900, lines: 20, pieces: 300, meanHeight: 4, reason: 'pieceCap',
      clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 5 },
    },
    {
      score: 600, lines: 10, pieces: 20, meanHeight: 8, reason: 'topOut',
      clearCounts: { singles: 0, doubles: 1, triples: 0, tetrises: 2 },
    },
  ];

  it('summarizes score, lines, height, and survival', () => {
    const summary = summarizeBench(games, 300);
    expect(summary.score).toEqual({ mean: 750, median: 750, min: 600, max: 900 });
    expect(summary.lines.mean).toBe(15);
    expect(summary.height.mean).toBe(6);
    expect(summary.cappedGames).toBe(1);
    expect(summary.totalPieces).toBe(320);
  });

  it('divides every game score by scheduled maxPieces rather than survived pieces', () => {
    const summary = summarizeBench(games, 300);
    expect(summary.scorePerScheduledPiece).toEqual({
      mean: 2.5,
      median: 2.5,
      min: 2,
      max: 3,
    });
    expect(600 / 20).toBe(30);
    expect(summary.scorePerScheduledPiece.min).toBe(2);
  });

  it('summarizes clear strategy against the scheduled denominator', () => {
    const summary = summarizeBench(games, 300);
    expect(summary.clearCounts).toEqual({ singles: 0, doubles: 1, triples: 0, tetrises: 7 });
    expect(summary.tetrisLineShare).toBeCloseTo(28 / 30, 12);
    expect(summary.tetrisesPer100ScheduledPieces).toBeCloseTo(100 * 7 / 600, 12);
    expect(formatLineClearCounts(summary.clearCounts)).toBe('1/2/3/4 clears 0/1/0/7');
  });

  it('reports no tetris line share when no lines were cleared', () => {
    const summary = summarizeBench([{
      score: 0, lines: 0, pieces: 10, meanHeight: 20, reason: 'topOut',
      clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 0 },
    }], 300);
    expect(summary.tetrisLineShare).toBe(0);
  });

  it('rejects a result whose lines disagree with its histogram', () => {
    const inconsistent = { ...games[0], lines: 19 };
    expect(() => summarizeBench([inconsistent], 300)).toThrow(/clearCounts.*lines/);
  });

  it('rejects an empty result set and a non-positive schedule', () => {
    expect(() => summarizeBench([], 300)).toThrow(/result/);
    expect(() => summarizeBench(games, 0)).toThrow(/maxPieces/);
  });
});
