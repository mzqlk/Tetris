import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { isValidD1ProjectionForTask } from './d1ActionConditionedHeldOutListwise';
import type { D1SourceVector } from './d1ActionConditionedHeldOutListwiseCore';
import type {
  D1ContextProjection,
  D1ContextTask,
} from './d1ActionConditionedHeldOutListwiseLabels';
import { trainerLockPathFor } from './runLock';
import type { D2FileSystem } from './d2Evidence';
import type { D2ShardId } from './d2ShardManifest';
import type { D2ContextRunner, D2TrajectoryRunner } from './d2ShardExecutors';
import type {
  D2CaptureRequest,
  D2WorkerMessage,
  D2WorkerTask,
} from './d2ShardedHeldOutListwiseWorker';
import type { D1CapturedState } from './d1ActionConditionedHeldOutListwiseCore';

/**
 * The real-world edges of the D2 diagnostic: the filesystem, the worker pool
 * and the behavior simulator.
 *
 * They live in their own module because everything else in the D2 line is a
 * pure function of injected dependencies and is therefore exercisable in full
 * by the code gate. These three are not — they touch the disk, spawn threads,
 * and run hours of search — so isolating them keeps that boundary legible
 * instead of scattering `node:` imports through the orchestrator.
 */

export type D2RuntimeFailureReason =
  | 'worker-pool-failure'
  | 'simulation-failure'
  | 'unclassified-failure';

export class D2RuntimeError extends Error {
  readonly name = 'D2RuntimeError';
  constructor(readonly reason: D2RuntimeFailureReason, detail?: string) {
    super(detail === undefined ? `D2 ${reason}` : `D2 ${reason}: ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

/**
 * `D2FileSystem` over `node:fs`, synchronous throughout.
 *
 * Synchronous is a requirement rather than a shortcut: the evidence writes
 * have to be usable from a `process.on('exit')` handler, where nothing
 * asynchronous can complete. `fsyncFile` and `appendLine` really do fsync,
 * because a run's resumability rests on a receipt surviving a power loss. The
 * one deliberate omission is the parent-directory fsync, which the design
 * excludes.
 */
export function nodeD2FileSystem(): D2FileSystem {
  return {
    readFile(path) {
      try {
        return readFileSync(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    writeFileSync(path, data) {
      writeFileSync(path, data, 'utf8');
    },
    fsyncFile(path) {
      const handle = openSync(path, 'r+');
      try {
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
    },
    rename(from, to) {
      renameSync(from, to);
    },
    appendLine(path, line) {
      // One handle for the append and its fsync, so a durable append is a
      // single open rather than an append followed by a second open to sync.
      const handle = openSync(path, 'a');
      try {
        writeSync(handle, `${line}\n`, null, 'utf8');
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
    },
    readdir(path) {
      try {
        return readdirSync(path);
      } catch (error) {
        // A run directory with no receipts yet is the normal first-episode
        // state, not an error.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },
    mkdirp(path) {
      mkdirSync(path, { recursive: true });
    },
    exists: existsSync,
    openExclusive(path, data) {
      let handle: number;
      try {
        handle = openSync(path, 'wx');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      }
      try {
        writeSync(handle, data, null, 'utf8');
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
      return true;
    },
    unlink(path) {
      unlinkSync(path);
    },
  };
}

// ---------------------------------------------------------------------------
// Process and lock predicates
// ---------------------------------------------------------------------------

/**
 * Is this repository's trainer lock held?
 *
 * Read-only: the diagnostic never creates or removes it. Design §7.1 step 3
 * stops D2 when a trainer is running, because a 261-shard job would otherwise
 * compete with it for every core. Unable to tell counts as present — the cost
 * of a false stop is a message to the operator, the cost of a false start is
 * two jobs saturating the machine.
 */
export function trainerLockPresent(
  repositoryRoot: string = process.cwd(),
): boolean | 'indeterminate' {
  try {
    return existsSync(trainerLockPathFor(repositoryRoot));
  } catch {
    // Deriving the path shells out to git. When that fails — git off PATH, a
    // renamed `.git`, an unresolvable realpath — the honest answer is "I cannot
    // tell", not "a trainer is running". Both stop the episode, but only one
    // sends the operator looking for a lock file that does not exist, on every
    // attempt, during the one authorized run.
    return 'indeterminate';
  }
}

/**
 * Signal 0 asks the kernel about a pid without delivering anything. `EPERM`
 * means the process exists but belongs to someone else — alive, for this
 * purpose; only `ESRCH` (no such process) is dead.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The orchestrator module a running D2 process is executing. */
const D2_ENTRY_MARKER = 'd2ShardedHeldOutListwise.ts';

/** One row of the process table: enough to identify kin and to match a marker. */
export interface D2ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly commandLine: string;
}

/**
 * The Windows process table, or `null` when it cannot be read.
 *
 * `ParentProcessId` is fetched alongside the command line because the answer
 * depends on ancestry, and every process is listed — not just `node.exe` —
 * because an ancestor chain can pass through `npm.cmd` or `cmd.exe`, and a gap
 * in the chain would strand the walk.
 */
function readWin32ProcessTable(): readonly D2ProcessRow[] | null {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object '
      + '{ "$($_.ProcessId)|$($_.ParentProcessId)|'
      + "$($_.CommandLine -replace '[\\r\\n]+', ' ')\" }",
    ], { encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    return parseWin32ProcessTable(output);
  } catch {
    return null;
  }
}

/**
 * Parse the projection above into rows.
 *
 * A line that does not begin `pid|ppid|` is a continuation of the previous
 * one's command line, not a new process. The query already flattens newlines,
 * so this should never trigger — but treating a stray continuation as its own
 * row would give it a `NaN` pid, which can never be kin, and a D2 entry path
 * landing on such a row would make the diagnostic detect itself again. Belt and
 * braces on the one predicate whose failure mode is an unrecoverable run.
 */
export function parseWin32ProcessTable(output: string): readonly D2ProcessRow[] {
  const rows: D2ProcessRow[] = [];
  for (const line of output.split('\n')) {
    const text = line.trimEnd();
    const match = /^(\d+)\|(\d+)\|([\s\S]*)$/.exec(text.trimStart());
    if (match === null) {
      const previous = rows.at(-1);
      if (previous !== undefined && text.trim().length > 0) {
        rows[rows.length - 1] = { ...previous, commandLine: `${previous.commandLine} ${text.trim()}` };
      }
      continue;
    }
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), commandLine: match[3]!.trim() });
  }
  return rows;
}

/**
 * Is any *other* D2 process running?
 *
 * The second item on §7.1.1's dead-lock checklist. Matching on the command line
 * is sound here even though the handoff warns it is not for the trainer: the
 * trainer's worker threads show only tsx's loader, but a D2 orchestrator is
 * started as `tsx training/d2ShardedHeldOutListwise.ts` and carries that path
 * in `CommandLine` (verified on this runtime). The marker carries the `.ts`
 * so a vitest worker running `d2ShardedHeldOutListwise.test.ts` is not mistaken
 * for a live diagnostic.
 *
 * Any failure to enumerate returns `true`, which refuses the takeover. The
 * checklist may not be relaxed, and "I could not check" is not evidence that
 * nothing is running.
 */
export function anyD2ProcessRunning(
  rows: readonly D2ProcessRow[] | null = readWin32ProcessTable(),
  selfPid: number = process.pid,
): boolean {
  if (rows === null) return true;

  // Every ancestor counts as self. `tsx` does not run the script in the process
  // you launch — it spawns a child — so `tsx training/d2ShardedHeldOutListwise.ts`
  // leaves the supervisor holding that path on its own command line, and
  // `npx tsx …` adds a grandparent holding it too. Excluding only `selfPid`
  // therefore made a D2 run detect *itself* and refuse its own resume, which is
  // the same dead end as an `isProcessAlive` that never reports death.
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const kin = new Set<number>([selfPid]);
  for (let cursor = byPid.get(selfPid); cursor !== undefined;) {
    if (kin.has(cursor.ppid)) break;
    kin.add(cursor.ppid);
    cursor = byPid.get(cursor.ppid);
  }
  return rows.some((row) => !kin.has(row.pid) && row.commandLine.includes(D2_ENTRY_MARKER));
}

// ---------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------

export interface D2WorkerLike {
  postMessage(task: D2WorkerTask): void;
  on(event: 'message' | 'error' | 'exit', listener: (...args: unknown[]) => void): this;
  removeListener(event: string | symbol, listener: (...args: unknown[]) => void): this;
  terminate(): Promise<number | void>;
}

export type D2WorkerFactory = (index: number) => D2WorkerLike;
type D2WorkerEvent = 'message' | 'error' | 'exit';
type D2WorkerListener = readonly [D2WorkerEvent, (...args: unknown[]) => void];

const workerUrl = new URL('./d2ShardedHeldOutListwiseWorker.ts', import.meta.url);

/**
 * `execArgv` is required, not an optimisation: tsx only lets a worker inherit
 * its loader when the parent process is itself running under tsx, and a worker
 * without it cannot resolve the extensionless `../src/ai/*` imports.
 */
const defaultWorkerFactory: D2WorkerFactory = (index) => new Worker(workerUrl, {
  name: `d2-context-${index}`,
  execArgv: ['--import', 'tsx'],
}) as unknown as D2WorkerLike;

const CAPTURE_SLOTS: readonly (128 | 512)[] = Object.freeze([128, 512]);

/**
 * One core left free, and never more threads than the pool was sized for.
 * `cores` is a parameter so the policy can be asserted at the boundaries
 * instead of only at whatever this machine happens to have.
 */
export function defaultD2WorkerCount(cores: number = availableParallelism()): number {
  return Math.max(1, Math.min(31, cores - 1));
}

export interface D2PoolLike {
  run(
    shardId: D2ShardId,
    tasks: readonly D1ContextTask[],
    options?: { signal?: AbortSignal },
  ): Promise<readonly D1ContextProjection[]>;
  runCapture(
    shardId: D2ShardId,
    request: D2CaptureRequest,
    options?: { signal?: AbortSignal },
  ): Promise<readonly D1CapturedState[]>;
  destroy(): Promise<void>;
}

/**
 * Runs context tasks across worker threads.
 *
 * It mirrors the D1 pool's failure discipline — a projection that does not
 * match the task it was dispatched for is a pool failure, never a result —
 * with one addition the D2 worker protocol makes possible: every message
 * carries a shard id, so a reply belonging to another shard is rejected rather
 * than silently credited to the shard in flight.
 *
 * There is deliberately no retry. A D2 shard writes a complete receipt or
 * writes nothing; retrying inside the pool would turn a deterministic failure
 * into an intermittent one and defeat the two-strike promotion rule that
 * decides whether a failure is terminal.
 */
export class D2WorkerPool implements D2PoolLike {
  private destroyPromise: Promise<void> | null = null;
  private running = false;
  private destroyed = false;
  private readonly workers: D2WorkerLike[] = [];
  private readonly dead = new WeakSet<D2WorkerLike>();
  /** Monotonic: a replacement must not take a live thread's name. */
  private spawnCount = 0;

  private constructor(
    private readonly size: number,
    private readonly factory: D2WorkerFactory,
  ) {}

  static create(size: number, factory: D2WorkerFactory = defaultWorkerFactory): D2WorkerPool {
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new D2RuntimeError('worker-pool-failure', 'invalid pool size');
    }
    return new D2WorkerPool(size, factory);
  }

  /**
   * Grow to `wanted` threads, never past the configured size.
   *
   * Threads are spawned on demand rather than up front because the capture
   * phase — around half the run's wall clock — needs exactly one, and each
   * thread holds the whole D1 module graph plus the search caches. Spawning 31
   * of them to leave 30 idle for over an hour is the memory pressure most
   * likely to produce the worker allocation failures the exit classifier then
   * has to reason about.
   */
  private ensureWorkers(wanted: number): readonly D2WorkerLike[] {
    // Drop threads that died since the last dispatch. Between shards a worker
    // carries only the death listener below, so without this the next dispatch
    // would go to a terminated thread, be silently discarded, and hang until the
    // per-shard ceiling — recorded as `shard-timeout`, which is *promotable*.
    // An infrastructure death must not launder itself into a shard-purity
    // signal.
    for (let index = this.workers.length - 1; index >= 0; index -= 1) {
      if (this.dead.has(this.workers[index]!)) this.workers.splice(index, 1);
    }
    const target = Math.min(this.size, wanted);
    while (this.workers.length < target) {
      try {
        const worker = this.factory(this.spawnCount++);
        // Outlives any single dispatch, unlike the per-run listeners.
        worker.on('error', () => this.dead.add(worker));
        worker.on('exit', () => this.dead.add(worker));
        this.workers.push(worker);
      } catch (error) {
        // A partially grown pool must not leak the threads it did create.
        void this.destroy().catch(() => undefined);
        throw new D2RuntimeError('worker-pool-failure', `worker creation failed: ${String(error)}`);
      }
    }
    return this.workers.slice(0, target);
  }

  /**
   * One behavior trajectory, off the orchestrator's thread.
   *
   * `captureD1Trajectory` simulates 512 scheduled pieces synchronously. Run on
   * the main thread it would block the event loop for the whole shard, so the
   * heartbeat interval, the per-shard watchdog and the SIGINT handler — all
   * macrotasks — could not fire for its entire duration. Eighty of those in a
   * row is the blackout this method exists to prevent.
   */
  runCapture(
    shardId: D2ShardId,
    request: D2CaptureRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<readonly D1CapturedState[]> {
    if (this.destroyed || this.running) {
      return Promise.reject(new D2RuntimeError('worker-pool-failure', 'pool unavailable'));
    }
    this.running = true;

    let worker: D2WorkerLike;
    try {
      worker = this.ensureWorkers(1)[0]!;
    } catch (error) {
      this.running = false;
      return Promise.reject(error as Error);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, captures?: readonly D1CapturedState[]): void => {
        if (settled) return;
        settled = true;
        this.running = false;
        options.signal?.removeEventListener('abort', abort);
        for (const [event, listener] of listeners) worker.removeListener(event, listener);
        if (error) reject(error);
        else resolve(captures!);
      };
      const abort = (): void => {
        void this.destroy().catch(() => undefined);
        finish(new D2RuntimeError('worker-pool-failure', 'aborted'));
      };
      const accept = (raw: unknown): void => {
        if (settled) return;
        if (raw === null || typeof raw !== 'object') {
          finish(new D2RuntimeError('worker-pool-failure', 'malformed reply'));
          return;
        }
        const message = raw as D2WorkerMessage;
        if (message.shardId !== shardId) {
          finish(new D2RuntimeError('worker-pool-failure', 'reply names a different shard'));
          return;
        }
        if (message.kind === 'failure') {
          finish(failureFrom(message));
          return;
        }
        if (message.kind !== 'capture-result') {
          finish(new D2RuntimeError('worker-pool-failure', 'expected a capture result'));
          return;
        }
        if (!isTrajectoryForRequest(message.captures, request)) {
          finish(new D2RuntimeError('worker-pool-failure', 'malformed trajectory reply'));
          return;
        }
        finish(undefined, message.captures);
      };
      const listeners: readonly D2WorkerListener[] = [
        ['message', (...args: unknown[]) => accept(args[0])],
        ['error', () => finish(new D2RuntimeError('worker-pool-failure', 'worker error'))],
        ['exit', () => finish(new D2RuntimeError('worker-pool-failure', 'worker exited'))],
      ];
      for (const [event, listener] of listeners) worker.on(event, listener);

      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted === true) {
        abort();
        return;
      }
      try {
        worker.postMessage({ kind: 'capture', shardId, capture: request });
      } catch {
        finish(new D2RuntimeError('worker-pool-failure', 'postMessage failed'));
      }
    });
  }

  run(
    shardId: D2ShardId,
    tasks: readonly D1ContextTask[],
    options: { signal?: AbortSignal } = {},
  ): Promise<readonly D1ContextProjection[]> {
    if (tasks.length === 0) return Promise.resolve([]);
    if (this.destroyed || this.running) {
      return Promise.reject(new D2RuntimeError('worker-pool-failure', 'pool unavailable'));
    }
    if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length) {
      return Promise.reject(new D2RuntimeError('worker-pool-failure', 'duplicate task id'));
    }
    this.running = true;

    let workers: readonly D2WorkerLike[];
    try {
      workers = this.ensureWorkers(tasks.length);
    } catch (error) {
      this.running = false;
      return Promise.reject(error as Error);
    }

    return new Promise((resolve, reject) => {
      const results = new Map<number, D1ContextProjection>();
      const inFlight = new Map<D2WorkerLike, D1ContextTask>();
      const slots: { worker: D2WorkerLike; listeners: readonly D2WorkerListener[] }[] = [];
      let next = 0;
      let settled = false;

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        this.running = false;
        options.signal?.removeEventListener('abort', abort);
        for (const slot of slots) {
          for (const [event, listener] of slot.listeners) slot.worker.removeListener(event, listener);
        }
        if (error) reject(error);
        else resolve(tasks.map((task) => results.get(task.taskId)!));
      };
      const abort = (): void => {
        void this.destroy().catch(() => undefined);
        finish(new D2RuntimeError('worker-pool-failure', 'aborted'));
      };
      const dispatch = (worker: D2WorkerLike): void => {
        if (settled || next >= tasks.length) return;
        const task = tasks[next++]!;
        inFlight.set(worker, task);
        try {
          worker.postMessage({ kind: 'context', shardId, task });
        } catch {
          finish(new D2RuntimeError('worker-pool-failure', 'postMessage failed'));
        }
      };
      const accept = (worker: D2WorkerLike, raw: unknown): void => {
        if (settled) return;
        const assigned = inFlight.get(worker);
        if (assigned === undefined || raw === null || typeof raw !== 'object') {
          finish(new D2RuntimeError('worker-pool-failure', 'unassigned or malformed reply'));
          return;
        }
        const message = raw as D2WorkerMessage;
        if (message.shardId !== shardId) {
          finish(new D2RuntimeError('worker-pool-failure', 'reply names a different shard'));
          return;
        }
        if (message.kind === 'failure') {
          finish(failureFrom(message));
          return;
        }
        if (message.kind !== 'result'
          || !isValidD1ProjectionForTask(message.result, assigned)
          || results.has(assigned.taskId)) {
          finish(new D2RuntimeError('worker-pool-failure', 'projection does not match its task'));
          return;
        }
        inFlight.delete(worker);
        results.set(assigned.taskId, message.result);
        if (results.size === tasks.length) {
          finish();
          return;
        }
        dispatch(worker);
      };

      for (const worker of workers) {
        const listeners: readonly D2WorkerListener[] = [
          ['message', (...args: unknown[]) => accept(worker, args[0])],
          ['error', () => finish(new D2RuntimeError('worker-pool-failure', 'worker error'))],
          // A clean early exit is fatal too: this diagnostic has no retry path,
          // so a worker that leaves would strand its context forever.
          ['exit', () => finish(new D2RuntimeError('worker-pool-failure', 'worker exited'))],
        ];
        for (const [event, listener] of listeners) worker.on(event, listener);
        slots.push({ worker, listeners });
      }

      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted === true) {
        abort();
        return;
      }
      for (const worker of workers) dispatch(worker);
    });
  }

  destroy(): Promise<void> {
    this.destroyed = true;
    this.destroyPromise ??= Promise.allSettled(this.workers.map((worker) => worker.terminate()))
      .then((settled) => {
        if (settled.some((entry) => entry.status === 'rejected')) {
          throw new D2RuntimeError('worker-pool-failure', 'worker termination failed');
        }
      });
    return this.destroyPromise;
  }
}

/**
 * The capture equivalent of the projection check. A reply must be the answer to
 * the question that was asked, and well-formed enough that it cannot become a
 * receipt spec 7.1 step 5 then forbids recomputing - otherwise a malformed
 * trajectory surfaces much later as a terminal capture-missing-or-invalid input
 * veto instead of a resumable pool failure.
 */
function isTrajectoryForRequest(
  value: unknown,
  request: D2CaptureRequest,
): value is readonly D1CapturedState[] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  return CAPTURE_SLOTS.every((slot, index) => {
    const capture = value[index] as Partial<D1CapturedState> | null;
    return capture !== null && typeof capture === 'object'
      && capture.captureSlot === slot
      && capture.scheduledPieceNumber === slot
      && capture.split === request.split
      && capture.groupOrdinal === request.groupOrdinal
      && capture.behaviorSeed === request.behaviorSeed
      && capture.behaviorVectorId === request.vector.id
      && typeof capture.stateFingerprint === 'string'
      && capture.stateFingerprint.length > 0
      && capture.state !== null && typeof capture.state === 'object';
  });
}

/**
 * A D1 invalid-input reason has to survive the worker boundary intact:
 * flattening it into a pool failure would reclassify a terminal input veto as a
 * resumable episode failure and send the run down the wrong remediation branch.
 */
function failureFrom(message: Extract<D2WorkerMessage, { kind: 'failure' }>): Error {
  if (message.reason === 'simulation-failure' || message.reason === 'unclassified-failure') {
    return new D2RuntimeError(message.reason, `task ${String(message.taskId)}`);
  }
  return Object.assign(new Error(`D2 ${message.reason}`), { reason: message.reason });
}

// ---------------------------------------------------------------------------
// Executor dependencies
// ---------------------------------------------------------------------------

export function createD2ContextRunner(pool: D2PoolLike): D2ContextRunner {
  return ({ shardId, tasks, signal }) => pool.run(shardId, tasks, { signal });
}

/**
 * One capture shard's work: a single 512-piece behavior trajectory, yielding
 * that trajectory's two frozen slots.
 *
 * It goes to the pool rather than running here, for the same reason contexts
 * do: the simulation is synchronous, and on the orchestrator's thread it would
 * block every timer and signal handler for the whole shard.
 */
export function createD2TrajectoryRunner(pool: D2PoolLike): D2TrajectoryRunner {
  return async ({ shardId, behaviorSeed, split, groupOrdinal, behaviorVectorId, sources, signal }) => {
    const vector: D1SourceVector | undefined = sources.vectors
      .find(({ id }) => id === behaviorVectorId);
    if (vector === undefined) {
      throw new D2RuntimeError('simulation-failure', `unknown behavior vector ${behaviorVectorId}`);
    }
    return await pool.runCapture(shardId, { split, groupOrdinal, behaviorSeed, vector }, { signal });
  };
}
