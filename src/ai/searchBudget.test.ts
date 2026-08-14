import { describe, expect, it } from 'vitest';
import {
  DEPTH_ONE_REQUIRED_WORK_UNITS,
  legalPlacementPoseUpperBound,
  WorkBudgetLedger,
} from './searchBudget';

describe('deterministic search budget', () => {
  it('derives the finite legal-pose upper bound from all four rotations', () => {
    expect(legalPlacementPoseUpperBound()).toBe(756);
    expect(DEPTH_ONE_REQUIRED_WORK_UNITS).toBe(1512);
  });

  it('charges exactly once before refusing work at the limit', () => {
    const ledger = new WorkBudgetLedger(3);
    expect(ledger.tryConsume('placementEvaluation')).toBe(true);
    expect(ledger.tryConsume('chanceExpansion')).toBe(true);
    expect(ledger.tryConsume('cacheHit')).toBe(true);
    expect(ledger.tryConsume('cacheHit')).toBe(false);
    expect(ledger.snapshot()).toEqual({
      limit: 3,
      used: 3,
      placementEvaluationUnits: 1,
      chanceExpansionUnits: 1,
      cacheHitUnits: 1,
      exhausted: true,
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid work-unit limit %s',
    (limit) => expect(() => new WorkBudgetLedger(limit)).toThrow(/positive safe integer/i),
  );
});
