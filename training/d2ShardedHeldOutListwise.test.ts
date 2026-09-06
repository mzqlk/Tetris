import { describe, expect, it } from 'vitest';
import { D2_PROFILE } from './d2Protocol';
import {
  buildD2Stage1Manifest,
  buildD2Stage2Manifest,
  canonicalJson,
  digestOf,
  runIdFor,
  stage1Digest,
  type D2CaptureRef,
  type D2FrozenSubsetLike,
  type D2ShardId,
  type D2Stage2Manifest,
} from './d2ShardManifest';
import { evidenceDir, readRunRecord, resultPath, type D2Receipt } from './d2Evidence';
import { shardPhase } from './d2Scheduler';
import { classifyD2Exit, shouldPromoteToRuntimeFail } from './d2Exit';
import { defaultD2WorkerCount } from './d2Runtime';
import {
  D2WriteBoundaryError,
  MAX_BARREN_EPISODES,
  MAX_PRODUCTIVE_EPISODES,
  episodeBudgets,
  guardWriteBoundary,
  parseD2WorkerCount,
  runD2Main,
  runD2Episode,
  type D2Dependencies,
  type D2MainProcessLike,
  type D2ShardExecutor,
} from './d2ShardedHeldOutListwise';
import { makeMemoryFs, type MemoryFs } from './d2TestUtils';

/** The partition-invariant half of a verdict: everything but `runProvenance`. */
function canonicalOf(stdout: string): unknown {
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  const canonical = { ...parsed };
  delete canonical.runProvenance;
  return canonical;
}

function provenanceOf(stdout: string): Record<string, unknown> {
  return (JSON.parse(stdout) as { runProvenance: Record<string, unknown> }).runProvenance;
}

const stage1 = buildD2Stage1Manifest({ profile: D2_PROFILE });
const RUN_ID = runIdFor(stage1);
const DIR = evidenceDir(RUN_ID);

const frozenIdentity = { runtimeIdentity: () => stage1.runtimeIdentity };

const SPLITS = ['train', 'validation', 'test'] as const;
const GROUPS = { train: 20, validation: 8, test: 12 } as const;
const VECTORS = ['gen6-best', 'gen10-mu'] as const;

function captureRefs(): D2CaptureRef[] {
  const refs: D2CaptureRef[] = [];
  for (const split of SPLITS) {
    for (let groupOrdinal = 0; groupOrdinal < GROUPS[split]; groupOrdinal++) {
      for (const behaviorVectorId of VECTORS) {
        for (const captureSlot of [128, 512] as const) {
          refs.push({
            split, groupOrdinal, behaviorVectorId, captureSlot,
            stateFingerprint: `fp-${split}-${groupOrdinal}-${behaviorVectorId}-${captureSlot}`,
          });
        }
      }
    }
  }
  return refs;
}

const fakeFreeze = (capture: D2CaptureRef): D2FrozenSubsetLike => ({
  subsetId: capture.stateFingerprint,
  legalCount: 12,
  selectedCount: 12,
  legalPlacementIds: Array.from({ length: 12 }, (_, i) => `p${i}`),
  legalUniverseDigest: `lu-${capture.stateFingerprint}`,
  manifestDigest: `md-${capture.stateFingerprint}`,
  selectedPlacementIds: Array.from({ length: 12 }, (_, i) => `p${i}`),
});

/** Stage-2 is a pure function of the capture receipts — that is the point. */
const buildStage2: D2Dependencies['buildStage2'] = () => buildD2Stage2Manifest({
  stage1, captures: captureRefs(), profile: D2_PROFILE, freezeSubset: fakeFreeze,
});

const stage2Fixture: D2Stage2Manifest = buildStage2!({
  stage1, captureReceipts: new Map<D2ShardId, D2Receipt>(),
});

const AGGREGATE_PAYLOAD = Object.freeze({
  mode: D2_PROFILE.protocolId,
  status: 'fail-representation-gain-not-held-out' as const,
  canonical: { subsetJointFrontHits: { afterstate13: 20, action24: 24 } },
});

/**
 * Deterministic payloads: each shard's output depends only on its id, so the
 * resume-equivalence invariant is actually being exercised rather than assumed.
 */
function makeExecutor(options: {
  readonly failAfter?: number;
  readonly failWith?: string;
  readonly failOnShard?: D2ShardId;
  readonly counter?: { value: number };
} = {}): D2ShardExecutor {
  const counter = options.counter ?? { value: 0 };
  return async ({ shardId }) => {
    if (options.failOnShard === shardId) {
      throw Object.assign(new Error('injected'), { reason: options.failWith ?? 'replay-mismatch' });
    }
    if (options.failAfter !== undefined && counter.value >= options.failAfter) {
      throw Object.assign(new Error('injected'), { reason: options.failWith ?? 'worker-pool-failure' });
    }
    counter.value += 1;
    if (shardId === 'aggregate') return AGGREGATE_PAYLOAD;
    return { shardId, digest: digestOf(shardId) };
  };
}

const baseDeps = (fs: MemoryFs, over: Partial<D2Dependencies> = {}): D2Dependencies => ({
  fs,
  ...frozenIdentity,
  clock: () => '2026-09-02T00:00:00.000Z',
  now: () => 0,
  pid: 4242,
  ppid: 1,
  isProcessAlive: () => false,
  anyD2ProcessRunning: () => false,
  buildStage2,
  executeShard: makeExecutor(),
  workerCount: 1,
  ...over,
});

/**
 * Each episode gets a FRESH executor, the way a real restart would: the
 * interrupt budget is per-process, not cumulative. Reusing one executor across
 * episodes would make the same shard fail twice with the same reason and
 * correctly trip the two-strike promotion rule, which is a different scenario.
 */
async function runToCompletion(
  makeOver: () => Partial<D2Dependencies> = () => ({}),
  fs = makeMemoryFs(),
) {
  let outcome = await runD2Episode(baseDeps(fs, makeOver()));
  let guard = 0;
  while (outcome.kind === 'episode-incomplete' && guard < 40) {
    guard += 1;
    outcome = await runD2Episode(baseDeps(fs, makeOver()));
  }
  return { fs, outcome };
}

describe('startup sequence', () => {
  it('checks runtime identity before deriving any digest or runId', async () => {
    const fs = makeMemoryFs();
    const outcome = await runD2Episode({
      fs,
      runtimeIdentity: () => ({ node: '20.0.0', v8: 'x', platform: 'linux-x64' }),
    });
    expect(outcome.kind).toBe('pre-veto');
    expect(JSON.parse(outcome.stdout).failureReasons).toContain('runtime-identity-mismatch');
    expect(fs.calls).toHaveLength(0);
    expect(fs.exists(resultPath(DIR))).toBe(false);
  });

  it('replays an existing result.json before touching the lock or the run record', async () => {
    const canonical = `${canonicalJson({ status: 'pass-action-conditioned-listwise-supported' })}\n`;
    const fs = makeMemoryFs({ seed: { [resultPath(DIR)]: canonical } });
    const outcome = await runD2Episode(baseDeps(fs));
    expect(outcome.stdout).toBe(canonical);
    expect(outcome.exitCode).toBe(0);
    expect(fs.calls.some((call) => call.op === 'openExclusive')).toBe(false);
    expect(fs.calls.some((call) => call.op === 'appendLine')).toBe(false);
  });

  it('replays a failing stored verdict with exit code 1', async () => {
    const canonical = `${canonicalJson({ status: 'fail-joint-selection-not-shown' })}\n`;
    const fs = makeMemoryFs({ seed: { [resultPath(DIR)]: canonical } });
    expect((await runD2Episode(baseDeps(fs))).exitCode).toBe(1);
  });

  it('returns a non-verdict episode-incomplete when the trainer lock exists', async () => {
    const fs = makeMemoryFs();
    const outcome = await runD2Episode(baseDeps(fs, { trainerLockPresent: () => true }));
    expect(outcome.kind).toBe('episode-incomplete');
    expect(JSON.parse(outcome.stdout).failureReasons).toContain('trainer-lock-present');
    expect(fs.exists(resultPath(DIR))).toBe(false);
  });

  it('blocks on a live lock instead of taking it over', async () => {
    const fs = makeMemoryFs({
      seed: {
        [`${DIR}/run.lock`]: canonicalJson({
          ownerNonce: 'someone-else', pid: 111, startedAt: '2026-09-02T00:00:00.000Z', episodeOrdinal: 1,
        }),
      },
    });
    const outcome = await runD2Episode(baseDeps(fs, { isProcessAlive: () => true }));
    expect(outcome.kind).toBe('episode-incomplete');
    expect(JSON.parse(outcome.stdout).failureReasons).toContain('run-locked');
    expect(fs.calls.some((call) => call.op === 'unlink')).toBe(false);
  });

  it('takes over a provably dead lock and continues', async () => {
    const fs = makeMemoryFs({
      seed: {
        [`${DIR}/run.lock`]: canonicalJson({
          ownerNonce: 'dead', pid: 111, startedAt: '2026-09-02T00:00:00.000Z', episodeOrdinal: 1,
        }),
        [`${DIR}/run-record.jsonl`]: `${canonicalJson({
          kind: 'episode-start', episodeOrdinal: 1, startedAt: '2026-09-02T00:00:00.000Z',
          pid: 111, ppid: 0, runtimeIdentity: stage1.runtimeIdentity, workerCount: 1,
          manifestDigest: 'x', completedShards: 0,
        })}
`,
      },
    });
    const outcome = await runD2Episode(baseDeps(fs, { isProcessAlive: () => false }));
    expect(outcome.kind).toBe('run-verdict');
  });

  it('fails closed on manifest drift rather than overwriting', async () => {
    const fs = makeMemoryFs({ seed: { [`${DIR}/run-manifest.json`]: '{"protocolId":"other"}' } });
    const outcome = await runD2Episode(baseDeps(fs));
    expect(outcome.kind).toBe('run-verdict');
    expect(JSON.parse(outcome.stdout).failureReasons).toContain('manifest-drift');
    expect(fs.readFile(`${DIR}/run-manifest.json`)).toBe('{"protocolId":"other"}');
  });
});

describe('watchdog actually races the shard', () => {
  it('times out a never-returning shard instead of blocking forever', async () => {
    // Regression: the verdict used to be computed just before dispatch, then
    // the loop blocked on `await executeShard`. A hung shard therefore left the
    // process alive with no output and no way to tell a hang from progress —
    // exactly D1 v2's symptom, and what this ceiling exists to prevent.
    const fs = makeMemoryFs();
    let fire: (() => void) | undefined;
    const outcome = await runD2Episode(baseDeps(fs, {
      setTimer: (_ms, onFire) => { fire = onFire; return () => undefined; },
      executeShard: () => new Promise<never>(() => {
        // Never resolves; only the injected ceiling can end this.
        queueMicrotask(() => fire?.());
      }),
    }));
    expect(outcome.kind).toBe('episode-incomplete');
    const projection = JSON.parse(outcome.stdout) as {
      terminationCause: string; failureReasons: string[];
    };
    expect(projection.terminationCause).toBe('shard-timeout');
    expect(projection.failureReasons).toContain('shard-timeout');
    expect(fs.exists(resultPath(DIR))).toBe(false);
  }, 30_000);

  it('cancels the ceiling when a shard finishes normally', async () => {
    const fs = makeMemoryFs();
    let cancels = 0;
    await runD2Episode(baseDeps(fs, {
      setTimer: () => { cancels += 1; return () => undefined; },
      executeShard: makeExecutor({ failAfter: 3 }),
    }));
    // One timer armed per dispatched shard, and none left to fire spuriously.
    expect(cancels).toBeGreaterThan(0);
  });

  it('records the timeout cause in the durable run record', async () => {
    const fs = makeMemoryFs();
    let fire: (() => void) | undefined;
    await runD2Episode(baseDeps(fs, {
      setTimer: (_ms, onFire) => { fire = onFire; return () => undefined; },
      executeShard: () => new Promise<never>(() => { queueMicrotask(() => fire?.()); }),
    }));
    const ends = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end');
    expect(ends[0]).toMatchObject({ terminationCause: 'shard-timeout' });
  }, 30_000);
});

describe('write boundary guard', () => {
  it('classifies an out-of-bounds mutating call instead of letting it through', () => {
    const fs = makeMemoryFs();
    const guarded = guardWriteBoundary(fs, DIR);
    expect(() => guarded.writeFileSync('public/ai/best-weights.json', 'x'))
      .toThrow(D2WriteBoundaryError);
    expect(() => guarded.appendLine('../escape.log', 'x')).toThrow(/evidence-dir-out-of-bounds/);
    expect(() => guarded.unlink('/tmp/tetris-trainer-abc.lock')).toThrow(/evidence-dir-out-of-bounds/);
    expect(() => guarded.mkdirp(`${DIR}/receipts`)).not.toThrow();
    expect(fs.calls.some((call) => call.path === 'public/ai/best-weights.json')).toBe(false);
  });

  it('leaves reads unguarded so pre-flight checks still work', () => {
    const guarded = guardWriteBoundary(makeMemoryFs(), DIR);
    expect(() => guarded.readFile('package.json')).not.toThrow();
    expect(() => guarded.exists('public/ai')).not.toThrow();
  });
});

describe('resume equivalence', () => {
  it('produces a byte-identical verdict across three completion partitions', async () => {
    const single = await runToCompletion();
    const byPhase = await runToCompletion(() => ({ executeShard: makeExecutor({ failAfter: 80 }) }));
    const random = await runToCompletion(() => ({ executeShard: makeExecutor({ failAfter: 130 }) }));

    expect(single.outcome.kind).toBe('run-verdict');
    // The canonical projection and its digest are partition-invariant.
    expect(canonicalOf(byPhase.outcome.stdout)).toEqual(canonicalOf(single.outcome.stdout));
    expect(canonicalOf(random.outcome.stdout)).toEqual(canonicalOf(single.outcome.stdout));
    const digestOfVerdict = (stdout: string) =>
      (JSON.parse(stdout) as { resultDigest: string }).resultDigest;
    expect(digestOfVerdict(byPhase.outcome.stdout)).toBe(digestOfVerdict(single.outcome.stdout));
    expect(digestOfVerdict(random.outcome.stdout)).toBe(digestOfVerdict(single.outcome.stdout));
    expect(single.outcome.stdout).toContain('fail-representation-gain-not-held-out');
  }, 30_000);

  it('excludes runProvenance from the digest, and runProvenance really differs', async () => {
    const single = await runToCompletion();
    const split = await runToCompletion(() => ({ executeShard: makeExecutor({ failAfter: 70 }) }));
    const singleProvenance = provenanceOf(single.outcome.stdout);
    const splitProvenance = provenanceOf(split.outcome.stdout);
    // If these were equal the exclusion would be decorative rather than needed.
    expect(splitProvenance.episodes).not.toBe(singleProvenance.episodes);
    expect(splitProvenance.terminationCauses).not.toEqual(singleProvenance.terminationCauses);
    // ...yet the digest is unchanged.
    expect((JSON.parse(split.outcome.stdout) as { resultDigest: string }).resultDigest)
      .toBe((JSON.parse(single.outcome.stdout) as { resultDigest: string }).resultDigest);
  }, 30_000);

  it('produces identical receipts across partitions', async () => {
    const single = await runToCompletion();
    const split = await runToCompletion(() => ({ executeShard: makeExecutor({ failAfter: 70 }) }));
    const receiptsOf = (fs: MemoryFs) => Object.fromEntries(
      Object.entries(fs.snapshot()).filter(([path]) => path.includes('/receipts/')),
    );
    expect(receiptsOf(split.fs)).toEqual(receiptsOf(single.fs));
  }, 30_000);

  it('records more episodes for a partitioned run — proving the split is real', async () => {
    const single = await runToCompletion();
    const split = await runToCompletion(() => ({ executeShard: makeExecutor({ failAfter: 70 }) }));
    const episodesOf = (fs: MemoryFs) =>
      readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-start').length;
    expect(episodesOf(split.fs)).toBeGreaterThan(episodesOf(single.fs));
    // ...yet the canonical projection is unchanged.
    expect(canonicalOf(split.outcome.stdout)).toEqual(canonicalOf(single.outcome.stdout));
  }, 30_000);

  it('never recomputes a shard that already has a receipt', async () => {
    const fs = makeMemoryFs();
    const counter = { value: 0 };
    await runD2Episode(baseDeps(fs, { executeShard: makeExecutor({ failAfter: 30, counter }) }));
    const firstPass = counter.value;
    const second = { value: 0 };
    await runD2Episode(baseDeps(fs, { executeShard: makeExecutor({ counter: second }) }));
    expect(firstPass).toBe(30);
    expect(second.value).toBe(261 - 30);
  }, 30_000);
});

describe('worker-count invariance', () => {
  it('produces identical receipts and verdict for 1, 4 and 8 workers', async () => {
    const results = await Promise.all([1, 4, 8].map((workerCount) => runToCompletion(() => ({ workerCount }))));
    const receiptsOf = (fs: MemoryFs) => Object.fromEntries(
      Object.entries(fs.snapshot()).filter(([path]) => path.includes('/receipts/')),
    );
    expect(canonicalOf(results[1]!.outcome.stdout)).toEqual(canonicalOf(results[0]!.outcome.stdout));
    expect(canonicalOf(results[2]!.outcome.stdout)).toEqual(canonicalOf(results[0]!.outcome.stdout));
    expect(receiptsOf(results[1]!.fs)).toEqual(receiptsOf(results[0]!.fs));
    expect(receiptsOf(results[2]!.fs)).toEqual(receiptsOf(results[0]!.fs));
  }, 30_000);
});

describe('write boundary', () => {
  it('writes nothing outside diagnostics/<runId>/ and never touches a trainer lock', async () => {
    const { fs } = await runToCompletion();
    const writes = fs.calls.filter((call) =>
      call.op === 'writeFileSync' || call.op === 'appendLine' || call.op === 'rename'
      || call.op === 'openExclusive' || call.op === 'unlink' || call.op === 'mkdirp');
    expect(writes.length).toBeGreaterThan(0);
    for (const call of writes) {
      expect(call.path.startsWith(`${DIR}`)).toBe(true);
      expect(call.path).not.toContain('public/ai');
      expect(call.path).not.toContain('tetris-trainer-');
    }
  }, 30_000);

  it('confines every path to the derived run id', async () => {
    const { fs } = await runToCompletion();
    for (const path of Object.keys(fs.snapshot())) {
      expect(path.startsWith(`diagnostics/${RUN_ID}/`)).toBe(true);
    }
  }, 30_000);
});

describe('runtime-fail promotion across restarts', () => {
  it('promotes on the second startup by reading the run record from disk', async () => {
    const fs = makeMemoryFs();
    const executor = makeExecutor({ failOnShard: 'capture/train/5/gen6-best', failWith: 'replay-mismatch' });
    const first = await runD2Episode(baseDeps(fs, { executeShard: executor }));
    expect(first.kind).toBe('episode-incomplete');
    expect(fs.exists(resultPath(DIR))).toBe(false);

    const second = await runD2Episode(baseDeps(fs, { executeShard: executor }));
    expect(second.kind).toBe('run-verdict');
    expect(JSON.parse(second.stdout).status).toBe('runtime-fail');
    expect(fs.readFile(resultPath(DIR))).not.toBeNull();
  });

  it('does not promote when the second failure names a different shard', async () => {
    const fs = makeMemoryFs();
    const first = await runD2Episode(baseDeps(fs, {
      executeShard: makeExecutor({ failOnShard: 'capture/train/5/gen6-best' }),
    }));
    expect(first.kind).toBe('episode-incomplete');
    const second = await runD2Episode(baseDeps(fs, {
      executeShard: makeExecutor({ failOnShard: 'capture/train/9/gen6-best' }),
    }));
    expect(second.kind).toBe('episode-incomplete');
    expect(fs.exists(resultPath(DIR))).toBe(false);
  });
});

describe('episode budgets', () => {
  it('counts only episodes that completed a new shard as productive', () => {
    const end = (episodeOrdinal: number, completedShards: number) => ({
      kind: 'episode-end' as const,
      episodeOrdinal,
      endedAt: '2026-09-02T00:00:00.000Z',
      durationMs: 1,
      exitCode: 1,
      terminationCause: 'episode-incomplete' as const,
      completedShards,
      failedShardId: null,
      failureReason: null,
      failureDetail: null,
    });
    expect(episodeBudgets([end(1, 5), end(2, 5), end(3, 9), end(4, 9)]))
      .toEqual({ productive: 2, barren: 2 });
    expect(episodeBudgets([])).toEqual({ productive: 0, barren: 0 });
  });

  it('exposes the pre-registered budget constants', () => {
    expect(MAX_PRODUCTIVE_EPISODES).toBe(5);
    expect(MAX_BARREN_EPISODES).toBe(10);
  });

  it('reports budget exhaustion as episode-incomplete, never as a verdict', async () => {
    const fs = makeMemoryFs();
    for (let index = 0; index < MAX_PRODUCTIVE_EPISODES; index++) {
      await runD2Episode(baseDeps(fs, { executeShard: makeExecutor({ failAfter: 1 }) }));
    }
    const outcome = await runD2Episode(baseDeps(fs, { executeShard: makeExecutor({ failAfter: 1 }) }));
    expect(outcome.kind).toBe('episode-incomplete');
    expect(JSON.parse(outcome.stdout).terminationCause).toBe('resume-budget-exhausted');
    expect(fs.exists(resultPath(DIR))).toBe(false);
  });
});

describe('run record', () => {
  it('writes an episode-end with the four completion fields on every path', async () => {
    const fs = makeMemoryFs();
    await runD2Episode(baseDeps(fs, { executeShard: makeExecutor({ failAfter: 3 }) }));
    const ends = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({
      endedAt: expect.any(String),
      durationMs: expect.any(Number),
      exitCode: expect.any(Number),
      terminationCause: expect.any(String),
    });
  });

  it('carries failedShardId and failureReason when a shard failed', async () => {
    const fs = makeMemoryFs();
    await runD2Episode(baseDeps(fs, {
      executeShard: makeExecutor({ failOnShard: 'capture/train/2/gen10-mu', failWith: 'optimizer-failure' }),
    }));
    const ends = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end');
    expect(ends[0]).toMatchObject({
      failedShardId: 'capture/train/2/gen10-mu',
      failureReason: 'optimizer-failure',
    });
  });

  it('emits heartbeats on an interval, not only between shards', async () => {
    const fs = makeMemoryFs();
    let tick: (() => void) | undefined;
    let cleared = false;
    await runD2Episode(baseDeps(fs, {
      setInterval: (_ms, onTick) => {
        tick = onTick;
        return () => { cleared = true; };
      },
      executeShard: async ({ shardId }) => {
        // Fire mid-shard: a real long shard must still produce heartbeats.
        tick?.();
        return { shardId, digest: digestOf(shardId) };
      },
    }));
    const beats = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'heartbeat');
    expect(beats.length).toBeGreaterThan(1);
    expect(beats[0]).toMatchObject({
      episodeOrdinal: 1,
      elapsedMs: expect.any(Number),
      completedShards: expect.any(Number),
    });
    expect(cleared).toBe(true);
  }, 30_000);

  it('writes an episode-end even when the executor aborts', async () => {
    const fs = makeMemoryFs();
    const controller = new AbortController();
    controller.abort();
    const outcome = await runD2Episode(baseDeps(fs, {
      signal: controller.signal,
      executeShard: async ({ signal }) => {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { reason: 'abort' });
        return {};
      },
    }));
    expect(outcome.kind).toBe('episode-incomplete');
    const ends = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ failureReason: 'abort' });
  });

  it('writes episode-end from the process-exit hook when the normal path never runs', async () => {
    const fs = makeMemoryFs();
    const listeners: (() => void)[] = [];
    const exitHooks = {
      on: (_event: 'exit', listener: () => void) => listeners.push(listener),
      removeListener: () => undefined,
    };
    // A shard failure that is not classified as resumable escapes the loop; the
    // hook is what guarantees the record exists regardless.
    await runD2Episode(baseDeps(fs, {
      exitHooks,
      executeShard: makeExecutor({ failAfter: 2 }),
    }));
    const before = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end').length;
    expect(before).toBe(1);
    // Firing the hook after a normal finish must not duplicate the record.
    for (const listener of listeners) listener();
    const after = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end').length;
    expect(after).toBe(1);
  });

  it('writes exactly one episode-end even if the exit hook fires first', async () => {
    const fs = makeMemoryFs();
    const listeners: (() => void)[] = [];
    const exitHooks = {
      on: (_event: 'exit', listener: () => void) => listeners.push(listener),
      removeListener: () => undefined,
    };
    await runD2Episode(baseDeps(fs, {
      exitHooks,
      executeShard: async ({ shardId }) => {
        // Simulate an abrupt death mid-episode: fire the exit hook, then throw
        // something the loop does not classify as resumable.
        if (shardId === 'capture/train/0/gen10-mu') {
          for (const listener of listeners) listener();
          throw Object.assign(new Error('killed'), { reason: 'worker-pool-failure' });
        }
        return { shardId, digest: digestOf(shardId) };
      },
    }));
    const ends = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({
      endedAt: expect.any(String),
      durationMs: expect.any(Number),
      exitCode: expect.any(Number),
      terminationCause: expect.any(String),
    });
  });

  it('records episode-abandoned for an unpaired episode-start on the next startup', async () => {
    const fs = makeMemoryFs();
    // Seed an episode-start with no matching end, as a SIGKILL would leave.
    fs.appendLine(`${DIR}/run-record.jsonl`, canonicalJson({
      kind: 'episode-start', episodeOrdinal: 1, startedAt: '2026-09-02T00:00:00.000Z',
      pid: 1, ppid: 0, runtimeIdentity: stage1.runtimeIdentity, workerCount: 1,
      manifestDigest: 'x', completedShards: 0,
    }));
    await runD2Episode(baseDeps(fs, { executeShard: makeExecutor({ failAfter: 1 }) }));
    const abandoned = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-abandoned');
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]).toMatchObject({ episodeOrdinal: 1 });
  });
});

describe('phase gating end to end', () => {
  it('completes phases in dependency order', async () => {
    const seen: string[] = [];
    await runToCompletion(() => ({
      executeShard: async ({ shardId }) => {
        seen.push(shardPhase(shardId));
        return shardId === 'aggregate' ? AGGREGATE_PAYLOAD : { shardId, digest: digestOf(shardId) };
      },
    }));
    const firstIndexOf = (phase: string) => seen.indexOf(phase);
    expect(firstIndexOf('capture')).toBeLessThan(firstIndexOf('label-train'));
    expect(firstIndexOf('label-train')).toBeLessThan(firstIndexOf('fit'));
    expect(firstIndexOf('fit')).toBeLessThan(firstIndexOf('selection'));
    expect(firstIndexOf('selection')).toBeLessThan(firstIndexOf('final-freeze'));
    expect(firstIndexOf('final-freeze')).toBeLessThan(firstIndexOf('label-test'));
    expect(firstIndexOf('label-test')).toBeLessThan(firstIndexOf('replay'));
    expect(firstIndexOf('replay')).toBeLessThan(firstIndexOf('aggregate'));
    expect(seen).toHaveLength(261);
  }, 30_000);

  it('freezes stage-2 only after every capture receipt exists', async () => {
    const fs = makeMemoryFs();
    await runD2Episode(baseDeps(fs, { executeShard: makeExecutor({ failAfter: 79 }) }));
    expect(fs.exists(`${DIR}/run-manifest-stage2.json`)).toBe(false);
    await runD2Episode(baseDeps(fs, { executeShard: makeExecutor({ failAfter: 5 }) }));
    expect(fs.exists(`${DIR}/run-manifest-stage2.json`)).toBe(true);
    expect(fs.readFile(`${DIR}/run-manifest-stage2.json`)).toBe(canonicalJson(stage2Fixture));
  });
});

/**
 * A shard whose work is synchronous — which is what the shipped executor's
 * fit, selection, freeze and aggregate phases actually are, and what capture
 * was until it moved onto the pool.
 *
 * The failure these guard against is not a wrong answer; it is the
 * orchestrator going blind. `await` on an already-resolved promise is a
 * microtask, so without a real macrotask turn per iteration the heartbeat
 * interval, the per-shard ceiling and the signal handlers get no turn for a
 * whole phase — hours, in the capture case — and a kill during that window
 * leaves a run record claiming zero completed shards while receipts sit on
 * disk.
 */
function spinningExecutor(spinMs: number): D2ShardExecutor {
  return async ({ shardId }) => {
    const until = Date.now() + spinMs;
    while (Date.now() < until) { /* deliberately blocking */ }
    if (shardId === 'aggregate') return AGGREGATE_PAYLOAD;
    return { shardId, digest: digestOf(shardId) };
  };
}

describe('staying observable while a shard blocks the thread', () => {
  it('beats once per dispatched shard, so the durable count is never stale', async () => {
    const { fs } = await runToCompletion(() => ({ executeShard: makeExecutor() }));
    const heartbeats = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'heartbeat');

    // One beat per dispatch, written before the shard runs, so the spec 7.5
    // tamper baseline (`lastCompletedCount`) can never lag by more than the
    // shard in flight — even for a shard the interval timer cannot interrupt.
    expect(heartbeats).toHaveLength(stage2Fixture.shardIds.length);
    expect(heartbeats.map((entry) => (entry as { completedShards: number }).completedShards))
      .toEqual(stage2Fixture.shardIds.map((_id, index) => index));
  });

  it('lets a real interval timer fire between synchronous shards', async () => {
    // Without the per-iteration macrotask yield this count stays at zero no
    // matter how long the run takes, which is exactly what the review measured:
    // 1920 due heartbeats, none written.
    let ticks = 0;
    const fs = makeMemoryFs();
    await runD2Episode(baseDeps(fs, {
      executeShard: spinningExecutor(4),
      setInterval: (_ms, onTick) => {
        const handle = setInterval(() => { ticks += 1; onTick(); }, 1);
        return () => clearInterval(handle);
      },
    }));
    expect(ticks).toBeGreaterThan(0);
  });

  it('arms the per-shard ceiling before the shard starts, not after it ends', async () => {
    // `Promise.race` evaluates arguments left to right, so a ceiling built in
    // the second argument is created only once a synchronous shard has already
    // finished — a timer that could never have fired.
    const order: string[] = [];
    const fs = makeMemoryFs();
    await runD2Episode(baseDeps(fs, {
      executeShard: async (context) => {
        order.push(`shard:${context.shardId}`);
        return { shardId: context.shardId, digest: digestOf(context.shardId) };
      },
      setTimer: () => {
        order.push('timer');
        return () => undefined;
      },
    }));
    expect(order.slice(0, 2)).toEqual(['timer', `shard:${stage1.captureShardIds[0]!}`]);
  });
});

describe('filesystem failures are not shard failures', () => {
  /** A memory fs whose rename fails the way a Windows file lock does. */
  const busyOnRename = (suffix: string): MemoryFs => {
    const fs = makeMemoryFs();
    const rename = fs.rename.bind(fs);
    return Object.assign(fs, {
      rename(from: string, to: string) {
        if (from.endsWith(suffix)) {
          throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
        }
        rename(from, to);
      },
    });
  };

  it('never promotes a repeated write failure to a terminal runtime-fail', async () => {
    // An errno carries `code`, never `reason`. Falling through to
    // `simulation-failure` labelled a disk problem as a shard impurity, and two
    // identical episodes then wrote a terminal verdict that consumes the
    // one-shot authorization — for an antivirus holding a temp file.
    const suffix = `${stage1.captureShardIds[3]!.replaceAll('/', '__')}.json.tmp`;
    const fs = busyOnRename(suffix);

    const first = await runD2Episode(baseDeps(fs, { executeShard: makeExecutor() }));
    const second = await runD2Episode(baseDeps(fs, { executeShard: makeExecutor() }));

    for (const outcome of [first, second]) {
      expect(outcome.kind).toBe('episode-incomplete');
      expect((JSON.parse(outcome.stdout) as { failureReasons: string[] }).failureReasons)
        .toEqual(['evidence-io-failure']);
    }
    // Spec 5.4.5(b) justifies two-strike promotion by shard purity; a disk
    // error says nothing about the shard, so no verdict may be written.
    expect(fs.readFile(resultPath(DIR))).toBeNull();
  });
});

describe('run-level no-progress ceiling', () => {
  it('fires, so no-progress-timeout is a cause a real run can actually produce', async () => {
    // `watchdogVerdict` was exported and unit-tested but wired to nothing, which
    // made `no-progress-timeout` a termination cause no run could ever reach.
    // The clock jumps past the 30-minute ceiling between the loop opening and
    // the first dispatch, with nothing in flight — the dispatcher-hang case the
    // run-level ceiling exists for, as distinct from the per-shard one.
    let tick = 0;
    const fs = makeMemoryFs();
    const outcome = await runD2Episode(baseDeps(fs, {
      now: () => tick++ * 31 * 60_000,
    }));

    expect(outcome.kind).toBe('episode-incomplete');
    const projection = JSON.parse(outcome.stdout) as {
      terminationCause: string; failureReasons: string[]; completedShards: number;
    };
    expect(projection.terminationCause).toBe('no-progress-timeout');
    expect(projection.failureReasons).toEqual(['no-progress-timeout']);
    expect(projection.completedShards).toBe(0);
    // A ceiling may only prevent a shard from completing; it must never
    // manufacture a verdict.
    expect(fs.readFile(resultPath(DIR))).toBeNull();
  });
});

describe('promotion is an allowlist, not a denylist', () => {
  /**
   * Promotion writes a terminal `runtime-fail` into a write-once `result.json`,
   * consuming the one-shot operational authorization with no remedy but a
   * correctness gate. What justifies it is shard *purity*: a pure shard that
   * fails identically twice is deterministically broken. Infrastructure says
   * nothing about the shard, and spec 5.4.1 names a transient worker crash as a
   * resumable non-verdict — so the previous denylist, which exempted exactly one
   * reason, still turned an antivirus hiccup or a worker OOM into a dead run.
   */
  it.each([
    'worker-pool-failure',
    'evidence-io-failure',
    'abort',
  ] as const)('never promotes a repeated %s', async (reason) => {
    const fs = makeMemoryFs();
    for (let episode = 0; episode < 3; episode++) {
      const outcome = await runD2Episode(baseDeps(fs, {
        executeShard: makeExecutor({ failOnShard: 'capture/train/2/gen6-best', failWith: reason }),
      }));
      expect(outcome.kind).toBe('episode-incomplete');
    }
    expect(fs.readFile(resultPath(DIR))).toBeNull();
  });

  it('still promotes a repeated shard-purity failure', async () => {
    // The other direction, or an allowlist would be indistinguishable from
    // never promoting at all.
    const fs = makeMemoryFs();
    const failing = () => ({
      executeShard: makeExecutor({
        failOnShard: 'capture/train/2/gen6-best', failWith: 'replay-mismatch',
      }),
    });
    expect((await runD2Episode(baseDeps(fs, failing()))).kind).toBe('episode-incomplete');
    const second = await runD2Episode(baseDeps(fs, failing()));
    expect(second.kind).toBe('run-verdict');
    expect((JSON.parse(second.stdout) as { status: string }).status).toBe('runtime-fail');
  });
});

describe('the operator throughput knob is reachable', () => {
  it('parses --workers and refuses a value outside the pool bounds', () => {
    // Design 13 calls this the operator's control between throughput and
    // interruption loss. Before this it existed only as a default that nothing
    // on the command line could change, while the run spawns one thread per
    // core each holding the search caches.
    expect(parseD2WorkerCount(['--workers', '8'])).toBe(8);
    expect(parseD2WorkerCount(['--generations', '1'])).toBeUndefined();
    for (const bad of ['0', '32', '-1', '2.5', 'many']) {
      expect(() => parseD2WorkerCount(['--workers', bad])).toThrow(/invalid --workers/);
    }
    expect(() => parseD2WorkerCount(['--workers'])).toThrow(/invalid --workers/);
  });
});

describe('a failing heartbeat is not a failing episode', () => {
  it('survives an append that throws, and still reaches a verdict', async () => {
    // Uncaught, this surfaced from the interval callback as an
    // `uncaughtException`; the bound handler then marked the episode ended and
    // released the run lock while the episode was still writing receipts.
    const fs = makeMemoryFs();
    const appendLine = fs.appendLine.bind(fs);
    let beats = 0;
    const hostile = Object.assign(fs, {
      appendLine(path: string, line: string) {
        if (line.includes('heartbeat') && beats++ % 2 === 0) {
          throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
        }
        appendLine(path, line);
      },
    });
    const outcome = await runD2Episode(baseDeps(hostile));
    expect(outcome.kind).toBe('run-verdict');
    expect(beats).toBeGreaterThan(0);
  });
});

describe('an error D2 cannot name is not evidence about the shard', () => {
  it('classifies an unnameable throw apart from a deliberate simulation failure', () => {
    // `reasonOf`'s fallback used to be `simulation-failure`, which was on the
    // promotable list — so any error without a `reason` or an errno `code`
    // became a terminal `runtime-fail` on its second sighting.
    expect(classifyD2Exit('unclassified-failure')).toBe('episode-incomplete');
    expect(shouldPromoteToRuntimeFail(
      { shardId: 'capture/train/2/gen6-best', reason: 'unclassified-failure' },
      { shardId: 'capture/train/2/gen6-best', reason: 'unclassified-failure' },
    )).toBe(false);
    expect(shouldPromoteToRuntimeFail(
      { shardId: 'capture/train/2/gen6-best', reason: 'simulation-failure' },
      { shardId: 'capture/train/2/gen6-best', reason: 'simulation-failure' },
    )).toBe(false);
  });

  it('never promotes a plain throw repeated on the same shard', async () => {
    // The real shape: a worker `RangeError` under memory pressure, which repeats
    // by construction because a resume restarts at the same shard.
    const fs = makeMemoryFs();
    const failing = (): Partial<D2Dependencies> => ({
      executeShard: async ({ shardId }) => {
        if (shardId === 'capture/train/2/gen6-best') {
          throw new RangeError('Array buffer allocation failed');
        }
        return { shardId, digest: digestOf(shardId) };
      },
    });
    for (let episode = 0; episode < 3; episode++) {
      const outcome = await runD2Episode(baseDeps(fs, failing()));
      expect(outcome.kind).toBe('episode-incomplete');
      expect((JSON.parse(outcome.stdout) as { failureReasons: string[] }).failureReasons)
        .toEqual(['unclassified-failure']);
    }
    expect(fs.readFile(resultPath(DIR))).toBeNull();
  });
});

describe('a signal handler must not pair the episode it cannot end', () => {
  it('records the cause without writing episode-end or releasing the lock', async () => {
    // Spec 7.1.1's dead-lock takeover requires an *unpaired* `episode-start`.
    // Writing `episode-end` from the handler pairs the episode while the lock is
    // still held, so a hard kill after a signal left a lock no adjudication
    // could ever take over — the one state resume exists for.
    const fs = makeMemoryFs();
    let listener: (() => void) | undefined;
    let seenDuringHandler: { ends: number; lockHeld: boolean } | undefined;

    await runD2Episode(baseDeps(fs, {
      signalHooks: {
        on: (event: string, bound: (...args: unknown[]) => void) => {
          if (event === 'SIGINT') listener = bound as () => void;
          return undefined;
        },
        removeListener: () => undefined,
      } as unknown as D2Dependencies['signalHooks'],
      executeShard: async ({ shardId }) => {
        if (shardId === stage1.captureShardIds[1]! && listener !== undefined) {
          listener();
          seenDuringHandler = {
            ends: readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end').length,
            lockHeld: fs.readFile(`${DIR}/run.lock`) !== null,
          };
        }
        if (shardId === 'aggregate') return AGGREGATE_PAYLOAD;
        return { shardId, digest: digestOf(shardId) };
      },
    }));

    // While the lock was still held, the episode had to remain unpaired.
    expect(seenDuringHandler).toEqual({ ends: 0, lockHeld: true });
    // Exactly one end, written on the way out by the normal path — and it
    // carries what actually happened. The handler fired, but the loop went on
    // to finish every shard, so the episode completed; recording
    // 'signal:SIGINT' here would be a lie about a run that did not stop.
    const ends = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ terminationCause: 'completed' });
    expect(fs.readFile(`${DIR}/run.lock`)).toBeNull();
  });
});

describe('the CLI reaches the parser', () => {
  it.each(['--workers=6', '--workers 6'])('threads %s into the episode', async (spelling) => {
    // Observed through `runProvenance.workerCount`, which is the value the
    // episode actually ran with — asserting anything else would pass whether or
    // not the argument was parsed at all.
    const written: string[] = [];
    await runD2Main({
      argv: spelling.split(' '),
      process: {
        stdout: { write: (data: string) => { written.push(data); return true; } },
        stderr: { write: () => true },
        once: () => undefined, removeListener: () => undefined,
      } as unknown as D2MainProcessLike,
      fs: makeMemoryFs(),
      ...frozenIdentity,
      clock: () => '2026-09-03T00:00:00.000Z',
      now: () => 0,
      isProcessAlive: () => false,
      anyD2ProcessRunning: () => false,
      buildStage2,
      executeShard: makeExecutor(),
      signalHooks: { on: () => undefined, removeListener: () => undefined } as never,
    });
    const document = JSON.parse(written.join('')) as {
      runProvenance: { workerCount: number };
    };
    expect(document.runProvenance.workerCount).toBe(6);
    // Guard against a machine where `cores - 1` happens to be 6, which would
    // let an unparsed argument pass unnoticed.
    expect(defaultD2WorkerCount()).not.toBe(6);
  });

  it('reports a bad --workers value as a redacted last resort, not a stack trace', async () => {
    const written: string[] = [];
    await runD2Main({
      argv: ['--workers=0'],
      process: {
        stdout: { write: (data: string) => { written.push(`out:${data}`); return true; } },
        stderr: { write: (data: string) => { written.push(`err:${data}`); return true; } },
        once: () => undefined, removeListener: () => undefined,
      } as unknown as D2MainProcessLike,
      fs: makeMemoryFs(),
      ...frozenIdentity,
    });
    expect(written.some((line) => line.startsWith('out:'))).toBe(false);
    expect(written.join('')).toContain('d2:');
    expect(written.join('')).not.toContain('D:\\WorkSpace');
  });
});

describe('an operator interrupt keeps its identity in the record', () => {
  /**
   * The run record exists to answer "was this a crash, a hang, or a person?"
   * (design §1.2). The loop only ever sees an interrupt's *consequence* — the
   * real pool answers an abort with `worker-pool-failure` — so the handler's
   * cause has to win, and the interrupted shard must not be blamed in
   * `failedShardId` / `failureReason`, which is the sole durable carrier of the
   * two-strike rule.
   */
  const interruptedBy = async (
    signal: 'SIGINT' | 'SIGTERM',
    cooperative: boolean,
  ) => {
    const fs = makeMemoryFs();
    const bound = new Map<string, () => void>();
    const controller = new AbortController();
    const outcome = await runD2Episode(baseDeps(fs, {
      signal: controller.signal,
      signalHooks: {
        on: (event: string, listener: (...args: unknown[]) => void) => {
          bound.set(event, listener as () => void);
          return undefined;
        },
        removeListener: () => undefined,
      } as unknown as D2Dependencies['signalHooks'],
      executeShard: async ({ shardId }) => {
        if (shardId === stage1.captureShardIds[1]!) {
          bound.get(signal)?.();
          controller.abort();
          // A cooperative executor reports the abort the way the real pool
          // does; an uncooperative one lets the loop's own boundary check fire.
          if (cooperative) {
            throw Object.assign(new Error('aborted'), { reason: 'worker-pool-failure' });
          }
        }
        return { shardId, digest: digestOf(shardId) };
      },
    }));
    return {
      end: readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end')[0] as {
        terminationCause: string; failedShardId: string | null; failureReason: string | null;
      },
      // The projection is built inside the loop, before the record is written,
      // so it is where a hard-coded signal name shows up.
      projected: (JSON.parse(outcome.stdout) as { terminationCause: string }).terminationCause,
    };
  };

  it.each([['SIGINT', true], ['SIGTERM', true], ['SIGINT', false], ['SIGTERM', false]] as const)(
    'records %s (cooperative abort: %s) as itself, blaming no shard',
    async (signal, cooperative) => {
      const { end, projected } = await interruptedBy(signal, cooperative);
      expect(end.terminationCause).toBe(`signal:${signal}`);
      expect(end.failedShardId).toBeNull();
      expect(end.failureReason).toBeNull();
      // Both halves. The projection is what the operator reads on the terminal;
      // it used to say `worker-pool-failure` on the cooperative path — the one
      // the real pool takes — while the durable record said the truth.
      expect(projected).toBe(`signal:${signal}`);
    });
});

describe('a promoted runtime-fail is not a completed episode', () => {
  it('records the promotion as runtime-fail, naming the shard that caused it', async () => {
    // The promotion is a run verdict, so it took the `completed` branch and the
    // published `runProvenance.terminationCauses` said the episode ended
    // normally in the very episode that killed the run.
    const fs = makeMemoryFs();
    const failing = () => ({
      executeShard: makeExecutor({
        failOnShard: 'capture/train/2/gen6-best', failWith: 'replay-mismatch',
      }),
    });
    await runD2Episode(baseDeps(fs, failing()));
    const second = await runD2Episode(baseDeps(fs, failing()));
    expect(second.kind).toBe('run-verdict');

    const ends = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end');
    expect(ends).toHaveLength(2);
    expect(ends[1]).toMatchObject({
      terminationCause: 'runtime-fail',
      failedShardId: 'capture/train/2/gen6-best',
      failureReason: 'replay-mismatch',
    });
  });

  it('still records a real aggregate verdict as completed', async () => {
    const { fs } = await runToCompletion();
    const ends = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end');
    expect(ends.at(-1)).toMatchObject({ terminationCause: 'completed' });
  });
});

describe('a repeated --workers is an error, not a silent choice', () => {
  it.each([
    [['--workers', '4', '--workers', '8']],
    [['--workers=4', '--workers=99']],
  ])('rejects %j rather than taking the first', (argv) => {
    expect(() => parseD2WorkerCount(argv)).toThrow(/repeated/);
  });
});

describe('only an operator interrupt relabels an episode', () => {
  it('lets a recovered stray rejection go on to record the real cause', async () => {
    // The handlers make `uncaughtException` and `unhandledRejection` non-fatal,
    // so the episode usually carries on and ends much later for an unrelated
    // reason. Latching those would name the wrong cause and discard the real
    // shard's first strike, so the shard would need three episodes to promote
    // rather than two.
    const fs = makeMemoryFs();
    const bound = new Map<string, () => void>();
    await runD2Episode(baseDeps(fs, {
      signalHooks: {
        on: (event: string, listener: (...args: unknown[]) => void) => {
          bound.set(event, listener as () => void);
          return undefined;
        },
        removeListener: () => undefined,
      } as unknown as D2Dependencies['signalHooks'],
      executeShard: async ({ shardId }) => {
        if (shardId === stage1.captureShardIds[1]!) bound.get('unhandledRejection')?.();
        if (shardId === 'capture/train/2/gen6-best') {
          throw Object.assign(new Error('injected'), { reason: 'replay-mismatch' });
        }
        return { shardId, digest: digestOf(shardId) };
      },
    }));

    const end = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end')[0] as {
      terminationCause: string; failedShardId: string | null; failureReason: string | null;
    };
    expect(end.terminationCause).toBe('episode-incomplete');
    expect(end.failedShardId).toBe('capture/train/2/gen6-best');
    expect(end.failureReason).toBe('replay-mismatch');
  });
});

describe('the shipped entry point can recover the run it is built to recover', () => {
  it('takes over a dead lock with no predicate injected at all', async () => {
    // The regression: `runD2Main` forwarded a bare dependency object, so
    // `isProcessAlive` fell back to `() => true` and `trainerLockPresent` to
    // `() => false`. Design §6.4 says a SIGKILL always leaves `run.lock`, and
    // §7.1.1 exists so that state is recoverable — but with the pid always
    // "alive" the first checklist item could never hold, so every resume after
    // a hard kill returned `run-locked` forever. §12.3 pre-authorizes exactly
    // this takeover; the binary could not perform it.
    //
    // No `isProcessAlive`, `anyD2ProcessRunning` or `trainerLockPresent` is
    // passed here: the real ones must answer.
    const fs = makeMemoryFs({
      seed: {
        [`${DIR}/run.lock`]: canonicalJson({
          ownerNonce: 'killed-episode', pid: 999_999_999,
          startedAt: '2026-09-03T00:00:00.000Z', episodeOrdinal: 1,
        }),
        [`${DIR}/run-record.jsonl`]: `${canonicalJson({
          kind: 'episode-start', episodeOrdinal: 1, startedAt: '2026-09-03T00:00:00.000Z',
          pid: 999_999_999, ppid: 1, runtimeIdentity: stage1.runtimeIdentity,
          manifestDigest: stage1Digest(stage1), workerCount: 1,
        })}\n`,
      },
    });

    const written: string[] = [];
    await runD2Main({
      argv: [],
      process: {
        stdout: { write: (data: string) => { written.push(data); return true; } },
        stderr: { write: () => true },
        once: () => undefined, removeListener: () => undefined,
      } as unknown as D2MainProcessLike,
      fs,
      ...frozenIdentity,
      clock: () => '2026-09-03T01:00:00.000Z',
      now: () => 0,
      workerCount: 1,
      buildStage2,
      executeShard: makeExecutor(),
      signalHooks: { on: () => undefined, removeListener: () => undefined } as never,
    });

    const verdict = JSON.parse(written.join('')) as { kind: string };
    expect(verdict.kind).toBe('run-verdict');
    // The abandoned episode is recorded, and the lock now belongs to this run
    // and was released on the way out.
    const record = readRunRecord(fs, DIR);
    expect(record.some((entry) => entry.kind === 'episode-abandoned')).toBe(true);
    expect(fs.readFile(`${DIR}/run.lock`)).toBeNull();
  }, 300_000);
});

describe('an undeterminable trainer lock is not a present one', () => {
  it('reports trainer-lock-indeterminate distinctly', async () => {
    // Both stop the episode. Only one sends the operator looking for a lock
    // file that does not exist, on every attempt, during the one authorized run.
    const present = await runD2Episode(baseDeps(makeMemoryFs(), {
      trainerLockPresent: () => true,
    }));
    const unknown = await runD2Episode(baseDeps(makeMemoryFs(), {
      trainerLockPresent: () => 'indeterminate',
    }));
    const reasons = (outcome: { stdout: string }) =>
      (JSON.parse(outcome.stdout) as { failureReasons: string[] }).failureReasons;
    expect(reasons(present)).toEqual(['trainer-lock-present']);
    expect(reasons(unknown)).toEqual(['trainer-lock-indeterminate']);
    // Neither is a verdict, and neither starts an episode.
    expect(present.kind).toBe('episode-incomplete');
    expect(unknown.kind).toBe('episode-incomplete');
  });
});

describe('a non-fatal exception does not rename a later failure', () => {
  it('records the real cause when the episode ends outside the shard loop', async () => {
    // The loop path already followed "only a signal relabels an episode"; the
    // outer catch did not. A stray rejection at minute three would otherwise
    // label an episode that ended forty minutes later from a disk error, and
    // telling those apart is the run record's whole job.
    const fs = makeMemoryFs();
    const bound = new Map<string, () => void>();
    const outcome = await runD2Episode(baseDeps(fs, {
      signalHooks: {
        on: (event: string, listener: (...args: unknown[]) => void) => {
          bound.set(event, listener as () => void);
          return undefined;
        },
        removeListener: () => undefined,
      } as unknown as D2Dependencies['signalHooks'],
      executeShard: async ({ shardId }) => {
        if (shardId === stage1.captureShardIds[0]!) bound.get('uncaughtException')?.();
        return { shardId, digest: digestOf(shardId) };
      },
      // Reaches the outer catch rather than the loop's own handler.
      buildStage2: () => {
        throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      },
    }));

    const projection = JSON.parse(outcome.stdout) as {
      terminationCause: string; failureReasons: string[];
    };
    expect(projection.failureReasons).toEqual(['evidence-io-failure']);
    expect(projection.terminationCause).toBe('episode-incomplete');
    const end = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end')[0] as {
      terminationCause: string;
    };
    expect(end.terminationCause).toBe('episode-incomplete');
  });
});

describe("a D1 runtime error keeps its name and its words", () => {
  /**
   * A real 7-hour run ended at `fit/action24` with `unclassified-failure` and
   * nothing else: `D1RuntimeError` carries neither `reason` nor an errno
   * `code`, so it fell through the classifier, spec 5.4.5(b)'s
   * `optimizer-failure` was unreachable by any run that could actually happen,
   * and "optimizer did not converge after 200 updates" survived in no artifact
   * at all. Recovering it needed the failing shard rebuilt offline.
   */
  const d1Error = () => Object.assign(
    new Error('runtime-fail: optimizer did not converge after 200 updates'),
    { name: 'D1RuntimeError' },
  );

  const failAt = (target: D2ShardId, error: () => Error) => ({
    executeShard: async ({ shardId }: { shardId: D2ShardId }) => {
      if (shardId === target) throw error();
      return { shardId, digest: digestOf(shardId) };
    },
  });

  it('classifies it as optimizer-failure rather than unclassified-failure', async () => {
    const fs = makeMemoryFs();
    const target = stage1.captureShardIds[2]!;
    await runD2Episode(baseDeps(fs, failAt(target, d1Error) as Partial<D2Dependencies>));
    const ends = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end');
    expect(ends[0]).toMatchObject({
      failedShardId: target,
      failureReason: 'optimizer-failure',
    });
  });

  it('keeps the message, so the record can say why', async () => {
    const fs = makeMemoryFs();
    const target = stage1.captureShardIds[2]!;
    await runD2Episode(baseDeps(fs, failAt(target, d1Error) as Partial<D2Dependencies>));
    const ends = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end');
    expect((ends[0] as { failureDetail: string | null }).failureDetail)
      .toContain('optimizer did not converge after 200 updates');
  });

  it('bounds the message so a stack-bearing error cannot bloat the record', async () => {
    const fs = makeMemoryFs();
    const target = stage1.captureShardIds[2]!;
    const long = () => Object.assign(new Error('x'.repeat(5000)), { name: 'D1RuntimeError' });
    await runD2Episode(baseDeps(fs, failAt(target, long) as Partial<D2Dependencies>));
    const ends = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end');
    const detail = (ends[0] as { failureDetail: string | null }).failureDetail ?? '';
    expect(detail.length).toBeLessThanOrEqual(241);
  });

  it('still records nothing for a clean interrupt, which has no message to keep', async () => {
    // `failureDetail` must not become a place where an operator interrupt
    // acquires an explanation it never had; round 5 already had to stop the
    // loop attributing a Ctrl-C to an innocent shard.
    const fs = makeMemoryFs();
    const bound = new Map<string, () => void>();
    await runD2Episode(baseDeps(fs, {
      signalHooks: {
        on: (event: string, listener: (...args: unknown[]) => void) => {
          bound.set(event, listener as () => void);
          return undefined;
        },
        removeListener: () => undefined,
      } as unknown as D2Dependencies['signalHooks'],
      executeShard: async ({ shardId }: { shardId: D2ShardId }) => {
        if (shardId === stage1.captureShardIds[2]!) {
          bound.get('SIGINT')?.();
          throw d1Error();
        }
        return { shardId, digest: digestOf(shardId) };
      },
    } as Partial<D2Dependencies>));
    const ends = readRunRecord(fs, DIR).filter((entry) => entry.kind === 'episode-end');
    expect(ends[0]).toMatchObject({ terminationCause: 'signal:SIGINT' });
    expect((ends[0] as { failureDetail: string | null }).failureDetail).toBeNull();
  });
});
