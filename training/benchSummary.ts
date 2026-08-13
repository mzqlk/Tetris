import {
  addLineClearCounts,
  assertLineClearCounts,
  emptyLineClearCounts,
  tetrisLineShare,
  totalLinesFromCounts,
  type LineClearCounts,
} from '../src/ai/lineClears';
import type { StrategyDiagnostics } from '../src/ai/tetrisStrategy';
import type { SimulationSearchDiagnostics } from '../src/ai/simulate';

export interface BenchResult {
  score: number;
  lines: number;
  pieces: number;
  meanHeight: number;
  reason: 'gameover' | 'pieceCap';
  clearCounts: LineClearCounts;
  strategyDiagnostics: StrategyDiagnostics;
  searchDiagnostics: SimulationSearchDiagnostics;
}

export interface Distribution {
  mean: number;
  median: number;
  min: number;
  max: number;
}

export interface BenchSummary {
  score: Distribution;
  scorePerScheduledPiece: Distribution;
  lines: Distribution;
  height: Distribution;
  totalPieces: number;
  cappedGames: number;
  gameoverGames: number;
  clearCounts: LineClearCounts;
  tetrisLineShare: number;
  tetrisesPer100ScheduledPieces: number;
  strategy: {
    cleanWellDepth: Distribution;
    tetrisSetupProgress: Distribution;
    tetrisReadyRows: Distribution;
  };
  search: {
    holdActions: number;
    holdRate: number;
    completedDepth: Distribution;
    minCompletedDepth: number;
    expandedDecisionNodes: number;
    expandedChanceNodes: number;
    cacheHits: number;
    abortedSearches: number;
  };
}

function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  const lo = Math.floor(middle);
  const hi = Math.ceil(middle);
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: (sorted[lo] + sorted[hi]) / 2,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export function summarizeBench(
  results: readonly BenchResult[],
  maxPieces: number,
): BenchSummary {
  if (results.length === 0) throw new Error('at least one benchmark result is required');
  if (!Number.isFinite(maxPieces) || maxPieces <= 0) {
    throw new Error(`maxPieces must be positive, got ${maxPieces}`);
  }
  for (const result of results) {
    assertLineClearCounts(result.clearCounts, true);
    if (totalLinesFromCounts(result.clearCounts) !== result.lines) {
      throw new Error('clearCounts must reconstruct lines for every benchmark result');
    }
  }
  const clearCounts = results.reduce(
    (sum, result) => addLineClearCounts(sum, result.clearCounts),
    emptyLineClearCounts(),
  );
  const totalPieces = results.reduce((sum, result) => sum + result.pieces, 0);
  const holdActions = results.reduce(
    (sum, result) => sum + result.searchDiagnostics.holdActions, 0,
  );
  return {
    score: distribution(results.map((result) => result.score)),
    scorePerScheduledPiece: distribution(
      results.map((result) => result.score / maxPieces),
    ),
    lines: distribution(results.map((result) => result.lines)),
    height: distribution(results.map((result) => result.meanHeight)),
    totalPieces,
    cappedGames: results.filter((result) => result.reason === 'pieceCap').length,
    gameoverGames: results.filter((result) => result.reason === 'gameover').length,
    clearCounts,
    tetrisLineShare: tetrisLineShare(clearCounts),
    tetrisesPer100ScheduledPieces:
      (100 * clearCounts.tetrises) / (results.length * maxPieces),
    strategy: {
      cleanWellDepth: distribution(
        results.map((result) => result.strategyDiagnostics.meanCleanWellDepth),
      ),
      tetrisSetupProgress: distribution(
        results.map((result) => result.strategyDiagnostics.meanTetrisSetupProgress),
      ),
      tetrisReadyRows: distribution(
        results.map((result) => result.strategyDiagnostics.meanTetrisReadyRows),
      ),
    },
    search: {
      holdActions,
      holdRate: totalPieces === 0 ? 0 : holdActions / totalPieces,
      completedDepth: distribution(
        results.map((result) => result.searchDiagnostics.meanCompletedDepth),
      ),
      minCompletedDepth: Math.min(
        ...results.map((result) => result.searchDiagnostics.minCompletedDepth),
      ),
      expandedDecisionNodes: results.reduce(
        (sum, result) => sum + result.searchDiagnostics.expandedDecisionNodes, 0,
      ),
      expandedChanceNodes: results.reduce(
        (sum, result) => sum + result.searchDiagnostics.expandedChanceNodes, 0,
      ),
      cacheHits: results.reduce(
        (sum, result) => sum + result.searchDiagnostics.cacheHits, 0,
      ),
      abortedSearches: results.reduce(
        (sum, result) => sum + result.searchDiagnostics.abortedSearches, 0,
      ),
    },
  };
}

export const formatLineClearCounts = (counts: LineClearCounts): string =>
  `1/2/3/4 clears ${counts.singles}/${counts.doubles}/${counts.triples}/${counts.tetrises}`;

export function formatSearchDiagnostics(search: BenchSummary['search']): string {
  return [
    `hold actions ${search.holdActions}`,
    `hold rate ${(100 * search.holdRate).toFixed(2)}%`,
    `completed depth mean/median/min/max ${search.completedDepth.mean.toFixed(2)}/`
      + `${search.completedDepth.median.toFixed(2)}/${search.completedDepth.min}/${search.completedDepth.max}`,
    `search min completed depth ${search.minCompletedDepth}`,
    `decision nodes ${search.expandedDecisionNodes}`,
    `chance nodes ${search.expandedChanceNodes}`,
    `cache hits ${search.cacheHits}`,
    `aborts ${search.abortedSearches}`,
  ].join('\n');
}
