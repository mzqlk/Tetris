import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { hashSeed } from '../src/ai/rng';
import { FIXED_SEARCH_LIMITS } from '../src/ai/search';
import { simulateGame } from '../src/ai/simulate';
import { tetrisLineShare } from '../src/ai/lineClears';
import { parseWeightsFile, toVector, type WeightsFile } from '../src/ai/weights';
import { parseCandidateWeights } from './candidateWeights';
import {
  evaluatePairedAcceptance,
  type PairedGameResult,
} from './pairedStats';

const GAMES = 30;
const MAX_PIECES = 5000;

export interface PairedSimulationPlan {
  seeds: number[];
  baseline: { weights: number[]; search: typeof FIXED_SEARCH_LIMITS };
  candidate: { weights: number[]; search: typeof FIXED_SEARCH_LIMITS };
  maxPieces: 5000;
}

interface PairedBenchArgs {
  baseline: string;
  candidate: string;
  seed: number;
}

export function parsePairedBenchArgs(argv: string[]): PairedBenchArgs {
  let baseline: string | undefined;
  let candidate: string | undefined;
  let seed: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];

    switch (flag) {
      case '--baseline': {
        if (baseline !== undefined) throw new Error('duplicate --baseline');
        const value = requireArgValue(argv, index, flag);
        baseline = value;
        index += 1;
        break;
      }
      case '--candidate': {
        if (candidate !== undefined) throw new Error('duplicate --candidate');
        const value = requireArgValue(argv, index, flag);
        candidate = value;
        index += 1;
        break;
      }
      case '--seed': {
        if (seed !== undefined) throw new Error('duplicate --seed');
        const value = requireArgValue(argv, index, flag);
        if (!/^[+-]?\d+$/.test(value)) {
          throw new Error(`--seed expects integer text, got "${value}"`);
        }
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) {
          throw new Error(`--seed expects a safe integer, got "${value}"`);
        }
        seed = parsed;
        index += 1;
        break;
      }
      default:
        throw new Error(`unknown flag ${flag}`);
    }
  }

  if (baseline === undefined) throw new Error('missing required --baseline');
  if (candidate === undefined) throw new Error('missing required --candidate');
  if (seed === undefined) throw new Error('missing required --seed');
  return { baseline, candidate, seed };
}

function requireArgValue(argv: string[], flagIndex: number, flag: string): string {
  const value = argv[flagIndex + 1];
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function readWeightsFile(filePath: string, label: string): WeightsFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(`${label} weights file could not be read and parsed`);
  }
  const parsed = parseWeightsFile(raw);
  if (parsed === null) throw new Error(`${label} weights file is invalid`);
  return parsed;
}

function requireMetadata(
  weights: WeightsFile,
  label: string,
  expected: { version: number; objective: string; gen?: number },
): void {
  if (
    weights.version !== expected.version ||
    weights.objective !== expected.objective ||
    (expected.gen !== undefined && weights.gen !== expected.gen)
  ) {
    const generation = expected.gen === undefined ? '' : ` gen ${expected.gen}`;
    throw new Error(`${label} must be version ${expected.version} ${expected.objective}${generation}`);
  }
}

export function buildPairedPlan(
  baseline: WeightsFile,
  candidate: WeightsFile,
  seed: number,
): PairedSimulationPlan {
  requireMetadata(baseline, 'baseline', {
    version: 3,
    objective: 'score-rate-v2',
    gen: 40,
  });
  if (parseCandidateWeights(candidate) === null) {
    throw new Error('candidate must match the exact version 5 score-rate-v4 search contract 4/64/32');
  }
  return {
    seeds: Array.from({ length: GAMES }, (_, gameIndex) => hashSeed(seed, gameIndex)),
    baseline: { weights: toVector(baseline.weights), search: FIXED_SEARCH_LIMITS },
    candidate: { weights: toVector(candidate.weights), search: FIXED_SEARCH_LIMITS },
    maxPieces: MAX_PIECES,
  };
}

function toPairedGame(result: ReturnType<typeof simulateGame>): PairedGameResult {
  return {
    score: result.score,
    reason: result.reason,
    clearCounts: result.clearCounts,
  };
}

function formatDelta(value: number, digits: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

async function main(): Promise<void> {
  const args = parsePairedBenchArgs(process.argv.slice(2));
  const baselineWeights = readWeightsFile(args.baseline, 'baseline');
  const candidateWeights = readWeightsFile(args.candidate, 'candidate');
  const plan = buildPairedPlan(baselineWeights, candidateWeights, args.seed);

  const baselineGames: PairedGameResult[] = [];
  const candidateGames: PairedGameResult[] = [];

  for (let gameIndex = 0; gameIndex < plan.seeds.length; gameIndex += 1) {
    const seed = plan.seeds[gameIndex];
    const baseline = toPairedGame(simulateGame({
      weights: plan.baseline.weights,
      seed,
      maxPieces: plan.maxPieces,
      search: plan.baseline.search,
    }));
    const candidate = toPairedGame(simulateGame({
      weights: plan.candidate.weights,
      seed,
      maxPieces: plan.maxPieces,
      search: plan.candidate.search,
    }));
    baselineGames.push(baseline);
    candidateGames.push(candidate);

    const scoreRateDelta = (candidate.score - baseline.score) / plan.maxPieces;
    const tetrisShareDelta = tetrisLineShare(candidate.clearCounts) -
      tetrisLineShare(baseline.clearCounts);
    console.log(
      `game ${String(gameIndex + 1).padStart(2, '0')}` +
      ` score-rate delta ${formatDelta(scoreRateDelta, 3)}` +
      ` tetris-share delta ${formatDelta(tetrisShareDelta, 6)}`,
    );
  }

  console.log(JSON.stringify(
    evaluatePairedAcceptance(baselineGames, candidateGames, plan.maxPieces),
  ));
}

const isMain = process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await main();
