import { describe, expect, it } from 'vitest';
import { D2_PROFILE } from './d2Protocol';
import {
  buildD2Stage1Manifest,
  buildD2Stage2Manifest,
  type D2CaptureRef,
  type D2FrozenSubsetLike,
} from './d2ShardManifest';
import {
  NO_PROGRESS_CEILING_MS,
  PER_SHARD_CEILING_FLOOR_MS,
  perShardCeilingMs,
  watchdogVerdict,
} from './d2Watchdog';

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

const freezeWithK = (selectedCount: number) => (capture: D2CaptureRef): D2FrozenSubsetLike => ({
  subsetId: capture.stateFingerprint,
  legalCount: selectedCount,
  selectedCount,
  legalPlacementIds: Array.from({ length: selectedCount }, (_, i) => `p${i}`),
  legalUniverseDigest: `lu-${capture.stateFingerprint}`,
  manifestDigest: `md-${capture.stateFingerprint}`,
  selectedPlacementIds: Array.from({ length: selectedCount }, (_, i) => `p${i}`),
});

const stage1 = buildD2Stage1Manifest({ profile: D2_PROFILE });
const stage2 = buildD2Stage2Manifest({
  stage1, captures: captureRefs(), profile: D2_PROFILE, freezeSubset: freezeWithK(12),
});
const kTwelveLabelShard = stage2.shardIds.find((id) => id.startsWith('label-train/'))!;

describe('per-shard ceiling', () => {
  it('is 20x the anchored cost with a 300s floor', () => {
    expect(perShardCeilingMs('capture/train/0/gen6-best', null)).toBe(20 * 512 * 150);
    expect(perShardCeilingMs('replay/0', stage2)).toBe(20 * 128 * 150);
    expect(perShardCeilingMs(kTwelveLabelShard, stage2)).toBe(20 * 6144 * 150);
  });

  it('applies the floor to the zero-piece shards', () => {
    for (const shardId of ['fit/afterstate13', 'fit/action24', 'selection', 'final-freeze', 'aggregate']) {
      expect(perShardCeilingMs(shardId, stage2)).toBe(PER_SHARD_CEILING_FLOOR_MS);
    }
  });

  it('scales a label shard with its own K', () => {
    const smallStage2 = buildD2Stage2Manifest({
      stage1, captures: captureRefs(), profile: D2_PROFILE, freezeSubset: freezeWithK(3),
    });
    const shardId = smallStage2.shardIds.find((id) => id.startsWith('label-train/'))!;
    expect(perShardCeilingMs(shardId, smallStage2)).toBe(20 * 4 * 3 * 128 * 150);
  });
});

describe('shard timeout', () => {
  it('fires once a shard passes its own ceiling and names it', () => {
    const state = { inFlight: new Map([['replay/0', 0]]), lastCompletionMs: 0 };
    const ceiling = perShardCeilingMs('replay/0', stage2);
    expect(watchdogVerdict(state, ceiling - 1, stage2)).toEqual({ kind: 'ok' });
    expect(watchdogVerdict(state, ceiling, stage2)).toEqual({ kind: 'shard-timeout', shardId: 'replay/0' });
  });

  it('reports the earliest-dispatched overdue shard deterministically', () => {
    const state = {
      inFlight: new Map([['replay/1', 10], ['replay/0', 5], ['replay/2', 5]]),
      lastCompletionMs: 0,
    };
    const verdict = watchdogVerdict(state, 10_000_000, stage2);
    expect(verdict).toEqual({ kind: 'shard-timeout', shardId: 'replay/0' });
  });
});

describe('run-level no-progress ceiling', () => {
  it('does not fire while a healthy long shard is still inside its own ceiling', () => {
    const state = { inFlight: new Map([[kTwelveLabelShard, 0]]), lastCompletionMs: 0 };
    // 31 minutes: past the no-progress window, far inside the 5.12h shard ceiling.
    expect(watchdogVerdict(state, 31 * 60_000, stage2)).toEqual({ kind: 'ok' });
    expect(31 * 60_000).toBeGreaterThan(NO_PROGRESS_CEILING_MS);
    expect(perShardCeilingMs(kTwelveLabelShard, stage2)).toBeGreaterThan(31 * 60_000);
  });

  it('fires with an empty in-flight set — the dispatcher-hang case', () => {
    const state = { inFlight: new Map<string, number>(), lastCompletionMs: 0 };
    expect(watchdogVerdict(state, NO_PROGRESS_CEILING_MS, stage2))
      .toEqual({ kind: 'no-progress-timeout' });
  });

  it('does not fire on an empty in-flight set before the window elapses', () => {
    const state = { inFlight: new Map<string, number>(), lastCompletionMs: 0 };
    expect(watchdogVerdict(state, NO_PROGRESS_CEILING_MS - 1, stage2)).toEqual({ kind: 'ok' });
  });

  it('yields to the more specific shard-timeout when a shard is also overdue', () => {
    const state = { inFlight: new Map([['replay/0', 0]]), lastCompletionMs: 0 };
    expect(watchdogVerdict(state, 10_000_000, stage2))
      .toEqual({ kind: 'shard-timeout', shardId: 'replay/0' });
  });

  it('measures progress from the last completion, not from dispatch', () => {
    const state = { inFlight: new Map<string, number>(), lastCompletionMs: 1_000_000 };
    expect(watchdogVerdict(state, 1_000_000 + NO_PROGRESS_CEILING_MS - 1, stage2))
      .toEqual({ kind: 'ok' });
    expect(watchdogVerdict(state, 1_000_000 + NO_PROGRESS_CEILING_MS, stage2))
      .toEqual({ kind: 'no-progress-timeout' });
  });
});
