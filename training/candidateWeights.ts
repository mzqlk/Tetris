import { writeFileSync } from 'node:fs';
import {
  fromVector,
  parseWeightsFile,
  type Weights,
} from '../src/ai/weights';
import type { LineClearCounts } from '../src/ai/lineClears';
import type { StrategyDiagnostics, SurvivalDiagnostics } from '../src/ai/tetrisStrategy';
import type { SearchDiagnostics } from '../src/ai/weights';
import { SCORE_RATE_OBJECTIVE, SEARCH_CONTRACT, SEARCH_SCHEMA_VERSION } from './objective';
import type { ScoreRateEvaluation } from './runArtifacts';

export interface CandidateWeightsFile {
  version: 5;
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
  searchContract: typeof SEARCH_CONTRACT;
  searchDepth: 4;
  rootBeamWidth: 64;
  childBeamWidth: 32;
  searchDiagnostics: SearchDiagnostics;
  trainedAt: string;
}

const CANDIDATE_WEIGHTS_KEYS = [
  'version', 'weights', 'objective', 'meanScore', 'evalMaxPieces', 'meanLines',
  'meanHeight', 'meanClearCounts', 'tetrisLineShare', 'strategyDiagnostics',
  'survivalDiagnostics', 'evalGames', 'gen', 'searchContract', 'searchDepth',
  'rootBeamWidth', 'childBeamWidth', 'searchDiagnostics', 'trainedAt',
] as const;

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
    || parsed.searchContract !== SEARCH_CONTRACT || parsed.searchDepth !== 4
    || parsed.rootBeamWidth !== 64 || parsed.childBeamWidth !== 32
    || parsed.searchDiagnostics === null
  ) return null;

  return {
    version: 5,
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
    searchContract: SEARCH_CONTRACT,
    searchDepth: 4,
    rootBeamWidth: 64,
    childBeamWidth: 32,
    searchDiagnostics: parsed.searchDiagnostics!,
    trainedAt: parsed.trainedAt,
  };
}

export function buildCandidateWeights(
  evaluation: ScoreRateEvaluation,
  _searchDepth: 1 | 2 | 4,
  trainedAt: string,
): CandidateWeightsFile {
  if (evaluation.searchDiagnostics === undefined) {
    throw new Error('candidate evaluation must include search diagnostics');
  }
  return {
    version: 5,
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
    searchContract: SEARCH_CONTRACT,
    searchDepth: 4,
    rootBeamWidth: 64,
    childBeamWidth: 32,
    searchDiagnostics: { ...evaluation.searchDiagnostics },
    trainedAt,
  };
}

export function writeCandidateWeights(path: string, payload: unknown): void {
  const parsed = parseCandidateWeights(payload);
  if (parsed === null) {
    throw new Error('candidate payload must match the exact score-rate-v4 version 5 schema');
  }
  writeFileSync(path, JSON.stringify(parsed, null, 2));
}
