import { hashSeed } from '../src/ai/rng';
import { SCORE_TIE_RELATIVE_TOLERANCE } from './objective';

const REEVALUATION_STREAM = 0x5eed;

export interface ReevaluationSummary {
  meanScore: number;
  scoreRate: number;
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
