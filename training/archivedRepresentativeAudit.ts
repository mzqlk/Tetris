import { createHash } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  type BigIntStats,
} from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertLineClearCounts,
  tetrisLineShare,
  totalLinesFromCounts,
  type LineClearCounts,
} from '../src/ai/lineClears';
import { hashSeed } from '../src/ai/rng';
import { type SimulationSearchDiagnostics } from '../src/ai/simulate';
import { type StrategyDiagnostics } from '../src/ai/tetrisStrategy';
import { normalize, parseWeightsFile, toVector } from '../src/ai/weights';
import { type PairedInterval } from './pairedStats';
import { aggregateFitness } from './cem';
import { pairedInterval30 } from './pairedStats';
import { WorkerPool, WorkerPoolAbortError, type SimTask, type SimTaskResult } from './pool';
import { fixedReevaluationSeeds } from './publication';
import {
  resolveRunPaths,
  validateCompatibleRunArtifactSnapshot,
  type RunPaths,
  type ScoreRateCheckpoint,
} from './runArtifacts';
import { SEARCH_METADATA, type SearchMetadata } from './objective';

export const C0_MODE = 'c0-archived-representative-audit' as const;
export const C0_SCHEDULE_ID = 'c0-archived-representative-audit-v1' as const;
export const C0_SOURCE_RUN = 'public/ai/score-rate-v5-smoke-20260820-200634' as const;
export const C0_BASE_SEED = 20260824 as const;
export const C0_HISTORICAL_PAIRED_SEED = 20260803 as const;
export const C0_GAMES = 30 as const;
export const C0_MAX_PIECES = 5000 as const;
export const C0_REPLAY_INDICES = [0, 29] as const;
export const C0_VECTOR_ORDER = [
  'published-baseline', 'gen6-best', 'gen9-best', 'gen10-mu',
] as const;

export type C0VectorId = typeof C0_VECTOR_ORDER[number];
export type C0CompletedStatus =
  | 'pass-retention-loss-supported' | 'fail-signal-not-reproduced' | 'fail-joint-improvement-not-shown';
export type C0AuditStatus = C0CompletedStatus | 'invalid-input' | 'runtime-fail';
export type C0CompletedFailureReason =
  | 'gen6-tetris-aggregate-below-0.01' | 'paired-tetris-lower-not-positive'
  | 'paired-score-lower-not-positive' | 'gen6-survival-lower';
export type C0InvalidInputReason =
  | 'source-hash-mismatch' | 'source-identity-drift' | 'run-contract-mismatch'
  | 'log-boundary-mismatch' | 'published-identity-mismatch'
  | 'vector-identity-mismatch' | 'seed-schedule-mismatch';
export type C0RuntimeFailureReason =
  | 'game-result-mismatch' | 'worker-pool-recovery' | 'worker-pool-failure'
  | 'worker-pool-destroy-failure' | 'nondeterministic-replay';

export interface C0Vector {
  id: C0VectorId;
  source: 'publishedBaseline.weights' | 'gen=6.bestWeights' | 'gen=9.bestWeights' | 'normalize(checkpoint.mu)';
  weights: number[];
  digest: string;
}
export interface C0Schedule {
  id: typeof C0_SCHEDULE_ID; baseSeed: typeof C0_BASE_SEED; seeds: number[]; seedDigest: string;
  games: typeof C0_GAMES; maxPieces: typeof C0_MAX_PIECES;
  vectorOrder: readonly C0VectorId[]; taskOrder: 'seed-major';
}
export interface C0ScheduleEvidence {
  id: typeof C0_SCHEDULE_ID; baseSeed: typeof C0_BASE_SEED; seedDigest: string;
  games: typeof C0_GAMES; maxPieces: typeof C0_MAX_PIECES;
  vectorOrder: readonly C0VectorId[]; taskOrder: 'seed-major'; replayIndices: readonly [0, 29];
}
export interface C0SourceBundle {
  sourceHashes: { checkpoint: string; log: string; bundledWeights: string; runtimeWeights: string; };
  vectors: readonly C0Vector[]; schedule: C0Schedule; checkpointWorkers: number;
}
export interface C0DeterministicGameProjection {
  vectorId: C0VectorId; gameIndex: number; seed: number; score: number; scoreRate: number;
  pieces: number; reason: 'pieceCap' | 'gameover'; clearCounts: LineClearCounts;
  tetrisLineShare: number; meanHeight: number; strategyDiagnostics: StrategyDiagnostics;
  searchDiagnostics: SimulationSearchDiagnostics;
}
export interface C0GameRecord { taskId: number; projection: C0DeterministicGameProjection; projectionDigest: string; }
export interface C0Comparison {
  role: 'primary' | 'negative-control' | 'qualification-context'; left: C0VectorId; right: C0VectorId;
  scoreRateInterval: PairedInterval; tetrisLineShareInterval: PairedInterval;
  leftTetrisLineShare: number; rightTetrisLineShare: number; leftPieceCapGames: number; rightPieceCapGames: number;
}
export interface C0VectorAggregate {
  id: C0VectorId; source: C0Vector['source']; digest: string; meanScore: number; scoreRate: number;
  meanLines: number; meanHeight: number; meanClearCounts: LineClearCounts; tetrisLineShare: number;
  pieceCapGames: number; gameoverGames: number; strategyDiagnostics: StrategyDiagnostics;
  searchDiagnostics: SimulationSearchDiagnostics;
}
export interface C0GateEvidence {
  scoreLowerPositive: boolean; tetrisLowerPositive: boolean; gen6AggregateTetrisAtLeastOnePercent: boolean;
  gen6SurvivalNonLower: boolean; allPairsComplete: true; deterministicReplay: true;
}
export interface C0ReplayEvidence {
  indices: readonly [0, 29]; recordCount: 8; deterministic: true; projectionDigests: string[];
}
export interface C0AuditProjection {
  mode: typeof C0_MODE; status: C0CompletedStatus; schedule: C0ScheduleEvidence;
  searchMetadata: SearchMetadata; sourceHashes: C0SourceBundle['sourceHashes'];
  vectors: C0VectorAggregate[]; comparisons: C0Comparison[]; gates: C0GateEvidence;
  failureReasons: C0CompletedFailureReason[]; replay: C0ReplayEvidence;
}
export interface C0AuditOutput extends C0AuditProjection { resultDigest: string; }
export type C0FailureOutput = {
  mode: typeof C0_MODE; status: 'invalid-input'; failureReasons: [C0InvalidInputReason]; resultDigest: string;
} | {
  mode: typeof C0_MODE; status: 'runtime-fail'; failureReasons: [C0RuntimeFailureReason]; resultDigest: string;
};

export class C0InvalidInputError extends Error {
  readonly name = 'C0InvalidInputError';
  constructor(readonly reason: C0InvalidInputReason) { super(`C0 invalid-input:${reason}`); }
}
export class C0RuntimeError extends Error {
  readonly name = 'C0RuntimeError';
  constructor(readonly reason: C0RuntimeFailureReason) { super(`C0 runtime-fail:${reason}`); }
}

export const C0_SOURCE_HASHES = Object.freeze({
  checkpoint: '93B2A63FF221B7E6EE1BD5CBFF8AE8C75B5B96411AD5B2EE4AFFA3806B6C06BD',
  log: 'C86457320694A8C2D85C734D64D9CE6E58166D913974F945370D15FBC7C651BA',
  bundledWeights: '062552496E7E1101502E62B8570DFDAF2A60B54EF4FEF1EA539723B910550D90',
  runtimeWeights: '062552496E7E1101502E62B8570DFDAF2A60B54EF4FEF1EA539723B910550D90',
});
export const C0_VECTOR_DIGESTS = Object.freeze({
  'published-baseline': 'f623fd7662d2b01b1c815d80897aa89379b72bbd66d654e1bbfe31e46ca7a67d',
  'gen6-best': '233cc500168fe7258305d87654a640ad9aef3f67092d5e0e016f910b9d660ca9',
  'gen9-best': 'f67d20457d421dbf4778e8c5196fd9611c711ba453e8e8fac0c2afe7a49be141',
  'gen10-mu': 'b669671a3cf0132db1e2948cc610aef98bf22a0284f182ac248a74fdf3234b1b',
});
const C0_VECTOR_L2 = Object.freeze({
  'published-baseline': 1.0000000000000002,
  'gen6-best': 0.9999999999999999,
  'gen9-best': 1,
  'gen10-mu': 1.0000000000000002,
});
const C0_VECTOR_SOURCES = Object.freeze({
  'published-baseline': 'publishedBaseline.weights',
  'gen6-best': 'gen=6.bestWeights',
  'gen9-best': 'gen=9.bestWeights',
  'gen10-mu': 'normalize(checkpoint.mu)',
});
export const C0_RAW_MU_DIGEST = '35c5623d1b07866673c636a0c1bf26fa32e53baf9ca9726482ec582261e62152';
export const C0_SEED_DIGEST = '1c2ce47837f0483d3f366a6817a29d88614029febfd6aca6dd42e376873b204b';

export interface C0ValidatedRunSnapshot {
  checkpoint: ScoreRateCheckpoint;
  records: readonly Record<string, unknown>[];
  sourceHashes: { checkpoint: string; log: string };
}

export interface C0SourceDependencies {
  root: string;
  loadValidatedRunSnapshot(paths: RunPaths): C0ValidatedRunSnapshot;
  hashRegularFile(path: string): string;
  readPublishedVector(path: string): number[];
}

export interface C0Pool {
  run(tasks: SimTask[], options?: { signal?: AbortSignal }): Promise<SimTaskResult[]>;
  destroy(): Promise<void>;
}

export interface C0AuditDependencies {
  loadSources(): C0SourceBundle;
  createPool(size: number): Promise<C0Pool>;
  logicalCpuCount(): number;
}

export interface C0CliResult {
  exitCode: 0 | 1 | 130;
  stdout: string;
  stderr: string;
}

const digest = (value: unknown): string => createHash('sha256')
  .update(JSON.stringify(value), 'utf8').digest('hex');
const sameNumbers = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
const finiteVector = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length === 13 && value.every(Number.isFinite);
const assert: (condition: unknown, reason: C0InvalidInputReason) => asserts condition = (condition, reason) => {
  if (!condition) throw new C0InvalidInputError(reason);
};

function sameIdentity(left: { dev: number | bigint; ino: number | bigint }, right: { dev: number | bigint; ino: number | bigint }): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

interface StableRead {
  bytes: Buffer;
  signature: {
    dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint; birthtimeNs: bigint;
  };
}

function stableSignature(stats: {
  dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint; birthtimeNs: bigint;
}): StableRead['signature'] {
  const { dev, ino, size, mtimeNs, ctimeNs, birthtimeNs } = stats;
  return { dev, ino, size, mtimeNs, ctimeNs, birthtimeNs };
}

function sameSignature(left: StableRead['signature'], right: StableRead['signature']): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.birthtimeNs === right.birthtimeNs;
}

function readStableRegularFile(
  path: string,
  before: BigIntStats = lstatSync(path, { bigint: true }),
): StableRead {
  if (!before.isFile() || before.isSymbolicLink()) throw new C0InvalidInputError('source-identity-drift');
  const descriptor = openSync(path, 'r');
  try {
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (!openedBefore.isFile() || !sameIdentity(before, openedBefore)) throw new C0InvalidInputError('source-identity-drift');
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const after = lstatSync(path, { bigint: true });
    const beforeSignature = stableSignature(before);
    if (!openedAfter.isFile() || !after.isFile() || after.isSymbolicLink() ||
      !sameSignature(beforeSignature, stableSignature(openedBefore)) ||
      !sameSignature(beforeSignature, stableSignature(openedAfter)) ||
      !sameSignature(beforeSignature, stableSignature(after)) || BigInt(bytes.length) !== before.size) {
      throw new C0InvalidInputError('source-identity-drift');
    }
    return { bytes, signature: beforeSignature };
  } finally { closeSync(descriptor); }
}

function readOptionalStableRegularFile(path: string): StableRead | null {
  let before: BigIntStats;
  try {
    before = lstatSync(path, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return readStableRegularFile(path, before);
}

function defaultDependencies(root: string): C0SourceDependencies {
  const snapshots = new Map<string, StableRead>();
  const optionalSnapshots = new Map<string, StableRead | null>();
  const pin = (path: string, snapshot: StableRead): Buffer => {
    const previous = snapshots.get(path);
    if (previous !== undefined && (!sameSignature(previous.signature, snapshot.signature) ||
      !previous.bytes.equals(snapshot.bytes))) {
      throw new C0InvalidInputError('source-identity-drift');
    }
    if (previous === undefined) snapshots.set(path, snapshot);
    return previous?.bytes ?? snapshot.bytes;
  };
  const sourceRead = <T>(read: () => T): T => {
    try {
      return read();
    } catch (error) {
      if (error instanceof C0InvalidInputError) throw error;
      throw new C0InvalidInputError('source-identity-drift');
    }
  };
  const readPinned = (path: string): Buffer => sourceRead(
    () => pin(path, readStableRegularFile(path)),
  );
  const readOptionalPinned = (path: string): Buffer | null => sourceRead(() => {
    const snapshot = readOptionalStableRegularFile(path);
    if (!optionalSnapshots.has(path)) {
      optionalSnapshots.set(path, snapshot);
      return snapshot === null ? null : pin(path, snapshot);
    }
    const previous = optionalSnapshots.get(path)!;
    if (previous === null || snapshot === null) {
      if (previous !== snapshot) throw new C0InvalidInputError('source-identity-drift');
      return null;
    }
    return pin(path, snapshot);
  });
  const recordsFromPinnedLog = (logBytes: Buffer): readonly Record<string, unknown>[] => {
    const text = logBytes.toString('utf8');
    if (!text.endsWith('\n')) throw new C0InvalidInputError('log-boundary-mismatch');
    try { return text.slice(0, -1).split('\n').map((line) => JSON.parse(line) as Record<string, unknown>); }
    catch { throw new C0InvalidInputError('log-boundary-mismatch'); }
  };
  return {
    root,
    loadValidatedRunSnapshot: (paths) => {
      const checkpointBytes = readPinned(paths.checkpoint);
      const logBytes = readPinned(paths.log);
      const candidateBytes = readOptionalPinned(paths.candidate);
      const recordsBeforeValidation = recordsFromPinnedLog(logBytes);
      let validation: { checkpoint: ScoreRateCheckpoint } | { failure: unknown };
      try {
        validation = {
          checkpoint: validateCompatibleRunArtifactSnapshot({
            checkpointBytes,
            logBytes,
            candidateBytes,
          }),
        };
      } catch (failure) {
        validation = { failure };
      }
      readOptionalPinned(paths.candidate);
      if ('failure' in validation) throw validation.failure;
      const records = recordsFromPinnedLog(logBytes);
      if (JSON.stringify(recordsBeforeValidation) !== JSON.stringify(records)) {
        throw new C0InvalidInputError('source-identity-drift');
      }
      const afterCheckpointBytes = readPinned(paths.checkpoint);
      const afterLogBytes = readPinned(paths.log);
      const sourceHashes = {
        checkpoint: createHash('sha256').update(checkpointBytes).digest('hex').toUpperCase(),
        log: createHash('sha256').update(logBytes).digest('hex').toUpperCase(),
      };
      if (!checkpointBytes.equals(afterCheckpointBytes) || !logBytes.equals(afterLogBytes)) {
        throw new C0InvalidInputError('source-identity-drift');
      }
      return { checkpoint: validation.checkpoint, records, sourceHashes };
    },
    hashRegularFile: (path) => {
      const bytes = readPinned(path);
      return createHash('sha256').update(bytes).digest('hex').toUpperCase();
    },
    readPublishedVector: (path) => {
      try {
        const parsed = parseWeightsFile(JSON.parse(readPinned(path).toString('utf8')));
        if (parsed === null) throw new Error('invalid weights');
        return toVector(parsed.weights);
      } catch (error) {
        if (error instanceof C0InvalidInputError) throw error;
        throw new C0InvalidInputError('published-identity-mismatch');
      }
    },
  };
}

function validateRunContract(checkpoint: ScoreRateCheckpoint): void {
  assert(
    checkpoint.version === 6 && checkpoint.objective === 'score-rate-v5' &&
    checkpoint.gen === 10 && checkpoint.baseSeed === 20260727 && checkpoint.maxPieces === 2000 &&
    checkpoint.config.baseSeed === 20260727 && checkpoint.config.gamesPerCandidate === 5 &&
    checkpoint.config.reevalEvery === 10 && checkpoint.config.reevalGames === 30 &&
    checkpoint.config.reevalMaxPieces === 5000 && checkpoint.publishedBaseline !== null &&
    checkpoint.bestQualifiedCandidate === null &&
    Object.entries(SEARCH_METADATA).every(([key, value]) =>
      checkpoint[key as keyof SearchMetadata] === value),
    'run-contract-mismatch',
  );
}

function vector(id: C0VectorId, source: C0Vector['source'], weights: unknown, expectedDigest: string, expectedL2: number): C0Vector {
  assert(finiteVector(weights), 'vector-identity-mismatch');
  const l2 = Math.hypot(...weights);
  assert(Math.abs(l2 - expectedL2) <= 1e-15 && digest(weights) === expectedDigest, 'vector-identity-mismatch');
  return { id, source, weights: [...weights], digest: expectedDigest };
}

function sourcePaths(root: string): { paths: RunPaths; bundledWeights: string; runtimeWeights: string } {
  return {
    paths: resolveRunPaths(root, C0_SOURCE_RUN),
    bundledWeights: resolve(root, 'src/ai/trained-weights.json'),
    runtimeWeights: resolve(root, 'public/ai/best-weights.json'),
  };
}

function fingerprint(dependencies: C0SourceDependencies, paths: ReturnType<typeof sourcePaths>): C0SourceBundle['sourceHashes'] {
  return {
    checkpoint: dependencies.hashRegularFile(paths.paths.checkpoint),
    log: dependencies.hashRegularFile(paths.paths.log),
    bundledWeights: dependencies.hashRegularFile(paths.bundledWeights),
    runtimeWeights: dependencies.hashRegularFile(paths.runtimeWeights),
  };
}

function sameHashes(left: C0SourceBundle['sourceHashes'], right: C0SourceBundle['sourceHashes']): boolean {
  return (Object.keys(C0_SOURCE_HASHES) as (keyof C0SourceBundle['sourceHashes'])[])
    .every((key) => left[key] === right[key]);
}

function assertC0SourceHashes(hashes: C0SourceBundle['sourceHashes']): void {
  assert(sameHashes(hashes, C0_SOURCE_HASHES), 'source-hash-mismatch');
}

export function loadC0ValidatedRunSnapshot(
  dependencies: C0SourceDependencies = defaultDependencies(process.cwd()),
): C0ValidatedRunSnapshot {
  try {
    const paths = sourcePaths(dependencies.root).paths;
    const snapshot = dependencies.loadValidatedRunSnapshot(paths);
    assert(snapshot.sourceHashes.checkpoint === C0_SOURCE_HASHES.checkpoint && snapshot.sourceHashes.log === C0_SOURCE_HASHES.log,
      'source-hash-mismatch');
    const checkpoint = snapshot.checkpoint;
    validateRunContract(checkpoint);
    const records = snapshot.records;
    assert(records.length === 11, 'log-boundary-mismatch');
    const generations = records.slice(0, 10);
    assert(generations.every((record, gen) => record.gen === gen && Object.prototype.hasOwnProperty.call(record, 'bestWeights')),
      'log-boundary-mismatch');
    const finalRecord = records[10];
    assert(finalRecord.kind === 'reevaluation' && finalRecord.gen === 10, 'log-boundary-mismatch');
    return { checkpoint: structuredClone(checkpoint), records: structuredClone(records), sourceHashes: { ...snapshot.sourceHashes } };
  } catch (error) {
    if (error instanceof C0InvalidInputError) throw error;
    throw new C0InvalidInputError('run-contract-mismatch');
  }
}

export function loadC0Sources(dependencies: C0SourceDependencies = defaultDependencies(process.cwd())): C0SourceBundle {
  try {
    const paths = sourcePaths(dependencies.root);
    const snapshot = loadC0ValidatedRunSnapshot(dependencies);
    const checkpoint = snapshot.checkpoint;
    const records = snapshot.records;
    const generations = records.slice(0, 10);
    const before = { ...snapshot.sourceHashes,
      bundledWeights: dependencies.hashRegularFile(paths.bundledWeights),
      runtimeWeights: dependencies.hashRegularFile(paths.runtimeWeights) };
    assertC0SourceHashes(before);

    const publishedBaseline = checkpoint.publishedBaseline!.weights;
    const bundled = dependencies.readPublishedVector(paths.bundledWeights);
    const runtime = dependencies.readPublishedVector(paths.runtimeWeights);
    assert(sameNumbers(publishedBaseline, bundled) && sameNumbers(publishedBaseline, runtime), 'published-identity-mismatch');

    const rawMu = checkpoint.mu;
    assert(finiteVector(rawMu) && Math.abs(Math.hypot(...rawMu) - 0.6291257579420081) <= 1e-15 &&
      digest(rawMu) === C0_RAW_MU_DIGEST, 'vector-identity-mismatch');
    const vectors = [
      vector('published-baseline', 'publishedBaseline.weights', publishedBaseline, C0_VECTOR_DIGESTS['published-baseline'], 1.0000000000000002),
      vector('gen6-best', 'gen=6.bestWeights', generations[6].bestWeights, C0_VECTOR_DIGESTS['gen6-best'], 0.9999999999999999),
      vector('gen9-best', 'gen=9.bestWeights', generations[9].bestWeights, C0_VECTOR_DIGESTS['gen9-best'], 1),
      vector('gen10-mu', 'normalize(checkpoint.mu)', normalize(rawMu), C0_VECTOR_DIGESTS['gen10-mu'], 1.0000000000000002),
    ];
    assert(new Set(vectors.map(({ digest: value }) => value)).size === vectors.length, 'vector-identity-mismatch');

    const after = fingerprint(dependencies, paths);
    assert(sameHashes(before, after), 'source-identity-drift');
    return { sourceHashes: before, vectors, schedule: buildC0Schedule(checkpoint), checkpointWorkers: checkpoint.config.workers };
  } catch (error) {
    if (error instanceof C0InvalidInputError) throw error;
    throw new C0InvalidInputError('run-contract-mismatch');
  }
}

export function assertC0SeedSeparation(seeds: readonly number[], checkpoint: ScoreRateCheckpoint): void {
  const training = Array.from({ length: 10 }, (_, gen) =>
    Array.from({ length: checkpoint.config.gamesPerCandidate }, (_, gameIndex) =>
      hashSeed(checkpoint.baseSeed, gen, gameIndex))).flat();
  const fixed = fixedReevaluationSeeds(checkpoint.baseSeed, C0_GAMES);
  const paired = Array.from({ length: C0_GAMES }, (_, gameIndex) => hashSeed(C0_HISTORICAL_PAIRED_SEED, gameIndex));
  const unique = new Set(seeds);
  assert(seeds.length === C0_GAMES && unique.size === C0_GAMES &&
    !seeds.some((seed) => training.includes(seed) || fixed.includes(seed) || paired.includes(seed)),
  'seed-schedule-mismatch');
}

export function buildC0Schedule(checkpoint: ScoreRateCheckpoint): C0Schedule {
  const seeds = Array.from({ length: C0_GAMES }, (_, gameIndex) => hashSeed(C0_BASE_SEED, gameIndex));
  assert(digest(seeds) === C0_SEED_DIGEST, 'seed-schedule-mismatch');
  assertC0SeedSeparation(seeds, checkpoint);
  return {
    id: C0_SCHEDULE_ID, baseSeed: C0_BASE_SEED, seeds, seedDigest: C0_SEED_DIGEST,
    games: C0_GAMES, maxPieces: C0_MAX_PIECES, vectorOrder: C0_VECTOR_ORDER, taskOrder: 'seed-major',
  };
}

const runtime: (condition: unknown, reason?: C0RuntimeFailureReason) => asserts condition =
  (condition, reason = 'game-result-mismatch') => {
  if (!condition) throw new C0RuntimeError(reason);
};
const safeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const finiteInRange = (value: unknown, lower: number, upper: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= lower && value <= upper;
const sameFloat = (left: number, right: number): boolean => Math.abs(left - right) <= 1e-12;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function validateSearchDiagnostics(input: unknown): asserts input is SimulationSearchDiagnostics {
  runtime(isRecord(input));
  const search = input as unknown as SimulationSearchDiagnostics;
  const countFields = [
    'searchCalls', 'holdActions', 'totalWorkUnitsUsed', 'maxWorkUnitsUsed',
    'budgetExhaustedSearches', 'placementEvaluationUnits', 'chanceExpansionUnits',
    'cacheHitUnits', 'expandedDecisionNodes', 'expandedChanceNodes', 'cacheHits',
  ] as const;
  for (const field of countFields) runtime(safeNonNegativeInteger(search[field]));
  runtime(search.holdActions <= search.searchCalls && search.budgetExhaustedSearches <= search.searchCalls);
  runtime(Array.isArray(search.completedDepthHistogram) && search.completedDepthHistogram.length === 5 &&
    search.completedDepthHistogram.every(safeNonNegativeInteger));
  const histogram = search.completedDepthHistogram;
  runtime(histogram.reduce((sum, count) => sum + count, 0) === search.searchCalls);
  const depthTotal = histogram.reduce((sum, count, depth) => sum + depth * count, 0);
  const expectedMinDepth = search.searchCalls === 0 ? 0 : histogram.findIndex((count) => count > 0);
  runtime(finiteInRange(search.holdRate, 0, 1) && finiteInRange(search.meanCompletedDepth, 0, 4) &&
    finiteInRange(search.minCompletedDepth, 0, 4) && finiteInRange(search.meanWorkUnitsUsed, 0, Number.MAX_VALUE) &&
    finiteInRange(search.budgetExhaustionRate, 0, 1));
  runtime(sameFloat(search.holdRate, search.searchCalls === 0 ? 0 : search.holdActions / search.searchCalls));
  runtime(sameFloat(search.meanCompletedDepth, search.searchCalls === 0 ? 0 : depthTotal / search.searchCalls));
  runtime(search.minCompletedDepth === expectedMinDepth);
  runtime(sameFloat(search.meanWorkUnitsUsed, search.searchCalls === 0 ? 0 : search.totalWorkUnitsUsed / search.searchCalls));
  runtime(sameFloat(search.budgetExhaustionRate, search.searchCalls === 0 ? 0 : search.budgetExhaustedSearches / search.searchCalls));
  runtime(search.totalWorkUnitsUsed === search.placementEvaluationUnits + search.chanceExpansionUnits + search.cacheHitUnits);
  runtime(search.totalWorkUnitsUsed <= search.searchCalls * C0_MAX_WORK_UNITS &&
    search.maxWorkUnitsUsed <= C0_MAX_WORK_UNITS && search.maxWorkUnitsUsed <= search.totalWorkUnitsUsed &&
    search.maxWorkUnitsUsed >= search.meanWorkUnitsUsed);
  runtime(search.searchCalls !== 0 || (search.expandedDecisionNodes === 0 &&
    search.expandedChanceNodes === 0 && search.cacheHits === 0));
}

const C0_MAX_WORK_UNITS = SEARCH_METADATA.maxWorkUnits;

function validateGameResult(result: SimTaskResult): asserts result is SimTaskResult & { reason: 'pieceCap' | 'gameover' } {
  runtime(!result.failed && result.reason !== 'error');
  runtime(safeNonNegativeInteger(result.score) && safeNonNegativeInteger(result.lines) && safeNonNegativeInteger(result.pieces));
  runtime(result.pieces <= C0_MAX_PIECES && finiteInRange(result.meanHeight, 0, 20));
  runtime(result.reason === 'pieceCap' || result.reason === 'gameover');
  runtime(result.reason !== 'pieceCap' || result.pieces === C0_MAX_PIECES);
  try {
    assertLineClearCounts(result.clearCounts, true);
    runtime(totalLinesFromCounts(result.clearCounts) === result.lines);
  } catch { throw new C0RuntimeError('game-result-mismatch'); }
  runtime(isRecord(result.strategyDiagnostics));
  for (const field of ['meanCleanWellDepth', 'meanTetrisSetupProgress', 'meanTetrisReadyRows'] as const) {
    runtime(finiteInRange(result.strategyDiagnostics[field], 0, 4));
  }
  validateSearchDiagnostics(result.searchDiagnostics);
}

function canonicalStrategyDiagnostics(input: StrategyDiagnostics): StrategyDiagnostics {
  return {
    meanCleanWellDepth: input.meanCleanWellDepth,
    meanTetrisSetupProgress: input.meanTetrisSetupProgress,
    meanTetrisReadyRows: input.meanTetrisReadyRows,
  };
}

function canonicalSearchDiagnostics(input: SimulationSearchDiagnostics): SimulationSearchDiagnostics {
  return {
    searchCalls: input.searchCalls, holdActions: input.holdActions, holdRate: input.holdRate,
    meanCompletedDepth: input.meanCompletedDepth, minCompletedDepth: input.minCompletedDepth,
    completedDepthHistogram: [...input.completedDepthHistogram] as [number, number, number, number, number],
    totalWorkUnitsUsed: input.totalWorkUnitsUsed, meanWorkUnitsUsed: input.meanWorkUnitsUsed,
    maxWorkUnitsUsed: input.maxWorkUnitsUsed, budgetExhaustedSearches: input.budgetExhaustedSearches,
    budgetExhaustionRate: input.budgetExhaustionRate, placementEvaluationUnits: input.placementEvaluationUnits,
    chanceExpansionUnits: input.chanceExpansionUnits, cacheHitUnits: input.cacheHitUnits,
    expandedDecisionNodes: input.expandedDecisionNodes, expandedChanceNodes: input.expandedChanceNodes,
    cacheHits: input.cacheHits,
  };
}

function projectGame(task: SimTask, result: SimTaskResult, vectorId: C0VectorId, gameIndex: number): C0GameRecord {
  runtime(result.taskId === task.taskId);
  validateGameResult(result);
  const projection: C0DeterministicGameProjection = {
    vectorId, gameIndex, seed: task.seed, score: result.score, scoreRate: result.score / C0_MAX_PIECES,
    pieces: result.pieces, reason: result.reason, clearCounts: { ...result.clearCounts },
    tetrisLineShare: tetrisLineShare(result.clearCounts), meanHeight: result.meanHeight,
    strategyDiagnostics: canonicalStrategyDiagnostics(result.strategyDiagnostics),
    searchDiagnostics: canonicalSearchDiagnostics(result.searchDiagnostics),
  };
  return { taskId: task.taskId, projection, projectionDigest: digest(projection) };
}

function validateSourceBundle(sources: C0SourceBundle): void {
  runtime(sameHashes(sources.sourceHashes, C0_SOURCE_HASHES));
  runtime(sources.vectors.length === C0_VECTOR_ORDER.length && sources.schedule.id === C0_SCHEDULE_ID &&
    sources.schedule.baseSeed === C0_BASE_SEED && sources.schedule.seedDigest === C0_SEED_DIGEST &&
    sources.schedule.games === C0_GAMES && sources.schedule.maxPieces === C0_MAX_PIECES &&
    sources.schedule.taskOrder === 'seed-major' && sources.schedule.vectorOrder.length === C0_VECTOR_ORDER.length &&
    sources.schedule.vectorOrder.every((id, index) => id === C0_VECTOR_ORDER[index]) &&
    sources.schedule.seeds.length === C0_GAMES &&
    sources.schedule.seeds.every((seed, index) => seed === hashSeed(C0_BASE_SEED, index)) &&
     sources.vectors.every((vector, index) => {
       const id = C0_VECTOR_ORDER[index];
       return id !== undefined && vector.id === id && vector.source === C0_VECTOR_SOURCES[id] &&
         finiteVector(vector.weights) && Math.abs(Math.hypot(...vector.weights) - C0_VECTOR_L2[id]) <= 1e-15 &&
         digest(vector.weights) === C0_VECTOR_DIGESTS[id] && vector.digest === C0_VECTOR_DIGESTS[id];
     }));
}

function snapshotC0SourceBundle(sources: C0SourceBundle): C0SourceBundle {
  return {
    sourceHashes: { ...sources.sourceHashes },
    vectors: sources.vectors.map((vector) => ({ ...vector, weights: [...vector.weights] })),
    schedule: {
      ...sources.schedule, seeds: [...sources.schedule.seeds], vectorOrder: [...sources.schedule.vectorOrder],
    },
    checkpointWorkers: sources.checkpointWorkers,
  };
}

export function buildC0PrimaryTasks(sources: C0SourceBundle): SimTask[] {
  validateSourceBundle(sources);
  return sources.schedule.seeds.flatMap((seed, gameIndex) => sources.vectors.map((vector, vectorIndex) => ({
    taskId: gameIndex * C0_VECTOR_ORDER.length + vectorIndex,
    weights: [...vector.weights], seed, maxPieces: C0_MAX_PIECES,
  })));
}

export function buildC0ReplayTasks(sources: C0SourceBundle): SimTask[] {
  const primary = buildC0PrimaryTasks(sources);
  return C0_REPLAY_INDICES.flatMap((gameIndex) => primary.slice(
    gameIndex * C0_VECTOR_ORDER.length,
    (gameIndex + 1) * C0_VECTOR_ORDER.length,
  ));
}

function projectResults(sources: C0SourceBundle, tasks: readonly SimTask[], results: readonly SimTaskResult[], expectedGames: readonly number[]): C0GameRecord[] {
  validateSourceBundle(sources);
  runtime(tasks.length === expectedGames.length * C0_VECTOR_ORDER.length && results.length === tasks.length);
  return tasks.map((task, position) => {
    const gameIndex = expectedGames[Math.floor(position / C0_VECTOR_ORDER.length)];
    const vectorIndex = position % C0_VECTOR_ORDER.length;
    const vector = sources.vectors[vectorIndex];
    runtime(task.taskId === gameIndex * C0_VECTOR_ORDER.length + vectorIndex && task.seed === sources.schedule.seeds[gameIndex] &&
      task.maxPieces === C0_MAX_PIECES && vector !== undefined && sameNumbers(task.weights, vector.weights));
    return projectGame(task, results[position], vector.id, gameIndex);
  });
}

export function projectC0PrimaryResults(
  sources: C0SourceBundle,
  tasks: readonly SimTask[],
  results: readonly SimTaskResult[],
): C0GameRecord[] {
  return projectResults(sources, tasks, results, Array.from({ length: C0_GAMES }, (_, gameIndex) => gameIndex));
}

export function projectC0ReplayResults(
  sources: C0SourceBundle,
  tasks: readonly SimTask[],
  results: readonly SimTaskResult[],
): C0GameRecord[] {
  return projectResults(sources, tasks, results, C0_REPLAY_INDICES);
}

function validateRecords(records: readonly C0GameRecord[], expectedGames: readonly number[]): void {
  runtime(records.length === expectedGames.length * C0_VECTOR_ORDER.length);
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const gameIndex = expectedGames[Math.floor(index / C0_VECTOR_ORDER.length)];
    const vectorIndex = index % C0_VECTOR_ORDER.length;
    const projection = record.projection;
    runtime(record.taskId === gameIndex * C0_VECTOR_ORDER.length + vectorIndex &&
      projection.vectorId === C0_VECTOR_ORDER[vectorIndex] && projection.gameIndex === gameIndex &&
      projection.seed === hashSeed(C0_BASE_SEED, gameIndex) && Object.is(projection.scoreRate, projection.score / C0_MAX_PIECES) &&
      Object.is(projection.tetrisLineShare, tetrisLineShare(projection.clearCounts)) &&
      record.projectionDigest === digest(projection));
    validateGameResult({ ...projection, lines: totalLinesFromCounts(projection.clearCounts), failed: false, taskId: record.taskId });
  }
}

function toAggregateFitnessResult(record: C0GameRecord): {
  score: number; lines: number; pieces: number; meanHeight: number; clearCounts: LineClearCounts;
  strategyDiagnostics: StrategyDiagnostics; searchDiagnostics: SimulationSearchDiagnostics; reason: 'gameover' | 'pieceCap';
} {
  const { projection } = record;
  return {
    score: projection.score, lines: totalLinesFromCounts(projection.clearCounts), pieces: projection.pieces,
    meanHeight: projection.meanHeight, clearCounts: projection.clearCounts,
    strategyDiagnostics: projection.strategyDiagnostics, searchDiagnostics: projection.searchDiagnostics, reason: projection.reason,
  };
}

function comparison(
  role: C0Comparison['role'], left: C0VectorAggregate, right: C0VectorAggregate,
  recordsByVector: ReadonlyMap<C0VectorId, readonly C0GameRecord[]>,
): C0Comparison {
  const leftRecords = recordsByVector.get(left.id)!;
  const rightRecords = recordsByVector.get(right.id)!;
  return {
    role, left: left.id, right: right.id,
    scoreRateInterval: pairedInterval30(leftRecords.map((record, index) =>
      record.projection.scoreRate - rightRecords[index].projection.scoreRate)),
    tetrisLineShareInterval: pairedInterval30(leftRecords.map((record, index) =>
      record.projection.tetrisLineShare - rightRecords[index].projection.tetrisLineShare)),
    leftTetrisLineShare: left.tetrisLineShare, rightTetrisLineShare: right.tetrisLineShare,
    leftPieceCapGames: left.pieceCapGames, rightPieceCapGames: right.pieceCapGames,
  };
}

function scheduleEvidence(schedule: C0Schedule): C0ScheduleEvidence {
  return {
    id: schedule.id, baseSeed: schedule.baseSeed, seedDigest: schedule.seedDigest,
    games: schedule.games, maxPieces: schedule.maxPieces, vectorOrder: [...schedule.vectorOrder],
    taskOrder: schedule.taskOrder, replayIndices: [...C0_REPLAY_INDICES] as [0, 29],
  };
}

export function evaluateC0Audit(
  sources: C0SourceBundle,
  primaryRecords: readonly C0GameRecord[],
  replayRecords: readonly C0GameRecord[],
): C0AuditOutput {
  validateSourceBundle(sources);
  const games = Array.from({ length: C0_GAMES }, (_, gameIndex) => gameIndex);
  validateRecords(primaryRecords, games);
  try { validateRecords(replayRecords, C0_REPLAY_INDICES); }
  catch { throw new C0RuntimeError('nondeterministic-replay'); }
  for (const replay of replayRecords) {
    const primary = primaryRecords[replay.taskId];
    runtime(primary !== undefined && JSON.stringify(replay.projection) === JSON.stringify(primary.projection) &&
      replay.projectionDigest === primary.projectionDigest, 'nondeterministic-replay');
  }

  const recordsByVector = new Map<C0VectorId, readonly C0GameRecord[]>(C0_VECTOR_ORDER.map((vectorId) => [
    vectorId,
    primaryRecords.filter((record) => record.projection.vectorId === vectorId),
  ]));
  for (const records of recordsByVector.values()) runtime(records.length === C0_GAMES &&
    records.every((record, gameIndex) => record.projection.gameIndex === gameIndex));
  const vectorMajorResults = C0_VECTOR_ORDER.flatMap((vectorId) =>
    recordsByVector.get(vectorId)!.map(toAggregateFitnessResult));
  const stats = aggregateFitness(vectorMajorResults, C0_VECTOR_ORDER.length, C0_GAMES, C0_MAX_PIECES);
  const vectors = C0_VECTOR_ORDER.map((id, index): C0VectorAggregate => {
    const source = sources.vectors[index];
    runtime(source?.id === id);
    return {
      id, source: source.source, digest: source.digest, meanScore: stats.meanScore[index], scoreRate: stats.fitness[index],
      meanLines: stats.meanLines[index], meanHeight: stats.meanHeight[index], meanClearCounts: stats.meanClearCounts[index],
      tetrisLineShare: stats.tetrisLineShares[index], pieceCapGames: stats.survivalDiagnostics[index].pieceCapGames,
      gameoverGames: stats.survivalDiagnostics[index].gameoverGames, strategyDiagnostics: stats.meanStrategyDiagnostics[index],
      searchDiagnostics: stats.meanSearchDiagnostics[index],
    };
  });
  const byId = new Map(vectors.map((vector) => [vector.id, vector]));
  const gen6 = byId.get('gen6-best')!;
  const gen9 = byId.get('gen9-best')!;
  const baseline = byId.get('published-baseline')!;
  const gen10Mu = byId.get('gen10-mu')!;
  const comparisons = [
    comparison('primary', gen6, gen10Mu, recordsByVector),
    comparison('negative-control', gen9, gen10Mu, recordsByVector),
    comparison('qualification-context', gen6, baseline, recordsByVector),
    comparison('qualification-context', gen9, baseline, recordsByVector),
  ];
  const primary = comparisons[0];
  const gates: C0GateEvidence = {
    scoreLowerPositive: primary.scoreRateInterval.lower > 0,
    tetrisLowerPositive: primary.tetrisLineShareInterval.lower > 0,
    gen6AggregateTetrisAtLeastOnePercent: gen6.tetrisLineShare >= 0.01,
    gen6SurvivalNonLower: gen6.pieceCapGames >= gen10Mu.pieceCapGames,
    allPairsComplete: true, deterministicReplay: true,
  };
  const failureReasons: C0CompletedFailureReason[] = [];
  if (!gates.gen6AggregateTetrisAtLeastOnePercent) failureReasons.push('gen6-tetris-aggregate-below-0.01');
  if (!gates.tetrisLowerPositive) failureReasons.push('paired-tetris-lower-not-positive');
  if (!gates.scoreLowerPositive) failureReasons.push('paired-score-lower-not-positive');
  if (!gates.gen6SurvivalNonLower) failureReasons.push('gen6-survival-lower');
  const status: C0CompletedStatus =
    gen6.tetrisLineShare < 0.01 || primary.tetrisLineShareInterval.lower <= 0
      ? 'fail-signal-not-reproduced'
      : primary.scoreRateInterval.lower <= 0 || gen6.pieceCapGames < gen10Mu.pieceCapGames
        ? 'fail-joint-improvement-not-shown'
        : 'pass-retention-loss-supported';
  const projection: C0AuditProjection = {
    mode: C0_MODE, status, schedule: scheduleEvidence(sources.schedule), searchMetadata: SEARCH_METADATA,
    sourceHashes: { ...sources.sourceHashes }, vectors, comparisons, gates, failureReasons,
    replay: { indices: [...C0_REPLAY_INDICES] as [0, 29], recordCount: 8, deterministic: true,
      projectionDigests: replayRecords.map((record) => record.projectionDigest) },
  };
  return { ...projection, resultDigest: digest(projection) };
}

export function failureC0Audit(status: 'invalid-input', reason: C0InvalidInputReason): C0FailureOutput;
export function failureC0Audit(status: 'runtime-fail', reason: C0RuntimeFailureReason): C0FailureOutput;
export function failureC0Audit(status: 'invalid-input' | 'runtime-fail', reason: C0InvalidInputReason | C0RuntimeFailureReason): C0FailureOutput {
  const invalidReasons: readonly C0InvalidInputReason[] = [
    'source-hash-mismatch', 'source-identity-drift', 'run-contract-mismatch', 'log-boundary-mismatch',
    'published-identity-mismatch', 'vector-identity-mismatch', 'seed-schedule-mismatch',
  ];
  runtime((status === 'invalid-input' && invalidReasons.includes(reason as C0InvalidInputReason)) ||
    (status === 'runtime-fail' && !invalidReasons.includes(reason as C0InvalidInputReason)));
  const projection = { mode: C0_MODE, status, failureReasons: [reason] } as const;
  return { ...projection, resultDigest: digest(projection) } as C0FailureOutput;
}

export function serializeC0Audit(output: C0AuditOutput | C0FailureOutput): string {
  return JSON.stringify(output);
}

class C0AbortError extends Error {
  constructor() { super('C0 audit aborted'); }
}

function defaultAuditDependencies(): C0AuditDependencies {
  return {
    loadSources: () => loadC0Sources(),
    createPool: (size) => WorkerPool.create(size),
    logicalCpuCount: () => cpus().length,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new C0AbortError();
}

async function runStrictPool(
  pool: C0Pool,
  tasks: SimTask[],
  parentSignal: AbortSignal | undefined,
): Promise<SimTaskResult[]> {
  throwIfAborted(parentSignal);
  const controller = new AbortController();
  let recoveryObserved = false;
  const forwardAbort = () => controller.abort();
  const originalWarn = console.warn;
  console.warn = () => {
    recoveryObserved = true;
    controller.abort();
  };
  parentSignal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const results = await pool.run(tasks, { signal: controller.signal });
    if (recoveryObserved) throw new C0RuntimeError('worker-pool-recovery');
    throwIfAborted(parentSignal);
    return results;
  } catch (error) {
    if (recoveryObserved) throw new C0RuntimeError('worker-pool-recovery');
    if (error instanceof WorkerPoolAbortError || parentSignal?.aborted || controller.signal.aborted) {
      throw new C0AbortError();
    }
    if (error instanceof C0RuntimeError) throw error;
    throw new C0RuntimeError('worker-pool-failure');
  } finally {
    parentSignal?.removeEventListener('abort', forwardAbort);
    console.warn = originalWarn;
  }
}

function executionReplayTasks(tasks: readonly SimTask[]): SimTask[] {
  return tasks.map((task, index) => ({ ...task, weights: [...task.weights], taskId: 120 + index }));
}

function restoreReplayTaskIds(
  executionTasks: readonly SimTask[],
  projectionTasks: readonly SimTask[],
  results: readonly SimTaskResult[],
): SimTaskResult[] {
  runtime(results.length === executionTasks.length);
  return results.map((result, index) => {
    runtime(result.taskId === executionTasks[index]?.taskId);
    return { ...result, taskId: projectionTasks[index]!.taskId };
  });
}

export async function runC0Audit(
  dependencies: C0AuditDependencies = defaultAuditDependencies(),
  signal?: AbortSignal,
): Promise<C0AuditOutput> {
  throwIfAborted(signal);
  const sources = snapshotC0SourceBundle(dependencies.loadSources());
  validateSourceBundle(sources);
  throwIfAborted(signal);
  const workerCount = Math.max(
    1,
    Math.min(sources.checkpointWorkers, Math.max(1, dependencies.logicalCpuCount() - 1)),
  );
  let pool: C0Pool | undefined;
  let failure: unknown;
  let output: C0AuditOutput | undefined;
  try {
    pool = await dependencies.createPool(workerCount);
    throwIfAborted(signal);
    const primaryTasks = buildC0PrimaryTasks(sources);
    const primaryResults = await runStrictPool(pool, primaryTasks, signal);
    const primaryRecords = projectC0PrimaryResults(sources, primaryTasks, primaryResults);
    const replayTasks = buildC0ReplayTasks(sources);
    const replayExecution = executionReplayTasks(replayTasks);
    const replayResults = await runStrictPool(pool, replayExecution, signal);
    const replayRecords = projectC0ReplayResults(
      sources,
      replayTasks,
      restoreReplayTaskIds(replayExecution, replayTasks, replayResults),
    );
    output = evaluateC0Audit(sources, primaryRecords, replayRecords);
  } catch (error) {
    failure = error instanceof C0AbortError || error instanceof C0InvalidInputError || error instanceof C0RuntimeError
      ? error : new C0RuntimeError('worker-pool-failure');
  } finally {
    if (pool !== undefined) {
      try { await pool.destroy(); }
      catch {
        if (failure === undefined) failure = new C0RuntimeError('worker-pool-destroy-failure');
      }
    }
  }
  // Parent cancellation wins after cleanup, including saved execution or destroy failures.
  throwIfAborted(signal);
  if (failure !== undefined) throw failure;
  return output!;
}

export async function runC0AuditCli(
  dependencies: C0AuditDependencies = defaultAuditDependencies(),
  signal?: AbortSignal,
): Promise<C0CliResult> {
  try {
    const output = await runC0Audit(dependencies, signal);
    return {
      exitCode: output.status === 'pass-retention-loss-supported' ? 0 : 1,
      stdout: `${serializeC0Audit(output)}\n`,
      stderr: '',
    };
  } catch (error) {
    if (error instanceof C0AbortError) return { exitCode: 130, stdout: '', stderr: '' };
    if (error instanceof C0InvalidInputError) {
      return { exitCode: 1, stdout: `${serializeC0Audit(failureC0Audit('invalid-input', error.reason))}\n`, stderr: '' };
    }
    if (error instanceof C0RuntimeError) {
      return { exitCode: 1, stdout: `${serializeC0Audit(failureC0Audit('runtime-fail', error.reason))}\n`, stderr: '' };
    }
    return { exitCode: 1, stdout: '', stderr: 'C0 audit failed: internal-error\n' };
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once('SIGINT', onSigint);
  try {
    const result = await runC0AuditCli(defaultAuditDependencies(), controller.signal);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
