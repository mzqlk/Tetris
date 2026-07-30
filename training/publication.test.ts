import { describe, expect, it } from 'vitest';
import {
  fixedReevaluationSeeds,
  shouldPublishScoreReevaluation,
  type ReevaluationSummary,
} from './publication';

const summary = (meanScore: number, meanHeight: number): ReevaluationSummary => ({
  meanScore,
  scoreRate: meanScore / 5000,
  meanLines: 1998,
  meanHeight,
});

describe('shouldPublishScoreReevaluation', () => {
  it('prefers a materially higher fixed-schedule score even with worse height', () => {
    expect(shouldPublishScoreReevaluation(
      summary(1002, 8),
      summary(1000, 3),
    )).toBe(true);
  });

  it('rejects a materially lower score even with better height', () => {
    expect(shouldPublishScoreReevaluation(
      summary(998, 2),
      summary(1000, 8),
    )).toBe(false);
  });

  it('uses lower height inside the approved 0.1 percent near-tie band', () => {
    expect(shouldPublishScoreReevaluation(
      summary(1000.5, 3),
      summary(1000, 4),
    )).toBe(true);
  });

  it('does not publish a less tidy candidate inside the near-tie band', () => {
    expect(shouldPublishScoreReevaluation(
      summary(1000.5, 5),
      summary(1000, 4),
    )).toBe(false);
  });

  it('treats the exact inclusive 0.1 percent boundary as a height-decided tie', () => {
    expect(shouldPublishScoreReevaluation(
      summary(1000, 8),
      summary(999, 3),
    )).toBe(false);
    expect(shouldPublishScoreReevaluation(
      summary(999, 2),
      summary(1000, 8),
    )).toBe(true);
  });

  it('follows score ordering just outside the 0.1 percent band regardless of height', () => {
    expect(shouldPublishScoreReevaluation(
      summary(1000, 8),
      summary(998.999999, 2),
    )).toBe(true);
    expect(shouldPublishScoreReevaluation(
      summary(998.999999, 2),
      summary(1000, 8),
    )).toBe(false);
  });
});

describe('fixedReevaluationSeeds', () => {
  it('returns the same schedule whenever the base seed is the same', () => {
    expect(fixedReevaluationSeeds(20260727, 30))
      .toEqual(fixedReevaluationSeeds(20260727, 30));
    expect(fixedReevaluationSeeds(20260727, 30)).toHaveLength(30);
  });

  it('changes the schedule when the run base seed changes', () => {
    expect(fixedReevaluationSeeds(1, 3)).not.toEqual(fixedReevaluationSeeds(2, 3));
  });
});
