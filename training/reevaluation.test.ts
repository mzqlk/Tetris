import { describe, expect, it } from 'vitest';
import { planReevaluation } from './reevaluation';
import type { ReevaluationSummary } from './publication';

const best: ReevaluationSummary = {
  meanScore: 1000,
  scoreRate: 0.2,
  meanLines: 1998,
  meanHeight: 3,
};

describe('planReevaluation', () => {
  const published = [1, 0];
  const candidate = [0, 1];

  it('evaluates published weights first when no score baseline exists', () => {
    expect(planReevaluation(null, published, candidate)).toEqual({
      weights: [published, candidate],
      baselineIndex: 0,
      candidateIndex: 1,
    });
  });

  it('evaluates only the candidate after a compatible bestEver is restored', () => {
    expect(planReevaluation(best, published, candidate)).toEqual({
      weights: [candidate],
      baselineIndex: null,
      candidateIndex: 0,
    });
  });
});
