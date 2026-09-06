import { createHash } from 'node:crypto';
import { hashSeed } from '../src/ai/rng';
import { C0_BASE_SEED, C0_GAMES, C0_HISTORICAL_PAIRED_SEED } from './archivedRepresentativeAudit';
import { fixedReevaluationSeeds } from './publication';

/**
 * Identity of one action-conditioned held-out listwise protocol run.
 *
 * D1 and D2 share every statistical rule and differ only in this profile, so
 * the protocol identity is data rather than a set of module constants.  The
 * D1 profile reproduces the historical D1 constants byte for byte; see the
 * parity assertion in `d2Protocol.test.ts`.
 */
export interface ListwiseProtocolProfile {
  readonly protocolId: string;
  readonly placementSubsetTag: string;
  readonly baseSeed: number;
  readonly behaviorSeeds: Readonly<{
    train: readonly number[];
    validation: readonly number[];
    test: readonly number[];
  }>;
  readonly behaviorSeedDigest: string;
  readonly labelSeedDigest: string;
}

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

const SPLIT_SIZES = Object.freeze({ train: 20, validation: 8, test: 12 });

export function deriveBehaviorSeeds(baseSeed: number): ListwiseProtocolProfile['behaviorSeeds'] {
  return Object.freeze({
    train: Object.freeze(Array.from({ length: SPLIT_SIZES.train }, (_, index) => hashSeed(baseSeed, 0, index))),
    validation: Object.freeze(Array.from({ length: SPLIT_SIZES.validation }, (_, index) => hashSeed(baseSeed, 1, index))),
    test: Object.freeze(Array.from({ length: SPLIT_SIZES.test }, (_, index) => hashSeed(baseSeed, 2, index))),
  });
}

export function flattenBehaviorSeeds(
  profile: Pick<ListwiseProtocolProfile, 'behaviorSeeds'>,
): readonly number[] {
  return [...profile.behaviorSeeds.train, ...profile.behaviorSeeds.validation, ...profile.behaviorSeeds.test];
}

export function deriveLabelSeeds(
  profile: Pick<ListwiseProtocolProfile, 'behaviorSeeds' | 'baseSeed'>,
): readonly number[] {
  return flattenBehaviorSeeds(profile).flatMap((behaviorSeed) =>
    [0, 1].flatMap((behaviorVectorIndex) =>
      [0, 1].flatMap((captureSlotIndex) =>
        [0, 1].map((streamIndex) =>
          hashSeed(profile.baseSeed, 3, behaviorSeed, behaviorVectorIndex, captureSlotIndex, streamIndex)))));
}

/**
 * Every seed set consumed by an earlier authorized run.  A new protocol must
 * intersect none of them, so that no trajectory or continuation stream is
 * reused across runs.  D1's own seeds join the list for any profile that is
 * not D1 itself.
 */
export function priorSeedSets(
  profile: Pick<ListwiseProtocolProfile, 'baseSeed'>,
): readonly (readonly number[])[] {
  const training = Array.from({ length: 10 }, (_, gen) =>
    Array.from({ length: 5 }, (_, gameIndex) => hashSeed(20260727, gen, gameIndex))).flat();
  const fixed = fixedReevaluationSeeds(20260727, C0_GAMES);
  const paired = Array.from({ length: C0_GAMES }, (_, gameIndex) => hashSeed(C0_HISTORICAL_PAIRED_SEED, gameIndex));
  const c0 = Array.from({ length: C0_GAMES }, (_, gameIndex) => hashSeed(C0_BASE_SEED, gameIndex));
  const sets: (readonly number[])[] = [training, fixed, paired, c0];
  if (profile.baseSeed !== D1_BASE_SEED) {
    sets.push(flattenBehaviorSeeds(D1_PROFILE), deriveLabelSeeds(D1_PROFILE));
  }
  return sets;
}

export class ListwiseSeedScheduleError extends Error {
  readonly name = 'ListwiseSeedScheduleError';
  constructor() {
    super('seed-schedule-mismatch');
  }
}

export function assertProfileSeedsDisjoint(profile: ListwiseProtocolProfile): void {
  const behavior = flattenBehaviorSeeds(profile);
  const labels = deriveLabelSeeds(profile);
  const prior = new Set(priorSeedSets(profile).flat());
  const behaviorSet = new Set(behavior);
  const ok = behavior.length === 40
    && behaviorSet.size === 40
    && labels.length === 320
    && new Set(labels).size === 320
    && digest(profile.behaviorSeeds) === profile.behaviorSeedDigest
    && digest(labels) === profile.labelSeedDigest
    && !behavior.some((seed) => prior.has(seed))
    && !labels.some((seed) => prior.has(seed) || behaviorSet.has(seed));
  if (!ok) throw new ListwiseSeedScheduleError();
}

const D1_BASE_SEED = 20260825;

function buildProfile(input: {
  readonly protocolId: string;
  readonly placementSubsetTag: string;
  readonly baseSeed: number;
  readonly behaviorSeedDigest: string;
  readonly labelSeedDigest: string;
}): ListwiseProtocolProfile {
  return Object.freeze({ ...input, behaviorSeeds: deriveBehaviorSeeds(input.baseSeed) });
}

export const D1_PROFILE: ListwiseProtocolProfile = buildProfile({
  protocolId: 'd1-action-conditioned-held-out-listwise-v2-variable-cardinality',
  placementSubsetTag: 'd1-placement-subset-v2-variable-cardinality',
  baseSeed: D1_BASE_SEED,
  behaviorSeedDigest: '19da6a75ad75ccc71e8e7238ea01378583ab7f63cd16786ce70fa7228f981341',
  labelSeedDigest: 'a268a5e77c64e68faa4d8cad73727c0623df0531ba0390183742146dc365eb3f',
});

/**
 * Pre-registered 2026-09-02.  Both digests were computed once from the frozen
 * base seed and pinned here before any capture or label code ran; changing
 * either value is a protocol change, not a fix.
 */
export const D2_PROFILE: ListwiseProtocolProfile = buildProfile({
  protocolId: 'd2-action-conditioned-held-out-listwise-sharded-v1',
  placementSubsetTag: 'd2-placement-subset-v1-sharded',
  baseSeed: 20260902,
  behaviorSeedDigest: '72a121fe498a9a28fd4c3f4bf0f830414bc2c511d3409c091895193ba06b4643',
  labelSeedDigest: '4afd6a46a249e45f8d0b1a32f39d874eaf78147d711bd049b545d6ef5508a8df',
});
