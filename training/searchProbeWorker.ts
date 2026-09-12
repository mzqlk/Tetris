import { parentPort } from 'node:worker_threads';

import { searchFixed } from '../src/ai/search';
import { createSimState, projectPublicSearchState } from '../src/ai/simulate';
import { DEFAULT_WEIGHTS, toVector } from '../src/ai/weights';
import { SEARCH_PROBE_CONFIG, type SearchProbeResult } from './searchProbe';

if (parentPort === null) throw new Error('searchProbeWorker.ts must run in a worker thread');

const started = performance.now();
const decision = searchFixed(
  projectPublicSearchState(createSimState(SEARCH_PROBE_CONFIG.seed)),
  toVector(DEFAULT_WEIGHTS),
  {
    ...SEARCH_PROBE_CONFIG.search,
    shouldAbort: () => false,
  },
);
if (decision === null) throw new Error('fixed search probe returned no decision');

const memory = process.memoryUsage();
const result: SearchProbeResult = {
  seed: SEARCH_PROBE_CONFIG.seed,
  maxOldGenerationSizeMb: SEARCH_PROBE_CONFIG.maxOldGenerationSizeMb,
  elapsedMs: Math.round(performance.now() - started),
  heapUsedMiB: Math.round((memory.heapUsed / 1_048_576) * 10) / 10,
  rssMiB: Math.round((memory.rss / 1_048_576) * 10) / 10,
  completedDepth: decision.diagnostics.completedDepth,
  aborted: decision.diagnostics.aborted,
  expandedDecisionNodes: decision.diagnostics.expandedDecisionNodes,
  expandedChanceNodes: decision.diagnostics.expandedChanceNodes,
  cacheHits: decision.diagnostics.cacheHits,
  placementCacheHits: decision.diagnostics.placementCacheHits,
  transpositionEntries: decision.diagnostics.transpositionEntries,
  placementCacheEntries: decision.diagnostics.placementCacheEntries,
  equivalentPlacementsRemoved: decision.diagnostics.equivalentPlacementsRemoved,
  prunedChanceBranches: decision.diagnostics.prunedChanceBranches,
};

parentPort.postMessage(result);
