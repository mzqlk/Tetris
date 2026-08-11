/** Schema/fitness identity shared by trainer, weights metadata, and dashboard. */
export const LEGACY_SCORE_RATE_OBJECTIVE = 'score-rate-v1' as const;
export const SCORE_RATE_V2_OBJECTIVE = 'score-rate-v2' as const;
export const SCORE_RATE_OBJECTIVE = 'score-rate-v3' as const;
export type ScoreRateObjective = typeof SCORE_RATE_OBJECTIVE;
