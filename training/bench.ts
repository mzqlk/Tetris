import { readFileSync } from 'node:fs';
import { simulateGame } from '../src/ai/simulate';
import { hashSeed } from '../src/ai/rng';
import { parseWeightsFile, toVector, HANDCRAFTED_WEIGHTS } from '../src/ai/weights';
import { summarizeBench, type Distribution } from './benchSummary';

interface Args {
  weights: string | null;
  games: number;
  depth: 1 | 2;
  maxPieces: number;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { weights: null, games: 10, depth: 2, maxPieces: 5000, seed: 1 };

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
      case '--depth': {
        // Coercing anything non-1 to 2 would silently swallow `--depth 3`.
        const depth = num(key, value);
        if (depth !== 1 && depth !== 2) throw new Error(`--depth must be 1 or 2, got ${depth}`);
        args.depth = depth;
        break;
      }
      case '--max-pieces': args.maxPieces = num(key, value); break;
      case '--seed': args.seed = num(key, value); break;
      default: throw new Error(`unknown flag ${key}`);
    }
  }
  return args;
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

const args = parseArgs(process.argv.slice(2));
const weights = loadWeights(args.weights);
console.log(`games=${args.games} depth=${args.depth} maxPieces=${args.maxPieces}\n`);

const started = Date.now();
const results = [];

for (let i = 0; i < args.games; i++) {
  const result = simulateGame({
    weights,
    seed: hashSeed(args.seed, i),
    maxPieces: args.maxPieces,
    depth: args.depth,
  });
  results.push(result);
  const scoreRate = result.score / args.maxPieces;
  const survived = result.reason === 'pieceCap' ? 'survived=yes' : 'survived=no';
  console.log(
    `  game ${String(i + 1).padStart(3)}` +
    `  score ${String(result.score).padStart(10)}` +
    `  score/piece ${scoreRate.toFixed(3).padStart(9)}` +
    `  lines ${String(result.lines).padStart(6)}` +
    `  height ${result.meanHeight.toFixed(2).padStart(6)}` +
    `  pieces ${String(result.pieces).padStart(6)}` +
    `  ${survived}  ${result.reason}`,
  );
}

const elapsedMs = Date.now() - started;
const summary = summarizeBench(results, args.maxPieces);
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

survival  ${summary.cappedGames}/${args.games} games hit the piece cap
throughput  ${Math.round(summary.totalPieces / (elapsedMs / 1000))} pieces/sec (single core)
elapsed     ${(elapsedMs / 1000).toFixed(1)}s`);
