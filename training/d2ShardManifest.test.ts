import { describe, expect, it } from 'vitest';
import { D2_PROFILE } from './d2Protocol';
import {
  D2_PHASE_ORDER,
  D2ManifestError,
  buildD2Stage1Manifest,
  buildD2Stage2Manifest,
  phaseDependencies,
  runIdFor,
  shardScheduledPieces,
  stage1Digest,
  type D2CaptureRef,
  type D2FrozenSubsetLike,
} from './d2ShardManifest';

const SPLITS = ['train', 'validation', 'test'] as const;
const GROUPS = { train: 20, validation: 8, test: 12 } as const;
const VECTORS = ['gen6-best', 'gen10-mu'] as const;
const SLOTS = [128, 512] as const;

/** Canonical (split, group, vector, slot) order — 160 entries. */
function captureRefs(): D2CaptureRef[] {
  const refs: D2CaptureRef[] = [];
  for (const split of SPLITS) {
    for (let groupOrdinal = 0; groupOrdinal < GROUPS[split]; groupOrdinal++) {
      for (const behaviorVectorId of VECTORS) {
        for (const captureSlot of SLOTS) {
          refs.push({
            split,
            groupOrdinal,
            behaviorVectorId,
            captureSlot,
            stateFingerprint: `fp-${split}-${groupOrdinal}-${behaviorVectorId}-${captureSlot}`,
          });
        }
      }
    }
  }
  return refs;
}

const defaultLegalCounts = (): number[] => captureRefs().map((_, index) => 2 + (index % 16));

/** Stands in for `freezeD1PlacementManifest` so cardinality is directly controllable. */
function fakeFreeze(legalCounts: readonly number[]) {
  let call = 0;
  return (capture: D2CaptureRef): D2FrozenSubsetLike => {
    const legalCount = legalCounts[call++]!;
    const selectedCount = Math.min(12, legalCount);
    if (legalCount < 2) throw new D2ManifestError('placement-manifest-mismatch');
    return {
      subsetId: capture.stateFingerprint,
      capture,
      legalCount,
      selectedCount,
      legalPlacementIds: Array.from({ length: legalCount }, (_, i) => `p${i}`),
      legalUniverseDigest: `lu-${capture.stateFingerprint}`,
      manifestDigest: `md-${capture.stateFingerprint}-${selectedCount}`,
      selectedPlacementIds: Array.from({ length: selectedCount }, (_, i) => `p${i}`),
    };
  };
}

const stage1 = () => buildD2Stage1Manifest({ profile: D2_PROFILE });

const stage2With = (legalCounts: readonly number[], refs = captureRefs()) =>
  buildD2Stage2Manifest({
    stage1: stage1(),
    captures: refs,
    profile: D2_PROFILE,
    freezeSubset: fakeFreeze(legalCounts),
  });

describe('D2 stage-1 manifest', () => {
  it('contains no random, time, or machine-read field and is byte-stable', () => {
    const a = buildD2Stage1Manifest({ profile: D2_PROFILE });
    const b = buildD2Stage1Manifest({ profile: D2_PROFILE });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(stage1Digest(a)).toBe(stage1Digest(b));
    expect(runIdFor(a)).toBe(runIdFor(b));
    expect(runIdFor(a)).toMatch(/^d2-[0-9a-f]{16}$/);
    expect(JSON.stringify(a)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('pins the D2 protocol identity and seed digests', () => {
    const manifest = stage1();
    expect(manifest.protocolId).toBe('d2-action-conditioned-held-out-listwise-sharded-v1');
    expect(manifest.placementSubsetTag).toBe('d2-placement-subset-v1-sharded');
    expect(manifest.behaviorSeedDigest).toBe(D2_PROFILE.behaviorSeedDigest);
    expect(manifest.labelSeedDigest).toBe(D2_PROFILE.labelSeedDigest);
  });

  it('carries the runtime identity as a frozen constant, not a live read', () => {
    const manifest = stage1();
    expect(manifest.runtimeIdentity).toEqual({
      node: '24.14.0', v8: '13.6.233.17-node.41', platform: 'win32-x64',
    });
  });

  it('enumerates exactly 80 capture shard ids in canonical order', () => {
    const manifest = stage1();
    expect(manifest.captureShardIds).toHaveLength(80);
    expect(new Set(manifest.captureShardIds).size).toBe(80);
    expect(manifest.captureShardIds[0]).toBe('capture/train/0/gen6-best');
    expect(manifest.captureShardIds[1]).toBe('capture/train/0/gen10-mu');
    expect(manifest.captureShardIds[79]).toBe('capture/test/11/gen10-mu');
  });
});

describe('D2 phase DAG', () => {
  it('orders phases and makes the two label-fit phases siblings', () => {
    expect(D2_PHASE_ORDER).toEqual([
      'capture', 'label-train', 'label-validation', 'fit',
      'selection', 'final-freeze', 'label-test', 'replay', 'aggregate',
    ]);
    expect(phaseDependencies('capture')).toEqual([]);
    expect(phaseDependencies('label-train')).toEqual(['capture']);
    expect(phaseDependencies('label-validation')).toEqual(['capture']);
    expect(phaseDependencies('fit')).toEqual(['label-train']);
    expect(phaseDependencies('selection')).toEqual(['label-validation', 'fit']);
    expect(phaseDependencies('final-freeze')).toEqual(['label-train', 'label-validation', 'selection']);
    expect(phaseDependencies('label-test')).toEqual(['final-freeze']);
    expect(phaseDependencies('replay')).toEqual(['label-test']);
    expect(phaseDependencies('aggregate')).toEqual([
      'capture', 'label-train', 'label-validation', 'fit',
      'selection', 'final-freeze', 'label-test', 'replay',
    ]);
  });
});

describe('D2 stage-2 manifest', () => {
  it('derives counts from the manifest, never from 1920/7680', () => {
    const legalCounts = defaultLegalCounts();
    const stage2 = stage2With(legalCounts);
    const expectedPlacements = legalCounts.reduce((sum, legal) => sum + Math.min(12, legal), 0);
    expect(stage2.placementCount).toBe(expectedPlacements);
    expect(stage2.contextCount).toBe(4 * expectedPlacements);
    expect(stage2.placementCount).not.toBe(1920);
    expect(stage2.contextCount).not.toBe(7680);
    expect(stage2.subsets).toHaveLength(160);
  });

  it('accepts the all-twelve case where the totals do equal 1920/7680', () => {
    const stage2 = stage2With(Array.from({ length: 160 }, () => 12));
    expect(stage2.placementCount).toBe(1920);
    expect(stage2.contextCount).toBe(7680);
  });

  it('caps K at 12 and keeps K = L below the cap', () => {
    const legalCounts = defaultLegalCounts();
    legalCounts[0] = 9;
    legalCounts[1] = 17;
    legalCounts[2] = 12;
    legalCounts[3] = 2;
    const stage2 = stage2With(legalCounts);
    expect(stage2.subsets[0]).toMatchObject({ legalCount: 9, selectedCount: 9 });
    expect(stage2.subsets[1]).toMatchObject({ legalCount: 17, selectedCount: 12 });
    expect(stage2.subsets[2]).toMatchObject({ legalCount: 12, selectedCount: 12 });
    expect(stage2.subsets[3]).toMatchObject({ legalCount: 2, selectedCount: 2 });
  });

  it('is a pure function of the capture refs', () => {
    const legalCounts = defaultLegalCounts();
    expect(JSON.stringify(stage2With(legalCounts))).toBe(JSON.stringify(stage2With(legalCounts)));
  });

  it('enumerates 261 shard ids in total, by phase', () => {
    const stage2 = stage2With(defaultLegalCounts());
    expect(stage2.shardIds).toHaveLength(261);
    expect(new Set(stage2.shardIds).size).toBe(261);
    const byPhase: Record<string, number> = {};
    for (const id of stage2.shardIds) {
      const phase = id.split('/')[0]!;
      byPhase[phase] = (byPhase[phase] ?? 0) + 1;
    }
    expect(byPhase).toEqual({
      capture: 80,
      'label-train': 80,
      'label-validation': 32,
      fit: 2,
      selection: 1,
      'final-freeze': 1,
      'label-test': 48,
      replay: 16,
      aggregate: 1,
    });
  });

  it('reports per-split and per-K cardinality histograms with complete K=2..12 bins', () => {
    const stage2 = stage2With(defaultLegalCounts());
    expect(Object.keys(stage2.selectedCountHistogram).map(Number)).toEqual(
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
    const total = Object.values(stage2.selectedCountHistogram).reduce((a, b) => a + b, 0);
    expect(total).toBe(160);
    expect(stage2.splitPlacementCounts.train
      + stage2.splitPlacementCounts.validation
      + stage2.splitPlacementCounts.test).toBe(stage2.placementCount);
  });

  it('rejects L_s < 2 before any label shard exists', () => {
    const legalCounts = defaultLegalCounts();
    legalCounts[37] = 1;
    expect(() => stage2With(legalCounts)).toThrow(/placement-manifest-mismatch/);
  });

  it('applies its own cardinality assertions, not only the freezer ones', () => {
    // A freezer that returns an inconsistent subset without throwing must still
    // be rejected: the previous version of this case was satisfied entirely by
    // the fake's own guard, so `buildD2Stage2Manifest`'s asserts never ran.
    const permissive = (over: Partial<D2FrozenSubsetLike>) => (capture: D2CaptureRef) => ({
      subsetId: capture.stateFingerprint,
      legalCount: 12,
      selectedCount: 12,
      legalPlacementIds: Array.from({ length: 12 }, (_, i) => `p${i}`),
      legalUniverseDigest: 'lu',
      manifestDigest: 'md',
      selectedPlacementIds: Array.from({ length: 12 }, (_, i) => `p${i}`),
      ...over,
    });
    const build = (over: Partial<D2FrozenSubsetLike>) => () => buildD2Stage2Manifest({
      stage1: stage1(), captures: captureRefs(), profile: D2_PROFILE, freezeSubset: permissive(over),
    });

    expect(build({ legalCount: 1, selectedCount: 1 })).toThrow(/placement-manifest-mismatch/);
    expect(build({ selectedCount: 11 })).toThrow(/placement-manifest-mismatch/);
    expect(build({ legalCount: 20 })).toThrow(/placement-manifest-mismatch/);
    expect(build({ selectedPlacementIds: ['p0'] })).toThrow(/placement-manifest-mismatch/);
    expect(build({ subsetId: 'not-the-fingerprint' })).toThrow(/state-fingerprint-mismatch/);
  });

  it('rejects duplicate state fingerprints', () => {
    const refs = captureRefs();
    refs[5] = { ...refs[5]!, stateFingerprint: refs[4]!.stateFingerprint };
    expect(() => stage2With(defaultLegalCounts(), refs)).toThrow(/state-fingerprint-mismatch/);
  });

  it('rejects a capture set that is not exactly 160 entries', () => {
    expect(() => stage2With(defaultLegalCounts(), captureRefs().slice(0, 159)))
      .toThrow(/capture-missing-or-invalid/);
  });

  it('binds itself to the stage-1 digest', () => {
    const s1 = stage1();
    const stage2 = buildD2Stage2Manifest({
      stage1: s1, captures: captureRefs(), profile: D2_PROFILE,
      freezeSubset: fakeFreeze(defaultLegalCounts()),
    });
    expect(stage2.stage1Digest).toBe(stage1Digest(s1));
  });
});

describe('shard scheduled-piece accounting', () => {
  it('sizes each shard class for the watchdog ceiling', () => {
    const stage2 = stage2With(Array.from({ length: 160 }, () => 12));
    expect(shardScheduledPieces('capture/train/0/gen6-best', null)).toBe(512);
    expect(shardScheduledPieces('replay/0', stage2)).toBe(128);
    expect(shardScheduledPieces('fit/action24', stage2)).toBe(0);
    expect(shardScheduledPieces('selection', stage2)).toBe(0);
    expect(shardScheduledPieces('final-freeze', stage2)).toBe(0);
    expect(shardScheduledPieces('aggregate', stage2)).toBe(0);
    const labelShard = stage2.shardIds.find((id) => id.startsWith('label-train/'))!;
    expect(shardScheduledPieces(labelShard, stage2)).toBe(4 * 12 * 128);
    expect(shardScheduledPieces(labelShard, stage2)).toBeLessThanOrEqual(6144);
  });

  it('scales a label shard with its own K, not with a fixed 12', () => {
    const legalCounts = defaultLegalCounts();
    legalCounts[0] = 3;
    const stage2 = stage2With(legalCounts);
    expect(shardScheduledPieces(`label-train/${stage2.subsets[0]!.subsetId}`, stage2)).toBe(4 * 3 * 128);
  });
});
