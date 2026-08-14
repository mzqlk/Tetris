import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPiece } from '../engine/piece';
import { FEATURE_COUNT, FEATURE_NAMES } from './features';
import { cellKey } from './placements';
import type { PublicSearchState } from './publicState';
import { searchFixed, searchIterative, type SearchBudget } from './search';
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

const survivingCorpusState = (): PublicSearchState => ({
  board: boardFrom(Array(20).fill('..........')),
  current: createPiece(2),
  next: 2,
  hold: null,
  holdAvailable: false,
  unseenBagMask: 0b0000010,
});

describe('depth-four constrained corpus', () => {
  it('keeps the public search source and feature vector contracts exact', () => {
    const source = readFileSync(resolve(__dirname, 'search.ts'), 'utf8');
    expect(source).not.toMatch(/\.bag\b|\brng\b|node:|document\.|window\.|performance\./);
    expect(FEATURE_NAMES).toEqual([
      'aggregateHeight', 'holes', 'bumpiness', 'maxHeight', 'linesCleared',
      'landingHeight', 'rowTransitions', 'colTransitions', 'wellDepth',
      'lineClearValue', 'cleanWellDepth', 'tetrisSetupProgress', 'tetrisReadyRows',
    ]);
  });

  it('returns the last complete depth and discards a partial next depth', () => {
    let depth1Checks = 0;
    searchFixed(corpusState(), corpusWeights(), {
      ...budget(), maxLockedDepth: 1, shouldAbort: () => { depth1Checks++; return false; },
    });
    let depth2Checks = 0;
    searchFixed(corpusState(), corpusWeights(), {
      ...budget(), maxLockedDepth: 2, shouldAbort: () => { depth2Checks++; return false; },
    });
    const baseline = searchFixed(corpusState(), corpusWeights(), { ...budget(), maxLockedDepth: 2 });
    let calls = 0;
    const abortAfter = depth1Checks + depth2Checks + 1;
    const result = searchIterative(corpusState(), corpusWeights(), {
      ...budget(), maxLockedDepth: 4, shouldAbort: () => ++calls > abortAfter,
    });
    expect(result).not.toBeNull();
    expect(result!.diagnostics).toMatchObject({ completedDepth: 2, aborted: true });
    expect(result!.action).toEqual(baseline!.action);
  });

  it('uses a complete one-ply placement fallback when depth one aborts', () => {
    const result = searchIterative(corpusState(), corpusWeights(), {
      ...budget(), maxLockedDepth: 4, shouldAbort: () => true,
    });
    expect(result).not.toBeNull();
    expect(result!.diagnostics).toMatchObject({ completedDepth: 0, aborted: true });
    expect(result!.action.kind).toBe('place');
  });



  it('proves a real four-lock surviving path with exact deterministic counts', () => {
    const first = searchFixed(survivingCorpusState(), Array(FEATURE_COUNT).fill(0), budget());
    const second = searchFixed(survivingCorpusState(), Array(FEATURE_COUNT).fill(0), budget());
    expect(first).not.toBeNull();
    expect(first!.diagnostics.completedDepth).toBe(4);
    expect(first!.value.survivalProbability).toBeGreaterThan(0);
    expect(Number.isFinite(first!.value.expectedHeuristicValue)).toBe(true);
    expect(first!.action.kind).toBe('place');
    expect(second!.action.kind).toBe('place');
    if (first!.action.kind === 'place' && second!.action.kind === 'place') {
      expect(cellKey(first!.action.placement.piece)).toBe(cellKey(second!.action.placement.piece));
    }
    expect(first!.diagnostics).toEqual({
      completedDepth: 4,
      expandedDecisionNodes: 311,
      expandedChanceNodes: 102,
      cacheHits: 425,
      placementCacheHits: 259,
      placementCacheEntries: 52,
      transpositionEntries: 413,
      aborted: false,
    });
    expect(second).toEqual(first);
  });

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
      placementCacheHits: 7,
      placementCacheEntries: 2,
      transpositionEntries: 19,
      aborted: false,
    });
    expect(second).toEqual(first);
  });
});
