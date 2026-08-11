import {
  LEGACY_FEATURE_NAMES, SCORE_RATE_V2_FEATURE_NAMES, FEATURE_NAMES, FEATURE_COUNT,
  type FeatureName,
} from './features';
import {
  totalLinesFromCounts,
  tetrisLineShare as calculateTetrisLineShare,
  type LineClearCounts,
} from './lineClears';
import type { StrategyDiagnostics, SurvivalDiagnostics } from './tetrisStrategy';
import {
  LEGACY_SCORE_RATE_OBJECTIVE, SCORE_RATE_V2_OBJECTIVE, SCORE_RATE_OBJECTIVE,
} from './trainingObjective';
import trainedWeightsJson from './trained-weights.json';

export type Weights = Record<FeatureName, number>;

export interface WeightsFile {
  version: number;
  weights: Weights;
  objective: string | null;
  meanScore: number | null;
  evalMaxPieces: number | null;
  meanLines: number;
  /** Mean stack height over the same evaluation — 0 in files written before it. */
  meanHeight: number;
  meanClearCounts: LineClearCounts | null;
  tetrisLineShare: number | null;
  evalGames: number;
  gen: number;
  searchDepth: 1 | 2;
  trainedAt: string;
  strategyDiagnostics: StrategyDiagnostics | null;
  survivalDiagnostics: SurvivalDiagnostics | null;
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

function parseExactWeights(
  raw: Record<string, unknown>,
  names: readonly string[],
): Record<string, number> | null {
  if (Object.keys(raw).length !== names.length) return null;

  const parsed: Record<string, number> = {};
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(raw, name)) return null;
    const value = raw[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    parsed[name] = value;
  }
  return parsed;
}

const LINE_CLEAR_COUNT_KEYS = ['singles', 'doubles', 'triples', 'tetrises'] as const;

function parseLineClearCounts(value: unknown): LineClearCounts | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).length !== LINE_CLEAR_COUNT_KEYS.length ||
    LINE_CLEAR_COUNT_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(raw, key))
  ) return null;

  const result = {} as LineClearCounts;
  for (const key of LINE_CLEAR_COUNT_KEYS) {
    const count = raw[key];
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null;
    result[key] = count;
  }
  return result;
}

function closeEnough(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected));
}

function nonNegativeFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function integerAtLeast(value: unknown, minimum: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? value
    : null;
}

interface ScoreMetadata {
  meanScore: number;
  evalMaxPieces: number;
  meanLines: number;
  meanHeight: number;
  meanClearCounts: LineClearCounts;
  tetrisLineShare: number;
  evalGames: number;
  gen: number;
  searchDepth: 1 | 2;
  trainedAt: string;
}

function parseScoreMetadata(d: Record<string, unknown>): ScoreMetadata | null {
  const meanScore = nonNegativeFinite(d.meanScore);
  const evalMaxPieces = integerAtLeast(d.evalMaxPieces, 1);
  const meanLines = nonNegativeFinite(d.meanLines);
  const meanHeight = nonNegativeFinite(d.meanHeight);
  const meanClearCounts = parseLineClearCounts(d.meanClearCounts);
  const tetrisLineShare = nonNegativeFinite(d.tetrisLineShare);
  const evalGames = integerAtLeast(d.evalGames, 1);
  const gen = integerAtLeast(d.gen, -1);
  const searchDepth = d.searchDepth === 1 || d.searchDepth === 2 ? d.searchDepth : null;
  const trainedAt = isoTimestamp(d.trainedAt);
  if (
    meanScore === null ||
    evalMaxPieces === null ||
    meanLines === null ||
    meanHeight === null ||
    meanClearCounts === null ||
    tetrisLineShare === null ||
    evalGames === null ||
    gen === null ||
    searchDepth === null ||
    trainedAt === null
  ) return null;

  let expectedMeanLines: number;
  let expectedTetrisLineShare: number;
  try {
    expectedMeanLines = totalLinesFromCounts(meanClearCounts);
    expectedTetrisLineShare = calculateTetrisLineShare(meanClearCounts);
  } catch {
    return null;
  }
  if (!closeEnough(meanLines, expectedMeanLines)) return null;
  if (!closeEnough(tetrisLineShare, expectedTetrisLineShare)) return null;
  return {
    meanScore,
    evalMaxPieces,
    meanLines,
    meanHeight,
    meanClearCounts,
    tetrisLineShare,
    evalGames,
    gen,
    searchDepth,
    trainedAt,
  };
}

function parseStrategyDiagnostics(value: unknown): StrategyDiagnostics | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const keys = [
    'meanCleanWellDepth', 'meanTetrisSetupProgress', 'meanTetrisReadyRows',
  ] as const;
  if (
    Object.keys(raw).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(raw, key))
  ) return null;
  const values = keys.map((key) => raw[key]);
  if (values.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > 4)) {
    return null;
  }
  return {
    meanCleanWellDepth: values[0] as number,
    meanTetrisSetupProgress: values[1] as number,
    meanTetrisReadyRows: values[2] as number,
  };
}

function parseSurvivalDiagnostics(value: unknown, evalGames: number): SurvivalDiagnostics | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const keys = ['pieceCapGames', 'gameoverGames'] as const;
  if (
    Object.keys(raw).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(raw, key))
  ) return null;
  const pieceCapGames = integerAtLeast(raw.pieceCapGames, 0);
  const gameoverGames = integerAtLeast(raw.gameoverGames, 0);
  if (
    pieceCapGames === null || gameoverGames === null ||
    pieceCapGames > evalGames || gameoverGames > evalGames ||
    pieceCapGames + gameoverGames > evalGames
  ) return null;
  return { pieceCapGames, gameoverGames };
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

  const version = d.version === undefined ? 1 : d.version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) return null;
  const objectiveDeclared = Object.prototype.hasOwnProperty.call(d, 'objective');
  const objective = typeof d.objective === 'string' ? d.objective : null;

  let weights: Weights;
  let currentMetadata: ScoreMetadata | null = null;
  let strategyDiagnostics: StrategyDiagnostics | null = null;
  let survivalDiagnostics: SurvivalDiagnostics | null = null;
  const zeroV3 = {
    cleanWellDepth: 0,
    tetrisSetupProgress: 0,
    tetrisReadyRows: 0,
  } as const;
  if (version === 1 && !objectiveDeclared) {
    const legacy = parseExactWeights(raw, LEGACY_FEATURE_NAMES);
    if (legacy === null) return null;
    weights = { ...legacy, lineClearValue: 0, ...zeroV3 } as Weights;
  } else if (version === 2 && objective === LEGACY_SCORE_RATE_OBJECTIVE) {
    const legacy = parseExactWeights(raw, LEGACY_FEATURE_NAMES);
    if (legacy === null) return null;
    weights = { ...legacy, lineClearValue: 0, ...zeroV3 } as Weights;
  } else if (version === 3 && objective === SCORE_RATE_V2_OBJECTIVE) {
    const v2 = parseExactWeights(raw, SCORE_RATE_V2_FEATURE_NAMES);
    if (v2 === null) return null;
    weights = { ...v2, ...zeroV3 } as Weights;
    currentMetadata = parseScoreMetadata(d);
    if (currentMetadata === null) return null;
  } else if (version === 4 && objective === SCORE_RATE_OBJECTIVE) {
    const current = parseExactWeights(raw, FEATURE_NAMES);
    if (current === null) return null;
    weights = current as Weights;
    currentMetadata = parseScoreMetadata(d);
    if (currentMetadata === null) return null;
    strategyDiagnostics = parseStrategyDiagnostics(d.strategyDiagnostics);
    survivalDiagnostics = parseSurvivalDiagnostics(d.survivalDiagnostics, currentMetadata.evalGames);
    if (strategyDiagnostics === null || survivalDiagnostics === null) return null;
  } else {
    return null;
  }

  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const nullableNum = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  return {
    version,
    weights,
    objective,
    meanScore: currentMetadata?.meanScore ?? nullableNum(d.meanScore),
    evalMaxPieces: currentMetadata?.evalMaxPieces ?? nullableNum(d.evalMaxPieces),
    meanLines: currentMetadata?.meanLines ?? num(d.meanLines, 0),
    meanHeight: currentMetadata?.meanHeight ?? num(d.meanHeight, 0),
    meanClearCounts: currentMetadata?.meanClearCounts ?? null,
    tetrisLineShare: currentMetadata?.tetrisLineShare ?? null,
    evalGames: currentMetadata?.evalGames ?? num(d.evalGames, 0),
    gen: currentMetadata?.gen ?? num(d.gen, 0),
    searchDepth: currentMetadata?.searchDepth ?? (d.searchDepth === 1 ? 1 : 2),
    trainedAt: currentMetadata?.trainedAt ?? (typeof d.trainedAt === 'string' ? d.trainedAt : ''),
    strategyDiagnostics,
    survivalDiagnostics,
  };
}

/** Dellacherie-style priors. Used until training produces something better. */
export const HANDCRAFTED_WEIGHTS: Weights = fromVector(
  normalize([-0.3, -0.6, -0.2, -0.1, 0.25, -0.35, -0.3, -0.4, -0.2, 0, 0, 0, 0]),
);

const trained = parseWeightsFile(trainedWeightsJson);

/** Bundled into the build so `dist` runs standalone with no network fetch. */
export const DEFAULT_WEIGHTS: Weights = trained ? trained.weights : HANDCRAFTED_WEIGHTS;
export const DEFAULT_WEIGHTS_META: WeightsFile | null = trained;
