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
 * The trigger is median SURVIVED PIECES, not fitness. Fitness is measured in
 * lines, and since a piece contributes 4 cells while a line needs 10, the ratio
 * of lines to pieces can never exceed 0.4 — comparing lines against a fraction
 * of the piece cap would be a condition that can never be true.
 *
 * Without this, late-generation candidates run for minutes per game and eat the
 * whole time budget.
 */
export function nextMaxPieces(current: number, medianPieces: number, cap: number): number {
  if (medianPieces <= 0.8 * current) return current;
  return Math.min(current * 2, cap);
}
