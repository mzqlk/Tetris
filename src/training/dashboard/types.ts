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
  /**
   * The two halves of fitness, logged separately because `best`/`median`/`worst`
   * are the combination `lines - heightPenalty * height` and neither half can
   * be recovered from it.
   */
  medianLines: number;
  medianHeight: number;
  /** Median stack height among the elites — the part of fitness that still moves. */
  eliteHeight: number;
  heightPenalty: number;
  gamesPerCandidate: number;
  elapsedMs: number;
}
