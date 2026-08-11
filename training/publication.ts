import { hashSeed } from '../src/ai/rng';
import type { LineClearCounts } from '../src/ai/lineClears';
import type { StrategyDiagnostics, SurvivalDiagnostics } from '../src/ai/tetrisStrategy';
import {
  SCORE_TIE_RELATIVE_TOLERANCE,
  TETRIS_LINE_SHARE_THRESHOLD,
} from './objective';

const REEVALUATION_STREAM = 0x5eed;

export interface ReevaluationSummary {
  meanScore: number;
  scoreRate: number;
  meanLines: number;
  meanHeight: number;
  meanClearCounts: LineClearCounts;
  tetrisLineShare: number;
  strategyDiagnostics: StrategyDiagnostics;
  survivalDiagnostics: SurvivalDiagnostics;
}

export type CandidateQualificationReason =
  | 'qualified'
  | 'score-not-higher'
  | 'tetris-share-too-low'
  | 'survival-lower'
  | 'not-better-qualified-candidate';

export interface CandidateQualification {
  shouldSave: boolean;
  reason: CandidateQualificationReason;
  scoreTolerance: number;
  scoreQualified: boolean;
  tetrisQualified: boolean;
  survivalQualified: boolean;
  betterThanCurrent: boolean;
}

export type ReevaluationDecisionReason =
  | 'higher-score'
  | 'lower-score'
  | 'lower-height-within-score-tolerance'
  | 'height-not-lower-within-score-tolerance';

export interface ReevaluationDecision {
  shouldPublish: boolean;
  scoreTolerance: number;
  reason: ReevaluationDecisionReason;
}

export function fixedReevaluationSeeds(baseSeed: number, games: number): number[] {
  return Array.from({ length: games }, (_, game) =>
    hashSeed(baseSeed ^ REEVALUATION_STREAM, game));
}

export function evaluateTetrisCandidate(
  candidate: ReevaluationSummary,
  publishedBaseline: ReevaluationSummary,
  currentQualified: ReevaluationSummary | null,
): CandidateQualification {
  const scale = Math.max(Math.abs(candidate.meanScore), Math.abs(publishedBaseline.meanScore));
  const scoreTolerance = SCORE_TIE_RELATIVE_TOLERANCE * scale;
  const scoreQualified = candidate.meanScore > publishedBaseline.meanScore + scoreTolerance;
  const tetrisQualified = candidate.tetrisLineShare >= TETRIS_LINE_SHARE_THRESHOLD;
  const survivalQualified = candidate.survivalDiagnostics.pieceCapGames >=
    publishedBaseline.survivalDiagnostics.pieceCapGames;
  const betterThanCurrent = currentQualified === null ||
    candidate.meanScore > currentQualified.meanScore;

  const reason: CandidateQualificationReason =
    !scoreQualified ? 'score-not-higher'
    : !tetrisQualified ? 'tetris-share-too-low'
    : !survivalQualified ? 'survival-lower'
    : !betterThanCurrent ? 'not-better-qualified-candidate'
    : 'qualified';

  return {
    shouldSave: reason === 'qualified',
    reason,
    scoreTolerance,
    scoreQualified,
    tetrisQualified,
    survivalQualified,
    betterThanCurrent,
  };
}

export function evaluateScoreReevaluation(
  candidate: ReevaluationSummary,
  currentBest: ReevaluationSummary,
): ReevaluationDecision {
  const scale = Math.max(Math.abs(candidate.meanScore), Math.abs(currentBest.meanScore));
  const scoreTolerance = SCORE_TIE_RELATIVE_TOLERANCE * scale;

  if (candidate.meanScore > currentBest.meanScore + scoreTolerance) {
    return { shouldPublish: true, scoreTolerance, reason: 'higher-score' };
  }
  if (candidate.meanScore < currentBest.meanScore - scoreTolerance) {
    return { shouldPublish: false, scoreTolerance, reason: 'lower-score' };
  }
  if (candidate.meanHeight < currentBest.meanHeight) {
    return {
      shouldPublish: true,
      scoreTolerance,
      reason: 'lower-height-within-score-tolerance',
    };
  }
  return {
    shouldPublish: false,
    scoreTolerance,
    reason: 'height-not-lower-within-score-tolerance',
  };
}

export function shouldPublishScoreReevaluation(
  candidate: ReevaluationSummary,
  currentBest: ReevaluationSummary,
): boolean {
  return evaluateScoreReevaluation(candidate, currentBest).shouldPublish;
}
