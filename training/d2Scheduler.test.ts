import { describe, expect, it } from 'vitest';
import { D2_PROFILE } from './d2Protocol';
import {
  D2_PHASE_ORDER,
  buildD2Stage1Manifest,
  buildD2Stage2Manifest,
  stage1Digest,
  type D2CaptureRef,
  type D2FrozenSubsetLike,
  type D2Phase,
  type D2ShardId,
} from './d2ShardManifest';
import { buildD2Receipt, type D2Receipt } from './d2Evidence';
import {
  D2FreezeBoundaryError,
  D2SchedulerError,
  assertD2FreezeBoundary,
  grantD2PayloadCapability,
  readD2Payloads,
  readablePhases,
  scheduleD2,
  shardPhase,
} from './d2Scheduler';

const SPLITS = ['train', 'validation', 'test'] as const;
const GROUPS = { train: 20, validation: 8, test: 12 } as const;
const VECTORS = ['gen6-best', 'gen10-mu'] as const;
const SLOTS = [128, 512] as const;

function captureRefs(): D2CaptureRef[] {
  const refs: D2CaptureRef[] = [];
  for (const split of SPLITS) {
    for (let groupOrdinal = 0; groupOrdinal < GROUPS[split]; groupOrdinal++) {
      for (const behaviorVectorId of VECTORS) {
        for (const captureSlot of SLOTS) {
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

const stage1 = buildD2Stage1Manifest({ profile: D2_PROFILE });
const manifestDigest = stage1Digest(stage1);
const stage2 = buildD2Stage2Manifest({
  stage1, captures: captureRefs(), profile: D2_PROFILE, freezeSubset: fakeFreeze,
});
const manifest = { shardIds: stage2.shardIds };

const idsOfPhase = (phase: D2Phase): D2ShardId[] =>
  stage2.shardIds.filter((id) => shardPhase(id) === phase);

const upTo = (...phases: D2Phase[]): Set<D2ShardId> =>
  new Set(phases.flatMap((phase) => idsOfPhase(phase)));

function receiptsFor(
  completed: ReadonlySet<D2ShardId>,
  payloadOf: (shardId: D2ShardId) => unknown = (shardId) => ({ shardId }),
): Map<D2ShardId, D2Receipt> {
  const map = new Map<D2ShardId, D2Receipt>();
  for (const shardId of completed) {
    map.set(shardId, buildD2Receipt({
      protocolId: stage1.protocolId,
      shardId,
      phase: shardPhase(shardId),
      manifestDigest,
      stage2Digest: stage2.stage1Digest,
      payload: payloadOf(shardId),
    }));
  }
  return map;
}

describe('payload-blind scheduler', () => {
  it('accepts only the manifest and the completed id set', () => {
    expect(scheduleD2.length).toBe(2);
  });

  it('returns the same schedule regardless of payload values', () => {
    // The schedule must depend only on which ids are complete. Two receipt sets
    // with wildly different outcomes and identical id sets must schedule
    // identically — and, since the receipts cannot even be passed in, the
    // stronger statement is that no payload is reachable from here at all.
    const completed = upTo('capture');
    const optimistic = receiptsFor(completed, () => ({ survival: 4, score: 9_999, tetris: 1 }));
    const pessimistic = receiptsFor(completed, () => ({ survival: 0, score: -9_999, tetris: 0 }));
    expect([...optimistic.keys()].sort()).toEqual([...pessimistic.keys()].sort());
    expect(JSON.stringify([...optimistic.values()].map((r) => r.payload)))
      .not.toBe(JSON.stringify([...pessimistic.values()].map((r) => r.payload)));

    const first = scheduleD2(manifest, new Set(optimistic.keys()));
    const second = scheduleD2(manifest, new Set(pessimistic.keys()));
    expect(second).toEqual(first);
  });

  it('exposes no parameter through which an outcome could reach the scheduler', () => {
    // Structural, not behavioural: the arity is the enforcement.
    expect(scheduleD2.length).toBe(2);
    const [manifestParam, completedParam] = scheduleD2.toString()
      .slice(scheduleD2.toString().indexOf('(') + 1, scheduleD2.toString().indexOf(')'))
      .split(',').map((part) => part.trim());
    expect(manifestParam).toBe('manifest');
    expect(completedParam).toBe('completed');
  });

  it('schedules only capture at the start', () => {
    const ready = scheduleD2(manifest, new Set());
    expect(ready).toHaveLength(80);
    expect(ready.every((id) => shardPhase(id) === 'capture')).toBe(true);
  });

  it('schedules label-train and label-validation together once capture completes', () => {
    const ready = scheduleD2(manifest, upTo('capture'));
    expect(ready.some((id) => shardPhase(id) === 'label-train')).toBe(true);
    expect(ready.some((id) => shardPhase(id) === 'label-validation')).toBe(true);
    expect(ready.some((id) => shardPhase(id) === 'fit')).toBe(false);
    expect(ready.some((id) => shardPhase(id) === 'label-test')).toBe(false);
  });

  it('schedules fit as soon as label-train completes, without waiting for label-validation', () => {
    const ready = scheduleD2(manifest, upTo('capture', 'label-train'));
    expect(ready.filter((id) => shardPhase(id) === 'fit')).toHaveLength(2);
  });

  it('does not schedule label-test before final-freeze', () => {
    const ready = scheduleD2(manifest,
      upTo('capture', 'label-train', 'label-validation', 'fit', 'selection'));
    expect(ready.some((id) => shardPhase(id) === 'label-test')).toBe(false);
    expect(ready).toContain('final-freeze');
  });

  it('schedules label-test once final-freeze completes', () => {
    const ready = scheduleD2(manifest,
      upTo('capture', 'label-train', 'label-validation', 'fit', 'selection', 'final-freeze'));
    expect(ready.filter((id) => shardPhase(id) === 'label-test')).toHaveLength(48);
  });

  it('schedules aggregate only when the other 260 shards are complete', () => {
    const all = new Set(stage2.shardIds.filter((id) => id !== 'aggregate'));
    expect(scheduleD2(manifest, all)).toEqual(['aggregate']);
    const missingOne = new Set(all);
    missingOne.delete('replay/3');
    expect(scheduleD2(manifest, missingOne)).toEqual(['replay/3']);
  });

  it('returns nothing when everything is complete', () => {
    expect(scheduleD2(manifest, new Set(stage2.shardIds))).toEqual([]);
  });
});

describe('freeze boundary under resume', () => {
  it('rejects a test receipt with no final-freeze receipt', () => {
    const completed = new Set([...upTo('capture'), idsOfPhase('label-test')[0]!]);
    expect(() => assertD2FreezeBoundary(stage2.shardIds, completed)).toThrow(D2FreezeBoundaryError);
    expect(() => scheduleD2(manifest, completed)).toThrow(/test-before-freeze/);
  });

  it('raises test-before-freeze when a fit-side shard is still incomplete', () => {
    // Regression: silently skipping the incomplete fit shard stranded the run —
    // aggregate could never be scheduled, and the episode degenerated into
    // repeated `aggregate-missing` with no failing shard to promote.
    const completed = new Set([
      ...upTo('capture', 'label-train', 'label-validation', 'selection', 'final-freeze'),
      'fit/afterstate13',
      idsOfPhase('label-test')[0]!,
    ]);
    expect(completed.has('fit/action24')).toBe(false);
    expect(() => scheduleD2(manifest, completed)).toThrow(D2FreezeBoundaryError);
    expect(() => assertD2FreezeBoundary(stage2.shardIds, completed)).toThrow(/incomplete-fit/);
  });

  it('never schedules a fit-side shard once any test receipt exists', () => {
    const completed = new Set([
      ...upTo('capture', 'label-train', 'label-validation', 'fit', 'selection', 'final-freeze'),
      idsOfPhase('label-test')[0]!,
    ]);
    const ready = scheduleD2(manifest, completed);
    expect(ready.some((id) => ['fit', 'selection', 'final-freeze'].includes(shardPhase(id)))).toBe(false);
  });

  it('allows the full pipeline while no test receipt exists', () => {
    expect(() => assertD2FreezeBoundary(stage2.shardIds, upTo('capture'))).not.toThrow();
  });
});

describe('(phase, split) payload capability', () => {
  const completed = new Set(stage2.shardIds);
  const receipts = receiptsFor(completed);
  const grant = (phase: D2Phase) =>
    grantD2PayloadCapability({ phase, shardIds: stage2.shardIds, receipts, completed });

  it.each([
    ['fit', 'label-validation'],
    ['fit', 'label-test'],
    ['selection', 'label-test'],
    ['final-freeze', 'label-test'],
    ['label-test', 'final-freeze'],
    ['label-test', 'label-train'],
    ['label-test', 'label-validation'],
    ['label-test', 'fit'],
    ['label-test', 'selection'],
    ['label-train', 'label-validation'],
    ['label-train', 'fit'],
    ['label-validation', 'label-train'],
    ['capture', 'capture'],
    ['fit', 'selection'],
    ['fit', 'final-freeze'],
    ['selection', 'final-freeze'],
    ['replay', 'fit'],
    ['replay', 'selection'],
    ['replay', 'final-freeze'],
  ] as const)('denies %s access to %s payloads', (holder, target) => {
    expect(() => readD2Payloads(grant(holder), target)).toThrow(D2SchedulerError);
  });

  it.each([
    ['fit', 'label-train'],
    ['selection', 'label-validation'],
    ['selection', 'fit'],
    ['final-freeze', 'label-train'],
    ['final-freeze', 'label-validation'],
    ['final-freeze', 'selection'],
    ['replay', 'label-test'],
    ['aggregate', 'label-test'],
    ['aggregate', 'final-freeze'],
    ['aggregate', 'fit'],
    // The captured states are the protocol's frozen input, and every phase
    // after `capture` has to re-derive its own tasks from them.
    ['label-train', 'capture'],
    ['label-validation', 'capture'],
    ['label-test', 'capture'],
    ['fit', 'capture'],
    ['selection', 'capture'],
    ['final-freeze', 'capture'],
    ['replay', 'capture'],
    ['aggregate', 'capture'],
  ] as const)('allows %s access to %s payloads', (holder, target) => {
    expect(() => readD2Payloads(grant(holder), target)).not.toThrow();
  });

  it('pins the whole readable table, so any widening is an explicit decision', () => {
    // Two rows are deliberately wider than the design's §5.3 table and the
    // reasons are recorded in `d2Scheduler.ts`: `capture` everywhere, because
    // it is frozen input rather than an outcome and nothing downstream can
    // rebuild its tasks without it; and `label-train` for `selection`, because
    // D1 only accepts authenticated fits, which cannot survive a receipt.
    // Everything else is the design's table verbatim.
    expect(Object.fromEntries(D2_PHASE_ORDER.map((phase) => [phase, readablePhases(phase)])))
      .toEqual({
        capture: [],
        'label-train': ['capture'],
        'label-validation': ['capture'],
        'label-test': ['capture'],
        fit: ['capture', 'label-train'],
        selection: ['capture', 'label-train', 'label-validation', 'fit'],
        'final-freeze': ['capture', 'label-train', 'label-validation', 'selection'],
        replay: ['capture', 'label-test'],
        aggregate: [
          'capture', 'label-train', 'label-validation', 'label-test',
          'fit', 'selection', 'final-freeze',
        ],
      });
  });

  it('pins the scheduler export surface a capability holder can reach', async () => {
    // An allowlist rather than a substring scan: adding any export to this
    // module forces an explicit decision about whether it belongs on the far
    // side of the freeze boundary.
    //
    // Deliberately NOT a claim that aggregate has no fitter in reach — it does.
    // `d2ShardExecutors.ts` imports `fitD1TrainingRepresentation`,
    // `selectD1Lambda` and `freezeD1FinalModels` at module scope and rebuilds
    // all three inside the aggregate shard, because D1 accepts only
    // authenticated objects and a receipt carries no authority. That deviation
    // is declared at the `aggregate` case and is guarded there by comparing
    // every rebuilt link against its receipt, not by anything in this file.
    expect(Object.keys(await import('./d2Scheduler')).sort()).toEqual([
      'D2FreezeBoundaryError',
      'D2SchedulerError',
      'assertD2FreezeBoundary',
      'grantD2PayloadCapability',
      'readD2Payloads',
      'readablePhases',
      'scheduleD2',
      'shardPhase',
    ]);
  });

  it('rejects a forged, copied, spread, or JSON round-tripped token', () => {
    const capability = grant('fit');
    expect(() => readD2Payloads(capability, 'label-train')).not.toThrow();
    expect(() => readD2Payloads({ ...capability }, 'label-train')).toThrow(D2SchedulerError);
    expect(() => readD2Payloads(JSON.parse(JSON.stringify(capability)), 'label-train'))
      .toThrow(D2SchedulerError);
    expect(() => readD2Payloads({ phase: 'fit' }, 'label-train')).toThrow(D2SchedulerError);
    expect(() => readD2Payloads(Object.create(capability) as typeof capability, 'label-train'))
      .toThrow(D2SchedulerError);
  });

  it('denies access while the source phase is incomplete', () => {
    const partial = upTo('capture');
    const someTrain = idsOfPhase('label-train').slice(0, 5);
    for (const id of someTrain) partial.add(id);
    const capability = grantD2PayloadCapability({
      phase: 'fit', shardIds: stage2.shardIds, receipts: receiptsFor(partial), completed: partial,
    });
    expect(() => readD2Payloads(capability, 'label-train')).toThrow(D2SchedulerError);
  });

  it('returns payloads in canonical shard order', () => {
    const payloads = readD2Payloads(grant('fit'), 'label-train');
    expect(payloads).toHaveLength(80);
    expect(payloads.map(({ shardId }) => shardId)).toEqual(idsOfPhase('label-train'));
  });
});

describe('shard phase parsing', () => {
  it('rejects an unknown phase', () => {
    expect(() => shardPhase('bogus/1')).toThrow(D2SchedulerError);
  });
});

describe('a capability cannot be used to widen itself', () => {
  const completed = new Set(stage2.shardIds);
  const receipts = receiptsFor(completed);

  it('reaches only its own row, whichever direction it is asked from', () => {
    // Read-time enforcement, restated per holder rather than per pair. The
    // grant-time scoping added alongside it is defense in depth and is
    // deliberately unobservable — no assertion here or anywhere can separate
    // the two, and `grantD2PayloadCapability`'s comment says so.
    const capability = grantD2PayloadCapability({
      phase: 'fit', shardIds: stage2.shardIds, receipts, completed,
    });
    const reachable = readD2Payloads(capability, 'label-train');
    expect(reachable.length).toBeGreaterThan(0);
    expect(reachable.every(({ shardId }) => shardPhase(shardId) === 'label-train')).toBe(true);
    for (const denied of ['label-validation', 'label-test', 'selection', 'final-freeze'] as const) {
      expect(() => readD2Payloads(capability, denied)).toThrow(D2SchedulerError);
    }
  });

  it('is an opaque token: the holder gets a phase name and nothing else', () => {
    // This is what makes `grantD2PayloadCapability` being an ordinary module
    // export harmless. Minting a wider capability needs a receipts map, and a
    // shard holds only this token, so a self-grant has nothing to grant.
    const capability = grantD2PayloadCapability({
      phase: 'label-test', shardIds: stage2.shardIds, receipts, completed,
    });
    expect(Object.keys(capability)).toEqual(['phase']);
    expect(Object.isFrozen(capability)).toBe(true);
    expect(JSON.parse(JSON.stringify(capability))).toEqual({ phase: 'label-test' });
    // A capability minted from what the holder can see is exactly as poor as
    // the holder already was.
    const selfGranted = grantD2PayloadCapability({
      phase: 'aggregate',
      shardIds: stage2.shardIds,
      receipts: new Map(readD2Payloads(capability, 'capture')
        .map(({ shardId }) => [shardId, receipts.get(shardId)!])),
      completed,
    });
    expect(() => readD2Payloads(selfGranted, 'final-freeze')).toThrow(D2SchedulerError);
    expect(() => readD2Payloads(selfGranted, 'label-test')).toThrow(D2SchedulerError);
  });
});
