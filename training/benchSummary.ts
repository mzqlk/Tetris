import {
  addLineClearCounts,
  assertLineClearCounts,
  emptyLineClearCounts,
  tetrisLineShare,
  totalLinesFromCounts,
  type LineClearCounts,
} from '../src/ai/lineClears';
import type { StrategyDiagnostics } from '../src/ai/tetrisStrategy';

interface BenchResult {
  score: number;
  lines: number;
  pieces: number;
  meanHeight: number;
  reason: 'gameover' | 'pieceCap';
  clearCounts: LineClearCounts;
  strategyDiagnostics: StrategyDiagnostics;
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
  return {
    score: distribution(results.map((result) => result.score)),
    scorePerScheduledPiece: distribution(
      results.map((result) => result.score / maxPieces),
    ),
    lines: distribution(results.map((result) => result.lines)),
    height: distribution(results.map((result) => result.meanHeight)),
    totalPieces: results.reduce((sum, result) => sum + result.pieces, 0),
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
  };
}

export const formatLineClearCounts = (counts: LineClearCounts): string =>
  `1/2/3/4 clears ${counts.singles}/${counts.doubles}/${counts.triples}/${counts.tetrises}`;
