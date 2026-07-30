import type { ScoreRateObjective } from '../../ai/trainingObjective';

export interface LogEntry {
  objective: ScoreRateObjective;
  gen: number;
  ts: number;
  bestScoreRate: number;
  meanScoreRate: number;
  medianScoreRate: number;
  worstScoreRate: number;
  scoreRateStd: number;
  mu: number[];
  sigma: number[];
  bestWeights: number[];
  maxPieces: number;
  medianPieces: number;
  elitePieces: number;
  medianScore: number;
  eliteScore: number;
  medianLines: number;
  medianHeight: number;
  eliteHeight: number;
  gamesPerCandidate: number;
  elapsedMs: number;
}
