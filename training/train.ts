import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG, resolveWorkers, type TrainConfig } from './config';
import { WorkerPool, type SimTask } from './pool';
import {
  initCem, sampleCandidates, updateCem, noiseAt, nextMaxPieces, median,
  aggregateFitness, eliteCount, type CemState,
} from './cem';
import { hashSeed, mulberry32 } from '../src/ai/rng';
import { fromVector, normalize } from '../src/ai/weights';
import { shouldPublishReevaluation } from './publication';

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
  /**
   * The combined objective, `meanLines - heightPenalty * meanHeight`, used for
   * publication while either re-evaluation can still die. Once both line terms
   * saturate (measured: 1998.2 of a possible 2000), publication instead ranks
   * the remaining non-saturated signal, mean stack height.
   */
  score: number;
  meanLines: number;
  meanHeight: number;
  gen: number;
  evalGames: number;
}

/**
 * Sentinel for "nothing published yet", chosen so any real evaluation beats it.
 * Not -Infinity: this is written to checkpoint.json, and JSON.stringify turns
 * -Infinity into null, which comes back from --resume as a broken comparison.
 */
const NO_BEST = -1e9;

interface Checkpoint {
  version: 1;
  gen: number;
  mu: number[];
  sigma: number[];
  baseSeed: number;
  maxPieces: number;
  /**
   * Forensic only — deliberately NOT restored by --resume. A resumed run uses
   * whatever config.ts currently says, so hyperparameters can be tuned between
   * sessions; this field records what actually produced the checkpoint.
   */
  config: TrainConfig;
  bestEver: BestEver;
}

/**
 * A mistyped or omitted value has to fail loudly. Bare `Number(value)` yields
 * NaN, and the loop guard `state.gen >= args.generations` is always false
 * against NaN — a run the operator believes is bounded runs until Ctrl-C.
 * This is a multi-hour, self-extending script, so a silent unbounded run is
 * expensive. Matches bench.ts's `parseArgs` so the two CLIs behave the same.
 */
function num(key: string, value: string | undefined): number {
  if (value === undefined) throw new Error(`missing value for ${key}`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${key} expects a number, got "${value}"`);
  return n;
}

function parseArgs(argv: string[]): {
  generations: number | null;
  resume: boolean;
  workers: number | null;
} {
  const out = { generations: null as number | null, resume: false, workers: null as number | null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--resume') out.resume = true;
    else if (argv[i] === '--generations') out.generations = num(argv[i], argv[++i]);
    else if (argv[i] === '--workers') out.workers = num(argv[i], argv[++i]);
    else throw new Error(`unknown flag ${argv[i]}`);
  }
  return out;
}

function writeWeightsFiles(best: BestEver, depth: 1 | 2) {
  const { weights, meanLines, meanHeight, evalGames, gen } = best;
  const payload = JSON.stringify({
    version: 1,
    weights: fromVector(weights),
    meanLines,
    meanHeight,
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

/**
 * A checkpoint written before fitness gained its height term carries no
 * `score`, and its `meanLines` is not comparable with one — it was measured
 * against a different objective. Reset the bar in that case instead of
 * inheriting an incomparable number, and the next re-eval republishes under the
 * objective actually in force.
 */
function restoreBestEver(raw: Partial<BestEver>): BestEver {
  return {
    weights: raw.weights ?? [],
    score: raw.score ?? NO_BEST,
    meanLines: raw.meanLines ?? 0,
    meanHeight: raw.meanHeight ?? 0,
    gen: raw.gen ?? -1,
    evalGames: raw.evalGames ?? 0,
  };
}

const args = parseArgs(process.argv.slice(2));
// `--workers` is the throttle: the pool is the only thing in this script that
// consumes more than one core, so N workers means N busy cores and the rest of
// the machine stays responsive. Everything else comes from config.ts.
const cfg: TrainConfig = { ...DEFAULT_CONFIG, workers: resolveWorkers(args.workers) };
mkdirSync(PUBLIC_AI, { recursive: true });

let state: CemState = initCem();
let maxPieces = cfg.initialMaxPieces;
let baseSeed = cfg.baseSeed;
let bestEver: BestEver = {
  weights: state.mu.slice(), score: NO_BEST, meanLines: 0, meanHeight: 0, gen: -1, evalGames: 0,
};

if (args.resume) {
  if (!existsSync(CHECKPOINT)) throw new Error(`--resume but no checkpoint at ${CHECKPOINT}`);
  const cp = JSON.parse(readFileSync(CHECKPOINT, 'utf8')) as Checkpoint;
  state = { mu: cp.mu, sigma: cp.sigma, gen: cp.gen };
  maxPieces = cp.maxPieces;
  baseSeed = cp.baseSeed;
  bestEver = restoreBestEver(cp.bestEver);
  console.log(
    `resumed from gen ${cp.gen}, maxPieces ${maxPieces}, ` +
    `bestEver score ${bestEver.score === NO_BEST ? 'none' : bestEver.score.toFixed(1)}`,
  );
}

const pool = new WorkerPool(cfg.workers);
console.log(
  `training with ${cfg.workers} workers of ${cpus().length} cores` +
  `${args.workers === null ? '' : ' (--workers)'}` +
  `, depth ${cfg.depth}, population ${cfg.population}`,
);

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

  const { fitness, meanLines, meanPieces, meanHeight } = aggregateFitness(
    results, candidates.length, cfg.gamesPerCandidate, cfg.heightPenalty,
  );

  const best = Math.max(...fitness);
  const worst = Math.min(...fitness);
  const mean = fitness.reduce((s, x) => s + x, 0) / fitness.length;
  const std = Math.sqrt(fitness.reduce((s, x) => s + (x - mean) ** 2, 0) / fitness.length);
  const bestWeights = candidates[fitness.indexOf(best)];
  const elapsedMs = Date.now() - started;

  // Median survival among the ELITES. This drives the piece cap (see below) and
  // is worth logging in its own right: it is the one number that shows whether
  // the cap is currently truncating the candidates CEM actually learns from.
  const elites = fitness
    .map((fit, i) => ({ fit, pieces: meanPieces[i], height: meanHeight[i] }))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, eliteCount(cfg.eliteFrac, candidates.length));
  const elitePieces = median(elites.map((e) => e.pieces));
  // The elites' tidiness — the half of fitness that still moves once their
  // lines have all pinned the 0.4 x maxPieces ceiling. When `best` stops
  // climbing, this is the number that says whether the run is still learning.
  const eliteHeight = median(elites.map((e) => e.height));

  appendFileSync(LOG, JSON.stringify({
    gen, ts: Date.now(), best, mean, median: median(fitness), worst, std,
    mu: state.mu, sigma: state.sigma, bestWeights,
    maxPieces, medianPieces: median(meanPieces), elitePieces,
    medianLines: median(meanLines), medianHeight: median(meanHeight), eliteHeight,
    heightPenalty: cfg.heightPenalty,
    gamesPerCandidate: cfg.gamesPerCandidate, elapsedMs,
  }) + '\n');

  console.log(
    `gen ${String(gen).padStart(4)}  best ${best.toFixed(1).padStart(9)}` +
    `  median ${median(fitness).toFixed(1).padStart(9)}  worst ${worst.toFixed(1).padStart(7)}` +
    `  eliteH ${eliteHeight.toFixed(1).padStart(5)}` +
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
    // Scored by the same formula training selects on — all 30 games treated as
    // one candidate. Note the balance is not identical to a training
    // generation's: reevalMaxPieces is larger than maxPieces, and the lines
    // term grows with the cap while the height term does not, so re-eval leans
    // further toward lines. Every re-eval uses the same cap, so the comparison
    // against bestEver is still like-for-like.
    const { fitness: evalFitness, meanLines: evalLines, meanHeight: evalHeight } =
      aggregateFitness(evalResults, 1, cfg.reevalGames, cfg.heightPenalty);
    const [score] = evalFitness;
    const [lines] = evalLines;
    const [height] = evalHeight;
    console.log(
      `  re-eval of mu over ${cfg.reevalGames} fresh seeds: ${lines.toFixed(1)} lines, ` +
      `mean height ${height.toFixed(2)}, score ${score.toFixed(1)}`,
    );

    // Theoretical ceiling: a piece contributes 4 cells and a line needs 10, so
    // lines/pieces can never exceed 0.4 — thus 0.4 * reevalMaxPieces is the most
    // lines re-eval can EVER report, no matter how good the candidate is.
    const reevalCeiling = 0.4 * cfg.reevalMaxPieces;
    if (lines > 0.99 * reevalCeiling) {
      console.warn(
        `  NOTE: re-eval lines (${lines.toFixed(1)}) are within 1% of their theoretical ceiling ` +
        `(0.4 x reevalMaxPieces = ${reevalCeiling.toFixed(1)}). A competent candidate never dies ` +
        `within reevalMaxPieces pieces, so the lines term is pinned regardless of how much better ` +
        `the policy actually is; only the height term (${height.toFixed(2)}, worth ` +
        `${(cfg.heightPenalty * height).toFixed(1)} points here) can still separate models. Read ` +
        `mean height, not lines, when judging whether this run is improving.`,
      );
    }

    if (shouldPublishReevaluation(
      { score, meanLines: lines, meanHeight: height },
      bestEver,
      reevalCeiling,
    )) {
      bestEver = {
        weights: mu, score, meanLines: lines, meanHeight: height,
        gen: state.gen, evalGames: cfg.reevalGames,
      };
      writeWeightsFiles(bestEver, cfg.depth);
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
console.log(
  bestEver.score === NO_BEST
    ? `stopped at gen ${state.gen}; no model published yet (re-eval runs every ${cfg.reevalEvery} generations)`
    : `stopped at gen ${state.gen}; bestEver score ${bestEver.score.toFixed(1)} ` +
      `(${bestEver.meanLines.toFixed(1)} lines at mean height ${bestEver.meanHeight.toFixed(2)}, gen ${bestEver.gen})`,
);
process.exit(0);
