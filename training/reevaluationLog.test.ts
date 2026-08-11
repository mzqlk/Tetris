import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT } from '../src/ai/features';
import { evaluateTetrisCandidate } from './publication';
import { buildReevaluationLogEntry, type LoggedReevaluation } from './reevaluationLog';

const evaluated = (
  gen: number,
  weights: number[],
  meanScore: number,
  tetrisLineShare = 0.25,
  pieceCapGames = 30,
): LoggedReevaluation => ({
  gen,
  weights,
  meanScore,
  scoreRate: meanScore / 5000,
  meanLines: 16,
  meanHeight: 3.2,
  meanClearCounts: tetrisLineShare === 0
    ? { singles: 16, doubles: 0, triples: 0, tetrises: 0 }
    : { singles: 12, doubles: 0, triples: 0, tetrises: 1 },
  tetrisLineShare,
  strategyDiagnostics: {
    meanCleanWellDepth: 3,
    meanTetrisSetupProgress: 2,
    meanTetrisReadyRows: 1,
  },
  survivalDiagnostics: {
    pieceCapGames,
    gameoverGames: 30 - pieceCapGames,
  },
});

describe('buildReevaluationLogEntry', () => {
  it('records the published baseline, current qualified candidate, and auditable decision', () => {
    const publishedBaseline = evaluated(
      -1,
      Array(FEATURE_COUNT).fill(0.1),
      3_000_000,
      0,
    );
    const currentQualified = evaluated(20, Array(FEATURE_COUNT).fill(0.2), 3_003_500);
    const candidate = evaluated(30, Array(FEATURE_COUNT).fill(0.3), 3_006_000);
    const qualification = evaluateTetrisCandidate(
      candidate,
      publishedBaseline,
      currentQualified,
    );

    const event = buildReevaluationLogEntry({
      gen: 30,
      ts: 123,
      schedule: {
        games: 30,
        maxPieces: 5000,
        depth: 2,
        baseSeed: 20260727,
      },
      publishedBaseline,
      currentQualified,
      candidate,
      qualification,
    });

    expect(event).toMatchObject({
      objective: 'score-rate-v3',
      kind: 'reevaluation',
      gen: 30,
      schedule: { seedStrategy: 'fixed-reevaluation-v1' },
      publishedBaseline: { gen: -1, meanScore: 3_000_000 },
      currentQualified: { gen: 20, meanScore: 3_003_500 },
      candidate: { gen: 30, meanScore: 3_006_000 },
      qualification: {
        scoreDelta: 6000,
        tetrisLineShareDelta: 0.25,
        pieceCapGamesDelta: 0,
        shouldSave: true,
        reason: 'qualified',
        decision: 'save-candidate',
      },
    });
    expect(event.qualification.scoreRateDelta).toBeCloseTo(1.2, 12);
  });

  it('records a null current qualified candidate without changing baseline deltas', () => {
    const publishedBaseline = evaluated(
      -1,
      Array(FEATURE_COUNT).fill(0.1),
      3_000_000,
      0,
    );
    const candidate = evaluated(10, Array(FEATURE_COUNT).fill(0.2), 3_006_000);
    const qualification = evaluateTetrisCandidate(candidate, publishedBaseline, null);

    const event = buildReevaluationLogEntry({
      gen: 10,
      ts: 123,
      schedule: { games: 30, maxPieces: 5000, depth: 2, baseSeed: 1 },
      publishedBaseline,
      currentQualified: null,
      candidate,
      qualification,
    });

    expect(event.currentQualified).toBeNull();
    expect(event.qualification.scoreDelta).toBe(6000);
  });

  it('deeply snapshots every evaluation and the qualification result', () => {
    const publishedBaseline = evaluated(
      -1,
      Array(FEATURE_COUNT).fill(0.1),
      3_000_000,
      0,
    );
    const currentQualified = evaluated(20, Array(FEATURE_COUNT).fill(0.2), 3_003_500);
    const candidate = evaluated(30, Array(FEATURE_COUNT).fill(0.3), 3_006_000);
    const qualification = evaluateTetrisCandidate(
      candidate,
      publishedBaseline,
      currentQualified,
    );
    const event = buildReevaluationLogEntry({
      gen: 30,
      ts: 123,
      schedule: { games: 30, maxPieces: 5000, depth: 2, baseSeed: 1 },
      publishedBaseline,
      currentQualified,
      candidate,
      qualification,
    });

    for (const evaluation of [publishedBaseline, currentQualified, candidate]) {
      evaluation.weights[0] = 99;
      evaluation.meanClearCounts.singles = 99;
      evaluation.strategyDiagnostics.meanCleanWellDepth = 99;
      evaluation.survivalDiagnostics.pieceCapGames = 0;
    }
    qualification.shouldSave = false;

    expect(event.publishedBaseline).toMatchObject({
      meanClearCounts: { singles: 16 },
      strategyDiagnostics: { meanCleanWellDepth: 3 },
      survivalDiagnostics: { pieceCapGames: 30 },
    });
    expect(event.currentQualified).toMatchObject({
      meanClearCounts: { singles: 12 },
      strategyDiagnostics: { meanCleanWellDepth: 3 },
      survivalDiagnostics: { pieceCapGames: 30 },
    });
    expect(event.candidate).toMatchObject({
      meanClearCounts: { singles: 12 },
      strategyDiagnostics: { meanCleanWellDepth: 3 },
      survivalDiagnostics: { pieceCapGames: 30 },
    });
    expect(event.publishedBaseline.weights[0]).toBe(0.1);
    expect(event.currentQualified?.weights[0]).toBe(0.2);
    expect(event.candidate.weights[0]).toBe(0.3);
    expect(event.qualification.shouldSave).toBe(true);
  });
});
