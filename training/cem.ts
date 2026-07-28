import { FEATURE_COUNT } from '../src/ai/features';
import { normalize } from '../src/ai/weights';

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

  const eliteCount = Math.max(1, Math.ceil(opts.eliteFrac * candidates.length));
  const elites = candidates
    .map((weights, i) => ({ weights, fit: fitness[i] }))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, eliteCount)
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
 * - PIECES, not fitness. Fitness is lines; a piece contributes 4 cells and a
 *   line needs 10, so lines/pieces can never exceed 0.4. Comparing lines
 *   against a fraction of the piece cap is a condition that can never be true.
 * - ELITES, not the population. Most sampled candidates die within ~40 pieces,
 *   so the population median never approaches the cap either — measured across
 *   15 real generations it sat at 18-59 against a 240 threshold and never once
 *   fired. Meanwhile the best candidate was pinned at 99% of the 0.4 x cap
 *   ceiling from generation 0 onward. CEM fits its next distribution to the
 *   elites, so when they are all pressed against the ceiling it can no longer
 *   tell its best candidate from its worst elite, and selection pressure dies.
 *
 * Without a working trigger the cap never rises and fitness saturates; with one
 * that fires too eagerly, late generations run for minutes per game and eat the
 * whole time budget. Keying on the elites puts it where the signal actually is.
 */
export function nextMaxPieces(current: number, elitePieces: number, cap: number): number {
  if (elitePieces <= 0.8 * current) return current;
  return Math.min(current * 2, cap);
}
