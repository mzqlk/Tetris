import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG, type TrainConfig } from './config';
import { WorkerPool, type SimTask } from './pool';
import {
  initCem, sampleCandidates, updateCem, noiseAt, nextMaxPieces, median, type CemState,
} from './cem';
import { hashSeed, mulberry32 } from '../src/ai/rng';
import { fromVector, normalize } from './weightsIo';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Salt keeping the candidate-sampling stream disjoint from the game seeds. */
const SAMPLE_STREAM = 0xce41;
const PUBLIC_AI = resolve(ROOT, 'public/ai');
const CHECKPOINT = resolve(PUBLIC_AI, 'checkpoint.json');
const LOG = resolve(PUBLIC_AI, 'training-log.jsonl');
const BEST_PUBLIC = resolve(PUBLIC_AI, 'best-weights.json');
const BEST_SRC = resolve(ROOT, 'src/ai/trained-weights.json');

interface BestEver {
  weights: number[];
  meanLines: number;
  gen: number;
  evalGames: number;
}

interface Checkpoint {
  version: 1;
  gen: number;
  mu: number[];
  sigma: number[];
  baseSeed: number;
  maxPieces: number;
  config: TrainConfig;
  bestEver: BestEver;
}

function parseArgs(argv: string[]): { generations: number | null; resume: boolean } {
  const out = { generations: null as number | null, resume: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--resume') out.resume = true;
    else if (argv[i] === '--generations') out.generations = Number(argv[++i]);
    else throw new Error(`unknown flag ${argv[i]}`);
  }
  return out;
}

function writeWeightsFiles(weights: number[], meanLines: number, evalGames: number, gen: number, depth: 1 | 2) {
  const payload = JSON.stringify({
    version: 1,
    weights: fromVector(weights),
    meanLines,
    evalGames,
    gen,
    searchDepth: depth,
    trainedAt: new Date().toISOString(),
  }, null, 2);

  // Two copies on purpose: files under public/ are copied verbatim by Vite and
  // must not be imported, while the bundled copy is what makes `dist` run
  // standalone. Same bytes, different jobs.
  writeFileSync(BEST_PUBLIC, payload);
  writeFileSync(BEST_SRC, payload);
}

const args = parseArgs(process.argv.slice(2));
const cfg = DEFAULT_CONFIG;
mkdirSync(PUBLIC_AI, { recursive: true });

let state: CemState = initCem();
let maxPieces = cfg.initialMaxPieces;
let baseSeed = cfg.baseSeed;
let bestEver: BestEver = { weights: state.mu.slice(), meanLines: -1, gen: -1, evalGames: 0 };

if (args.resume) {
  if (!existsSync(CHECKPOINT)) throw new Error(`--resume but no checkpoint at ${CHECKPOINT}`);
  const cp = JSON.parse(readFileSync(CHECKPOINT, 'utf8')) as Checkpoint;
  state = { mu: cp.mu, sigma: cp.sigma, gen: cp.gen };
  maxPieces = cp.maxPieces;
  baseSeed = cp.baseSeed;
  bestEver = cp.bestEver;
  console.log(`resumed from gen ${cp.gen}, maxPieces ${maxPieces}, bestEver ${bestEver.meanLines}`);
}

const pool = new WorkerPool(cfg.workers);
console.log(`training with ${cfg.workers} workers, depth ${cfg.depth}, population ${cfg.population}`);

function saveCheckpoint() {
  const cp: Checkpoint = {
    version: 1, gen: state.gen, mu: state.mu, sigma: state.sigma,
    baseSeed, maxPieces, config: cfg, bestEver,
  };
  writeFileSync(CHECKPOINT, JSON.stringify(cp, null, 2));
}

let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\ncaught SIGINT — writing checkpoint and exiting');
});

async function runGeneration(): Promise<void> {
  const gen = state.gen;
  const started = Date.now();

  const candidates = sampleCandidates(
    state, cfg.population, mulberry32(hashSeed(baseSeed, gen, SAMPLE_STREAM)),
  );

  // Common random numbers: the seed depends on (baseSeed, gen, gameIndex) and
  // NOT on the candidate, so every candidate this generation faces the exact
  // same piece sequences. Without this, measured differences are mostly luck
  // and the evolution signal disappears. Seeds change each generation so no
  // candidate can overfit one sequence.
  const seeds = Array.from({ length: cfg.gamesPerCandidate }, (_, j) => hashSeed(baseSeed, gen, j));

  const tasks: SimTask[] = [];
  candidates.forEach((weights, i) => {
    seeds.forEach((seed, j) => {
      tasks.push({ taskId: i * cfg.gamesPerCandidate + j, weights, seed, maxPieces, depth: cfg.depth });
    });
  });

  const results = await pool.run(tasks);

  const fitness: number[] = [];
  const meanPieces: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    let lines = 0;
    let pieces = 0;
    for (let j = 0; j < cfg.gamesPerCandidate; j++) {
      const r = results[i * cfg.gamesPerCandidate + j];
      lines += r.lines;
      pieces += r.pieces;
    }
    fitness.push(lines / cfg.gamesPerCandidate);
    meanPieces.push(pieces / cfg.gamesPerCandidate);
  }

  const best = Math.max(...fitness);
  const worst = Math.min(...fitness);
  const mean = fitness.reduce((s, x) => s + x, 0) / fitness.length;
  const std = Math.sqrt(fitness.reduce((s, x) => s + (x - mean) ** 2, 0) / fitness.length);
  const bestWeights = candidates[fitness.indexOf(best)];
  const elapsedMs = Date.now() - started;

  // Median survival among the ELITES. This drives the piece cap (see below) and
  // is worth logging in its own right: it is the one number that shows whether
  // the cap is currently truncating the candidates CEM actually learns from.
  const eliteCount = Math.max(1, Math.ceil(cfg.eliteFrac * candidates.length));
  const elitePieces = median(
    fitness
      .map((fit, i) => ({ fit, pieces: meanPieces[i] }))
      .sort((a, b) => b.fit - a.fit)
      .slice(0, eliteCount)
      .map((e) => e.pieces),
  );

  appendFileSync(LOG, JSON.stringify({
    gen, ts: Date.now(), best, mean, median: median(fitness), worst, std,
    mu: state.mu, sigma: state.sigma, bestWeights,
    maxPieces, medianPieces: median(meanPieces), elitePieces,
    gamesPerCandidate: cfg.gamesPerCandidate, elapsedMs,
  }) + '\n');

  console.log(
    `gen ${String(gen).padStart(4)}  best ${best.toFixed(1).padStart(9)}` +
    `  median ${median(fitness).toFixed(1).padStart(9)}  worst ${worst.toFixed(1).padStart(7)}` +
    `  cap ${maxPieces}  ${(elapsedMs / 1000).toFixed(1)}s`,
  );

  state = updateCem(state, candidates, fitness, {
    eliteFrac: cfg.eliteFrac,
    noise: noiseAt(gen, cfg),
  });

  const raised = nextMaxPieces(maxPieces, elitePieces, cfg.maxPiecesCap);
  if (raised !== maxPieces) {
    console.log(`  piece cap ${maxPieces} -> ${raised} (elite survival ${elitePieces.toFixed(0)})`);
    maxPieces = raised;
  }

  // The top candidate of a generation is often just lucky. Re-score the current
  // mu on fresh seeds and long games before letting it become the published model.
  if (state.gen % cfg.reevalEvery === 0) {
    const mu = normalize(state.mu);
    const evalTasks: SimTask[] = Array.from({ length: cfg.reevalGames }, (_, j) => ({
      taskId: j,
      weights: mu,
      seed: hashSeed(baseSeed ^ 0x5eed, state.gen, j),
      maxPieces: cfg.reevalMaxPieces,
      depth: cfg.depth,
    }));
    const evalResults = await pool.run(evalTasks);
    const meanLines = evalResults.reduce((s, r) => s + r.lines, 0) / evalResults.length;
    console.log(`  re-eval of mu over ${cfg.reevalGames} fresh seeds: ${meanLines.toFixed(1)} lines`);

    if (meanLines > bestEver.meanLines) {
      bestEver = { weights: mu, meanLines, gen: state.gen, evalGames: cfg.reevalGames };
      writeWeightsFiles(mu, meanLines, cfg.reevalGames, state.gen, cfg.depth);
      console.log(`  new best — wrote best-weights.json and trained-weights.json`);
    }
  }

  saveCheckpoint();
}

while (!stopping) {
  if (args.generations !== null && state.gen >= args.generations) break;
  await runGeneration();
}

saveCheckpoint();
await pool.destroy();
console.log(`stopped at gen ${state.gen}; bestEver ${bestEver.meanLines.toFixed(1)} lines (gen ${bestEver.gen})`);
process.exit(0);
