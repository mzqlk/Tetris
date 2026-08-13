import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  type BigIntStats,
} from 'node:fs';
import { resolve } from 'node:path';
import { FEATURE_COUNT } from '../src/ai/features';
import { toVector } from '../src/ai/weights';
import {
  totalLinesFromCounts,
  tetrisLineShare,
  type LineClearCounts,
} from '../src/ai/lineClears';
import type { StrategyDiagnostics, SurvivalDiagnostics } from '../src/ai/tetrisStrategy';
import type { TrainConfig } from './config';
import { parseCandidateWeights } from './candidateWeights';
import { nextMaxPieces } from './cem';
import {
  PUBLICATION_GAMES,
  PUBLICATION_MAX_PIECES,
  SCORE_RATE_OBJECTIVE,
  SEARCH_CONTRACT,
  SEARCH_SCHEMA_VERSION,
} from './objective';
import {
  evaluateTetrisCandidate,
  type CandidateQualification,
  type ReevaluationSummary,
} from './publication';

export interface ScoreRateEvaluation extends ReevaluationSummary {
  weights: number[];
  gen: number;
  evalGames: number;
  evalMaxPieces: number;
  searchDiagnostics?: import('../src/ai/weights').SearchDiagnostics;
}

export interface ScoreRateCheckpoint {
  version: 4 | 5;
  objective: typeof SCORE_RATE_OBJECTIVE;
  gen: number;
  mu: number[];
  sigma: number[];
  baseSeed: number;
  maxPieces: number;
  config: TrainConfig;
  publishedBaseline: ScoreRateEvaluation | null;
  bestQualifiedCandidate: ScoreRateEvaluation | null;
  searchContract?: typeof SEARCH_CONTRACT;
  searchDepth?: 4;
  rootBeamWidth?: 64;
  childBeamWidth?: 32;
}

export interface RunPaths {
  outputDir: string;
  checkpoint: string;
  log: string;
  candidate: string;
}

export function resolveRunPaths(root: string, requested: string | null): RunPaths {
  const outputDir = resolve(root, requested ?? 'public/ai/score-rate-v4');
  return {
    outputDir,
    checkpoint: resolve(outputDir, 'checkpoint.json'),
    log: resolve(outputDir, 'training-log.jsonl'),
    candidate: resolve(outputDir, 'candidate-weights.json'),
  };
}

export function assertFreshRun(paths: RunPaths): void {
  if (!existsSync(paths.outputDir)) return;
  if (!statSync(paths.outputDir).isDirectory()) {
    throw new Error(`refusing to start fresh run because output directory path is not a directory: ${paths.outputDir}`);
  }
  const entries = readdirSync(paths.outputDir);
  if (entries.length > 0) {
    throw new Error(
      `refusing to start fresh run in non-empty output directory ${paths.outputDir} ` +
      `(found ${entries.join(', ')}); use --resume or another --output-dir`,
    );
  }
}

function sameFileIdentity(
  left: BigIntStats,
  right: BigIntStats,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function readRegularArtifact(path: string, label: string): string {
  let before: BigIntStats;
  try {
    before = lstatSync(path, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`--resume but no regular ${label} at ${path}`);
    }
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(
      `${label} at ${path} must be a regular file, not a symbolic link or reparse point`,
    );
  }

  const descriptor = openSync(path, 'r');
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    const after = lstatSync(path, { bigint: true });
    if (
      !opened.isFile() ||
      !after.isFile() ||
      after.isSymbolicLink() ||
      !sameFileIdentity(opened, after)
    ) {
      throw new Error(`${label} at ${path} changed identity while it was opened`);
    }
    return readFileSync(descriptor, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`checkpoint ${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`checkpoint ${label} must be a finite number`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum?: number): number {
  const number = finite(value, label);
  if (!Number.isSafeInteger(number) || (minimum !== undefined && number < minimum)) {
    const domain = minimum === undefined ? 'an integer' : `an integer >= ${minimum}`;
    throw new Error(`checkpoint ${label} must be ${domain}`);
  }
  return number;
}

function positiveInteger(value: unknown, label: string): number {
  return integer(value, label, 1);
}

function vector(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length !== FEATURE_COUNT) {
    throw new Error(`checkpoint ${label} must contain exactly ${FEATURE_COUNT} numbers`);
  }
  return value.map((element, index) => {
    const number = finite(element, `${label}[${index}]`);
    return number;
  });
}

function normalizedVector(value: unknown, label: string): number[] {
  const result = vector(value, label);
  const norm = Math.hypot(...result);
  if (Math.abs(norm - 1) > 1e-9) {
    throw new Error(`checkpoint ${label} must be L2-normalized`);
  }
  return result;
}

function positiveVector(value: unknown, label: string): number[] {
  const result = vector(value, label);
  const invalidIndex = result.findIndex((number) => number <= 0);
  if (invalidIndex !== -1) {
    throw new Error(`checkpoint ${label}[${invalidIndex}] must be greater than 0`);
  }
  return result;
}

function fraction(value: unknown, label: string): number {
  const number = finite(value, label);
  if (number <= 0 || number > 1) {
    throw new Error(`checkpoint ${label} must be greater than 0 and at most 1`);
  }
  return number;
}

function nonNegative(value: unknown, label: string): number {
  const number = finite(value, label);
  if (number < 0) throw new Error(`checkpoint ${label} must be non-negative`);
  return number;
}

const CHECKPOINT_KEYS = [
  'version', 'objective', 'gen', 'mu', 'sigma', 'baseSeed', 'maxPieces', 'config',
  'publishedBaseline', 'bestQualifiedCandidate', 'searchContract', 'searchDepth',
  'rootBeamWidth', 'childBeamWidth',
] as const;
const CONFIG_KEYS = [
  'population', 'eliteFrac', 'gamesPerCandidate', 'searchDepth', 'rootBeamWidth', 'childBeamWidth', 'initialMaxPieces',
  'maxPiecesCap', 'initialNoise', 'noiseDecay', 'noiseFloor', 'baseSeed', 'workers',
  'reevalEvery', 'reevalGames', 'reevalMaxPieces',
] as const;
const LINE_CLEAR_COUNT_KEYS = ['singles', 'doubles', 'triples', 'tetrises'] as const;
const STRATEGY_KEYS = [
  'meanCleanWellDepth', 'meanTetrisSetupProgress', 'meanTetrisReadyRows',
] as const;
const SURVIVAL_KEYS = ['pieceCapGames', 'gameoverGames'] as const;
const SEARCH_DIAGNOSTICS_KEYS = [
  'holdActions', 'holdRate', 'meanCompletedDepth', 'minCompletedDepth',
  'expandedDecisionNodes', 'expandedChanceNodes', 'cacheHits', 'abortedSearches',
] as const;
const EVALUATION_KEYS = [
  'gen', 'weights', 'meanScore', 'scoreRate', 'meanLines', 'meanHeight',
  'meanClearCounts', 'tetrisLineShare', 'strategyDiagnostics', 'survivalDiagnostics',
  'searchDiagnostics',
] as const;

function lineClearCounts(value: unknown, label: string): LineClearCounts {
  const raw = record(value, label);
  exactKeys(raw, LINE_CLEAR_COUNT_KEYS, null, label);
  return {
    singles: nonNegative(raw.singles, `${label}.singles`),
    doubles: nonNegative(raw.doubles, `${label}.doubles`),
    triples: nonNegative(raw.triples, `${label}.triples`),
    tetrises: nonNegative(raw.tetrises, `${label}.tetrises`),
  };
}

function assertClose(actual: number, expected: number, label: string): void {
  const tolerance = 1e-12 * Math.max(1, Math.abs(expected));
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`checkpoint ${label} is inconsistent with its diagnostics`);
  }
}

function trainConfig(value: unknown): TrainConfig {
  const raw = record(value, 'config');
  exactKeys(raw, CONFIG_KEYS, null, 'config');
  if (raw.searchDepth !== 4 || raw.rootBeamWidth !== 64 || raw.childBeamWidth !== 32) {
    throw new Error('checkpoint search configuration must be 4/64/32');
  }

  const config: TrainConfig = {
    population: positiveInteger(raw.population, 'config.population'),
    eliteFrac: fraction(raw.eliteFrac, 'config.eliteFrac'),
    gamesPerCandidate: positiveInteger(raw.gamesPerCandidate, 'config.gamesPerCandidate'),
    searchDepth: 4,
    rootBeamWidth: 64,
    childBeamWidth: 32,
    initialMaxPieces: positiveInteger(raw.initialMaxPieces, 'config.initialMaxPieces'),
    maxPiecesCap: positiveInteger(raw.maxPiecesCap, 'config.maxPiecesCap'),
    initialNoise: nonNegative(raw.initialNoise, 'config.initialNoise'),
    noiseDecay: fraction(raw.noiseDecay, 'config.noiseDecay'),
    noiseFloor: nonNegative(raw.noiseFloor, 'config.noiseFloor'),
    baseSeed: integer(raw.baseSeed, 'config.baseSeed'),
    workers: positiveInteger(raw.workers, 'config.workers'),
    reevalEvery: positiveInteger(raw.reevalEvery, 'config.reevalEvery'),
    reevalGames: positiveInteger(raw.reevalGames, 'config.reevalGames'),
    reevalMaxPieces: positiveInteger(raw.reevalMaxPieces, 'config.reevalMaxPieces'),
  };

  if (config.maxPiecesCap < config.initialMaxPieces) {
    throw new Error('checkpoint config.maxPiecesCap must be >= config.initialMaxPieces');
  }
  if (config.reevalGames !== PUBLICATION_GAMES) {
    throw new Error(
      `checkpoint config.reevalGames ${config.reevalGames} is incompatible with fixed publication schedule ${PUBLICATION_GAMES}`,
    );
  }
  if (config.reevalMaxPieces !== PUBLICATION_MAX_PIECES) {
    throw new Error(
      `checkpoint config.reevalMaxPieces ${config.reevalMaxPieces} is incompatible with fixed publication schedule ${PUBLICATION_MAX_PIECES}`,
    );
  }
  return config;
}

function strategyDiagnostics(value: unknown, label: string): StrategyDiagnostics {
  const raw = record(value, label);
  exactKeys(raw, STRATEGY_KEYS, null, label);
  const result = {
    meanCleanWellDepth: nonNegative(raw.meanCleanWellDepth, `${label}.meanCleanWellDepth`),
    meanTetrisSetupProgress: nonNegative(
      raw.meanTetrisSetupProgress, `${label}.meanTetrisSetupProgress`,
    ),
    meanTetrisReadyRows: nonNegative(raw.meanTetrisReadyRows, `${label}.meanTetrisReadyRows`),
  };
  if (Object.values(result).some((entry) => entry > 4)) {
    throw new Error(`checkpoint ${label} values must be at most 4`);
  }
  return result;
}

function survivalDiagnostics(
  value: unknown,
  label: string,
  evalGames: number,
): SurvivalDiagnostics {
  const raw = record(value, label);
  exactKeys(raw, SURVIVAL_KEYS, null, label);
  const result = {
    pieceCapGames: integer(raw.pieceCapGames, `${label}.pieceCapGames`, 0),
    gameoverGames: integer(raw.gameoverGames, `${label}.gameoverGames`, 0),
  };
  if (
    result.pieceCapGames > evalGames ||
    result.gameoverGames > evalGames ||
    result.pieceCapGames + result.gameoverGames > evalGames
  ) {
    throw new Error(`checkpoint ${label} exceeds evalGames`);
  }
  return result;
}

const CHECKPOINT_EVALUATION_KEYS = [
  ...EVALUATION_KEYS, 'evalGames', 'evalMaxPieces',
] as const;

function searchDiagnostics(value: unknown, label: string) {
  const raw = record(value, label);
  exactKeys(raw, SEARCH_DIAGNOSTICS_KEYS, null, label);
  const result = {
    holdActions: nonNegative(raw.holdActions, `${label}.holdActions`),
    holdRate: nonNegative(raw.holdRate, `${label}.holdRate`),
    meanCompletedDepth: nonNegative(raw.meanCompletedDepth, `${label}.meanCompletedDepth`),
    minCompletedDepth: nonNegative(raw.minCompletedDepth, `${label}.minCompletedDepth`),
    expandedDecisionNodes: nonNegative(raw.expandedDecisionNodes, `${label}.expandedDecisionNodes`),
    expandedChanceNodes: nonNegative(raw.expandedChanceNodes, `${label}.expandedChanceNodes`),
    cacheHits: nonNegative(raw.cacheHits, `${label}.cacheHits`),
    abortedSearches: nonNegative(raw.abortedSearches, `${label}.abortedSearches`),
  };
  if (result.holdRate > 1 || result.meanCompletedDepth > 4 || result.minCompletedDepth > 4) {
    throw new Error(`checkpoint ${label} search diagnostics are out of range`);
  }
  return result;
}

function scoreRateEvaluation(
  value: unknown,
  label: string,
  config: TrainConfig,
): ScoreRateEvaluation | null {
  if (value === null) return null;
  const raw = record(value, label);
  exactKeys(raw, CHECKPOINT_EVALUATION_KEYS, null, label);
  const weights = normalizedVector(raw.weights, `${label}.weights`);
  const evalGames = positiveInteger(raw.evalGames, `${label}.evalGames`);
  const evalMaxPieces = positiveInteger(raw.evalMaxPieces, `${label}.evalMaxPieces`);

  const result: ScoreRateEvaluation = {
    weights,
    meanScore: nonNegative(raw.meanScore, `${label}.meanScore`),
    scoreRate: nonNegative(raw.scoreRate, `${label}.scoreRate`),
    meanLines: nonNegative(raw.meanLines, `${label}.meanLines`),
    meanHeight: nonNegative(raw.meanHeight, `${label}.meanHeight`),
    meanClearCounts: lineClearCounts(raw.meanClearCounts, `${label}.meanClearCounts`),
    tetrisLineShare: nonNegative(raw.tetrisLineShare, `${label}.tetrisLineShare`),
    strategyDiagnostics: strategyDiagnostics(raw.strategyDiagnostics, `${label}.strategyDiagnostics`),
    survivalDiagnostics: survivalDiagnostics(
      raw.survivalDiagnostics, `${label}.survivalDiagnostics`, evalGames,
    ),
    searchDiagnostics: searchDiagnostics(raw.searchDiagnostics, `${label}.searchDiagnostics`),
    gen: integer(raw.gen, `${label}.gen`, -1),
    evalGames,
    evalMaxPieces,
  };

  if (result.evalGames !== config.reevalGames || result.evalMaxPieces !== config.reevalMaxPieces) {
    throw new Error(`checkpoint ${label} uses an incompatible fixed publication schedule`);
  }
  assertClose(result.scoreRate, result.meanScore / result.evalMaxPieces, `${label}.scoreRate`);
  assertClose(
    result.meanLines,
    totalLinesFromCounts(result.meanClearCounts),
    `${label}.meanLines`,
  );
  assertClose(
    result.tetrisLineShare,
    tetrisLineShare(result.meanClearCounts),
    `${label}.tetrisLineShare`,
  );
  if (result.tetrisLineShare > 1) {
    throw new Error(`checkpoint ${label}.tetrisLineShare must be at most 1`);
  }
  return result;
}

export function readCompatibleCheckpoint(path: string): ScoreRateCheckpoint {
  const value: unknown = JSON.parse(readRegularArtifact(path, 'checkpoint'));
  if (typeof value !== 'object' || value === null) {
    throw new Error(`checkpoint at ${path} is not an object`);
  }
  const checkpoint = value as Record<string, unknown>;
  const objective = typeof checkpoint.objective === 'string'
    ? checkpoint.objective
    : 'missing';
  if (objective !== SCORE_RATE_OBJECTIVE) {
    throw new Error(`checkpoint objective ${objective} is incompatible with ${SCORE_RATE_OBJECTIVE}`);
  }
  if (checkpoint.version !== SEARCH_SCHEMA_VERSION) {
    throw new Error(`checkpoint schema ${String(checkpoint.version)} is incompatible with version 5`);
  }
  exactKeys(checkpoint, CHECKPOINT_KEYS, null, 'checkpoint');
  if (checkpoint.searchContract !== SEARCH_CONTRACT || checkpoint.searchDepth !== 4 || checkpoint.rootBeamWidth !== 64 || checkpoint.childBeamWidth !== 32) {
    throw new Error('checkpoint search metadata is incompatible with score-rate-v4');
  }

  const config = trainConfig(checkpoint.config);
  const gen = integer(checkpoint.gen, 'gen', 0);
  const mu = vector(checkpoint.mu, 'mu');
  const sigma = positiveVector(checkpoint.sigma, 'sigma');
  const baseSeed = integer(checkpoint.baseSeed, 'baseSeed');
  const maxPieces = positiveInteger(checkpoint.maxPieces, 'maxPieces');
  if (baseSeed !== config.baseSeed) {
    throw new Error('checkpoint baseSeed must match config.baseSeed');
  }
  if (maxPieces > config.maxPiecesCap) {
    throw new Error('checkpoint maxPieces must not exceed config.maxPiecesCap');
  }

  const publishedBaseline = scoreRateEvaluation(
    checkpoint.publishedBaseline, 'publishedBaseline', config,
  );
  const bestQualifiedCandidate = scoreRateEvaluation(
    checkpoint.bestQualifiedCandidate, 'bestQualifiedCandidate', config,
  );
  if (publishedBaseline !== null && publishedBaseline.gen !== -1) {
    throw new Error('checkpoint publishedBaseline generation must be -1');
  }
  if (bestQualifiedCandidate !== null && bestQualifiedCandidate.gen < 1) {
    throw new Error('checkpoint bestQualifiedCandidate generation must be >= 1');
  }
  if (bestQualifiedCandidate !== null && publishedBaseline === null) {
    throw new Error('checkpoint bestQualifiedCandidate requires a publishedBaseline');
  }

  return {
    version: 5,
    objective: SCORE_RATE_OBJECTIVE,
    gen,
    mu,
    sigma,
    baseSeed,
    maxPieces,
    config,
    publishedBaseline,
    bestQualifiedCandidate,
    searchContract: SEARCH_CONTRACT,
    searchDepth: 4,
    rootBeamWidth: 64,
    childBeamWidth: 32,
  };
}

const GENERATION_KEYS = [
  'objective',
  'searchContract',
  'searchDepth',
  'rootBeamWidth',
  'childBeamWidth',
  'gen',
  'ts',
  'bestScoreRate',
  'meanScoreRate',
  'medianScoreRate',
  'worstScoreRate',
  'scoreRateStd',
  'mu',
  'sigma',
  'bestWeights',
  'maxPieces',
  'medianPieces',
  'elitePieces',
  'medianScore',
  'eliteScore',
  'medianLines',
  'medianHeight',
  'eliteHeight',
  'bestTetrisLineShare',
  'medianTetrisLineShare',
  'eliteTetrisLineShare',
  'bestStrategyDiagnostics',
  'medianStrategyDiagnostics',
  'eliteStrategyDiagnostics',
  'gamesPerCandidate',
  'elapsedMs',
] as const;

const REEVALUATION_KEYS = [
  'objective', 'searchContract', 'searchDepth', 'rootBeamWidth', 'childBeamWidth',
  'kind', 'gen', 'ts', 'schedule', 'publishedBaseline', 'currentQualified',
  'candidate', 'qualification',
] as const;
const SCHEDULE_KEYS = [
  'games', 'maxPieces', 'searchContract', 'searchDepth', 'rootBeamWidth',
  'childBeamWidth', 'baseSeed', 'seedStrategy',
] as const;
const QUALIFICATION_KEYS = [
  'shouldSave', 'reason', 'scoreTolerance', 'scoreQualified', 'tetrisQualified',
  'survivalQualified', 'betterThanCurrent', 'scoreDelta', 'scoreRateDelta',
  'tetrisLineShareDelta', 'pieceCapGamesDelta', 'decision',
] as const;

function logError(line: number, message: string): Error {
  return new Error(`training log line ${line}: ${message}`);
}

function logRecord(value: unknown, line: number, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw logError(line, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  line: number | null,
  label: string,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    if (line === null) {
      throw new Error(`checkpoint ${label} does not match the required schema`);
    }
    throw logError(line, `${label} does not match the required schema`);
  }
}

function logFinite(value: unknown, line: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw logError(line, `${label} must be a finite number`);
  }
  return value;
}

function logNonNegative(value: unknown, line: number, label: string): number {
  const result = logFinite(value, line, label);
  if (result < 0) throw logError(line, `${label} must be non-negative`);
  return result;
}

function logSafeInteger(value: unknown, line: number, label: string): number {
  const result = logFinite(value, line, label);
  if (!Number.isSafeInteger(result)) {
    throw logError(line, `${label} must be a safe integer`);
  }
  return result;
}

function logInteger(value: unknown, line: number, label: string, minimum = 0): number {
  const result = logSafeInteger(value, line, label);
  if (result < minimum) throw logError(line, `${label} must be >= ${minimum}`);
  return result;
}

function logProportion(value: unknown, line: number, label: string): number {
  const result = logFinite(value, line, label);
  if (result < 0 || result > 1) {
    throw logError(line, `${label} must be between 0 and 1`);
  }
  return result;
}

function logBoolean(value: unknown, line: number, label: string): boolean {
  if (typeof value !== 'boolean') throw logError(line, `${label} must be a boolean`);
  return value;
}

function logVector(value: unknown, line: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== FEATURE_COUNT) {
    throw logError(line, `${label} must contain exactly ${FEATURE_COUNT} numbers`);
  }
  return value.map((element, index) => logFinite(element, line, `${label}[${index}]`));
}

function logPositiveVector(value: unknown, line: number, label: string): number[] {
  const result = logVector(value, line, label);
  if (result.some((element) => element <= 0)) {
    throw logError(line, `${label} must contain only positive numbers`);
  }
  return result;
}

function logNormalizedVector(value: unknown, line: number, label: string): number[] {
  const result = logVector(value, line, label);
  if (Math.abs(Math.hypot(...result) - 1) > 1e-9) {
    throw logError(line, `${label} must be L2-normalized`);
  }
  return result;
}

function logLineClearCounts(value: unknown, line: number, label: string): LineClearCounts {
  const raw = logRecord(value, line, label);
  exactKeys(raw, LINE_CLEAR_COUNT_KEYS, line, label);
  return {
    singles: logNonNegative(raw.singles, line, `${label}.singles`),
    doubles: logNonNegative(raw.doubles, line, `${label}.doubles`),
    triples: logNonNegative(raw.triples, line, `${label}.triples`),
    tetrises: logNonNegative(raw.tetrises, line, `${label}.tetrises`),
  };
}

function logStrategyDiagnostics(
  value: unknown,
  line: number,
  label: string,
): StrategyDiagnostics {
  const raw = logRecord(value, line, label);
  exactKeys(raw, STRATEGY_KEYS, line, label);
  const result = {
    meanCleanWellDepth: logNonNegative(
      raw.meanCleanWellDepth, line, `${label}.meanCleanWellDepth`,
    ),
    meanTetrisSetupProgress: logNonNegative(
      raw.meanTetrisSetupProgress, line, `${label}.meanTetrisSetupProgress`,
    ),
    meanTetrisReadyRows: logNonNegative(
      raw.meanTetrisReadyRows, line, `${label}.meanTetrisReadyRows`,
    ),
  };
  if (Object.values(result).some((entry) => entry > 4)) {
    throw logError(line, `${label} values must be at most 4`);
  }
  return result;
}

function logSurvivalDiagnostics(
  value: unknown,
  line: number,
  label: string,
  evalGames: number,
): SurvivalDiagnostics {
  const raw = logRecord(value, line, label);
  exactKeys(raw, SURVIVAL_KEYS, line, label);
  const result = {
    pieceCapGames: logInteger(raw.pieceCapGames, line, `${label}.pieceCapGames`),
    gameoverGames: logInteger(raw.gameoverGames, line, `${label}.gameoverGames`),
  };
  if (
    result.pieceCapGames > evalGames ||
    result.gameoverGames > evalGames ||
    result.pieceCapGames + result.gameoverGames > evalGames
  ) {
    throw logError(line, `${label} exceeds the reevaluation game count`);
  }
  return result;
}

function logSearchDiagnostics(
  value: unknown,
  line: number,
  label: string,
): NonNullable<ScoreRateEvaluation['searchDiagnostics']> {
  const raw = logRecord(value, line, label);
  exactKeys(raw, SEARCH_DIAGNOSTICS_KEYS, line, label);
  const result = {
    holdActions: logNonNegative(raw.holdActions, line, `${label}.holdActions`),
    holdRate: logProportion(raw.holdRate, line, `${label}.holdRate`),
    meanCompletedDepth: logNonNegative(
      raw.meanCompletedDepth, line, `${label}.meanCompletedDepth`,
    ),
    minCompletedDepth: logNonNegative(
      raw.minCompletedDepth, line, `${label}.minCompletedDepth`,
    ),
    expandedDecisionNodes: logNonNegative(
      raw.expandedDecisionNodes, line, `${label}.expandedDecisionNodes`,
    ),
    expandedChanceNodes: logNonNegative(
      raw.expandedChanceNodes, line, `${label}.expandedChanceNodes`,
    ),
    cacheHits: logNonNegative(raw.cacheHits, line, `${label}.cacheHits`),
    abortedSearches: logNonNegative(
      raw.abortedSearches, line, `${label}.abortedSearches`,
    ),
  };
  if (result.meanCompletedDepth > 4 || result.minCompletedDepth > 4) {
    throw logError(line, `${label} search diagnostics are out of range`);
  }
  return result;
}

function assertLogClose(
  actual: number,
  expected: number,
  line: number,
  label: string,
): void {
  const tolerance = 1e-12 * Math.max(1, Math.abs(expected));
  if (Math.abs(actual - expected) > tolerance) {
    throw logError(line, `${label} is inconsistent with its derived diagnostics`);
  }
}

function validateGeneration(
  raw: Record<string, unknown>,
  line: number,
  checkpoint: ScoreRateCheckpoint,
  expectedMaxPieces: number,
): { gen: number; mu: number[]; sigma: number[]; nextMaxPieces: number } {
  exactKeys(raw, GENERATION_KEYS, line, 'generation record');
  if (
    raw.searchContract !== SEARCH_CONTRACT ||
    raw.searchDepth !== 4 ||
    raw.rootBeamWidth !== 64 ||
    raw.childBeamWidth !== 32
  ) {
    throw logError(line, 'generation search contract must be bag-expectimax-hold-v1/4/64/32');
  }
  const gen = logInteger(raw.gen, line, 'generation gen');
  logInteger(raw.ts, line, 'generation ts');
  const bestScoreRate = logNonNegative(
    raw.bestScoreRate, line, 'generation bestScoreRate',
  );
  const meanScoreRate = logNonNegative(
    raw.meanScoreRate, line, 'generation meanScoreRate',
  );
  const medianScoreRate = logNonNegative(
    raw.medianScoreRate, line, 'generation medianScoreRate',
  );
  const worstScoreRate = logNonNegative(
    raw.worstScoreRate, line, 'generation worstScoreRate',
  );
  logNonNegative(raw.scoreRateStd, line, 'generation scoreRateStd');
  const mu = logVector(raw.mu, line, 'generation mu');
  const sigma = logPositiveVector(raw.sigma, line, 'generation sigma');
  logNormalizedVector(raw.bestWeights, line, 'generation bestWeights');
  const maxPieces = logInteger(raw.maxPieces, line, 'generation maxPieces', 1);
  if (maxPieces > checkpoint.config.maxPiecesCap) {
    throw logError(line, 'generation maxPieces exceeds checkpoint config.maxPiecesCap');
  }
  if (maxPieces !== expectedMaxPieces) {
    throw logError(
      line,
      `generation maxPieces ${maxPieces} disagrees with replayed schedule ${expectedMaxPieces}`,
    );
  }
  const medianPieces = logNonNegative(raw.medianPieces, line, 'generation medianPieces');
  const elitePieces = logNonNegative(raw.elitePieces, line, 'generation elitePieces');
  if (medianPieces > maxPieces || elitePieces > maxPieces) {
    throw logError(
      line,
      'generation medianPieces and elitePieces must not exceed maxPieces',
    );
  }
  const medianScore = logNonNegative(raw.medianScore, line, 'generation medianScore');
  logNonNegative(raw.eliteScore, line, 'generation eliteScore');
  logNonNegative(raw.medianLines, line, 'generation medianLines');
  logNonNegative(raw.medianHeight, line, 'generation medianHeight');
  logNonNegative(raw.eliteHeight, line, 'generation eliteHeight');
  logProportion(raw.bestTetrisLineShare, line, 'generation bestTetrisLineShare');
  logProportion(raw.medianTetrisLineShare, line, 'generation medianTetrisLineShare');
  logProportion(raw.eliteTetrisLineShare, line, 'generation eliteTetrisLineShare');
  logStrategyDiagnostics(
    raw.bestStrategyDiagnostics, line, 'generation best strategy diagnostics',
  );
  logStrategyDiagnostics(
    raw.medianStrategyDiagnostics, line, 'generation median strategy diagnostics',
  );
  logStrategyDiagnostics(
    raw.eliteStrategyDiagnostics, line, 'generation elite strategy diagnostics',
  );
  const games = logInteger(raw.gamesPerCandidate, line, 'generation gamesPerCandidate', 1);
  if (games !== checkpoint.config.gamesPerCandidate) {
    throw logError(line, 'generation gamesPerCandidate disagrees with checkpoint config');
  }
  logNonNegative(raw.elapsedMs, line, 'generation elapsedMs');
  assertLogClose(
    medianScoreRate,
    medianScore / maxPieces,
    line,
    'generation medianScoreRate',
  );
  if (
    bestScoreRate < meanScoreRate ||
    bestScoreRate < medianScoreRate ||
    meanScoreRate < worstScoreRate ||
    medianScoreRate < worstScoreRate
  ) {
    throw logError(
      line,
      'generation score-rate distribution must satisfy best >= mean/median >= worst',
    );
  }
  return {
    gen,
    mu,
    sigma,
    nextMaxPieces: nextMaxPieces(maxPieces, elitePieces, checkpoint.config.maxPiecesCap),
  };
}

type ValidatedLoggedEvaluation = ScoreRateEvaluation;

function validateLoggedEvaluation(
  value: unknown,
  line: number,
  label: string,
  evalGames: number,
  maxPieces: number,
): ValidatedLoggedEvaluation {
  const raw = logRecord(value, line, label);
  exactKeys(raw, EVALUATION_KEYS, line, label);
  const meanScore = logNonNegative(raw.meanScore, line, `${label}.meanScore`);
  const scoreRate = logNonNegative(raw.scoreRate, line, `${label}.scoreRate`);
  const meanLines = logNonNegative(raw.meanLines, line, `${label}.meanLines`);
  const meanClearCounts = logLineClearCounts(raw.meanClearCounts, line, `${label}.meanClearCounts`);
  const share = logProportion(raw.tetrisLineShare, line, `${label}.tetrisLineShare`);
  assertLogClose(scoreRate, meanScore / maxPieces, line, `${label}.scoreRate`);
  assertLogClose(meanLines, totalLinesFromCounts(meanClearCounts), line, `${label}.meanLines`);
  assertLogClose(share, tetrisLineShare(meanClearCounts), line, `${label}.tetrisLineShare`);
  const weights = logNormalizedVector(raw.weights, line, `${label}.weights`);
  const gen = logSafeInteger(raw.gen, line, `${label}.gen`);
  if (gen < -1) throw logError(line, `${label}.gen must be >= -1`);
  return {
    gen,
    weights,
    meanScore,
    scoreRate,
    meanLines,
    meanHeight: logNonNegative(raw.meanHeight, line, `${label}.meanHeight`),
    meanClearCounts,
    tetrisLineShare: share,
    strategyDiagnostics: logStrategyDiagnostics(
      raw.strategyDiagnostics, line, `${label}.strategyDiagnostics`,
    ),
    survivalDiagnostics: logSurvivalDiagnostics(
      raw.survivalDiagnostics, line, `${label}.survivalDiagnostics`, evalGames,
    ),
    searchDiagnostics: logSearchDiagnostics(
      raw.searchDiagnostics, line, `${label}.searchDiagnostics`,
    ),
    evalGames,
    evalMaxPieces: maxPieces,
  };
}

interface ValidatedReevaluation {
  gen: number;
  publishedBaseline: ValidatedLoggedEvaluation;
  currentQualified: ValidatedLoggedEvaluation | null;
  candidate: ValidatedLoggedEvaluation;
  qualification: CandidateQualification;
}

function validateReevaluation(
  raw: Record<string, unknown>,
  line: number,
  checkpoint: ScoreRateCheckpoint,
): ValidatedReevaluation {
  exactKeys(raw, REEVALUATION_KEYS, line, 'reevaluation record');
  if (
    raw.searchContract !== SEARCH_CONTRACT ||
    raw.searchDepth !== 4 ||
    raw.rootBeamWidth !== 64 ||
    raw.childBeamWidth !== 32
  ) {
    throw logError(line, 'reevaluation search contract must be bag-expectimax-hold-v1/4/64/32');
  }
  if (raw.kind !== 'reevaluation') throw logError(line, 'reevaluation kind is invalid');
  const gen = logInteger(raw.gen, line, 'reevaluation gen', 1);
  logInteger(raw.ts, line, 'reevaluation ts');

  const schedule = logRecord(raw.schedule, line, 'reevaluation schedule');
  exactKeys(schedule, SCHEDULE_KEYS, line, 'reevaluation schedule');
  const games = logInteger(schedule.games, line, 'reevaluation schedule.games', 1);
  const maxPieces = logInteger(schedule.maxPieces, line, 'reevaluation schedule.maxPieces', 1);
  const baseSeed = logSafeInteger(schedule.baseSeed, line, 'reevaluation schedule.baseSeed');
  if (
    games !== checkpoint.config.reevalGames ||
    maxPieces !== checkpoint.config.reevalMaxPieces ||
    schedule.searchContract !== SEARCH_CONTRACT ||
    schedule.searchDepth !== checkpoint.config.searchDepth ||
    schedule.rootBeamWidth !== checkpoint.config.rootBeamWidth ||
    schedule.childBeamWidth !== checkpoint.config.childBeamWidth ||
    baseSeed !== checkpoint.baseSeed ||
    schedule.seedStrategy !== 'fixed-reevaluation-v1'
  ) {
    throw logError(line, 'reevaluation schedule disagrees with the checkpoint');
  }

  const publishedBaseline = validateLoggedEvaluation(
    raw.publishedBaseline,
    line,
    'reevaluation publishedBaseline',
    games,
    maxPieces,
  );
  const currentQualified = raw.currentQualified === null
    ? null
    : validateLoggedEvaluation(
      raw.currentQualified,
      line,
      'reevaluation currentQualified',
      games,
      maxPieces,
    );
  const candidate = validateLoggedEvaluation(
    raw.candidate, line, 'reevaluation candidate', games, maxPieces,
  );
  if (
    candidate.gen !== gen ||
    publishedBaseline.gen !== -1 ||
    (currentQualified !== null && (currentQualified.gen < 1 || currentQualified.gen > gen))
  ) {
    throw logError(line, 'reevaluation generation metadata is inconsistent');
  }

  const qualification = logRecord(raw.qualification, line, 'reevaluation qualification');
  exactKeys(qualification, QUALIFICATION_KEYS, line, 'reevaluation qualification');
  const expected = evaluateTetrisCandidate(candidate, publishedBaseline, currentQualified);
  const parsed: CandidateQualification = {
    shouldSave: logBoolean(
      qualification.shouldSave, line, 'reevaluation qualification.shouldSave',
    ),
    reason: qualification.reason as CandidateQualification['reason'],
    scoreTolerance: logNonNegative(
      qualification.scoreTolerance, line, 'reevaluation qualification.scoreTolerance',
    ),
    scoreQualified: logBoolean(
      qualification.scoreQualified, line, 'reevaluation qualification.scoreQualified',
    ),
    tetrisQualified: logBoolean(
      qualification.tetrisQualified, line, 'reevaluation qualification.tetrisQualified',
    ),
    survivalQualified: logBoolean(
      qualification.survivalQualified, line, 'reevaluation qualification.survivalQualified',
    ),
    betterThanCurrent: logBoolean(
      qualification.betterThanCurrent, line, 'reevaluation qualification.betterThanCurrent',
    ),
  };
  for (const key of [
    'shouldSave', 'reason', 'scoreQualified', 'tetrisQualified',
    'survivalQualified', 'betterThanCurrent',
  ] as const) {
    if (parsed[key] !== expected[key]) {
      throw logError(line, `reevaluation qualification.${key} is inconsistent`);
    }
  }
  assertLogClose(
    parsed.scoreTolerance,
    expected.scoreTolerance,
    line,
    'reevaluation qualification.scoreTolerance',
  );
  assertLogClose(
    logFinite(qualification.scoreDelta, line, 'reevaluation qualification.scoreDelta'),
    candidate.meanScore - publishedBaseline.meanScore,
    line,
    'reevaluation qualification.scoreDelta',
  );
  assertLogClose(
    logFinite(
      qualification.scoreRateDelta, line, 'reevaluation qualification.scoreRateDelta',
    ),
    candidate.scoreRate - publishedBaseline.scoreRate,
    line,
    'reevaluation qualification.scoreRateDelta',
  );
  assertLogClose(
    logFinite(
      qualification.tetrisLineShareDelta,
      line,
      'reevaluation qualification.tetrisLineShareDelta',
    ),
    candidate.tetrisLineShare - publishedBaseline.tetrisLineShare,
    line,
    'reevaluation qualification.tetrisLineShareDelta',
  );
  assertLogClose(
    logFinite(
      qualification.pieceCapGamesDelta,
      line,
      'reevaluation qualification.pieceCapGamesDelta',
    ),
    candidate.survivalDiagnostics.pieceCapGames -
      publishedBaseline.survivalDiagnostics.pieceCapGames,
    line,
    'reevaluation qualification.pieceCapGamesDelta',
  );
  const expectedDecision = expected.shouldSave ? 'save-candidate' : 'keep-current';
  if (qualification.decision !== expectedDecision) {
    throw logError(line, 'reevaluation qualification.decision is inconsistent');
  }
  return {
    gen,
    publishedBaseline,
    currentQualified,
    candidate,
    qualification: parsed,
  };
}

function sameVector(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameClearCounts(left: LineClearCounts, right: LineClearCounts): boolean {
  return LINE_CLEAR_COUNT_KEYS.every((key) => left[key] === right[key]);
}

function sameStrategyDiagnostics(
  left: StrategyDiagnostics,
  right: StrategyDiagnostics,
): boolean {
  return STRATEGY_KEYS.every((key) => left[key] === right[key]);
}

function sameSurvivalDiagnostics(
  left: SurvivalDiagnostics,
  right: SurvivalDiagnostics,
): boolean {
  return SURVIVAL_KEYS.every((key) => left[key] === right[key]);
}

function sameSearchDiagnostics(
  left: NonNullable<ScoreRateEvaluation['searchDiagnostics']>,
  right: NonNullable<ScoreRateEvaluation['searchDiagnostics']>,
): boolean {
  return SEARCH_DIAGNOSTICS_KEYS.every((key) => left[key] === right[key]);
}

function sameEvaluation(
  left: ScoreRateEvaluation,
  right: ScoreRateEvaluation,
): boolean {
  return (
    left.gen === right.gen &&
    sameVector(left.weights, right.weights) &&
    left.meanScore === right.meanScore &&
    left.scoreRate === right.scoreRate &&
    left.meanLines === right.meanLines &&
    left.meanHeight === right.meanHeight &&
    sameClearCounts(left.meanClearCounts, right.meanClearCounts) &&
    left.tetrisLineShare === right.tetrisLineShare &&
    sameStrategyDiagnostics(left.strategyDiagnostics, right.strategyDiagnostics) &&
    sameSurvivalDiagnostics(left.survivalDiagnostics, right.survivalDiagnostics) &&
    left.searchDiagnostics !== undefined &&
    right.searchDiagnostics !== undefined &&
    sameSearchDiagnostics(left.searchDiagnostics, right.searchDiagnostics) &&
    left.evalGames === right.evalGames &&
    left.evalMaxPieces === right.evalMaxPieces
  );
}

function cloneEvaluation(evaluation: ScoreRateEvaluation): ScoreRateEvaluation {
  return {
    ...evaluation,
    weights: evaluation.weights.slice(),
    meanClearCounts: { ...evaluation.meanClearCounts },
    strategyDiagnostics: { ...evaluation.strategyDiagnostics },
    survivalDiagnostics: { ...evaluation.survivalDiagnostics },
    searchDiagnostics: evaluation.searchDiagnostics === undefined
      ? (() => { throw new Error('evaluation search diagnostics are required'); })()
      : { ...evaluation.searchDiagnostics },
  };
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function readCandidateEvaluation(
  path: string,
  checkpoint: ScoreRateCheckpoint,
): ScoreRateEvaluation {
  let value: unknown;
  try {
    value = JSON.parse(readRegularArtifact(path, 'candidate weights'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`candidate weights at ${path} contain invalid JSON`);
    }
    throw error;
  }
  const parsed = parseCandidateWeights(value);
  if (parsed === null) {
    throw new Error('candidate weights must match the exact score-rate-v4 version 5 schema');
  }
  if (parsed.searchDepth !== checkpoint.config.searchDepth) {
    throw new Error('candidate weights searchDepth disagrees with checkpoint config');
  }
  return {
    weights: toVector(parsed.weights),
    meanScore: parsed.meanScore,
    scoreRate: parsed.meanScore / parsed.evalMaxPieces,
    meanLines: parsed.meanLines,
    meanHeight: parsed.meanHeight,
    meanClearCounts: { ...parsed.meanClearCounts },
    tetrisLineShare: parsed.tetrisLineShare,
    strategyDiagnostics: { ...parsed.strategyDiagnostics },
    survivalDiagnostics: { ...parsed.survivalDiagnostics },
    searchDiagnostics: { ...parsed.searchDiagnostics },
    evalGames: parsed.evalGames,
    evalMaxPieces: parsed.evalMaxPieces,
    gen: parsed.gen,
  };
}

export function readCompatibleRunArtifacts(paths: RunPaths): ScoreRateCheckpoint {
  const checkpoint = readCompatibleCheckpoint(paths.checkpoint);
  const text = readRegularArtifact(paths.log, 'training log');
  if (text.length === 0) {
    throw new Error(`training log at ${paths.log} is empty and cannot establish resume history`);
  }
  if (text.length > 0 && !text.endsWith('\n')) {
    throw new Error(`training log at ${paths.log} has a truncated final line`);
  }
  const lines = text.length === 0 ? [] : text.slice(0, -1).split('\n');
  const generations: number[] = [];
  const reevaluations = new Set<number>();
  let expectedMaxPieces = checkpoint.config.initialMaxPieces;
  let replayedBaseline: ScoreRateEvaluation | null = null;
  let replayedQualified: ScoreRateEvaluation | null = null;
  const optimizerStates: { mu: number[]; sigma: number[] }[] = [];

  lines.forEach((source, index) => {
    const line = index + 1;
    if (source.trim() === '') throw logError(line, 'blank JSONL records are not allowed');
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      throw logError(line, 'contains invalid JSON');
    }
    const raw = logRecord(value, line, 'record');
    if (raw.objective !== SCORE_RATE_OBJECTIVE) {
      throw logError(
        line,
        `objective ${String(raw.objective)} is incompatible with ${SCORE_RATE_OBJECTIVE}`,
      );
    }
    if (raw.kind === 'reevaluation') {
      const reevaluation = validateReevaluation(raw, line, checkpoint);
      if (generations.length !== reevaluation.gen || reevaluations.has(reevaluation.gen)) {
        throw logError(
          line,
          `reevaluation generation ${reevaluation.gen} is missing history or duplicated`,
        );
      }
      if (replayedBaseline === null) {
        replayedBaseline = cloneEvaluation(reevaluation.publishedBaseline);
      } else if (!sameEvaluation(reevaluation.publishedBaseline, replayedBaseline)) {
        throw logError(line, 'reevaluation publishedBaseline changed after it was established');
      }
      if (
        (replayedQualified === null && reevaluation.currentQualified !== null) ||
        (replayedQualified !== null && (
          reevaluation.currentQualified === null ||
          !sameEvaluation(reevaluation.currentQualified, replayedQualified)
        ))
      ) {
        throw logError(
          line,
          'reevaluation currentQualified does not match the replayed qualified candidate',
        );
      }
      if (reevaluation.qualification.shouldSave) {
        replayedQualified = cloneEvaluation(reevaluation.candidate);
      }
      reevaluations.add(reevaluation.gen);
      return;
    }
    if (raw.gen !== generations.length) {
      throw logError(
        line,
        `generation history must be continuous from 0; expected ${generations.length}, got ${String(raw.gen)}`,
      );
    }
    const generation = validateGeneration(raw, line, checkpoint, expectedMaxPieces);
    generations.push(generation.gen);
    expectedMaxPieces = generation.nextMaxPieces;
    optimizerStates.push({ mu: generation.mu, sigma: generation.sigma });
  });

  if (generations.length !== checkpoint.gen) {
    throw new Error(
      `training log generation count ${generations.length} is inconsistent with checkpoint.gen ${checkpoint.gen}`,
    );
  }
  const finalOptimizerState = optimizerStates.at(-1);
  if (finalOptimizerState !== undefined) {
    if (!sameVector(finalOptimizerState.mu, checkpoint.mu)) {
      throw new Error('checkpoint mu does not match the final logged optimizer state');
    }
    if (!sameVector(finalOptimizerState.sigma, checkpoint.sigma)) {
      throw new Error('checkpoint sigma does not match the final logged optimizer state');
    }
  }
  for (
    let gen = checkpoint.config.reevalEvery;
    gen <= checkpoint.gen;
    gen += checkpoint.config.reevalEvery
  ) {
    if (!reevaluations.has(gen)) {
      throw new Error(`training log is missing reevaluation history for generation ${gen}`);
    }
  }
  if ([...reevaluations].some((gen) => gen % checkpoint.config.reevalEvery !== 0)) {
    throw new Error('training log contains a reevaluation outside the configured interval');
  }
  if (expectedMaxPieces !== checkpoint.maxPieces) {
    throw new Error(
      `checkpoint maxPieces ${checkpoint.maxPieces} disagrees with replayed schedule ${expectedMaxPieces}`,
    );
  }
  if (
    (replayedBaseline === null && checkpoint.publishedBaseline !== null) ||
    (replayedBaseline !== null && (
      checkpoint.publishedBaseline === null ||
      !sameEvaluation(replayedBaseline, checkpoint.publishedBaseline)
    ))
  ) {
    throw new Error('checkpoint publishedBaseline does not match reevaluation replay');
  }
  if (
    (replayedQualified === null && checkpoint.bestQualifiedCandidate !== null) ||
    (replayedQualified !== null && (
      checkpoint.bestQualifiedCandidate === null ||
      !sameEvaluation(replayedQualified, checkpoint.bestQualifiedCandidate)
    ))
  ) {
    throw new Error('checkpoint bestQualifiedCandidate does not match reevaluation replay');
  }
  const candidateExists = pathEntryExists(paths.candidate);
  const candidateRequired = checkpoint.bestQualifiedCandidate !== null;
  if (candidateExists !== candidateRequired) {
    if (!candidateRequired) {
      throw new Error('candidate weights file is forbidden without a qualified candidate');
    }
    throw new Error('candidate weights file is required for a qualified candidate');
  }
  if (candidateExists && checkpoint.bestQualifiedCandidate !== null) {
    const candidate = readCandidateEvaluation(paths.candidate, checkpoint);
    if (!sameEvaluation(candidate, checkpoint.bestQualifiedCandidate)) {
      throw new Error('candidate weights file does not match bestQualifiedCandidate');
    }
  }
  return checkpoint;
}
