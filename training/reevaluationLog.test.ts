import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT } from '../src/ai/features';
import { evaluateTetrisCandidate } from './publication';
import {
  buildReevaluationLogEntry,
  parseReevaluationLogEntry,
  type LoggedReevaluation,
} from './reevaluationLog';

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
  searchDiagnostics: {
    searchCalls: 10,
    holdActions: 4,
    holdRate: 0.4,
    meanCompletedDepth: 3.3,
    minCompletedDepth: 2,
    completedDepthHistogram: [0, 0, 2, 3, 5],
    totalWorkUnitsUsed: 30_000,
    meanWorkUnitsUsed: 3_000,
    maxWorkUnitsUsed: 3_584,
    budgetExhaustedSearches: 2,
    budgetExhaustionRate: 0.2,
    placementEvaluationUnits: 20_000,
    chanceExpansionUnits: 8_000,
    cacheHitUnits: 2_000,
    expandedDecisionNodes: 10,
    expandedChanceNodes: 20,
    cacheHits: 2_000,
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
      searchContract: 'bag-expectimax-hold-v2',
      searchDepth: 4,
      rootBeamWidth: 64,
      childBeamWidth: 32,
      maxWorkUnits: 3_584,
      budgetCorpus: 'budget-corpus-v1',
      transpositionCacheEntries: 65_536,
      placementCacheEntries: 16_384,
      schedule: {
        games: 30,
        maxPieces: 5000,
        searchContract: 'bag-expectimax-hold-v2',
        searchDepth: 4,
        rootBeamWidth: 64,
        childBeamWidth: 32,
        maxWorkUnits: 3_584,
        budgetCorpus: 'budget-corpus-v1',
        transpositionCacheEntries: 65_536,
        placementCacheEntries: 16_384,
        baseSeed: 20260727,
      },
      publishedBaseline,
      currentQualified,
      candidate,
      qualification,
    });

    expect(event).toMatchObject({
      objective: 'score-rate-v5',
      searchContract: 'bag-expectimax-hold-v2',
      maxWorkUnits: 3_584,
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
      searchContract: 'bag-expectimax-hold-v2',
      searchDepth: 4,
      rootBeamWidth: 64,
      childBeamWidth: 32,
      maxWorkUnits: 3_584,
      budgetCorpus: 'budget-corpus-v1',
      transpositionCacheEntries: 65_536,
      placementCacheEntries: 16_384,
    schedule: { games: 30, maxPieces: 5000, searchContract: 'bag-expectimax-hold-v2', searchDepth: 4, rootBeamWidth: 64, childBeamWidth: 32, maxWorkUnits: 3_584, budgetCorpus: 'budget-corpus-v1', transpositionCacheEntries: 65_536, placementCacheEntries: 16_384, baseSeed: 1 },
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
      searchContract: 'bag-expectimax-hold-v2',
      searchDepth: 4,
      rootBeamWidth: 64,
      childBeamWidth: 32,
      maxWorkUnits: 3_584,
      budgetCorpus: 'budget-corpus-v1',
      transpositionCacheEntries: 65_536,
      placementCacheEntries: 16_384,
    schedule: { games: 30, maxPieces: 5000, searchContract: 'bag-expectimax-hold-v2', searchDepth: 4, rootBeamWidth: 64, childBeamWidth: 32, maxWorkUnits: 3_584, budgetCorpus: 'budget-corpus-v1', transpositionCacheEntries: 65_536, placementCacheEntries: 16_384, baseSeed: 1 },
      publishedBaseline,
      currentQualified,
      candidate,
      qualification,
    });

    for (const evaluation of [publishedBaseline, currentQualified, candidate]) {
      evaluation.weights[0] = 99;
      evaluation.meanClearCounts.singles = 99;
      evaluation.strategyDiagnostics.meanCleanWellDepth = 99;
      evaluation.searchDiagnostics!.holdActions = 99;
      evaluation.survivalDiagnostics.pieceCapGames = 0;
    }
    qualification.shouldSave = false;

    expect(event.publishedBaseline).toMatchObject({
      meanClearCounts: { singles: 16 },
      strategyDiagnostics: { meanCleanWellDepth: 3 },
      searchDiagnostics: { holdActions: 4 },
      survivalDiagnostics: { pieceCapGames: 30 },
    });
    expect(event.currentQualified).toMatchObject({
      meanClearCounts: { singles: 12 },
      strategyDiagnostics: { meanCleanWellDepth: 3 },
      searchDiagnostics: { holdActions: 4 },
      survivalDiagnostics: { pieceCapGames: 30 },
    });
    expect(event.candidate).toMatchObject({
      meanClearCounts: { singles: 12 },
      strategyDiagnostics: { meanCleanWellDepth: 3 },
      searchDiagnostics: { holdActions: 4 },
      survivalDiagnostics: { pieceCapGames: 30 },
    });
    expect(event.publishedBaseline.weights[0]).toBe(0.1);
    expect(event.currentQualified?.weights[0]).toBe(0.2);
    expect(event.candidate.weights[0]).toBe(0.3);
    expect(event.qualification.shouldSave).toBe(true);
  });

  it('accepts an exact schema-6 reevaluation entry', () => {
    const publishedBaseline = evaluated(-1, Array(FEATURE_COUNT).fill(0.1), 3_000_000, 0);
    const candidate = evaluated(30, Array(FEATURE_COUNT).fill(0.3), 3_006_000);
    const event = buildReevaluationLogEntry({
      gen: 30,
      ts: 123,
      searchContract: 'bag-expectimax-hold-v2', searchDepth: 4,
      rootBeamWidth: 64, childBeamWidth: 32, maxWorkUnits: 3_584,
      budgetCorpus: 'budget-corpus-v1', transpositionCacheEntries: 65_536,
      placementCacheEntries: 16_384,
      schedule: {
        games: 30, maxPieces: 5000, searchContract: 'bag-expectimax-hold-v2',
        searchDepth: 4, rootBeamWidth: 64, childBeamWidth: 32, maxWorkUnits: 3_584,
        budgetCorpus: 'budget-corpus-v1', transpositionCacheEntries: 65_536,
        placementCacheEntries: 16_384, baseSeed: 1,
      },
      publishedBaseline,
      currentQualified: null,
      candidate,
      qualification: evaluateTetrisCandidate(candidate, publishedBaseline, null),
    });
    expect(parseReevaluationLogEntry(event)).toEqual(event);
  });

  const metadataMutations = [
    ['maxWorkUnits', 3_583],
    ['budgetCorpus', 'budget-corpus-v0'],
    ['transpositionCacheEntries', 65_535],
    ['placementCacheEntries', 16_383],
  ] as const;

  const validEvent = () => {
    const publishedBaseline = evaluated(-1, Array(FEATURE_COUNT).fill(0.1), 3_000_000, 0);
    const candidate = evaluated(30, Array(FEATURE_COUNT).fill(0.3), 3_006_000);
    return buildReevaluationLogEntry({
      gen: 30, ts: 123, searchContract: 'bag-expectimax-hold-v2', searchDepth: 4,
      rootBeamWidth: 64, childBeamWidth: 32, maxWorkUnits: 3_584,
      budgetCorpus: 'budget-corpus-v1', transpositionCacheEntries: 65_536,
      placementCacheEntries: 16_384,
      schedule: {
        games: 30, maxPieces: 5000, searchContract: 'bag-expectimax-hold-v2',
        searchDepth: 4, rootBeamWidth: 64, childBeamWidth: 32, maxWorkUnits: 3_584,
        budgetCorpus: 'budget-corpus-v1', transpositionCacheEntries: 65_536,
        placementCacheEntries: 16_384, baseSeed: 1,
      },
      publishedBaseline, currentQualified: null, candidate,
      qualification: evaluateTetrisCandidate(candidate, publishedBaseline, null),
    });
  };

  it.each(metadataMutations)('rejects reevaluation metadata missing %s', (field) => {
    const event = validEvent() as unknown as Record<string, unknown>;
    Reflect.deleteProperty(event, field);
    expect(parseReevaluationLogEntry(event)).toBeNull();
  });

  it.each(metadataMutations)('rejects wrong reevaluation metadata %s', (field, wrong) => {
    expect(parseReevaluationLogEntry({ ...validEvent(), [field]: wrong })).toBeNull();
  });

  it.each(metadataMutations)('rejects an extra reevaluation key adjacent to %s', (field) => {
    expect(parseReevaluationLogEntry({ ...validEvent(), [`${field}Extra`]: 1 })).toBeNull();
  });

  it.each(metadataMutations)('rejects reevaluation schedule metadata missing %s', (field) => {
    const event = validEvent();
    Reflect.deleteProperty(event.schedule, field);
    expect(parseReevaluationLogEntry(event)).toBeNull();
  });

  it.each(metadataMutations)('rejects wrong reevaluation schedule metadata %s', (field, wrong) => {
    const event = validEvent();
    (event.schedule as unknown as Record<string, unknown>)[field] = wrong;
    expect(parseReevaluationLogEntry(event)).toBeNull();
  });

  it.each(metadataMutations)('rejects an extra reevaluation schedule key adjacent to %s', (field) => {
    const event = validEvent();
    (event.schedule as unknown as Record<string, unknown>)[`${field}Extra`] = 1;
    expect(parseReevaluationLogEntry(event)).toBeNull();
  });

  it('rejects absent and internally inconsistent reevaluation diagnostics', () => {
    const missing = validEvent();
    delete (missing.candidate as Partial<LoggedReevaluation>).searchDiagnostics;
    expect(parseReevaluationLogEntry(missing)).toBeNull();

    const inconsistent = validEvent();
    inconsistent.candidate.searchDiagnostics!.cacheHitUnits = 1_999;
    expect(parseReevaluationLogEntry(inconsistent)).toBeNull();

    const overBudget = validEvent();
    overBudget.candidate.searchDiagnostics!.maxWorkUnitsUsed = 3_585;
    expect(parseReevaluationLogEntry(overBudget)).toBeNull();
  });
});
