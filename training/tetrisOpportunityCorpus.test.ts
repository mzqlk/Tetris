import { describe, expect, it } from 'vitest';
import {
  TETRIS_OPPORTUNITY_CORPUS_ID,
  TETRIS_OPPORTUNITY_CORPUS_V1,
  materializeOpportunityState,
} from './tetrisOpportunityCorpus';

describe('tetris-opportunity-corpus-v1', () => {
  it('freezes 32 public snapshots in the reviewed id and stratum order', () => {
    expect(TETRIS_OPPORTUNITY_CORPUS_ID).toBe('tetris-opportunity-corpus-v1');
    expect(TETRIS_OPPORTUNITY_CORPUS_V1.map((entry) => entry.id)).toEqual([
      'build-00', 'build-01', 'build-02', 'build-03',
      'build-04', 'build-05', 'build-06', 'build-07',
      'ready-00', 'ready-01', 'ready-02', 'ready-03',
      'ready-04', 'ready-05', 'ready-06', 'ready-07',
      'bag-hold-00', 'bag-hold-01', 'bag-hold-02', 'bag-hold-03',
      'bag-hold-04', 'bag-hold-05', 'bag-hold-06', 'bag-hold-07',
      'safety-00', 'safety-01', 'safety-02', 'safety-03',
      'safety-04', 'safety-05', 'safety-06', 'safety-07',
    ]);
    expect(TETRIS_OPPORTUNITY_CORPUS_V1.map((entry) => entry.stratum)).toEqual([
      'build', 'build', 'build', 'build', 'build', 'build', 'build', 'build',
      'ready', 'ready', 'ready', 'ready', 'ready', 'ready', 'ready', 'ready',
      'bag-hold', 'bag-hold', 'bag-hold', 'bag-hold',
      'bag-hold', 'bag-hold', 'bag-hold', 'bag-hold',
      'safety', 'safety', 'safety', 'safety', 'safety', 'safety', 'safety', 'safety',
    ]);
    expect(Object.isFrozen(TETRIS_OPPORTUNITY_CORPUS_V1)).toBe(true);
  });

  it('contains only complete public fields, valid row masks, and deeply frozen literals', () => {
    for (const entry of TETRIS_OPPORTUNITY_CORPUS_V1) {
      expect(Object.keys(entry).sort()).toEqual([
        'current', 'expectedActionClass', 'hold', 'holdAvailable', 'id', 'next',
        'rows', 'stratum', 'targetWellColumn', 'unseenBagMask',
      ]);
      expect(entry.rows).toHaveLength(22);
      expect(entry.rows.every((row) => Number.isInteger(row) && row >= 0 && row < 1024)).toBe(true);
      expect(entry.targetWellColumn).toBeGreaterThanOrEqual(0);
      expect(entry.targetWellColumn).toBeLessThanOrEqual(9);
      expect(entry).not.toHaveProperty('bag');
      expect(entry).not.toHaveProperty('seed');
      expect(entry).not.toHaveProperty('rng');
      expect(entry).not.toHaveProperty('index');
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.rows)).toBe(true);
      expect(Object.isFrozen(entry.current)).toBe(true);
      expect(Object.isFrozen(entry.current.position)).toBe(true);
      expect(() => materializeOpportunityState(entry)).not.toThrow();
    }
  });

  it('uses strategy labels for the first 24 states and safety-only for the final eight', () => {
    const strategyLabels = TETRIS_OPPORTUNITY_CORPUS_V1
      .slice(0, 24)
      .map((entry) => entry.expectedActionClass);
    expect(strategyLabels.every((label) => label === 'preserve-well' || label === 'complete-tetris')).toBe(true);
    expect(TETRIS_OPPORTUNITY_CORPUS_V1.slice(24).map((entry) => entry.expectedActionClass)).toEqual([
      'safety-only', 'safety-only', 'safety-only', 'safety-only',
      'safety-only', 'safety-only', 'safety-only', 'safety-only',
    ]);
  });

  it('covers each documented I-piece Hold and public-bag boundary at least twice', () => {
    const bagHoldEntries = TETRIS_OPPORTUNITY_CORPUS_V1.filter((entry) => entry.stratum === 'bag-hold');
    expect(bagHoldEntries.filter((entry) => entry.hold === 1).length).toBeGreaterThanOrEqual(2);
    expect(bagHoldEntries.filter((entry) => entry.hold === null).length).toBeGreaterThanOrEqual(2);
    expect(bagHoldEntries.filter((entry) => (entry.unseenBagMask & 0b0000001) !== 0).length).toBeGreaterThanOrEqual(2);
    expect(bagHoldEntries.filter((entry) => entry.unseenBagMask === 0).length).toBeGreaterThanOrEqual(2);
  });

  it('materializes hand-checked masks without sharing board or piece-position references', () => {
    const literal = TETRIS_OPPORTUNITY_CORPUS_V1[0];
    const first = materializeOpportunityState(literal);
    const second = materializeOpportunityState(literal);

    expect(first.board[18]).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
    expect(first.board[21]).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
    expect(first.current).toEqual({ type: 3, rotation: 0, position: { x: 3, y: 0 } });
    expect(first.board).not.toBe(second.board);
    expect(first.board[0]).not.toBe(second.board[0]);
    expect(first.current).not.toBe(second.current);
    expect(first.current.position).not.toBe(second.current.position);

    first.board[18][0] = 7;
    first.current.position.x = 9;
    expect(second.board[18][0]).toBe(1);
    expect(second.current.position.x).toBe(3);
    expect(literal.rows[18]).toBe(511);
    expect(literal.current.position.x).toBe(3);
  });
});
