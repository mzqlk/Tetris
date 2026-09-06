import { createHash } from 'node:crypto';
import { D2_PROFILE, type ListwiseProtocolProfile } from './d2Protocol';
import {
  D1_SOURCE_HASHES,
  D1_VECTOR_DIGESTS,
  freezeD1PlacementManifest,
  type D1CapturedState,
  type D1Split,
  type D1VectorId,
} from './d1ActionConditionedHeldOutListwiseCore';

/**
 * Shard model for the D2 sharded held-out listwise diagnostic.
 *
 * Every shard is a pure function of the immutable manifest plus the payload
 * capability it is granted, so any partition of the shard set into completion
 * episodes yields the same canonical verdict projection.  Nothing here reads
 * the clock, the environment, or the live runtime.
 */

export const D2_PHASE_ORDER = Object.freeze([
  'capture', 'label-train', 'label-validation', 'fit',
  'selection', 'final-freeze', 'label-test', 'replay', 'aggregate',
] as const);
export type D2Phase = typeof D2_PHASE_ORDER[number];
export type D2ShardId = string;

const DEPENDENCIES: Readonly<Record<D2Phase, readonly D2Phase[]>> = Object.freeze({
  capture: Object.freeze([]),
  'label-train': Object.freeze(['capture' as const]),
  'label-validation': Object.freeze(['capture' as const]),
  fit: Object.freeze(['label-train' as const]),
  selection: Object.freeze(['label-validation' as const, 'fit' as const]),
  'final-freeze': Object.freeze(['label-train' as const, 'label-validation' as const, 'selection' as const]),
  'label-test': Object.freeze(['final-freeze' as const]),
  replay: Object.freeze(['label-test' as const]),
  aggregate: Object.freeze(D2_PHASE_ORDER.slice(0, -1)),
});

export function phaseDependencies(phase: D2Phase): readonly D2Phase[] {
  return DEPENDENCIES[phase];
}

export type D2ManifestErrorReason =
  | 'capture-missing-or-invalid'
  | 'state-fingerprint-mismatch'
  | 'placement-manifest-mismatch'
  | 'manifest-drift';

export class D2ManifestError extends Error {
  readonly name = 'D2ManifestError';
  constructor(readonly reason: D2ManifestErrorReason) {
    super(`D2 manifest:${reason}`);
  }
}

const assert: (condition: unknown, reason: D2ManifestErrorReason) => asserts condition =
  (condition, reason) => {
    if (!condition) throw new D2ManifestError(reason);
  };

/** Canonical serialization: UTF-8, no whitespace, `-0` normalized to `0`. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) =>
    (typeof raw === 'number' && Object.is(raw, -0) ? 0 : raw));
}

export function digestOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export interface D2RuntimeIdentity {
  readonly node: string;
  readonly v8: string;
  readonly platform: string;
}

/**
 * Checked constant, never a live read.  The orchestrator compares the running
 * process against this value in startup step 0, before any digest or runId is
 * derived, so a runtime upgrade fails closed instead of forking a new run.
 */
export const D2_RUNTIME_IDENTITY: D2RuntimeIdentity = Object.freeze({
  node: '24.14.0',
  v8: '13.6.233.17-node.41',
  platform: 'win32-x64',
});

const SPLITS = Object.freeze(['train', 'validation', 'test'] as const);
const GROUP_COUNTS: Readonly<Record<D1Split, number>> = Object.freeze({
  train: 20, validation: 8, test: 12,
});
const VECTOR_ORDER = Object.freeze(['gen6-best', 'gen10-mu'] as const);
const REPLAY_COUNT = 16;
const CONTEXTS_PER_PLACEMENT = 4;
const CONTEXT_PIECES = 128;
const CAPTURE_PIECES = 512;

export interface D2Stage1Manifest {
  readonly protocolId: string;
  readonly placementSubsetTag: string;
  readonly schemaVersion: 1;
  readonly runtimeIdentity: D2RuntimeIdentity;
  readonly sourceHashes: Readonly<{ checkpoint: string; log: string }>;
  readonly vectorDigests: Readonly<Record<D1VectorId, string>>;
  readonly behaviorSeedDigest: string;
  readonly labelSeedDigest: string;
  readonly captureShardIds: readonly D2ShardId[];
}

export function captureShardId(split: D1Split, groupOrdinal: number, vectorId: D1VectorId): D2ShardId {
  return `capture/${split}/${groupOrdinal}/${vectorId}`;
}

export function buildD2Stage1Manifest(input: {
  readonly profile?: ListwiseProtocolProfile;
} = {}): D2Stage1Manifest {
  const profile = input.profile ?? D2_PROFILE;
  const captureShardIds: D2ShardId[] = [];
  for (const split of SPLITS) {
    for (let groupOrdinal = 0; groupOrdinal < GROUP_COUNTS[split]; groupOrdinal++) {
      for (const vectorId of VECTOR_ORDER) {
        captureShardIds.push(captureShardId(split, groupOrdinal, vectorId));
      }
    }
  }
  return Object.freeze({
    protocolId: profile.protocolId,
    placementSubsetTag: profile.placementSubsetTag,
    schemaVersion: 1 as const,
    runtimeIdentity: D2_RUNTIME_IDENTITY,
    sourceHashes: Object.freeze({ ...D1_SOURCE_HASHES }),
    vectorDigests: Object.freeze({ ...D1_VECTOR_DIGESTS }),
    behaviorSeedDigest: profile.behaviorSeedDigest,
    labelSeedDigest: profile.labelSeedDigest,
    captureShardIds: Object.freeze(captureShardIds),
  });
}

export function stage1Digest(manifest: D2Stage1Manifest): string {
  return digestOf(manifest);
}

export function runIdFor(manifest: D2Stage1Manifest): string {
  return `d2-${stage1Digest(manifest).slice(0, 16)}`;
}

/** The subset of a captured state that the manifest layer needs. */
export interface D2CaptureRef {
  readonly split: D1Split;
  readonly groupOrdinal: number;
  readonly behaviorVectorId: D1VectorId;
  readonly captureSlot: 128 | 512;
  readonly stateFingerprint: string;
}

/** The subset of `D1FrozenSubset` the manifest layer reads. */
export interface D2FrozenSubsetLike {
  readonly subsetId: string;
  readonly legalCount: number;
  readonly selectedCount: number;
  readonly legalPlacementIds: readonly string[];
  readonly legalUniverseDigest: string;
  readonly manifestDigest: string;
  readonly selectedPlacementIds?: readonly string[];
  readonly placements?: readonly { readonly placementId: string }[];
  readonly capture?: unknown;
}

export interface D2SubsetCardinality {
  readonly subsetId: string;
  readonly split: D1Split;
  readonly groupOrdinal: number;
  readonly behaviorVectorId: D1VectorId;
  readonly captureSlot: 128 | 512;
  readonly legalCount: number;
  readonly selectedCount: number;
  readonly legalUniverseDigest: string;
  readonly manifestDigest: string;
  readonly selectedPlacementIds: readonly string[];
}

export interface D2Stage2Manifest {
  readonly stage1Digest: string;
  readonly subsets: readonly D2SubsetCardinality[];
  readonly placementCount: number;
  readonly contextCount: number;
  readonly splitSubsetCounts: Readonly<Record<D1Split, number>>;
  readonly splitPlacementCounts: Readonly<Record<D1Split, number>>;
  readonly legalCountHistogram: Readonly<Record<string, number>>;
  readonly selectedCountHistogram: Readonly<Record<string, number>>;
  readonly shardIds: readonly D2ShardId[];
  readonly legalUniverseDigest: string;
  readonly placementManifestDigest: string;
  readonly contextManifestDigest: string;
}

type FreezeSubsetFn = (capture: D2CaptureRef) => D2FrozenSubsetLike;

/**
 * The real freeze needs the full captured state, not just the manifest-level
 * reference. Callers that rely on the default must therefore pass real
 * `D1CapturedState` values; `D2CaptureRef` is a structural subset of it, so the
 * published signature stays honest while the guard below turns a caller that
 * passes only the reference into a classified input veto instead of a
 * `TypeError` deep inside placement enumeration.
 */
const defaultFreezeSubset = (profile: ListwiseProtocolProfile): FreezeSubsetFn =>
  (capture) => {
    const full = capture as Partial<D1CapturedState> & D2CaptureRef;
    if (full.state === undefined) throw new D2ManifestError('capture-missing-or-invalid');
    return freezeD1PlacementManifest(full as D1CapturedState, profile);
  };

function selectedIdsOf(subset: D2FrozenSubsetLike): readonly string[] {
  if (subset.selectedPlacementIds !== undefined) return subset.selectedPlacementIds;
  assert(subset.placements !== undefined, 'placement-manifest-mismatch');
  return subset.placements.map(({ placementId }) => placementId);
}

export function buildD2Stage2Manifest(input: {
  readonly stage1: D2Stage1Manifest;
  readonly captures: readonly D2CaptureRef[];
  readonly profile?: ListwiseProtocolProfile;
  readonly freezeSubset?: FreezeSubsetFn;
}): D2Stage2Manifest {
  const profile = input.profile ?? D2_PROFILE;
  const freezeSubset = input.freezeSubset ?? defaultFreezeSubset(profile);
  assert(input.captures.length === 160, 'capture-missing-or-invalid');

  const fingerprints = new Set<string>();
  for (const capture of input.captures) {
    assert(!fingerprints.has(capture.stateFingerprint), 'state-fingerprint-mismatch');
    fingerprints.add(capture.stateFingerprint);
  }

  const subsets: D2SubsetCardinality[] = [];
  const splitSubsetCounts: Record<D1Split, number> = { train: 0, validation: 0, test: 0 };
  const splitPlacementCounts: Record<D1Split, number> = { train: 0, validation: 0, test: 0 };
  const legalCountHistogram: Record<string, number> = {};
  const selectedCountHistogram: Record<string, number> = {};
  for (let k = 2; k <= 12; k++) selectedCountHistogram[String(k)] = 0;

  for (const capture of input.captures) {
    const frozen = freezeSubset(capture);
    assert(frozen.legalCount >= 2, 'placement-manifest-mismatch');
    assert(frozen.selectedCount === Math.min(12, frozen.legalCount), 'placement-manifest-mismatch');
    assert(frozen.legalPlacementIds.length === frozen.legalCount, 'placement-manifest-mismatch');
    assert(frozen.subsetId === capture.stateFingerprint, 'state-fingerprint-mismatch');
    const selectedPlacementIds = selectedIdsOf(frozen);
    assert(selectedPlacementIds.length === frozen.selectedCount, 'placement-manifest-mismatch');

    subsets.push(Object.freeze({
      subsetId: frozen.subsetId,
      split: capture.split,
      groupOrdinal: capture.groupOrdinal,
      behaviorVectorId: capture.behaviorVectorId,
      captureSlot: capture.captureSlot,
      legalCount: frozen.legalCount,
      selectedCount: frozen.selectedCount,
      legalUniverseDigest: frozen.legalUniverseDigest,
      manifestDigest: frozen.manifestDigest,
      selectedPlacementIds: Object.freeze([...selectedPlacementIds]),
    }));
    splitSubsetCounts[capture.split] += 1;
    splitPlacementCounts[capture.split] += frozen.selectedCount;
    const legalKey = String(frozen.legalCount);
    legalCountHistogram[legalKey] = (legalCountHistogram[legalKey] ?? 0) + 1;
    selectedCountHistogram[String(frozen.selectedCount)] += 1;
  }

  const placementCount = subsets.reduce((sum, subset) => sum + subset.selectedCount, 0);
  const contextCount = CONTEXTS_PER_PLACEMENT * placementCount;

  const shardIds: D2ShardId[] = [...input.stage1.captureShardIds];
  for (const subset of subsets) {
    if (subset.split === 'train') shardIds.push(`label-train/${subset.subsetId}`);
  }
  for (const subset of subsets) {
    if (subset.split === 'validation') shardIds.push(`label-validation/${subset.subsetId}`);
  }
  shardIds.push('fit/afterstate13', 'fit/action24', 'selection', 'final-freeze');
  for (const subset of subsets) {
    if (subset.split === 'test') shardIds.push(`label-test/${subset.subsetId}`);
  }
  for (let index = 0; index < REPLAY_COUNT; index++) shardIds.push(`replay/${index}`);
  shardIds.push('aggregate');

  const orderedLegalHistogram = Object.fromEntries(
    Object.keys(legalCountHistogram)
      .map(Number)
      .sort((left, right) => left - right)
      .map((count) => [String(count), legalCountHistogram[String(count)]!]),
  );

  return Object.freeze({
    stage1Digest: stage1Digest(input.stage1),
    subsets: Object.freeze(subsets),
    placementCount,
    contextCount,
    splitSubsetCounts: Object.freeze(splitSubsetCounts),
    splitPlacementCounts: Object.freeze(splitPlacementCounts),
    legalCountHistogram: Object.freeze(orderedLegalHistogram),
    selectedCountHistogram: Object.freeze(selectedCountHistogram),
    shardIds: Object.freeze(shardIds),
    legalUniverseDigest: digestOf(subsets.map(({ legalUniverseDigest }) => legalUniverseDigest)),
    placementManifestDigest: digestOf(subsets.map((subset) => [
      subset.subsetId, subset.legalCount, subset.selectedCount, subset.selectedPlacementIds,
    ])),
    contextManifestDigest: digestOf(subsets.flatMap((subset) =>
      subset.selectedPlacementIds.flatMap((placementId) =>
        VECTOR_ORDER.flatMap((continuationVectorId) =>
          [0, 1].map((streamIndex) =>
            [subset.subsetId, placementId, continuationVectorId, streamIndex]))))),
  });
}

export function shardScheduledPieces(
  shardId: D2ShardId,
  stage2: D2Stage2Manifest | null,
): number {
  const [phase, ...rest] = shardId.split('/');
  if (phase === 'capture') return CAPTURE_PIECES;
  if (phase === 'replay') return CONTEXT_PIECES;
  if (phase === 'label-train' || phase === 'label-validation' || phase === 'label-test') {
    if (stage2 === null) return CONTEXTS_PER_PLACEMENT * 12 * CONTEXT_PIECES;
    const subsetId = rest.join('/');
    const subset = stage2.subsets.find((entry) => entry.subsetId === subsetId);
    if (subset === undefined) return CONTEXTS_PER_PLACEMENT * 12 * CONTEXT_PIECES;
    return CONTEXTS_PER_PLACEMENT * subset.selectedCount * CONTEXT_PIECES;
  }
  return 0;
}
