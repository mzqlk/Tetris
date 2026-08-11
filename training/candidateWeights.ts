import { writeFileSync } from 'node:fs';
import {
  fromVector,
  parseWeightsFile,
  type Weights,
} from '../src/ai/weights';
import type { LineClearCounts } from '../src/ai/lineClears';
import type { StrategyDiagnostics, SurvivalDiagnostics } from '../src/ai/tetrisStrategy';
import { SCORE_RATE_OBJECTIVE } from './objective';
import type { ScoreRateEvaluation } from './runArtifacts';

export interface CandidateWeightsFile {
  version: 4;
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
  searchDepth: 1 | 2;
  trainedAt: string;
}

const CANDIDATE_WEIGHTS_KEYS = [
  'version', 'weights', 'objective', 'meanScore', 'evalMaxPieces', 'meanLines',
  'meanHeight', 'meanClearCounts', 'tetrisLineShare', 'strategyDiagnostics',
  'survivalDiagnostics', 'evalGames', 'gen', 'searchDepth', 'trainedAt',
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
    parsed.version !== 4 ||
    parsed.objective !== SCORE_RATE_OBJECTIVE ||
    parsed.meanScore === null ||
    parsed.evalMaxPieces === null ||
    parsed.meanClearCounts === null ||
    parsed.tetrisLineShare === null ||
    parsed.strategyDiagnostics === null ||
    parsed.survivalDiagnostics === null
  ) return null;

  return {
    version: 4,
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
    searchDepth: parsed.searchDepth,
    trainedAt: parsed.trainedAt,
  };
}

export function buildCandidateWeights(
  evaluation: ScoreRateEvaluation,
  searchDepth: 1 | 2,
  trainedAt: string,
): CandidateWeightsFile {
  return {
    version: 4,
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
    searchDepth,
    trainedAt,
  };
}

export function writeCandidateWeights(path: string, payload: unknown): void {
  const parsed = parseCandidateWeights(payload);
  if (parsed === null) {
    throw new Error('candidate payload must match the exact score-rate-v3 version 4 schema');
  }
  writeFileSync(path, JSON.stringify(parsed, null, 2));
}
