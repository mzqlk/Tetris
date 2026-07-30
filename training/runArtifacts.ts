import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { FEATURE_COUNT } from '../src/ai/features';
import type { TrainConfig } from './config';
import {
  PUBLICATION_GAMES,
  PUBLICATION_MAX_PIECES,
  SCORE_RATE_OBJECTIVE,
} from './objective';

export interface ScoreRateBestEver {
  weights: number[];
  meanScore: number;
  scoreRate: number;
  meanLines: number;
  meanHeight: number;
  gen: number;
  evalGames: number;
  evalMaxPieces: number;
}

export interface ScoreRateCheckpoint {
  version: 2;
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
  const outputDir = resolve(root, requested ?? 'public/ai/score-rate-v1');
  return {
    outputDir,
    checkpoint: resolve(outputDir, 'checkpoint.json'),
    log: resolve(outputDir, 'training-log.jsonl'),
  };
}

export function assertFreshRun(paths: RunPaths): void {
  if (existsSync(paths.checkpoint)) {
    throw new Error(`refusing to overwrite existing checkpoint at ${paths.checkpoint}; use --resume or another --output-dir`);
  }
  if (existsSync(paths.log) && statSync(paths.log).size > 0) {
    throw new Error(`refusing to append to existing training-log at ${paths.log}; use --resume or another --output-dir`);
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

function vector(value: unknown, label: string, nonNegative = false): number[] {
  if (!Array.isArray(value) || value.length !== FEATURE_COUNT) {
    throw new Error(`checkpoint ${label} must contain exactly ${FEATURE_COUNT} numbers`);
  }
  return value.map((element, index) => {
    const number = finite(element, `${label}[${index}]`);
    if (nonNegative && number < 0) {
      throw new Error(`checkpoint ${label}[${index}] must be non-negative`);
    }
    return number;
  });
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
  const weights = vector(raw.weights, 'bestEver.weights');
  const norm = Math.hypot(...weights);
  if (Math.abs(norm - 1) > 1e-9) {
    throw new Error('checkpoint bestEver.weights must be L2-normalized');
  }

  const result: ScoreRateBestEver = {
    weights,
    meanScore: finite(raw.meanScore, 'bestEver.meanScore'),
    scoreRate: finite(raw.scoreRate, 'bestEver.scoreRate'),
    meanLines: finite(raw.meanLines, 'bestEver.meanLines'),
    meanHeight: finite(raw.meanHeight, 'bestEver.meanHeight'),
    gen: integer(raw.gen, 'bestEver.gen'),
    evalGames: positiveInteger(raw.evalGames, 'bestEver.evalGames'),
    evalMaxPieces: positiveInteger(raw.evalMaxPieces, 'bestEver.evalMaxPieces'),
  };

  if (result.evalGames !== config.reevalGames || result.evalMaxPieces !== config.reevalMaxPieces) {
    throw new Error('checkpoint bestEver uses an incompatible fixed publication schedule');
  }
  const expectedRate = result.meanScore / result.evalMaxPieces;
  const rateError = Math.abs(result.scoreRate - expectedRate);
  if (rateError > 1e-12 * Math.max(1, Math.abs(expectedRate))) {
    throw new Error('checkpoint bestEver.scoreRate is inconsistent with meanScore/evalMaxPieces');
  }
  return result;
}

export function readCompatibleCheckpoint(path: string): ScoreRateCheckpoint {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
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
  if (checkpoint.version !== 2) {
    throw new Error(`checkpoint schema ${String(checkpoint.version)} is incompatible with version 2`);
  }

  const config = trainConfig(checkpoint.config);
  const gen = integer(checkpoint.gen, 'gen', 0);
  const mu = vector(checkpoint.mu, 'mu');
  const sigma = vector(checkpoint.sigma, 'sigma', true);
  const baseSeed = integer(checkpoint.baseSeed, 'baseSeed');
  const maxPieces = positiveInteger(checkpoint.maxPieces, 'maxPieces');
  if (baseSeed !== config.baseSeed) {
    throw new Error('checkpoint baseSeed must match config.baseSeed');
  }
  if (maxPieces > config.maxPiecesCap) {
    throw new Error('checkpoint maxPieces must not exceed config.maxPiecesCap');
  }

  return {
    version: 2,
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
