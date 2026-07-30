import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG, resolveWorkers, type TrainConfig } from './config';
import { WorkerPool, type SimTask } from './pool';
import {
  aggregateFitness,
  eliteCount,
  initCem,
  median,
  nextMaxPieces,
  noiseAt,
  sampleCandidates,
  updateCem,
  type CandidateStats,
  type CemState,
} from './cem';
import { hashSeed, mulberry32 } from '../src/ai/rng';
import {
  DEFAULT_WEIGHTS,
  DEFAULT_WEIGHTS_META,
  fromVector,
  normalize,
  toVector,
} from '../src/ai/weights';
import { SCORE_RATE_OBJECTIVE } from './objective';
import {
  fixedReevaluationSeeds,
  shouldPublishScoreReevaluation,
  type ReevaluationSummary,
} from './publication';
import { planReevaluation } from './reevaluation';
import {
  assertFreshRun,
  readCompatibleCheckpoint,
  resolveRunPaths,
} from './runArtifacts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Salt keeping the candidate-sampling stream disjoint from the game seeds. */
const SAMPLE_STREAM = 0xce41;
const PUBLIC_AI = resolve(ROOT, 'public/ai');
const BEST_PUBLIC = resolve(PUBLIC_AI, 'best-weights.json');
const BEST_SRC = resolve(ROOT, 'src/ai/trained-weights.json');

interface BestEver extends ReevaluationSummary {
  weights: number[];
  gen: number;
  evalGames: number;
  evalMaxPieces: number;
}

interface Checkpoint {
  version: 2;
  objective: typeof SCORE_RATE_OBJECTIVE;
  gen: number;
  mu: number[];
  sigma: number[];
  baseSeed: number;
  maxPieces: number;
  config: TrainConfig;
  bestEver: BestEver | null;
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
  outputDir: string | null;
} {
  const out = {
    generations: null as number | null,
    resume: false,
    workers: null as number | null,
    outputDir: null as string | null,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--resume') out.resume = true;
    else if (argv[i] === '--generations') out.generations = num(argv[i], argv[++i]);
    else if (argv[i] === '--workers') out.workers = num(argv[i], argv[++i]);
    else if (argv[i] === '--output-dir') {
      const value = argv[++i];
      if (value === undefined) throw new Error('missing value for --output-dir');
      out.outputDir = value;
    } else throw new Error(`unknown flag ${argv[i]}`);
  }
  return out;
}

function writeWeightsFiles(best: BestEver, depth: 1 | 2) {
  const payload = JSON.stringify({
    version: 2,
    weights: fromVector(best.weights),
    objective: SCORE_RATE_OBJECTIVE,
    meanScore: best.meanScore,
    evalMaxPieces: best.evalMaxPieces,
    meanLines: best.meanLines,
    meanHeight: best.meanHeight,
    evalGames: best.evalGames,
    gen: best.gen,
    searchDepth: depth,
    trainedAt: new Date().toISOString(),
  }, null, 2);

  // Two copies on purpose: files under public/ are copied verbatim by Vite and
  // must not be imported, while the bundled copy is what makes `dist` run
  // standalone. Same bytes, different jobs.
  writeFileSync(BEST_PUBLIC, payload);
  writeFileSync(BEST_SRC, payload);
}

function reevaluationSummary(
  stats: CandidateStats,
  index: number,
): ReevaluationSummary {
  return {
    meanScore: stats.meanScore[index],
    scoreRate: stats.fitness[index],
    meanLines: stats.meanLines[index],
    meanHeight: stats.meanHeight[index],
  };
}

const args = parseArgs(process.argv.slice(2));
const paths = resolveRunPaths(ROOT, args.outputDir);

let checkpoint: Checkpoint | null = null;
if (args.resume) {
  if (!existsSync(paths.checkpoint)) {
    throw new Error(`--resume but no checkpoint at ${paths.checkpoint}`);
  }
  checkpoint = readCompatibleCheckpoint(paths.checkpoint) as unknown as Checkpoint;
} else {
  assertFreshRun(paths);
}

// `--workers` is the throttle: the pool is the only thing in this script that
// consumes more than one core, so N workers means N busy cores and the rest of
// the machine stays responsive. Everything else comes from config.ts.
const cfg: TrainConfig = { ...DEFAULT_CONFIG, workers: resolveWorkers(args.workers) };
mkdirSync(paths.outputDir, { recursive: true });

let state: CemState = initCem();
let maxPieces = cfg.initialMaxPieces;
let baseSeed = cfg.baseSeed;
let bestEver: BestEver | null = null;

if (checkpoint !== null) {
  state = { mu: checkpoint.mu, sigma: checkpoint.sigma, gen: checkpoint.gen };
  maxPieces = checkpoint.maxPieces;
  baseSeed = checkpoint.baseSeed;
  bestEver = checkpoint.bestEver;
  console.log(
    `resumed ${checkpoint.objective} from gen ${checkpoint.gen}, ` +
    `maxPieces ${maxPieces}, best mean score ` +
    `${bestEver === null ? 'none' : bestEver.meanScore.toFixed(1)}`,
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
    version: 2,
    objective: SCORE_RATE_OBJECTIVE,
    gen: state.gen,
    mu: state.mu,
    sigma: state.sigma,
    baseSeed,
    maxPieces,
    config: cfg,
    bestEver,
  };
  writeFileSync(paths.checkpoint, JSON.stringify(cp, null, 2));
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

  const {
    fitness: scoreRates,
    meanScore,
    meanLines,
    meanPieces,
    meanHeight,
  } = aggregateFitness(results, candidates.length, cfg.gamesPerCandidate, maxPieces);

  const bestScoreRate = Math.max(...scoreRates);
  const worstScoreRate = Math.min(...scoreRates);
  const meanScoreRate = scoreRates.reduce((sum, value) => sum + value, 0) / scoreRates.length;
  const scoreRateStd = Math.sqrt(
    scoreRates.reduce((sum, value) => sum + (value - meanScoreRate) ** 2, 0) /
    scoreRates.length,
  );
  const bestWeights = candidates[scoreRates.indexOf(bestScoreRate)];
  const elapsedMs = Date.now() - started;

  const elites = scoreRates
    .map((fit, index) => ({
      fit,
      pieces: meanPieces[index],
      score: meanScore[index],
      height: meanHeight[index],
    }))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, eliteCount(cfg.eliteFrac, candidates.length));
  const elitePieces = median(elites.map((elite) => elite.pieces));
  const eliteScore = median(elites.map((elite) => elite.score));
  const eliteHeight = median(elites.map((elite) => elite.height));

  appendFileSync(paths.log, JSON.stringify({
    objective: SCORE_RATE_OBJECTIVE,
    gen,
    ts: Date.now(),
    bestScoreRate,
    meanScoreRate,
    medianScoreRate: median(scoreRates),
    worstScoreRate,
    scoreRateStd,
    mu: state.mu,
    sigma: state.sigma,
    bestWeights,
    maxPieces,
    medianPieces: median(meanPieces),
    elitePieces,
    medianScore: median(meanScore),
    eliteScore: median(elites.map((elite) => elite.score)),
    medianLines: median(meanLines),
    medianHeight: median(meanHeight),
    eliteHeight: median(elites.map((elite) => elite.height)),
    gamesPerCandidate: cfg.gamesPerCandidate,
    elapsedMs,
  }) + '\n');

  console.log(
    `gen ${String(gen).padStart(4)}` +
    `  bestRate ${bestScoreRate.toFixed(3).padStart(10)}` +
    `  medianRate ${median(scoreRates).toFixed(3).padStart(10)}` +
    `  eliteScore ${eliteScore.toFixed(1).padStart(12)}` +
    `  eliteH ${eliteHeight.toFixed(1).padStart(5)}` +
    `  cap ${maxPieces}  ${(elapsedMs / 1000).toFixed(1)}s`,
  );

  state = updateCem(state, candidates, scoreRates, {
    eliteFrac: cfg.eliteFrac,
    noise: noiseAt(gen, cfg),
  });

  const raised = nextMaxPieces(maxPieces, elitePieces, cfg.maxPiecesCap);
  if (raised !== maxPieces) {
    console.log(`  piece cap ${maxPieces} -> ${raised} (elite survival ${elitePieces.toFixed(0)})`);
    maxPieces = raised;
  }

  if (state.gen % cfg.reevalEvery === 0) {
    const mu = normalize(state.mu);
    const reevaluation = planReevaluation(
      bestEver,
      toVector(DEFAULT_WEIGHTS),
      mu,
    );
    const evaluationWeights = reevaluation.weights;
    const seeds = fixedReevaluationSeeds(baseSeed, cfg.reevalGames);
    const evalTasks: SimTask[] = [];
    evaluationWeights.forEach((weights, candidateIndex) => {
      seeds.forEach((seed, gameIndex) => {
        evalTasks.push({
          taskId: candidateIndex * cfg.reevalGames + gameIndex,
          weights,
          seed,
          maxPieces: cfg.reevalMaxPieces,
          depth: cfg.depth,
        });
      });
    });

    const evalResults = await pool.run(evalTasks);
    const evalStats = aggregateFitness(
      evalResults,
      evaluationWeights.length,
      cfg.reevalGames,
      cfg.reevalMaxPieces,
    );

    if (reevaluation.baselineIndex !== null) {
      const baseline = reevaluationSummary(evalStats, reevaluation.baselineIndex);
      bestEver = {
        weights: evaluationWeights[reevaluation.baselineIndex],
        ...baseline,
        gen: DEFAULT_WEIGHTS_META?.gen ?? -1,
        evalGames: cfg.reevalGames,
        evalMaxPieces: cfg.reevalMaxPieces,
      };
      console.log(
        `  established published baseline: mean score ${baseline.meanScore.toFixed(1)}, ` +
        `score rate ${baseline.scoreRate.toFixed(3)}, mean height ${baseline.meanHeight.toFixed(2)}`,
      );
    }

    const candidate = reevaluationSummary(evalStats, reevaluation.candidateIndex);
    if (bestEver === null) {
      throw new Error('fixed reevaluation did not establish a published score baseline');
    }
    if (shouldPublishScoreReevaluation(candidate, bestEver)) {
      bestEver = {
        weights: mu,
        ...candidate,
        gen: state.gen,
        evalGames: cfg.reevalGames,
        evalMaxPieces: cfg.reevalMaxPieces,
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
  bestEver === null
    ? `stopped at gen ${state.gen}; no fixed-schedule reevaluation yet`
    : `stopped at gen ${state.gen}; bestEver mean score ${bestEver.meanScore.toFixed(1)}, ` +
      `score rate ${bestEver.scoreRate.toFixed(3)}, mean height ` +
      `${bestEver.meanHeight.toFixed(2)} (gen ${bestEver.gen})`,
);
process.exit(0);
