import type { ReevaluationSummary } from './publication';

interface FreshBaselineReevaluationPlan {
  weights: number[][];
  baselineIndex: 0;
  baselineGen: -1;
  candidateIndex: 1;
}

interface ExistingBaselineReevaluationPlan {
  weights: number[][];
  baselineIndex: null;
  baselineGen: null;
  candidateIndex: 0;
}

export type ReevaluationPlan =
  | FreshBaselineReevaluationPlan
  | ExistingBaselineReevaluationPlan;

export function planReevaluation(
  bestEver: ReevaluationSummary | null,
  publishedWeights: number[],
  candidateWeights: number[],
): ReevaluationPlan {
  if (bestEver === null) {
    return {
      weights: [publishedWeights, candidateWeights],
      baselineIndex: 0,
      baselineGen: -1,
      candidateIndex: 1,
    };
  }
  return {
    weights: [candidateWeights],
    baselineIndex: null,
    baselineGen: null,
    candidateIndex: 0,
  };
}
