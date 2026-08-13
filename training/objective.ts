export {
  LEGACY_SCORE_RATE_OBJECTIVE,
  SCORE_RATE_V2_OBJECTIVE,
  SCORE_RATE_V3_OBJECTIVE,
  SCORE_RATE_OBJECTIVE,
  SEARCH_CONTRACT,
  SEARCH_SCHEMA_VERSION,
} from '../src/ai/trainingObjective';

/** Height may break a publication tie only inside this relative score band. */
export const SCORE_TIE_RELATIVE_TOLERANCE = 0.001;

/** A qualified stable-Tetris candidate must clear at least this share of lines via Tetrises. */
export const TETRIS_LINE_SHARE_THRESHOLD = 0.20;

/** Every publish decision uses this fixed long-game schedule. */
export const PUBLICATION_GAMES = 30;
export const PUBLICATION_MAX_PIECES = 5000;
