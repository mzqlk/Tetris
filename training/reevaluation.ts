import type { ReevaluationSummary } from './publication';

export interface ReevaluationPlan {
  weights: number[][];
  baselineIndex: number | null;
  candidateIndex: number;
}

export function planReevaluation(
  bestEver: ReevaluationSummary | null,
  publishedWeights: number[],
  candidateWeights: number[],
): ReevaluationPlan {
  if (bestEver === null) {
    return {
      weights: [publishedWeights, candidateWeights],
      baselineIndex: 0,
      candidateIndex: 1,
    };
  }
  return {
    weights: [candidateWeights],
    baselineIndex: null,
    candidateIndex: 0,
  };
}
