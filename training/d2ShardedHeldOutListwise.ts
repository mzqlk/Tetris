import { pathToFileURL } from 'node:url';
import {
  D2_RUNTIME_IDENTITY,
  D2ManifestError,
  buildD2Stage1Manifest,
  buildD2Stage2Manifest,
  canonicalJson,
  digestOf,
  runIdFor,
  stage1Digest,
  type D2Phase,
  type D2RuntimeIdentity,
  type D2ShardId,
  type D2Stage1Manifest,
  type D2Stage2Manifest,
} from './d2ShardManifest';
import {
  D2EvidenceIntegrityError,
  adjudicateRunLock,
  appendRunRecord,
  assertNoReceiptRegression,
  buildD2Receipt,
  evidenceDir,
  lastFailure,
  lockPath,
  readRunRecord,
  readValidReceipts,
  resultPath,
  stage1Path,
  stage2Path,
  unpairedEpisodeOrdinals,
  writeAtomic,
  writeReceiptAtomic,
  type D2FileSystem,
  type D2Receipt,
  type D2RunRecordEntry,
  type D2TerminationCause,
} from './d2Evidence';
import {
  D2FreezeBoundaryError,
  grantD2PayloadCapability,
  scheduleD2,
  shardPhase,
} from './d2Scheduler';
import { perShardCeilingMs, watchdogVerdict } from './d2Watchdog';
import {
  classifyD2Exit,
  exitCodeForStatus,
  shouldPromoteToRuntimeFail,
  writeResultOnce,
  writesResultJson,
  type D2CanonicalStatus,
  type D2ExitClass,
} from './d2Exit';
import { D2_PROFILE, type ListwiseProtocolProfile } from './d2Protocol';
import { createD2ShardExecutors, type D2TrajectoryRunner } from './d2ShardExecutors';
import {
  D2WorkerPool,
  anyD2ProcessRunning,
  createD2ContextRunner,
  createD2TrajectoryRunner,
  defaultD2WorkerCount,
  isProcessAlive,
  nodeD2FileSystem,
  trainerLockPresent,
  type D2PoolLike,
} from './d2Runtime';
import type {
  D1CapturedState,
  D1Sources,
} from './d1ActionConditionedHeldOutListwiseCore';

export const MAX_PRODUCTIVE_EPISODES = 5;
export const MAX_BARREN_EPISODES = 10;
export const HEARTBEAT_INTERVAL_MS = 30_000;

export interface D2ShardExecutionContext {
  readonly shardId: D2ShardId;
  readonly phase: D2Phase;
  readonly stage1: D2Stage1Manifest;
  readonly stage2: D2Stage2Manifest | null;
  readonly profile: ListwiseProtocolProfile;
  /** Granted per (phase, split); the only route to an earlier phase's payload. */
  readonly capability: ReturnType<typeof grantD2PayloadCapability>;
  readonly signal?: AbortSignal;
}

export type D2ShardExecutor = (context: D2ShardExecutionContext) => Promise<unknown>;

export interface D2Dependencies {
  readonly fs?: D2FileSystem;
  readonly now?: () => number;
  readonly clock?: () => string;
  readonly runtimeIdentity?: () => D2RuntimeIdentity;
  readonly workerCount?: number;
  readonly signal?: AbortSignal;
  readonly profile?: ListwiseProtocolProfile;
  readonly executeShard?: D2ShardExecutor;
  readonly buildStage2?: (input: {
    stage1: D2Stage1Manifest;
    captureReceipts: ReadonlyMap<D2ShardId, D2Receipt>;
  }) => D2Stage2Manifest;
  /** `'indeterminate'` when the lock's own path could not be derived. */
  readonly trainerLockPresent?: () => boolean | 'indeterminate';
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly anyD2ProcessRunning?: () => boolean;
  readonly pid?: number;
  readonly ppid?: number;
  readonly ownerNonce?: () => string;
  /** Injected `process`-like exit hook registry; see `runD2Main`. */
  readonly exitHooks?: D2ExitHooks;
  /** Injected timers so watchdog and heartbeat are testable without real waits. */
  readonly setTimer?: D2SetTimer;
  readonly setInterval?: D2SetInterval;
  readonly signalHooks?: D2SignalHooks;
  /** Injected so a test can drive the loop without a real macrotask turn. */
  readonly yieldToTimers?: () => Promise<void>;
  /**
   * The two edges of the default executor, injectable so the shipped wiring —
   * including the profile it threads and the pool it disposes — is reachable
   * without spawning threads or reading live run artifacts.
   */
  readonly createPool?: (size: number) => D2PoolLike;
  readonly loadSources?: () => D1Sources;
}

/** Resolves after `ms`; returns a canceller. */
export type D2SetTimer = (ms: number, onFire: () => void) => () => void;
/** Fires repeatedly every `ms`; returns a canceller. */
export type D2SetInterval = (ms: number, onTick: () => void) => () => void;

export interface D2SignalHooks {
  on(event: 'SIGINT' | 'SIGTERM' | 'uncaughtException' | 'unhandledRejection',
    listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}

const defaultSetTimer: D2SetTimer = (ms, onFire) => {
  const handle = setTimeout(onFire, ms);
  if (typeof handle.unref === 'function') handle.unref();
  return () => clearTimeout(handle);
};

/**
 * A real macrotask turn. `setImmediate` rather than `setTimeout(0)` so the
 * yield costs one loop iteration rather than a clamped delay per shard.
 */
const defaultYieldToTimers = (): Promise<void> =>
  new Promise<void>((resolve) => { setImmediate(resolve); });

const defaultSetInterval: D2SetInterval = (ms, onTick) => {
  const handle = setInterval(onTick, ms);
  if (typeof handle.unref === 'function') handle.unref();
  return () => clearInterval(handle);
};

/**
 * Stage 2 is a pure function of the capture receipts and nothing else — that
 * is what makes the shard id set reproducible across episodes. The receipts
 * are read in the frozen `captureShardIds` order, so the 160 captured states
 * arrive in the canonical order the protocol fixes regardless of the order the
 * capture shards happened to complete in.
 */
function defaultBuildStage2(
  profile: ListwiseProtocolProfile,
): NonNullable<D2Dependencies['buildStage2']> {
  return ({ stage1, captureReceipts }) => buildD2Stage2Manifest({
    stage1,
    profile,
    captures: stage1.captureShardIds.flatMap((shardId) => {
      const receipt = captureReceipts.get(shardId);
      if (receipt === undefined) throw new D2ManifestError('capture-missing-or-invalid');
      return receipt.payload as readonly D1CapturedState[];
    }),
  });
}

/**
 * The default executor, plus the pool it needs.
 *
 * The pool is created lazily, so an episode that only replays a stored verdict
 * or blocks on a lock never spawns a thread, and it is destroyed on the way out
 * of the episode whatever the exit path. The `EpisodeChain` inside
 * `createD2ShardExecutors` is per-episode by construction because this factory
 * runs once per `runD2Episode` call.
 */
export function createDefaultExecutor(
  workerCount: number,
  overrides: {
    readonly createPool?: (size: number) => D2PoolLike;
    readonly runTrajectory?: D2TrajectoryRunner;
    readonly loadSources?: () => D1Sources;
    readonly profile?: ListwiseProtocolProfile;
  } = {},
): {
  executeShard: D2ShardExecutor;
  dispose: () => Promise<void>;
} {
  const createPool = overrides.createPool ?? ((size) => D2WorkerPool.create(size));
  let pool: D2PoolLike | null = null;
  const ensurePool = (): D2PoolLike => (pool ??= createPool(workerCount));
  const execute = createD2ShardExecutors({
    profile: overrides.profile,
    runContexts: (input) => createD2ContextRunner(ensurePool())(input),
    runTrajectory: overrides.runTrajectory ?? ((input) => createD2TrajectoryRunner(ensurePool())(input)),
    loadSources: overrides.loadSources,
  });
  return {
    executeShard: execute,
    dispose: async () => {
      const created = pool;
      pool = null;
      if (created !== null) await created.destroy();
    },
  };
}

export class D2WriteBoundaryError extends Error {
  readonly name = 'D2WriteBoundaryError';
  readonly reason = 'evidence-dir-out-of-bounds' as const;
  constructor(readonly path: string) {
    super(`D2 runtime-fail:evidence-dir-out-of-bounds:${path}`);
  }
}

/** Wrap a filesystem so no mutating call can escape `dir`. */
export function guardWriteBoundary(fs: D2FileSystem, dir: string): D2FileSystem {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  const check = (path: string): string => {
    if (path !== dir && !path.startsWith(prefix)) throw new D2WriteBoundaryError(path);
    return path;
  };
  return {
    readFile: (path) => fs.readFile(path),
    readdir: (path) => fs.readdir(path),
    exists: (path) => fs.exists(path),
    writeFileSync: (path, data) => fs.writeFileSync(check(path), data),
    fsyncFile: (path) => fs.fsyncFile(check(path)),
    rename: (from, to) => fs.rename(check(from), check(to)),
    appendLine: (path, line) => fs.appendLine(check(path), line),
    mkdirp: (path) => fs.mkdirp(check(path)),
    openExclusive: (path, data) => fs.openExclusive(check(path), data),
    unlink: (path) => fs.unlink(check(path)),
  };
}

class D2ShardTimeoutError extends Error {
  readonly name = 'D2ShardTimeoutError';
  constructor(readonly reason: 'shard-timeout' | 'no-progress-timeout') {
    super(`D2 ${reason}`);
  }
}

/**
 * Run one shard with the two wall-clock ceilings actually enforced.
 *
 * A ceiling can only *prevent* a shard from completing; it never alters a
 * receipt a shard already produced, so shard purity and resume equivalence are
 * untouched. The timeout produces a non-verdict `episode-incomplete`.
 */
async function raceShardAgainstWatchdog(input: {
  readonly shardId: D2ShardId;
  readonly run: () => Promise<unknown>;
  readonly stage2: D2Stage2Manifest | null;
  readonly setTimer: D2SetTimer;
}): Promise<unknown> {
  // Arm the ceiling before the shard starts, not inside the race. `Promise.race`
  // evaluates its arguments left to right, so building the timer in the second
  // argument means a shard that completes synchronously is already finished by
  // the time the ceiling exists — the timer would be created and cancelled
  // having never been able to fire.
  // Only the shard's own ceiling binds here, and the outcome is always
  // `shard-timeout`: a shard that blew its ceiling is named, which is strictly
  // more useful than the run-level label. The run-level no-progress ceiling
  // (`watchdogVerdict`) covers the disjoint case where nothing is in flight and
  // nothing is completing — a dispatcher hang — which the serial loop below
  // cannot currently enter, since it exits as soon as no shard is ready.
  let cancel: (() => void) | undefined;
  const ceiling = new Promise<never>((_resolve, reject) => {
    cancel = input.setTimer(
      perShardCeilingMs(input.shardId, input.stage2),
      () => reject(new D2ShardTimeoutError('shard-timeout')),
    );
  });
  try {
    return await Promise.race([input.run(), ceiling]);
  } finally {
    cancel?.();
    // The losing rejection is still pending when the shard wins; swallow it so
    // it cannot surface as an unhandled rejection and be misread as a crash.
    ceiling.catch(() => undefined);
  }
}

export interface D2ExitHooks {
  on(event: 'exit', listener: () => void): unknown;
  removeListener(event: 'exit', listener: () => void): unknown;
}

export interface D2Outcome {
  readonly kind: 'run-verdict' | 'episode-incomplete' | 'pre-veto' | 'last-resort';
  readonly exitClass: D2ExitClass;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: 0 | 1;
}

interface EpisodeIncompleteProjection {
  readonly kind: 'episode-incomplete';
  readonly protocolId: string;
  readonly episodeOrdinal: number;
  readonly completedShards: number;
  readonly remainingShards: number | null;
  readonly terminationCause: D2TerminationCause;
  readonly failureReasons: readonly string[];
}

const sameRuntimeIdentity = (identity: D2RuntimeIdentity): boolean =>
  identity.node === D2_RUNTIME_IDENTITY.node
  && identity.v8 === D2_RUNTIME_IDENTITY.v8
  && identity.platform === D2_RUNTIME_IDENTITY.platform;

const currentRuntimeIdentity = (): D2RuntimeIdentity => ({
  node: process.versions.node,
  v8: process.versions.v8,
  platform: `${process.platform}-${process.arch}`,
});

function reasonOf(error: unknown): string {
  if (error instanceof D2ManifestError) return error.reason;
  if (error instanceof D2EvidenceIntegrityError) return error.reason;
  if (error instanceof D2FreezeBoundaryError) return error.reason;
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (typeof reason === 'string') return reason;
  // A `node:fs` failure carries an errno `code`, never a `reason`. Letting it
  // fall through to `simulation-failure` would label a disk problem as a shard
  // impurity, and two identical episodes would then promote a transient EBUSY
  // — routine on the frozen win32 runtime — into a terminal `runtime-fail`
  // that consumes the one-shot authorization. Shard purity is the premise of
  // the two-strike rule (spec 5.4.5(b)); I/O is outside it.
  if (typeof (error as { code?: unknown } | null)?.code === 'string') return 'evidence-io-failure';
  // D1's own runtime errors carry neither `reason` nor `code`, only a message,
  // so before this they fell through to `unclassified-failure` — which is not
  // promotable, leaving spec 5.4.5(b)'s `optimizer-failure` unreachable by any
  // real run and a deterministic statistical failure looping as
  // `episode-incomplete` until the budget ran out. Matched by `name` rather
  // than `instanceof` deliberately: the orchestrator is otherwise free of D1
  // imports, and `D1RuntimeError` declares `name` as a fixed own property.
  if ((error as { name?: unknown } | null)?.name === 'D1RuntimeError') {
    const detail = String((error as { message?: unknown }).message ?? '');
    // Everything else this class reports is raised from inside the optimizer:
    // non-convergence, a rejected line search, a non-descent direction, a
    // malformed or non-finite Newton system.
    return detail.includes('metrics') ? 'malformed-metrics' : 'optimizer-failure';
  }
  // Anything D2 cannot name. Distinct from `simulation-failure`, which a
  // component raises on purpose: collapsing the two made every unnameable error
  // share the classification — and, while `simulation-failure` was promotable,
  // made it terminal on its second sighting.
  return 'unclassified-failure';
}

/** The failure's own message, bounded so a stack-bearing error cannot bloat the record. */
function detailOf(error: unknown): string | null {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== 'string' || message.length === 0) return null;
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}

function statusForClass(exitClass: D2ExitClass): D2CanonicalStatus {
  if (exitClass === 'terminal-runtime-fail') return 'runtime-fail';
  return 'invalid-input';
}

/**
 * Non-verdict projection. Deliberately carries no outcome value: an episode
 * that merely stopped must never be readable as an answer.
 */
function episodeIncomplete(input: {
  readonly protocolId: string;
  readonly episodeOrdinal: number;
  readonly completedShards: number;
  readonly remainingShards: number | null;
  readonly terminationCause: D2TerminationCause;
  readonly reasons: readonly string[];
}): D2Outcome {
  const projection: EpisodeIncompleteProjection = {
    kind: 'episode-incomplete',
    protocolId: input.protocolId,
    episodeOrdinal: input.episodeOrdinal,
    completedShards: input.completedShards,
    remainingShards: input.remainingShards,
    terminationCause: input.terminationCause,
    failureReasons: input.reasons,
  };
  return {
    kind: 'episode-incomplete',
    exitClass: 'episode-incomplete',
    stdout: `${canonicalJson(projection)}\n`,
    stderr: '',
    exitCode: 1,
  };
}

function vetoVerdict(input: {
  readonly protocolId: string;
  readonly exitClass: D2ExitClass;
  readonly reasons: readonly string[];
  readonly completedShards: number;
}): { readonly canonical: string; readonly outcome: D2Outcome } {
  const status = statusForClass(input.exitClass);
  const withoutDigest = {
    mode: input.protocolId,
    kind: 'run-verdict' as const,
    status,
    exitClass: input.exitClass,
    failureReasons: [...input.reasons],
    completedCounts: { shards: input.completedShards },
  };
  const canonical = `${canonicalJson({ ...withoutDigest, resultDigest: digestOf(withoutDigest) })}\n`;
  return {
    canonical,
    outcome: {
      kind: 'run-verdict',
      exitClass: input.exitClass,
      stdout: canonical,
      stderr: '',
      exitCode: exitCodeForStatus(status),
    },
  };
}

function replayStoredVerdict(stored: string): D2Outcome {
  let status: D2CanonicalStatus = 'invalid-input';
  try {
    const parsed = JSON.parse(stored) as { status?: unknown };
    if (typeof parsed.status === 'string') status = parsed.status as D2CanonicalStatus;
  } catch {
    // A stored verdict that will not parse is still the run's answer; it is
    // replayed verbatim and never rewritten.
  }
  return {
    kind: 'run-verdict',
    exitClass: 'aggregate-verdict',
    stdout: stored.endsWith('\n') ? stored : `${stored}\n`,
    stderr: '',
    exitCode: exitCodeForStatus(status),
  };
}

/**
 * One episode of the D2 diagnostic.
 *
 * Startup order is load-bearing and must not be reordered: the runtime
 * identity is checked before any digest or `runId` is derived (so a runtime
 * upgrade fails closed instead of forking a fresh run with a fresh budget),
 * and the read-only `result.json` check precedes lock adjudication (so a
 * finished run never has `episode-abandoned` appended to it).
 */
export async function runD2Episode(dependencies: D2Dependencies = {}): Promise<D2Outcome> {
  const profile = dependencies.profile ?? D2_PROFILE;
  const identity = (dependencies.runtimeIdentity ?? currentRuntimeIdentity)();

  // Step 0 — before any digest or runId derivation.
  if (!sameRuntimeIdentity(identity)) {
    const withoutDigest = {
      mode: profile.protocolId,
      kind: 'pre-veto' as const,
      status: 'invalid-input' as const,
      failureReasons: ['runtime-identity-mismatch'],
    };
    return {
      kind: 'pre-veto',
      exitClass: 'pre-veto',
      stdout: `${canonicalJson({ ...withoutDigest, resultDigest: digestOf(withoutDigest) })}\n`,
      stderr: '',
      exitCode: 1,
    };
  }

  const rawFs = dependencies.fs ?? nodeD2FileSystem();
  const now = dependencies.now ?? (() => Date.now());
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const workerCount = dependencies.workerCount ?? defaultD2WorkerCount();
  // Built here rather than at the call site so the memoized D1 chain inside it
  // is scoped to exactly one episode, and so the pool it owns is disposed on
  // every exit path through `finish`.
  const defaultExecutor = dependencies.executeShard === undefined
    ? createDefaultExecutor(workerCount, {
      profile,
      createPool: dependencies.createPool,
      loadSources: dependencies.loadSources,
    })
    : null;
  const executeShard = dependencies.executeShard ?? defaultExecutor!.executeShard;

  const stage1 = buildD2Stage1Manifest({ profile });
  const manifestDigest = stage1Digest(stage1);
  const runId = runIdFor(stage1);
  const dir = evidenceDir(runId);
  // Every mutating call is checked against the run directory, so a path bug in
  // a real adapter is a classified first-detection breach rather than a silent
  // write into the repository.
  const fs = guardWriteBoundary(rawFs, dir);

  // Step 1 — read-only, ahead of the lock.
  const stored = fs.readFile(resultPath(dir));
  if (stored !== null) return replayStoredVerdict(stored);

  // Step 3 — the repository trainer lock, ahead of any directory creation.
  // It is a pure predicate with no dependencies, and answering it first means an
  // episode that never starts leaves no evidence directory behind.
  const trainerLock = (dependencies.trainerLockPresent ?? (() => false))();
  if (trainerLock !== false) {
    // Best-effort ordinal. A corrupt record found here is *deferred*, not
    // vetoed: this episode stops for the trainer lock, and the next episode
    // without one reaches the guarded read below and writes the
    // evidence-integrity veto. Degrading it into an unclassified last resort
    // just because the trainer lock happened to be held at the same moment
    // would be worse than waiting.
    let ordinal = 1;
    try {
      ordinal = readRunRecord(fs, dir).filter((e) => e.kind === 'episode-start').length + 1;
    } catch {
      // Deferred; see above.
    }
    return episodeIncomplete({
      protocolId: profile.protocolId,
      episodeOrdinal: ordinal,
      completedShards: 0,
      remainingShards: null,
      terminationCause: 'episode-incomplete',
      reasons: [trainerLock === 'indeterminate'
        ? 'trainer-lock-indeterminate'
        : 'trainer-lock-present'],
    });
  }

  // The directory is created before the run record is read so that a corrupt
  // record can be answered with the same evidence-integrity veto it would get
  // if the corruption were noticed mid-loop. Read first and the veto had
  // nowhere to be written, so one fault produced two different exit classes
  // depending only on when it was seen.
  fs.mkdirp(dir);
  fs.mkdirp(`${dir}/receipts`);

  let entriesBefore: readonly D2RunRecordEntry[];
  try {
    entriesBefore = readRunRecord(fs, dir);
  } catch (error) {
    const reason = reasonOf(error);
    const { canonical, outcome } = vetoVerdict({
      protocolId: profile.protocolId,
      exitClass: classifyD2Exit(reason),
      reasons: [reason],
      completedShards: 0,
    });
    if (writesResultJson(classifyD2Exit(reason))) writeResultOnce(fs, dir, canonical);
    return outcome;
  }
  const episodeOrdinal = entriesBefore.filter((entry) => entry.kind === 'episode-start').length + 1;

  // Step 2 — lock.
  const owner = {
    ownerNonce: (dependencies.ownerNonce ?? (() => `${runId}-${episodeOrdinal}`))(),
    pid: dependencies.pid ?? process.pid,
    startedAt: clock(),
    episodeOrdinal,
  };
  const lockOutcome = adjudicateRunLock({
    fs,
    dir,
    entries: entriesBefore,
    owner,
    isProcessAlive: dependencies.isProcessAlive ?? (() => true),
    anyD2ProcessRunning: dependencies.anyD2ProcessRunning ?? (() => false),
  });
  if (lockOutcome === 'blocked') {
    return episodeIncomplete({
      protocolId: profile.protocolId,
      episodeOrdinal,
      completedShards: 0,
      remainingShards: null,
      terminationCause: 'episode-incomplete',
      reasons: ['run-locked'],
    });
  }

  const releaseLock = (): void => {
    const raw = fs.readFile(lockPath(dir));
    if (raw === null) return;
    try {
      const current = JSON.parse(raw) as { ownerNonce?: unknown };
      if (current.ownerNonce === owner.ownerNonce) fs.unlink(lockPath(dir));
    } catch {
      // A lock we cannot parse is not ours to remove.
    }
  };

  const startedAtMs = now();
  let completedCount = 0;
  let terminationCause: D2TerminationCause = 'episode-incomplete';
  let failedShardId: D2ShardId | null = null;
  let failureReason: string | null = null;
  let failureDetail: string | null = null;
  let recordedStart = false;
  /** Set by an abnormal-termination handler so the exit fallback can name it. */
  let abnormalCause: D2TerminationCause | null = null;
  /**
   * The subset of those an episode may be *relabelled* with. A signal is the
   * operator saying "stop", and it explains whatever the loop sees next. An
   * uncaught exception or a stray rejection does not: the handlers make both
   * non-fatal, so the episode usually carries on and ends for an unrelated
   * reason forty minutes later. Latching those would name the wrong cause and
   * discard the real shard's first strike.
   */
  const interruptCause = (): D2TerminationCause | null =>
    abnormalCause === 'signal:SIGINT' || abnormalCause === 'signal:SIGTERM'
      ? abnormalCause
      : null;

  let endWritten = false;

  /**
   * Write the completion metadata exactly once.  Callable from the normal
   * return path and from the process-exit fallback, because losing this record
   * is precisely how the previous diagnostic ended up unable to say whether it
   * had crashed, hung, or been killed.
   */
  const writeEpisodeEnd = (exitCode: number, cause: D2TerminationCause): void => {
    if (!recordedStart || endWritten) return;
    endWritten = true;
    appendRunRecord(fs, dir, {
      kind: 'episode-end',
      episodeOrdinal,
      endedAt: clock(),
      durationMs: now() - startedAtMs,
      exitCode,
      terminationCause: cause,
      completedShards: completedCount,
      failedShardId,
      failureReason,
      failureDetail,
    });
  };

  /**
   * Synchronous last resort.  `process.on('exit')` may only do sync I/O, which
   * is why the whole evidence layer is sync.  SIGKILL and power loss still run
   * nothing — that limit is real and is not papered over here; the heartbeat
   * plus `episode-abandoned` bound the unknown window instead.
   */
  const onProcessExit = (): void => {
    try {
      writeEpisodeEnd(1, abnormalCause ?? 'uncaught-exception');
      releaseLock();
    } catch {
      // A failure here must not mask the original exit reason.
    }
  };
  const exitHooks = dependencies.exitHooks;
  exitHooks?.on('exit', onProcessExit);

  /**
   * Abnormal-termination causes must reach the durable record with their real
   * identity. Recording every abnormal exit as `uncaught-exception` would make
   * `run-record.jsonl` unable to say whether the operator interrupted the run —
   * which is the question the record exists to answer.
   */
  const signalHooks = dependencies.signalHooks;
  const registered: { event: string; listener: (...args: unknown[]) => void }[] = [];
  const bindTermination = (
    event: 'SIGINT' | 'SIGTERM' | 'uncaughtException' | 'unhandledRejection',
    cause: D2TerminationCause,
  ): void => {
    if (signalHooks === undefined) return;
    const listener = (): void => {
      // Record the cause; write nothing. Both halves matter, and for the same
      // reason: Node does not exit on an `uncaughtException` once a listener is
      // installed, and a signal is only observed at the next shard boundary, so
      // this handler runs while the episode is still going.
      //
      // Releasing the lock here would let a second process acquire it cleanly
      // and interleave receipts. Writing `episode-end` here is worse in a way
      // that is easy to miss: it pairs the episode while the lock is still held,
      // and spec 7.1.1's dead-lock checklist requires an *unpaired*
      // `episode-start`. A hard kill after a signal would then leave a lock no
      // adjudication could ever take over — the one state resume exists for.
      //
      // The single `episode-end` is written by `finish()` on the way out, or by
      // the `process.on('exit')` fallback if the process is really leaving.
      terminationCause = cause;
      abnormalCause = cause;
    };
    signalHooks.on(event, listener);
    registered.push({ event, listener });
  };
  bindTermination('SIGINT', 'signal:SIGINT');
  bindTermination('SIGTERM', 'signal:SIGTERM');
  bindTermination('uncaughtException', 'uncaught-exception');
  bindTermination('unhandledRejection', 'unhandled-rejection');

  const finish = (outcome: D2Outcome): D2Outcome => {
    writeEpisodeEnd(outcome.exitCode, terminationCause);
    releaseLock();
    // Fire-and-forget: a worker that refuses to die must not stall the exit
    // path, and the episode's evidence is already durable by this point.
    if (defaultExecutor !== null) void defaultExecutor.dispose().catch(() => undefined);
    exitHooks?.removeListener('exit', onProcessExit);
    for (const { event, listener } of registered) signalHooks?.removeListener(event, listener);
    return outcome;
  };

  try {
    // Step 4 — manifests.
    const storedStage1 = fs.readFile(stage1Path(dir));
    const freshStage1 = canonicalJson(stage1);
    if (storedStage1 === null) {
      const existingReceipts = fs.readdir(`${dir}/receipts`).filter((name) => name.endsWith('.json'));
      if (existingReceipts.length > 0) throw new D2EvidenceIntegrityError('manifest-drift');
      writeAtomic(fs, stage1Path(dir), freshStage1);
    } else if (storedStage1 !== freshStage1) {
      throw new D2EvidenceIntegrityError('manifest-drift');
    }

    for (const abandoned of unpairedEpisodeOrdinals(entriesBefore)) {
      const lastHeartbeat = [...entriesBefore].reverse()
        .find((entry) => entry.kind === 'heartbeat' && entry.episodeOrdinal === abandoned);
      appendRunRecord(fs, dir, {
        kind: 'episode-abandoned',
        episodeOrdinal: abandoned,
        lastHeartbeatElapsedMs: lastHeartbeat?.kind === 'heartbeat' ? lastHeartbeat.elapsedMs : null,
        completedShards: lastHeartbeat?.kind === 'heartbeat' ? lastHeartbeat.completedShards : 0,
      });
    }

    appendRunRecord(fs, dir, {
      kind: 'episode-start',
      episodeOrdinal,
      startedAt: owner.startedAt,
      pid: owner.pid,
      ppid: dependencies.ppid ?? 0,
      runtimeIdentity: stage1.runtimeIdentity,
      workerCount,
      manifestDigest,
      completedShards: entryCompletedShards(fs, dir, stage1, manifestDigest),
    });
    recordedStart = true;

    const budgets = episodeBudgets(entriesBefore);
    if (budgets.productive >= MAX_PRODUCTIVE_EPISODES) {
      terminationCause = 'resume-budget-exhausted';
      return finish(episodeIncomplete({
        protocolId: profile.protocolId,
        episodeOrdinal,
        completedShards: 0,
        remainingShards: null,
        terminationCause: 'resume-budget-exhausted',
        reasons: ['resume-budget-exhausted'],
      }));
    }
    if (budgets.barren >= MAX_BARREN_EPISODES) {
      terminationCause = 'barren-episode-budget-exhausted';
      return finish(episodeIncomplete({
        protocolId: profile.protocolId,
        episodeOrdinal,
        completedShards: 0,
        remainingShards: null,
        terminationCause: 'barren-episode-budget-exhausted',
        reasons: ['barren-episode-budget-exhausted'],
      }));
    }

    // A heartbeat every 30s regardless of shard boundaries. Emitting only
    // between shards would leave a whole shard — up to hours — with no record,
    // so the bounded unknown window the design promises would not exist.
    let progressCount = 0;
    const beat = (completedShards: number): void => {
      try {
        appendRunRecord(fs, dir, {
          kind: 'heartbeat',
          episodeOrdinal,
          elapsedMs: now() - startedAtMs,
          completedShards,
        });
      } catch {
        // A missed heartbeat costs observability; it must never cost the
        // episode. Uncaught, this would surface from the interval callback as
        // an `uncaughtException`, and the handler below would mark the episode
        // ended while it was still running.
      }
    };
    const stopHeartbeat = (dependencies.setInterval ?? defaultSetInterval)(
      HEARTBEAT_INTERVAL_MS,
      () => beat(progressCount),
    );

    let state: ShardLoopState;
    try {
      state = await runShards({
        fs, dir, stage1, manifestDigest, profile, workerCount, now, clock,
        episodeOrdinal, startedAtMs,
        executeShard,
        buildStage2: dependencies.buildStage2 ?? defaultBuildStage2(profile),
        signal: dependencies.signal,
        previousFailure: lastFailure(entriesBefore),
        setTimer: dependencies.setTimer ?? defaultSetTimer,
        onProgress: (count) => {
          progressCount = count;
          completedCount = count;
        },
        onDispatch: beat,
        yieldToTimers: dependencies.yieldToTimers ?? defaultYieldToTimers,
        interruptCause,
      });
    } finally {
      stopHeartbeat();
    }
    completedCount = state.completed.size;

    if (state.outcome.kind === 'run-verdict') {
      // Only the aggregate's own verdict is a completed episode. A promotion to
      // terminal `runtime-fail` is also a run verdict, and recording it as
      // `completed` made `runProvenance.terminationCauses` say an episode ended
      // normally when it had just killed the run.
      terminationCause = state.outcome.exitClass === 'aggregate-verdict'
        ? 'completed'
        : state.terminationCause;
      failedShardId = state.failedShardId;
      failureReason = state.failureReason;
      failureDetail = state.failureDetail;
      if (writesResultJson(state.outcome.exitClass)) {
        writeResultOnce(fs, dir, state.outcome.stdout);
      }
      return finish(state.outcome);
    }
    // An abnormal-termination handler's cause wins over the loop's. The loop
    // only ever sees the *consequence* of an interrupt — the real pool answers
    // an abort with `worker-pool-failure` — so without this a Ctrl-C was
    // recorded as an anonymous `episode-incomplete` blaming the shard that
    // happened to be in flight. That is the question the run record exists to
    // answer (§1.2: afterwards you cannot tell a crash from a hang from a kill),
    // and it also kept an operator interrupt out of `failedShardId` /
    // `failureReason`, the sole durable carrier of the two-strike rule.
    const interrupted = interruptCause();
    terminationCause = interrupted ?? state.terminationCause;
    failedShardId = interrupted === null ? state.failedShardId : null;
    failureReason = interrupted === null ? state.failureReason : null;
    failureDetail = interrupted === null ? state.failureDetail : null;
    return finish(state.outcome);
  } catch (error) {
    const reason = reasonOf(error);
    failureDetail = detailOf(error);
    const exitClass = classifyD2Exit(reason);
    if (writesResultJson(exitClass)) {
      terminationCause = exitClass === 'terminal-runtime-fail' ? 'runtime-fail' : 'invalid-input';
      const { canonical, outcome } = vetoVerdict({
        protocolId: profile.protocolId, exitClass, reasons: [reason], completedShards: completedCount,
      });
      writeResultOnce(fs, dir, canonical);
      return finish(outcome);
    }
    // The same rule the loop path follows: only a signal may relabel an
    // episode. A non-fatal `uncaughtException` earlier on would otherwise name
    // an episode that ended much later for an unrelated reason. Assigned, not
    // just projected, because `finish` writes the durable record from this
    // variable and the two must not disagree.
    terminationCause = interruptCause() ?? 'episode-incomplete';
    return finish(episodeIncomplete({
      protocolId: profile.protocolId,
      episodeOrdinal,
      completedShards: completedCount,
      remainingShards: null,
      terminationCause,
      reasons: [reason],
    }));
  }
}

/**
 * The productive/barren split exists so a purely infrastructural failure
 * frequency can never decide the fate of the research line: only an episode
 * that completed at least one new shard consumes the resume budget.
 */
/** Receipts already on disk when this episode begins. */
function entryCompletedShards(
  fs: D2FileSystem,
  dir: string,
  stage1: D2Stage1Manifest,
  manifestDigest: string,
): number {
  try {
    return readValidReceipts({
      fs, dir, stage1, manifestDigest, knownShardIds: null,
    }).completed.size;
  } catch {
    // A corrupt receipt is reported by the scan inside `runShards`; the
    // start record must not be the thing that fails the episode.
    return 0;
  }
}

export function episodeBudgets(entries: readonly D2RunRecordEntry[]): {
  readonly productive: number; readonly barren: number;
} {
  let productive = 0;
  let barren = 0;
  let previousCompleted = 0;
  for (const entry of entries) {
    if (entry.kind !== 'episode-end') continue;
    if (entry.completedShards > previousCompleted) productive += 1;
    else barren += 1;
    previousCompleted = Math.max(previousCompleted, entry.completedShards);
  }
  return { productive, barren };
}

interface ShardLoopState {
  readonly completed: ReadonlySet<D2ShardId>;
  readonly outcome: D2Outcome;
  readonly terminationCause: D2TerminationCause;
  readonly failedShardId: D2ShardId | null;
  readonly failureReason: string | null;
  readonly failureDetail: string | null;
}

async function runShards(input: {
  fs: D2FileSystem;
  dir: string;
  stage1: D2Stage1Manifest;
  manifestDigest: string;
  profile: ListwiseProtocolProfile;
  workerCount: number;
  now: () => number;
  clock: () => string;
  episodeOrdinal: number;
  startedAtMs: number;
  executeShard: D2ShardExecutor;
  buildStage2: NonNullable<D2Dependencies['buildStage2']>;
  signal?: AbortSignal;
  previousFailure: { readonly shardId: D2ShardId; readonly reason: string } | null;
  setTimer: D2SetTimer;
  onProgress: (completedShards: number) => void;
  onDispatch: (completedShards: number) => void;
  yieldToTimers: () => Promise<void>;
  interruptCause: () => D2TerminationCause | null;
}): Promise<ShardLoopState> {
  const executeShard = input.executeShard;

  let stage2: D2Stage2Manifest | null = null;
  let shardIds: readonly D2ShardId[] = input.stage1.captureShardIds;

  // Before stage-2 freezes the shard id set is incomplete, so membership is
  // not yet checkable; it is enforced by every scan after the freeze.
  const rescan = () => readValidReceipts({
    fs: input.fs,
    dir: input.dir,
    stage1: input.stage1,
    manifestDigest: input.manifestDigest,
    knownShardIds: stage2 === null ? null : shardIds,
  });

  // Full validation happens at episode start and at the stage-2 freeze. After
  // that, receipts are added incrementally as they are written: re-validating
  // every receipt after every shard is O(n^2) SHA-256 work and buys nothing,
  // because a receipt this process just wrote is already known-good.
  let scan = rescan();
  const completed = new Set(scan.completed);
  const receipts = new Map(scan.receipts);
  const adopt = (next: typeof scan): void => {
    completed.clear();
    for (const shardId of next.completed) completed.add(shardId);
    receipts.clear();
    for (const [shardId, receipt] of next.receipts) receipts.set(shardId, receipt);
  };
  assertNoReceiptRegression(readRunRecord(input.fs, input.dir), completed.size);
  let lastCompletionMs = input.now();

  const maybeFreezeStage2 = (): void => {
    if (stage2 !== null) return;
    if (!input.stage1.captureShardIds.every((shardId) => completed.has(shardId))) return;
    const captureReceipts = new Map(
      input.stage1.captureShardIds.map((shardId) => [shardId, receipts.get(shardId)!]),
    );
    const built = input.buildStage2({ stage1: input.stage1, captureReceipts });
    const canonical = canonicalJson(built);
    const storedStage2 = input.fs.readFile(stage2Path(input.dir));
    if (storedStage2 === null) writeAtomic(input.fs, stage2Path(input.dir), canonical);
    else if (storedStage2 !== canonical) throw new D2EvidenceIntegrityError('manifest-drift');
    stage2 = built;
    shardIds = built.shardIds;
    // Now that the shard id set is complete, re-validate everything with
    // membership enforced.
    scan = rescan();
    adopt(scan);
  };

  maybeFreezeStage2();


  for (;;) {
    // Yield to the macrotask queue once per iteration. Several phases are
    // synchronous CPU inside the executor, and `await` on an already-resolved
    // promise is only a microtask, so without this the heartbeat interval, the
    // watchdog timer and the signal handlers would never get a turn for the
    // whole phase rather than for a single shard.
    await input.yieldToTimers();

    const ready = scheduleD2({ shardIds }, completed);
    if (ready.length === 0) break;

    // Exactly one shard is in flight at a time. Parallelism lives *inside* a
    // shard — a label shard's ~48 contexts go to the worker pool through the
    // executor's `runContexts`, which is where `workerCount` applies. Running
    // shards concurrently would buy little (the expensive phases already
    // saturate the pool internally) and would cost the strongest form of the
    // interruption guarantee: with one shard in flight, an interruption loses
    // at most that one shard, not `workerCount` of them.
    const batch = ready.slice(0, 1);

    for (const shardId of batch) {
      if (input.signal?.aborted === true) {
        // The cause comes from whichever handler fired; hard-coding SIGINT
        // here made `signal:SIGTERM` unreachable.
        return incompleteFrom('signal:SIGINT', null, 'abort');
      }
      const phase = shardPhase(shardId);
      // The run-level no-progress ceiling, consulted with nothing in flight.
      // It is the dispatcher-hang case: the per-shard ceiling covers a shard
      // that is running too long, and this covers the loop itself failing to
      // make progress. Without it `no-progress-timeout` would be a termination
      // cause no run could ever produce.
      if (watchdogVerdict({ inFlight: new Map(), lastCompletionMs },
        input.now(), stage2).kind === 'no-progress-timeout') {
        // No shard id: this ceiling is about the loop, not about any one shard.
        // A consequence worth stating plainly — `lastFailure` requires both a
        // shard id and a reason, so this cause can never satisfy the two-strike
        // rule and will always end the episode rather than the run. That is the
        // right bias for a ceiling whose trigger is "nothing is happening".
        return incompleteFrom('no-progress-timeout', null, 'no-progress-timeout');
      }
      // A beat at dispatch, not only on the interval. A shard whose work is
      // synchronous cannot be interrupted by the interval timer, so this is the
      // record that keeps `lastCompletedCount` — the spec 7.5 tamper baseline —
      // no more than one shard stale even if the process is killed mid-shard.
      input.onDispatch(completed.size);
      try {
        // The watchdog has to race the shard, not merely be consulted before
        // dispatch: a hung shard never resolves, so a pre-dispatch check would
        // be evaluated microseconds after `dispatchedAt` and never again. That
        // was the whole failure mode this ceiling exists to catch.
        const payload = await raceShardAgainstWatchdog({
          shardId,
          stage2,
          setTimer: input.setTimer,
          run: () => executeShard({
            shardId,
            phase,
            stage1: input.stage1,
            stage2,
            profile: input.profile,
            // Snapshot: a capability must not observe receipts written by a
            // sibling shard, or its payload set would depend on completion
            // order.
            capability: grantD2PayloadCapability({
              phase,
              shardIds,
              receipts: new Map(receipts),
              completed: new Set(completed),
            }),
            signal: input.signal,
          }),
        });
        const receipt = buildD2Receipt({
          protocolId: input.stage1.protocolId,
          shardId,
          phase,
          manifestDigest: input.manifestDigest,
          stage2Digest: stage2 === null ? null : digestOf(stage2),
          payload,
        });
        writeReceiptAtomic(input.fs, input.dir, receipt);
        receipts.set(shardId, receipt);
        completed.add(shardId);
        lastCompletionMs = input.now();
      } catch (error) {
        const reason = reasonOf(error);
        const exitClass = classifyD2Exit(reason);
        if (exitClass !== 'episode-incomplete') throw error;
        const promote = shouldPromoteToRuntimeFail(input.previousFailure, { shardId, reason });
        if (promote) {
          const { canonical, outcome } = vetoVerdict({
            protocolId: input.profile.protocolId,
            exitClass: 'terminal-runtime-fail',
            reasons: [reason],
            completedShards: completed.size,
          });
          writeResultOnce(input.fs, input.dir, canonical);
          return {
            completed,
            outcome,
            terminationCause: 'runtime-fail',
            failedShardId: shardId,
            failureReason: reason,
            failureDetail: detailOf(error),
          };
        }
        // A timeout is its own termination cause; collapsing it into the
        // generic `episode-incomplete` would erase the one distinction the
        // watchdog exists to record.
        const cause: D2TerminationCause =
          reason === 'shard-timeout' || reason === 'no-progress-timeout'
            ? reason
            : 'episode-incomplete';
        return incompleteFrom(cause, shardId, reason, detailOf(error));
      }

      input.onProgress(completed.size);
    }

    maybeFreezeStage2();
  }

  const aggregateReceipt = receipts.get('aggregate');
  if (aggregateReceipt === undefined) {
    return incompleteFrom('episode-incomplete', null, 'aggregate-missing');
  }
  const status = (aggregateReceipt.payload as { status?: D2CanonicalStatus }).status
    ?? 'runtime-fail';
  const document = buildVerdictDocument({
    protocolId: input.stage1.protocolId,
    status,
    result: aggregateReceipt.payload,
    shardIds,
    receipts,
    stage1Digest: input.manifestDigest,
    stage2Digest: stage2 === null ? null : digestOf(stage2),
    runRecord: readRunRecord(input.fs, input.dir),
    // An aggregate verdict is reached only by an episode that completed.
    currentEpisode: {
      terminationCause: 'completed',
      durationMs: input.now() - input.startedAtMs,
    },
    workerCount: input.workerCount,
  });
  return {
    completed,
    outcome: {
      kind: 'run-verdict',
      exitClass: 'aggregate-verdict',
      stdout: `${canonicalJson(document)}
`,
      stderr: '',
      exitCode: exitCodeForStatus(status),
    },
    terminationCause: 'completed',
    failedShardId: null,
    failureReason: null,
    failureDetail: null,
  };

  function incompleteFrom(
    cause: D2TerminationCause,
    shardId: D2ShardId | null,
    reason?: string,
    detail?: string | null,
  ): ShardLoopState {
    // An interrupt explains whatever the loop saw. The real pool answers an
    // abort with `worker-pool-failure`, so without this the operator who
    // pressed Ctrl-C read `worker-pool-failure` on the terminal while the
    // durable record correctly said `signal:SIGINT` — and might have acted on
    // the terminal, during the one authorized run.
    const interrupted = input.interruptCause();
    if (interrupted !== null) {
      cause = interrupted;
      shardId = null;
      reason = interrupted;
    }
    return {
      completed,
      outcome: episodeIncomplete({
        protocolId: input.profile.protocolId,
        episodeOrdinal: input.episodeOrdinal,
        completedShards: completed.size,
        // Null until stage 2 freezes: before that `shardIds` holds only the 80
        // capture ids, and reporting "≤80 remaining" for a 261-shard run would
        // be wrong for exactly the phase most likely to be interrupted.
        remainingShards: stage2 === null ? null : shardIds.length - completed.size,
        terminationCause: cause,
        reasons: [reason ?? cause],
      }),
      terminationCause: cause,
      failedShardId: shardId,
      failureReason: reason ?? (shardId === null ? null : cause),
      failureDetail: detail ?? null,
    };
  }
}

/**
 * Assemble the verdict document.
 *
 * The split is a hard boundary, not presentation. Episode count, termination
 * causes, durations and worker count necessarily vary with how the run was
 * partitioned into episodes; putting them inside the digested projection would
 * make the resume-equivalence invariant, its acceptance test, and the
 * reproducibility of `resultDigest` mutually unsatisfiable. So they live in
 * `runProvenance`, which is excluded from `resultDigest` and from every
 * byte-identity comparison.
 */
export function buildVerdictDocument(input: {
  readonly protocolId: string;
  readonly status: D2CanonicalStatus;
  readonly result: unknown;
  readonly shardIds: readonly D2ShardId[];
  readonly receipts: ReadonlyMap<D2ShardId, D2Receipt>;
  readonly stage1Digest: string;
  readonly stage2Digest: string | null;
  readonly runRecord: readonly D2RunRecordEntry[];
  /**
   * The episode being terminated by this very verdict. It is not in
   * `runRecord`: `finish` writes its `episode-end` only after this document
   * exists, so reading the record alone yields `episodes: n` alongside `n - 1`
   * causes and durations, and the block describing a run's history silently
   * omits the episode that ended it -- the one a reader is most likely to want.
   */
  readonly currentEpisode: {
    readonly terminationCause: D2TerminationCause;
    readonly durationMs: number;
  };
  readonly workerCount: number;
}): Record<string, unknown> {
  const phaseCounts: Record<string, number> = {};
  for (const shardId of input.shardIds) {
    const phase = shardPhase(shardId);
    phaseCounts[phase] = (phaseCounts[phase] ?? 0) + 1;
  }
  // Partition-invariant: derived only from the frozen inputs and the complete
  // shard set.
  const canonical = {
    mode: input.protocolId,
    kind: 'run-verdict' as const,
    status: input.status,
    result: input.result,
    shardEvidence: {
      totalShards: input.shardIds.length,
      phaseCounts,
      stage1Digest: input.stage1Digest,
      stage2Digest: input.stage2Digest,
      receiptDigestSummary: digestOf(
        input.shardIds.map((shardId) => input.receipts.get(shardId)?.receiptDigest ?? null),
      ),
    },
  };
  const episodeEnds = input.runRecord.filter((entry) => entry.kind === 'episode-end');
  return {
    ...canonical,
    resultDigest: digestOf(canonical),
    runProvenance: {
      // `episode-start` for the current episode *is* on disk, so the count is
      // already right; only the ends are short by one until it is appended.
      episodes: input.runRecord.filter((entry) => entry.kind === 'episode-start').length,
      terminationCauses: [
        ...episodeEnds.map((entry) => entry.terminationCause),
        input.currentEpisode.terminationCause,
      ],
      durationsMs: [...episodeEnds.map((entry) => entry.durationMs), input.currentEpisode.durationMs],
      workerCount: input.workerCount,
    },
  };
}

export interface D2MainProcessLike {
  readonly stdout: { write(data: string): unknown };
  readonly stderr: { write(data: string): unknown };
  exitCode?: number;
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}

/**
 * `--workers N`. Design 13 calls the worker count the operator's knob between
 * throughput and interruption loss, so it has to be reachable from the command
 * line; without it the only value a real run could use was the default.
 */
export function parseD2WorkerCount(argv: readonly string[]): number | undefined {
  // Both spellings. Accepting only the spaced form meant `--workers=8` was
  // silently ignored and the run used `cores - 1`, while the operator believed
  // they had capped interruption loss.
  const matches = argv.filter((token) => token === '--workers' || token.startsWith('--workers='));
  if (matches.length > 1) {
    // Taking the first silently is the same class of trap as ignoring
    // `--workers=N`: an operator correcting a value by appending a second flag
    // would get the old one while believing interruption loss was capped.
    throw new Error(`D2 invalid --workers value: repeated ${matches.length} times`);
  }
  const index = argv.findIndex((token) => token === '--workers' || token.startsWith('--workers='));
  if (index === -1) return undefined;
  const token = argv[index]!;
  const raw = token === '--workers' ? argv[index + 1] : token.slice('--workers='.length);
  const parsed = Number(raw);
  if (raw === undefined || raw === '' || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 31) {
    throw new Error(`D2 invalid --workers value: ${String(raw)}`);
  }
  return parsed;
}

export async function runD2Main(
  dependencies: D2Dependencies & {
    readonly process?: D2MainProcessLike;
    readonly argv?: readonly string[];
  } = {},
): Promise<void> {
  const processLike = dependencies.process ?? (process as unknown as D2MainProcessLike);
  const controller = new AbortController();
  let interrupted = false;
  const onSignal = () => {
    if (interrupted) return;
    interrupted = true;
    controller.abort();
  };
  processLike.once('SIGINT', onSignal);
  processLike.once('SIGTERM', onSignal);
  try {
    // Parsed inside the guarded path: a bad `--workers` value has to surface as
    // the last-resort projection below, not as an unhandled rejection printing
    // a stack trace with absolute paths.
    const workerCount = dependencies.workerCount
      ?? parseD2WorkerCount(dependencies.argv ?? process.argv.slice(2));
    const outcome = await runD2Episode({
      // Real implementations, not the permissive defaults `runD2Episode` falls
      // back to for tests. Without them the shipped binary would start beside a
      // live trainer (§7.1 step 3 never firing) and could never take over a
      // lock left by a SIGKILL, because `isProcessAlive` defaulting to `true`
      // makes §7.1.1's first item unsatisfiable — turning the most common
      // resume into a permanent `run-locked`.
      trainerLockPresent: () => trainerLockPresent(),
      isProcessAlive,
      anyD2ProcessRunning: () => anyD2ProcessRunning(),
      ppid: process.ppid,
      ...dependencies,
      workerCount,
      signal: controller.signal,
      exitHooks: dependencies.exitHooks ?? (process as unknown as D2ExitHooks),
      signalHooks: dependencies.signalHooks ?? (process as unknown as D2SignalHooks),
    });
    if (outcome.stdout) processLike.stdout.write(outcome.stdout);
    if (outcome.stderr) processLike.stderr.write(outcome.stderr);
    processLike.exitCode = outcome.exitCode;
  } catch (error) {
    // Last resort: no structured projection can be formed safely, so stdout
    // stays empty and stderr carries a redacted reason rather than a stack
    // that could leak paths.
    processLike.stderr.write(`d2: ${reasonOf(error)}
`);
    processLike.exitCode = 1;
  } finally {
    processLike.removeListener('SIGINT', onSignal);
    processLike.removeListener('SIGTERM', onSignal);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runD2Main();
}
