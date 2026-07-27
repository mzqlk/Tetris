import { FEATURE_NAMES, FEATURE_COUNT, type FeatureName } from './features';
import trainedWeightsJson from './trained-weights.json';

export type Weights = Record<FeatureName, number>;

export interface WeightsFile {
  version: number;
  weights: Weights;
  meanLines: number;
  evalGames: number;
  gen: number;
  searchDepth: 1 | 2;
  trainedAt: string;
}

export function toVector(w: Weights): number[] {
  return FEATURE_NAMES.map((name) => w[name]);
}

export function fromVector(v: number[]): Weights {
  if (v.length !== FEATURE_COUNT) {
    throw new Error(`expected ${FEATURE_COUNT} weights, got ${v.length}`);
  }
  const out = {} as Weights;
  FEATURE_NAMES.forEach((name, i) => {
    out[name] = v[i];
  });
  return out;
}

/**
 * L2-normalise. The evaluator is a linear score followed by an argmax, so
 * scaling the whole vector changes no decision — normalising stops CEM from
 * wandering along a meaningless magnitude axis and keeps sigma interpretable.
 */
export function normalize(v: number[]): number[] {
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) return v.slice();
  return v.map((x) => x / norm);
}

/**
 * Validate an untrusted weights file. Returns null rather than throwing so the
 * browser and the dashboard can quietly fall back to the built-in weights.
 */
export function parseWeightsFile(data: unknown): WeightsFile | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;

  if (typeof d.weights !== 'object' || d.weights === null) return null;
  const raw = d.weights as Record<string, unknown>;
  if (Object.keys(raw).length !== FEATURE_COUNT) return null;

  const weights = {} as Weights;
  for (const name of FEATURE_NAMES) {
    const value = raw[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    weights[name] = value;
  }

  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

  return {
    version: num(d.version, 1),
    weights,
    meanLines: num(d.meanLines, 0),
    evalGames: num(d.evalGames, 0),
    gen: num(d.gen, 0),
    searchDepth: d.searchDepth === 1 ? 1 : 2,
    trainedAt: typeof d.trainedAt === 'string' ? d.trainedAt : '',
  };
}

/** Dellacherie-style priors. Used until training produces something better. */
export const HANDCRAFTED_WEIGHTS: Weights = fromVector(
  normalize([-0.3, -0.6, -0.2, -0.1, 0.25, -0.35, -0.3, -0.4, -0.2]),
);

const trained = parseWeightsFile(trainedWeightsJson);

/** Bundled into the build so `dist` runs standalone with no network fetch. */
export const DEFAULT_WEIGHTS: Weights = trained ? trained.weights : HANDCRAFTED_WEIGHTS;
export const DEFAULT_WEIGHTS_META: WeightsFile | null = trained;
