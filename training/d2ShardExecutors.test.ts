import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyBoard } from '../src/engine/board';
import { createPiece } from '../src/engine/piece';
import { hashSeed } from '../src/ai/rng';
import { D2_PROFILE, type ListwiseProtocolProfile } from './d2Protocol';
import {
  D2ManifestError,
  buildD2Stage1Manifest,
  buildD2Stage2Manifest,
  canonicalJson,
  runIdFor,
} from './d2ShardManifest';
import {
  assertRebuildMatchesReceiptsForTest,
  createD2ShardExecutors,
  replayTaskFor,
  type D2ExecutorDependencies,
} from './d2ShardExecutors';
import type {
  D1ContextProjection,
  D1ContextTask,
  D1ContextTaskBatch,
} from './d1ActionConditionedHeldOutListwiseLabels';
import {
  D1_SOURCE_HASHES,
  D1_VECTOR_DIGESTS,
  type D1CapturedState,
  type D1FrozenSubset,
  type D1Sources,
  type D1Split,
  type D1VectorId,
} from './d1ActionConditionedHeldOutListwiseCore';
import {
  buildD2Receipt,
  evidenceDir,
  readRunRecord,
  receiptPath,
  resultPath,
  writeReceiptAtomic,
  type D2Receipt,
} from './d2Evidence';
import { grantD2PayloadCapability } from './d2Scheduler';
import {
  createDefaultExecutor,
  runD2Episode,
  type D2Dependencies,
  type D2Outcome,
  type D2ShardExecutionContext,
  type D2ShardExecutor,
} from './d2ShardedHeldOutListwise';
import { makeMemoryFs, type MemoryFs } from './d2TestUtils';

const VECTORS: readonly D1VectorId[] = ['gen6-best', 'gen10-mu'];
const SLOTS = [128, 512] as const;

function subsetFixture(
  split: D1Split,
  groupOrdinal: number,
  behaviorVectorId: D1VectorId,
  captureSlot: 128 | 512,
): D1FrozenSubset {
  const subsetId = `${split}|${groupOrdinal}|${behaviorVectorId}|${captureSlot}`;
  return {
    subsetId,
    capture: { split, groupOrdinal, behaviorVectorId, captureSlot } as unknown as D1CapturedState,
    legalCount: 3,
    selectedCount: 3,
    legalPlacementIds: ['a', 'b', 'c'],
    legalUniverseDigest: `lu-${subsetId}`,
    manifestDigest: `md-${subsetId}`,
    // Canonical order: the replay rule always takes the first entry.
    placements: [{ placementId: 'a' }, { placementId: 'b' }, { placementId: 'c' }],
  } as unknown as D1FrozenSubset;
}

/** Test split only; the replay endpoints live there. */
function testSubsets(): D1FrozenSubset[] {
  const subsets: D1FrozenSubset[] = [];
  for (let groupOrdinal = 0; groupOrdinal < 12; groupOrdinal++) {
    for (const vector of VECTORS) {
      for (const slot of SLOTS) subsets.push(subsetFixture('test', groupOrdinal, vector, slot));
    }
  }
  return subsets;
}

function batchFor(subsets: readonly D1FrozenSubset[]): D1ContextTaskBatch {
  const tasks: D1ContextTask[] = [];
  let taskId = 0;
  for (const subset of subsets) {
    for (const placementId of ['a', 'b', 'c']) {
      for (const continuationVectorId of VECTORS) {
        for (const streamIndex of [0, 1] as const) {
          tasks.push({
            taskId: taskId++,
            subsetId: subset.subsetId,
            placementId,
            continuationVectorId,
            streamIndex,
          } as unknown as D1ContextTask);
        }
      }
    }
  }
  return { tasks, evidence: {} as D1ContextTaskBatch['evidence'] };
}

describe('replay selection rule', () => {
  const subsets = testSubsets();
  const batch = batchFor(subsets);

  it('selects exactly 16 distinct contexts', () => {
    const selected = Array.from({ length: 16 }, (_, index) => replayTaskFor(batch, subsets, index));
    expect(new Set(selected.map((task) => task.taskId)).size).toBe(16);
  });

  it('uses only test group endpoints 0 and 11 — never the interior groups', () => {
    for (let index = 0; index < 16; index++) {
      const task = replayTaskFor(batch, subsets, index);
      const groupOrdinal = Number(task.subsetId.split('|')[1]);
      expect([0, 11]).toContain(groupOrdinal);
    }
  });

  it('always takes the canonical-first placement and stream 0', () => {
    for (let index = 0; index < 16; index++) {
      const task = replayTaskFor(batch, subsets, index);
      expect(task.placementId).toBe('a');
      expect(task.streamIndex).toBe(0);
    }
  });

  it('covers both behavior vectors, both capture slots and both continuation policies', () => {
    const selected = Array.from({ length: 16 }, (_, index) => replayTaskFor(batch, subsets, index));
    const vectors = new Set(selected.map((task) => task.subsetId.split('|')[2]));
    const slots = new Set(selected.map((task) => task.subsetId.split('|')[3]));
    const continuations = new Set(selected.map((task) => task.continuationVectorId));
    expect([...vectors].sort()).toEqual(['gen10-mu', 'gen6-best']);
    expect([...slots].sort()).toEqual(['128', '512']);
    expect([...continuations].sort()).toEqual(['gen10-mu', 'gen6-best']);
  });

  it('is stable: index N means the same context on every call', () => {
    for (let index = 0; index < 16; index++) {
      expect(replayTaskFor(batch, subsets, index).taskId)
        .toBe(replayTaskFor(batch, subsets, index).taskId);
    }
  });

  it('orders coordinates group, vector, slot, continuation', () => {
    const first = replayTaskFor(batch, subsets, 0);
    const second = replayTaskFor(batch, subsets, 1);
    expect(first.subsetId).toBe('test|0|gen6-best|128');
    expect(first.continuationVectorId).toBe('gen6-best');
    // Only the innermost coordinate advances first.
    expect(second.subsetId).toBe('test|0|gen6-best|128');
    expect(second.continuationVectorId).toBe('gen10-mu');
    expect(replayTaskFor(batch, subsets, 2).subsetId).toBe('test|0|gen6-best|512');
    expect(replayTaskFor(batch, subsets, 15).subsetId).toBe('test|11|gen10-mu|512');
  });

  it('rejects an out-of-range index', () => {
    expect(() => replayTaskFor(batch, subsets, 16)).toThrow(D2ManifestError);
    expect(() => replayTaskFor(batch, subsets, -1)).toThrow(D2ManifestError);
  });

  it('fails closed when an endpoint subset is missing', () => {
    const missing = subsets.filter(({ subsetId }) => subsetId !== 'test|11|gen10-mu|512');
    expect(() => replayTaskFor(batchFor(missing), missing, 15)).toThrow(/capture-missing-or-invalid/);
  });

  it('fails closed when the canonical-first placement has no matching task', () => {
    const strippedBatch: D1ContextTaskBatch = {
      tasks: batch.tasks.filter((task) => task.placementId !== 'a'),
      evidence: batch.evidence,
    };
    expect(() => replayTaskFor(strippedBatch, subsets, 0)).toThrow(/placement-manifest-mismatch/);
  });
});

describe('capture phase dispatch', () => {
  const sources = { vectors: [] } as unknown as D1Sources;
  const baseDeps = (over: Partial<D2ExecutorDependencies> = {}): D2ExecutorDependencies => ({
    runContexts: async () => [],
    runTrajectory: () => Promise.resolve([
      { captureSlot: 128 } as unknown as D1CapturedState,
      { captureSlot: 512 } as unknown as D1CapturedState,
    ]),
    loadSources: () => sources,
    profile: D2_PROFILE,
    ...over,
  });

  const captureContext = (shardId: string): D2ShardExecutionContext => ({
    shardId,
    phase: 'capture',
    stage1: {} as D2ShardExecutionContext['stage1'],
    stage2: null,
    profile: D2_PROFILE,
    capability: {} as D2ShardExecutionContext['capability'],
  });

  it('passes the pre-registered behavior seed for the shard coordinates', async () => {
    const runTrajectory = vi.fn<D2ExecutorDependencies['runTrajectory']>(() => Promise.resolve([
      { captureSlot: 128 } as unknown as D1CapturedState,
      { captureSlot: 512 } as unknown as D1CapturedState,
    ]));
    const execute = createD2ShardExecutors(baseDeps({ runTrajectory }));
    await execute(captureContext('capture/train/4/gen6-best'));
    expect(runTrajectory).toHaveBeenCalledTimes(1);
    expect(runTrajectory.mock.calls[0]![0]).toMatchObject({
      split: 'train',
      groupOrdinal: 4,
      behaviorVectorId: 'gen6-best',
      behaviorSeed: D2_PROFILE.behaviorSeeds.train[4],
    });
  });

  it('returns both capture slots as the receipt payload', async () => {
    const execute = createD2ShardExecutors(baseDeps());
    const payload = await execute(captureContext('capture/validation/7/gen10-mu'));
    expect(payload).toHaveLength(2);
  });

  it('fails closed when a trajectory yields the wrong number of slots', async () => {
    const execute = createD2ShardExecutors(baseDeps({
      runTrajectory: () => Promise.resolve([{ captureSlot: 128 } as unknown as D1CapturedState]),
    }));
    await expect(execute(captureContext('capture/train/0/gen6-best')))
      .rejects.toThrow(/capture-missing-or-invalid/);
  });

  it('fails closed on a group ordinal outside the frozen schedule', async () => {
    const execute = createD2ShardExecutors(baseDeps());
    await expect(execute(captureContext('capture/validation/99/gen6-best')))
      .rejects.toThrow(/capture-missing-or-invalid/);
  });

  it.each([
    'capture/bogus/0/gen6-best',
    'capture/train/0/gen99-mystery',
  ])('fails closed on malformed coordinates in %s', async (shardId) => {
    // Unreachable from the frozen manifest, so this is about the failure being
    // classified: without the guard a bad split indexes `undefined` and the run
    // sees an unclassified TypeError instead of an input veto.
    const execute = createD2ShardExecutors(baseDeps());
    await expect(execute(captureContext(shardId)))
      .rejects.toThrow(/capture-missing-or-invalid/);
  });

  it('rejects an unknown phase rather than silently doing nothing', async () => {
    const execute = createD2ShardExecutors(baseDeps());
    await expect(execute({
      ...captureContext('mystery/0'),
      phase: 'mystery' as D2ShardExecutionContext['phase'],
    })).rejects.toThrow(/no executor for phase/);
  });
});

// ---------------------------------------------------------------------------
// Full D1 chain, driven through the real orchestrator
// ---------------------------------------------------------------------------

/*
 * The tests above cover `replayTaskFor` and capture dispatch against a stub
 * capability. They cannot see the chain the executor actually has to bridge —
 * contextBatch, materialize, fit, select, freeze, test crossing, aggregate —
 * because every link of it only runs once a real payload capability and real
 * frozen subsets exist.
 *
 * So this block drives `runD2Episode` itself: real manifests, real capability
 * grants, real receipts, real D1 statistical core. Only the two things that
 * would otherwise cost hours of CPU are injected — the behavior trajectory and
 * the 128-piece continuation — and those are exactly the two seams the
 * executor publishes for the purpose.
 */

const sha256 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

const ZERO_DIAGNOSTICS = Object.freeze({
  searchCalls: 0, holdActions: 0, holdRate: 0, meanCompletedDepth: 0, minCompletedDepth: 0,
  completedDepthHistogram: Object.freeze([0, 0, 0, 0, 0]), totalWorkUnitsUsed: 0,
  meanWorkUnitsUsed: 0, maxWorkUnitsUsed: 0, budgetExhaustedSearches: 0, budgetExhaustionRate: 0,
  placementEvaluationUnits: 0, chanceExpansionUnits: 0, cacheHitUnits: 0,
  expandedDecisionNodes: 0, expandedChanceNodes: 0, cacheHits: 0,
});

/*
 * Three boards spanning the cardinality range the protocol allows: L_s = 2
 * (the floor), 9, and 13 — the last above the 12-placement ceiling, so the D2
 * subset tag actually has to choose rather than take the whole universe.
 * Placement enumeration dominates fixture cost (~80ms for the 13-legal board
 * against ~0.4ms for the 2-legal one), so the cheap board carries most of the
 * 160 and the two expensive ones appear once per eight subsets.
 */
const CARDINALITY_BOARDS = [
  { pieceType: 1 as const, rowMasks: [[1, 0b0010000010], [2, 0b0001111100]] as const },
  { pieceType: 2 as const, rowMasks: [] as const },
  { pieceType: 2 as const, rowMasks: [[2, 0b0000001010]] as const },
] as const;

const boardFor = (subsetIndex: number): typeof CARDINALITY_BOARDS[number] =>
  subsetIndex % 40 === 7 ? CARDINALITY_BOARDS[2]
    : subsetIndex % 20 === 3 ? CARDINALITY_BOARDS[1]
      : CARDINALITY_BOARDS[0];

let integrationCapturesCache: readonly D1CapturedState[] | undefined;

/*
 * 160 captured states in the canonical order the protocol fixes: split, then
 * group ordinal, then behavior vector, then capture slot. `score` varies with
 * the index purely so every state fingerprint is distinct.
 */
function integrationCaptures(): readonly D1CapturedState[] {
  integrationCapturesCache ??= Array.from({ length: 160 }, (_, subsetIndex) => {
    const split: D1Split = subsetIndex < 80 ? 'train' : subsetIndex < 112 ? 'validation' : 'test';
    const splitBase = split === 'train' ? 0 : split === 'validation' ? 80 : 112;
    const groupOrdinal = (subsetIndex - splitBase) >> 2;
    const behaviorVectorId: D1VectorId = subsetIndex % 4 < 2 ? 'gen6-best' : 'gen10-mu';
    const captureSlot = subsetIndex % 2 === 0 ? 128 as const : 512 as const;
    const fixture = boardFor(subsetIndex);
    const board = createEmptyBoard();
    for (const [row, mask] of fixture.rowMasks) {
      for (let column = 0; column < 10; column++) {
        if ((mask & (1 << column)) !== 0) board[row]![column] = 7;
      }
    }
    const state = {
      board,
      current: createPiece(fixture.pieceType),
      next: 3 as const,
      hold: null,
      holdAvailable: true,
      unseenBagMask: 0,
    };
    const score = subsetIndex;
    const stateFingerprint = sha256([
      state.board, state.current.type, state.current.rotation,
      state.current.position.x, state.current.position.y, state.next,
      state.hold, state.holdAvailable, state.unseenBagMask, score, 0, 1, captureSlot,
    ]);
    return {
      split,
      groupOrdinal,
      behaviorSeed: D2_PROFILE.behaviorSeeds[split][groupOrdinal]!,
      behaviorVectorId,
      behaviorVectorDigest: D1_VECTOR_DIGESTS[behaviorVectorId],
      captureSlot,
      state,
      score,
      lines: 0,
      level: 1,
      scheduledPieceNumber: captureSlot,
      sourceDiagnostics: ZERO_DIAGNOSTICS,
      stateFingerprint,
    } as unknown as D1CapturedState;
  });
  return integrationCapturesCache;
}

const INTEGRATION_SOURCES = {
  metadata: {},
  sourceHashes: D1_SOURCE_HASHES,
  vectors: [
    {
      id: 'gen6-best',
      weights: Array.from({ length: 13 }, (_, index) => 0.5 - index * 0.03),
      digest: D1_VECTOR_DIGESTS['gen6-best'],
    },
    {
      id: 'gen10-mu',
      weights: Array.from({ length: 13 }, (_, index) => -0.4 + index * 0.05),
      digest: D1_VECTOR_DIGESTS['gen10-mu'],
    },
  ],
} as unknown as D1Sources;

function withoutDigest(projection: D1ContextProjection): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...projection };
  delete copy.projectionDigest;
  return copy;
}

/*
 * A deterministic stand-in for one 128-piece continuation. It is a pure
 * function of the task identity, which is what makes both the resume and the
 * replay assertions below meaningful: the same task must project the same
 * bytes no matter which episode ran it.
 */
function projectionFor(task: D1ContextTask): D1ContextProjection {
  const reason = hashSeed(task.taskId, 11) % 8 === 0 ? 'gameover' as const : 'pieceCap' as const;
  const preimage = {
    taskId: task.taskId,
    subsetId: task.subsetId,
    placementId: task.placementId,
    continuationVectorId: task.continuationVectorId,
    streamIndex: task.streamIndex,
    pieces: reason === 'pieceCap' ? 128 : 17 + hashSeed(task.taskId, 12) % 110,
    scoreDelta: hashSeed(task.taskId, 13) % 4000,
    clearCounts: {
      singles: hashSeed(task.taskId, 14) % 5,
      doubles: hashSeed(task.taskId, 15) % 3,
      triples: hashSeed(task.taskId, 16) % 2,
      tetrises: hashSeed(task.taskId, 17) % 2,
    },
    reason,
    searchDiagnostics: ZERO_DIAGNOSTICS,
  };
  return { ...preimage, projectionDigest: sha256(preimage) } as unknown as D1ContextProjection;
}

function integrationExecutorDeps(
  over: Partial<D2ExecutorDependencies> = {},
): D2ExecutorDependencies {
  return {
    runContexts: ({ tasks }) => Promise.resolve(tasks.map(projectionFor)),
    runTrajectory: ({ split, groupOrdinal, behaviorVectorId }) => Promise.resolve(
      integrationCaptures().filter((capture) => capture.split === split
        && capture.groupOrdinal === groupOrdinal
        && capture.behaviorVectorId === behaviorVectorId),
    ),
    loadSources: () => INTEGRATION_SOURCES,
    profile: D2_PROFILE,
    ...over,
  };
}

const INTEGRATION_STAGE1 = buildD2Stage1Manifest({ profile: D2_PROFILE });
const INTEGRATION_DIR = evidenceDir(runIdFor(INTEGRATION_STAGE1));

function integrationOrchestratorDeps(
  fs: MemoryFs,
  over: Partial<D2Dependencies> = {},
): D2Dependencies {
  return {
    fs,
    runtimeIdentity: () => INTEGRATION_STAGE1.runtimeIdentity,
    clock: () => '2026-09-02T00:00:00.000Z',
    now: () => 0,
    pid: 4242,
    ppid: 1,
    isProcessAlive: () => false,
    anyD2ProcessRunning: () => false,
    trainerLockPresent: () => false,
    workerCount: 1,
    // `buildStage2` is deliberately not injected: the orchestrator's own
    // default derives stage 2 from the capture receipts, and every assertion
    // below is therefore about the shipped path rather than a fixture.
    executeShard: createD2ShardExecutors(integrationExecutorDeps()),
    ...over,
  };
}

/*
 * Interrupt after `limit` shards, the way a SIGKILL would. Each episode gets a
 * fresh executor — and therefore a fresh `EpisodeChain` — because that is what
 * a real restart does, and rebuilding that chain from receipted projections is
 * the property under test.
 */
function interruptingExecutor(
  limit: number | null,
  over: Partial<D2ExecutorDependencies> = {},
): D2ShardExecutor {
  const execute = createD2ShardExecutors(integrationExecutorDeps(over));
  let completed = 0;
  return async (context) => {
    if (limit !== null && completed >= limit) {
      throw Object.assign(new Error('injected interruption'), { reason: 'worker-pool-failure' });
    }
    completed += 1;
    return await execute(context);
  };
}

/*
 * `limits` is one entry per episode; distinct limits mean a distinct shard
 * fails each time, so the two-strike promotion rule (same shard, same reason,
 * twice) is not what ends the run.
 */
async function runIntegrationPipeline(
  limits: readonly (number | null)[],
  over: Partial<D2ExecutorDependencies> = {},
): Promise<{ fs: MemoryFs; outcome: D2Outcome }> {
  const fs = makeMemoryFs();
  let outcome: D2Outcome | undefined;
  for (const limit of limits) {
    outcome = await runD2Episode(integrationOrchestratorDeps(fs, {
      executeShard: interruptingExecutor(limit, over),
    }));
    if (outcome.kind !== 'episode-incomplete') break;
  }
  return { fs, outcome: outcome! };
}

const canonicalWithoutProvenance = (stdout: string): string => {
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  delete parsed.runProvenance;
  return JSON.stringify(parsed);
};

describe('real D1 chain through the orchestrator', () => {
  it('runs every phase end to end and returns a real held-out verdict', async () => {
    const { fs, outcome } = await runIntegrationPipeline([null]);

    expect(outcome.kind).toBe('run-verdict');
    const document = JSON.parse(outcome.stdout) as {
      status: string;
      result: {
        metrics: Record<string, { selectedPlacementIds: string[] }>;
        selectedPlacementDigest: string;
      };
      shardEvidence: { totalShards: number; phaseCounts: Record<string, number> };
    };

    // A statistical verdict out of `evaluateD1HeldOut`, not a stub payload.
    expect([
      'fail-joint-selection-not-shown',
      'fail-representation-gain-not-held-out',
      'pass-action-conditioned-listwise-supported',
    ]).toContain(document.status);
    expect(document.result.selectedPlacementDigest).toMatch(/^[0-9a-f]{64}$/);
    // 48 held-out subsets, each contributing exactly one selected placement.
    expect(document.result.metrics.action24!.selectedPlacementIds).toHaveLength(48);
    expect(document.result.metrics.afterstate13!.selectedPlacementIds).toHaveLength(48);

    expect(document.shardEvidence.phaseCounts).toMatchObject({
      capture: 80, 'label-train': 80, 'label-validation': 32,
      fit: 2, selection: 1, 'final-freeze': 1, 'label-test': 48, replay: 16, aggregate: 1,
    });
    expect(document.shardEvidence.totalShards).toBe(261);
    expect(fs.readFile(resultPath(INTEGRATION_DIR))).toBe(outcome.stdout);
  }, 600_000);

  it('rebuilds the chain from receipts across episodes to a byte-identical verdict', async () => {
    const whole = await runIntegrationPipeline([null]);
    // Each limit counts shards executed *in that episode*, so the cumulative
    // cuts land at 40 (inside capture, before stage 2 freezes), 100 (inside
    // label-train), 196 (immediately past final-freeze) and 216 (inside
    // label-test). A later episode therefore has to rebuild the context batch,
    // the fits, the freeze and the test crossing from receipts alone.
    const split = await runIntegrationPipeline([40, 60, 96, 20, null]);

    expect(split.outcome.kind).toBe('run-verdict');
    expect(canonicalWithoutProvenance(split.outcome.stdout))
      .toBe(canonicalWithoutProvenance(whole.outcome.stdout));
    expect((JSON.parse(split.outcome.stdout) as { resultDigest: string }).resultDigest)
      .toBe((JSON.parse(whole.outcome.stdout) as { resultDigest: string }).resultDigest);
    // The partition has to be real, or the equality above proves nothing:
    // five episodes, the first four cut short, the fifth finishing.
    const provenance = (JSON.parse(split.outcome.stdout) as {
      runProvenance: { episodes: number; terminationCauses: string[] };
    }).runProvenance;
    expect(provenance.episodes).toBe(5);
    // Four causes, not five: the verdict document is assembled before the
    // finishing episode writes its own `episode-end`, so `episodes` counts it
    // but `terminationCauses` cannot. That asymmetry is why this field is
    // outside the canonical projection and the digest.
    expect(provenance.terminationCauses).toEqual([
      'episode-incomplete', 'episode-incomplete', 'episode-incomplete', 'episode-incomplete',
    ]);
    expect((JSON.parse(whole.outcome.stdout) as { runProvenance: { episodes: number } })
      .runProvenance.episodes).toBe(1);
    // And the cuts really did land where the comment claims, so the final
    // episode genuinely re-derived the frozen models before crossing into the
    // held-out split.
    expect(readRunRecord(split.fs, INTEGRATION_DIR)
      .filter((entry) => entry.kind === 'episode-end')
      .map((entry) => entry.completedShards))
      .toEqual([40, 100, 196, 216, 261]);
  }, 900_000);

  it('fails the run when a replay disagrees with its primary projection', async () => {
    // The 16 replays are the only detector of nondeterminism a real run can
    // reach — nothing else recomputes a completed shard (design §10.3). A
    // replay executor that never compares would leave that detector inert.
    let perturbedTaskId: number | null = null;
    const { outcome } = await runIntegrationPipeline([null], {
      // Only the first replay diverges, so the run reaches the replay phase
      // with 48 sound label-test receipts and one contradicting audit.
      runContexts: ({ shardId, tasks }) => Promise.resolve(tasks.map((task) => {
        const projection = projectionFor(task);
        if (!shardId.startsWith('replay/')) return projection;
        perturbedTaskId ??= task.taskId;
        if (task.taskId !== perturbedTaskId) return projection;
        const perturbed = { ...withoutDigest(projection), scoreDelta: projection.scoreDelta + 1 };
        return { ...perturbed, projectionDigest: sha256(perturbed) } as unknown as D1ContextProjection;
      })),
    });

    expect(perturbedTaskId).not.toBeNull();
    expect(outcome.kind).toBe('episode-incomplete');
    expect((JSON.parse(outcome.stdout) as { failureReasons: string[] }).failureReasons)
      .toContain('replay-mismatch');
  }, 600_000);

  it('runs a label-test shard from capture payloads alone, with no model in reach', async () => {
    // Design §5.3: `label-test` depends on `final-freeze` as a *scheduling*
    // precondition, never as a payload grant. A label shard that had to reach a
    // freeze record to do its work would reintroduce precisely the coupling D1
    // makes unexpressible — and the capability layer would refuse it.
    const captures = integrationCaptures();
    const receipts = new Map(INTEGRATION_STAGE1.captureShardIds.map((shardId, index) => [
      shardId,
      buildD2Receipt({
        protocolId: D2_PROFILE.protocolId,
        shardId,
        phase: 'capture',
        manifestDigest: 'manifest-digest',
        stage2Digest: null,
        payload: captures.slice(index * 2, index * 2 + 2),
      }),
    ]));
    const stage2 = buildD2Stage2Manifest({
      stage1: INTEGRATION_STAGE1, captures, profile: D2_PROFILE,
    });
    const testShardId = stage2.shardIds.find((shardId) => shardId.startsWith('label-test/'))!;

    const projections = await createD2ShardExecutors(integrationExecutorDeps())({
      shardId: testShardId,
      phase: 'label-test',
      stage1: INTEGRATION_STAGE1,
      stage2,
      profile: D2_PROFILE,
      capability: grantD2PayloadCapability({
        phase: 'label-test',
        shardIds: stage2.shardIds,
        receipts,
        completed: new Set(INTEGRATION_STAGE1.captureShardIds),
      }),
    }) as readonly D1ContextProjection[];

    const subsetId = testShardId.slice('label-test/'.length);
    expect(projections.length).toBeGreaterThan(0);
    expect(projections.every((projection) => projection.subsetId === subsetId)).toBe(true);
    // Four contexts per placement: two continuation vectors x two streams.
    expect(projections.length % 4).toBe(0);
  }, 600_000);
});

describe('default executor wiring', () => {
  const captureContextFor = (shardId: string): D2ShardExecutionContext => ({
    shardId,
    phase: 'capture',
    stage1: INTEGRATION_STAGE1,
    stage2: null,
    profile: D2_PROFILE,
    capability: {} as D2ShardExecutionContext['capability'],
  });

  const fakePool = (destroyed: { count: number } = { count: 0 }) => ({
    run: (_shardId: string, tasks: readonly D1ContextTask[]) =>
      Promise.resolve(tasks.map(projectionFor)),
    runCapture: (shardId: string) => {
      const [, split, ordinal, vectorId] = shardId.split('/');
      return Promise.resolve(integrationCaptures().filter((capture) => capture.split === split
        && capture.groupOrdinal === Number(ordinal)
        && capture.behaviorVectorId === vectorId));
    },
    destroy: () => { destroyed.count += 1; return Promise.resolve(); },
  });

  it('creates no pool for an episode that runs no shard', async () => {
    // A run that only replays a stored verdict or blocks on a lock must not
    // spawn threads it will never use.
    let created = 0;
    const executor = createDefaultExecutor(4, {
      createPool: () => { created += 1; return fakePool(); },
      loadSources: () => INTEGRATION_SOURCES,
    });
    expect(created).toBe(0);
    await executor.dispose();
    expect(created).toBe(0);
  });

  it('creates the pool once, through the executor, and destroys exactly that one', async () => {
    // The earlier version of this test called `createD2ContextRunner(pool)`
    // itself, so the executor's own pool stayed null, `dispose()` disposed
    // nothing, and the assertion passed with `dispose()` gutted. The pool has
    // to be reached the way a shard reaches it.
    const destroyed = { count: 0 };
    let created = 0;
    const executor = createDefaultExecutor(2, {
      createPool: () => { created += 1; return fakePool(destroyed); },
      loadSources: () => INTEGRATION_SOURCES,
    });
    await executor.executeShard(captureContextFor('capture/train/0/gen6-best'));
    expect(created).toBe(1);
    expect(destroyed.count).toBe(0);
    await executor.dispose();
    expect(destroyed.count).toBe(1);
    // Idempotent: a second dispose must not destroy a pool it no longer owns.
    await executor.dispose();
    expect(destroyed.count).toBe(1);
  });

  it('is selected by runD2Episode when no executor is injected', async () => {
    // This used to throw `D2 requires an injected shard executor`. The aborted
    // signal stops the loop before the first shard is dispatched, so the branch
    // under test is the only thing exercised: no thread, no trajectory, no disk.
    const outcome = await runD2Episode({
      fs: makeMemoryFs(),
      runtimeIdentity: () => INTEGRATION_STAGE1.runtimeIdentity,
      clock: () => '2026-09-02T00:00:00.000Z',
      now: () => 0,
      pid: 4242,
      isProcessAlive: () => false,
      anyD2ProcessRunning: () => false,
      trainerLockPresent: () => false,
      signal: AbortSignal.abort(),
    });
    expect(outcome.kind).toBe('episode-incomplete');
    expect((JSON.parse(outcome.stdout) as { failureReasons: string[] }).failureReasons)
      .toEqual(['abort']);
  });

  it('drives a whole pipeline through the shipped executor wiring', async () => {
    // Capture goes to the trajectory runner, every context phase goes to the
    // pool through `createD2ContextRunner`, and stage 2 comes from the
    // orchestrator's own default — the same plumbing an authorized run uses,
    // with only the two expensive edges replaced.
    const asked: string[] = [];
    const destroyed = { count: 0 };
    const pool = fakePool(destroyed);
    const executor = createDefaultExecutor(1, {
      createPool: () => ({
        ...pool,
        runCapture: (shardId, request) => {
          asked.push(`${request.split}/${request.groupOrdinal}/${request.vector.id}`);
          return pool.runCapture(shardId);
        },
      }),
      loadSources: () => INTEGRATION_SOURCES,
    });
    const outcome = await runD2Episode({
      fs: makeMemoryFs(),
      runtimeIdentity: () => INTEGRATION_STAGE1.runtimeIdentity,
      clock: () => '2026-09-02T00:00:00.000Z',
      now: () => 0,
      pid: 4242,
      isProcessAlive: () => false,
      anyD2ProcessRunning: () => false,
      trainerLockPresent: () => false,
      workerCount: 1,
      executeShard: executor.executeShard,
    });

    expect(outcome.kind).toBe('run-verdict');
    expect(asked).toHaveLength(80);
    expect(asked[0]).toBe('train/0/gen6-best');
    expect(asked.at(-1)).toBe('test/11/gen10-mu');
    await executor.dispose();
    expect(destroyed.count).toBe(1);
  }, 600_000);
});

describe('rebuilt links are checked against the receipts that already record them', () => {
  it('stops the episode when a rebuilt fit disagrees with its receipt', async () => {
    // `fit`, `selection` and `final-freeze` receipts are never consumed as
    // inputs — D1 accepts only authenticated objects, so each is rebuilt in
    // process instead. Without this check those receipts were write-only, and a
    // bundle that drifted between episodes would have scored held-out data
    // while the evidence directory still recorded the model it replaced.
    // Nothing else could notice: the 16 replays audit the simulator, not the
    // fit chain.
    const fs = makeMemoryFs();
    // 80 capture + 80 label-train + 32 label-validation + 2 fit = 194, so the
    // first episode stops with both fit receipts on disk and `selection` next.
    const first = await runD2Episode(integrationOrchestratorDeps(fs, {
      executeShard: interruptingExecutor(194),
    }));
    expect(first.kind).toBe('episode-incomplete');

    // Stand in for a fit that did not reproduce: a fully valid receipt — right
    // manifest digest, self-consistent payload and receipt digests — recording
    // a different result. A merely corrupted receipt would be caught by the
    // evidence layer instead and would prove nothing about this check.
    const path = receiptPath(INTEGRATION_DIR, 'fit/afterstate13');
    const stored = JSON.parse(fs.readFile(path)!) as D2Receipt;
    writeReceiptAtomic(fs, INTEGRATION_DIR, buildD2Receipt({
      protocolId: stored.protocolId,
      shardId: stored.shardId,
      phase: stored.phase,
      manifestDigest: stored.manifestDigest,
      stage2Digest: stored.stage2Digest,
      payload: [{ driftedInAnEarlierEpisode: true }],
    }));

    const second = await runD2Episode(integrationOrchestratorDeps(fs, {
      executeShard: interruptingExecutor(null),
    }));
    expect(second.kind).toBe('episode-incomplete');
    const projection = JSON.parse(second.stdout) as {
      failureReasons: string[]; completedShards: number;
    };
    expect(projection.failureReasons).toEqual(['shard-nondeterminism']);
    // Detected at the `selection` shard, the first one that rebuilds a fit —
     // not 66 shards later at `aggregate`. Without the check there, the run
    // would sail through the freeze and the whole held-out split before
    // noticing, which is the difference between a cheap stop and an expensive
    // one.
    expect(projection.completedShards).toBe(194);
    // Non-verdict: a rebuild disagreement is resumable on first sight, and only
    // a second identical failure on the same shard promotes it.
    expect(fs.readFile(resultPath(INTEGRATION_DIR))).toBeNull();
  }, 900_000);
});

describe('the injected profile reaches everything derived from it', () => {
  /**
   * Regression for the class that produced C1. Stage 1 was built from the
   * injected profile while stage 2 and the default executor silently used
   * `D2_PROFILE`. The two select different placements whenever `L_s > 12`, and
   * because subset ids are state fingerprints the shard ids still matched — so
   * the run would have completed with contexts that were not the ones its own
   * manifest described, and nothing would have disagreed.
   *
   * The profile here keeps D2's seeds and changes only the subset tag, so the
   * sole thing that can differ between the two derivations is the selection.
   */
  const RETAGGED: ListwiseProtocolProfile = {
    ...D2_PROFILE,
    protocolId: 'd2-retagged-for-the-profile-threading-test',
    placementSubsetTag: 'd2-retagged-subset-tag',
  };

  it('threads it into the default stage-2 builder and the default executor', async () => {
    const stage1 = buildD2Stage1Manifest({ profile: RETAGGED });
    const dir = evidenceDir(runIdFor(stage1));
    const fs = makeMemoryFs();

    // Neither `executeShard` nor `buildStage2` is injected: both defaults must
    // be what runs, and both must receive the profile.
    const outcome = await runD2Episode({
      fs,
      profile: RETAGGED,
      runtimeIdentity: () => stage1.runtimeIdentity,
      clock: () => '2026-09-03T00:00:00.000Z',
      now: () => 0,
      pid: 4242,
      isProcessAlive: () => false,
      anyD2ProcessRunning: () => false,
      trainerLockPresent: () => false,
      workerCount: 1,
      loadSources: () => INTEGRATION_SOURCES,
      createPool: () => ({
        run: (_shardId, tasks) => Promise.resolve(tasks.map(projectionFor)),
        runCapture: (shardId) => {
          const [, split, ordinal, vectorId] = shardId.split('/');
          return Promise.resolve(integrationCaptures().filter((capture) => capture.split === split
            && capture.groupOrdinal === Number(ordinal)
            && capture.behaviorVectorId === vectorId));
        },
        destroy: () => Promise.resolve(),
      }),
    });

    // Not just `run-verdict`: an input veto is one too, and that is exactly
    // what the executor's own stage-2 agreement guard produces when the two
    // derivations disagree. The run has to reach a real held-out status.
    expect((JSON.parse(outcome.stdout) as { status: string }).status).not.toBe('invalid-input');
    expect(outcome.kind).toBe('run-verdict');
    const stored = fs.readFile(`${dir}/run-manifest-stage2.json`);
    expect(stored).toBe(canonicalJson(buildD2Stage2Manifest({
      stage1, captures: integrationCaptures(), profile: RETAGGED,
    })));
    // Discriminating: under `D2_PROFILE` the same captures select a different
    // twelve, so this is a claim about the tag rather than about the boards.
    expect(stored).not.toBe(canonicalJson(buildD2Stage2Manifest({
      stage1, captures: integrationCaptures(), profile: D2_PROFILE,
    })));
  }, 600_000);
});

describe('the rebuild check fails closed on an unrecognised shard id', () => {
  it('rejects a fit receipt the rebuild has no counterpart for', () => {
    // Unreachable today — stage 2's shard ids and the executor's rebuild keys
    // are the same two literals. It is guarded anyway because skipping an
    // unknown key would turn the whole nondeterminism detector into a silent
    // no-op the first time one side is renamed, with every test still green.
    const shardIds = ['fit/afterstate13', 'fit/action24', 'fit/renamed-in-a-later-round'];
    const receipts = new Map(shardIds.map((shardId) => [
      shardId,
      buildD2Receipt({
        protocolId: D2_PROFILE.protocolId,
        shardId,
        phase: 'fit',
        manifestDigest: 'manifest-digest',
        stage2Digest: null,
        payload: [],
      }),
    ]));
    const capability = grantD2PayloadCapability({
      phase: 'selection', shardIds, receipts, completed: new Set(shardIds),
    });

    expect(() => assertRebuildMatchesReceiptsForTest(capability, 'fit', new Map([
      ['fit/afterstate13', []],
      ['fit/action24', []],
    ]))).toThrow(/no rebuilt counterpart/);
    // And it accepts the set it does recognise, so the guard is not simply
    // throwing on everything.
    expect(() => assertRebuildMatchesReceiptsForTest(capability, 'fit', new Map(
      shardIds.map((shardId) => [shardId, []]),
    ))).not.toThrow();
  });
});

describe('the capture payload carries no D2 outcome', () => {
  it('pins the payload shape every downstream phase now reads', () => {
    // Spec 12.2(8). The clause as written says the capture payload carries no
    // *score*, which is false and cannot be made true: `stateFingerprint` is
    // computed over `[state, score, lines, level, scheduledPieceNumber]`, so the
    // score is part of the subset's identity and of every downstream digest.
    // What the clause protects is that no *outcome of this diagnostic* is
    // reachable from a capture — no label, no survival or Tetris metric, no fit,
    // selection or freeze record.
    //
    // Scope, stated honestly: this pins the fixture the whole D2 suite runs on,
    // not `captureD1Trajectory`'s output. Building a real capture here needs a
    // behavior-runner stub that restates D1's two diagnostic key sets, and a
    // second copy of a frozen contract is worse than the gap it would close.
    // The real producer's shape is D1's to pin, and its own suite does.
    const capture = integrationCaptures()[0]!;
    expect(Object.keys(capture).sort()).toEqual([
      'behaviorSeed', 'behaviorVectorDigest', 'behaviorVectorId', 'captureSlot',
      'groupOrdinal', 'level', 'lines', 'scheduledPieceNumber', 'score',
      'sourceDiagnostics', 'split', 'state', 'stateFingerprint',
    ]);

    const forbidden = [
      'label', 'outcome', 'survival', 'tetris', 'fit', 'lambda', 'weights',
      'selection', 'freeze', 'model', 'verdict', 'heldout',
      'afterstate', 'action24', 'placementid',
    ];
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        const lowered = key.toLowerCase();
        expect(forbidden.some((token) => lowered.includes(token))).toBe(false);
        walk(child);
      }
    };
    walk(capture);
  });
});
