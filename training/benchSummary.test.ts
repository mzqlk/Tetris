import { describe, expect, it } from 'vitest';
import { summarizeBench } from './benchSummary';

describe('summarizeBench', () => {
  const games = [
    { score: 900, lines: 20, pieces: 300, meanHeight: 4, reason: 'pieceCap' },
    { score: 600, lines: 10, pieces: 20, meanHeight: 8, reason: 'topOut' },
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

  it('rejects an empty result set and a non-positive schedule', () => {
    expect(() => summarizeBench([], 300)).toThrow(/result/);
    expect(() => summarizeBench(games, 0)).toThrow(/maxPieces/);
  });
});
