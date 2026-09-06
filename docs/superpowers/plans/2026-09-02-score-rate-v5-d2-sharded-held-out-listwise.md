# D2 sharded held-out listwise diagnostic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the diagnostic-only D2 sharded held-out listwise pipeline so the frozen D1 statistical protocol can run to a verdict across process interruptions, with durable per-shard evidence and no ability to inspect partial results.

**Architecture:** Seven new focused `training/d2*.ts` modules (protocol profile, shard manifest, evidence store, scheduler + payload capabilities, watchdog, exit projections, orchestrator) layered on the existing, unchanged D1 statistical core. The D1 modules are parameterized in place so both D1 and D2 protocol identities flow through one implementation; a byte-identity parity test pins D1 behaviour. Nothing in `src/ai/` changes.

**Tech Stack:** TypeScript 5.6 (ESM, `node:` imports allowed in `training/`), Vitest 3.2, ESLint 9, tsx worker loader, Node `worker_threads`.

**Spec:** `docs/superpowers/specs/2026-09-02-score-rate-v5-d2-sharded-held-out-listwise-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Code-only.** No task in this plan runs the real D2 diagnostic, training, benchmark, calibration, paired bench, publication, or browser/runtime acceptance. All pipeline tests use injected fakes.
- **Protected probes.** `training/searchProbe.ts`, `training/searchProbeWorker.ts`, `training/searchProbe.test.ts` must never be read, executed, hashed, diffed, reviewed, typechecked, tested, modified, moved, deleted, staged, or committed. Never run a command that globs them (`npx vitest run training/` is forbidden; always name exact paths).
- **No commits.** Owned files overlap preserved WIP, so this plan forbids `git add`/`git commit`/`git stash`/`git reset`/`git restore`/`git checkout`/`git clean`. Each task ends with a byte snapshot plus an exact owned-path `git diff --no-index` package for review, not a commit range.
- **Preserve WIP.** All A+/B1/C0/D1 working-tree files and the overlapping `package.json` stay. Per design §8.1, "preserve" means no discarding and no change to D1-tag behaviour — targeted edits for parameterization are permitted.
- **Active v5 contracts are frozen verbatim:** `score-rate-v5`, checkpoint schema 6, exact 13-entry `FEATURE_NAMES` order, `bag-expectimax-hold-v2`, depth 4, root/child beams 64/32, `maxWorkUnits=3584`, `budget-corpus-v1`, caches 65536/16384, standard Hold, exact seven-bag public state, SRS, survival-first ordering, deterministic tie-breaks, board-row immutability, fitness exactly `meanScore / scheduled maxPieces`.
- **No artifact mutation.** Never write `public/ai/`, `training-archive/`, checkpoints, logs, candidates, or weight files. Never create, acquire, or delete the repository trainer lock. D2 writes only under `diagnostics/<runId>/`.
- **`src/ai/` purity.** No `node:` imports, DOM, filesystem, or module-level mutable state added to `src/ai/`. All D2 code lives in `training/`.
- **Frozen values used across tasks:** protocol id `d2-action-conditioned-held-out-listwise-sharded-v1`; placement subset tag `d2-placement-subset-v1-sharded`; base seed `20260902`; lambda grid `[0.0001, 0.001, 0.01, 0.1, 1]`; capture slots `[128, 512]`; splits `[train, validation, test]` sized 20/8/12 groups → 80/32/48 subsets → 160 total; `K_s = min(12, L_s)` with `L_s >= 2`; 261 shards; `maxProductiveEpisodes = 5`; `maxBarrenEpisodes = 10`; heartbeat 30 s; per-shard ceiling `max(300_000, 20 * scheduledPieces * 150)` ms; no-progress ceiling 30 min.
- **Canonical serialization** (identical to D1): UTF-8, `JSON.stringify` with no whitespace, fixed key order, `-0` canonicalized to `0`, no `undefined`/NaN/Infinity.
- **Verification commands** (exact paths only):
  - `npx vitest run <exact test paths>`
  - `npx eslint <exact source and test paths>`
  - `npm run typecheck:train`
  - `npm run build`
  - `git diff --check`

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `training/d2Protocol.ts` | `ListwiseProtocolProfile` type; the frozen D1 and D2 profiles; seed derivation and the six-set disjointness assertion. |
| `training/d2Protocol.test.ts` | Pre-registration: exact seed values, digests, uniqueness, zero intersection, D1 parity. |
| `training/d2ShardManifest.ts` | Shard ids, phase DAG, stage-1/stage-2 manifest construction, canonical digests, `runId`. |
| `training/d2ShardManifest.test.ts` | Determinism, drift detection, cardinality veto, count derivation. |
| `training/d2Evidence.ts` | Evidence directory layout, atomic write, receipt schema/validation, `run-record.jsonl` append/read, D2 run lock and its adjudication. |
| `training/d2Evidence.test.ts` | Atomicity under injected crash, corruption/regression detection, run-record lifecycle, lock adjudication. |
| `training/d2Scheduler.ts` | Payload-blind scheduler; `(phase, split)` payload capability registry; freeze-boundary guards. |
| `training/d2Scheduler.test.ts` | Blindness, capability denial matrix, `test-before-freeze` under resume. |
| `training/d2Watchdog.ts` | Per-shard and run-level no-progress ceilings. |
| `training/d2Watchdog.test.ts` | Both ceilings fire; a long-but-healthy shard is not pre-empted. |
| `training/d2Exit.ts` | Seven exit classes; canonical verdict projection vs `runProvenance`; `result.json` write-once; exit-code derivation; `runtime-fail` promotion. |
| `training/d2Exit.test.ts` | Class assignment, write-once replay, promotion across two startups. |
| `training/d2ShardedHeldOutListwise.ts` | Orchestrator: startup sequence, episode loop, shard execution, CLI entry. |
| `training/d2ShardedHeldOutListwise.test.ts` | End-to-end with fakes: resume equivalence, worker-count invariance, write boundary. |
| `training/d2ShardedHeldOutListwiseWorker.ts` | Worker thread entry (mirrors the D1 worker). |

**Modify:**

| File | Change |
|---|---|
| `training/d1ActionConditionedHeldOutListwiseCore.ts` | Thread `ListwiseProtocolProfile` through `buildD1SeedManifest`, `buildD1LabelSeeds`, `captureD1States`, `freezeD1PlacementManifest`. Defaults keep D1 behaviour. |
| `training/d1ActionConditionedHeldOutListwiseLabels.ts` | Thread the profile's `baseSeed` through the two label-seed derivation sites. |
| `.gitignore` | Add the `diagnostics/` block. |
| `package.json` | Add the `diagnose:d2-sharded-listwise` script. |

---

## Task 1: Protocol profile and pre-registered D2 seeds

This task is first because §4.2 of the spec requires the seed manifest to be computed, pinned, and proven disjoint before any capture or label code can run.

**Files:**
- Create: `training/d2Protocol.ts`
- Create: `training/d2Protocol.test.ts`
- Modify: `training/d1ActionConditionedHeldOutListwiseCore.ts` (lines 26–42, 173–213, 328–, 491–)
- Modify: `training/d1ActionConditionedHeldOutListwiseLabels.ts` (the two `20260825` sites near lines 89 and 410)

**Interfaces:**
- Consumes: `hashSeed` from `src/ai/rng`; `fixedReevaluationSeeds` from `training/publication`; `C0_BASE_SEED`, `C0_GAMES`, `C0_HISTORICAL_PAIRED_SEED` from `training/archivedRepresentativeAudit`.
- Produces:
  ```ts
  export interface ListwiseProtocolProfile {
    readonly protocolId: string;
    readonly placementSubsetTag: string;
    readonly baseSeed: number;
    readonly behaviorSeeds: Readonly<{
      train: readonly number[]; validation: readonly number[]; test: readonly number[];
    }>;
    readonly behaviorSeedDigest: string;
    readonly labelSeedDigest: string;
  }
  export const D1_PROFILE: ListwiseProtocolProfile;
  export const D2_PROFILE: ListwiseProtocolProfile;
  export function deriveBehaviorSeeds(baseSeed: number): ListwiseProtocolProfile['behaviorSeeds'];
  export function deriveLabelSeeds(profile: ListwiseProtocolProfile): readonly number[];
  export function assertProfileSeedsDisjoint(profile: ListwiseProtocolProfile): void;
  ```

---

- [ ] **Step 1: Write the failing pre-registration test**

Create `training/d2Protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashSeed } from '../src/ai/rng';
import {
  D1_PROFILE, D2_PROFILE, assertProfileSeedsDisjoint, deriveBehaviorSeeds, deriveLabelSeeds,
} from './d2Protocol';

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
    const behavior = [
      ...D2_PROFILE.behaviorSeeds.train,
      ...D2_PROFILE.behaviorSeeds.validation,
      ...D2_PROFILE.behaviorSeeds.test,
    ];
    const labels = deriveLabelSeeds(D2_PROFILE);
    expect(behavior).toHaveLength(40);
    expect(new Set(behavior).size).toBe(40);
    expect(labels).toHaveLength(320);
    expect(new Set(labels).size).toBe(320);
  });

  it('is disjoint from every prior seed set, D1 included', () => {
    expect(() => assertProfileSeedsDisjoint(D2_PROFILE)).not.toThrow();
    const d1Behavior = new Set([
      ...D1_PROFILE.behaviorSeeds.train,
      ...D1_PROFILE.behaviorSeeds.validation,
      ...D1_PROFILE.behaviorSeeds.test,
    ]);
    const d1Labels = new Set(deriveLabelSeeds(D1_PROFILE));
    for (const seed of [
      ...D2_PROFILE.behaviorSeeds.train,
      ...D2_PROFILE.behaviorSeeds.validation,
      ...D2_PROFILE.behaviorSeeds.test,
      ...deriveLabelSeeds(D2_PROFILE),
    ]) {
      expect(d1Behavior.has(seed)).toBe(false);
      expect(d1Labels.has(seed)).toBe(false);
    }
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
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run training/d2Protocol.test.ts`
Expected: FAIL — cannot resolve `./d2Protocol`.

- [ ] **Step 3: Write `training/d2Protocol.ts`**

```ts
import { createHash } from 'node:crypto';
import { hashSeed } from '../src/ai/rng';
import { C0_BASE_SEED, C0_GAMES, C0_HISTORICAL_PAIRED_SEED } from './archivedRepresentativeAudit';
import { fixedReevaluationSeeds } from './publication';

export interface ListwiseProtocolProfile {
  readonly protocolId: string;
  readonly placementSubsetTag: string;
  readonly baseSeed: number;
  readonly behaviorSeeds: Readonly<{
    train: readonly number[]; validation: readonly number[]; test: readonly number[];
  }>;
  readonly behaviorSeedDigest: string;
  readonly labelSeedDigest: string;
}

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

const SPLIT_SIZES = Object.freeze({ train: 20, validation: 8, test: 12 });

export function deriveBehaviorSeeds(baseSeed: number): ListwiseProtocolProfile['behaviorSeeds'] {
  return Object.freeze({
    train: Object.freeze(Array.from({ length: SPLIT_SIZES.train }, (_, i) => hashSeed(baseSeed, 0, i))),
    validation: Object.freeze(Array.from({ length: SPLIT_SIZES.validation }, (_, i) => hashSeed(baseSeed, 1, i))),
    test: Object.freeze(Array.from({ length: SPLIT_SIZES.test }, (_, i) => hashSeed(baseSeed, 2, i))),
  });
}

export function flattenBehaviorSeeds(profile: ListwiseProtocolProfile): readonly number[] {
  return [...profile.behaviorSeeds.train, ...profile.behaviorSeeds.validation, ...profile.behaviorSeeds.test];
}

export function deriveLabelSeeds(profile: ListwiseProtocolProfile): readonly number[] {
  return flattenBehaviorSeeds(profile).flatMap((behaviorSeed) =>
    [0, 1].flatMap((vectorIndex) => [0, 1].flatMap((slotIndex) => [0, 1].map((streamIndex) =>
      hashSeed(profile.baseSeed, 3, behaviorSeed, vectorIndex, slotIndex, streamIndex)))));
}

/** Every seed set consumed by an earlier authorized run. D2 must intersect none of them. */
export function priorSeedSets(profile: ListwiseProtocolProfile): readonly (readonly number[])[] {
  const training = Array.from({ length: 10 }, (_, gen) =>
    Array.from({ length: 5 }, (_, game) => hashSeed(20260727, gen, game))).flat();
  const fixed = fixedReevaluationSeeds(20260727, C0_GAMES);
  const paired = Array.from({ length: C0_GAMES }, (_, game) => hashSeed(C0_HISTORICAL_PAIRED_SEED, game));
  const c0 = Array.from({ length: C0_GAMES }, (_, game) => hashSeed(C0_BASE_SEED, game));
  const sets: (readonly number[])[] = [training, fixed, paired, c0];
  if (profile.baseSeed !== D1_PROFILE.baseSeed) {
    sets.push(flattenBehaviorSeeds(D1_PROFILE), deriveLabelSeeds(D1_PROFILE));
  }
  return sets;
}

export class ListwiseSeedScheduleError extends Error {
  readonly name = 'ListwiseSeedScheduleError';
  constructor() { super('seed-schedule-mismatch'); }
}

export function assertProfileSeedsDisjoint(profile: ListwiseProtocolProfile): void {
  const behavior = flattenBehaviorSeeds(profile);
  const labels = deriveLabelSeeds(profile);
  const prior = new Set(priorSeedSets(profile).flat());
  const ok = behavior.length === 40 && new Set(behavior).size === 40
    && labels.length === 320 && new Set(labels).size === 320
    && digest(profile.behaviorSeeds) === profile.behaviorSeedDigest
    && digest(labels) === profile.labelSeedDigest
    && !behavior.some((seed) => prior.has(seed))
    && !labels.some((seed) => prior.has(seed) || behavior.includes(seed));
  if (!ok) throw new ListwiseSeedScheduleError();
}

function buildProfile(input: Omit<ListwiseProtocolProfile, 'behaviorSeeds' | 'behaviorSeedDigest' | 'labelSeedDigest'>
  & Partial<Pick<ListwiseProtocolProfile, 'behaviorSeedDigest' | 'labelSeedDigest'>>): ListwiseProtocolProfile {
  const behaviorSeeds = deriveBehaviorSeeds(input.baseSeed);
  const partial = { ...input, behaviorSeeds, behaviorSeedDigest: '', labelSeedDigest: '' };
  return Object.freeze({
    ...partial,
    behaviorSeedDigest: input.behaviorSeedDigest ?? digest(behaviorSeeds),
    labelSeedDigest: input.labelSeedDigest ?? digest(deriveLabelSeeds(partial)),
  });
}

export const D1_PROFILE: ListwiseProtocolProfile = buildProfile({
  protocolId: 'd1-action-conditioned-held-out-listwise-v2-variable-cardinality',
  placementSubsetTag: 'd1-placement-subset-v2-variable-cardinality',
  baseSeed: 20260825,
  behaviorSeedDigest: '19da6a75ad75ccc71e8e7238ea01378583ab7f63cd16786ce70fa7228f981341',
  labelSeedDigest: 'a268a5e77c64e68faa4d8cad73727c0623df0531ba0390183742146dc365eb3f',
});

export const D2_PROFILE: ListwiseProtocolProfile = buildProfile({
  protocolId: 'd2-action-conditioned-held-out-listwise-sharded-v1',
  placementSubsetTag: 'd2-placement-subset-v1-sharded',
  baseSeed: 20260902,
});
```

`D1_PROFILE` passes its digests in explicitly so the pinned historical values are asserted rather than regenerated. `D2_PROFILE` computes its own, which Step 6 then pins.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run training/d2Protocol.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Capture the D1 parity baseline BEFORE touching Core**

Per spec §8.1 the parity golden values must be pinned from the current D1 behaviour before the parameterizing edit, and never regenerated afterwards. Run:

```bash
npx tsx -e "import('./training/d1ActionConditionedHeldOutListwiseCore.ts').then((m)=>{const s=m.buildD1SeedManifest();console.log(JSON.stringify({behaviorSeedDigest:s.behaviorSeedDigest,labelSeedDigest:s.labelSeedDigest,labels:m.buildD1LabelSeeds(s).length,tag:m.D1_PLACEMENT_SUBSET_TAG,protocol:m.D1_PROTOCOL_ID}))})"
```

Record the printed JSON verbatim in the task report. It must read `19da6a75…f981341` / `a268a5e7…c365eb3f` / `320` / `d1-placement-subset-v2-variable-cardinality` / `d1-action-conditioned-held-out-listwise-v2-variable-cardinality`. If it does not, stop — the D1 WIP has drifted and the parity baseline is invalid.

- [ ] **Step 6: Pin the computed D2 digests as literal constants**

Print them once:

```bash
npx tsx -e "import('./training/d2Protocol.ts').then((m)=>console.log(JSON.stringify({b:m.D2_PROFILE.behaviorSeedDigest,l:m.D2_PROFILE.labelSeedDigest})))"
```

Then edit `training/d2Protocol.ts` so the `D2_PROFILE` literal passes both digests explicitly, exactly like `D1_PROFILE`, and add to `training/d2Protocol.test.ts`:

```ts
it('pins the D2 digests as pre-registered literals', () => {
  expect(D2_PROFILE.behaviorSeedDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(D2_PROFILE.labelSeedDigest).toMatch(/^[0-9a-f]{64}$/);
  // Both values are the ones printed by the Step 6 command and must never be
  // regenerated. Replace the two regex assertions with the exact literals.
});
```

Replace the two regex assertions with the exact 64-hex literals from the command output. After this step the digests are pre-registered; changing them later is a protocol change, not a fix.

- [ ] **Step 7: Parameterize the D1 Core constants**

In `training/d1ActionConditionedHeldOutListwiseCore.ts`:

1. Import the profile module:
   ```ts
   import { D1_PROFILE, deriveBehaviorSeeds, deriveLabelSeeds, assertProfileSeedsDisjoint,
     flattenBehaviorSeeds, type ListwiseProtocolProfile } from './d2Protocol';
   ```
2. Keep `D1_PROTOCOL_ID`, `D1_PLACEMENT_SUBSET_TAG`, `D1_BEHAVIOR_SEEDS`, `D1_BEHAVIOR_SEED_DIGEST`, `D1_LABEL_SEED_DIGEST` exported (other modules and tests import them) but redefine each as a projection of `D1_PROFILE`, e.g. `export const D1_PLACEMENT_SUBSET_TAG = D1_PROFILE.placementSubsetTag;`.
3. Give the seed functions an optional trailing profile parameter, defaulting to `D1_PROFILE`:
   ```ts
   export function buildD1SeedManifest(profile: ListwiseProtocolProfile = D1_PROFILE): D1SeedManifest
   export function buildD1LabelSeeds(
     manifest: D1SeedManifest = buildD1SeedManifest(),
     profile: ListwiseProtocolProfile = D1_PROFILE,
   ): number[]
   ```
   Replace the hardcoded `hashSeed(20260825, …)` derivations with `deriveBehaviorSeeds(profile.baseSeed)` / `deriveLabelSeeds(profile)`, and replace the inline uniqueness/disjointness assertion block with `assertProfileSeedsDisjoint(profile)` wrapped so it still throws `D1InvalidInputError('seed-schedule-mismatch')`. Delete the now-unused local `historicalSeeds()`.
4. Add `readonly profile?: ListwiseProtocolProfile` to the `captureD1States` input object and thread it into the `buildD1SeedManifest` / `buildD1LabelSeeds` calls.
5. Change `freezeD1PlacementManifest` to `freezeD1PlacementManifest(capture: D1CapturedState, profile: ListwiseProtocolProfile = D1_PROFILE)` and replace the literal `D1_PLACEMENT_SUBSET_TAG` inside the selection digest with `profile.placementSubsetTag`.

In `training/d1ActionConditionedHeldOutListwiseLabels.ts`, replace the two `20260825` literals with `profile.baseSeed`, adding the same optional trailing `profile: ListwiseProtocolProfile = D1_PROFILE` parameter to the functions that contain them.

- [ ] **Step 8: Add the parity assertion to the test**

Append to `training/d2Protocol.test.ts`:

```ts
import { buildD1LabelSeeds, buildD1SeedManifest, D1_PLACEMENT_SUBSET_TAG, D1_PROTOCOL_ID }
  from './d1ActionConditionedHeldOutListwiseCore';

it('parameterization does not change any D1-tag value', () => {
  const manifest = buildD1SeedManifest();
  expect(manifest.behaviorSeedDigest)
    .toBe('19da6a75ad75ccc71e8e7238ea01378583ab7f63cd16786ce70fa7228f981341');
  expect(manifest.labelSeedDigest)
    .toBe('a268a5e77c64e68faa4d8cad73727c0623df0531ba0390183742146dc365eb3f');
  expect(buildD1LabelSeeds(manifest)).toHaveLength(320);
  expect(D1_PLACEMENT_SUBSET_TAG).toBe('d1-placement-subset-v2-variable-cardinality');
  expect(D1_PROTOCOL_ID).toBe('d1-action-conditioned-held-out-listwise-v2-variable-cardinality');
});
```

- [ ] **Step 9: Verify D1 is untouched behaviourally**

Run: `npx vitest run training/d2Protocol.test.ts training/d1ActionConditionedHeldOutListwiseCore.test.ts training/d1ActionConditionedHeldOutListwiseLabels.test.ts`
Expected: PASS. Every previously-passing D1 test must still pass with no snapshot or digest change. Any digest change means the parameterization altered D1 behaviour — revert and redo.

- [ ] **Step 10: Lint, typecheck, package for review**

```bash
npx eslint training/d2Protocol.ts training/d2Protocol.test.ts training/d1ActionConditionedHeldOutListwiseCore.ts training/d1ActionConditionedHeldOutListwiseLabels.ts
npm run typecheck:train
git diff --check
```

Then produce the review package (no commit): copy the pre-task byte snapshot of the two modified files to a scratch baseline directory and emit `git diff --no-index <baseline> <current>` for the exact owned paths only.

---

## Task 2: Shard manifest

**Files:**
- Create: `training/d2ShardManifest.ts`
- Create: `training/d2ShardManifest.test.ts`

**Interfaces:**
- Consumes: `D2_PROFILE`, `ListwiseProtocolProfile` (Task 1); `D1CapturedState`, `D1FrozenSubset`, `captureD1States`, `freezeD1PlacementManifest`, `loadD1Sources` from `d1ActionConditionedHeldOutListwiseCore`; `buildD1ContextTasks` from `d1ActionConditionedHeldOutListwiseLabels`.
- Produces:
  ```ts
  export type D2Phase = 'capture' | 'label-train' | 'label-validation' | 'fit'
    | 'selection' | 'final-freeze' | 'label-test' | 'replay' | 'aggregate';
  export type D2ShardId = string;
  export const D2_PHASE_ORDER: readonly D2Phase[];
  export function phaseDependencies(phase: D2Phase): readonly D2Phase[];
  export interface D2Stage1Manifest {
    readonly protocolId: string; readonly placementSubsetTag: string; readonly schemaVersion: 1;
    readonly runtimeIdentity: D2RuntimeIdentity;
    readonly sourceHashes: Readonly<{ checkpoint: string; log: string }>;
    readonly vectorDigests: Readonly<Record<'gen6-best' | 'gen10-mu', string>>;
    readonly behaviorSeedDigest: string; readonly labelSeedDigest: string;
    readonly captureShardIds: readonly D2ShardId[];
  }
  export interface D2Stage2Manifest {
    readonly stage1Digest: string;
    readonly subsets: readonly D2SubsetCardinality[];
    readonly placementCount: number; readonly contextCount: number;
    readonly shardIds: readonly D2ShardId[];
    readonly legalUniverseDigest: string; readonly placementManifestDigest: string;
    readonly contextManifestDigest: string;
  }
  export function buildD2Stage1Manifest(input: { profile?: ListwiseProtocolProfile; … }): D2Stage1Manifest;
  export function stage1Digest(manifest: D2Stage1Manifest): string;
  export function runIdFor(manifest: D2Stage1Manifest): string;
  export function buildD2Stage2Manifest(input: {
    stage1: D2Stage1Manifest; captures: readonly D1CapturedState[]; profile?: ListwiseProtocolProfile;
  }): D2Stage2Manifest;
  export function shardScheduledPieces(shardId: D2ShardId, stage2: D2Stage2Manifest | null): number;
  ```

---

- [ ] **Step 1: Write the failing manifest tests**

Create `training/d2ShardManifest.test.ts` with these cases (write each body fully; the fixtures come from a `makeCapture()` helper local to the test that produces synthetic `D1CapturedState` values with controllable legal-placement counts):

```ts
import { describe, expect, it } from 'vitest';
import { D2_PROFILE } from './d2Protocol';
import {
  D2_PHASE_ORDER, buildD2Stage1Manifest, buildD2Stage2Manifest, phaseDependencies,
  runIdFor, shardScheduledPieces, stage1Digest,
} from './d2ShardManifest';

describe('D2 stage-1 manifest', () => {
  it('contains no random, time, or machine-read field and is byte-stable', () => {
    const a = buildD2Stage1Manifest({ profile: D2_PROFILE });
    const b = buildD2Stage1Manifest({ profile: D2_PROFILE });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(stage1Digest(a)).toBe(stage1Digest(b));
    expect(runIdFor(a)).toBe(runIdFor(b));
    expect(runIdFor(a)).toMatch(/^d2-[0-9a-f]{16}$/);
  });

  it('enumerates exactly 80 capture shard ids', () => {
    const manifest = buildD2Stage1Manifest({ profile: D2_PROFILE });
    expect(manifest.captureShardIds).toHaveLength(80);
    expect(new Set(manifest.captureShardIds).size).toBe(80);
    expect(manifest.captureShardIds[0]).toBe('capture/train/0/gen6-best');
  });
});

describe('D2 phase DAG', () => {
  it('orders phases and makes the two label-fit phases siblings', () => {
    expect(D2_PHASE_ORDER).toEqual([
      'capture', 'label-train', 'label-validation', 'fit',
      'selection', 'final-freeze', 'label-test', 'replay', 'aggregate',
    ]);
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
    const stage1 = buildD2Stage1Manifest({ profile: D2_PROFILE });
    const captures = makeCaptures({ legalCounts: [9, 17, 12, 2, /* … 160 entries … */] });
    const stage2 = buildD2Stage2Manifest({ stage1, captures, profile: D2_PROFILE });
    const expectedPlacements = captures
      .map((c) => Math.min(12, legalCountOf(c)))
      .reduce((sum, k) => sum + k, 0);
    expect(stage2.placementCount).toBe(expectedPlacements);
    expect(stage2.contextCount).toBe(4 * expectedPlacements);
    expect(stage2.subsets).toHaveLength(160);
  });

  it('is a pure function of the capture receipts', () => {
    const stage1 = buildD2Stage1Manifest({ profile: D2_PROFILE });
    const captures = makeCaptures({ legalCounts: defaultLegalCounts });
    expect(JSON.stringify(buildD2Stage2Manifest({ stage1, captures, profile: D2_PROFILE })))
      .toBe(JSON.stringify(buildD2Stage2Manifest({ stage1, captures, profile: D2_PROFILE })));
  });

  it('enumerates 261 shard ids in total', () => {
    const stage1 = buildD2Stage1Manifest({ profile: D2_PROFILE });
    const stage2 = buildD2Stage2Manifest({
      stage1, captures: makeCaptures({ legalCounts: defaultLegalCounts }), profile: D2_PROFILE,
    });
    expect(stage2.shardIds).toHaveLength(261);
    const byPhase = countBy(stage2.shardIds, (id) => id.split('/')[0]);
    expect(byPhase).toEqual({
      capture: 80, 'label-train': 80, 'label-validation': 32, fit: 2,
      selection: 1, 'final-freeze': 1, 'label-test': 48, replay: 16, aggregate: 1,
    });
  });

  it('rejects L_s < 2 before any label shard exists', () => {
    const stage1 = buildD2Stage1Manifest({ profile: D2_PROFILE });
    const captures = makeCaptures({ legalCounts: withOneEntrySetTo(defaultLegalCounts, 1) });
    expect(() => buildD2Stage2Manifest({ stage1, captures, profile: D2_PROFILE }))
      .toThrow(/placement-manifest-mismatch/);
  });

  it('rejects duplicate state fingerprints', () => {
    const stage1 = buildD2Stage1Manifest({ profile: D2_PROFILE });
    expect(() => buildD2Stage2Manifest({
      stage1, captures: makeCapturesWithDuplicateFingerprint(), profile: D2_PROFILE,
    })).toThrow(/state-fingerprint-mismatch/);
  });
});

describe('shard scheduled-piece accounting', () => {
  it('sizes each shard class for the watchdog ceiling', () => {
    const stage1 = buildD2Stage1Manifest({ profile: D2_PROFILE });
    const stage2 = buildD2Stage2Manifest({
      stage1, captures: makeCaptures({ legalCounts: defaultLegalCounts }), profile: D2_PROFILE,
    });
    expect(shardScheduledPieces('capture/train/0/gen6-best', null)).toBe(512);
    expect(shardScheduledPieces('replay/0', stage2)).toBe(128);
    expect(shardScheduledPieces('fit/action24', stage2)).toBe(0);
    expect(shardScheduledPieces(stage2.shardIds.find((id) => id.startsWith('label-train/'))!, stage2))
      .toBeLessThanOrEqual(6144);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run training/d2ShardManifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `training/d2ShardManifest.ts`**

Shard id grammar (stable, sortable, one `/`-delimited namespace per phase):

```ts
export const D2_PHASE_ORDER = Object.freeze([
  'capture', 'label-train', 'label-validation', 'fit',
  'selection', 'final-freeze', 'label-test', 'replay', 'aggregate',
] as const);

const DEPENDENCIES: Readonly<Record<D2Phase, readonly D2Phase[]>> = Object.freeze({
  capture: [],
  'label-train': ['capture'],
  'label-validation': ['capture'],
  fit: ['label-train'],
  selection: ['label-validation', 'fit'],
  'final-freeze': ['label-train', 'label-validation', 'selection'],
  'label-test': ['final-freeze'],
  replay: ['label-test'],
  aggregate: D2_PHASE_ORDER.slice(0, -1),
});
export const phaseDependencies = (phase: D2Phase) => DEPENDENCIES[phase];
```

- `capture/<split>/<groupOrdinal>/<vectorId>` — 80, iterated split `[train, validation, test]` then ordinal then vector `[gen6-best, gen10-mu]`.
- `label-train/<subsetId>`, `label-validation/<subsetId>`, `label-test/<subsetId>` — the existing `D1FrozenSubset.subsetId`, in canonical subset order.
- `fit/afterstate13`, `fit/action24`; `selection`; `final-freeze`; `replay/<0..15>`; `aggregate`.

`stage1Digest` is SHA-256 over the canonical serialization of the whole stage-1 object; `runIdFor` returns `` `d2-${stage1Digest(manifest).slice(0, 16)}` ``. Runtime identity is written from the frozen constant, never read from `process.versions` — the live check belongs to Task 6 step 0.

`buildD2Stage2Manifest` calls `freezeD1PlacementManifest(capture, profile)` for each capture in canonical order, asserts `legalCount >= 2 && selectedCount === Math.min(12, legalCount)`, asserts 160 unique state fingerprints, builds the per-split and per-group `legalCount` / `selectedCount` histograms (`selectedCount` bins listed completely for K=2..12 including zero bins), derives `placementCount = Σ K_s` and `contextCount = 4 * placementCount`, and computes the legal-universe, placement-manifest and context-manifest digests exactly as the D1 corrective design specifies. It then enumerates the remaining 181 shard ids and returns the frozen object.

`shardScheduledPieces` returns 512 for `capture/*`, `4 * K_s * 128` for `label-*/<subsetId>` (looked up from `stage2.subsets`), 128 for `replay/*`, and 0 for `fit/*`, `selection`, `final-freeze`, `aggregate`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run training/d2ShardManifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, package for review**

```bash
npx eslint training/d2ShardManifest.ts training/d2ShardManifest.test.ts
npm run typecheck:train
```
Emit the owned-path no-index diff package.

---

## Task 3: Evidence store — atomic receipts, run record, run lock

**Files:**
- Create: `training/d2Evidence.ts`
- Create: `training/d2Evidence.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `D2ShardId`, `D2Stage1Manifest`, `D2Stage2Manifest`, `stage1Digest`, `runIdFor` (Task 2).
- Produces:
  ```ts
  export interface D2FileSystem {           // injected; the real one wraps node:fs
    readFile(path: string): string | null;
    writeFileSync(path: string, data: string): void;
    fsyncFile(path: string): void;
    rename(from: string, to: string): void;
    appendLine(path: string, line: string): void;   // O_APPEND + fsync
    readdir(path: string): readonly string[];
    mkdirp(path: string): void;
    exists(path: string): boolean;
    openExclusive(path: string, data: string): boolean;  // 'wx'; false if it exists
  }
  export interface D2Receipt {
    readonly protocolId: string; readonly schemaVersion: 1;
    readonly shardId: D2ShardId; readonly phase: D2Phase;
    readonly manifestDigest: string; readonly stage2Digest: string | null;
    readonly payload: unknown; readonly payloadDigest: string; readonly receiptDigest: string;
  }
  export function writeReceiptAtomic(fs: D2FileSystem, dir: string, receipt: D2Receipt): void;
  export function readValidReceipts(fs: D2FileSystem, dir: string, stage1: D2Stage1Manifest):
    { readonly completed: ReadonlySet<D2ShardId>; readonly receipts: ReadonlyMap<D2ShardId, D2Receipt> };
  export class D2EvidenceIntegrityError extends Error {
    constructor(readonly reason: 'manifest-drift' | 'receipt-corrupt' | 'receipt-regression');
  }
  export type D2TerminationCause = /* the 12-member enum from spec §6.4 */ string;
  export interface D2EpisodeEnd {
    readonly kind: 'episode-end'; readonly endedAt: string; readonly durationMs: number;
    readonly exitCode: number; readonly terminationCause: D2TerminationCause;
    readonly completedShards: number;
    readonly failedShardId: D2ShardId | null; readonly failureReason: string | null;
  }
  export function appendEpisodeStart(fs: D2FileSystem, dir: string, entry: D2EpisodeStart): void;
  export function appendHeartbeat(fs: D2FileSystem, dir: string, entry: D2Heartbeat): void;
  export function appendEpisodeEnd(fs: D2FileSystem, dir: string, entry: D2EpisodeEnd): void;
  export function readRunRecord(fs: D2FileSystem, dir: string): readonly D2RunRecordEntry[];
  export function lastCompletedCount(entries: readonly D2RunRecordEntry[]): number;
  export function lastFailure(entries: readonly D2RunRecordEntry[]):
    { shardId: D2ShardId; reason: string } | null;
  export function adjudicateRunLock(input: {
    fs: D2FileSystem; dir: string; entries: readonly D2RunRecordEntry[];
    isProcessAlive(pid: number): boolean; anyD2ProcessRunning(): boolean;
  }): { readonly outcome: 'acquired' | 'took-over-dead-lock' | 'blocked' };
  ```

---

- [ ] **Step 1: Write the failing evidence tests**

Create `training/d2Evidence.test.ts` using an in-memory `D2FileSystem` fake whose `rename` can be made to throw, so a crash can be injected between `writeFileSync` and `rename`:

```ts
import { describe, expect, it } from 'vitest';
import { makeMemoryFs } from './testUtils.d2';   // local helper created in this task

describe('atomic receipt write', () => {
  it('leaves no receipt when the process dies before rename', () => {
    const fs = makeMemoryFs({ failOn: 'rename' });
    expect(() => writeReceiptAtomic(fs, '/d', receipt)).toThrow();
    expect(fs.exists('/d/receipts/capture/…json')).toBe(false);
    expect(readValidReceipts(fs, '/d', stage1).completed.size).toBe(0);
  });

  it('never calls fsync on a directory', () => {
    const fs = makeMemoryFs();
    writeReceiptAtomic(fs, '/d', receipt);
    expect(fs.calls.filter((c) => c.op === 'fsyncFile' && c.path.endsWith('/'))).toHaveLength(0);
  });

  it('writes temp, fsyncs the file, then renames — in that order', () => {
    const fs = makeMemoryFs();
    writeReceiptAtomic(fs, '/d', receipt);
    expect(fs.calls.map((c) => c.op)).toEqual(['writeFileSync', 'fsyncFile', 'rename']);
  });
});

describe('receipt validation', () => {
  it('rejects a receipt whose payloadDigest does not match', () => { /* expect D2EvidenceIntegrityError('receipt-corrupt') */ });
  it('rejects a receipt bound to a different manifestDigest', () => { /* receipt-corrupt */ });
  it('rejects a shardId absent from the manifest', () => { /* receipt-corrupt */ });
  it('never recomputes a receipt that fails validation', () => { /* assert no write call follows */ });
});

describe('run record', () => {
  it('appends without rename and fsyncs each line', () => { /* ops are appendLine only */ });
  it('discards a truncated trailing line and never rewrites the file', () => {
    const fs = makeMemoryFs({ seed: { '/d/run-record.jsonl': '{"kind":"episode-start"…}\n{"kind":"heart' } });
    const entries = readRunRecord(fs, '/d');
    expect(entries).toHaveLength(1);
    expect(fs.calls.some((c) => c.op === 'writeFileSync' && c.path.endsWith('run-record.jsonl'))).toBe(false);
  });
  it('reports the completed-count baseline as episode-end, else last heartbeat, else 0', () => { /* three cases */ });
  it('carries failedShardId and failureReason on a failure-ended episode', () => { /* round-trip */ });
  it('returns the most recent failure even when completions intervened', () => { /* lastFailure() */ });
});

describe('receipt regression', () => {
  it('fails closed when the completed count drops below the recorded baseline', () => {
    /* expect D2EvidenceIntegrityError('receipt-regression') */
  });
});

describe('run lock adjudication', () => {
  it('acquires a free lock', () => { /* outcome: 'acquired' */ });
  it('takes over only when all three evidence items hold', () => {
    /* dead pid + no D2 process + unpaired episode-start → 'took-over-dead-lock' */
  });
  it('blocks when the pid is alive', () => { /* 'blocked' */ });
  it('blocks when a D2 process is running', () => { /* 'blocked' */ });
  it('blocks when the episode has a paired episode-end', () => { /* 'blocked' */ });
  it('never deletes a lock it did not adjudicate as dead', () => { /* no unlink call */ });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run training/d2Evidence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `training/d2Evidence.ts` and the memory-fs helper**

Directory layout is exactly spec §6.1. `writeReceiptAtomic` performs `writeFileSync(tmp)` → `fsyncFile(tmp)` → `rename(tmp, final)` and nothing else; there is deliberately no parent-directory fsync (spec §6.2). `readValidReceipts` ignores leftover temp files, validates schema / `shardId ∈ manifest` / `manifestDigest` / `payloadDigest` / `receiptDigest`, and throws `D2EvidenceIntegrityError('receipt-corrupt')` on the first failure without attempting recomputation.

`appendEpisodeStart|Heartbeat|End` use `appendLine` only. `readRunRecord` parses line by line and silently drops a malformed final line.

`adjudicateRunLock` implements spec §7.1.1's three-item checklist; it returns `blocked` unless all three hold, and only ever removes a lock it has adjudicated dead.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run training/d2Evidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the `diagnostics/` ignore block**

Append to `.gitignore`, matching the file's existing commented style:

```gitignore
# D2 diagnostic evidence. Run-scoped receipts, manifests and run records; the
# whole directory, because a run id is derived per protocol/input identity.
# NOT under public/ — Vite copies that directory verbatim into dist.
diagnostics/
```

- [ ] **Step 6: Lint, typecheck, package for review**

```bash
npx eslint training/d2Evidence.ts training/d2Evidence.test.ts
npm run typecheck:train
git check-ignore -v diagnostics/x   # must report the new rule
```

---

## Task 4: Payload-blind scheduler and capability registry

**Files:**
- Create: `training/d2Scheduler.ts`
- Create: `training/d2Scheduler.test.ts`

**Interfaces:**
- Consumes: `D2Phase`, `D2ShardId`, `phaseDependencies`, `D2Stage2Manifest` (Task 2); `D2Receipt` (Task 3).
- Produces:
  ```ts
  export function scheduleD2(
    manifest: { readonly shardIds: readonly D2ShardId[] },
    completed: ReadonlySet<D2ShardId>,
  ): readonly D2ShardId[];
  export class D2FreezeBoundaryError extends Error {
    constructor(readonly reason: 'test-before-freeze');
  }
  export function assertD2FreezeBoundary(completed: ReadonlySet<D2ShardId>): void;
  export interface D2PayloadCapability { readonly phase: D2Phase; }
  export function grantD2PayloadCapability(
    phase: D2Phase, receipts: ReadonlyMap<D2ShardId, D2Receipt>, completed: ReadonlySet<D2ShardId>,
  ): D2PayloadCapability;
  export function readD2Payloads(
    capability: D2PayloadCapability, from: D2Phase,
  ): readonly unknown[];
  ```

`scheduleD2` takes **no receipts and no payloads** — its signature is the enforcement. `grantD2PayloadCapability` returns an opaque token registered in a module-private `WeakMap`; `readD2Payloads` throws unless the token is registered, the requested `from` phase is permitted for the holder's phase, and that phase is 100 % complete.

---

- [ ] **Step 1: Write the failing scheduler tests**

```ts
describe('payload-blind scheduler', () => {
  it('accepts only the manifest and the completed id set', () => {
    expect(scheduleD2.length).toBe(2);
  });

  it('returns the same schedule regardless of payload values', () => {
    const first = scheduleD2(manifest, completed);
    mutateEveryPayloadValue(receipts);       // outcomes changed, ids unchanged
    expect(scheduleD2(manifest, completed)).toEqual(first);
  });

  it('schedules label-train and label-validation together once capture completes', () => {
    const ready = scheduleD2(manifest, new Set(allCaptureIds));
    expect(ready.some((id) => id.startsWith('label-train/'))).toBe(true);
    expect(ready.some((id) => id.startsWith('label-validation/'))).toBe(true);
    expect(ready.some((id) => id.startsWith('fit/'))).toBe(false);
  });

  it('does not schedule label-test before final-freeze', () => {
    const ready = scheduleD2(manifest, new Set([...allCaptureIds, ...allLabelFitIds, 'fit/afterstate13',
      'fit/action24', 'selection']));
    expect(ready.some((id) => id.startsWith('label-test/'))).toBe(false);
  });

  it('schedules aggregate only when the other 260 shards are complete', () => {
    expect(scheduleD2(manifest, new Set(manifest.shardIds.filter((id) => id !== 'aggregate'))))
      .toEqual(['aggregate']);
  });
});

describe('freeze boundary under resume', () => {
  it('rejects a test receipt with no final-freeze receipt', () => {
    expect(() => assertD2FreezeBoundary(new Set(['label-test/train-0-gen6-best-128'])))
      .toThrow(D2FreezeBoundaryError);
  });
  it('rejects scheduling any fit-side shard once a test receipt exists', () => {
    const completed = new Set([...everythingThroughFinalFreeze, 'label-test/…']);
    expect(scheduleD2(manifest, completed).some((id) =>
      id.startsWith('fit/') || id === 'selection' || id === 'final-freeze')).toBe(false);
  });
});

describe('(phase, split) payload capability', () => {
  it.each([
    ['fit', 'label-validation'], ['fit', 'label-test'],
    ['selection', 'label-test'], ['final-freeze', 'label-test'],
    ['label-test', 'final-freeze'], ['label-test', 'label-train'],
    ['label-train', 'label-validation'],
  ])('denies %s access to %s payloads', (holder, target) => {
    const cap = grantD2PayloadCapability(holder as D2Phase, receipts, completed);
    expect(() => readD2Payloads(cap, target as D2Phase)).toThrow();
  });

  it.each([
    ['fit', 'label-train'], ['selection', 'label-validation'], ['selection', 'fit'],
    ['final-freeze', 'label-train'], ['final-freeze', 'label-validation'],
    ['replay', 'label-test'], ['aggregate', 'label-test'], ['aggregate', 'final-freeze'],
  ])('allows %s access to %s payloads', (holder, target) => {
    const cap = grantD2PayloadCapability(holder as D2Phase, receipts, completed);
    expect(() => readD2Payloads(cap, target as D2Phase)).not.toThrow();
  });

  it('rejects a forged, copied, or spread capability token', () => {
    const cap = grantD2PayloadCapability('fit', receipts, completed);
    expect(() => readD2Payloads({ ...cap }, 'label-train')).toThrow();
    expect(() => readD2Payloads(JSON.parse(JSON.stringify(cap)), 'label-train')).toThrow();
    expect(() => readD2Payloads({ phase: 'fit' } as never, 'label-train')).toThrow();
  });

  it('denies access while the source phase is incomplete', () => {
    const cap = grantD2PayloadCapability('fit', receipts, new Set(someLabelTrainIds));
    expect(() => readD2Payloads(cap, 'label-train')).toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run training/d2Scheduler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `training/d2Scheduler.ts`**

The permission matrix is a frozen `Record<D2Phase, readonly D2Phase[]>` transcribed verbatim from spec §5.3:

```ts
const READABLE: Readonly<Record<D2Phase, readonly D2Phase[]>> = Object.freeze({
  capture: [],
  'label-train': [], 'label-validation': [], 'label-test': [],
  fit: ['label-train'],
  selection: ['label-validation', 'fit'],
  'final-freeze': ['label-train', 'label-validation', 'selection'],
  replay: ['label-test'],
  aggregate: ['label-train', 'label-validation', 'label-test', 'fit', 'selection', 'final-freeze'],
});
```

Label phases read only the stage-2 manifest, which is passed to them as a construction argument rather than through the capability — hence the empty rows. `aggregate`'s grant carries the frozen final models and the test features/outcomes but exposes no fitter, optimizer, normalizer, or refit entry point; the module exports no such function to an `aggregate` holder.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run training/d2Scheduler.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, package for review**

```bash
npx eslint training/d2Scheduler.ts training/d2Scheduler.test.ts
npm run typecheck:train
```

---

## Task 5: Watchdog and exit projections

**Files:**
- Create: `training/d2Watchdog.ts`
- Create: `training/d2Watchdog.test.ts`
- Create: `training/d2Exit.ts`
- Create: `training/d2Exit.test.ts`

**Interfaces:**
- Consumes: `shardScheduledPieces` (Task 2); `D2FileSystem`, `D2TerminationCause`, `lastFailure`, `writeReceiptAtomic` (Task 3).
- Produces:
  ```ts
  export function perShardCeilingMs(shardId: D2ShardId, stage2: D2Stage2Manifest | null): number;
  export interface D2WatchdogState {
    readonly inFlight: ReadonlyMap<D2ShardId, number>;   // shardId -> dispatch monotonic ms
    readonly lastCompletionMs: number;
  }
  export function watchdogVerdict(state: D2WatchdogState, nowMs: number, stage2: D2Stage2Manifest | null):
    { readonly kind: 'ok' } |
    { readonly kind: 'shard-timeout'; readonly shardId: D2ShardId } |
    { readonly kind: 'no-progress-timeout' };

  export type D2ExitClass = 'pre-veto' | 'episode-incomplete' | 'input-feasibility-veto'
    | 'evidence-integrity-veto' | 'terminal-runtime-fail' | 'aggregate-verdict' | 'last-resort';
  export function classifyD2Exit(reason: string): D2ExitClass;
  export function exitCodeForStatus(status: string): 0 | 1;
  export function writeResultOnce(fs: D2FileSystem, dir: string, canonical: string): 'written' | 'already-exists';
  export function shouldPromoteToRuntimeFail(
    previous: { shardId: D2ShardId; reason: string } | null,
    current: { shardId: D2ShardId; reason: string },
  ): boolean;
  ```

---

- [ ] **Step 1: Write the failing watchdog tests**

```ts
describe('per-shard ceiling', () => {
  it('is 20x the anchored cost with a 300s floor', () => {
    expect(perShardCeilingMs('capture/train/0/gen6-best', null)).toBe(20 * 512 * 150);
    expect(perShardCeilingMs('replay/0', stage2)).toBe(300_000);        // floor
    expect(perShardCeilingMs('fit/action24', stage2)).toBe(300_000);    // floor
    expect(perShardCeilingMs(kTwelveLabelShardId, stage2)).toBe(20 * 6144 * 150);
  });
});

describe('run-level no-progress ceiling', () => {
  it('does not fire while a healthy long shard is still inside its own ceiling', () => {
    const state = { inFlight: new Map([[kTwelveLabelShardId, 0]]), lastCompletionMs: 0 };
    expect(watchdogVerdict(state, 31 * 60_000, stage2)).toEqual({ kind: 'ok' });
  });

  it('fires when nothing completed for 30 min and every in-flight shard is past its ceiling', () => {
    const state = { inFlight: new Map([['replay/0', 0]]), lastCompletionMs: 0 };
    expect(watchdogVerdict(state, 31 * 60_000, stage2)).toEqual({ kind: 'no-progress-timeout' });
  });

  it('fires with an empty in-flight set — the dispatcher-hang case', () => {
    const state = { inFlight: new Map(), lastCompletionMs: 0 };
    expect(watchdogVerdict(state, 31 * 60_000, stage2)).toEqual({ kind: 'no-progress-timeout' });
  });

  it('reports shard-timeout before no-progress when a single shard is overdue', () => {
    const state = { inFlight: new Map([['replay/0', 0]]), lastCompletionMs: 29 * 60_000 };
    expect(watchdogVerdict(state, 301_000, stage2)).toEqual({ kind: 'shard-timeout', shardId: 'replay/0' });
  });
});
```

- [ ] **Step 2: Write the failing exit tests**

```ts
describe('exit classification', () => {
  it.each([
    ['runtime-identity-mismatch', 'pre-veto'],
    ['placement-manifest-mismatch', 'input-feasibility-veto'],
    ['capture-missing-or-invalid', 'input-feasibility-veto'],
    ['seed-schedule-mismatch', 'input-feasibility-veto'],
    ['manifest-drift', 'evidence-integrity-veto'],
    ['receipt-corrupt', 'evidence-integrity-veto'],
    ['receipt-regression', 'evidence-integrity-veto'],
    ['test-before-freeze', 'terminal-runtime-fail'],
    ['evidence-dir-out-of-bounds', 'terminal-runtime-fail'],
    ['shard-timeout', 'episode-incomplete'],
    ['no-progress-timeout', 'episode-incomplete'],
    ['run-locked', 'episode-incomplete'],
    ['trainer-lock-present', 'episode-incomplete'],
    ['resume-budget-exhausted', 'episode-incomplete'],
    ['barren-episode-budget-exhausted', 'episode-incomplete'],
  ])('puts %s in class %s', (reason, expected) => {
    expect(classifyD2Exit(reason)).toBe(expected);
  });
});

describe('exit code', () => {
  it('derives from canonical status, not from a stored field', () => {
    expect(exitCodeForStatus('pass-action-conditioned-listwise-supported')).toBe(0);
    for (const status of ['invalid-input', 'runtime-fail',
      'fail-joint-selection-not-shown', 'fail-representation-gain-not-held-out']) {
      expect(exitCodeForStatus(status)).toBe(1);
    }
  });
});

describe('result.json is write-once', () => {
  it('writes when absent and refuses to overwrite', () => {
    const fs = makeMemoryFs();
    expect(writeResultOnce(fs, '/d', '{"a":1}')).toBe('written');
    expect(writeResultOnce(fs, '/d', '{"a":2}')).toBe('already-exists');
    expect(fs.readFile('/d/result.json')).toBe('{"a":1}');
  });
});

describe('runtime-fail promotion', () => {
  it('promotes only on the same shard with the same reason', () => {
    expect(shouldPromoteToRuntimeFail({ shardId: 's', reason: 'r' }, { shardId: 's', reason: 'r' })).toBe(true);
    expect(shouldPromoteToRuntimeFail({ shardId: 's', reason: 'r' }, { shardId: 's', reason: 'q' })).toBe(false);
    expect(shouldPromoteToRuntimeFail({ shardId: 't', reason: 'r' }, { shardId: 's', reason: 'r' })).toBe(false);
    expect(shouldPromoteToRuntimeFail(null, { shardId: 's', reason: 'r' })).toBe(false);
  });
});
```

- [ ] **Step 3: Run both to confirm failure**

Run: `npx vitest run training/d2Watchdog.test.ts training/d2Exit.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement both modules**

`perShardCeilingMs = Math.max(300_000, 20 * shardScheduledPieces(id, stage2) * 150)`.

`watchdogVerdict` checks the per-shard ceiling first and returns the earliest-dispatched overdue shard; then, only if `nowMs - lastCompletionMs >= 1_800_000` **and** every in-flight shard is past its own ceiling (vacuously true for an empty set), returns `no-progress-timeout`.

`classifyD2Exit` is a frozen reason→class map transcribed from spec §5.4.0 and §10.1; an unknown reason maps to `episode-incomplete`, which is the safe default because it keeps the run resumable rather than manufacturing a verdict.

`writeResultOnce` checks existence first and otherwise delegates to the Task 3 atomic write.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run training/d2Watchdog.test.ts training/d2Exit.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint, typecheck, package for review**

```bash
npx eslint training/d2Watchdog.ts training/d2Watchdog.test.ts training/d2Exit.ts training/d2Exit.test.ts
npm run typecheck:train
```

---

## Task 6: Orchestrator, worker entry, CLI

**Files:**
- Create: `training/d2ShardedHeldOutListwise.ts`
- Create: `training/d2ShardedHeldOutListwiseWorker.ts`
- Create: `training/d2ShardedHeldOutListwise.test.ts`
- Modify: `package.json` (scripts block)

**Interfaces:**
- Consumes: everything from Tasks 1–5; `runD1Context`, `buildD1ContextTasks`, `materializeD1LabeledBatch`, `consumeD1TestLabelCapability` from `d1ActionConditionedHeldOutListwiseLabels`; `fitD1TrainingRepresentation`, `selectD1Lambda`, `freezeD1FinalModels`, `consumeD1FinalBundleForTest`, `evaluateD1HeldOut` from `d1ActionConditionedHeldOutListwiseFit`; `WorkerPool` shape mirrored from `d1ActionConditionedHeldOutListwise`.
- Produces:
  ```ts
  export interface D2Dependencies {
    readonly fs?: D2FileSystem;
    readonly now?: () => number;
    readonly clock?: () => string;                    // UTC ISO-8601
    readonly runtimeIdentity?: () => D2RuntimeIdentity;
    readonly pool?: D2PoolLike;
    readonly workerCount?: number;
    readonly signal?: AbortSignal;
    readonly profile?: ListwiseProtocolProfile;
    readonly trainerLockPresent?: () => boolean;
    readonly isProcessAlive?: (pid: number) => boolean;
    readonly anyD2ProcessRunning?: () => boolean;
  }
  export interface D2Outcome {
    readonly kind: 'run-verdict' | 'episode-incomplete' | 'pre-veto' | 'last-resort';
    readonly stdout: string; readonly stderr: string; readonly exitCode: 0 | 1;
  }
  export async function runD2Episode(deps?: D2Dependencies): Promise<D2Outcome>;
  export async function runD2Main(deps?: { process?: D2MainProcessLike } & D2Dependencies): Promise<void>;
  ```

---

- [ ] **Step 1: Write the failing orchestrator tests**

```ts
describe('startup sequence', () => {
  it('checks runtime identity before deriving any digest or runId', async () => {
    const fs = makeMemoryFs();
    const out = await runD2Episode({ fs, runtimeIdentity: () => ({ node: '20.0.0', v8: 'x', platform: 'win32-x64' }) });
    expect(out.kind).toBe('pre-veto');
    expect(JSON.parse(out.stdout).failureReasons).toContain('runtime-identity-mismatch');
    expect(fs.calls.some((c) => c.op === 'mkdirp')).toBe(false);
    expect(fs.exists('/…/result.json')).toBe(false);
  });

  it('replays an existing result.json before touching the lock', async () => {
    const fs = makeMemoryFs({ seed: { [`${dir}/result.json`]: canonicalPassResult } });
    const out = await runD2Episode({ fs, ...frozenIdentity });
    expect(out.stdout).toBe(canonicalPassResult);
    expect(out.exitCode).toBe(0);
    expect(fs.calls.some((c) => c.op === 'openExclusive')).toBe(false);
    expect(fs.calls.some((c) => c.op === 'appendLine')).toBe(false);
  });

  it('returns episode-incomplete when the repository trainer lock exists', async () => {
    const out = await runD2Episode({ fs: makeMemoryFs(), ...frozenIdentity, trainerLockPresent: () => true });
    expect(out.kind).toBe('episode-incomplete');
    expect(JSON.parse(out.stdout).terminationCause).toBe('trainer-lock-present');
  });
});

describe('resume equivalence', () => {
  it('produces a byte-identical canonical verdict projection across three partitions', async () => {
    const single = await runToCompletion(makeFakePipeline(), { interruptAfter: [] });
    const byPhase = await runToCompletion(makeFakePipeline(), { interruptAfter: ['capture', 'fit', 'label-test'] });
    const random = await runToCompletion(makeFakePipeline(), { interruptAfter: randomShardCuts(7) });
    expect(byPhase.canonical).toBe(single.canonical);
    expect(random.canonical).toBe(single.canonical);
    expect(byPhase.resultDigest).toBe(single.resultDigest);
    expect(random.resultDigest).toBe(single.resultDigest);
  });

  it('excludes runProvenance from the digest, and runProvenance really differs', async () => {
    const single = await runToCompletion(makeFakePipeline(), { interruptAfter: [] });
    const split = await runToCompletion(makeFakePipeline(), { interruptAfter: ['capture', 'fit'] });
    expect(split.runProvenance.episodes).not.toBe(single.runProvenance.episodes);
    expect(split.resultDigest).toBe(single.resultDigest);
  });
});

describe('worker-count invariance', () => {
  it('produces identical receipts and canonical projection for 1, 4 and 8 workers', async () => {
    const results = await Promise.all([1, 4, 8].map((workerCount) =>
      runToCompletion(makeFakePipeline(), { workerCount })));
    expect(results[1].canonical).toBe(results[0].canonical);
    expect(results[2].canonical).toBe(results[0].canonical);
    expect(results[1].receiptDigests).toEqual(results[0].receiptDigests);
  });
});

describe('write boundary', () => {
  it('writes nothing outside diagnostics/<runId>/ and never touches the trainer lock', async () => {
    const fs = makeMemoryFs();
    await runToCompletion(makeFakePipeline(), { fs });
    for (const call of fs.calls.filter((c) => c.op !== 'readFile' && c.op !== 'exists' && c.op !== 'readdir')) {
      expect(call.path.startsWith(`diagnostics/${expectedRunId}/`)).toBe(true);
    }
  });
});

describe('runtime-fail promotion across restarts', () => {
  it('promotes on the second startup by reading run-record.jsonl from disk', async () => {
    const fs = makeMemoryFs();
    const first = await runD2Episode({ fs, ...frozenIdentity, pool: poolFailing('replay/0', 'replay-mismatch') });
    expect(first.kind).toBe('episode-incomplete');
    const second = await runD2Episode({ fs, ...frozenIdentity, pool: poolFailing('replay/0', 'replay-mismatch') });
    expect(second.kind).toBe('run-verdict');
    expect(JSON.parse(second.stdout).status).toBe('runtime-fail');
    expect(fs.readFile(`diagnostics/${expectedRunId}/result.json`)).not.toBeNull();
  });

  it('does not promote when the second failure names a different shard', async () => { /* stays episode-incomplete */ });
});

describe('episode budgets', () => {
  it('does not consume maxProductiveEpisodes on a zero-output episode', async () => { /* 6 barren + 1 productive still allowed */ });
  it('reports budget exhaustion as episode-incomplete, never as a verdict', async () => { /* kind === 'episode-incomplete' */ });
});

describe('signal and crash paths', () => {
  it.each(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection', 'completed'])(
    'writes an episode-end with endedAt, durationMs, exitCode and terminationCause for %s',
    async (path) => { /* assert all four fields present */ });

  it('records episode-abandoned for an unpaired episode-start on the next startup', async () => { /* … */ });

  it('emits a heartbeat on the configured interval', async () => { /* fake clock advance */ });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run training/d2ShardedHeldOutListwise.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the worker entry**

`training/d2ShardedHeldOutListwiseWorker.ts` mirrors the D1 worker exactly, importing `runD1Context` and posting `{ kind: 'result' | 'failure' }`. It is a separate file because the worker URL must resolve to a D2-owned module so a future D2-specific task type can be added without touching the D1 worker.

- [ ] **Step 4: Implement the orchestrator**

Startup order is spec §7.1 exactly: step 0 runtime identity → step 1 `result.json` replay → step 2 lock (via `adjudicateRunLock`) → step 3 trainer lock → step 4 manifests → step 5 receipts → step 6 regression baseline → step 7 `episode-start`.

The episode loop repeatedly calls `scheduleD2(manifest, completed)`, dispatches ready shards to the pool up to `workerCount`, ticks the watchdog, writes each completed shard's receipt atomically, and updates `completed`. Shard execution dispatches by phase to the existing D1 functions through the Task 4 capability. Signal handlers, `process.on('exit')` (sync I/O only), and a `finally` block guarantee an `episode-end`.

- [ ] **Step 5: Add the npm script**

In `package.json`, immediately after the existing `diagnose:action-conditioned-listwise` entry:

```json
"diagnose:d2-sharded-listwise": "tsx training/d2ShardedHeldOutListwise.ts",
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run training/d2ShardedHeldOutListwise.test.ts`
Expected: PASS. **Never** run the script itself — that would be the operational gate.

- [ ] **Step 7: Lint, typecheck, build, package for review**

```bash
npx eslint training/d2ShardedHeldOutListwise.ts training/d2ShardedHeldOutListwiseWorker.ts training/d2ShardedHeldOutListwise.test.ts
npm run typecheck:train
npm run build
git diff --check
```

---

## Task 7: Full-suite gate and spec conformance sweep

**Files:**
- Modify: any file whose gate item is not yet satisfied (no new files expected)

**Interfaces:**
- Consumes: all of Tasks 1–6.
- Produces: a conformance table mapping each of the 21 code-gate items in spec §12.2 to the exact test that proves it.

---

- [ ] **Step 1: Build the conformance table**

For each of the 21 items in spec §12.2, record the exact `file::test name` that proves it. Items 1–19 should already be covered by Tasks 1–6. Any item with no test is a gap — write the missing test now, in the module that owns the behaviour.

- [ ] **Step 2: Run the D2 suite plus the D1 suite**

```bash
npx vitest run training/d2Protocol.test.ts training/d2ShardManifest.test.ts training/d2Evidence.test.ts training/d2Scheduler.test.ts training/d2Watchdog.test.ts training/d2Exit.test.ts training/d2ShardedHeldOutListwise.test.ts training/d1ActionConditionedHeldOutListwiseCore.test.ts training/d1ActionConditionedHeldOutListwiseLabels.test.ts training/d1ActionConditionedHeldOutListwiseFit.test.ts training/d1ActionConditionedHeldOutListwise.test.ts
```

Expected: all PASS, with the D1 counts unchanged from their pre-Task-1 values.

- [ ] **Step 3: Run the full safe gates**

**`npm test` must NOT be used.** Verified 2026-09-02: `vitest.config.ts` includes `training/**/*.test.ts`, and `training/searchProbe.test.ts` exists as untracked WIP, so `npm test` would execute a protected probe file. Editing `vitest.config.ts` is also out of scope — it is tracked and shared with D1 and the other WIP lines.

Instead run the full suite as an explicit file list that excludes only the protected path (51 test files at time of writing; regenerate the list rather than hardcoding it):

```bash
npx vitest run $(find src training -name '*.test.ts' | grep -v searchProbe | sort | tr '\n' ' ')
npm run lint
npm run build
npm run typecheck:train
git diff --check
```

Confirm the printed file count is exactly the number of `*.test.ts` files under `src/` and `training/` minus one, and that no line of Vitest output names `searchProbe`.

`npm run lint` runs `eslint .`, which lints — but does not execute — every file including the protected probes. Linting is also on the prohibited-verb list, so **use explicit paths there too**: `npx eslint src training --ignore-pattern 'training/searchProbe*.ts'`. Report the substitution in the task report.

- [ ] **Step 4: Verify the untouched-state invariants**

```powershell
Get-FileHash -Algorithm SHA256 "src/ai/trained-weights.json","public/ai/best-weights.json"
Get-FileHash -Algorithm SHA256 "public/ai/score-rate-v5-smoke-20260820-200634/checkpoint.json","public/ai/score-rate-v5-smoke-20260820-200634/training-log.jsonl"
Test-Path "public/ai/score-rate-v5"
Test-Path "diagnostics"
Test-Path (Join-Path $env:TEMP "tetris-trainer-e8bd4f95b4638b0edc32e00052ac16a37dc1a82fad79721cdc7fca1f628f9dbd.lock")
(git diff --cached --name-only | Measure-Object -Line).Lines
```

Expected: both weight hashes `062552496E7E1101502E62B8570DFDAF2A60B54EF4FEF1EA539723B910550D90`; preserved run hashes `93B2A63F…C06BD` and `C8645732…C651BA`; the three `Test-Path` results all `False`; staged count `0`.

- [ ] **Step 5: Independent whole-change review**

Dispatch a fresh author-independent reviewer over the exact owned paths only. Revise until no Critical or Important findings remain. The reviewer must not read, hash, or diff the protected probe paths.

- [ ] **Step 6: Report and stop**

Report the conformance table, all gate outputs, the untouched-state verification, and the review verdict. **Stop.** Running the real D2 diagnostic is a separate operational gate requiring explicit user authorization after a fresh pre-flight.

---

## Self-Review

**Spec coverage.** §3 differences 1–2 → Task 1; §4 pre-registration → Task 1; §5.1–5.2 shards and manifests → Task 2; §5.3 capabilities → Task 4; §5.4 exit classes → Task 5; §6.1–6.4 evidence and run record → Task 3; §6.5 watchdog → Task 5; §7.1–7.1.1 startup and lock → Tasks 3 and 6; §7.2 blindness → Task 4; §7.3 freeze boundary → Task 4; §7.4 budgets → Task 6; §8 run boundary → Task 6 write-boundary test; §8.1 parameterize-in-place and parity → Task 1; §10.1–10.2 statuses and aggregate → Tasks 5 and 6; §12.2 all 21 items → Task 7 conformance table.

**Type consistency.** `D2Phase`, `D2ShardId`, `D2Receipt`, `D2FileSystem`, `ListwiseProtocolProfile` are each defined once in the task that creates their module and referenced by exact name thereafter. `freezeD1PlacementManifest(capture, profile)` and `buildD1SeedManifest(profile)` are the only D1 signatures that change, both with defaults so existing callers compile unchanged.

**Known gap, deliberately left to the executor.** Task 6's shard-execution dispatch to the D1 fit/label functions is specified by phase and capability rather than line-by-line, because the exact call shapes depend on the Task 4 capability object that does not exist yet. The executor must not invent new statistical behaviour there: every call is a pass-through to an existing D1 export, and any need to change a D1 statistical function is a spec deviation that stops the task.
