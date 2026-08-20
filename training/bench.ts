import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { simulateGame } from '../src/ai/simulate';
import { hashSeed } from '../src/ai/rng';
import { parseWeightsFile, toVector, HANDCRAFTED_WEIGHTS } from '../src/ai/weights';
import { SEARCH_METADATA, type SearchMetadata } from './objective';
import {
  formatLineClearCounts,
  formatSearchDiagnostics,
  summarizeBench,
  type Distribution,
} from './benchSummary';

export interface BenchArgs {
  weights: string | null;
  games: number;
  maxPieces: number;
  seed: number;
}

export interface BenchSimulationPlan {
  weights: number[];
  seeds: number[];
  maxPieces: number;
  searchMetadata: SearchMetadata;
}

export function parseBenchArgs(argv: string[]): BenchArgs {
  const args: BenchArgs = { weights: null, games: 10, maxPieces: 5000, seed: 1 };

  /**
   * A mistyped value has to fail loudly. Bare `Number(value)` yields NaN, every
   * loop bound compared against it is immediately false, and the run completes
   * "successfully" reporting `0/NaN games` with NaN throughput — silently wrong
   * numbers that go on to inform hyperparameter choices.
   */
  const num = (key: string, value: string): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`${key} expects a number, got "${value}"`);
    return n;
  };

  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`missing value for ${key}`);
    switch (key) {
      case '--weights': args.weights = value; break;
      case '--games': args.games = num(key, value); break;
      case '--max-pieces': args.maxPieces = num(key, value); break;
      case '--seed': args.seed = num(key, value); break;
      default: throw new Error(`unknown flag ${key}`);
    }
  }
  return args;
}

export function buildBenchPlan(
  weights: number[],
  args: BenchArgs,
): BenchSimulationPlan {
  return {
    weights,
    seeds: Array.from({ length: args.games }, (_, index) => hashSeed(args.seed, index)),
    maxPieces: args.maxPieces,
    searchMetadata: SEARCH_METADATA,
  };
}

function loadWeights(path: string | null): number[] {
  if (path === null) {
    console.log('weights: built-in handcrafted');
    return toVector(HANDCRAFTED_WEIGHTS);
  }
  const parsed = parseWeightsFile(JSON.parse(readFileSync(path, 'utf8')));
  if (parsed === null) throw new Error(`${path} is not a valid weights file`);
  const scoreLabel = parsed.meanScore === null ? 'unmeasured' : parsed.meanScore.toFixed(1);
  console.log(`weights: ${path} (gen ${parsed.gen}, meanScore ${scoreLabel})`);
  return toVector(parsed.weights);
}

async function main(): Promise<void> {
  const args = parseBenchArgs(process.argv.slice(2));
  const plan = buildBenchPlan(loadWeights(args.weights), args);
  console.log(
    `games=${plan.seeds.length}` +
    ` search=${plan.searchMetadata.searchContract}` +
    ` workBudget=${plan.searchMetadata.maxWorkUnits}` +
    ` maxPieces=${plan.maxPieces}\n`,
  );

  const started = Date.now();
  const results = [];

  for (let index = 0; index < plan.seeds.length; index++) {
    const result = simulateGame({
      weights: plan.weights,
      seed: plan.seeds[index],
      maxPieces: plan.maxPieces,
    });
    results.push(result);
    const scoreRate = result.score / plan.maxPieces;
    const survived = result.reason === 'pieceCap' ? 'survived=yes' : 'survived=no';
    console.log(
      `  game ${String(index + 1).padStart(3)}` +
      `  score ${String(result.score).padStart(10)}` +
      `  score/piece ${scoreRate.toFixed(3).padStart(9)}` +
      `  lines ${String(result.lines).padStart(6)}` +
      `  ${formatLineClearCounts(result.clearCounts)}` +
      `  height ${result.meanHeight.toFixed(2).padStart(6)}` +
      `  pieces ${String(result.pieces).padStart(6)}` +
      `  ${survived}  ${result.reason}`,
    );
  }

  const elapsedMs = Date.now() - started;
  const summary = summarizeBench(results, plan.maxPieces);
  const row = (label: string, values: Distribution, digits: number) =>
    `${label}\n` +
    `  mean    ${values.mean.toFixed(digits)}\n` +
    `  median  ${values.median.toFixed(digits)}\n` +
    `  min     ${values.min.toFixed(digits)}\n` +
    `  max     ${values.max.toFixed(digits)}`;

  console.log(`
${row('score', summary.score, 1)}

${row('score per scheduled piece', summary.scorePerScheduledPiece, 3)}

${row('lines', summary.lines, 1)}

${row('mean stack height (diagnostic)', summary.height, 2)}

${formatLineClearCounts(summary.clearCounts)}
tetris line share  ${(100 * summary.tetrisLineShare).toFixed(2)}%
mean clean well depth  ${summary.strategy.cleanWellDepth.mean.toFixed(2)}
mean tetris setup progress  ${summary.strategy.tetrisSetupProgress.mean.toFixed(2)}
mean tetris-ready rows  ${summary.strategy.tetrisReadyRows.mean.toFixed(2)}
tetrises/100 scheduled pieces  ${summary.tetrisesPer100ScheduledPieces.toFixed(3)}

search diagnostics
${formatSearchDiagnostics(summary.search)}

survival capped/gameover/total  ${summary.cappedGames}/${summary.gameoverGames}/${results.length}
throughput  ${Math.round(summary.totalPieces / (elapsedMs / 1000))} pieces/sec (single core)
elapsed     ${(elapsedMs / 1000).toFixed(1)}s`);
}

const isMain = process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await main();
