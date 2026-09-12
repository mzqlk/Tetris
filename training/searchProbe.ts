import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

import { FIXED_SEARCH_LIMITS } from '../src/ai/search';
import {
  MAX_PLACEMENT_CACHE_ENTRIES,
  MAX_TRANSPOSITION_ENTRIES,
} from '../src/ai/searchCache';

export const SEARCH_PROBE_CONFIG = Object.freeze({
  seed: 20260727 as const,
  maxOldGenerationSizeMb: 512 as const,
  search: FIXED_SEARCH_LIMITS,
});

export interface SearchProbeResult {
  seed: 20260727;
  maxOldGenerationSizeMb: 512;
  elapsedMs: number;
  heapUsedMiB: number;
  rssMiB: number;
  completedDepth: number;
  aborted: boolean;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
  placementCacheHits: number;
  transpositionEntries: number;
  placementCacheEntries: number;
  equivalentPlacementsRemoved: number;
  prunedChanceBranches: number;
}

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function assertSearchProbeResult(value: unknown): SearchProbeResult {
  if (typeof value !== 'object' || value === null) {
    throw new Error('search probe returned a non-object result');
  }
  const result = value as Partial<SearchProbeResult>;
  if (result.seed !== SEARCH_PROBE_CONFIG.seed
    || result.maxOldGenerationSizeMb !== SEARCH_PROBE_CONFIG.maxOldGenerationSizeMb) {
    throw new Error('search probe returned mismatched seed or heap metadata');
  }
  if (result.completedDepth !== FIXED_SEARCH_LIMITS.maxLockedDepth) {
    throw new Error('search probe must return completed depth 4');
  }
  if (result.aborted !== false) {
    throw new Error('search probe must not return an aborted decision');
  }
  for (const key of [
    'elapsedMs',
    'heapUsedMiB',
    'rssMiB',
    'expandedDecisionNodes',
    'expandedChanceNodes',
    'cacheHits',
    'placementCacheHits',
    'transpositionEntries',
    'placementCacheEntries',
    'equivalentPlacementsRemoved',
    'prunedChanceBranches',
  ] as const) {
    if (!finiteNonNegative(result[key])) {
      throw new Error(`search probe returned invalid ${key}`);
    }
  }
  const transpositionEntries = result.transpositionEntries as number;
  const placementCacheEntries = result.placementCacheEntries as number;
  if (transpositionEntries > MAX_TRANSPOSITION_ENTRIES) {
    throw new Error('search probe exceeded the transposition cache cap');
  }
  if (placementCacheEntries > MAX_PLACEMENT_CACHE_ENTRIES) {
    throw new Error('search probe exceeded the placement cache cap');
  }
  return result as SearchProbeResult;
}

export function runSearchProbe(timeoutMs = 30_000): Promise<SearchProbeResult> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    return Promise.reject(new Error('search probe timeout must be a positive safe integer'));
  }

  const worker = new Worker(new URL('./searchProbeWorker.ts', import.meta.url), {
    name: 'fixed-search-probe',
    execArgv: ['--import', 'tsx'],
    resourceLimits: {
      maxOldGenerationSizeMb: SEARCH_PROBE_CONFIG.maxOldGenerationSizeMb,
    },
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeAllListeners();
    };
    const finish = (error: Error | null, result?: SearchProbeResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate().finally(() => {
        if (error !== null) reject(error);
        else resolve(result!);
      });
    };
    const timer = setTimeout(() => {
      finish(new Error(`fixed depth-4 search probe timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    worker.once('message', (message: unknown) => {
      try {
        finish(null, assertSearchProbeResult(message));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (code !== 0) finish(new Error(`fixed search probe worker exited with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  console.log(JSON.stringify(await runSearchProbe()));
}

const isMain = process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
