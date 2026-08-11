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
  const parsed = parseWeightsFile(payload);
  if (
    parsed === null ||
    parsed.version !== 4 ||
    parsed.objective !== SCORE_RATE_OBJECTIVE
  ) {
    throw new Error('candidate payload must be a valid score-rate-v3 version 4 weights file');
  }
  writeFileSync(path, JSON.stringify(payload, null, 2));
}
