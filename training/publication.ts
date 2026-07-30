import { hashSeed } from '../src/ai/rng';
import { SCORE_TIE_RELATIVE_TOLERANCE } from './objective';

const REEVALUATION_STREAM = 0x5eed;

export interface ReevaluationSummary {
  meanScore: number;
  scoreRate: number;
  meanLines: number;
  meanHeight: number;
}

interface LegacyReevaluationSummary {
  score: number;
  meanLines: number;
  meanHeight: number;
}

export function fixedReevaluationSeeds(baseSeed: number, games: number): number[] {
  return Array.from({ length: games }, (_, game) =>
    hashSeed(baseSeed ^ REEVALUATION_STREAM, game));
}

export function shouldPublishScoreReevaluation(
  candidate: ReevaluationSummary,
  currentBest: ReevaluationSummary,
): boolean {
  const scale = Math.max(Math.abs(candidate.meanScore), Math.abs(currentBest.meanScore));
  const tolerance = SCORE_TIE_RELATIVE_TOLERANCE * scale;

  if (candidate.meanScore > currentBest.meanScore + tolerance) return true;
  if (candidate.meanScore < currentBest.meanScore - tolerance) return false;
  return candidate.meanHeight < currentBest.meanHeight;
}

/**
 * Select a model for publication from like-for-like long-game re-evaluations.
 *
 * Lines retain their combined-score ordering while either contender can still
 * die before the cap. Once both are within 1% of the mathematical line ceiling,
 * their tiny line differences mostly reflect capped packing noise; mean stack
 * height is then the remaining non-saturated quality signal.
 */
export function shouldPublishReevaluation(
  candidate: LegacyReevaluationSummary,
  currentBest: LegacyReevaluationSummary,
  lineCeiling: number,
): boolean {
  const saturationThreshold = 0.99 * lineCeiling;
  const bothSaturated = candidate.meanLines >= saturationThreshold &&
    currentBest.meanLines >= saturationThreshold;

  if (bothSaturated) return candidate.meanHeight < currentBest.meanHeight;
  return candidate.score > currentBest.score;
}
