import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { SEARCH_METADATA } from './objective';
import { buildBenchPlan, parseBenchArgs } from './bench';
import { formatLineClearCounts, formatSearchDiagnostics, summarizeBench, type BenchResult } from './benchSummary';

describe('bench CLI contract', () => {
  it('parses the supported benchmark schedule without a search flag', () => {
    expect(parseBenchArgs(['--games', '30', '--max-pieces', '2000'])).toMatchObject({
      games: 30,
      maxPieces: 2000,
    });
  });
  it('rejects the removed user-selectable depth flag', () => {
    expect(() => parseBenchArgs(['--depth', '2'])).toThrow(/unknown flag.*--depth/i);
  });

  it('publishes the shared search metadata while simulation stays implicit', () => {
    const weights = [1, 2, 3];
    const plan = buildBenchPlan(weights, {
      weights: null,
      games: 2,
      maxPieces: 5000,
      seed: 11,
    });

    expect(plan).toMatchObject({ weights, maxPieces: 5000 });
    expect(plan.seeds).toHaveLength(2);
    expect(new Set(plan.seeds)).toHaveLength(2);
    expect(plan.searchMetadata).toBe(SEARCH_METADATA);
    expect(plan).not.toHaveProperty('search');
  });

  it('does not execute the CLI when imported', () => {
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', "await import('./training/bench.ts')"],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(output).toBe('');
  });
});

describe('summarizeBench', () => {
  const search = (overrides: Partial<import('../src/ai/simulate').SimulationSearchDiagnostics> = {}) => ({
    searchCalls: 10,
    holdActions: 0,
    holdRate: 0,
    meanCompletedDepth: 1,
    minCompletedDepth: 1,
    completedDepthHistogram: [0, 10, 0, 0, 0] as [number, number, number, number, number],
    totalWorkUnitsUsed: 100,
    meanWorkUnitsUsed: 10,
    maxWorkUnitsUsed: 10,
    budgetExhaustedSearches: 0,
    budgetExhaustionRate: 0,
    placementEvaluationUnits: 50,
    chanceExpansionUnits: 25,
    cacheHitUnits: 25,
    expandedDecisionNodes: 0,
    expandedChanceNodes: 0,
    cacheHits: 0,
    ...overrides,
  });
  const games: BenchResult[] = [
    {
      score: 900, lines: 20, pieces: 300, meanHeight: 4, reason: 'pieceCap',
      clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 5 },
      strategyDiagnostics: {
        meanCleanWellDepth: 4,
        meanTetrisSetupProgress: 3,
        meanTetrisReadyRows: 2,
      },
      searchDiagnostics: search({
        holdActions: 30, holdRate: 0.1, meanCompletedDepth: 4, minCompletedDepth: 4,
        completedDepthHistogram: [0, 0, 0, 0, 10],
        expandedDecisionNodes: 100, expandedChanceNodes: 40, cacheHits: 10,
      }),
    },
    {
      score: 600, lines: 10, pieces: 20, meanHeight: 8, reason: 'gameover',
      clearCounts: { singles: 0, doubles: 1, triples: 0, tetrises: 2 },
      strategyDiagnostics: {
        meanCleanWellDepth: 2,
        meanTetrisSetupProgress: 1,
        meanTetrisReadyRows: 0,
      },
      searchDiagnostics: search({
        holdActions: 4, holdRate: 0.2, meanCompletedDepth: 3, minCompletedDepth: 2,
        completedDepthHistogram: [0, 0, 2, 0, 8],
        totalWorkUnitsUsed: 80, meanWorkUnitsUsed: 4, maxWorkUnitsUsed: 8,
        budgetExhaustedSearches: 1, budgetExhaustionRate: 0.1,
        placementEvaluationUnits: 40, chanceExpansionUnits: 20, cacheHitUnits: 20,
        expandedDecisionNodes: 60, expandedChanceNodes: 20, cacheHits: 8,
      }),
    },
  ];

  it('summarizes score, lines, height, and survival', () => {
    const summary = summarizeBench(games, 300);
    expect(summary.score).toEqual({ mean: 750, median: 750, min: 600, max: 900 });
    expect(summary.lines.mean).toBe(15);
    expect(summary.height.mean).toBe(6);
    expect(summary.cappedGames).toBe(1);
    expect(summary.gameoverGames).toBe(1);
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
    expect(summary.strategy.cleanWellDepth).toEqual({ mean: 3, median: 3, min: 2, max: 4 });
    expect(summary.strategy.tetrisSetupProgress.mean).toBe(2);
    expect(summary.strategy.tetrisReadyRows.mean).toBe(1);
  });

  it('summarizes Hold and budget diagnostics', () => {
    const summary = summarizeBench(games, 300);
    expect(summary.search).toEqual({
      searchCalls: 20,
      holdActions: 34,
      holdRate: 34 / 320,
      completedDepth: { mean: 3.5, median: 3.5, min: 3, max: 4 },
      minCompletedDepth: 2,
      completedDepthHistogram: [0, 0, 2, 0, 18],
      totalWorkUnitsUsed: 180,
      meanWorkUnitsUsed: 9,
      maxWorkUnitsUsed: 10,
      budgetExhaustedSearches: 1,
      budgetExhaustionRate: 1 / 20,
      placementEvaluationUnits: 90,
      chanceExpansionUnits: 45,
      cacheHitUnits: 45,
      expandedDecisionNodes: 160,
      expandedChanceNodes: 60,
      cacheHits: 18,
    });
  });

  it('rejects a game whose total work units do not equal its category units', () => {
    const inconsistent = {
      ...games[0],
      searchDiagnostics: search({
        totalWorkUnitsUsed: 101,
        placementEvaluationUnits: 50,
        chanceExpansionUnits: 25,
        cacheHitUnits: 25,
      }),
    };
    expect(() => summarizeBench([inconsistent], 300)).toThrow(/work units.*category/i);
  });

  it('keeps aggregate total work equal to summed category units', () => {
    const summary = summarizeBench(games, 300);
    expect(summary.search.totalWorkUnitsUsed).toBe(
      summary.search.placementEvaluationUnits
        + summary.search.chanceExpansionUnits
        + summary.search.cacheHitUnits,
    );
  });

  it('formats all aggregated search diagnostics for CLI output', () => {
    const summary = summarizeBench(games, 300);
    expect(formatSearchDiagnostics(summary.search)).toContain('hold actions 34');
    expect(formatSearchDiagnostics(summary.search)).toContain('hold rate 10.63%');
    expect(formatSearchDiagnostics(summary.search)).toContain('completed depth mean/median/min/max 3.50/3.50/3/4');
    expect(formatSearchDiagnostics(summary.search)).toContain('search min completed depth 2');
    expect(formatSearchDiagnostics(summary.search)).toContain('decision nodes 160');
    expect(formatSearchDiagnostics(summary.search)).toContain('chance nodes 60');
    expect(formatSearchDiagnostics(summary.search)).toContain('cache hits 18');
    expect(formatSearchDiagnostics(summary.search)).toContain('budget exhaustion 1 (5.00%)');
  });

  it('reports no tetris line share when no lines were cleared', () => {
    const summary = summarizeBench([{
      score: 0, lines: 0, pieces: 10, meanHeight: 20, reason: 'gameover',
      clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 0 },
      strategyDiagnostics: {
        meanCleanWellDepth: 0,
        meanTetrisSetupProgress: 0,
        meanTetrisReadyRows: 0,
      },
      searchDiagnostics: search({
        meanCompletedDepth: 4, minCompletedDepth: 4,
        completedDepthHistogram: [0, 0, 0, 0, 10],
        expandedDecisionNodes: 1, expandedChanceNodes: 1, cacheHits: 0,
      }),
    }], 300);
    expect(summary.tetrisLineShare).toBe(0);
  });

  it('rejects a result whose lines disagree with its histogram', () => {
    const inconsistent = { ...games[0], lines: 19 };
    expect(() => summarizeBench([inconsistent], 300)).toThrow(/clearCounts.*lines/);
  });

  it.each([
    ['fractional', 0.5, 0.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1],
    ['negative', -1, -1],
    ['NaN', Number.NaN, 0],
    ['infinite', Number.POSITIVE_INFINITY, 0],
  ])('rejects %s raw per-game clear counts', (_label, singles, lines) => {
    expect(() => summarizeBench([{
      score: 0,
      lines,
      pieces: 0,
      meanHeight: 0,
      reason: 'gameover',
      clearCounts: { singles, doubles: 0, triples: 0, tetrises: 0 },
      strategyDiagnostics: {
        meanCleanWellDepth: 0,
        meanTetrisSetupProgress: 0,
        meanTetrisReadyRows: 0,
      },
      searchDiagnostics: search({
        meanCompletedDepth: 0, minCompletedDepth: 0,
        completedDepthHistogram: [10, 0, 0, 0, 0],
        expandedDecisionNodes: 0, expandedChanceNodes: 0, cacheHits: 0,
      }),
    }], 300)).toThrow(/clearCounts|integer|finite|non-negative/);
  });

  it('rejects an empty result set and a non-positive schedule', () => {
    expect(() => summarizeBench([], 300)).toThrow(/result/);
    expect(() => summarizeBench(games, 0)).toThrow(/maxPieces/);
  });
});
