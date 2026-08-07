import { describe, expect, it } from 'vitest';
import {
  evaluateScoreReevaluation,
  fixedReevaluationSeeds,
  shouldPublishScoreReevaluation,
  type ReevaluationSummary,
} from './publication';

const defaultMeanClearCounts = {
  singles: 2,
  doubles: 0,
  triples: 0,
  tetrises: 499,
};

const summary = (
  meanScore: number,
  meanHeight: number,
  diagnostics: Pick<ReevaluationSummary, 'meanClearCounts' | 'tetrisLineShare'> = {
    meanClearCounts: { ...defaultMeanClearCounts },
    tetrisLineShare: 1996 / 1998,
  },
): ReevaluationSummary => ({
  meanScore,
  scoreRate: meanScore / 5000,
  meanLines: 1998,
  meanHeight,
  ...diagnostics,
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

describe('evaluateScoreReevaluation', () => {
  it('does not use line-clear diagnostics in publication decisions', () => {
    const currentBest = summary(1000, 4);
    const candidate = summary(1000.5, 3);
    const differentDiagnostics = summary(1000.5, 3, {
      meanClearCounts: { singles: 1998, doubles: 0, triples: 0, tetrises: 0 },
      tetrisLineShare: 0,
    });

    expect(evaluateScoreReevaluation(differentDiagnostics, currentBest))
      .toEqual(evaluateScoreReevaluation(candidate, currentBest));
  });

  it('explains a material score improvement', () => {
    expect(evaluateScoreReevaluation(
      summary(1002, 8),
      summary(1000, 3),
    )).toEqual({
      shouldPublish: true,
      scoreTolerance: 1.002,
      reason: 'higher-score',
    });
  });

  it('explains a material score regression', () => {
    expect(evaluateScoreReevaluation(
      summary(998, 2),
      summary(1000, 8),
    )).toEqual({
      shouldPublish: false,
      scoreTolerance: 1,
      reason: 'lower-score',
    });
  });

  it('explains both height decisions inside the score tolerance', () => {
    expect(evaluateScoreReevaluation(
      summary(1000.5, 3),
      summary(1000, 4),
    )).toEqual({
      shouldPublish: true,
      scoreTolerance: 1.0005,
      reason: 'lower-height-within-score-tolerance',
    });
    expect(evaluateScoreReevaluation(
      summary(1000.5, 5),
      summary(1000, 4),
    )).toEqual({
      shouldPublish: false,
      scoreTolerance: 1.0005,
      reason: 'height-not-lower-within-score-tolerance',
    });
  });

  it('keeps the exact 0.1 percent boundary inside the height tie-break', () => {
    expect(evaluateScoreReevaluation(
      summary(1000, 8),
      summary(999, 3),
    )).toEqual({
      shouldPublish: false,
      scoreTolerance: 1,
      reason: 'height-not-lower-within-score-tolerance',
    });
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
