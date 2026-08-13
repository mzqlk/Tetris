import { FEATURE_COUNT } from '../src/ai/features';
import { normalize } from '../src/ai/weights';
import {
  addLineClearCounts,
  assertLineClearCounts,
  divideLineClearCounts,
  emptyLineClearCounts,
  tetrisLineShare,
  totalLinesFromCounts,
  type LineClearCounts,
} from '../src/ai/lineClears';
import {
  addStrategyDiagnostics,
  divideStrategyDiagnostics,
  emptyStrategyDiagnostics,
  type StrategyDiagnostics,
  type SurvivalDiagnostics,
} from '../src/ai/tetrisStrategy';
import type { SimulationSearchDiagnostics } from '../src/ai/simulate';

export interface CemState {
  mu: number[];
  sigma: number[];
  gen: number;
}

/**
 * Start from the origin with unit sigma — no handcrafted prior at all, so the
 * search finds its own direction rather than inheriting our guesses.
 */
export function initCem(dim: number = FEATURE_COUNT): CemState {
  return { mu: Array(dim).fill(0), sigma: Array(dim).fill(1), gen: 0 };
}

/** Box-Muller transform. */
export function gaussian(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function sampleCandidates(
  state: CemState,
  count: number,
  rng: () => number,
): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    const candidate = state.mu.map((m, d) => m + state.sigma[d] * gaussian(rng));
    out.push(normalize(candidate));
  }
  return out;
}

/** Extra variance injected each generation to stop the distribution collapsing early. */
export function noiseAt(
  gen: number,
  opts: { initialNoise: number; noiseDecay: number; noiseFloor: number },
): number {
  return Math.max(opts.noiseFloor, opts.initialNoise * Math.pow(opts.noiseDecay, gen));
}

/** Number of elites kept from a population: ceil(eliteFrac * population), floored at 1. */
export function eliteCount(eliteFrac: number, population: number): number {
  return Math.max(1, Math.ceil(eliteFrac * population));
}

export function updateCem(
  state: CemState,
  candidates: number[][],
  fitness: number[],
  opts: { eliteFrac: number; noise: number },
): CemState {
  if (candidates.length !== fitness.length) {
    throw new Error(`got ${candidates.length} candidates but ${fitness.length} fitness values`);
  }
  if (candidates.length === 0) throw new Error('cannot update from an empty population');

  const elites = candidates
    .map((weights, i) => ({ weights, fit: fitness[i] }))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, eliteCount(opts.eliteFrac, candidates.length))
    .map((e) => e.weights);

  const dim = state.mu.length;
  const mu = new Array<number>(dim).fill(0);
  for (const elite of elites) {
    for (let d = 0; d < dim; d++) mu[d] += elite[d] / elites.length;
  }

  const sigma = new Array<number>(dim);
  for (let d = 0; d < dim; d++) {
    let variance = 0;
    for (const elite of elites) {
      const diff = elite[d] - mu[d];
      variance += (diff * diff) / elites.length;
    }
    sigma[d] = Math.sqrt(variance + opts.noise);
  }

  return { mu, sigma, gen: state.gen + 1 };
}

export interface CandidateStats {
  /** `meanScore / maxPieces` — CEM's fixed-schedule selection target. */
  fitness: number[];
  meanScore: number[];
  meanLines: number[];
  meanPieces: number[];
  meanHeight: number[];
  meanClearCounts: LineClearCounts[];
  tetrisLineShares: number[];
  meanStrategyDiagnostics: StrategyDiagnostics[];
  meanSearchDiagnostics: SimulationSearchDiagnostics[];
  survivalDiagnostics: SurvivalDiagnostics[];
}

/**
 * Reassemble per-candidate statistics from the flat results array.
 *
 * Tasks are flattened row-major as `i * gamesPerCandidate + j`, and WorkerPool
 * fills its output by INPUT ARRAY POSITION rather than by taskId, so results
 * line up positionally regardless of the order games actually finished in.
 *
 * This is the most dangerous arithmetic in the trainer. Transpose the
 * flattening — or change the pool to order by taskId — and every candidate gets
 * a different candidate's fitness. Selection then optimises noise, the run
 * learns nothing, and every log line still looks perfectly healthy. Hence a
 * pure function with tests rather than a loop buried in the orchestration.
 *
 * Fitness itself is `meanScore / maxPieces`. The scheduled cap remains the
 * denominator even when a game ends early, so CEM cannot reward a candidate
 * merely for scoring quickly before it dies.
 */
export function aggregateFitness(
  results: readonly {
    score: number;
    lines: number;
    pieces: number;
    meanHeight: number;
    clearCounts: LineClearCounts;
    strategyDiagnostics: StrategyDiagnostics;
    searchDiagnostics: SimulationSearchDiagnostics;
    reason: 'gameover' | 'pieceCap' | 'error';
  }[],
  population: number,
  gamesPerCandidate: number,
  maxPieces: number,
): CandidateStats {
  if (!Number.isFinite(maxPieces) || maxPieces <= 0) {
    throw new Error(`maxPieces must be positive, got ${maxPieces}`);
  }
  const expected = population * gamesPerCandidate;
  if (results.length !== expected) {
    throw new Error(`expected ${expected} results, got ${results.length}`);
  }
  for (const result of results) {
    const search = result.searchDiagnostics;
    for (const field of ['holdActions', 'holdRate', 'meanCompletedDepth', 'minCompletedDepth',
      'expandedDecisionNodes', 'expandedChanceNodes', 'cacheHits', 'abortedSearches'] as const) {
      const value = search[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`searchDiagnostics.${field} must be finite and non-negative`);
      }
    }
    if (search.holdRate > 1 || search.meanCompletedDepth > 4 || search.minCompletedDepth > 4) {
      throw new Error('searchDiagnostics depth/rate is out of range');
    }
    for (const field of [
      'meanCleanWellDepth',
      'meanTetrisSetupProgress',
      'meanTetrisReadyRows',
    ] as const) {
      const value = result.strategyDiagnostics[field];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`strategyDiagnostics.${field} must be finite`);
      }
      if (value < 0 || value > 4) {
        throw new Error(`strategyDiagnostics.${field} must be within 0..4`);
      }
    }
    assertLineClearCounts(result.clearCounts, true);
    if (totalLinesFromCounts(result.clearCounts) !== result.lines) {
      throw new Error('clearCounts must reconstruct lines for every worker result');
    }
  }

  const fitness: number[] = [];
  const meanScore: number[] = [];
  const meanLines: number[] = [];
  const meanPieces: number[] = [];
  const meanHeight: number[] = [];
  const meanClearCounts: LineClearCounts[] = [];
  const tetrisLineShares: number[] = [];
  const meanStrategyDiagnostics: StrategyDiagnostics[] = [];
  const meanSearchDiagnostics: SimulationSearchDiagnostics[] = [];
  const survivalDiagnostics: SurvivalDiagnostics[] = [];

  for (let i = 0; i < population; i++) {
    let score = 0;
    let lines = 0;
    let pieces = 0;
    let height = 0;
    let clearCounts = emptyLineClearCounts();
    let strategyDiagnostics = emptyStrategyDiagnostics();
    const searchDiagnostics: SimulationSearchDiagnostics = {
      holdActions: 0, holdRate: 0, meanCompletedDepth: 0, minCompletedDepth: 0,
      expandedDecisionNodes: 0, expandedChanceNodes: 0, cacheHits: 0, abortedSearches: 0,
    };
    let pieceCapGames = 0;
    let gameoverGames = 0;
    for (let j = 0; j < gamesPerCandidate; j++) {
      const r = results[i * gamesPerCandidate + j];
      score += r.score;
      lines += r.lines;
      pieces += r.pieces;
      height += r.meanHeight;
      clearCounts = addLineClearCounts(clearCounts, r.clearCounts);
      strategyDiagnostics = addStrategyDiagnostics(strategyDiagnostics, r.strategyDiagnostics);
      searchDiagnostics.holdActions += r.searchDiagnostics.holdActions;
      searchDiagnostics.holdRate += r.searchDiagnostics.holdRate;
      searchDiagnostics.meanCompletedDepth += r.searchDiagnostics.meanCompletedDepth;
      searchDiagnostics.minCompletedDepth = j === 0
        ? r.searchDiagnostics.minCompletedDepth
        : Math.min(searchDiagnostics.minCompletedDepth, r.searchDiagnostics.minCompletedDepth);
      searchDiagnostics.expandedDecisionNodes += r.searchDiagnostics.expandedDecisionNodes;
      searchDiagnostics.expandedChanceNodes += r.searchDiagnostics.expandedChanceNodes;
      searchDiagnostics.cacheHits += r.searchDiagnostics.cacheHits;
      searchDiagnostics.abortedSearches += r.searchDiagnostics.abortedSearches;
      if (r.reason === 'pieceCap') pieceCapGames++;
      if (r.reason === 'gameover') gameoverGames++;
    }
    // Height is averaged over GAMES, not over pieces: each game already reports
    // its own per-piece mean. Pooling by pieces instead would silently weight
    // the long games more, which is backwards — the short games are the ones
    // that ended badly.
    const candidateMeanScore = score / gamesPerCandidate;
    meanScore.push(candidateMeanScore);
    meanLines.push(lines / gamesPerCandidate);
    meanPieces.push(pieces / gamesPerCandidate);
    meanHeight.push(height / gamesPerCandidate);
    const candidateMeanClearCounts = divideLineClearCounts(clearCounts, gamesPerCandidate);
    meanClearCounts.push(candidateMeanClearCounts);
    tetrisLineShares.push(tetrisLineShare(candidateMeanClearCounts));
    meanStrategyDiagnostics.push(divideStrategyDiagnostics(strategyDiagnostics, gamesPerCandidate));
    meanSearchDiagnostics.push({
      ...searchDiagnostics,
      holdRate: searchDiagnostics.holdRate / gamesPerCandidate,
      meanCompletedDepth: searchDiagnostics.meanCompletedDepth / gamesPerCandidate,
    });
    survivalDiagnostics.push({ pieceCapGames, gameoverGames });
    fitness.push(candidateMeanScore / maxPieces);
  }

  return {
    fitness,
    meanScore,
    meanLines,
    meanPieces,
    meanHeight,
    meanClearCounts,
    tetrisLineShares,
    meanStrategyDiagnostics,
    meanSearchDiagnostics,
    survivalDiagnostics,
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Raise the per-game piece cap once it is the binding constraint.
 *
 * `elitePieces` is the median survived-piece count among the ELITES, and both
 * halves of that matter. Measured evidence for each:
 *
 * - PIECES, not score rate. The trigger asks whether the fixed schedule is the
 *   binding constraint; only survived pieces answer that directly. A high or
 *   low score rate does not prove that a candidate reached the scheduled cap.
 * - ELITES, not the population. Most sampled candidates die within ~40 pieces,
 *   so the population median never approaches the cap either — measured across
 *   15 real generations it sat at 18-59 against a 240 threshold and never once
 *   fired. CEM fits its next distribution to the elites, so their survival is
 *   the relevant signal for deciding when to lengthen the schedule.
 *
 * Without a working trigger the schedule never rises; with one that fires too
 * eagerly, late generations run for minutes per game and eat the whole time
 * budget. Keying on elite survival puts it where the signal actually is.
 */
export function nextMaxPieces(current: number, elitePieces: number, cap: number): number {
  if (elitePieces <= 0.8 * current) return current;
  return Math.min(current * 2, cap);
}
