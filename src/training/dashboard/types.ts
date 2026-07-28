export interface LogEntry {
  gen: number;
  ts: number;
  best: number;
  mean: number;
  median: number;
  worst: number;
  std: number;
  mu: number[];
  sigma: number[];
  bestWeights: number[];
  maxPieces: number;
  medianPieces: number;
  /** Median survived pieces among the elites — drives the piece-cap schedule. */
  elitePieces: number;
  gamesPerCandidate: number;
  elapsedMs: number;
}
