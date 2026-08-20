import { describe, expect, it } from 'vitest';
import {
  BUDGET_CORPUS_V1,
  materializeBudgetState,
} from './searchBudgetCorpus';

describe('budget-corpus-v1', () => {
  it('contains 96 explicit public snapshots in four equal strata', () => {
    expect(BUDGET_CORPUS_V1).toHaveLength(96);
    for (const stratum of ['low', 'medium', 'high', 'danger'] as const) {
      expect(BUDGET_CORPUS_V1.filter((state) => state.stratum === stratum)).toHaveLength(24);
    }
    expect(BUDGET_CORPUS_V1.map((state) => state.id)).toEqual([
      ...Array.from({ length: 24 }, (_, i) => `low-${String(i).padStart(2, '0')}`),
      ...Array.from({ length: 24 }, (_, i) => `medium-${String(i).padStart(2, '0')}`),
      ...Array.from({ length: 24 }, (_, i) => `high-${String(i).padStart(2, '0')}`),
      ...Array.from({ length: 24 }, (_, i) => `danger-${String(i).padStart(2, '0')}`),
    ]);
  });

  it('contains only public state fields and valid 22-row masks', () => {
    for (const state of BUDGET_CORPUS_V1) {
      expect(Object.keys(state).sort()).toEqual([
        'current', 'hold', 'holdAvailable', 'id', 'next', 'rows', 'stratum', 'unseenBagMask',
      ]);
      expect(state.rows).toHaveLength(22);
      expect(state.rows.every((row) => Number.isInteger(row) && row >= 0 && row < 1024)).toBe(true);
      expect(state).not.toHaveProperty('bag');
      expect(state).not.toHaveProperty('seed');
      expect(state).not.toHaveProperty('rng');
    }
  });

  it('keeps each stratum within its documented maximum occupied height band', () => {
    const expected: Record<string, readonly [number, number]> = {
      low: [0, 4],
      medium: [5, 9],
      high: [10, 15],
      danger: [16, 20],
    };
    for (const state of BUDGET_CORPUS_V1) {
      const occupiedRows = state.rows
        .map((mask, row) => mask === 0 ? null : row)
        .filter((row): row is number => row !== null);
      const height = occupiedRows.length === 0 ? 0 : 22 - Math.min(...occupiedRows);
      const [minimum, maximum] = expected[state.stratum];
      expect(height).toBeGreaterThanOrEqual(minimum);
      expect(height).toBeLessThanOrEqual(maximum);
    }
  });

  it('covers every piece and all public Hold/bag boundaries', () => {
    expect(new Set(BUDGET_CORPUS_V1.map((state) => state.current.type)).size).toBe(7);
    expect(new Set(BUDGET_CORPUS_V1.map((state) => state.next)).size).toBe(7);
    expect(BUDGET_CORPUS_V1.some((state) => state.hold === null)).toBe(true);
    expect(BUDGET_CORPUS_V1.some((state) => state.hold !== null)).toBe(true);
    expect(BUDGET_CORPUS_V1.some((state) => state.holdAvailable)).toBe(true);
    expect(BUDGET_CORPUS_V1.some((state) => !state.holdAvailable)).toBe(true);
    expect(BUDGET_CORPUS_V1.some((state) => state.unseenBagMask === 0)).toBe(true);
  });

  it('materializes masks into validated nonzero board cells without sharing rows', () => {
    const materialized = materializeBudgetState(BUDGET_CORPUS_V1[0]);
    expect(materialized.board).toHaveLength(22);
    expect(materialized.board.every((row) => row.length === 10)).toBe(true);
    expect(materialized.board.flat().some((cell) => cell !== 0)).toBe(true);
    expect(materialized.current).toEqual(BUDGET_CORPUS_V1[0].current);
    expect(materialized.next).toBe(BUDGET_CORPUS_V1[0].next);
    expect(materialized.hold).toBe(BUDGET_CORPUS_V1[0].hold);
    expect(materialized.holdAvailable).toBe(BUDGET_CORPUS_V1[0].holdAvailable);
    expect(materialized.unseenBagMask).toBe(BUDGET_CORPUS_V1[0].unseenBagMask);
    expect(materialized.board[0]).not.toBe(materialized.board[1]);
  });
});
