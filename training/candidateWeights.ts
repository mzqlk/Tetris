import { writeFileSync } from 'node:fs';
import {
  fromVector,
  parseWeightsFile,
  type Weights,
} from '../src/ai/weights';
import type { LineClearCounts } from '../src/ai/lineClears';
import type { StrategyDiagnostics, SurvivalDiagnostics } from '../src/ai/tetrisStrategy';
import type { SearchDiagnostics } from '../src/ai/weights';
import {
  SCORE_RATE_OBJECTIVE,
  SEARCH_CONTRACT,
  SEARCH_METADATA,
  SEARCH_METADATA_KEYS,
  SEARCH_SCHEMA_VERSION,
  type SearchMetadata,
} from './objective';
import type { ScoreRateEvaluation } from './runArtifacts';

export interface CandidateWeightsFile extends SearchMetadata {
  version: typeof SEARCH_SCHEMA_VERSION;
  weights: Weights;
  objective: typeof SCORE_RATE_OBJECTIVE;
  meanScore: number;
  evalMaxPieces: number;
  meanLines: number;
  meanHeight: number;
  meanClearCounts: LineClearCounts;
  tetrisLineShare: number;
  strategyDiagnostics: StrategyDiagnostics;
  survivalDiagnostics: SurvivalDiagnostics;
  evalGames: number;
  gen: number;
  searchDiagnostics: SearchDiagnostics;
  trainedAt: string;
}

const CANDIDATE_WEIGHTS_KEYS = [
  'version', 'weights', 'objective', 'meanScore', 'evalMaxPieces', 'meanLines',
  'meanHeight', 'meanClearCounts', 'tetrisLineShare', 'strategyDiagnostics',
  'survivalDiagnostics', 'evalGames', 'gen', ...SEARCH_METADATA_KEYS,
  'searchDiagnostics', 'trainedAt',
] as const;

const snapshotSearchDiagnostics = (diagnostics: SearchDiagnostics): SearchDiagnostics => ({
  ...diagnostics,
  completedDepthHistogram: [...diagnostics.completedDepthHistogram],
});

export function parseCandidateWeights(payload: unknown): CandidateWeightsFile | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const raw = payload as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (
    keys.length !== CANDIDATE_WEIGHTS_KEYS.length ||
    CANDIDATE_WEIGHTS_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(raw, key))
  ) return null;

  const parsed = parseWeightsFile(payload);
  if (
    parsed === null ||
    parsed.version !== SEARCH_SCHEMA_VERSION ||
    parsed.objective !== SCORE_RATE_OBJECTIVE ||
    parsed.meanScore === null ||
    parsed.evalMaxPieces === null ||
    parsed.meanClearCounts === null ||
    parsed.tetrisLineShare === null ||
    parsed.strategyDiagnostics === null ||
    parsed.survivalDiagnostics === null
    || parsed.searchContract !== SEARCH_CONTRACT
    || parsed.searchDiagnostics === null
  ) return null;

  return {
    version: SEARCH_SCHEMA_VERSION,
    weights: { ...parsed.weights },
    objective: SCORE_RATE_OBJECTIVE,
    meanScore: parsed.meanScore,
    evalMaxPieces: parsed.evalMaxPieces,
    meanLines: parsed.meanLines,
    meanHeight: parsed.meanHeight,
    meanClearCounts: { ...parsed.meanClearCounts },
    tetrisLineShare: parsed.tetrisLineShare,
    strategyDiagnostics: { ...parsed.strategyDiagnostics },
    survivalDiagnostics: { ...parsed.survivalDiagnostics },
    evalGames: parsed.evalGames,
    gen: parsed.gen,
    ...SEARCH_METADATA,
    searchDiagnostics: snapshotSearchDiagnostics(parsed.searchDiagnostics!),
    trainedAt: parsed.trainedAt,
  };
}

export function buildCandidateWeights(
  evaluation: ScoreRateEvaluation,
  searchDepth: 4,
  trainedAt: string,
): CandidateWeightsFile {
  if (searchDepth !== SEARCH_METADATA.searchDepth) {
    throw new Error('candidate weights require the fixed depth-4 search contract');
  }
  if (evaluation.searchDiagnostics === undefined) {
    throw new Error('candidate evaluation must include search diagnostics');
  }
  return {
    version: SEARCH_SCHEMA_VERSION,
    weights: fromVector(evaluation.weights),
    objective: SCORE_RATE_OBJECTIVE,
    meanScore: evaluation.meanScore,
    evalMaxPieces: evaluation.evalMaxPieces,
    meanLines: evaluation.meanLines,
    meanHeight: evaluation.meanHeight,
    meanClearCounts: { ...evaluation.meanClearCounts },
    tetrisLineShare: evaluation.tetrisLineShare,
    strategyDiagnostics: { ...evaluation.strategyDiagnostics },
    survivalDiagnostics: { ...evaluation.survivalDiagnostics },
    evalGames: evaluation.evalGames,
    gen: evaluation.gen,
    ...SEARCH_METADATA,
    searchDiagnostics: snapshotSearchDiagnostics(evaluation.searchDiagnostics),
    trainedAt,
  };
}

export function writeCandidateWeights(path: string, payload: unknown): void {
  const parsed = parseCandidateWeights(payload);
  if (parsed === null) {
    throw new Error('candidate payload must match the exact score-rate-v5 version 6 schema');
  }
  writeFileSync(path, JSON.stringify(parsed, null, 2));
}
