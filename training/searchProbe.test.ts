import { describe, expect, it } from 'vitest';
import { FIXED_SEARCH_LIMITS } from '../src/ai/search';
import {
  SEARCH_PROBE_CONFIG,
  assertSearchProbeResult,
  type SearchProbeResult,
} from './searchProbe';

function validProbeResult(): SearchProbeResult {
  return {
    seed: 20260727,
    maxOldGenerationSizeMb: 512,
    elapsedMs: 100,
    heapUsedMiB: 20,
    rssMiB: 80,
    completedDepth: 4,
    aborted: false,
    expandedDecisionNodes: 10,
    expandedChanceNodes: 20,
    cacheHits: 3,
    placementCacheHits: 4,
    transpositionEntries: 5,
    placementCacheEntries: 6,
    equivalentPlacementsRemoved: 7,
    prunedChanceBranches: 8,
  };
}

describe('fixed-search viability probe contract', () => {
  it('uses the immutable production search contract and memory cap', () => {
    expect(SEARCH_PROBE_CONFIG).toEqual({
      seed: 20260727,
      maxOldGenerationSizeMb: 512,
      search: FIXED_SEARCH_LIMITS,
    });
  });

  it('accepts a complete non-aborted result within cache caps', () => {
    expect(assertSearchProbeResult(validProbeResult())).toEqual(validProbeResult());
  });

  it('rejects a worker result that did not complete exact depth four', () => {
    expect(() => assertSearchProbeResult({
      ...validProbeResult(), completedDepth: 3,
    })).toThrow(/completed depth 4/i);
    expect(() => assertSearchProbeResult({
      ...validProbeResult(), aborted: true,
    })).toThrow(/aborted/i);
  });

  it('rejects cache entry counts above the approved caps', () => {
    expect(() => assertSearchProbeResult({
      ...validProbeResult(), transpositionEntries: 65_537,
    })).toThrow(/transposition/i);
    expect(() => assertSearchProbeResult({
      ...validProbeResult(), placementCacheEntries: 16_385,
    })).toThrow(/placement/i);
  });
});
