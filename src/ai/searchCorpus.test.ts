import { describe, expect, it } from 'vitest';
import { createPiece } from '../engine/piece';
import { FEATURE_COUNT, FEATURE_NAMES } from './features';
import { cellKey } from './placements';
import type { PublicSearchState } from './publicState';
import { searchBudgeted } from './search';
import type { SearchLimits } from './searchBudget';
import { boardFrom } from './testUtils';

const corpusState = (): PublicSearchState => ({
  board: boardFrom([
    '##########',
    '###....###',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
    '.#########',
  ]),
  current: createPiece(1),
  next: 1,
  hold: null,
  holdAvailable: false,
  unseenBagMask: 0b0000001,
});

const corpusWeights = (): number[] => {
  const weights = Array(FEATURE_COUNT).fill(0);
  weights[FEATURE_NAMES.indexOf('aggregateHeight')] = -1;
  weights[FEATURE_NAMES.indexOf('linesCleared')] = 10;
  return weights;
};

const budget = (): SearchLimits => ({
  maxRootPlacements: 1,
  maxChildPlacements: 1,
  maxLockedDepth: 4,
  maxWorkUnits: Number.MAX_SAFE_INTEGER,
  transpositionCacheEntries: 65_536,
  placementCacheEntries: 16_384,
});

const survivingCorpusState = (): PublicSearchState => ({
  board: boardFrom(Array(20).fill('..........')),
  current: createPiece(2),
  next: 2,
  hold: null,
  holdAvailable: false,
  unseenBagMask: 0b0000010,
});

describe('depth-four constrained corpus', () => {
  it('proves a real four-lock surviving path with exact deterministic counts', () => {
    const first = searchBudgeted(survivingCorpusState(), Array(FEATURE_COUNT).fill(0), budget());
    const second = searchBudgeted(survivingCorpusState(), Array(FEATURE_COUNT).fill(0), budget());
    expect(first).not.toBeNull();
    expect(first!.diagnostics.completedDepth).toBe(4);
    expect(first!.diagnostics.budgetExhausted).toBe(false);
    expect(first!.value.survivalProbability).toBeGreaterThan(0);
    expect(Number.isFinite(first!.value.expectedHeuristicValue)).toBe(true);
    expect(first!.action.kind).toBe('place');
    expect(second!.action.kind).toBe('place');
    if (first!.action.kind === 'place' && second!.action.kind === 'place') {
      expect(cellKey(first!.action.placement.piece)).toBe(cellKey(second!.action.placement.piece));
    }
    expect(second).toEqual(first);
  });

  it('has stable action, finite value, and exact node counts', () => {
    const first = searchBudgeted(corpusState(), corpusWeights(), budget());
    const second = searchBudgeted(corpusState(), corpusWeights(), budget());

    expect(first).not.toBeNull();
    expect(first!.diagnostics.completedDepth).toBe(4);
    expect(first!.diagnostics.budgetExhausted).toBe(false);
    expect(first!.action.kind).toBe('place');
    if (first!.action.kind !== 'place') return;
    expect(cellKey(first!.action.placement.piece)).toBe('10,11,12,13');
    expect(first!.value.survivalProbability).toBe(0);
    expect(Number.isFinite(first!.value.expectedHeuristicValue)).toBe(true);
    expect(second).toEqual(first);
  });
});
