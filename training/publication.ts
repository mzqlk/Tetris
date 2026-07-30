export interface ReevaluationSummary {
  score: number;
  meanLines: number;
  meanHeight: number;
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
  candidate: ReevaluationSummary,
  currentBest: ReevaluationSummary,
  lineCeiling: number,
): boolean {
  const saturationThreshold = 0.99 * lineCeiling;
  const bothSaturated = candidate.meanLines >= saturationThreshold &&
    currentBest.meanLines >= saturationThreshold;

  if (bothSaturated) return candidate.meanHeight < currentBest.meanHeight;
  return candidate.score > currentBest.score;
}
