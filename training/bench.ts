import { readFileSync } from 'node:fs';
import { simulateGame } from '../src/ai/simulate';
import { hashSeed } from '../src/ai/rng';
import { parseWeightsFile, toVector, HANDCRAFTED_WEIGHTS } from '../src/ai/weights';

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
  console.log(`weights: ${path} (gen ${parsed.gen}, meanLines ${parsed.meanLines})`);
  return toVector(parsed.weights);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const args = parseArgs(process.argv.slice(2));
const weights = loadWeights(args.weights);
console.log(`games=${args.games} depth=${args.depth} maxPieces=${args.maxPieces}\n`);

const started = Date.now();
const lines: number[] = [];
let totalPieces = 0;
let capped = 0;

for (let i = 0; i < args.games; i++) {
  const result = simulateGame({
    weights,
    seed: hashSeed(args.seed, i),
    maxPieces: args.maxPieces,
    depth: args.depth,
  });
  lines.push(result.lines);
  totalPieces += result.pieces;
  if (result.reason === 'pieceCap') capped++;
  console.log(
    `  game ${String(i + 1).padStart(3)}  lines ${String(result.lines).padStart(7)}` +
    `  pieces ${String(result.pieces).padStart(7)}  ${result.reason}`,
  );
}

const elapsedMs = Date.now() - started;
const sorted = [...lines].sort((a, b) => a - b);
const mean = lines.reduce((s, x) => s + x, 0) / lines.length;

console.log(`
mean    ${mean.toFixed(1)}
median  ${quantile(sorted, 0.5).toFixed(1)}
min     ${sorted[0]}
max     ${sorted[sorted.length - 1]}
capped  ${capped}/${args.games} games hit the piece cap

throughput  ${Math.round(totalPieces / (elapsedMs / 1000))} pieces/sec (single core)
elapsed     ${(elapsedMs / 1000).toFixed(1)}s`);
