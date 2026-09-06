import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writeAtomic } from './d2Evidence';
import { trainerLockPathFor } from './runLock';
import { createHash } from 'node:crypto';
import {
  D2RuntimeError,
  D2WorkerPool,
  anyD2ProcessRunning,
  createD2ContextRunner,
  createD2TrajectoryRunner,
  defaultD2WorkerCount,
  isProcessAlive,
  nodeD2FileSystem,
  parseWin32ProcessTable,
  trainerLockPresent,
  type D2WorkerLike,
} from './d2Runtime';
import type {
  D1ContextProjection,
  D1ContextTask,
} from './d1ActionConditionedHeldOutListwiseLabels';
import type {
  D2CaptureRequest,
  D2WorkerMessage,
  D2WorkerTask,
} from './d2ShardedHeldOutListwiseWorker';
import type { D1Sources } from './d1ActionConditionedHeldOutListwiseCore';

/**
 * These three adapters are the only parts of the D2 line that touch the disk,
 * spawn threads or run the simulator, so they are the only parts the rest of
 * the code gate cannot reach. What is testable here is their *contract*: the
 * filesystem against a real temp directory, and the pool against fake workers.
 * Neither test starts a real worker thread or a real trajectory.
 */

const roots: string[] = [];
const tempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'd2-runtime-'));
  roots.push(dir);
  return dir;
};

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('node filesystem adapter', () => {
  it('reads a missing file as null rather than throwing', () => {
    const fs = nodeD2FileSystem();
    expect(fs.readFile(join(tempRoot(), 'absent.json'))).toBeNull();
  });

  it('lists a missing directory as empty — the normal first-episode state', () => {
    expect(nodeD2FileSystem().readdir(join(tempRoot(), 'receipts'))).toEqual([]);
  });

  it('supports the atomic write sequence end to end', () => {
    const fs = nodeD2FileSystem();
    const root = tempRoot();
    const path = join(root, 'receipt.json');
    writeAtomic(fs, path, '{"a":1}');
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}');
    // The temp file must be gone: a leftover would be read back as a receipt.
    expect(fs.exists(`${path}.tmp`)).toBe(false);
    writeAtomic(fs, path, '{"a":2}');
    expect(fs.readFile(path)).toBe('{"a":2}');
  });

  it('appends newline-terminated lines and never rewrites earlier ones', () => {
    const fs = nodeD2FileSystem();
    const path = join(tempRoot(), 'run-record.jsonl');
    fs.appendLine(path, '{"kind":"episode-start"}');
    fs.appendLine(path, '{"kind":"episode-end"}');
    expect(readFileSync(path, 'utf8'))
      .toBe('{"kind":"episode-start"}\n{"kind":"episode-end"}\n');
  });

  it('creates a directory tree and reports existence for files and directories', () => {
    const fs = nodeD2FileSystem();
    const root = tempRoot();
    const nested = join(root, 'run', 'receipts');
    fs.mkdirp(nested);
    expect(fs.exists(nested)).toBe(true);
    fs.writeFileSync(join(nested, 'a.json'), '{}');
    expect(fs.readdir(nested)).toEqual(['a.json']);
  });

  it('takes an exclusive lock once and reports the second attempt as taken', () => {
    const fs = nodeD2FileSystem();
    const path = join(tempRoot(), 'run.lock');
    expect(fs.openExclusive(path, 'owner-a')).toBe(true);
    expect(fs.openExclusive(path, 'owner-b')).toBe(false);
    // The loser must not have overwritten the holder's record.
    expect(fs.readFile(path)).toBe('owner-a');
    fs.unlink(path);
    expect(fs.openExclusive(path, 'owner-b')).toBe(true);
  });

  it('propagates a non-ENOENT read failure instead of reporting an empty file', () => {
    const fs = nodeD2FileSystem();
    const root = tempRoot();
    // Reading a directory as a file is EISDIR, not ENOENT: silently mapping it
    // to null would let a corrupted layout look like a fresh run.
    writeFileSync(join(root, 'marker'), 'x');
    expect(() => fs.readFile(root)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------

const ZERO_DIAGNOSTICS = {
  searchCalls: 0, holdActions: 0, holdRate: 0, meanCompletedDepth: 0, minCompletedDepth: 0,
  completedDepthHistogram: [0, 0, 0, 0, 0], totalWorkUnitsUsed: 0, meanWorkUnitsUsed: 0,
  maxWorkUnitsUsed: 0, budgetExhaustedSearches: 0, budgetExhaustionRate: 0,
  placementEvaluationUnits: 0, chanceExpansionUnits: 0, cacheHitUnits: 0,
  expandedDecisionNodes: 0, expandedChanceNodes: 0, cacheHits: 0,
};

const task = (taskId: number): D1ContextTask => ({
  taskId,
  subsetId: `subset-${taskId % 3}`,
  placementId: `p${taskId}`,
  continuationVectorId: taskId % 2 === 0 ? 'gen6-best' : 'gen10-mu',
  streamIndex: (taskId % 2) as 0 | 1,
} as unknown as D1ContextTask);

/**
 * A well-formed projection, digest included. The pool now applies D1's own
 * validator, so a lazy stub is rejected — which is the point of the change:
 * only a reply a real worker could have produced gets through.
 */
function projectionOf(
  source: D1ContextTask,
  overrides: Record<string, unknown> = {},
): D1ContextProjection {
  const preimage = {
    taskId: source.taskId,
    subsetId: source.subsetId,
    placementId: source.placementId,
    continuationVectorId: source.continuationVectorId,
    streamIndex: source.streamIndex,
    pieces: 128,
    scoreDelta: 40 + source.taskId,
    clearCounts: { singles: 1, doubles: 0, triples: 0, tetrises: 0 },
    reason: 'pieceCap' as const,
    searchDiagnostics: ZERO_DIAGNOSTICS,
    ...overrides,
  };
  const projectionDigest = createHash('sha256')
    .update(JSON.stringify(preimage), 'utf8').digest('hex');
  return { ...preimage, projectionDigest } as unknown as D1ContextProjection;
}

const contextTaskOf = (posted: D2WorkerTask): D1ContextTask => {
  if (posted.kind !== 'context') throw new Error('expected a context task');
  return posted.task;
};

const replyWith = (posted: D2WorkerTask): D2WorkerMessage => ({
  kind: 'result',
  shardId: posted.shardId,
  result: projectionOf(contextTaskOf(posted)),
});

/** Answers whichever kind it is handed. */
const replyToEither = (posted: D2WorkerTask): D2WorkerMessage => {
  if (posted.kind !== 'capture') return replyWith(posted);
  const { split, groupOrdinal, behaviorSeed, vector } = posted.capture;
  return {
    kind: 'capture-result',
    shardId: posted.shardId,
    captures: ([128, 512] as const).map((captureSlot) => ({
      split, groupOrdinal, behaviorSeed, behaviorVectorId: vector.id,
      behaviorVectorDigest: vector.digest, captureSlot,
      scheduledPieceNumber: captureSlot, score: 0, lines: 0, level: 1,
      state: { board: [], current: null, next: 3, hold: null, holdAvailable: true, unseenBagMask: 0 },
      sourceDiagnostics: {},
      stateFingerprint: `fp-${split}-${groupOrdinal}-${vector.id}-${captureSlot}`,
    })) as never,
  };
};

const CAPTURE_REQUEST: D2CaptureRequest = {
  split: 'train',
  groupOrdinal: 0,
  behaviorSeed: 1234,
  vector: { id: 'gen6-best', weights: Array.from({ length: 13 }, () => 0.1), digest: 'd' },
};

interface FakeWorkerOptions {
  readonly reply?: (posted: D2WorkerTask) => D2WorkerMessage | null;
  readonly onEvent?: 'error' | 'exit' | null;
}

/**
 * A worker that answers on the microtask queue. Real threads are deliberately
 * absent: what the pool has to get right is the protocol, and a real `Worker`
 * would be testing tsx's loader instead.
 */
function fakeWorkerFactory(options: FakeWorkerOptions = {}) {
  const posted: D2WorkerTask[] = [];
  const factory = (): D2WorkerLike => {
    const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    const emit = (event: string, payload?: unknown): void => {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    };
    const worker: D2WorkerLike = {
      postMessage(message) {
        posted.push(message);
        queueMicrotask(() => {
          if (options.onEvent != null) {
            emit(options.onEvent);
            return;
          }
          const reply = (options.reply ?? replyWith)(message);
          if (reply !== null) emit('message', reply);
        });
      },
      on(event, listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return worker;
      },
      removeListener(event, listener) {
        listeners.set(
          String(event),
          (listeners.get(String(event)) ?? []).filter((entry) => entry !== listener),
        );
        return worker;
      },
      terminate: () => Promise.resolve(0),
    };
    return worker;
  };
  return { factory, posted };
}

describe('worker pool — context tasks', () => {
  it('returns projections in task order regardless of completion order', async () => {
    const { factory } = fakeWorkerFactory();
    const pool = D2WorkerPool.create(4, factory);
    const tasks = Array.from({ length: 12 }, (_, index) => task(index));
    const results = await pool.run('label-train/subset', tasks);
    expect(results.map((projection) => projection.taskId))
      .toEqual(tasks.map((entry) => entry.taskId));
    await pool.destroy();
  });

  it('stamps every dispatch with its kind and shard id', async () => {
    const { factory, posted } = fakeWorkerFactory();
    const pool = D2WorkerPool.create(2, factory);
    await pool.run('label-test/subset-9', [task(0), task(1)]);
    expect(posted.map((entry) => entry.kind)).toEqual(['context', 'context']);
    expect(posted.map((entry) => entry.shardId))
      .toEqual(['label-test/subset-9', 'label-test/subset-9']);
    await pool.destroy();
  });

  it('rejects a reply that names a different shard', async () => {
    const { factory } = fakeWorkerFactory({
      reply: (posted) => ({ ...replyWith(posted), shardId: 'replay/0' } as D2WorkerMessage),
    });
    const pool = D2WorkerPool.create(1, factory);
    await expect(pool.run('label-train/subset-0', [task(0)]))
      .rejects.toThrow(/different shard/);
    await pool.destroy();
  });

  it('rejects a projection that answers a different task', async () => {
    const { factory } = fakeWorkerFactory({
      reply: (posted) => ({
        kind: 'result', shardId: posted.shardId,
        result: projectionOf(contextTaskOf(posted), { taskId: 999 }),
      }),
    });
    const pool = D2WorkerPool.create(1, factory);
    await expect(pool.run('label-train/subset-0', [task(0)]))
      .rejects.toThrow(/does not match its task/);
    await pool.destroy();
  });

  it.each([
    ['a stale digest', { scoreDelta: 7 }, true],
    ['a negative piece count', { pieces: -1 }, false],
    ['a malformed reason', { reason: 'timeout' }, false],
    ['a broken clear-count record', { clearCounts: { singles: 1 } }, false],
    ['truncated search diagnostics', { searchDiagnostics: { searchCalls: 0 } }, false],
  ] as const)('rejects %s before it can become a receipt', async (_label, override, staleDigest) => {
    // Under the previous identity-only check every one of these was accepted and
    // written as a valid receipt, and only rejected shards later at
    // materialization — by which point spec 7.1 step 5 forbids recomputing it,
    // so the run died naming the wrong shard.
    const { factory } = fakeWorkerFactory({
      reply: (posted) => {
        const source = contextTaskOf(posted);
        const result = staleDigest
          ? { ...projectionOf(source), ...override }
          : projectionOf(source, override as Record<string, unknown>);
        return { kind: 'result', shardId: posted.shardId, result } as D2WorkerMessage;
      },
    });
    const pool = D2WorkerPool.create(1, factory);
    await expect(pool.run('label-train/subset-0', [task(0)]))
      .rejects.toThrow(/does not match its task/);
    await pool.destroy();
  });

  it('keeps a D1 invalid-input reason intact instead of flattening it', async () => {
    // Flattening this into a pool failure would turn a terminal input veto into
    // a resumable episode failure and send the run down the wrong branch.
    const { factory } = fakeWorkerFactory({
      reply: (posted) => ({
        kind: 'failure', shardId: posted.shardId, taskId: 0,
        reason: 'placement-manifest-mismatch',
      }),
    });
    const pool = D2WorkerPool.create(1, factory);
    await expect(pool.run('label-train/subset-0', [task(0)]))
      .rejects.toMatchObject({ reason: 'placement-manifest-mismatch' });
    await pool.destroy();
  });

  it('reports a worker simulation failure as simulation-failure', async () => {
    const { factory } = fakeWorkerFactory({
      reply: (posted) => ({
        kind: 'failure', shardId: posted.shardId, taskId: 0, reason: 'simulation-failure',
      }),
    });
    const pool = D2WorkerPool.create(1, factory);
    await expect(pool.run('label-train/subset-0', [task(0)]))
      .rejects.toMatchObject({ reason: 'simulation-failure' });
    await pool.destroy();
  });

  it.each(['error', 'exit'] as const)('treats a worker %s as a pool failure', async (event) => {
    // Even a clean exit is fatal: there is no retry path, so a departing worker
    // would strand its context forever.
    const { factory } = fakeWorkerFactory({ onEvent: event });
    const pool = D2WorkerPool.create(1, factory);
    await expect(pool.run('label-train/subset-0', [task(0)]))
      .rejects.toMatchObject({ reason: 'worker-pool-failure' });
    await pool.destroy();
  });

  it('rejects a pre-aborted signal without dispatching anything', async () => {
    const { factory, posted } = fakeWorkerFactory();
    const pool = D2WorkerPool.create(2, factory);
    await expect(pool.run('label-train/subset-0', [task(0)], { signal: AbortSignal.abort() }))
      .rejects.toMatchObject({ reason: 'worker-pool-failure' });
    expect(posted).toHaveLength(0);
  });

  it('refuses a second concurrent run and any run after destroy', async () => {
    const { factory } = fakeWorkerFactory();
    const pool = D2WorkerPool.create(1, factory);
    const first = pool.run('label-train/subset-0', [task(0)]);
    await expect(pool.run('label-train/subset-1', [task(1)]))
      .rejects.toMatchObject({ reason: 'worker-pool-failure' });
    await first;
    await pool.destroy();
    await expect(pool.run('label-train/subset-2', [task(2)]))
      .rejects.toMatchObject({ reason: 'worker-pool-failure' });
  });

  it('resolves an empty task list without touching a worker', async () => {
    const { factory, posted } = fakeWorkerFactory();
    const pool = D2WorkerPool.create(1, factory);
    expect(await pool.run('aggregate', [])).toEqual([]);
    expect(posted).toHaveLength(0);
    await pool.destroy();
  });

  it('rejects an invalid pool size rather than creating a degenerate pool', () => {
    const { factory } = fakeWorkerFactory();
    expect(() => D2WorkerPool.create(0, factory)).toThrow(D2RuntimeError);
    expect(() => D2WorkerPool.create(1.5, factory)).toThrow(D2RuntimeError);
  });

  it('terminates every worker it created when a spawn fails partway', async () => {
    const terminated: number[] = [];
    let created = 0;
    const pool = D2WorkerPool.create(4, (index) => {
      if (index === 2) throw new Error('spawn failed');
      created += 1;
      return {
        postMessage: () => undefined,
        on() { return this as unknown as D2WorkerLike; },
        removeListener() { return this as unknown as D2WorkerLike; },
        terminate: () => { terminated.push(index); return Promise.resolve(0); },
      } as unknown as D2WorkerLike;
    });
    // The pool grows on demand, so the failure surfaces on the dispatch that
    // needs the third thread rather than at construction.
    await expect(pool.run('label-train/subset-0', [task(0), task(1), task(2), task(3)]))
      .rejects.toThrow(/worker creation failed/);
    expect(created).toBe(2);
    expect(terminated).toEqual([0, 1]);
  });

  it('reports a worker that will not terminate', async () => {
    const stuck = () => ({
      postMessage: () => undefined,
      on() { return this as unknown as D2WorkerLike; },
      removeListener() { return this as unknown as D2WorkerLike; },
      terminate: () => Promise.reject(new Error('stuck')),
    } as unknown as D2WorkerLike);
    const pool = D2WorkerPool.create(1, stuck);
    // Force one thread into existence; a pool that never spawned has nothing to
    // fail at. The dispatch never settles because the worker never answers,
    // which is exactly the shape of a stuck worker.
    void pool.run('label-train/subset-0', [task(0)]).catch(() => undefined);
    await expect(pool.destroy()).rejects.toMatchObject({ reason: 'worker-pool-failure' });
  });

  it('spawns no thread until one is needed, and never more than the pool size', async () => {
    // Around half the run's wall clock is the capture phase, which needs one
    // thread. Spawning `cores - 1` of them up front leaves the rest idle for an
    // hour holding the whole D1 module graph and the search caches.
    const spawned: number[] = [];
    const { factory } = fakeWorkerFactory({ reply: replyToEither });
    const counting = (index: number) => { spawned.push(index); return factory(); };

    const pool = D2WorkerPool.create(8, counting);
    expect(spawned).toHaveLength(0);

    await pool.runCapture('capture/train/0/gen6-best', CAPTURE_REQUEST);
    expect(spawned).toHaveLength(1);

    await pool.run('label-train/subset-0', Array.from({ length: 3 }, (_, i) => task(i)));
    expect(spawned).toHaveLength(3);

    // Capped at the configured size, however many tasks arrive.
    await pool.run('label-train/subset-1', Array.from({ length: 40 }, (_, i) => task(i)));
    expect(spawned).toHaveLength(8);
    await pool.destroy();
  });

  it('exposes the pool through the executor context-runner seam', async () => {
    const { factory, posted } = fakeWorkerFactory();
    const pool = D2WorkerPool.create(1, factory);
    const results = await createD2ContextRunner(pool)({ shardId: 'replay/3', tasks: [task(7)] });
    expect(results).toHaveLength(1);
    expect(posted[0]!.shardId).toBe('replay/3');
    await pool.destroy();
  });
});

describe('worker pool — capture tasks', () => {
  // Capture belongs on a worker for one reason: `captureD1Trajectory` simulates
  // 512 pieces synchronously, and on the orchestrator's thread that blocks the
  // heartbeat, the watchdog and every signal handler for the whole shard.
  /** A reply well-formed enough to be worth turning into a receipt. */
  const bothSlots = (posted: D2WorkerTask): D2WorkerMessage => {
    if (posted.kind !== 'capture') throw new Error('expected a capture task');
    const { split, groupOrdinal, behaviorSeed, vector } = posted.capture;
    return {
      kind: 'capture-result',
      shardId: posted.shardId,
      captures: ([128, 512] as const).map((captureSlot) => ({
        split, groupOrdinal, behaviorSeed, behaviorVectorId: vector.id,
        behaviorVectorDigest: vector.digest, captureSlot,
        scheduledPieceNumber: captureSlot, score: 0, lines: 0, level: 1,
        state: { board: [], current: null, next: 3, hold: null, holdAvailable: true, unseenBagMask: 0 },
        sourceDiagnostics: {},
        stateFingerprint: `fp-${split}-${groupOrdinal}-${vector.id}-${captureSlot}`,
      })) as never,
    };
  };

  it('dispatches a capture task and returns both frozen slots', async () => {
    const { factory, posted } = fakeWorkerFactory({ reply: bothSlots });
    const pool = D2WorkerPool.create(3, factory);
    const captures = await pool.runCapture('capture/train/0/gen6-best', CAPTURE_REQUEST);
    expect(captures).toHaveLength(2);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ kind: 'capture', shardId: 'capture/train/0/gen6-best' });
    await pool.destroy();
  });

  it.each([
    ['only one slot', (posted: D2WorkerTask) => ({ captures: [(bothSlots(posted) as never as { captures: unknown[] }).captures[0]] })],
    ['a slot the request did not ask for', (posted: D2WorkerTask) => ({
      captures: (bothSlots(posted) as never as { captures: Record<string, unknown>[] }).captures
        .map((c) => ({ ...c, groupOrdinal: 99 })),
    })],
    ['a capture with no state', (posted: D2WorkerTask) => ({
      captures: (bothSlots(posted) as never as { captures: Record<string, unknown>[] }).captures
        .map((c) => ({ ...c, state: null })),
    })],
  ] as const)('rejects a trajectory reply with %s', async (_label, mutate) => {
    // The context path gets D1's full validator; the capture path needs the
    // same standard, because a malformed capture that becomes a receipt cannot
    // be recomputed and resurfaces later as a terminal input veto.
    const { factory } = fakeWorkerFactory({
      reply: (posted) => ({ ...bothSlots(posted), ...mutate(posted) } as D2WorkerMessage),
    });
    const pool = D2WorkerPool.create(1, factory);
    await expect(pool.runCapture('capture/train/0/gen6-best', CAPTURE_REQUEST))
      .rejects.toThrow(/malformed trajectory reply/);
    await pool.destroy();
  });

  it('rejects a context reply to a capture request, and a reply for another shard', async () => {
    const wrongKind = D2WorkerPool.create(1, fakeWorkerFactory({
      reply: (posted) => ({
        kind: 'result', shardId: posted.shardId, result: projectionOf(task(0)),
      }),
    }).factory);
    await expect(wrongKind.runCapture('capture/train/0/gen6-best', CAPTURE_REQUEST))
      .rejects.toThrow(/expected a capture result/);
    await wrongKind.destroy();

    const wrongShard = D2WorkerPool.create(1, fakeWorkerFactory({
      reply: (posted) => ({ ...bothSlots(posted), shardId: 'capture/test/3/gen10-mu' }),
    }).factory);
    await expect(wrongShard.runCapture('capture/train/0/gen6-best', CAPTURE_REQUEST))
      .rejects.toThrow(/different shard/);
    await wrongShard.destroy();
  });

  it('propagates a capture-side invalid-input reason intact', async () => {
    const { factory } = fakeWorkerFactory({
      reply: (posted) => ({
        kind: 'failure', shardId: posted.shardId, taskId: null,
        reason: 'capture-missing-or-invalid',
      }),
    });
    const pool = D2WorkerPool.create(1, factory);
    await expect(pool.runCapture('capture/train/0/gen6-best', CAPTURE_REQUEST))
      .rejects.toMatchObject({ reason: 'capture-missing-or-invalid' });
    await pool.destroy();
  });

  it('rejects a pre-aborted signal without dispatching a trajectory', async () => {
    const { factory, posted } = fakeWorkerFactory({ reply: bothSlots });
    const pool = D2WorkerPool.create(1, factory);
    await expect(pool.runCapture('capture/train/0/gen6-best', CAPTURE_REQUEST,
      { signal: AbortSignal.abort() })).rejects.toMatchObject({ reason: 'worker-pool-failure' });
    expect(posted).toHaveLength(0);
  });

  it('goes through the pool from the executor trajectory seam, never inline', async () => {
    const { factory, posted } = fakeWorkerFactory({ reply: bothSlots });
    const pool = D2WorkerPool.create(1, factory);
    const captures = await createD2TrajectoryRunner(pool)({
      shardId: 'capture/validation/2/gen10-mu',
      behaviorSeed: 99,
      split: 'validation',
      groupOrdinal: 2,
      behaviorVectorId: 'gen10-mu',
      sources: {
        vectors: [CAPTURE_REQUEST.vector, { ...CAPTURE_REQUEST.vector, id: 'gen10-mu' }],
      } as unknown as D1Sources,
    });
    expect(captures).toHaveLength(2);
    expect(posted[0]).toMatchObject({ kind: 'capture', shardId: 'capture/validation/2/gen10-mu' });
    await pool.destroy();
  });

  it('fails closed on a behavior vector the sources do not carry', async () => {
    // No trajectory is dispatched: the guard rejects before the 512 scheduled
    // pieces would be simulated.
    const { factory, posted } = fakeWorkerFactory({ reply: bothSlots });
    const pool = D2WorkerPool.create(1, factory);
    await expect(createD2TrajectoryRunner(pool)({
      shardId: 'capture/train/0/gen10-mu',
      behaviorSeed: 1,
      split: 'train',
      groupOrdinal: 0,
      behaviorVectorId: 'gen10-mu',
      sources: { vectors: [{ id: 'gen6-best', weights: [], digest: 'x' }] } as unknown as D1Sources,
    })).rejects.toThrow(/unknown behavior vector/);
    expect(posted).toHaveLength(0);
    await pool.destroy();
  });
});

describe('worker count', () => {
  it.each([
    [1, 1], [2, 1], [4, 3], [8, 7], [32, 31], [64, 31], [128, 31],
  ])('leaves one core free on %i cores, capped at 31', (cores, expected) => {
    // The policy at its boundaries rather than a restatement of it: written as
    // `toBe(Math.max(1, Math.min(31, availableParallelism() - 1)))` the
    // assertion could only ever agree with itself.
    expect(defaultD2WorkerCount(cores)).toBe(expected);
  });

  it('reads the live core count when none is given', () => {
    expect(defaultD2WorkerCount()).toBe(defaultD2WorkerCount(availableParallelism()));
  });
});

describe('process and lock predicates', () => {
  // §7.1.1's checklist is only satisfiable if these can actually answer. The
  // shipped entry point used the permissive test defaults, so `isProcessAlive`
  // was always true and every lock left by a SIGKILL blocked every resume
  // forever — the state the takeover exists for.
  it('reports a live pid as alive and an absent one as dead', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999_999_999)).toBe(false);
    // Not a pid at all; must never be reported alive.
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(1.5)).toBe(false);
  });

  it('derives the trainer lock path from the repository, and does not create it', () => {
    const path = trainerLockPathFor(process.cwd());
    expect(path).toMatch(/tetris-trainer-[0-9a-f]{64}\.lock$/);
    const before = existsSync(path);
    expect(trainerLockPresent(process.cwd())).toBe(before);
    // Read-only: asking must never change the answer.
    expect(existsSync(path)).toBe(before);
  });

  it('says "indeterminate" rather than "present" when the path cannot be derived', () => {
    // Both stop the episode, but only one sends the operator hunting for a lock
    // file that does not exist — on every attempt, during the one authorized
    // run. Deriving the path shells out to git, so a directory that is not a
    // repository is the realistic trigger.
    expect(trainerLockPresent(tempRoot())).toBe('indeterminate');
  });

  /**
   * Simulated process tables, because the live one cannot reproduce the case
   * that matters: `tsx` does not run the script in the process you launch, so a
   * real D2 run has a *parent* carrying the entry path on its command line —
   * and a vitest process tree never does. A test against this machine would
   * pass while the shipped binary refused its own resume.
   */
  const MARKER = 'training/d2ShardedHeldOutListwise.ts';
  const table = (...rows: [number, number, string][]) =>
    rows.map(([pid, ppid, commandLine]) => ({ pid, ppid, commandLine }));

  it('does not mistake its own tsx launcher for another D2 process', () => {
    // The production topology: npm -> tsx supervisor -> orchestrator, with the
    // entry path on all three command lines.
    expect(anyD2ProcessRunning(table(
      [100, 1, `npm run diagnose:d2-sharded-listwise`],
      [200, 100, `node tsx/dist/cli.mjs ${MARKER}`],
      [300, 200, `node --import tsx ${MARKER}`],
    ), 300)).toBe(false);
  });

  it('walks the whole ancestor chain, including a non-node link', () => {
    // `npx tsx …` inserts a grandparent that also carries the path, and a chain
    // can pass through cmd.exe — which is why the table is not filtered to node.
    expect(anyD2ProcessRunning(table(
      [10, 1, 'C:\\Windows\\system32\\cmd.exe /c npm run diagnose'],
      [20, 10, `node npx-cli.js tsx ${MARKER}`],
      [30, 20, `node tsx/dist/cli.mjs ${MARKER}`],
      [40, 30, `node --import tsx ${MARKER}`],
    ), 40)).toBe(false);
  });

  it('still reports a genuinely separate D2 process', () => {
    // The point of the predicate: a second run really is a reason to refuse.
    expect(anyD2ProcessRunning(table(
      [300, 200, `node --import tsx ${MARKER}`],
      [200, 100, `node tsx/dist/cli.mjs ${MARKER}`],
      [900, 1, `node --import tsx ${MARKER}`],
    ), 300)).toBe(true);
  });

  it('refuses the takeover when the table cannot be read', () => {
    // "I could not check" is not evidence that nothing is running, and the
    // checklist may not be relaxed.
    expect(anyD2ProcessRunning(null, 300)).toBe(true);
  });

  it('survives a broken ancestor chain and a self-parenting row', () => {
    // A pid whose parent has already exited, and the cycle a recycled pid can
    // produce; neither may hang the walk or crash it.
    expect(anyD2ProcessRunning(table([300, 999, `node --import tsx ${MARKER}`]), 300)).toBe(false);
    expect(anyD2ProcessRunning(table([300, 300, `node --import tsx ${MARKER}`]), 300)).toBe(false);
  });

  it('answers from the live table without throwing', () => {
    // The default argument really does enumerate; the assertion is only that it
    // produces a boolean, since this machine's answer is environmental.
    expect(typeof anyD2ProcessRunning()).toBe('boolean');
  });
});

describe('a worker that dies between shards is replaced, not dispatched to', () => {
  it('drops a dead thread and spawns a fresh one on the next run', async () => {
    // Between shards a worker carries only the death listener, so a dispatch to
    // a terminated thread would be silently dropped and hang to the per-shard
    // ceiling — recorded as `shard-timeout`, which is promotable. An
    // infrastructure death must not launder itself into a shard-purity signal.
    const spawned: { worker: D2WorkerLike; die: () => void }[] = [];
    const pool = D2WorkerPool.create(2, () => {
      const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
      const worker: D2WorkerLike = {
        postMessage(message) {
          queueMicrotask(() => {
            for (const listener of listeners.get('message') ?? []) listener(replyWith(message));
          });
        },
        on(event, listener) {
          listeners.set(event, [...(listeners.get(event) ?? []), listener]);
          return worker;
        },
        removeListener(event, listener) {
          listeners.set(String(event),
            (listeners.get(String(event)) ?? []).filter((entry) => entry !== listener));
          return worker;
        },
        terminate: () => Promise.resolve(0),
      };
      spawned.push({
        worker,
        die: () => { for (const l of listeners.get('exit') ?? []) l(); },
      });
      return worker;
    });

    await pool.run('label-train/subset-0', [task(0)]);
    expect(spawned).toHaveLength(1);

    // The thread leaves while nothing is in flight.
    spawned[0]!.die();

    await pool.run('label-train/subset-1', [task(1)]);
    expect(spawned).toHaveLength(2);
    await pool.destroy();
  });
});

describe('thread names survive a replacement', () => {
  it('names every thread it spawns distinctly', async () => {
    // Post-hoc attribution over a multi-hour run depends on thread names in
    // stack traces. Deriving the name from the array length meant a thread
    // spawned to replace a dead one could take a live thread's name.
    const names: number[] = [];
    const listenersFor = new Map<number, Map<string, ((...a: unknown[]) => void)[]>>();
    const pool = D2WorkerPool.create(2, (index) => {
      names.push(index);
      const listeners = new Map<string, ((...a: unknown[]) => void)[]>();
      listenersFor.set(index, listeners);
      const worker: D2WorkerLike = {
        postMessage(message) {
          queueMicrotask(() => {
            for (const l of listeners.get('message') ?? []) l(replyWith(message));
          });
        },
        on(event, listener) {
          listeners.set(event, [...(listeners.get(event) ?? []), listener]);
          return worker;
        },
        removeListener(event, listener) {
          listeners.set(String(event),
            (listeners.get(String(event)) ?? []).filter((e) => e !== listener));
          return worker;
        },
        terminate: () => Promise.resolve(0),
      };
      return worker;
    });

    await pool.run('label-train/a', [task(0)]);
    for (const l of listenersFor.get(0)?.get('exit') ?? []) l();
    await pool.run('label-train/b', [task(1)]);

    expect(names).toEqual([0, 1]);
    expect(new Set(names).size).toBe(names.length);
    await pool.destroy();
  });
});

describe('a command line that spans lines does not become a phantom process', () => {
  /**
   * The pathological shape, and the only one that actually bites: a wrapped
   * command line whose continuation happens to carry two pipes. Split naively
   * on `|` it parses as a row in its own right — pid `NaN`, and the entry path
   * sitting in the command-line field. A `NaN` pid can never be kin, so the
   * diagnostic sees a phantom second D2 process, refuses the takeover, and lands
   * back in the dead end rounds 6 and 7 each fixed once.
   *
   * A continuation with no pipes is harmless either way (both parsers drop it),
   * which is exactly why this fixture is shaped the way it is rather than the
   * way a wrapped line usually looks.
   */
  const WRAPPED = [
    '100|1|npm run diagnose',
    '200|100|node tsx/dist/cli.mjs --title',
    'D2|run|node --import tsx training/d2ShardedHeldOutListwise.ts',
    '300|200|node --import tsx training/d2ShardedHeldOutListwise.ts',
  ].join('\n');

  it('folds a continuation back into the row it belongs to', () => {
    const rows = parseWin32ProcessTable(WRAPPED);
    expect(rows.map((row) => row.pid)).toEqual([100, 200, 300]);
    expect(rows.every((row) => Number.isSafeInteger(row.pid))).toBe(true);
    expect(rows[1]!.commandLine).toContain('training/d2ShardedHeldOutListwise.ts');
  });

  it('keeps a wrapped launcher out of the answer', () => {
    // Folded in, the marker belongs to pid 200 — an ancestor of 300, so kin.
    expect(anyD2ProcessRunning(parseWin32ProcessTable(WRAPPED), 300)).toBe(false);
  });
});
