import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { hashSeed } from '../src/ai/rng';
import { createEmptyBoard } from '../src/engine/board';
import { createPiece } from '../src/engine/piece';
import {
  buildD1ContextTasks,
  buildD1FutureStreams,
} from './d1ActionConditionedHeldOutListwiseLabels';
import {
  D1InvalidInputError,
  D1_BEHAVIOR_SEEDS,
  D1_PLACEMENT_SUBSET_TAG,
  D1_PROTOCOL_ID,
  buildD1LabelSeeds,
  buildD1SeedManifest,
  freezeD1PlacementManifest,
  D1_VECTOR_DIGESTS,
} from './d1ActionConditionedHeldOutListwiseCore';

const ZERO_VECTOR = Array.from({ length: 13 }, () => 0);
const DUMMY_STREAMS = Array.from({ length: 320 }, () => ({
  subsetId: '', labelSeed: 0, streamIndex: 0 as const, pieces: [], digest: '',
})) as never;

/** Only index 0 is inspected before the loop throws. */
function padTo160<T>(first: T): T[] {
  return [first, ...Array.from({ length: 159 }, (_, index) => ({ subsetId: `pad-${index}` } as T))];
}
import {
  D1_PROFILE,
  D2_PROFILE,
  assertProfileSeedsDisjoint,
  deriveBehaviorSeeds,
  deriveLabelSeeds,
  flattenBehaviorSeeds,
} from './d2Protocol';

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

/**
 * 160 subsets in canonical order. Boards are identical; `score` varies so each
 * state fingerprint is unique, which is all `buildD1ContextTasks` requires to
 * reach its manifest re-verification.
 */
function canonicalCaptures(profile: typeof D1_PROFILE) {
  return Array.from({ length: 160 }, (_, subsetIndex) => {
    const split = subsetIndex < 80 ? 'train' as const
      : subsetIndex < 112 ? 'validation' as const : 'test' as const;
    const splitBase = split === 'train' ? 0 : split === 'validation' ? 80 : 112;
    const groupOrdinal = (subsetIndex - splitBase) >> 2;
    const behaviorVectorId = subsetIndex % 4 < 2 ? 'gen6-best' as const : 'gen10-mu' as const;
    const captureSlot = subsetIndex % 2 === 0 ? 128 as const : 512 as const;
    const state = {
      board: createEmptyBoard(),
      current: createPiece(6),
      next: 3 as const,
      hold: null,
      holdAvailable: true,
      unseenBagMask: 0,
    };
    const score = subsetIndex;
    const stateFingerprint = digest([
      state.board, state.current.type, state.current.rotation,
      state.current.position.x, state.current.position.y, state.next,
      state.hold, state.holdAvailable, state.unseenBagMask,
      score, 0, 1, captureSlot,
    ]);
    return {
      split,
      groupOrdinal,
      behaviorSeed: profile.behaviorSeeds[split][groupOrdinal]!,
      behaviorVectorId,
      behaviorVectorDigest: D1_VECTOR_DIGESTS[behaviorVectorId],
      captureSlot,
      state,
      score,
      lines: 0,
      level: 1,
      scheduledPieceNumber: captureSlot,
      sourceDiagnostics: {} as never,
      stateFingerprint,
    };
  });
}

describe('D2 tag reaches every internal re-derivation', () => {
  it('selects a different subset than D1 for the same L_s > 12 state', () => {
    // The selection digest preimage is [fingerprint, placementId, tag], so the
    // two protocols must disagree here. If they agreed, the tag would not be
    // reaching the selection at all.
    const capture = canonicalCaptures(D2_PROFILE)[0]!;
    const underD1 = freezeD1PlacementManifest(capture, D1_PROFILE);
    const underD2 = freezeD1PlacementManifest(capture, D2_PROFILE);

    expect(underD1.legalCount).toBeGreaterThan(12);
    expect(underD1.selectedCount).toBe(12);
    expect(underD2.legalCount).toBe(underD1.legalCount);
    // Same legal universe, different digest-ordered selection.
    expect(underD2.legalUniverseDigest).toBe(underD1.legalUniverseDigest);
    expect(underD2.manifestDigest).not.toBe(underD1.manifestDigest);
    expect(underD2.placements.map((placement) => placement.placementId))
      .not.toEqual(underD1.placements.map((placement) => placement.placementId));
  });

  it('buildD1ContextTasks re-verifies with the caller profile, not the D1 default', () => {
    // Regression. In a real D2 run the capture coordinates and the frozen
    // subset are both D2; if the internal re-verification silently used the D1
    // default it would re-select a different 12 placements and reject the run's
    // own manifest. That would have surfaced only after all 80 capture shards
    // had run (~1.7h), writing a terminal, non-resumable `invalid-input`
    // verdict and consuming the one-shot operational authorization.
    //
    // The verification loop throws at index 0, so only the first subset needs
    // to be real; the rest exist to satisfy the 160-length precheck.
    const capture = canonicalCaptures(D2_PROFILE)[0]!;
    const d2Subset = freezeD1PlacementManifest(capture, D2_PROFILE);
    expect(d2Subset.legalCount).toBeGreaterThan(12);
    // Below 13 legal placements both tags would select the whole universe and
    // the bug would be invisible, so the fixture must exceed the cap.
    expect(freezeD1PlacementManifest(capture, D1_PROFILE).manifestDigest)
      .not.toBe(d2Subset.manifestDigest);

    expect(() => buildD1ContextTasks({
      subsets: padTo160(d2Subset),
      vectors: { 'gen6-best': ZERO_VECTOR, 'gen10-mu': ZERO_VECTOR },
      streams: DUMMY_STREAMS,
      profile: D2_PROFILE,
    })).not.toThrow(/placement-manifest-mismatch/);
  });

});

describe('D2 protocol pre-registration', () => {
  it('pins the D2 identity', () => {
    expect(D2_PROFILE.protocolId).toBe('d2-action-conditioned-held-out-listwise-sharded-v1');
    expect(D2_PROFILE.placementSubsetTag).toBe('d2-placement-subset-v1-sharded');
    expect(D2_PROFILE.baseSeed).toBe(20260902);
  });

  it('derives behavior seeds exactly as the spec states', () => {
    const derived = deriveBehaviorSeeds(20260902);
    expect(derived.train).toEqual(Array.from({ length: 20 }, (_, i) => hashSeed(20260902, 0, i)));
    expect(derived.validation).toEqual(Array.from({ length: 8 }, (_, i) => hashSeed(20260902, 1, i)));
    expect(derived.test).toEqual(Array.from({ length: 12 }, (_, i) => hashSeed(20260902, 2, i)));
    expect(derived).toEqual(D2_PROFILE.behaviorSeeds);
  });

  it('produces 40 unique behavior seeds and 320 unique label seeds', () => {
    const behavior = flattenBehaviorSeeds(D2_PROFILE);
    const labels = deriveLabelSeeds(D2_PROFILE);
    expect(behavior).toHaveLength(40);
    expect(new Set(behavior).size).toBe(40);
    expect(labels).toHaveLength(320);
    expect(new Set(labels).size).toBe(320);
  });

  it('is disjoint from every prior seed set, D1 included', () => {
    expect(() => assertProfileSeedsDisjoint(D2_PROFILE)).not.toThrow();
    const d1Behavior = new Set(flattenBehaviorSeeds(D1_PROFILE));
    const d1Labels = new Set(deriveLabelSeeds(D1_PROFILE));
    for (const seed of [...flattenBehaviorSeeds(D2_PROFILE), ...deriveLabelSeeds(D2_PROFILE)]) {
      expect(d1Behavior.has(seed)).toBe(false);
      expect(d1Labels.has(seed)).toBe(false);
    }
  });

  it('pins the D2 digests as pre-registered literals', () => {
    // Computed once on 2026-09-02 from the frozen base seed, before any
    // capture or label code ran. Changing either value is a protocol change.
    expect(D2_PROFILE.behaviorSeedDigest)
      .toBe('72a121fe498a9a28fd4c3f4bf0f830414bc2c511d3409c091895193ba06b4643');
    expect(D2_PROFILE.labelSeedDigest)
      .toBe('4afd6a46a249e45f8d0b1a32f39d874eaf78147d711bd049b545d6ef5508a8df');
  });

  it('keeps the D1 profile byte-identical to the pinned D1 constants', () => {
    expect(D1_PROFILE.protocolId).toBe('d1-action-conditioned-held-out-listwise-v2-variable-cardinality');
    expect(D1_PROFILE.placementSubsetTag).toBe('d1-placement-subset-v2-variable-cardinality');
    expect(D1_PROFILE.baseSeed).toBe(20260825);
    expect(D1_PROFILE.behaviorSeedDigest)
      .toBe('19da6a75ad75ccc71e8e7238ea01378583ab7f63cd16786ce70fa7228f981341');
    expect(D1_PROFILE.labelSeedDigest)
      .toBe('a268a5e77c64e68faa4d8cad73727c0623df0531ba0390183742146dc365eb3f');
    expect(D1_PROFILE.behaviorSeeds.train[4]).toBe(2912309259);
    expect(() => assertProfileSeedsDisjoint(D1_PROFILE)).not.toThrow();
  });

  it('pins the D1-tag selection rule against an independent derivation', () => {
    // Spec 8.1 allows a golden digest only if it was captured *before* the
    // parameterizing edit, and none was captured for the selection. Comparing
    // the default call against `freezeD1PlacementManifest(capture, D1_PROFILE)`
    // would prove nothing either, because `D1_PROFILE` *is* the module default
    // — the two calls share one object.
    //
    // So the baseline is derived here instead of read back: the documented
    // rule (sort the legal universe by sha256([fingerprint, placementId, tag]),
    // take the first K, restore placement order) recomputed from the pinned tag
    // literal rather than from the profile. If the parameterization had altered
    // what feeds the selection preimage or how it is ordered, the module and
    // this derivation would disagree.
    const capture = canonicalCaptures(D1_PROFILE)[0]!;
    const frozen = freezeD1PlacementManifest(capture);
    // Below the ceiling every tag selects the whole universe and the rule is
    // untestable, so the fixture has to exceed it.
    expect(frozen.legalCount).toBeGreaterThan(12);
    expect(frozen.selectedCount).toBe(12);

    const expected = [...frozen.legalPlacementIds]
      .map((placementId) => ({
        placementId,
        selectionDigest: digest([
          capture.stateFingerprint,
          placementId,
          'd1-placement-subset-v2-variable-cardinality',
        ]),
      }))
      .sort((left, right) => left.selectionDigest.localeCompare(right.selectionDigest)
        || left.placementId.localeCompare(right.placementId))
      .slice(0, 12)
      .map(({ placementId }) => placementId)
      .sort((left, right) => left.localeCompare(right));

    expect(frozen.placements.map(({ placementId }) => placementId)).toEqual(expected);
    expect(frozen.legalUniverseDigest).toBe(digest(frozen.legalPlacementIds));
    // Discriminating: the D2 tag has to pick a different twelve, or the literal
    // above would not be doing any work.
    expect(freezeD1PlacementManifest(capture, D2_PROFILE).placements
      .map(({ placementId }) => placementId)).not.toEqual(expected);
  });

  it('pins the D1-tag context and association digests against an independent derivation', () => {
    // Same reasoning as the selection test: both digests are recomputed here
    // from the frozen subsets and the label streams, so a change to what enters
    // either preimage shows up as a disagreement rather than as a silently
    // updated constant.
    const captures = mixedCardinalityCaptures(D1_PROFILE);
    const subsets = captures.map((capture) => freezeD1PlacementManifest(capture));
    expect(subsets.some(({ legalCount, selectedCount }) => legalCount > selectedCount)).toBe(true);

    const streams = streamsFor(subsets, D1_PROFILE);
    const batch = buildD1ContextTasks({
      subsets,
      vectors: { 'gen6-best': ZERO_VECTOR, 'gen10-mu': ZERO_VECTOR },
      streams,
      profile: D1_PROFILE,
    });

    const associationTuples: unknown[][] = [];
    const contextTuples: unknown[][] = [];
    let taskId = 0;
    subsets.forEach((subset, subsetIndex) => {
      for (const placement of subset.placements) {
        for (const continuationVectorId of ['gen6-best', 'gen10-mu'] as const) {
          for (const streamIndex of [0, 1] as const) {
            const stream = streams[subsetIndex * 2 + streamIndex]!;
            const association = [
              taskId, subsetIndex, placement.placementId, continuationVectorId, streamIndex,
            ];
            associationTuples.push(association);
            contextTuples.push([...association, stream.labelSeed, stream.digest]);
            taskId += 1;
          }
        }
      }
    });

    expect(batch.tasks).toHaveLength(taskId);
    expect(batch.evidence.taskAssociationDigest).toBe(digest(associationTuples));
    expect(batch.evidence.contextManifestDigest).toBe(digest(contextTuples));

    // Discriminating: the same subsets under the D2 profile are rejected, so
    // the digests above really are profile-sensitive.
    expect(() => buildD1ContextTasks({
      subsets,
      vectors: { 'gen6-best': ZERO_VECTOR, 'gen10-mu': ZERO_VECTOR },
      streams,
      profile: D2_PROFILE,
    })).toThrow(D1InvalidInputError);
  }, 300_000);

  it('parameterization does not change any D1-tag value', () => {
    // Baseline captured from the unmodified D1 modules on 2026-09-02, before
    // the parameterizing edit, per spec §8.1.
    const manifest = buildD1SeedManifest();
    expect(manifest.behaviorSeedDigest)
      .toBe('19da6a75ad75ccc71e8e7238ea01378583ab7f63cd16786ce70fa7228f981341');
    expect(manifest.labelSeedDigest)
      .toBe('a268a5e77c64e68faa4d8cad73727c0623df0531ba0390183742146dc365eb3f');
    expect(buildD1LabelSeeds(manifest)).toHaveLength(320);
    expect(D1_PLACEMENT_SUBSET_TAG).toBe('d1-placement-subset-v2-variable-cardinality');
    expect(D1_PROTOCOL_ID).toBe('d1-action-conditioned-held-out-listwise-v2-variable-cardinality');
    expect(manifest.behaviorSeeds).toEqual(D1_BEHAVIOR_SEEDS);
  });
});

/**
 * 160 canonical captures whose boards span the cardinality range: mostly a
 * two-placement board, with a nine-placement and a thirteen-placement board
 * once every eight subsets. The thirteen-placement board is the point — below
 * the twelve-placement ceiling both tags select the whole universe and a
 * selection difference would be invisible — and the cheap board keeps the
 * fixture affordable, since placement enumeration dominates its cost.
 */
function mixedCardinalityCaptures(profile: typeof D1_PROFILE) {
  const boards = [
    { pieceType: 1 as const, rowMasks: [[1, 0b0010000010], [2, 0b0001111100]] as const },
    { pieceType: 2 as const, rowMasks: [] as const },
    { pieceType: 2 as const, rowMasks: [[2, 0b0000001010]] as const },
  ] as const;
  return canonicalCaptures(profile).map((capture, subsetIndex) => {
    const fixture = subsetIndex % 40 === 7 ? boards[2]
      : subsetIndex % 20 === 3 ? boards[1] : boards[0];
    const board = createEmptyBoard();
    for (const [row, mask] of fixture.rowMasks) {
      for (let column = 0; column < 10; column++) {
        if ((mask & (1 << column)) !== 0) board[row]![column] = 7;
      }
    }
    const state = { ...capture.state, board, current: createPiece(fixture.pieceType) };
    const stateFingerprint = digest([
      state.board, state.current.type, state.current.rotation,
      state.current.position.x, state.current.position.y, state.next,
      state.hold, state.holdAvailable, state.unseenBagMask,
      capture.score, capture.lines, capture.level, capture.scheduledPieceNumber,
    ]);
    return { ...capture, state, stateFingerprint };
  });
}

function streamsFor(
  subsets: readonly ReturnType<typeof freezeD1PlacementManifest>[],
  profile: typeof D1_PROFILE,
) {
  return buildD1FutureStreams({
    entries: subsets.flatMap((subset) => {
      const vectorIndex = subset.capture.behaviorVectorId === 'gen6-best' ? 0 : 1;
      const slotIndex = subset.capture.captureSlot === 128 ? 0 : 1;
      return ([0, 1] as const).map((streamIndex) => ({
        subsetId: subset.subsetId,
        labelSeed: hashSeed(
          profile.baseSeed, 3, subset.capture.behaviorSeed, vectorIndex, slotIndex, streamIndex,
        ),
        unseenBagMask: subset.capture.state.unseenBagMask,
        streamIndex,
      }));
    }),
    profile,
  }).streams;
}

describe('label seeds are indexed, not re-derived', () => {
  it('maps subset s and stream i to schedule slot 2s + i, for all 320', () => {
    // The executor indexes `buildD1LabelSeeds(...)[subsetIndex * 2 + streamIndex]`
    // rather than recomputing `hashSeed(baseSeed, 3, ...)`, which is right — a
    // frozen protocol rule should have one owner. But the indexing is itself an
    // assumption about canonical order, and an off-by-one there would produce a
    // self-consistent run against the wrong seeds that no digest would catch.
    // So the mapping is pinned here, against the derivation it replaced.
    const seeds = buildD1LabelSeeds(buildD1SeedManifest(D2_PROFILE), D2_PROFILE);
    expect(seeds).toHaveLength(320);

    for (let subsetIndex = 0; subsetIndex < 160; subsetIndex++) {
      const split = subsetIndex < 80 ? 'train' as const
        : subsetIndex < 112 ? 'validation' as const : 'test' as const;
      const splitBase = split === 'train' ? 0 : split === 'validation' ? 80 : 112;
      const behaviorSeed = D2_PROFILE.behaviorSeeds[split][(subsetIndex - splitBase) >> 2]!;
      const vectorIndex = subsetIndex % 4 < 2 ? 0 : 1;
      const slotIndex = subsetIndex % 2 === 0 ? 0 : 1;
      for (const streamIndex of [0, 1]) {
        expect(seeds[subsetIndex * 2 + streamIndex]).toBe(
          hashSeed(D2_PROFILE.baseSeed, 3, behaviorSeed, vectorIndex, slotIndex, streamIndex),
        );
      }
    }
  });
});
