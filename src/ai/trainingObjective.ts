import {
  DETERMINISTIC_SEARCH_LIMITS,
  SEARCH_BUDGET_CORPUS_ID,
} from './searchBudget';

/** Schema/fitness identity shared by trainer, weights metadata, and dashboard. */
export const LEGACY_SCORE_RATE_OBJECTIVE = 'score-rate-v1' as const;
export const SCORE_RATE_V2_OBJECTIVE = 'score-rate-v2' as const;
export const SCORE_RATE_V3_OBJECTIVE = 'score-rate-v3' as const;
export const SCORE_RATE_V4_OBJECTIVE = 'score-rate-v4' as const;
export const SCORE_RATE_OBJECTIVE = 'score-rate-v5' as const;
export const SEARCH_CONTRACT = 'bag-expectimax-hold-v2' as const;
export const SEARCH_SCHEMA_VERSION = 6 as const;

export const SEARCH_METADATA = Object.freeze({
  searchContract: SEARCH_CONTRACT,
  searchDepth: 4,
  rootBeamWidth: 64,
  childBeamWidth: 32,
  maxWorkUnits: DETERMINISTIC_SEARCH_LIMITS.maxWorkUnits,
  budgetCorpus: SEARCH_BUDGET_CORPUS_ID,
  transpositionCacheEntries: 65_536,
  placementCacheEntries: 16_384,
} as const);

export type SearchMetadata = typeof SEARCH_METADATA;

export const SEARCH_METADATA_KEYS = Object.freeze(
  Object.keys(SEARCH_METADATA) as (keyof SearchMetadata)[],
);

export function hasSearchMetadata(value: Record<string, unknown>): boolean {
  return SEARCH_METADATA_KEYS.every((key) => value[key] === SEARCH_METADATA[key]);
}

export type ScoreRateObjective = typeof SCORE_RATE_OBJECTIVE;
