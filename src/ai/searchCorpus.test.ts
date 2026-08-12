import { describe, expect, it } from 'vitest';
import { createPiece } from '../engine/piece';
import { FEATURE_COUNT, FEATURE_NAMES } from './features';
import { cellKey } from './placements';
import type { PublicSearchState } from './publicState';
import { searchFixed, type SearchBudget } from './search';
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

const budget = (): SearchBudget => ({
  maxRootPlacements: 1,
  maxChildPlacements: 1,
  maxLockedDepth: 4,
  shouldAbort: () => false,
  cacheEnabled: true,
});

describe('depth-four constrained corpus', () => {
  it('has stable action, finite value, and exact node counts', () => {
    const first = searchFixed(corpusState(), corpusWeights(), budget());
    const second = searchFixed(corpusState(), corpusWeights(), budget());

    expect(first).not.toBeNull();
    expect(first!.diagnostics.completedDepth).toBe(4);
    expect(first!.diagnostics.aborted).toBe(false);
    expect(first!.action.kind).toBe('place');
    if (first!.action.kind !== 'place') return;
    expect(cellKey(first!.action.placement.piece)).toBe('10,11,12,13');
    expect(first!.value.survivalProbability).toBe(0);
    expect(Number.isFinite(first!.value.expectedHeuristicValue)).toBe(true);
    expect(first!.diagnostics).toEqual({
      completedDepth: 4,
      expandedDecisionNodes: 9,
      expandedChanceNodes: 10,
      cacheHits: 0,
      aborted: false,
    });
    expect(second).toEqual(first);
  });
});
