import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT } from '../src/ai/features';
import { evaluateScoreReevaluation } from './publication';
import { buildReevaluationLogEntry } from './reevaluationLog';

const evaluated = (
  gen: number,
  weights: number[],
  meanScore: number,
  meanHeight: number,
) => ({
  gen,
  weights,
  meanScore,
  scoreRate: meanScore / 5000,
  meanLines: 1998,
  meanHeight,
  meanClearCounts: { singles: 2, doubles: 0, triples: 0, tetrises: 499 },
  tetrisLineShare: 1996 / 1998,
});

describe('buildReevaluationLogEntry', () => {
  it('records an auditable candidate-minus-current comparison', () => {
    const currentBest = evaluated(20, Array(FEATURE_COUNT).fill(0.1), 3_000_000, 3.1);
    const candidate = evaluated(30, Array(FEATURE_COUNT).fill(0.2), 3_006_000, 3.2);
    const decision = evaluateScoreReevaluation(candidate, currentBest);

    const event = buildReevaluationLogEntry({
      gen: 30,
      ts: 123,
      schedule: {
        games: 30,
        maxPieces: 5000,
        depth: 2,
        baseSeed: 20260727,
      },
      currentBest,
      candidate,
      decision,
    });

    expect(event).toMatchObject({
      objective: 'score-rate-v2',
      kind: 'reevaluation',
      gen: 30,
      schedule: { seedStrategy: 'fixed-reevaluation-v1' },
      comparison: {
        scoreDelta: 6000,
        scoreTolerance: 3006,
        decision: 'publish',
        reason: 'higher-score',
      },
    });
    expect(event.comparison.scoreRateDelta).toBeCloseTo(1.2);
    expect(event.comparison.relativeScoreDelta).toBeCloseTo(6000 / 3_006_000);
    expect(event.comparison.heightDelta).toBeCloseTo(0.1);
  });

  it('uses zero relative delta when both scores are zero', () => {
    const currentBest = evaluated(20, Array(FEATURE_COUNT).fill(0.1), 0, 4);
    const candidate = evaluated(30, Array(FEATURE_COUNT).fill(0.2), 0, 3);
    const event = buildReevaluationLogEntry({
      gen: 30,
      ts: 123,
      schedule: { games: 30, maxPieces: 5000, depth: 2, baseSeed: 1 },
      currentBest,
      candidate,
      decision: evaluateScoreReevaluation(candidate, currentBest),
    });

    expect(event.comparison.relativeScoreDelta).toBe(0);
    expect(Number.isFinite(event.comparison.relativeScoreDelta)).toBe(true);
  });

  it('copies weight vectors and line-clear counts instead of retaining mutable references', () => {
    const currentWeights = Array(FEATURE_COUNT).fill(0.1);
    const candidateWeights = Array(FEATURE_COUNT).fill(0.2);
    const currentBest = evaluated(20, currentWeights, 1000, 4);
    const candidate = evaluated(30, candidateWeights, 1001, 3);
    const event = buildReevaluationLogEntry({
      gen: 30,
      ts: 123,
      schedule: { games: 30, maxPieces: 5000, depth: 2, baseSeed: 1 },
      currentBest,
      candidate,
      decision: evaluateScoreReevaluation(candidate, currentBest),
    });

    currentWeights[0] = 99;
    candidateWeights[0] = 99;
    currentBest.meanClearCounts.singles = 99;
    candidate.meanClearCounts.tetrises = 99;
    expect(event.currentBest.weights[0]).toBe(0.1);
    expect(event.candidate.weights[0]).toBe(0.2);
    expect(event.currentBest.meanClearCounts.singles).toBe(2);
    expect(event.candidate.meanClearCounts.tetrises).toBe(499);
  });
});
