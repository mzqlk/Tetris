import {
  buildD1LabelSeeds,
  buildD1SeedManifest,
  freezeD1PlacementManifest,
  loadD1Sources,
  type D1CapturedState,
  type D1FrozenSubset,
  type D1SeedManifest,
  type D1Sources,
  type D1RepresentationId,
  type D1Split,
  type D1VectorId,
} from './d1ActionConditionedHeldOutListwiseCore';
import {
  buildD1ContextTasks,
  buildD1FutureStreams,
  consumeD1TestLabelCapability,
  materializeD1LabeledBatch,
  type D1AuthenticatedLabeledBatch,
  type D1ContextProjection,
  type D1ContextTask,
  type D1ContextTaskBatch,
  type D1TestLabelAttemptCapability,
} from './d1ActionConditionedHeldOutListwiseLabels';
import {
  D1_LAMBDAS,
  evaluateD1HeldOut,
  fitD1TrainingRepresentation,
  freezeD1FinalModels,
  selectD1Lambda,
  type D1FinalModelBundle,
  type D1FitResult,
  type D1ValidationSelection,
} from './d1ActionConditionedHeldOutListwiseFit';
import { D2_PROFILE, type ListwiseProtocolProfile } from './d2Protocol';
import {
  D2ManifestError,
  digestOf,
  type D2ShardId,
  type D2Stage2Manifest,
} from './d2ShardManifest';
import { readD2Payloads } from './d2Scheduler';
import type { D2ShardExecutionContext } from './d2ShardedHeldOutListwise';

/**
 * Real shard executors: the bridge from the sharded execution layer to the
 * unchanged D1 statistical core.
 *
 * One structural fact shapes everything here. D1's provenance capabilities are
 * WeakMap-backed, non-serializable and bound to a single run authority, so they
 * cannot cross an episode boundary. The design's answer (§7.3) is that the
 * chain is rebuilt *within each episode* from validated receipts, which is
 * sound because every link is a deterministic function of the frozen inputs
 * plus already-receipted projections:
 *
 *   captures (receipts) -> subsets -> streams -> contextBatch
 *   contextBatch + label projections (receipts) -> authenticated batches
 *   authenticated batches -> fits -> selections -> final bundle -> test attempt
 *
 * `materializeD1LabeledBatch` takes projections as plain data and validates
 * them against the context batch's task identities, so replaying receipted
 * projections is indistinguishable from a live worker run — exactly what
 * resume equivalence requires.
 *
 * Several D1 capabilities are deliberately one-shot per run authority: a
 * (representation, lambda) fit, the final freeze, each split's materialization,
 * and the test attempt. Because one episode may execute several shards that
 * each need the same link, every one of them is memoized on `EpisodeChain`.
 * Calling the underlying D1 function twice would trip D1's own duplicate
 * guards, which is correct behaviour on D1's part and must not be worked
 * around by relaxing them.
 */

/**
 * The shard id travels with the tasks so the worker protocol can reject a
 * reply that belongs to a different shard; without it that field of the
 * protocol would be unusable.
 */
export type D2ContextRunner = (input: {
  readonly shardId: D2ShardId;
  readonly tasks: readonly D1ContextTask[];
  readonly signal?: AbortSignal;
}) => Promise<readonly D1ContextProjection[]>;

/**
 * Asynchronous by contract, because the real implementation must not be
 * synchronous: `captureD1Trajectory` simulates 512 scheduled pieces, and
 * running that on the orchestrator's thread would block the heartbeat, the
 * per-shard watchdog and the signal handlers for the whole shard.
 */
export interface D2TrajectoryRunner {
  (input: {
    readonly shardId: D2ShardId;
    readonly behaviorSeed: number;
    readonly split: D1Split;
    readonly groupOrdinal: number;
    readonly behaviorVectorId: D1VectorId;
    readonly sources: D1Sources;
    readonly signal?: AbortSignal;
  }): Promise<readonly D1CapturedState[]>;
}

export interface D2ExecutorDependencies {
  readonly runContexts: D2ContextRunner;
  readonly runTrajectory: D2TrajectoryRunner;
  readonly profile?: ListwiseProtocolProfile;
  readonly loadSources?: () => D1Sources;
}

const REPRESENTATIONS: readonly D1RepresentationId[] = Object.freeze(['afterstate13', 'action24']);
const SPLITS: readonly D1Split[] = Object.freeze(['train', 'validation', 'test']);
const VECTOR_IDS: readonly D1VectorId[] = Object.freeze(['gen6-best', 'gen10-mu']);
const REPLAY_GROUP_ENDPOINTS: readonly number[] = Object.freeze([0, 11]);
const CAPTURE_SLOTS: readonly (128 | 512)[] = Object.freeze([128, 512]);

/**
 * Per-episode memo of the D1 chain. Every value is a deterministic function of
 * the frozen inputs and the receipts, so rebuilding it in a later episode
 * yields byte-identical results.
 */
export class EpisodeChain {
  private sourcesCache: D1Sources | null = null;
  private seedManifestCache: D1SeedManifest | null = null;
  private subsetsCache: readonly D1FrozenSubset[] | null = null;
  private contextBatchCache: D1ContextTaskBatch | null = null;
  private readonly labeledCache = new Map<D1Split, D1AuthenticatedLabeledBatch>();
  private readonly fitCache = new Map<D1RepresentationId, readonly D1FitResult[]>();
  private selectionsCache: Readonly<Record<D1RepresentationId, D1ValidationSelection>> | null = null;
  private finalBundleCache: D1FinalModelBundle | null = null;
  private testAttemptCache: D1TestLabelAttemptCapability | null = null;

  constructor(
    private readonly deps: D2ExecutorDependencies,
    readonly profile: ListwiseProtocolProfile,
  ) {}

  sources(): D1Sources {
    this.sourcesCache ??= (this.deps.loadSources ?? loadD1Sources)();
    return this.sourcesCache;
  }

  seedManifest(): D1SeedManifest {
    this.seedManifestCache ??= buildD1SeedManifest(this.profile);
    return this.seedManifestCache;
  }

  subsets(captures: readonly D1CapturedState[]): readonly D1FrozenSubset[] {
    this.subsetsCache ??= captures.map((capture) => freezeD1PlacementManifest(capture, this.profile));
    return this.subsetsCache;
  }

  contextBatch(captures: readonly D1CapturedState[]): D1ContextTaskBatch {
    if (this.contextBatchCache !== null) return this.contextBatchCache;
    const subsets = this.subsets(captures);
    // Index into the frozen schedule rather than recomputing it: subsets are in
    // canonical order, so subset s owns label seeds 2s and 2s+1 — the same
    // indexing D1 itself uses.
    const labelSeeds = buildD1LabelSeeds(this.seedManifest(), this.profile);
    const entries = subsets.flatMap((subset, subsetIndex) =>
      ([0, 1] as const).map((streamIndex) => ({
        subsetId: subset.subsetId,
        labelSeed: labelSeeds[subsetIndex * 2 + streamIndex]!,
        unseenBagMask: subset.capture.state.unseenBagMask,
        streamIndex,
      })));
    this.contextBatchCache = buildD1ContextTasks({
      subsets,
      vectors: this.sources().vectors,
      streams: buildD1FutureStreams({ entries, profile: this.profile }).streams,
      profile: this.profile,
    });
    return this.contextBatchCache;
  }

  tasksForSubset(captures: readonly D1CapturedState[], subsetId: string): readonly D1ContextTask[] {
    const tasks = this.contextBatch(captures).tasks.filter((task) => task.subsetId === subsetId);
    if (tasks.length === 0) throw new D2ManifestError('placement-manifest-mismatch');
    return tasks;
  }

  /** One materialization per split per episode; D1 enforces it, this memoizes it. */
  labeledBatch(
    split: Exclude<D1Split, 'test'>,
    captures: readonly D1CapturedState[],
    projections: readonly D1ContextProjection[],
  ): D1AuthenticatedLabeledBatch {
    const existing = this.labeledCache.get(split);
    if (existing !== undefined) return existing;
    const batch = materializeD1LabeledBatch({
      contextBatch: this.contextBatch(captures),
      split,
      projections,
    });
    this.labeledCache.set(split, batch);
    return batch;
  }

  /** Five lambdas for one representation; memoized against D1's duplicate-fit guard. */
  fits(
    representationId: D1RepresentationId,
    captures: readonly D1CapturedState[],
    trainProjections: readonly D1ContextProjection[],
  ): readonly D1FitResult[] {
    const existing = this.fitCache.get(representationId);
    if (existing !== undefined) return existing;
    const train = this.labeledBatch('train', captures, trainProjections);
    const fits = D1_LAMBDAS.map((lambda) =>
      fitD1TrainingRepresentation({ representationId, lambda, train }));
    this.fitCache.set(representationId, fits);
    return fits;
  }

  selections(
    captures: readonly D1CapturedState[],
    trainProjections: readonly D1ContextProjection[],
    validationProjections: readonly D1ContextProjection[],
  ): Readonly<Record<D1RepresentationId, D1ValidationSelection>> {
    if (this.selectionsCache !== null) return this.selectionsCache;
    const validation = this.labeledBatch('validation', captures, validationProjections);
    const select = (representationId: D1RepresentationId): D1ValidationSelection => selectD1Lambda({
      representationId,
      fits: [...this.fits(representationId, captures, trainProjections)],
      validation,
    });
    // Written out rather than looped so exhaustiveness is a type fact.
    const selections = {
      afterstate13: select('afterstate13'),
      action24: select('action24'),
    };
    this.selectionsCache = selections;
    return selections;
  }

  /**
   * Any episode that touches the test phase must rebuild this, because D1
   * requires the final bundle and the test attempt to share one run authority.
   * It is pure math over already-computed labels, not simulation.
   */
  finalBundle(
    captures: readonly D1CapturedState[],
    trainProjections: readonly D1ContextProjection[],
    validationProjections: readonly D1ContextProjection[],
  ): D1FinalModelBundle {
    if (this.finalBundleCache !== null) return this.finalBundleCache;
    this.finalBundleCache = freezeD1FinalModels({
      selections: this.selections(captures, trainProjections, validationProjections),
      train: this.labeledBatch('train', captures, trainProjections),
      validation: this.labeledBatch('validation', captures, validationProjections),
    });
    return this.finalBundleCache;
  }

  /** One attempt per episode, obtained before the first test task runs. */
  testAttempt(
    captures: readonly D1CapturedState[],
    bundle: D1FinalModelBundle,
  ): D1TestLabelAttemptCapability {
    this.testAttemptCache ??= consumeD1TestLabelCapability(bundle, this.contextBatch(captures));
    return this.testAttemptCache;
  }
}

/**
 * The subsets this episode froze must be the ones stage 2 published.
 *
 * Stage 2 and the executor freeze the placement manifest independently — stage 2
 * from the capture receipts at the freeze boundary, the executor from the same
 * receipts in every later episode — and nothing compared them. Any disagreement
 * (a profile that reached one and not the other, a selection rule that changed
 * under a resumed episode) produced a run whose contexts were not the ones its
 * own manifest described, with no shard failing and no digest disagreeing. That
 * is the C1 failure class; this is where it becomes observable, at the first
 * shard after capture rather than never.
 */
function assertSubsetsMatchStage2(
  subsets: readonly D1FrozenSubset[],
  stage2: D2Stage2Manifest,
): void {
  const published = new Map(stage2.subsets.map((subset) => [subset.subsetId, subset]));
  if (published.size !== subsets.length) throw new D2ManifestError('placement-manifest-mismatch');
  for (const subset of subsets) {
    const entry = published.get(subset.subsetId);
    if (entry === undefined
      || entry.legalCount !== subset.legalCount
      || entry.selectedCount !== subset.selectedCount
      || entry.legalUniverseDigest !== subset.legalUniverseDigest
      || entry.manifestDigest !== subset.manifestDigest
      || JSON.stringify(entry.selectedPlacementIds)
        !== JSON.stringify(subset.placements.map(({ placementId }) => placementId))) {
      throw new D2ManifestError('placement-manifest-mismatch');
    }
  }
}

function capturesFrom(context: D2ShardExecutionContext): readonly D1CapturedState[] {
  // Each capture shard receipts both of its slots, so flattening restores the
  // canonical 160-entry order.
  return readD2Payloads(context.capability, 'capture')
    .flatMap(({ payload }) => payload as readonly D1CapturedState[]);
}

function projectionsFrom(
  context: D2ShardExecutionContext,
  phase: 'label-train' | 'label-validation' | 'label-test',
): readonly D1ContextProjection[] {
  return readD2Payloads(context.capability, phase)
    .flatMap(({ payload }) => payload as readonly D1ContextProjection[]);
}

/**
 * Rebuild the frozen bundle from train and validation payloads only, and prove
 * it reproduces the `final-freeze` receipt. Held-out projections are read by
 * the caller strictly after this returns, so at no point is a test projection
 * in scope while a fit is running.
 */
function rebuildFrozenBundle(
  chain: EpisodeChain,
  context: D2ShardExecutionContext,
  captures: readonly D1CapturedState[],
): D1FinalModelBundle {
  const trainProjections = projectionsFrom(context, 'label-train');
  const validationProjections = projectionsFrom(context, 'label-validation');
  assertRebuildMatchesReceipts(context, 'fit', new Map(
    REPRESENTATIONS.map((representationId) => [
      `fit/${representationId}`,
      chain.fits(representationId, captures, trainProjections),
    ]),
  ));
  assertRebuildMatchesReceipts(context, 'selection', new Map([
    ['selection', chain.selections(captures, trainProjections, validationProjections)],
  ]));
  const bundle = chain.finalBundle(captures, trainProjections, validationProjections);
  assertRebuildMatchesReceipts(context, 'final-freeze', new Map([['final-freeze', bundle]]));
  return bundle;
}

function subsetIdOf(shardId: D2ShardId): string {
  const [, ...rest] = shardId.split('/');
  return rest.join('/');
}

/**
 * A replay that does not reproduce its primary projection exactly.  Classified
 * as `replay-mismatch`, so the first occurrence ends the episode and a second
 * occurrence on the same shard promotes to a run-level `runtime-fail`.
 */
/**
 * A link rebuilt in this episode does not match the receipt an earlier episode
 * wrote for it.
 *
 * The whole per-episode rebuild strategy rests on every link being a
 * deterministic function of the frozen inputs and the receipts. Nothing else
 * checks that: `fit`, `selection` and `final-freeze` receipts are otherwise
 * write-only, so a bundle that drifted between episodes would score held-out
 * data while the evidence directory still recorded the model it replaced.
 * Classified `shard-nondeterminism`, so the first occurrence ends the episode
 * and a second identical one promotes.
 */
export class D2NondeterminismError extends Error {
  readonly name = 'D2NondeterminismError';
  readonly reason = 'shard-nondeterminism' as const;
  constructor(detail: string) {
    super(`D2 runtime-fail:shard-nondeterminism:${detail}`);
  }
}

/**
 * Compare a rebuilt value against the receipt that already records it. The
 * receipt's `payloadDigest` is `digestOf(payload)`, so re-digesting the rebuilt
 * value is an exact comparison rather than a structural one.
 */
/** Exported under a test-only name so the fail-closed branch is reachable. */
export const assertRebuildMatchesReceiptsForTest = (
  capability: D2ShardExecutionContext['capability'],
  phase: 'fit' | 'selection' | 'final-freeze',
  rebuiltByShard: ReadonlyMap<D2ShardId, unknown>,
): void => assertRebuildMatchesReceipts(
  { capability } as D2ShardExecutionContext, phase, rebuiltByShard,
);

function assertRebuildMatchesReceipts(
  context: D2ShardExecutionContext,
  phase: 'fit' | 'selection' | 'final-freeze',
  rebuiltByShard: ReadonlyMap<D2ShardId, unknown>,
): void {
  for (const { shardId, payload } of readD2Payloads(context.capability, phase)) {
    const rebuilt = rebuiltByShard.get(shardId);
    // Fail closed on an unrecognised shard id. Skipping it would turn the whole
    // detector into a silent no-op the first time a shard id is renamed on one
    // side and not the other, with every test still green.
    if (rebuilt === undefined) {
      throw new D2NondeterminismError(`${shardId} has no rebuilt counterpart`);
    }
    if (digestOf(rebuilt) !== digestOf(payload)) {
      throw new D2NondeterminismError(`${shardId} did not reproduce`);
    }
  }
}

export class D2ReplayMismatchError extends Error {
  readonly name = 'D2ReplayMismatchError';
  readonly reason = 'replay-mismatch' as const;
  constructor(detail: string) {
    super(`D2 runtime-fail:replay-mismatch:${detail}`);
  }
}

/**
 * The whole projection is compared, `projectionDigest` included, rather than
 * D1's field-by-field list: it is strictly stronger for detecting divergence
 * and it avoids restating D1's digest preimage here, which would silently rot
 * if D1 ever changed it. Verifying that a single projection's digest matches
 * its own content stays where it already lives — the context runner, which is
 * the component that received it from a worker.
 */
function assertReplayMatchesPrimary(
  task: D1ContextTask,
  primary: D1ContextProjection | undefined,
  replayed: D1ContextProjection | undefined,
): asserts replayed is D1ContextProjection {
  if (replayed === undefined) throw new D2ReplayMismatchError('missing replay projection');
  if (primary === undefined) throw new D2ReplayMismatchError('missing primary projection');
  if (replayed.taskId !== task.taskId || replayed.subsetId !== task.subsetId
    || replayed.placementId !== task.placementId
    || replayed.continuationVectorId !== task.continuationVectorId
    || replayed.streamIndex !== task.streamIndex) {
    throw new D2ReplayMismatchError('replay identity does not match the audited context');
  }
  if (JSON.stringify(primary) !== JSON.stringify(replayed)) {
    throw new D2ReplayMismatchError(`context ${task.taskId} did not reproduce`);
  }
}

/**
 * The 16 audit replays: test group endpoints 0 and 11, x two behavior vectors,
 * x two capture slots, x two continuation policies. Each uses that subset's
 * canonical-first placement and stream 0.
 *
 * The order is fixed so replay index N means the same context on every run:
 * group endpoint, then behavior vector, then capture slot, then continuation
 * vector.
 */
export function replayTaskFor(
  batch: D1ContextTaskBatch,
  subsets: readonly D1FrozenSubset[],
  index: number,
): D1ContextTask {
  const coordinates: { subsetId: string; continuationVectorId: D1VectorId }[] = [];
  for (const groupOrdinal of REPLAY_GROUP_ENDPOINTS) {
    for (const behaviorVectorId of VECTOR_IDS) {
      for (const captureSlot of CAPTURE_SLOTS) {
        const subset = subsets.find(({ capture }) =>
          capture.split === 'test'
          && capture.groupOrdinal === groupOrdinal
          && capture.behaviorVectorId === behaviorVectorId
          && capture.captureSlot === captureSlot);
        if (subset === undefined) throw new D2ManifestError('capture-missing-or-invalid');
        for (const continuationVectorId of VECTOR_IDS) {
          coordinates.push({ subsetId: subset.subsetId, continuationVectorId });
        }
      }
    }
  }
  const coordinate = coordinates[index];
  if (coordinate === undefined) throw new D2ManifestError('placement-manifest-mismatch');

  const subset = subsets.find(({ subsetId }) => subsetId === coordinate.subsetId)!;
  const canonicalFirstPlacementId = subset.placements[0]?.placementId;
  if (canonicalFirstPlacementId === undefined) throw new D2ManifestError('placement-manifest-mismatch');

  const task = batch.tasks.find((candidate) =>
    candidate.subsetId === coordinate.subsetId
    && candidate.placementId === canonicalFirstPlacementId
    && candidate.continuationVectorId === coordinate.continuationVectorId
    && candidate.streamIndex === 0);
  if (task === undefined) throw new D2ManifestError('placement-manifest-mismatch');
  return task;
}

/**
 * Build the default executor. `runContexts` and `runTrajectory` are injected so
 * the worker pool and the real simulator stay out of this module and the code
 * gate can drive every phase with fakes.
 */
export function createD2ShardExecutors(deps: D2ExecutorDependencies) {
  const profile = deps.profile ?? D2_PROFILE;
  const chain = new EpisodeChain(deps, profile);
  let subsetsVerified = false;

  /** Once per episode: every later phase depends on the same 160 subsets. */
  const capturesChecked = (context: D2ShardExecutionContext): readonly D1CapturedState[] => {
    const captures = capturesFrom(context);
    if (!subsetsVerified && context.stage2 !== null) {
      subsetsVerified = true;
      assertSubsetsMatchStage2(chain.subsets(captures), context.stage2);
    }
    return captures;
  };

  return async function executeD2Shard(context: D2ShardExecutionContext): Promise<unknown> {
    const { shardId, phase } = context;

    switch (phase) {
      case 'capture': {
        const [, split, ordinal, vectorId] = shardId.split('/');
        const groupOrdinal = Number(ordinal);
        // The frozen manifest cannot produce coordinates outside these sets, so
        // this is a fail-closed guard rather than a live case: without it a
        // malformed split would index `undefined` and surface as an unclassified
        // TypeError instead of an input veto.
        if (!SPLITS.includes(split as D1Split) || !VECTOR_IDS.includes(vectorId as D1VectorId)) {
          throw new D2ManifestError('capture-missing-or-invalid');
        }
        const behaviorSeed = chain.seedManifest().behaviorSeeds[split as D1Split][groupOrdinal];
        if (behaviorSeed === undefined) throw new D2ManifestError('capture-missing-or-invalid');
        const captured = await deps.runTrajectory({
          shardId,
          behaviorSeed,
          split: split as D1Split,
          groupOrdinal,
          behaviorVectorId: vectorId as D1VectorId,
          sources: chain.sources(),
          signal: context.signal,
        });
        // One trajectory yields exactly the two frozen capture slots.
        if (captured.length !== CAPTURE_SLOTS.length) {
          throw new D2ManifestError('capture-missing-or-invalid');
        }
        return captured;
      }

      case 'label-train':
      case 'label-validation': {
        const captures = capturesChecked(context);
        return await deps.runContexts({
          shardId,
          tasks: chain.tasksForSubset(captures, subsetIdOf(shardId)),
          signal: context.signal,
        });
      }

      case 'fit': {
        const captures = capturesChecked(context);
        const representationId = shardId.split('/')[1] as D1RepresentationId;
        if (!REPRESENTATIONS.includes(representationId)) {
          throw new D2ManifestError('placement-manifest-mismatch');
        }
        return chain.fits(representationId, captures, projectionsFrom(context, 'label-train'));
      }

      case 'selection': {
        const captures = capturesChecked(context);
        const trainProjections = projectionsFrom(context, 'label-train');
        // The fits are rebuilt here rather than read from the `fit` receipts,
        // because D1 only accepts authenticated fit objects. Checking the
        // rebuild against those receipts is what keeps that legitimate.
        assertRebuildMatchesReceipts(context, 'fit', new Map(
          REPRESENTATIONS.map((representationId) => [
            `fit/${representationId}`,
            chain.fits(representationId, captures, trainProjections),
          ]),
        ));
        return chain.selections(
          captures,
          trainProjections,
          projectionsFrom(context, 'label-validation'),
        );
      }

      case 'final-freeze': {
        const captures = capturesChecked(context);
        const trainProjections = projectionsFrom(context, 'label-train');
        const validationProjections = projectionsFrom(context, 'label-validation');
        assertRebuildMatchesReceipts(context, 'selection', new Map([
          ['selection', chain.selections(captures, trainProjections, validationProjections)],
        ]));
        return chain.finalBundle(captures, trainProjections, validationProjections);
      }

      case 'label-test': {
        // Identical to the other label phases, and deliberately so. D1 orders
        // `consumeD1TestLabelCapability` before its held-out pool because that
        // is the only crossing marker a single-process run has. Under D2 the
        // crossing is carried by the receipt DAG instead: `label-test` cannot
        // be scheduled before `final-freeze` has a receipt, and once any test
        // receipt exists the fit side can never be rescheduled (§7.3, enforced
        // by `assertD2FreezeBoundary`). That is a durable proof rather than an
        // in-process one, and it lets this shard stay what the design requires
        // — a label producer that has no model in reach (§5.3: "`label-test`
        // 不接收模型"). The attempt itself is consumed in `aggregate`, where
        // the frozen bundle legitimately lives.
        const captures = capturesChecked(context);
        return await deps.runContexts({
          shardId,
          tasks: chain.tasksForSubset(captures, subsetIdOf(shardId)),
          signal: context.signal,
        });
      }

      case 'replay': {
        // The 16 replays are the only nondeterminism detector a real run can
        // reach: nothing recomputes a completed shard (§10.3). Running the
        // context without comparing it to the primary would leave that
        // detector inert, so the comparison is the shard's actual work.
        const captures = capturesChecked(context);
        const task = replayTaskFor(
          chain.contextBatch(captures),
          chain.subsets(captures),
          Number(shardId.split('/')[1]),
        );
        const [replayed] = await deps.runContexts({
          shardId, tasks: [task], signal: context.signal,
        });
        assertReplayMatchesPrimary(
          task,
          projectionsFrom(context, 'label-test').find(({ taskId }) => taskId === task.taskId),
          replayed,
        );
        return replayed;
      }

      case 'aggregate': {
        const captures = capturesChecked(context);
        // Deviation, declared: this rebuilds the fits, the selections and the
        // final freeze, so the fitter is reachable from a shard that also holds
        // held-out projections — which design 5.3 says aggregate must not be
        // able to do. It is forced by the same authority model as the
        // `selection` widening: a freeze receipt is inert JSON, and
        // `evaluateD1HeldOut` accepts only a bundle carrying live D1 authority.
        // What replaces the structural barrier is the check below plus D1's own
        // guards: the rebuilt bundle must reproduce the frozen receipt exactly,
        // the bundle is built before any test projection is read, and D1's
        // one-shot test attempt cannot be obtained twice.
        const bundle = rebuildFrozenBundle(chain, context, captures);
        const testBatch = materializeD1LabeledBatch({
          contextBatch: chain.contextBatch(captures),
          split: 'test',
          projections: projectionsFrom(context, 'label-test'),
          testAttempt: chain.testAttempt(captures, bundle),
        });
        return evaluateD1HeldOut(bundle, testBatch);
      }

      default:
        throw new Error(`D2 has no executor for phase ${phase as string}`);
    }
  };
}
