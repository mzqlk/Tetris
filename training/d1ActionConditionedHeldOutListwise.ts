import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  buildD1FutureStreams,
  buildD1ContextTasks,
  type D1AuthenticatedLabeledBatch,
  type D1ContextProjection,
  type D1ContextTask,
  type D1ContextTaskBatch,
  type D1TestLabelAttemptCapability,
} from './d1ActionConditionedHeldOutListwiseLabels';
import * as D1Labels from './d1ActionConditionedHeldOutListwiseLabels';
import {
  D1InvalidInputError,
  loadD1Sources,
} from './d1ActionConditionedHeldOutListwiseCore';
import {
  evaluateD1HeldOut,
  fitD1TrainingRepresentation,
  selectD1Lambda,
  freezeD1FinalModels,
  D1_LAMBDAS,
  D1PipelineRuntimeError,
  type D1HeldOutResult,
  type D1FinalModelBundle,
  type D1RuntimeFailureReason,
  type D1SelectedMetrics,
  type D1StatisticalFailureReason,
  type D1ValidationSelection,
} from './d1ActionConditionedHeldOutListwiseFit';
import {
  D1_ACTION_FEATURE_NAMES,
  D1_PROTOCOL_ID,
  buildD1LabelSeeds,
  buildD1SeedManifest,
  captureD1States,
  freezeD1PlacementManifest,
  type D1BehaviorRunner,
  type D1FrozenSubset,
  type D1InvalidInputReason as D1CoreInvalidInputReason,
  type D1PlacementCandidate,
  type D1RepresentationId,
  type D1Split,
  type D1Sources,
  type D1VectorId,
} from './d1ActionConditionedHeldOutListwiseCore';
import type { D1WorkerMessage } from './d1ActionConditionedHeldOutListwiseWorker';

export interface D1WorkerLike {
  postMessage(task: D1ContextTask): void;
  on(event: 'message' | 'error' | 'warning' | 'exit', listener: (...args: unknown[]) => void): this;
  once(event: 'online', listener: () => void): this;
  removeListener(event: string | symbol, listener: (...args: unknown[]) => void): this;
  terminate(): Promise<number | void>;
}

interface D1WorkerSlot {
  readonly worker: D1WorkerLike;
  readonly listeners: ReadonlyArray<readonly [event: 'message' | 'error' | 'warning' | 'exit', listener: (...args: unknown[]) => void]>;
}

const D1_PROJECTION_KEYS = Object.freeze([
  'taskId', 'subsetId', 'placementId', 'continuationVectorId', 'streamIndex',
  'pieces', 'scoreDelta', 'clearCounts', 'reason', 'searchDiagnostics', 'projectionDigest',
]);
const D1_CLEAR_COUNT_KEYS: ReadonlyArray<keyof D1ContextProjection['clearCounts']> =
  Object.freeze(['singles', 'doubles', 'triples', 'tetrises']);
const D1_SEARCH_DIAGNOSTIC_KEYS = Object.freeze([
  'searchCalls', 'holdActions', 'holdRate', 'meanCompletedDepth', 'minCompletedDepth',
  'completedDepthHistogram', 'totalWorkUnitsUsed', 'meanWorkUnitsUsed', 'maxWorkUnitsUsed',
  'budgetExhaustedSearches', 'budgetExhaustionRate', 'placementEvaluationUnits',
  'chanceExpansionUnits', 'cacheHitUnits', 'expandedDecisionNodes', 'expandedChanceNodes', 'cacheHits',
]);
const D1_INTEGER_SEARCH_DIAGNOSTIC_KEYS = new Set<string>([
  'searchCalls', 'holdActions', 'minCompletedDepth', 'totalWorkUnitsUsed', 'maxWorkUnitsUsed',
  'budgetExhaustedSearches', 'placementEvaluationUnits', 'chanceExpansionUnits', 'cacheHitUnits',
  'expandedDecisionNodes', 'expandedChanceNodes', 'cacheHits',
]);

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Exported so the D2 pool validates a worker reply exactly as strictly as D1's
 * does. A weaker check there would let a malformed projection become a durable
 * receipt that nothing is allowed to recompute.
 */
export function isValidD1ProjectionForTask(value: unknown, task: D1ContextTask): value is D1ContextProjection {
  if (!hasExactKeys(value, D1_PROJECTION_KEYS)) return false;
  const projection = value as unknown as D1ContextProjection;
  if (projection.taskId !== task.taskId || projection.subsetId !== task.subsetId ||
    projection.placementId !== task.placementId || projection.continuationVectorId !== task.continuationVectorId ||
    projection.streamIndex !== task.streamIndex || !isFiniteNonNegativeInteger(projection.pieces) ||
    typeof projection.scoreDelta !== 'number' || !Number.isFinite(projection.scoreDelta) ||
    (projection.reason !== 'pieceCap' && projection.reason !== 'gameover') ||
    !hasExactKeys(projection.clearCounts, D1_CLEAR_COUNT_KEYS) ||
    !D1_CLEAR_COUNT_KEYS.every((key) => isFiniteNonNegativeInteger(projection.clearCounts[key])) ||
    !hasExactKeys(projection.searchDiagnostics, D1_SEARCH_DIAGNOSTIC_KEYS)) return false;
  const diagnostics = projection.searchDiagnostics;
  if (!Array.isArray(diagnostics.completedDepthHistogram) || diagnostics.completedDepthHistogram.length !== 5 ||
    diagnostics.completedDepthHistogram.some((value) => !isFiniteNonNegativeInteger(value))) return false;
  if (D1_SEARCH_DIAGNOSTIC_KEYS.filter((key) => key !== 'completedDepthHistogram')
    .some((key) => {
      const value = diagnostics[key as keyof typeof diagnostics];
      return typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
        D1_INTEGER_SEARCH_DIAGNOSTIC_KEYS.has(key) && !Number.isInteger(value);
    })) return false;
  return projection.projectionDigest === digest(projectionWithoutDigest(projection));
}

export interface D1PoolLike {
  run(tasks: readonly D1ContextTask[], options?: { signal?: AbortSignal }): Promise<readonly D1ContextProjection[]>;
  destroy(): Promise<void>;
}

export type D1WorkerFactory = (index: number) => D1WorkerLike;
const workerUrl = new URL('./d1ActionConditionedHeldOutListwiseWorker.ts', import.meta.url);
const defaultWorkerFactory: D1WorkerFactory = (index) => new Worker(workerUrl, {
  name: `d1-context-${index}`,
  execArgv: ['--import', 'tsx'],
}) as unknown as D1WorkerLike;

export class D1WorkerPool {
  private destroyPromise: Promise<void> | null = null;
  private running = false;
  private destroyed = false;

  private constructor(private readonly workers: readonly D1WorkerLike[]) {}

  static async create(size: number, factory: D1WorkerFactory = defaultWorkerFactory): Promise<D1WorkerPool> {
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity');
    }
    const workers: D1WorkerLike[] = [];
    try {
      for (let index = 0; index < size; index += 1) workers.push(factory(index));
      return new D1WorkerPool(workers);
    } catch (error) {
      await Promise.allSettled(workers.map((worker) => worker.terminate()));
      if (error instanceof D1PipelineRuntimeError) throw error;
      throw new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity', 'worker creation failure', error);
    }
  }

  run(tasks: readonly D1ContextTask[], options: { signal?: AbortSignal } = {}): Promise<readonly D1ContextProjection[]> {
    if (tasks.length === 0) return Promise.resolve([]);
    if (this.destroyed || this.running) {
      return Promise.reject(new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity'));
    }
    const expectedIds = new Set(tasks.map((task) => task.taskId));
    if (expectedIds.size !== tasks.length) {
      return Promise.reject(new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity'));
    }
    this.running = true;
    return new Promise((resolve, reject) => {
      const results = new Map<number, D1ContextProjection>();
      const inFlight = new Map<D1WorkerLike, D1ContextTask>();
      const slots: D1WorkerSlot[] = [];
      let next = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        this.running = false;
        options.signal?.removeEventListener('abort', abort);
        for (const slot of slots) {
          for (const [event, listener] of slot.listeners) slot.worker.removeListener(event, listener);
        }
        if (error) reject(error); else resolve(tasks.map((task) => results.get(task.taskId)!));
      };
      const abort = () => {
        void this.destroy().catch(() => undefined);
        finish(new D1PipelineRuntimeError('worker', 'abort', 'simulation'));
      };
      const dispatch = (worker: D1WorkerLike) => {
        if (settled || next >= tasks.length) return;
        const nextTask = tasks[next++]!;
        inFlight.set(worker, nextTask);
        try {
          worker.postMessage(nextTask);
        } catch {
          finish(new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity'));
        }
      };
      const accept = (worker: D1WorkerLike, message: unknown) => {
        if (settled) return;
        const assigned = inFlight.get(worker);
        if (message !== null && typeof message === 'object' && 'kind' in message &&
          (message as { kind?: unknown }).kind === 'failure') {
          if (assigned !== undefined && hasExactKeys(message, ['kind', 'taskId', 'reason']) &&
            (message as { taskId?: unknown }).taskId === assigned.taskId &&
            (message as { reason?: unknown }).reason === 'simulation-failure') {
            finish(new D1PipelineRuntimeError('worker', 'simulation-failure', 'simulation'));
          } else {
            finish(new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity'));
          }
          return;
        }
        if (message === null || typeof message !== 'object' || !('kind' in message) ||
          (message as { kind?: unknown }).kind !== 'result' || !('result' in message) ||
          (message as { result?: unknown }).result === null || typeof (message as { result?: unknown }).result !== 'object') {
          finish(new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity')); return;
        }
        const workerMessage = message as D1WorkerMessage;
        if (workerMessage.kind !== 'result' || assigned === undefined || !isValidD1ProjectionForTask(workerMessage.result, assigned) ||
          results.has(workerMessage.result.taskId) || !expectedIds.has(workerMessage.result.taskId)) {
          finish(new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity')); return;
        }
        inFlight.delete(worker);
        results.set(workerMessage.result.taskId, workerMessage.result);
        if (results.size === tasks.length) { finish(); return; }
        dispatch(worker);
      };
      for (const worker of this.workers) {
        const listeners: D1WorkerSlot['listeners'] = [
          ['message', (...args) => accept(worker, args[0])],
          ['error', () => finish(new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity'))],
          ['warning', () => finish(new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity'))],
          ['exit', () => finish(new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity'))],
        ];
        for (const [event, listener] of listeners) worker.on(event, listener);
        // A D1 worker must remain alive until every dispatched result arrives.
        // Unlike the trainer pool, this diagnostic has no recovery/retry path:
        // even a clean early exit would otherwise strand a context forever.
        slots.push({ worker, listeners });
      }
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) { abort(); return; }
      for (const worker of this.workers) dispatch(worker);
    });
  }

  destroy(): Promise<void> {
    this.destroyed = true;
    this.destroyPromise ??= Promise.allSettled(this.workers.map((worker) => worker.terminate())).then((settled) => {
      if (settled.some((entry) => entry.status === 'rejected')) {
        throw new D1PipelineRuntimeError('cleanup', 'worker-pool-destroy-failure', 'worker-cleanup');
      }
    });
    return this.destroyPromise;
  }
}

export type D1Status = 'invalid-input' | 'runtime-fail' | 'fail-joint-selection-not-shown' |
  'fail-representation-gain-not-held-out' | 'pass-action-conditioned-listwise-supported';
export type D1InvalidInputReason = D1CoreInvalidInputReason |
  'runtime-identity-mismatch' | 'source-identity-drift';

export interface D1CountHistogramBin {
  readonly count: number;
  readonly subsetCount: number;
}

export interface D1SplitCardinalityHistogram {
  readonly split: D1Split;
  readonly legalCountBins: readonly D1CountHistogramBin[];
  readonly selectedCountBins: readonly D1CountHistogramBin[];
  readonly digest: string;
}

export interface D1GroupCardinalityHistogram {
  readonly groupOrdinal: number;
  readonly subsetCount: 4;
  readonly legalCountBins: readonly D1CountHistogramBin[];
  readonly selectedCountBins: readonly D1CountHistogramBin[];
  readonly digest: string;
}

export interface D1SubsetCardinalityEvidence {
  readonly subsetId: string;
  readonly split: D1Split;
  readonly groupOrdinal: number;
  readonly behaviorVectorId: D1VectorId;
  readonly captureSlot: 128 | 512;
  readonly stateFingerprint: string;
  readonly legalCount: number;
  readonly selectedCount: number;
  readonly legalUniverseDigest: string;
  readonly selectedPlacementIds: readonly string[];
  readonly selectedPlacementProjections: readonly Pick<D1PlacementCandidate,
    'placementId' | 'boardAfter' | 'linesCleared' | 'placedCells' | 'pending' | 'afterstate13' | 'action24'>[];
  readonly selectedProjectionDigests: readonly string[];
  readonly subsetManifestDigest: string;
}

export interface D1ManifestEvidence {
  readonly stateCount: 160;
  readonly placementCount: number;
  readonly splitCounts: Readonly<{ train: 80; validation: 32; test: 48 }>;
  readonly subsetCardinalities: readonly D1SubsetCardinalityEvidence[];
  readonly splitLegalCounts: Readonly<Record<D1Split, number>>;
  readonly splitPlacementCounts: Readonly<Record<D1Split, number>>;
  readonly selectedCountHistogram: readonly D1CountHistogramBin[];
  readonly splitCardinalityHistograms: readonly D1SplitCardinalityHistogram[];
  readonly groupCardinalityHistograms: readonly D1GroupCardinalityHistogram[];
  readonly cardinalityDigest: string;
  readonly stateManifestDigest: string;
  readonly legalUniverseDigest: string;
  readonly placementManifestDigest: string;
}

export interface D1LabelEvidence {
  readonly protocol: 'survival-first-joint-pareto-uniform-v2-variable-cardinality';
  readonly primaryContextCount: number;
  readonly trainValidationContextCount: number;
  readonly heldOutContextCount: number;
  readonly streamPrefixCount: 320;
  readonly futurePrefixDigest: string;
  readonly contextManifestDigest: string;
  readonly taskAssociationDigest: string;
  readonly labelDigest: string;
}

export interface D1CompletedEvidence {
  readonly source: Readonly<{
    sourceHashes: Readonly<{ checkpoint: string; log: string }>;
    vectorDigests: Readonly<{ 'gen6-best': string; 'gen10-mu': string }>;
  }>;
  readonly search: Readonly<{
    version: 6;
    objective: 'score-rate-v5';
    gen: 10;
    contract: 'bag-expectimax-hold-v2';
    depth: 4;
    rootBeamWidth: 64;
    childBeamWidth: 32;
    maxWorkUnits: 3584;
    budgetCorpus: 'budget-corpus-v1';
    transpositionCacheEntries: 65536;
    placementCacheEntries: 16384;
  }>;
  readonly seeds: Readonly<{ behaviorSeedDigest: string; labelSeedDigest: string }>;
  readonly manifest: D1ManifestEvidence;
  readonly features: D1ObservedFeatureEvidence;
  readonly labels: D1LabelEvidence;
  readonly fits: Readonly<Record<D1RepresentationId, Readonly<{
    lambda: typeof D1_LAMBDAS[number];
    normalizationDigest: string;
    weightDigest: string;
    convergenceDigest: string;
  }>>>;
  readonly validation: Readonly<Record<D1RepresentationId, Readonly<{
    lambda: typeof D1_LAMBDAS[number];
    selectionDigest: string;
    survivalBelowSubsetOracle: number;
    subsetJointFrontHits: number;
  }>>>;
  readonly heldOut: D1HeldOutResult;
  readonly replays: Readonly<{ count: 16; records: readonly D1ReplayRecord[]; digest: string }>;
}

export interface D1PrePoolFailureProjection {
  readonly mode: typeof D1_PROTOCOL_ID;
  readonly phase: 'runtime-identity' | 'source' | 'seeds' | 'captures' | 'state-fingerprint' |
    'legal-universe' | 'placement-manifest' | 'cardinality' | 'context-manifest';
  readonly status: 'invalid-input';
  readonly failureReasons: readonly D1InvalidInputReason[];
  readonly source: Readonly<{ checkpointHash: string | null; logHash: string | null; gen6BestDigest: string | null; gen10MuDigest: string | null }>;
  readonly seeds: Readonly<{ behaviorSeedDigest: string | null; labelSeedDigest: string | null }>;
  readonly completedCounts: Readonly<{
    states: number;
    subsets: number;
    splitSubsets: Readonly<Record<D1Split, number>>;
    placements: number;
    splitPlacements: Readonly<Record<D1Split, number>>;
    contexts: number;
  }>;
  readonly manifestDigests: Readonly<{
    state: string | null;
    legalUniverse: string | null;
    placement: string | null;
    cardinality: string | null;
    context: string | null;
    taskAssociation: string | null;
    label: null;
  }>;
  readonly resultDigest: string;
}

export type D1DiagnosticResult = D1PrePoolFailureProjection | Readonly<{
  mode: typeof D1_PROTOCOL_ID;
  phase: 'worker' | 'optimizer' | 'test' | 'replay' | 'cleanup';
  status: 'runtime-fail';
  failureReasons: readonly D1RuntimeFailureReason[];
  evidence: D1CompletedEvidence | null;
  resultDigest: string;
}> | Readonly<{
  mode: typeof D1_PROTOCOL_ID;
  phase: 'complete';
  status: 'fail-joint-selection-not-shown' | 'fail-representation-gain-not-held-out';
  failureReasons: readonly [D1StatisticalFailureReason, ...D1StatisticalFailureReason[]];
  evidence: D1CompletedEvidence;
  resultDigest: string;
}> | Readonly<{
  mode: typeof D1_PROTOCOL_ID;
  phase: 'complete';
  status: 'pass-action-conditioned-listwise-supported';
  failureReasons: readonly [];
  evidence: D1CompletedEvidence;
  resultDigest: string;
}>;

const D1_RUNTIME_FAILURE_REASONS = Object.freeze([
  'simulation-failure', 'worker-pool-failure', 'worker-pool-destroy-failure', 'optimizer-failure',
  'abort', 'malformed-metrics', 'test-before-freeze', 'nondeterministic-replay',
] satisfies readonly D1RuntimeFailureReason[]);
const D1_STATISTICAL_FAILURE_REASONS = Object.freeze([
  'action24-survival-below-subset-oracle', 'action24-survival-lower-than-afterstate13',
  'action24-score-lower-than-afterstate13', 'action24-tetris-share-lower-than-afterstate13',
  'joint-score-and-tetris-not-strictly-higher', 'action24-front-hit-floor-not-met',
  'action24-front-hit-gain-not-met', 'seed-group-nonnegative-floor-not-met',
  'seed-group-positive-floor-not-met',
] satisfies readonly D1StatisticalFailureReason[]);
function isRuntimeFailureReason(value: unknown): value is D1RuntimeFailureReason {
  return typeof value === 'string' && D1_RUNTIME_FAILURE_REASONS.some((reason) => reason === value);
}
function isStatisticalFailureReason(value: unknown): value is D1StatisticalFailureReason {
  return typeof value === 'string' && D1_STATISTICAL_FAILURE_REASONS.some((reason) => reason === value);
}

export interface D1ReplayRecord {
  readonly taskId: number;
  readonly subsetId: string;
  readonly placementId: string;
  readonly continuationVectorId: D1VectorId;
  readonly streamIndex: 0;
  readonly primaryProjectionDigest: string;
  readonly replayProjectionDigest: string;
}

export interface D1FeatureRange {
  readonly min: number;
  readonly max: number;
}

export interface D1ObservedFeatureEvidence {
  readonly names: Readonly<{ afterstate13: readonly string[]; action24: readonly string[] }>;
  readonly dimensions: Readonly<{ afterstate13: 13; action24: 24 }>;
  readonly ranges: Readonly<{ afterstate13: readonly D1FeatureRange[]; action24: readonly D1FeatureRange[] }>;
  readonly projectionDigests: Readonly<{ afterstate13: string; action24: string }>;
}

export interface D1RuntimeIdentity {
  readonly node: string;
  readonly v8: string;
  readonly platform: string;
  readonly arch: string;
}

export interface D1DiagnosticDependencies {
  readonly runtimeIdentity?: () => D1RuntimeIdentity;
  readonly loadSources?: typeof loadD1Sources;
  readonly buildSeedManifest?: typeof buildD1SeedManifest;
  readonly runBehavior?: D1BehaviorRunner;
  readonly freezePlacementManifest?: typeof freezeD1PlacementManifest;
  readonly createPool?: (evidence: Readonly<Record<string, unknown>>) => Promise<D1PoolLike>;
  readonly signal?: AbortSignal;
  readonly filesystemSnapshot?: () => unknown;
}

export interface D1CliResult {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
}

export interface D1CliDependencies {
  readonly runDiagnostic?: (signal?: AbortSignal) => Promise<D1DiagnosticResult>;
  readonly signal?: AbortSignal;
}

export interface D1MainProcessLike {
  exitCode: number | undefined;
  readonly stdout: Readonly<{ write(text: string): unknown }>;
  readonly stderr: Readonly<{ write(text: string): unknown }>;
  once(event: 'SIGINT', listener: () => void): unknown;
  removeListener(event: 'SIGINT', listener: () => void): unknown;
}

function canonicalizeProjection(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('malformed-metrics');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeProjection);
  if (typeof value === 'object') {
    const projected: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) throw new Error('malformed-metrics');
      projected[key] = canonicalizeProjection(child);
    }
    return projected;
  }
  throw new Error('malformed-metrics');
}

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalizeProjection(value));
const digest = (value: unknown): string => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
const OPERATIONAL_IDENTITY: D1RuntimeIdentity = Object.freeze({
  node: '24.14.0', v8: '13.6.233.17-node.41', platform: 'win32', arch: 'x64',
});

const currentRuntimeIdentity = (): D1RuntimeIdentity => ({
  node: process.versions.node, v8: process.versions.v8, platform: process.platform, arch: process.arch,
});

function sameRuntimeIdentity(identity: D1RuntimeIdentity): boolean {
  return identity.node === OPERATIONAL_IDENTITY.node && identity.v8 === OPERATIONAL_IDENTITY.v8 &&
    identity.platform === OPERATIONAL_IDENTITY.platform && identity.arch === OPERATIONAL_IDENTITY.arch;
}

interface D1PrePoolState {
  source: { checkpointHash: string | null; logHash: string | null; gen6BestDigest: string | null; gen10MuDigest: string | null };
  seeds: { behaviorSeedDigest: string | null; labelSeedDigest: string | null };
  completedCounts: {
    states: number;
    subsets: number;
    splitSubsets: Record<D1Split, number>;
    placements: number;
    splitPlacements: Record<D1Split, number>;
    contexts: number;
  };
  manifestDigests: {
    state: string | null;
    legalUniverse: string | null;
    placement: string | null;
    cardinality: string | null;
    context: string | null;
    taskAssociation: string | null;
    label: null;
  };
}

function emptyPrePoolState(): D1PrePoolState {
  return {
    source: { checkpointHash: null, logHash: null, gen6BestDigest: null, gen10MuDigest: null },
    seeds: { behaviorSeedDigest: null, labelSeedDigest: null },
    completedCounts: {
      states: 0,
      subsets: 0,
      splitSubsets: { train: 0, validation: 0, test: 0 },
      placements: 0,
      splitPlacements: { train: 0, validation: 0, test: 0 },
      contexts: 0,
    },
    manifestDigests: {
      state: null, legalUniverse: null, placement: null, cardinality: null,
      context: null, taskAssociation: null, label: null,
    },
  };
}

function prePoolFailure(
  phase: D1PrePoolFailureProjection['phase'],
  failureReasons: readonly D1InvalidInputReason[],
  state: D1PrePoolState,
): D1PrePoolFailureProjection {
  const projection = canonicalizeProjection({
    mode: D1_PROTOCOL_ID,
    phase,
    status: 'invalid-input',
    failureReasons: [...failureReasons],
    source: {
      checkpointHash: state.source.checkpointHash,
      logHash: state.source.logHash,
      gen6BestDigest: state.source.gen6BestDigest,
      gen10MuDigest: state.source.gen10MuDigest,
    },
    seeds: {
      behaviorSeedDigest: state.seeds.behaviorSeedDigest,
      labelSeedDigest: state.seeds.labelSeedDigest,
    },
    completedCounts: {
      states: state.completedCounts.states,
      subsets: state.completedCounts.subsets,
      splitSubsets: {
        train: state.completedCounts.splitSubsets.train,
        validation: state.completedCounts.splitSubsets.validation,
        test: state.completedCounts.splitSubsets.test,
      },
      placements: state.completedCounts.placements,
      splitPlacements: {
        train: state.completedCounts.splitPlacements.train,
        validation: state.completedCounts.splitPlacements.validation,
        test: state.completedCounts.splitPlacements.test,
      },
      contexts: state.completedCounts.contexts,
    },
    manifestDigests: {
      state: state.manifestDigests.state,
      legalUniverse: state.manifestDigests.legalUniverse,
      placement: state.manifestDigests.placement,
      cardinality: state.manifestDigests.cardinality,
      context: state.manifestDigests.context,
      taskAssociation: state.manifestDigests.taskAssociation,
      label: null,
    },
  }) as Omit<D1PrePoolFailureProjection, 'resultDigest'>;
  return deepFreeze({
    mode: projection.mode,
    phase: projection.phase,
    status: projection.status,
    failureReasons: projection.failureReasons,
    source: projection.source,
    seeds: projection.seeds,
    completedCounts: projection.completedCounts,
    manifestDigests: projection.manifestDigests,
    resultDigest: resultDigest(projection),
  });
}

function runtimeFailure(
  phase: Extract<D1DiagnosticResult, { status: 'runtime-fail' }>['phase'],
  failureReasons: readonly D1RuntimeFailureReason[],
  evidence: D1CompletedEvidence | null,
): Extract<D1DiagnosticResult, { status: 'runtime-fail' }> {
  const canonicalEvidence = evidence === null ? null : canonicalizeProjection(evidence) as unknown as D1CompletedEvidence;
  const projection = {
    mode: D1_PROTOCOL_ID,
    phase,
    status: 'runtime-fail' as const,
    failureReasons: [...failureReasons],
    evidence: canonicalEvidence,
  };
  return deepFreeze({
    mode: projection.mode,
    phase: projection.phase,
    status: projection.status,
    failureReasons: projection.failureReasons,
    evidence: projection.evidence,
    resultDigest: resultDigest(projection),
  });
}

function statisticalResult(
  status: 'fail-joint-selection-not-shown' | 'fail-representation-gain-not-held-out',
  failureReasons: readonly [D1StatisticalFailureReason, ...D1StatisticalFailureReason[]],
  evidence: D1CompletedEvidence,
): Extract<D1DiagnosticResult, { phase: 'complete'; status: 'fail-joint-selection-not-shown' | 'fail-representation-gain-not-held-out' }> {
  const canonicalEvidence = canonicalizeProjection(evidence) as unknown as D1CompletedEvidence;
  const [firstReason, ...remainingReasons] = failureReasons;
  const canonicalReasons: readonly [D1StatisticalFailureReason, ...D1StatisticalFailureReason[]] =
    [firstReason, ...remainingReasons];
  const projection = {
    mode: D1_PROTOCOL_ID,
    phase: 'complete' as const,
    status,
    failureReasons: canonicalReasons,
    evidence: canonicalEvidence,
  };
  return deepFreeze({
    mode: projection.mode,
    phase: projection.phase,
    status: projection.status,
    failureReasons: projection.failureReasons,
    evidence: projection.evidence,
    resultDigest: resultDigest(projection),
  });
}

function passResult(
  evidence: D1CompletedEvidence,
): Extract<D1DiagnosticResult, { status: 'pass-action-conditioned-listwise-supported' }> {
  const canonicalEvidence = canonicalizeProjection(evidence) as unknown as D1CompletedEvidence;
  const failureReasons: readonly [] = Object.freeze([]);
  const projection = {
    mode: D1_PROTOCOL_ID,
    phase: 'complete' as const,
    status: 'pass-action-conditioned-listwise-supported' as const,
    failureReasons,
    evidence: canonicalEvidence,
  };
  return deepFreeze({ ...projection, resultDigest: resultDigest(projection) });
}

function buildCanonicalStreams(
  subsets: readonly D1FrozenSubset[],
  seeds: readonly number[],
): ReturnType<typeof buildD1FutureStreams> {
  const entries = subsets.flatMap((subset, subsetIndex) => [0, 1].map((streamIndex) => ({
    subsetId: subset.subsetId,
    labelSeed: seeds[subsetIndex * 2 + streamIndex]!,
    unseenBagMask: subset.capture.state.unseenBagMask,
    streamIndex: streamIndex as 0 | 1,
  })));
  return buildD1FutureStreams({ entries });
}

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const canonicalNumericValue = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new D1InvalidInputError('placement-manifest-mismatch');
  return Object.is(value, -0) ? 0 : value;
};

interface D1CanonicalFeatureRow {
  readonly subsetId: string;
  readonly placementId: string;
  readonly afterstate13: readonly number[];
  readonly action24: readonly number[];
}

function canonicalFeatureVector(value: unknown, length: number): readonly number[] {
  if (!Array.isArray(value) || value.length !== length) throw new D1InvalidInputError('placement-manifest-mismatch');
  const vector: number[] = [];
  for (let index = 0; index < length; index += 1) vector.push(canonicalNumericValue(value[index]));
  return Object.freeze(vector);
}

function canonicalFeatureRows(subsets: readonly D1FrozenSubset[]): readonly D1CanonicalFeatureRow[] {
  if (!Array.isArray(subsets) || subsets.length !== 160 || D1_ACTION_FEATURE_NAMES.length !== 24) {
    throw new D1InvalidInputError('placement-manifest-mismatch');
  }
  const rows: D1CanonicalFeatureRow[] = [];
  for (const subset of subsets) {
    const rawSubset = subset as unknown;
    if (rawSubset === null || typeof rawSubset !== 'object') throw new D1InvalidInputError('placement-manifest-mismatch');
    const { subsetId, selectedCount, placements } = rawSubset as {
      subsetId?: unknown;
      selectedCount?: unknown;
      placements?: unknown;
    };
    if (typeof subsetId !== 'string' || !Number.isSafeInteger(selectedCount) ||
      (selectedCount as number) < 2 || (selectedCount as number) > 12 ||
      !Array.isArray(placements) || placements.length !== selectedCount) {
      throw new D1InvalidInputError('placement-manifest-mismatch');
    }
    for (const rawPlacement of placements) {
      if (rawPlacement === null || typeof rawPlacement !== 'object') throw new D1InvalidInputError('placement-manifest-mismatch');
      const { placementId, afterstate13: rawAfterstate13, action24: rawAction24 } = rawPlacement as {
        placementId?: unknown; afterstate13?: unknown; action24?: unknown;
      };
      if (typeof placementId !== 'string') throw new D1InvalidInputError('placement-manifest-mismatch');
      const afterstate13 = canonicalFeatureVector(rawAfterstate13, 13);
      const action24 = canonicalFeatureVector(rawAction24, 24);
      if (action24.slice(0, 13).some((value, index) => value !== afterstate13[index])) {
        throw new D1InvalidInputError('placement-manifest-mismatch');
      }
      rows.push(Object.freeze({
        subsetId,
        placementId,
        afterstate13,
        action24,
      }));
    }
  }
  if (rows.length !== subsets.reduce((sum, subset) => sum + subset.selectedCount, 0)) {
    throw new D1InvalidInputError('placement-manifest-mismatch');
  }
  return Object.freeze(rows);
}

function observedRanges(rows: readonly D1CanonicalFeatureRow[], representation: 'afterstate13' | 'action24'): readonly D1FeatureRange[] {
  const first = rows[0]?.[representation];
  if (first === undefined) throw new D1InvalidInputError('placement-manifest-mismatch');
  const ranges = first.map((value) => ({ min: canonicalNumericValue(value), max: canonicalNumericValue(value) }));
  for (const row of rows.slice(1)) {
    const values = row[representation];
    for (let index = 0; index < values.length; index += 1) {
      const value = canonicalNumericValue(values[index]);
      ranges[index]!.min = canonicalNumericValue(Math.min(ranges[index]!.min, value));
      ranges[index]!.max = canonicalNumericValue(Math.max(ranges[index]!.max, value));
    }
  }
  return Object.freeze(ranges.map((range) => Object.freeze({ min: canonicalNumericValue(range.min), max: canonicalNumericValue(range.max) })));
}

/** Derives all feature evidence from one explicit canonical subset/placement row order. */
export function buildD1ObservedFeatureEvidence(subsets: readonly D1FrozenSubset[]): D1ObservedFeatureEvidence {
  const rows = canonicalFeatureRows(subsets);
  const afterstate13 = observedRanges(rows, 'afterstate13');
  const action24Observed = observedRanges(rows, 'action24');
  const action24 = Object.freeze([
    ...afterstate13,
    ...action24Observed.slice(13),
  ]);
  if (action24.length !== 24 || action24.slice(0, 13).some((range, index) =>
    range.min !== afterstate13[index]!.min || range.max !== afterstate13[index]!.max)) {
    throw new D1InvalidInputError('placement-manifest-mismatch');
  }
  return deepFreeze({
    names: {
      afterstate13: [...D1_ACTION_FEATURE_NAMES.slice(0, 13)],
      action24: [...D1_ACTION_FEATURE_NAMES],
    },
    dimensions: { afterstate13: 13 as const, action24: 24 as const },
    ranges: { afterstate13, action24 },
    projectionDigests: {
      afterstate13: digest(rows.map(({ subsetId, placementId, afterstate13: values }) => ({ subsetId, placementId, values }))),
      action24: digest(rows.map(({ subsetId, placementId, action24: values }) => ({ subsetId, placementId, values }))),
    },
  });
}

type D1ProjectedSelectedMetrics = Readonly<D1SelectedMetrics>;

function projectSelectedMetrics(metrics: D1SelectedMetrics): D1ProjectedSelectedMetrics {
  return Object.freeze({
    selectedPlacementIds: Object.freeze([...metrics.selectedPlacementIds]),
    selectedSurvivalTuples: Object.freeze(metrics.selectedSurvivalTuples.map((tuple) => Object.freeze([tuple[0], tuple[1], tuple[2]] as const))),
    survivalBelowSubsetOracle: metrics.survivalBelowSubsetOracle,
    subsetJointFrontHits: metrics.subsetJointFrontHits,
    sumScore: metrics.sumScore,
    scheduledPieces: metrics.scheduledPieces,
    scoreRate: metrics.scoreRate,
    tetrisNumerator: metrics.tetrisNumerator,
    tetrisDenominator: metrics.tetrisDenominator,
    tetrisShare: metrics.tetrisShare,
  });
}

function projectHeldOut(heldOut: D1HeldOutResult): D1HeldOutResult {
  return Object.freeze({
    status: heldOut.status,
    failureReasons: Object.freeze([...heldOut.failureReasons]),
    metrics: Object.freeze({
      afterstate13: projectSelectedMetrics(heldOut.metrics.afterstate13),
      action24: projectSelectedMetrics(heldOut.metrics.action24),
    }),
    cardinalityMetrics: Object.freeze(heldOut.cardinalityMetrics.map((metric) => Object.freeze({
      selectedCount: metric.selectedCount,
      subsetCount: metric.subsetCount,
      afterstate13FrontHits: metric.afterstate13FrontHits,
      action24FrontHits: metric.action24FrontHits,
      action24NonLowerSurvival: metric.action24NonLowerSurvival,
      frontDelta: metric.frontDelta,
    }))),
    seedGroups: Object.freeze(heldOut.seedGroups.map((group) => Object.freeze({
      groupOrdinal: group.groupOrdinal,
      afterstate13FrontHits: group.afterstate13FrontHits,
      action24FrontHits: group.action24FrontHits,
      groupFrontDelta: group.groupFrontDelta,
    }))),
    gates: Object.freeze({
      action24OracleSafe: heldOut.gates.action24OracleSafe,
      action24NonLowerSurvival: heldOut.gates.action24NonLowerSurvival,
      action24FrontHitFloor: heldOut.gates.action24FrontHitFloor,
      action24FrontHitGain: heldOut.gates.action24FrontHitGain,
      allSeedGroupsNonNegative: heldOut.gates.allSeedGroupsNonNegative,
      positiveSeedGroupCount: heldOut.gates.positiveSeedGroupCount,
      scoreNonLower: heldOut.gates.scoreNonLower,
      tetrisNonLower: heldOut.gates.tetrisNonLower,
      jointStrictImprovement: heldOut.gates.jointStrictImprovement,
    }),
    selectedPlacementDigest: heldOut.selectedPlacementDigest,
    metricProjectionDigest: heldOut.metricProjectionDigest,
  });
}

function countHistogram(values: readonly number[], completeSelectedRange = false): readonly D1CountHistogramBin[] {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const keys = completeSelectedRange
    ? Array.from({ length: 11 }, (_, index) => index + 2)
    : [...counts.keys()].sort((left, right) => left - right);
  return Object.freeze(keys.map((count) => Object.freeze({ count, subsetCount: counts.get(count) ?? 0 })));
}

function projectSelectedPlacement(candidate: D1PlacementCandidate): D1SubsetCardinalityEvidence['selectedPlacementProjections'][number] {
  return deepFreeze({
    placementId: candidate.placementId,
    boardAfter: candidate.boardAfter.map((row) => [...row]),
    linesCleared: candidate.linesCleared,
    placedCells: candidate.placedCells.map(({ x, y }) => ({ x, y })),
    pending: {
      board: candidate.pending.board.map((row) => [...row]),
      current: {
        type: candidate.pending.current.type,
        rotation: candidate.pending.current.rotation,
        position: { x: candidate.pending.current.position.x, y: candidate.pending.current.position.y },
      },
      hold: candidate.pending.hold,
      holdAvailable: candidate.pending.holdAvailable,
      unseenBagMask: candidate.pending.unseenBagMask,
    },
    afterstate13: candidate.afterstate13.map(canonicalNumericValue),
    action24: candidate.action24.map(canonicalNumericValue),
  });
}

function selectedPlacementProjectionDigest(
  projection: D1SubsetCardinalityEvidence['selectedPlacementProjections'][number],
): string {
  return digest([
    projection.placementId,
    projection.boardAfter,
    projection.linesCleared,
    projection.placedCells.map(({ x, y }) => [x, y]),
    [
      projection.pending.board,
      [
        projection.pending.current.type,
        projection.pending.current.rotation,
        projection.pending.current.position.x,
        projection.pending.current.position.y,
      ],
      projection.pending.hold,
      projection.pending.holdAvailable,
      projection.pending.unseenBagMask,
    ],
    projection.afterstate13,
    projection.action24,
  ]);
}

function splitSubsetRange(split: D1Split): readonly [number, number] {
  return split === 'train' ? [0, 80] : split === 'validation' ? [80, 112] : [112, 160];
}

function buildD1ManifestEvidence(subsets: readonly D1FrozenSubset[]): D1ManifestEvidence {
  if (subsets.length !== 160) throw new D1InvalidInputError('capture-missing-or-invalid');
  if (subsets.some((subset) => !Array.isArray(subset.placements) ||
    !Number.isSafeInteger(subset.selectedCount) || subset.selectedCount < 2 || subset.selectedCount > 12 ||
    subset.placements.length !== subset.selectedCount || !Array.isArray(subset.legalPlacementIds) ||
    !Number.isSafeInteger(subset.legalCount) || subset.legalPlacementIds.length !== subset.legalCount)) {
    throw new D1InvalidInputError('placement-manifest-mismatch');
  }
  const subsetCardinalities = subsets.map((subset) => {
    const selectedPlacementIds = subset.placements.map(({ placementId }) => placementId);
    const selectedPlacementProjections = subset.placements.map(projectSelectedPlacement);
    const selectedProjectionDigests = selectedPlacementProjections.map(selectedPlacementProjectionDigest);
    const subsetManifestDigest = digest([
      subset.subsetId,
      subset.capture.split,
      subset.capture.groupOrdinal,
      subset.capture.behaviorVectorId,
      subset.capture.captureSlot,
      subset.capture.stateFingerprint,
      subset.legalCount,
      subset.selectedCount,
      subset.legalUniverseDigest,
      selectedPlacementIds,
      selectedProjectionDigests,
    ]);
    return deepFreeze({
      subsetId: subset.subsetId,
      split: subset.capture.split,
      groupOrdinal: subset.capture.groupOrdinal,
      behaviorVectorId: subset.capture.behaviorVectorId,
      captureSlot: subset.capture.captureSlot,
      stateFingerprint: subset.capture.stateFingerprint,
      legalCount: subset.legalCount,
      selectedCount: subset.selectedCount,
      legalUniverseDigest: subset.legalUniverseDigest,
      selectedPlacementIds,
      selectedPlacementProjections,
      selectedProjectionDigests,
      subsetManifestDigest,
    });
  });
  const splitLegalCounts = { train: 0, validation: 0, test: 0 };
  const splitPlacementCounts = { train: 0, validation: 0, test: 0 };
  for (const subset of subsetCardinalities) {
    splitLegalCounts[subset.split] += subset.legalCount;
    splitPlacementCounts[subset.split] += subset.selectedCount;
  }
  const selectedCountHistogram = countHistogram(subsetCardinalities.map(({ selectedCount }) => selectedCount), true);
  const splitCardinalityHistograms = (['train', 'validation', 'test'] as const).map((split) => {
    const [start, end] = splitSubsetRange(split);
    const entries = subsetCardinalities.slice(start, end);
    const legalCountBins = countHistogram(entries.map(({ legalCount }) => legalCount));
    const selectedCountBins = countHistogram(entries.map(({ selectedCount }) => selectedCount), true);
    return deepFreeze({
      split,
      legalCountBins,
      selectedCountBins,
      digest: digest([split, legalCountBins, selectedCountBins]),
    });
  });
  const groupCardinalityHistograms = Array.from({ length: 40 }, (_, groupOrdinal) => {
    const entries = subsetCardinalities.slice(groupOrdinal * 4, groupOrdinal * 4 + 4);
    if (entries.length !== 4) throw new D1InvalidInputError('placement-manifest-mismatch');
    const legalCountBins = countHistogram(entries.map(({ legalCount }) => legalCount));
    const selectedCountBins = countHistogram(entries.map(({ selectedCount }) => selectedCount), true);
    return deepFreeze({
      groupOrdinal,
      subsetCount: 4 as const,
      legalCountBins,
      selectedCountBins,
      digest: digest([groupOrdinal, 4, legalCountBins, selectedCountBins]),
    });
  });
  const stateManifestDigest = digest(subsetCardinalities.map(({ stateFingerprint }) => stateFingerprint));
  const legalUniverseDigest = digest(subsets.map((subset) => [
    subset.subsetId,
    subset.capture.stateFingerprint,
    subset.legalCount,
    subset.legalPlacementIds,
    subset.legalUniverseDigest,
  ]));
  const cardinalityDigest = digest([
    subsetCardinalities.map(({ subsetManifestDigest }) => subsetManifestDigest),
    selectedCountHistogram,
    splitCardinalityHistograms.map((histogram) => histogram.digest),
    groupCardinalityHistograms.map((histogram) => histogram.digest),
    splitLegalCounts,
    splitPlacementCounts,
  ]);
  const placementManifestDigest = digest([
    stateManifestDigest,
    legalUniverseDigest,
    subsetCardinalities.map(({ subsetManifestDigest }) => subsetManifestDigest),
    cardinalityDigest,
  ]);
  return deepFreeze({
    stateCount: 160 as const,
    placementCount: subsetCardinalities.reduce((sum, subset) => sum + subset.selectedCount, 0),
    splitCounts: { train: 80 as const, validation: 32 as const, test: 48 as const },
    subsetCardinalities,
    splitLegalCounts,
    splitPlacementCounts,
    selectedCountHistogram,
    splitCardinalityHistograms,
    groupCardinalityHistograms,
    cardinalityDigest,
    stateManifestDigest,
    legalUniverseDigest,
    placementManifestDigest,
  });
}

function buildLabelDigest(
  train: D1AuthenticatedLabeledBatch,
  validation: D1AuthenticatedLabeledBatch,
  test: D1AuthenticatedLabeledBatch,
): string {
  return digest([train, validation, test].map((batch) => [
    batch.split,
    batch.subsets.map((subset) => [
      subset.subsetId,
      subset.groupOrdinal,
      subset.placementIds,
      subset.outcomes,
      subset.survivalOracle,
      subset.jointFrontPlacementIds,
      subset.q,
    ]),
  ]));
}

async function runContextPool(
  pool: D1PoolLike,
  tasks: readonly D1ContextTask[],
  phase: 'worker' | 'test' | 'replay',
  signal?: AbortSignal,
): Promise<readonly D1ContextProjection[]> {
  try {
    return await pool.run(tasks, { signal });
  } catch (error) {
    if (error instanceof D1PipelineRuntimeError) throw error;
    if (signal?.aborted) throw new D1PipelineRuntimeError(phase, 'abort', 'simulation');
    throw new D1PipelineRuntimeError(
      phase,
      'worker-pool-failure',
      'worker-projection-integrity',
      'worker pool execution failure',
      error,
    );
  }
}

/**
 * The expensive D1 phases are intentionally reached only under the fixed
 * operational identity.  The runtime gate is deliberately first so a local
 * developer test cannot read the pinned source artifacts by accident.
 */
export async function runD1Diagnostic(
  dependencies: D1DiagnosticDependencies = {},
): Promise<D1DiagnosticResult> {
  const prePoolState = emptyPrePoolState();
  const identity = (dependencies.runtimeIdentity ?? currentRuntimeIdentity)();
  if (!sameRuntimeIdentity(identity)) {
    return prePoolFailure('runtime-identity', ['runtime-identity-mismatch'], prePoolState);
  }
  const snapshot = dependencies.filesystemSnapshot;
  const initialSnapshot = snapshot?.();
  let pool: D1PoolLike | undefined;
  let primaryStatus: D1Status = 'runtime-fail';
  let primaryFailureReasons: readonly (D1InvalidInputReason | D1RuntimeFailureReason | D1StatisticalFailureReason)[] = ['simulation-failure'];
  let completedEvidence: D1CompletedEvidence | null = null;
  const postPrimaryRuntimeReasons: D1RuntimeFailureReason[] = [];
  let prePoolPhase: D1PrePoolFailureProjection['phase'] = 'source';
  let runtimePhase: 'worker' | 'optimizer' | 'test' | 'replay' | 'cleanup' = 'worker';
  let testAttempt: D1TestLabelAttemptCapability | undefined;
  let testAttemptInFlight = false;
  try {
    const sources = (dependencies.loadSources ?? loadD1Sources)() as D1Sources;
    prePoolState.source = {
      checkpointHash: sources.sourceHashes.checkpoint,
      logHash: sources.sourceHashes.log,
      gen6BestDigest: sources.vectors[0]?.digest ?? null,
      gen10MuDigest: sources.vectors[1]?.digest ?? null,
    };
    prePoolPhase = 'seeds';
    const seedManifest = (dependencies.buildSeedManifest ?? buildD1SeedManifest)();
    const labelSeeds = buildD1LabelSeeds(seedManifest);
    prePoolState.seeds = {
      behaviorSeedDigest: seedManifest.behaviorSeedDigest,
      labelSeedDigest: seedManifest.labelSeedDigest,
    };
    prePoolPhase = 'captures';
    const captures = captureD1States({
      sources,
      seedManifest,
      runBehavior: dependencies.runBehavior,
    });
    if (captures.length !== 160) throw new D1InvalidInputError('capture-missing-or-invalid');
    prePoolState.completedCounts.states = 160;
    prePoolState.completedCounts.splitSubsets = { train: 80, validation: 32, test: 48 };
    prePoolState.manifestDigests.state = digest(captures.map(({ stateFingerprint }) => stateFingerprint));
    prePoolPhase = 'legal-universe';
    const freezeManifest = dependencies.freezePlacementManifest ?? freezeD1PlacementManifest;
    const subsets = captures.map((capture) => freezeManifest(capture));
    if (subsets.length !== 160) throw new D1InvalidInputError('capture-missing-or-invalid');
    prePoolPhase = 'placement-manifest';
    const manifestEvidence = buildD1ManifestEvidence(subsets);
    prePoolState.completedCounts.subsets = 160;
    prePoolState.completedCounts.placements = manifestEvidence.placementCount;
    prePoolState.completedCounts.splitPlacements = {
      train: manifestEvidence.splitPlacementCounts.train,
      validation: manifestEvidence.splitPlacementCounts.validation,
      test: manifestEvidence.splitPlacementCounts.test,
    };
    prePoolState.manifestDigests.legalUniverse = manifestEvidence.legalUniverseDigest;
    prePoolState.manifestDigests.placement = manifestEvidence.placementManifestDigest;
    prePoolPhase = 'cardinality';
    if (subsets.some(({ legalCount, selectedCount }) =>
      legalCount < 2 || selectedCount !== Math.min(12, legalCount))) {
      throw new D1InvalidInputError('placement-manifest-mismatch');
    }
    prePoolState.manifestDigests.cardinality = manifestEvidence.cardinalityDigest;
    const featureEvidence = buildD1ObservedFeatureEvidence(subsets);
    const streams = buildCanonicalStreams(subsets, labelSeeds);
    if (streams.streams.length !== 320) throw new D1InvalidInputError('seed-schedule-mismatch');

    prePoolPhase = 'context-manifest';
    const vectors = Object.freeze({
      'gen6-best': Object.freeze([...sources.vectors[0]!.weights]),
      'gen10-mu': Object.freeze([...sources.vectors[1]!.weights]),
    });
    const contextBatch: D1ContextTaskBatch = buildD1ContextTasks({ subsets, vectors, streams: streams.streams });
    const expectedContextCount = manifestEvidence.placementCount * 4;
    if (contextBatch.tasks.length !== expectedContextCount ||
      contextBatch.evidence.placementCount !== manifestEvidence.placementCount ||
      contextBatch.evidence.primaryContextCount !== expectedContextCount ||
      contextBatch.evidence.trainValidationContextCount !==
        (manifestEvidence.splitPlacementCounts.train + manifestEvidence.splitPlacementCounts.validation) * 4 ||
      contextBatch.evidence.heldOutContextCount !== manifestEvidence.splitPlacementCounts.test * 4) {
      throw new D1InvalidInputError('placement-manifest-mismatch');
    }
    prePoolState.completedCounts.contexts = expectedContextCount;
    prePoolState.manifestDigests.context = contextBatch.evidence.contextManifestDigest;
    prePoolState.manifestDigests.taskAssociation = contextBatch.evidence.taskAssociationDigest;
    const trainContextCount = manifestEvidence.splitPlacementCounts.train * 4;
    const trainValidationContextCount = contextBatch.evidence.trainValidationContextCount;
    const trainValidationTasks = contextBatch.tasks.slice(0, trainValidationContextCount);
    const testTasks = contextBatch.tasks.slice(trainValidationContextCount);
    const evidence = Object.freeze({
      sourceHashes: Object.freeze({ checkpoint: sources.sourceHashes.checkpoint, log: sources.sourceHashes.log }),
      behaviorSeedDigest: seedManifest.behaviorSeedDigest,
      labelSeedDigest: seedManifest.labelSeedDigest,
      stateCount: manifestEvidence.stateCount,
      placementCount: manifestEvidence.placementCount,
      contextTaskCount: contextBatch.evidence.primaryContextCount,
      streamPrefixCount: streams.streams.length,
      stateManifestDigest: manifestEvidence.stateManifestDigest,
      legalUniverseDigest: manifestEvidence.legalUniverseDigest,
      placementManifestDigest: manifestEvidence.placementManifestDigest,
      cardinalityDigest: manifestEvidence.cardinalityDigest,
      contextManifestDigest: contextBatch.evidence.contextManifestDigest,
      taskAssociationDigest: contextBatch.evidence.taskAssociationDigest,
    });

    runtimePhase = 'worker';
    try {
      pool = await (dependencies.createPool ?? (async () => D1WorkerPool.create(Math.max(1, Math.min(31, availableParallelism() - 1)))))(evidence);
    } catch (error) {
      if (error instanceof D1PipelineRuntimeError) throw error;
      throw new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity', 'worker pool creation failure', error);
    }
    const primaryProjections = await runContextPool(pool, trainValidationTasks, 'worker', dependencies.signal);
    if (primaryProjections.length !== trainValidationContextCount) {
      throw new D1PipelineRuntimeError('worker', 'worker-pool-failure', 'worker-projection-integrity');
    }
    const trainBatch = D1Labels.materializeD1LabeledBatch({
      contextBatch,
      split: 'train',
      projections: primaryProjections.slice(0, trainContextCount),
    });
    const validationBatch = D1Labels.materializeD1LabeledBatch({
      contextBatch,
      split: 'validation',
      projections: primaryProjections.slice(trainContextCount),
    });
    runtimePhase = 'optimizer';
    let selections: Record<D1RepresentationId, D1ValidationSelection>;
    let finalModels: D1FinalModelBundle;
    try {
      selections = {
        afterstate13: selectD1Lambda({
          representationId: 'afterstate13',
          fits: D1_LAMBDAS.map((lambda) => fitD1TrainingRepresentation({
            representationId: 'afterstate13', lambda, train: trainBatch,
          })),
          validation: validationBatch,
        }),
        action24: selectD1Lambda({
          representationId: 'action24',
          fits: D1_LAMBDAS.map((lambda) => fitD1TrainingRepresentation({
            representationId: 'action24', lambda, train: trainBatch,
          })),
          validation: validationBatch,
        }),
      };
      finalModels = freezeD1FinalModels({
        selections,
        train: trainBatch,
        validation: validationBatch,
      });
    } catch (error) {
      if (error instanceof D1PipelineRuntimeError) throw error;
      throw new D1PipelineRuntimeError('optimizer', 'optimizer-failure', 'optimizer', 'optimizer failure', error);
    }

    runtimePhase = 'test';
    testAttempt = D1Labels.consumeD1TestLabelCapability(finalModels, contextBatch);
    testAttemptInFlight = true;
    const testContextProjections = await runContextPool(pool, testTasks, 'test', dependencies.signal);
    if (testContextProjections.length !== contextBatch.evidence.heldOutContextCount ||
      testContextProjections.some((projection, index) => !isValidD1ProjectionForTask(projection, testTasks[index]!))) {
      throw new D1PipelineRuntimeError('test', 'test-before-freeze', 'held-out-test-before-freeze');
    }

    const replayAssociations = new Set(manifestEvidence.subsetCardinalities.slice(112)
      .filter(({ groupOrdinal }) => groupOrdinal === 0 || groupOrdinal === 11)
      .map((subset) => `${subset.subsetId}\0${subset.selectedPlacementIds[0]}`));
    const replayTasks = testTasks.filter((task) =>
      task.streamIndex === 0 && replayAssociations.has(`${task.subsetId}\0${task.placementId}`));
    if (replayTasks.length !== 16) {
      throw new D1PipelineRuntimeError('replay', 'nondeterministic-replay', 'replay-integrity');
    }
    runtimePhase = 'replay';
    const replayProjections = await runContextPool(pool, replayTasks, 'replay', dependencies.signal);
    if (replayProjections.length !== replayTasks.length) {
      throw new D1PipelineRuntimeError('replay', 'worker-pool-failure', 'worker-projection-integrity');
    }
    const replayTaskById = new Map(replayTasks.map((task) => [task.taskId, task]));
    const primaryById = new Map(testContextProjections.map((projection) => [projection.taskId, projection]));
    const replayIds = new Set<number>();
    const replayRecords = replayProjections.map((projection) => {
      const expectedTask = replayTaskById.get(projection.taskId);
      const primary = primaryById.get(projection.taskId);
      if (!expectedTask || !primary || replayIds.has(projection.taskId)) {
        throw new D1PipelineRuntimeError('replay', 'worker-pool-failure', 'worker-projection-integrity');
      }
      replayIds.add(projection.taskId);
      assertReplayProjectionMatches(expectedTask, primary, projection);
      return Object.freeze({
        taskId: projection.taskId,
        subsetId: projection.subsetId,
        placementId: projection.placementId,
        continuationVectorId: projection.continuationVectorId,
        streamIndex: 0 as const,
        primaryProjectionDigest: primary.projectionDigest,
        replayProjectionDigest: projection.projectionDigest,
      });
    });
    if (replayIds.size !== replayTasks.length) {
      throw new D1PipelineRuntimeError('replay', 'worker-pool-failure', 'worker-projection-integrity');
    }
    const replayDigest = digest(replayRecords);

    runtimePhase = 'cleanup';
    const poolToDestroy = pool;
    pool = undefined;
    try {
      await poolToDestroy.destroy();
    } catch (error) {
      if (error instanceof D1PipelineRuntimeError) throw error;
      throw new D1PipelineRuntimeError('cleanup', 'worker-pool-destroy-failure', 'worker-cleanup', 'worker cleanup failure', error);
    }

    runtimePhase = 'test';
    const testBatch = D1Labels.materializeD1LabeledBatch({
      contextBatch,
      split: 'test',
      projections: testContextProjections,
      testAttempt,
    });
    testAttemptInFlight = false;
    const heldOut = evaluateD1HeldOut(finalModels, testBatch);
    const labelDigest = buildLabelDigest(trainBatch, validationBatch, testBatch);
    const fitSummary = Object.freeze({
      afterstate13: Object.freeze({
        lambda: finalModels.models.afterstate13.lambda,
        normalizationDigest: finalModels.models.afterstate13.normalizationDigest,
        weightDigest: finalModels.models.afterstate13.weightDigest,
        convergenceDigest: digest([
          finalModels.models.afterstate13.gradientNorm,
          finalModels.models.afterstate13.iterationCount,
        ]),
      }),
      action24: Object.freeze({
        lambda: finalModels.models.action24.lambda,
        normalizationDigest: finalModels.models.action24.normalizationDigest,
        weightDigest: finalModels.models.action24.weightDigest,
        convergenceDigest: digest([
          finalModels.models.action24.gradientNorm,
          finalModels.models.action24.iterationCount,
        ]),
      }),
    });
    completedEvidence = deepFreeze({
      source: Object.freeze({ sourceHashes: Object.freeze({
        checkpoint: sources.sourceHashes.checkpoint,
        log: sources.sourceHashes.log,
      }), vectorDigests: Object.freeze({
        'gen6-best': sources.vectors[0]!.digest,
        'gen10-mu': sources.vectors[1]!.digest,
      }) }),
      search: Object.freeze({
        version: sources.metadata.version,
        objective: sources.metadata.objective,
        gen: sources.metadata.gen,
        contract: sources.metadata.searchContract,
        depth: sources.metadata.searchDepth,
        rootBeamWidth: 64 as const,
        childBeamWidth: 32 as const,
        maxWorkUnits: 3584 as const,
        budgetCorpus: sources.metadata.budgetCorpus,
        transpositionCacheEntries: 65536 as const,
        placementCacheEntries: 16384 as const,
      }),
      seeds: Object.freeze({ behaviorSeedDigest: seedManifest.behaviorSeedDigest, labelSeedDigest: seedManifest.labelSeedDigest }),
      manifest: manifestEvidence,
      features: Object.freeze({
        names: featureEvidence.names,
        dimensions: featureEvidence.dimensions,
        ranges: featureEvidence.ranges,
        projectionDigests: featureEvidence.projectionDigests,
      }),
      labels: Object.freeze({
        protocol: 'survival-first-joint-pareto-uniform-v2-variable-cardinality' as const,
        primaryContextCount: contextBatch.evidence.primaryContextCount,
        trainValidationContextCount: contextBatch.evidence.trainValidationContextCount,
        heldOutContextCount: contextBatch.evidence.heldOutContextCount,
        streamPrefixCount: 320 as const,
        futurePrefixDigest: streams.aggregateDigest,
        contextManifestDigest: contextBatch.evidence.contextManifestDigest,
        taskAssociationDigest: contextBatch.evidence.taskAssociationDigest,
        labelDigest,
      }),
      fits: fitSummary,
      validation: Object.freeze({
        afterstate13: Object.freeze({ lambda: selections.afterstate13.lambda, selectionDigest: selections.afterstate13.validationSelectionDigest, survivalBelowSubsetOracle: selections.afterstate13.validationSurvivalBelowSubsetOracle, subsetJointFrontHits: selections.afterstate13.validationSubsetJointFrontHits }),
        action24: Object.freeze({ lambda: selections.action24.lambda, selectionDigest: selections.action24.validationSelectionDigest, survivalBelowSubsetOracle: selections.action24.validationSurvivalBelowSubsetOracle, subsetJointFrontHits: selections.action24.validationSubsetJointFrontHits }),
      }),
      heldOut: projectHeldOut(heldOut),
      replays: Object.freeze({ count: 16 as const, records: Object.freeze(replayRecords), digest: replayDigest }),
    } satisfies D1CompletedEvidence);
    primaryStatus = heldOut.status;
    primaryFailureReasons = heldOut.failureReasons;
  } catch (error) {
    if (testAttemptInFlight && testAttempt !== undefined) {
      try {
        D1Labels.failD1TestLabelAttempt(testAttempt);
      } catch (crossingError) {
        postPrimaryRuntimeReasons.push(crossingError instanceof D1PipelineRuntimeError
          ? crossingError.reason
          : 'test-before-freeze');
      }
      testAttemptInFlight = false;
    }
    if (error instanceof D1InvalidInputError && pool === undefined) {
      primaryStatus = 'invalid-input';
      primaryFailureReasons = [error.reason];
    }
    else if (dependencies.signal?.aborted) {
      primaryStatus = 'runtime-fail';
      primaryFailureReasons = ['abort'];
    } else {
      const reason = error instanceof D1PipelineRuntimeError
        ? error.reason
        : pool === undefined && prePoolPhase === 'captures' ? 'simulation-failure'
          : runtimePhase === 'optimizer' ? 'optimizer-failure'
            : runtimePhase === 'worker' ? 'worker-pool-failure'
              : runtimePhase === 'test' ? 'test-before-freeze'
                : runtimePhase === 'replay' ? 'nondeterministic-replay'
                  : 'worker-pool-destroy-failure';
      if (error instanceof D1PipelineRuntimeError) runtimePhase = error.phase;
      primaryStatus = 'runtime-fail';
      primaryFailureReasons = [reason];
    }
  } finally {
    if (pool !== undefined) {
      try { await pool.destroy(); } catch { postPrimaryRuntimeReasons.push('worker-pool-destroy-failure'); }
    }
    const finalSnapshot = snapshot?.();
    if (snapshot !== undefined && JSON.stringify(initialSnapshot) !== JSON.stringify(finalSnapshot)) {
      postPrimaryRuntimeReasons.push('malformed-metrics');
    }
  }
  if (primaryStatus === 'invalid-input') {
    const reasons = primaryFailureReasons.filter((reason): reason is D1InvalidInputReason =>
      !isRuntimeFailureReason(reason) && !isStatisticalFailureReason(reason));
    return prePoolFailure(prePoolPhase, [...new Set(reasons)], prePoolState);
  }
  if (primaryStatus === 'runtime-fail' || postPrimaryRuntimeReasons.length > 0) {
    const primaryReasons = primaryStatus === 'runtime-fail'
      ? [...new Set(primaryFailureReasons.filter(isRuntimeFailureReason))]
      : [];
    const primaryReasonSet = new Set(primaryReasons);
    const postReasonSet = new Set(postPrimaryRuntimeReasons);
    const reasons = [
      ...primaryReasons,
      ...D1_RUNTIME_FAILURE_REASONS.filter((reason) =>
        postReasonSet.has(reason) && !primaryReasonSet.has(reason)),
    ];
    return runtimeFailure(postPrimaryRuntimeReasons.length > 0 ? 'cleanup' : runtimePhase, reasons, completedEvidence);
  }
  if (primaryStatus === 'pass-action-conditioned-listwise-supported') return passResult(completedEvidence!);
  const reasons = [...new Set(primaryFailureReasons.filter(isStatisticalFailureReason))];
  const [firstReason, ...remainingReasons] = reasons;
  if (firstReason === undefined) throw new Error('malformed-metrics');
  return statisticalResult(primaryStatus, [firstReason, ...remainingReasons], completedEvidence!);
}

export async function runD1DiagnosticCli(
  dependencies: D1CliDependencies = {},
): Promise<D1CliResult> {
  try {
    const output = dependencies.runDiagnostic !== undefined
      ? await dependencies.runDiagnostic(dependencies.signal)
      : await runD1Diagnostic({ signal: dependencies.signal });
    return {
      exitCode: output.status === 'pass-action-conditioned-listwise-supported' ? 0 : 1,
      stdout: `${serializeD1Result(output)}\n`,
      stderr: '',
    };
  } catch {
    return { exitCode: 1, stdout: '', stderr: 'D1 diagnostic failed: internal-error\n' };
  }
}

export function serializeD1Result(result: D1DiagnosticResult): string {
  return canonicalJson(result);
}

export function resultDigest(projection: Omit<D1DiagnosticResult, 'resultDigest'>): string {
  return createHash('sha256').update(canonicalJson(projection), 'utf8').digest('hex');
}

function projectionWithoutDigest(projection: D1ContextProjection): Omit<D1ContextProjection, 'projectionDigest'> {
  return {
    taskId: projection.taskId,
    subsetId: projection.subsetId,
    placementId: projection.placementId,
    continuationVectorId: projection.continuationVectorId,
    streamIndex: projection.streamIndex,
    pieces: projection.pieces,
    scoreDelta: projection.scoreDelta,
    clearCounts: projection.clearCounts,
    reason: projection.reason,
    searchDiagnostics: projection.searchDiagnostics,
  };
}

function assertReplayProjectionMatches(
  expectedTask: D1ContextTask,
  primary: D1ContextProjection,
  replay: D1ContextProjection,
): void {
  if (replay.projectionDigest !== digest(projectionWithoutDigest(replay)) ||
    primary.projectionDigest !== digest(projectionWithoutDigest(primary)) ||
    JSON.stringify(projectionWithoutDigest(primary)) !== JSON.stringify(projectionWithoutDigest(replay)) ||
    replay.taskId !== expectedTask.taskId || replay.subsetId !== expectedTask.subsetId ||
    replay.placementId !== expectedTask.placementId || replay.continuationVectorId !== expectedTask.continuationVectorId ||
    replay.streamIndex !== expectedTask.streamIndex) {
    throw new D1PipelineRuntimeError('replay', 'nondeterministic-replay', 'replay-integrity');
  }
}

export async function runD1Main(dependencies: Readonly<{
  process?: D1MainProcessLike;
  runDiagnostic?: (signal?: AbortSignal) => Promise<D1DiagnosticResult>;
}> = {}): Promise<void> {
  const processLike = dependencies.process ?? process;
  const controller = new AbortController();
  let interrupted = false;
  const onSigint = () => {
    if (interrupted) return;
    interrupted = true;
    controller.abort();
  };
  processLike.once('SIGINT', onSigint);
  try {
    const result = await runD1DiagnosticCli({
      signal: controller.signal,
      runDiagnostic: dependencies.runDiagnostic,
    });
    if (result.stdout) processLike.stdout.write(result.stdout);
    if (result.stderr) processLike.stderr.write(result.stderr);
    processLike.exitCode = result.exitCode;
  } finally {
    processLike.removeListener('SIGINT', onSigint);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runD1Main();
}
