import { cpus } from 'node:os';
import { PUBLICATION_GAMES, PUBLICATION_MAX_PIECES } from './objective';

/**
 * How many worker threads a run gets, from an optional `--workers N`.
 *
 * `requested === null` means "decide for me": one thread short of the core
 * count, so the machine stays usable, capped at 31 because past that the
 * generation is bounded by the slowest single game rather than by throughput.
 *
 * A bad count has to throw here rather than reach the pool. `WorkerPool(0)`
 * spawns nothing, so no task is ever fed to anything and `run()` never settles:
 * a multi-hour script that hangs in perfect silence. `WorkerPool(NaN)` does the
 * same. Both are far cheaper to catch at the argument.
 */
export function resolveWorkers(
  requested: number | null,
  available: number = cpus().length,
): number {
  if (requested === null) return Math.max(1, Math.min(31, available - 1));
  if (!Number.isInteger(requested)) {
    throw new Error(`--workers expects a whole number, got ${requested}`);
  }
  if (requested < 1) throw new Error(`--workers must be at least 1, got ${requested}`);
  return requested;
}

export interface TrainConfig {
  /** Candidates sampled per generation. */
  population: number;
  /** Fraction kept as elites; ceil(eliteFrac * population). */
  eliteFrac: number;
  /** Games each candidate plays, all against the same seed set. */
  gamesPerCandidate: number;
  /** Starting piece cap per game; doubles as candidates outgrow it. */
  initialMaxPieces: number;
  /**
   * Hard ceiling on the fixed schedule, kept modest to bound generation cost.
   *
   * Measured: a competent 2-ply candidate does not lose. Across a real run the
   * elites' median survival equalled the cap in EVERY generation (300, 600,
   * 1200, 2400 ...), so the doubling never stops on its own, while generation
   * time grew 34s -> 121s -> 273s -> 326s. Score rate remains comparable across
   * these scheduled caps, while mean height remains diagnostic, but an
   * unbounded schedule still buys diminishing information at runaway cost.
   *
   * So the schedule is bounded here rather than left to run away. At the
   * ceiling, judge convergence from score-rate distribution and sigma, with
   * height reported separately as a diagnostic.
   */
  maxPiecesCap: number;
  /** Extra variance added to sigma^2 each generation. */
  initialNoise: number;
  noiseDecay: number;
  noiseFloor: number;
  baseSeed: number;
  workers: number;
  /** Re-evaluate mu on the fixed publication schedule every N generations. */
  reevalEvery: number;
  reevalGames: number;
  reevalMaxPieces: number;
}

export const DEFAULT_CONFIG: TrainConfig = {
  population: 100,
  eliteFrac: 0.1,
  gamesPerCandidate: 5,
  initialMaxPieces: 300,
  maxPiecesCap: 2000,
  initialNoise: 0.5,
  noiseDecay: 0.95,
  noiseFloor: 0.01,
  baseSeed: 20260727,
  workers: resolveWorkers(null),
  reevalEvery: 10,
  reevalGames: PUBLICATION_GAMES,
  reevalMaxPieces: PUBLICATION_MAX_PIECES,
};
