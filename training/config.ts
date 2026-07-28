import { cpus } from 'node:os';

export interface TrainConfig {
  /** Candidates sampled per generation. */
  population: number;
  /** Fraction kept as elites; ceil(eliteFrac * population). */
  eliteFrac: number;
  /** Games each candidate plays, all against the same seed set. */
  gamesPerCandidate: number;
  depth: 1 | 2;
  /** Starting piece cap per game; doubles as candidates outgrow it. */
  initialMaxPieces: number;
  /**
   * Hard ceiling on the piece cap, and it must stay modest.
   *
   * Measured: a competent 2-ply candidate does not lose. Across a real run the
   * elites' median survival equalled the cap in EVERY generation (300, 600,
   * 1200, 2400 ...), so the doubling never stops on its own, while generation
   * time grew 34s -> 121s -> 273s -> 326s. Each doubling buys no new
   * information either — `best` just tracks 0.4 x cap to within 0.1%, because
   * lines-with-a-cap cannot rank candidates that never die.
   *
   * So the cap is bounded here rather than left to run away. Above this
   * ceiling, judge convergence from mean / median / sigma, which stay
   * informative, and treat `best` as saturated.
   */
  maxPiecesCap: number;
  /** Extra variance added to sigma^2 each generation. */
  initialNoise: number;
  noiseDecay: number;
  noiseFloor: number;
  baseSeed: number;
  workers: number;
  /** Re-evaluate mu on fresh seeds every N generations. */
  reevalEvery: number;
  reevalGames: number;
  reevalMaxPieces: number;
}

export const DEFAULT_CONFIG: TrainConfig = {
  population: 100,
  eliteFrac: 0.1,
  gamesPerCandidate: 5,
  depth: 2,
  initialMaxPieces: 300,
  maxPiecesCap: 2000,
  initialNoise: 0.5,
  noiseDecay: 0.95,
  noiseFloor: 0.01,
  baseSeed: 20260727,
  workers: Math.max(1, Math.min(31, cpus().length - 1)),
  reevalEvery: 10,
  reevalGames: 30,
  reevalMaxPieces: 5000,
};
