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
import { FIXED_SEARCH_LIMITS } from '../src/ai/search';
import type { SearchDiagnostics } from '../src/ai/weights';
import {
  DEFAULT_WEIGHTS,
  fromVector,
  normalize,
  toVector,
} from '../src/ai/weights';
import { SCORE_RATE_OBJECTIVE, SEARCH_CONTRACT } from './objective';
import {
  evaluateTetrisCandidate,
  fixedReevaluationSeeds,
  type ReevaluationSummary,
} from './publication';
import { planReevaluation } from './reevaluation';
import {
  buildReevaluationLogEntry,
  type LoggedReevaluation,
} from './reevaluationLog';
import { writeCandidateWeights } from './candidateWeights';
import {
  assertFreshRun,
  readCompatibleRunArtifacts,
  resolveRunPaths,
  type ScoreRateCheckpoint,
  type ScoreRateEvaluation,
} from './runArtifacts';
import { acquireRunLock } from './runLock';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Salt keeping the candidate-sampling stream disjoint from the game seeds. */
const SAMPLE_STREAM = 0xce41;

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

function generationTarget(value: string | undefined): number {
  const result = num('--generations', value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error('--generations expects a safe integer >= 0');
  }
  return result;
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
    else if (argv[i] === '--generations') out.generations = generationTarget(argv[++i]);
    else if (argv[i] === '--workers') out.workers = num(argv[i], argv[++i]);
    else if (argv[i] === '--output-dir') {
      const value = argv[++i];
      if (value === undefined) throw new Error('missing value for --output-dir');
      out.outputDir = value;
    } else throw new Error(`unknown flag ${argv[i]}`);
  }
  return out;
}

function reevaluationSummary(
  stats: CandidateStats,
  index: number,
  searchDiagnostics: SearchDiagnostics,
): ReevaluationSummary {
  return {
    meanScore: stats.meanScore[index],
    scoreRate: stats.fitness[index],
    meanLines: stats.meanLines[index],
    meanHeight: stats.meanHeight[index],
    meanClearCounts: stats.meanClearCounts[index],
    tetrisLineShare: stats.tetrisLineShares[index],
    strategyDiagnostics: stats.meanStrategyDiagnostics[index],
    survivalDiagnostics: stats.survivalDiagnostics[index],
    searchDiagnostics,
  };
}

function loggedReevaluation(
  evaluation: ScoreRateEvaluation,
): LoggedReevaluation {
  return {
    weights: evaluation.weights,
    meanScore: evaluation.meanScore,
    scoreRate: evaluation.scoreRate,
    meanLines: evaluation.meanLines,
    meanHeight: evaluation.meanHeight,
    meanClearCounts: evaluation.meanClearCounts,
    tetrisLineShare: evaluation.tetrisLineShare,
    strategyDiagnostics: evaluation.strategyDiagnostics,
    survivalDiagnostics: evaluation.survivalDiagnostics,
    searchDiagnostics: evaluation.searchDiagnostics,
    gen: evaluation.gen,
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.resume && args.generations !== null && args.generations === 0) {
  throw new Error('fresh --generations must be greater than 0');
}
const paths = resolveRunPaths(ROOT, args.outputDir);
const runLock = acquireRunLock(ROOT);

try {
let checkpoint: ScoreRateCheckpoint | null = null;
if (args.resume) {
  if (!existsSync(paths.checkpoint)) {
    throw new Error(`--resume but no checkpoint at ${paths.checkpoint}`);
  }
  checkpoint = readCompatibleRunArtifacts(paths);
} else {
  assertFreshRun(paths);
}

if (args.resume && args.generations === 0) {
  console.log(`validated ${checkpoint!.objective} resume artifacts at gen ${checkpoint!.gen}`);
} else {
// `--workers` is the throttle: the pool is the only thing in this script that
// consumes more than one core, so N workers means N busy cores and the rest of
// the machine stays responsive. A resume restores every other setting from the
// validated checkpoint; a fresh run starts from config.ts.
const restoredConfig = checkpoint?.config ?? DEFAULT_CONFIG;
const requestedWorkers = args.workers ?? checkpoint?.config.workers ?? null;
const cfg: TrainConfig = {
  ...restoredConfig,
  workers: resolveWorkers(requestedWorkers),
};
mkdirSync(paths.outputDir, { recursive: true });

let state: CemState = initCem();
let maxPieces = cfg.initialMaxPieces;
let baseSeed = cfg.baseSeed;
let publishedBaseline: ScoreRateEvaluation | null = null;
let bestQualifiedCandidate: ScoreRateEvaluation | null = null;

if (checkpoint !== null) {
  state = { mu: checkpoint.mu, sigma: checkpoint.sigma, gen: checkpoint.gen };
  maxPieces = checkpoint.maxPieces;
  baseSeed = checkpoint.baseSeed;
  publishedBaseline = checkpoint.publishedBaseline;
  bestQualifiedCandidate = checkpoint.bestQualifiedCandidate;
  console.log(
    `resumed ${checkpoint.objective} from gen ${checkpoint.gen}, ` +
    `maxPieces ${maxPieces}, qualified candidate ` +
    `${bestQualifiedCandidate === null ? 'none' : bestQualifiedCandidate.meanScore.toFixed(1)}`,
  );
}

const pool = await WorkerPool.create(cfg.workers);
try {
console.log(
  `training with ${cfg.workers} workers of ${cpus().length} cores` +
  `${args.workers === null ? '' : ' (--workers)'}` +
    `, depth ${cfg.searchDepth}, root beam ${cfg.rootBeamWidth}, ` +
    `child beam ${cfg.childBeamWidth}, population ${cfg.population}`,
);

function saveCheckpoint() {
  const cp: ScoreRateCheckpoint = {
    version: 5,
    objective: SCORE_RATE_OBJECTIVE,
    gen: state.gen,
    mu: state.mu,
    sigma: state.sigma,
    baseSeed,
    maxPieces,
    config: cfg,
    publishedBaseline,
    bestQualifiedCandidate,
    searchContract: 'bag-expectimax-hold-v1',
    searchDepth: cfg.searchDepth,
    rootBeamWidth: cfg.rootBeamWidth,
    childBeamWidth: cfg.childBeamWidth,
  };
  writeFileSync(paths.checkpoint, JSON.stringify(cp, null, 2));
}

let stopping = false;
process.on('SIGINT', () => {
  if (stopping) {
    process.exitCode = 1;
    return;
  }
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
      tasks.push({
        taskId: i * cfg.gamesPerCandidate + j,
        weights,
        seed,
        maxPieces,
        search: FIXED_SEARCH_LIMITS,
      });
    });
  });

  const results = await pool.run(tasks);

    const {
    fitness: scoreRates,
    meanScore,
    meanLines,
    meanPieces,
    meanHeight,
    tetrisLineShares,
    meanStrategyDiagnostics,
    meanSearchDiagnostics,
    survivalDiagnostics,
  } = aggregateFitness(results, candidates.length, cfg.gamesPerCandidate, maxPieces);

  const bestScoreRate = Math.max(...scoreRates);
  const worstScoreRate = Math.min(...scoreRates);
  const meanScoreRate = scoreRates.reduce((sum, value) => sum + value, 0) / scoreRates.length;
  const scoreRateStd = Math.sqrt(
    scoreRates.reduce((sum, value) => sum + (value - meanScoreRate) ** 2, 0) /
    scoreRates.length,
  );
  const bestIndex = scoreRates.indexOf(bestScoreRate);
  const bestWeights = candidates[bestIndex];
  const elapsedMs = Date.now() - started;

  const elites = scoreRates
    .map((fit, index) => ({
      fit,
      pieces: meanPieces[index],
      score: meanScore[index],
      height: meanHeight[index],
      tetrisLineShare: tetrisLineShares[index],
      strategy: meanStrategyDiagnostics[index],
      survival: survivalDiagnostics[index],
      search: meanSearchDiagnostics[index],
    }))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, eliteCount(cfg.eliteFrac, candidates.length));
  const elitePieces = median(elites.map((elite) => elite.pieces));
  const eliteScore = median(elites.map((elite) => elite.score));
  const eliteHeight = median(elites.map((elite) => elite.height));
  const bestTetrisLineShare = tetrisLineShares[bestIndex];
  const eliteTetrisLineShare = median(elites.map((elite) => elite.tetrisLineShare));
  const nextState = updateCem(state, candidates, scoreRates, {
    eliteFrac: cfg.eliteFrac,
    noise: noiseAt(gen, cfg),
  });

  appendFileSync(paths.log, JSON.stringify({
    objective: SCORE_RATE_OBJECTIVE,
    searchContract: SEARCH_CONTRACT,
    searchDepth: cfg.searchDepth,
    rootBeamWidth: cfg.rootBeamWidth,
    childBeamWidth: cfg.childBeamWidth,
    gen,
    ts: Date.now(),
    bestScoreRate,
    meanScoreRate,
    medianScoreRate: median(scoreRates),
    worstScoreRate,
    scoreRateStd,
    mu: nextState.mu,
    sigma: nextState.sigma,
    bestWeights,
    maxPieces,
    medianPieces: median(meanPieces),
    elitePieces,
    medianScore: median(meanScore),
    eliteScore: median(elites.map((elite) => elite.score)),
    medianLines: median(meanLines),
    medianHeight: median(meanHeight),
    eliteHeight: median(elites.map((elite) => elite.height)),
    bestTetrisLineShare,
    medianTetrisLineShare: median(tetrisLineShares),
    eliteTetrisLineShare,
    bestStrategyDiagnostics: meanStrategyDiagnostics[bestIndex],
    medianStrategyDiagnostics: {
      meanCleanWellDepth: median(
        meanStrategyDiagnostics.map((diagnostics) => diagnostics.meanCleanWellDepth),
      ),
      meanTetrisSetupProgress: median(
        meanStrategyDiagnostics.map((diagnostics) => diagnostics.meanTetrisSetupProgress),
      ),
      meanTetrisReadyRows: median(
        meanStrategyDiagnostics.map((diagnostics) => diagnostics.meanTetrisReadyRows),
      ),
    },
    eliteStrategyDiagnostics: {
      meanCleanWellDepth: median(
        elites.map((elite) => elite.strategy.meanCleanWellDepth),
      ),
      meanTetrisSetupProgress: median(
        elites.map((elite) => elite.strategy.meanTetrisSetupProgress),
      ),
      meanTetrisReadyRows: median(
        elites.map((elite) => elite.strategy.meanTetrisReadyRows),
      ),
    },
    bestSearchDiagnostics: meanSearchDiagnostics[bestIndex],
    medianSearchDiagnostics: {
      holdActions: median(meanSearchDiagnostics.map((d) => d.holdActions)),
      holdRate: median(meanSearchDiagnostics.map((d) => d.holdRate)),
      meanCompletedDepth: median(meanSearchDiagnostics.map((d) => d.meanCompletedDepth)),
      minCompletedDepth: median(meanSearchDiagnostics.map((d) => d.minCompletedDepth)),
      expandedDecisionNodes: median(meanSearchDiagnostics.map((d) => d.expandedDecisionNodes)),
      expandedChanceNodes: median(meanSearchDiagnostics.map((d) => d.expandedChanceNodes)),
      cacheHits: median(meanSearchDiagnostics.map((d) => d.cacheHits)),
      abortedSearches: median(meanSearchDiagnostics.map((d) => d.abortedSearches)),
    },
    eliteSearchDiagnostics: {
      holdActions: median(elites.map((elite) => elite.search.holdActions)),
      holdRate: median(elites.map((elite) => elite.search.holdRate)),
      meanCompletedDepth: median(elites.map((elite) => elite.search.meanCompletedDepth)),
      minCompletedDepth: median(elites.map((elite) => elite.search.minCompletedDepth)),
      expandedDecisionNodes: median(elites.map((elite) => elite.search.expandedDecisionNodes)),
      expandedChanceNodes: median(elites.map((elite) => elite.search.expandedChanceNodes)),
      cacheHits: median(elites.map((elite) => elite.search.cacheHits)),
      abortedSearches: median(elites.map((elite) => elite.search.abortedSearches)),
    },
    gamesPerCandidate: cfg.gamesPerCandidate,
    elapsedMs,
  }) + '\n');

  console.log(
    `gen ${String(gen).padStart(4)}` +
    `  bestRate ${bestScoreRate.toFixed(3).padStart(10)}` +
    `  medianRate ${median(scoreRates).toFixed(3).padStart(10)}` +
    `  eliteScore ${eliteScore.toFixed(1).padStart(12)}` +
    `  eliteH ${eliteHeight.toFixed(1).padStart(5)}` +
    `  bestT4 ${(100 * bestTetrisLineShare).toFixed(1)}%` +
    `  eliteT4 ${(100 * eliteTetrisLineShare).toFixed(1)}%` +
    `  cap ${maxPieces}  ${(elapsedMs / 1000).toFixed(1)}s`,
  );

  state = nextState;

  const raised = nextMaxPieces(maxPieces, elitePieces, cfg.maxPiecesCap);
  if (raised !== maxPieces) {
    console.log(`  piece cap ${maxPieces} -> ${raised} (elite survival ${elitePieces.toFixed(0)})`);
    maxPieces = raised;
  }

  if (state.gen % cfg.reevalEvery === 0) {
    const mu = normalize(state.mu);
    const reevaluation = planReevaluation(
      publishedBaseline,
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
          search: FIXED_SEARCH_LIMITS,
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
    const evalSearchDiagnostics = evalStats.meanSearchDiagnostics;
    if (reevaluation.baselineIndex !== null) {
      const baseline = reevaluationSummary(evalStats, reevaluation.baselineIndex, evalSearchDiagnostics[reevaluation.baselineIndex]);
      publishedBaseline = {
        weights: evaluationWeights[reevaluation.baselineIndex],
        ...baseline,
        gen: -1,
        evalGames: cfg.reevalGames,
        evalMaxPieces: cfg.reevalMaxPieces,
      };
      console.log(
        `  established immutable baseline: mean score ${baseline.meanScore.toFixed(1)}, ` +
        `score rate ${baseline.scoreRate.toFixed(3)}, mean height ${baseline.meanHeight.toFixed(2)}`,
      );
    }

    const candidateSummary = reevaluationSummary(evalStats, reevaluation.candidateIndex, evalSearchDiagnostics[reevaluation.candidateIndex]);
    if (publishedBaseline === null) {
      throw new Error('fixed reevaluation did not establish a published score baseline');
    }
    const candidate: ScoreRateEvaluation = {
      weights: mu,
      ...candidateSummary,
      gen: state.gen,
      evalGames: cfg.reevalGames,
      evalMaxPieces: cfg.reevalMaxPieces,
    };
    const currentQualified = bestQualifiedCandidate;
    const qualification = evaluateTetrisCandidate(
      candidate,
      publishedBaseline,
      currentQualified,
    );
    if (qualification.shouldSave) {
      bestQualifiedCandidate = candidate;
      writeCandidateWeights(paths.candidate, {
        version: 5,
        weights: fromVector(candidate.weights),
        objective: SCORE_RATE_OBJECTIVE,
        meanScore: candidate.meanScore,
        evalMaxPieces: candidate.evalMaxPieces,
        meanLines: candidate.meanLines,
        meanHeight: candidate.meanHeight,
        meanClearCounts: candidate.meanClearCounts,
        tetrisLineShare: candidate.tetrisLineShare,
        strategyDiagnostics: candidate.strategyDiagnostics,
        survivalDiagnostics: candidate.survivalDiagnostics,
        searchDiagnostics: candidate.searchDiagnostics,
        evalGames: candidate.evalGames,
        gen: candidate.gen,
        searchContract: 'bag-expectimax-hold-v1',
        searchDepth: cfg.searchDepth,
        rootBeamWidth: cfg.rootBeamWidth,
        childBeamWidth: cfg.childBeamWidth,
        trainedAt: new Date().toISOString(),
      });
      console.log(
        `  saved qualified candidate at gen ${candidate.gen}: ` +
        `score rate ${candidate.scoreRate.toFixed(3)}`,
      );
    }

    const reevaluationEvent = buildReevaluationLogEntry({
      gen: state.gen,
      ts: Date.now(),
      searchContract: SEARCH_CONTRACT,
      searchDepth: cfg.searchDepth,
      rootBeamWidth: cfg.rootBeamWidth,
      childBeamWidth: cfg.childBeamWidth,
      schedule: {
        games: cfg.reevalGames,
        maxPieces: cfg.reevalMaxPieces,
        searchContract: 'bag-expectimax-hold-v1',
        searchDepth: cfg.searchDepth,
        rootBeamWidth: cfg.rootBeamWidth,
        childBeamWidth: cfg.childBeamWidth,
        baseSeed,
      },
      publishedBaseline: loggedReevaluation(publishedBaseline),
      currentQualified: currentQualified === null
        ? null
        : loggedReevaluation(currentQualified),
      candidate: loggedReevaluation(candidate),
      qualification,
    });
    appendFileSync(paths.log, `${JSON.stringify(reevaluationEvent)}\n`);
  }

  saveCheckpoint();
}

while (!stopping) {
  if (args.generations !== null && state.gen >= args.generations) break;
  await runGeneration();
}

saveCheckpoint();
console.log(
  bestQualifiedCandidate === null
    ? `stopped at gen ${state.gen}; qualified candidate none`
    : `stopped at gen ${state.gen}; qualified candidate score rate ` +
      `${bestQualifiedCandidate.scoreRate.toFixed(3)} (gen ${bestQualifiedCandidate.gen})`,
);
} finally {
  await pool.destroy();
}
}
} finally {
  runLock.release();
}
