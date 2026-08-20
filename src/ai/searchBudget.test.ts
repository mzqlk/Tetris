import { describe, expect, it } from 'vitest';
import {
  DEPTH_ONE_REQUIRED_WORK_UNITS,
  DETERMINISTIC_SEARCH_LIMITS,
  legalPlacementPoseUpperBound,
  WorkBudgetLedger,
} from './searchBudget';

describe('deterministic search budget', () => {
  it('derives the finite legal-pose upper bound from all four rotations', () => {
    expect(legalPlacementPoseUpperBound()).toBe(756);
    expect(DEPTH_ONE_REQUIRED_WORK_UNITS).toBe(1512);
  });

  it('freezes the verified staircase budget integer', () => {
    expect(DETERMINISTIC_SEARCH_LIMITS.maxWorkUnits).toBe(3584);
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

  it('returns fresh frozen snapshots that preserve prior ledger state', () => {
    const ledger = new WorkBudgetLedger(2);
    const initial = ledger.snapshot();
    const repeated = ledger.snapshot();

    expect(repeated).not.toBe(initial);
    expect(Object.isFrozen(initial)).toBe(true);

    expect(ledger.tryConsume('cacheHit')).toBe(true);
    expect(initial).toEqual({
      limit: 2,
      used: 0,
      placementEvaluationUnits: 0,
      chanceExpansionUnits: 0,
      cacheHitUnits: 0,
      exhausted: false,
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid work-unit limit %s',
    (limit) => expect(() => new WorkBudgetLedger(limit)).toThrow(/positive safe integer/i),
  );
});
