import type { ReevaluationSummary } from './publication';

interface FreshBaselineReevaluationPlan {
  weights: number[][];
  baselineIndex: 0;
  candidateIndex: 1;
}

interface ExistingBaselineReevaluationPlan {
  weights: number[][];
  baselineIndex: null;
  candidateIndex: 0;
}

export type ReevaluationPlan =
  | FreshBaselineReevaluationPlan
  | ExistingBaselineReevaluationPlan;

export function planReevaluation(
  publishedBaseline: ReevaluationSummary | null,
  publishedWeights: number[],
  candidateWeights: number[],
): ReevaluationPlan {
  return publishedBaseline === null
    ? { weights: [publishedWeights, candidateWeights], baselineIndex: 0, candidateIndex: 1 }
    : { weights: [candidateWeights], baselineIndex: null, candidateIndex: 0 };
}
