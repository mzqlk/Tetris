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
import {
  totalLinesFromCounts,
  tetrisLineShare,
  type LineClearCounts,
} from '../src/ai/lineClears';
import type { TrainConfig } from './config';
import { nextMaxPieces } from './cem';
import {
  PUBLICATION_GAMES,
  PUBLICATION_MAX_PIECES,
  SCORE_RATE_OBJECTIVE,
} from './objective';
import { evaluateScoreReevaluation, type ReevaluationSummary } from './publication';

export interface ScoreRateBestEver {
  weights: number[];
  meanScore: number;
  scoreRate: number;
  meanLines: number;
  meanHeight: number;
  meanClearCounts: LineClearCounts;
  tetrisLineShare: number;
  gen: number;
  evalGames: number;
  evalMaxPieces: number;
}

export interface ScoreRateCheckpoint {
  version: 3;
  objective: typeof SCORE_RATE_OBJECTIVE;
  gen: number;
  mu: number[];
  sigma: number[];
  baseSeed: number;
  maxPieces: number;
  config: TrainConfig;
  bestEver: ScoreRateBestEver | null;
}

export interface RunPaths {
  outputDir: string;
  checkpoint: string;
  log: string;
}

export function resolveRunPaths(root: string, requested: string | null): RunPaths {
  const outputDir = resolve(root, requested ?? 'public/ai/score-rate-v2');
  return {
    outputDir,
    checkpoint: resolve(outputDir, 'checkpoint.json'),
    log: resolve(outputDir, 'training-log.jsonl'),
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

const LINE_CLEAR_COUNT_KEYS = ['singles', 'doubles', 'triples', 'tetrises'] as const;

function lineClearCounts(value: unknown, label: string): LineClearCounts {
  const raw = record(value, label);
  const keys = Object.keys(raw);
  if (
    keys.length !== LINE_CLEAR_COUNT_KEYS.length ||
    LINE_CLEAR_COUNT_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(raw, key))
  ) {
    throw new Error(
      `checkpoint ${label} must contain exactly singles/doubles/triples/tetrises`,
    );
  }
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
    throw new Error(`checkpoint bestEver.${label} is inconsistent with its diagnostics`);
  }
}

function trainConfig(value: unknown): TrainConfig {
  const raw = record(value, 'config');
  const depth = raw.depth;
  if (depth !== 1 && depth !== 2) {
    throw new Error('checkpoint config.depth must be 1 or 2');
  }

  const config: TrainConfig = {
    population: positiveInteger(raw.population, 'config.population'),
    eliteFrac: fraction(raw.eliteFrac, 'config.eliteFrac'),
    gamesPerCandidate: positiveInteger(raw.gamesPerCandidate, 'config.gamesPerCandidate'),
    depth,
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

function bestEver(value: unknown, config: TrainConfig): ScoreRateBestEver | null {
  if (value === null) return null;
  const raw = record(value, 'bestEver');
  const weights = normalizedVector(raw.weights, 'bestEver.weights');

  const result: ScoreRateBestEver = {
    weights,
    meanScore: finite(raw.meanScore, 'bestEver.meanScore'),
    scoreRate: finite(raw.scoreRate, 'bestEver.scoreRate'),
    meanLines: finite(raw.meanLines, 'bestEver.meanLines'),
    meanHeight: finite(raw.meanHeight, 'bestEver.meanHeight'),
    meanClearCounts: lineClearCounts(raw.meanClearCounts, 'bestEver.meanClearCounts'),
    tetrisLineShare: finite(raw.tetrisLineShare, 'bestEver.tetrisLineShare'),
    gen: integer(raw.gen, 'bestEver.gen'),
    evalGames: positiveInteger(raw.evalGames, 'bestEver.evalGames'),
    evalMaxPieces: positiveInteger(raw.evalMaxPieces, 'bestEver.evalMaxPieces'),
  };

  if (result.evalGames !== config.reevalGames || result.evalMaxPieces !== config.reevalMaxPieces) {
    throw new Error('checkpoint bestEver uses an incompatible fixed publication schedule');
  }
  assertClose(result.scoreRate, result.meanScore / result.evalMaxPieces, 'scoreRate');
  assertClose(
    result.meanLines,
    totalLinesFromCounts(result.meanClearCounts),
    'meanLines',
  );
  assertClose(
    result.tetrisLineShare,
    tetrisLineShare(result.meanClearCounts),
    'tetrisLineShare',
  );
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
  if (checkpoint.version !== 3) {
    throw new Error(`checkpoint schema ${String(checkpoint.version)} is incompatible with version 3`);
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

  return {
    version: 3,
    objective: SCORE_RATE_OBJECTIVE,
    gen,
    mu,
    sigma,
    baseSeed,
    maxPieces,
    config,
    bestEver: bestEver(checkpoint.bestEver, config),
  };
}

const GENERATION_KEYS = [
  'objective',
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
  'gamesPerCandidate',
  'elapsedMs',
] as const;

const REEVALUATION_KEYS = [
  'objective', 'kind', 'gen', 'ts', 'schedule', 'currentBest', 'candidate', 'comparison',
] as const;
const SCHEDULE_KEYS = [
  'games', 'maxPieces', 'depth', 'baseSeed', 'seedStrategy',
] as const;
const EVALUATION_KEYS = [
  'gen',
  'weights',
  'meanScore',
  'scoreRate',
  'meanLines',
  'meanHeight',
  'meanClearCounts',
  'tetrisLineShare',
] as const;
const COMPARISON_KEYS = [
  'scoreDelta',
  'scoreRateDelta',
  'relativeScoreDelta',
  'scoreTolerance',
  'heightDelta',
  'decision',
  'reason',
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
  line: number,
  label: string,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
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
): { gen: number; nextMaxPieces: number } {
  exactKeys(raw, GENERATION_KEYS, line, 'generation record');
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
  logVector(raw.mu, line, 'generation mu');
  logPositiveVector(raw.sigma, line, 'generation sigma');
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
    nextMaxPieces: nextMaxPieces(maxPieces, elitePieces, checkpoint.config.maxPiecesCap),
  };
}

interface ValidatedLoggedEvaluation extends ReevaluationSummary {
  gen: number;
  weights: number[];
}

function validateLoggedEvaluation(
  value: unknown,
  line: number,
  label: string,
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
  };
}

interface ValidatedReevaluation {
  gen: number;
  currentBest: ValidatedLoggedEvaluation;
  candidate: ValidatedLoggedEvaluation;
  shouldPublish: boolean;
}

function validateReevaluation(
  raw: Record<string, unknown>,
  line: number,
  checkpoint: ScoreRateCheckpoint,
): ValidatedReevaluation {
  exactKeys(raw, REEVALUATION_KEYS, line, 'reevaluation record');
  if (raw.kind !== 'reevaluation') throw logError(line, 'reevaluation kind is invalid');
  const gen = logInteger(raw.gen, line, 'reevaluation gen', 1);
  logInteger(raw.ts, line, 'reevaluation ts');

  const schedule = logRecord(raw.schedule, line, 'reevaluation schedule');
  exactKeys(schedule, SCHEDULE_KEYS, line, 'reevaluation schedule');
  const games = logInteger(schedule.games, line, 'reevaluation schedule.games', 1);
  const maxPieces = logInteger(schedule.maxPieces, line, 'reevaluation schedule.maxPieces', 1);
  const depth = schedule.depth;
  const baseSeed = logSafeInteger(schedule.baseSeed, line, 'reevaluation schedule.baseSeed');
  if (
    games !== checkpoint.config.reevalGames ||
    maxPieces !== checkpoint.config.reevalMaxPieces ||
    depth !== checkpoint.config.depth ||
    baseSeed !== checkpoint.baseSeed ||
    schedule.seedStrategy !== 'fixed-reevaluation-v1'
  ) {
    throw logError(line, 'reevaluation schedule disagrees with the checkpoint');
  }

  const currentBest = validateLoggedEvaluation(
    raw.currentBest, line, 'reevaluation currentBest', maxPieces,
  );
  const candidate = validateLoggedEvaluation(
    raw.candidate, line, 'reevaluation candidate', maxPieces,
  );
  if (candidate.gen !== gen || currentBest.gen > gen) {
    throw logError(line, 'reevaluation generation metadata is inconsistent');
  }

  const comparison = logRecord(raw.comparison, line, 'reevaluation comparison');
  exactKeys(comparison, COMPARISON_KEYS, line, 'reevaluation comparison');
  const decision = evaluateScoreReevaluation(candidate, currentBest);
  const scoreDelta = candidate.meanScore - currentBest.meanScore;
  const scale = Math.max(Math.abs(candidate.meanScore), Math.abs(currentBest.meanScore));
  assertLogClose(
    logFinite(comparison.scoreDelta, line, 'reevaluation comparison.scoreDelta'),
    scoreDelta,
    line,
    'reevaluation comparison.scoreDelta',
  );
  assertLogClose(
    logFinite(comparison.scoreRateDelta, line, 'reevaluation comparison.scoreRateDelta'),
    candidate.scoreRate - currentBest.scoreRate,
    line,
    'reevaluation comparison.scoreRateDelta',
  );
  assertLogClose(
    logFinite(comparison.relativeScoreDelta, line, 'reevaluation comparison.relativeScoreDelta'),
    scale === 0 ? 0 : scoreDelta / scale,
    line,
    'reevaluation comparison.relativeScoreDelta',
  );
  assertLogClose(
    logNonNegative(comparison.scoreTolerance, line, 'reevaluation comparison.scoreTolerance'),
    decision.scoreTolerance,
    line,
    'reevaluation comparison.scoreTolerance',
  );
  assertLogClose(
    logFinite(comparison.heightDelta, line, 'reevaluation comparison.heightDelta'),
    candidate.meanHeight - currentBest.meanHeight,
    line,
    'reevaluation comparison.heightDelta',
  );
  const expectedDecision = decision.shouldPublish ? 'publish' : 'keep-current';
  if (comparison.decision !== expectedDecision || comparison.reason !== decision.reason) {
    throw logError(line, 'reevaluation comparison decision is inconsistent');
  }
  return {
    gen,
    currentBest,
    candidate,
    shouldPublish: decision.shouldPublish,
  };
}

function sameVector(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameClearCounts(left: LineClearCounts, right: LineClearCounts): boolean {
  return LINE_CLEAR_COUNT_KEYS.every((key) => left[key] === right[key]);
}

function sameEvaluation(
  left: ValidatedLoggedEvaluation,
  right: ValidatedLoggedEvaluation | ScoreRateBestEver,
): boolean {
  return (
    left.gen === right.gen &&
    sameVector(left.weights, right.weights) &&
    left.meanScore === right.meanScore &&
    left.scoreRate === right.scoreRate &&
    left.meanLines === right.meanLines &&
    left.meanHeight === right.meanHeight &&
    sameClearCounts(left.meanClearCounts, right.meanClearCounts) &&
    left.tetrisLineShare === right.tetrisLineShare
  );
}

function toBestEver(
  evaluation: ValidatedLoggedEvaluation,
  checkpoint: ScoreRateCheckpoint,
): ScoreRateBestEver {
  return {
    ...evaluation,
    weights: evaluation.weights.slice(),
    meanClearCounts: { ...evaluation.meanClearCounts },
    evalGames: checkpoint.config.reevalGames,
    evalMaxPieces: checkpoint.config.reevalMaxPieces,
  };
}

function sameBestEver(left: ScoreRateBestEver, right: ScoreRateBestEver): boolean {
  return (
    sameEvaluation(left, right) &&
    left.evalGames === right.evalGames &&
    left.evalMaxPieces === right.evalMaxPieces
  );
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
  let replayedWinner: ScoreRateBestEver | null = null;

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
      if (replayedWinner === null) {
        if (reevaluation.currentBest.gen !== -1) {
          throw logError(line, 'first reevaluation currentBest must be the generation -1 baseline');
        }
      } else if (!sameEvaluation(reevaluation.currentBest, replayedWinner)) {
        throw logError(line, 'reevaluation currentBest does not match the prior winner');
      }
      const winner = reevaluation.shouldPublish
        ? reevaluation.candidate
        : reevaluation.currentBest;
      replayedWinner = toBestEver(winner, checkpoint);
      reevaluations.add(reevaluation.gen);
      return;
    }
    const generation = validateGeneration(raw, line, checkpoint, expectedMaxPieces);
    if (generation.gen !== generations.length) {
      throw logError(
        line,
        `generation history must be continuous from 0; expected ${generations.length}, got ${generation.gen}`,
      );
    }
    generations.push(generation.gen);
    expectedMaxPieces = generation.nextMaxPieces;
  });

  if (generations.length !== checkpoint.gen) {
    throw new Error(
      `training log generation count ${generations.length} is inconsistent with checkpoint.gen ${checkpoint.gen}`,
    );
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
  if (replayedWinner === null) {
    if (checkpoint.bestEver !== null) {
      throw new Error('checkpoint bestEver must be null when no reevaluation history exists');
    }
  } else if (
    checkpoint.bestEver === null ||
    !sameBestEver(replayedWinner, checkpoint.bestEver)
  ) {
    throw new Error('checkpoint bestEver does not match the final reevaluation winner');
  }
  return checkpoint;
}
