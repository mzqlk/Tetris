/** Schema/fitness identity shared by trainer, weights metadata, and dashboard. */
export const LEGACY_SCORE_RATE_OBJECTIVE = 'score-rate-v1' as const;
export const SCORE_RATE_V2_OBJECTIVE = 'score-rate-v2' as const;
export const SCORE_RATE_V3_OBJECTIVE = 'score-rate-v3' as const;
export const SCORE_RATE_OBJECTIVE = 'score-rate-v4' as const;
export const SEARCH_CONTRACT = 'bag-expectimax-hold-v1' as const;
export const SEARCH_SCHEMA_VERSION = 5 as const;
export interface SearchMetadata {
  searchContract: typeof SEARCH_CONTRACT;
  searchDepth: 4;
  rootBeamWidth: 64;
  childBeamWidth: 32;
}
export type ScoreRateObjective = typeof SCORE_RATE_OBJECTIVE;
