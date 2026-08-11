import {
  addLineClearCounts,
  assertLineClearCounts,
  emptyLineClearCounts,
  tetrisLineShare,
  type LineClearCounts,
} from '../src/ai/lineClears';
import { TETRIS_LINE_SHARE_THRESHOLD } from './objective';

const T_95_DF_29 = 2.045229642132703;

export interface PairedInterval {
  mean: number;
  lower: number;
  upper: number;
}

export interface PairedGameResult {
  score: number;
  reason: 'pieceCap' | 'gameover';
  clearCounts: LineClearCounts;
}

export interface PairedAcceptance {
  accepted: boolean;
  scoreQualified: boolean;
  tetrisQualified: boolean;
  survivalQualified: boolean;
  pairedTetrisQualified: boolean;
  scoreRateDelta: number;
  tetrisLineShareDelta: number;
  scoreRateInterval: PairedInterval;
  tetrisLineShareInterval: PairedInterval;
  baselineTetrisLineShare: number;
  candidateTetrisLineShare: number;
  baselinePieceCapGames: number;
  candidatePieceCapGames: number;
}

export function pairedInterval30(values: readonly number[]): PairedInterval {
  if (values.length !== 30 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('paired acceptance requires exactly 30 finite values');
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  const margin = T_95_DF_29 * Math.sqrt(variance / values.length);
  return { mean, lower: mean - margin, upper: mean + margin };
}

function validateGames(games: readonly PairedGameResult[]): void {
  if (games.length !== 30) {
    throw new Error('paired acceptance requires exactly 30 finite values');
  }
  for (const game of games) {
    if (!Number.isFinite(game.score)) {
      throw new Error('paired acceptance requires exactly 30 finite values');
    }
    if (game.reason !== 'pieceCap' && game.reason !== 'gameover') {
      throw new Error('paired acceptance game reason must be pieceCap or gameover');
    }
    assertLineClearCounts(game.clearCounts, true);
  }
}

function aggregateClearCounts(games: readonly PairedGameResult[]): LineClearCounts {
  return games.reduce(
    (total, game) => addLineClearCounts(total, game.clearCounts),
    emptyLineClearCounts(),
  );
}

export function evaluatePairedAcceptance(
  baselineGames: readonly PairedGameResult[],
  candidateGames: readonly PairedGameResult[],
  maxPieces: number,
): PairedAcceptance {
  if (!Number.isFinite(maxPieces) || maxPieces <= 0) {
    throw new Error('paired acceptance maxPieces must be positive and finite');
  }
  validateGames(baselineGames);
  validateGames(candidateGames);

  const scoreRateDeltas = candidateGames.map((candidate, index) =>
    candidate.score / maxPieces - baselineGames[index].score / maxPieces);
  const tetrisLineShareDeltas = candidateGames.map((candidate, index) =>
    tetrisLineShare(candidate.clearCounts) - tetrisLineShare(baselineGames[index].clearCounts));
  const scoreRateInterval = pairedInterval30(scoreRateDeltas);
  const tetrisLineShareInterval = pairedInterval30(tetrisLineShareDeltas);
  const baselineTetrisLineShare = tetrisLineShare(aggregateClearCounts(baselineGames));
  const candidateTetrisLineShare = tetrisLineShare(aggregateClearCounts(candidateGames));
  const baselinePieceCapGames = baselineGames.filter((game) => game.reason === 'pieceCap').length;
  const candidatePieceCapGames = candidateGames.filter((game) => game.reason === 'pieceCap').length;
  const scoreQualified = scoreRateInterval.lower > 0;
  const tetrisQualified = candidateTetrisLineShare >= TETRIS_LINE_SHARE_THRESHOLD;
  const survivalQualified = candidatePieceCapGames >= baselinePieceCapGames;
  const pairedTetrisQualified = tetrisLineShareInterval.lower > 0;

  return {
    accepted: scoreQualified && tetrisQualified && survivalQualified && pairedTetrisQualified,
    scoreQualified,
    tetrisQualified,
    survivalQualified,
    pairedTetrisQualified,
    scoreRateDelta: scoreRateInterval.mean,
    tetrisLineShareDelta: tetrisLineShareInterval.mean,
    scoreRateInterval,
    tetrisLineShareInterval,
    baselineTetrisLineShare,
    candidateTetrisLineShare,
    baselinePieceCapGames,
    candidatePieceCapGames,
  };
}
