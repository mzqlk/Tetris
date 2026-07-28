import { cpus } from 'node:os';

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
  /**
   * Fitness is `meanLines - heightPenalty * meanHeight`. This is the term that
   * makes training mean anything once candidates stop dying.
   *
   * Why a second objective at all: lines saturate. Four cells per piece against
   * ten per row caps lines at 0.4 per piece, so a candidate that survives the
   * whole game scores 0.4 x maxPieces regardless of how well it plays — three
   * independent measurements landed within 1% of that ceiling, and hand-tuned
   * weights scored the same as trained ones. CEM fits its next distribution to
   * the top 10%; when all ten are tied at the ceiling there is nothing to fit.
   * Mean stack height has no ceiling, so it keeps ranking them.
   *
   * Why exactly 1.0 — measured, by perturbing the trained weights at sigma 0.1
   * (a converged elite pool) and looking at the spread of each term:
   *
   *   cap  300: lines span 3.33, height span 2.93   (12/12 candidates saturate)
   *   cap 1200: lines span 6.00, height span 4.38   (10/12 saturate)
   *
   * At weight 1.0 the two contribute comparably, and they stay comparable as
   * the cap doubles, so the tidiness signal does not fade out of the objective
   * later in a run. Lines are still worth keeping in: under common random
   * numbers a 3-line gap at the ceiling is real packing skill, not luck.
   *
   * Raising it much inverts the objective. Height is bounded by TOTAL_ROWS =
   * 22, so the penalty can move a candidate by at most 22 * heightPenalty,
   * while surviving the game is worth 0.4 * maxPieces lines. A candidate that
   * tops out after five pieces leaves an almost empty board and so reads as
   * immaculate — once 22 * heightPenalty approaches 0.4 * initialMaxPieces (120
   * at the current settings) CEM starts preferring a quick tidy death to a long
   * messy life. Keep `heightPenalty * TOTAL_ROWS` well under 0.4 *
   * initialMaxPieces; at 1.0 the margin is 22 against 120.
   */
  heightPenalty: number;
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
  heightPenalty: 1.0,
  initialNoise: 0.5,
  noiseDecay: 0.95,
  noiseFloor: 0.01,
  baseSeed: 20260727,
  workers: resolveWorkers(null),
  reevalEvery: 10,
  reevalGames: 30,
  reevalMaxPieces: 5000,
};
