import { hashSeed } from '../src/ai/rng';
import { SCORE_TIE_RELATIVE_TOLERANCE } from './objective';

const REEVALUATION_STREAM = 0x5eed;

export interface ReevaluationSummary {
  meanScore: number;
  scoreRate: number;
  meanLines: number;
  meanHeight: number;
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
