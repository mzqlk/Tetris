# D1 Variable-Cardinality Corrective Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each task requires TDD plus independent spec-compliance and quality review before the next task.

**Goal:** Replace D1 v1's infeasible exact-12 assumption with the approved v2 `K_s=min(12,L_s)` protocol and produce one independently adjudicated D1 v2 result.

**Architecture:** Preserve the existing D1-only Core -> Labels -> Fit -> Orchestrator boundaries. Core freezes the complete legal universe and variable subset; Labels derives dynamic tasks and labels; Fit removes fixed-12 math while retaining subset-equal loss; Orchestrator publishes variable counts/digests and fail-closed results. Active v5 remains unchanged.

**Tech Stack:** TypeScript, Vitest, Node.js crypto/worker threads, existing engine/SRS/public-state helpers, ESLint, Vite, safe explicit-root TypeScript.

## Global Constraints

- The user's 2026-08-30 instruction `先走完D1路线，再向我汇报` is the explicit bounded authorization for this plan, code gates, and exactly one D1 v2 operational run after those gates are clean. It does not authorize a v1 rerun or production integration/training/benchmark/publication/runtime work. Task 6 must still stop if any technical gate is not clean; no additional operational approval is required when all frozen preconditions are satisfied.
- Use the current `D:\WorkSpace\Tetris` checkout; no branch/worktree.
- Preserve unrelated A+/B1/C0/D1 WIP; no broad-add, stash, reset, restore, checkout, or clean.
- Never read, execute, hash, modify, move, delete, test, typecheck, review, diff, stage, or commit the three `training/searchProbe*` paths. Ordinary `git status` may show only their names.
- Do not modify run artifacts, weights, locks, active v5 feature/search/CEM/train/schema contracts, or package scripts beyond preserving the existing D1 command.
- Keep score-rate-v5/schema 6/13 FEATURE_NAMES/v2 search/depth 4/beams 64/32/budget 3584/corpus-v1/caches 65536/16384/Hold/seven-bag/SRS/survival-first/tie-break/board immutability/fitness unchanged.
- D1 v1 is terminal historical invalid-input evidence and is never rerun.
- No calibration, training, benchmark, publication, push, or browser/runtime acceptance.
- Keep the real index empty; do not stage/commit because owned files overlap protected uncommitted WIP.
- Stop on the first unexplained failure or frozen-interface ambiguity. No retry/input substitution.
- The user's 2026-08-30 `批准` authorizes the reviewed corrective amendment that preserves the public `D1FitSubset` shape and adds Labels-owned, run-bound provenance capabilities consumed by Fit and Task 4. It does not authorize any production/runtime capability or relax any later code/operational gate.

## File Responsibility Map

| File | Responsibility |
| --- | --- |
| `training/d1ActionConditionedHeldOutListwiseCore.ts` + test | v2 protocol, legal universe, variable-K manifest |
| `training/d1ActionConditionedHeldOutListwiseLabels.ts` + test | dynamic tasks/associations/context evidence/labels |
| `training/d1ActionConditionedHeldOutListwiseFit.ts` + test | dynamic normalization, subset-equal fit, held-out metrics |
| `training/d1ActionConditionedHeldOutListwise.ts` + test | v2 canonical result, phase failure, replay/orchestration |
| SDD progress + continuity | append-only gate ledger |

## Frozen Cross-Task Interfaces

Ownership is fixed: Core owns protocol/manifest types; Labels owns task/context/fit-subset projections and is the sole authority that can authenticate their real capture split; Fit owns models, normalization, statistical result and capability-bound statistical state transitions; Orchestrator alone owns top-level invalid-input and canonical output. No private adapter may widen worker payloads. The public `D1FitSubset` shape below remains unchanged.

```ts
export const D1_PROTOCOL_ID =
  'd1-action-conditioned-held-out-listwise-v2-variable-cardinality' as const;
export const D1_REPRESENTATIONS = ['afterstate13', 'action24'] as const;
export type D1Split = 'train' | 'validation' | 'test';
export type D1VectorId = 'gen6-best' | 'gen10-mu';
export type D1RepresentationId = typeof D1_REPRESENTATIONS[number];
export type D1Status =
  | 'invalid-input' | 'runtime-fail'
  | 'fail-joint-selection-not-shown'
  | 'fail-representation-gain-not-held-out'
  | 'pass-action-conditioned-listwise-supported';
export interface D1FrozenSubset {
  readonly subsetId: string;
  readonly capture: D1CapturedState;
  readonly legalCount: number;
  readonly selectedCount: number;
  readonly legalPlacementIds: readonly string[];
  readonly legalUniverseDigest: string;
  readonly placements: readonly D1PlacementCandidate[];
  readonly manifestDigest: string;
}
export interface D1FitSubset {
  readonly subsetId: string;
  readonly placementIds: readonly string[]; // K in 2..12
  readonly features: readonly (readonly number[])[]; // length K
  readonly q: readonly number[]; // length K, sum 1
}
export interface D1EvaluationSubset {
  readonly subsetId: string;
  readonly groupOrdinal: number;
  readonly placementIds: readonly string[]; // K in 2..12
  readonly features: readonly (readonly number[])[];
  readonly outcomes: readonly D1PlacementOutcome[];
  readonly survivalOracle: readonly [number, number, number];
  readonly jointFrontPlacementIds: readonly string[];
}
export interface D1HeldOutResult {
  readonly status: Exclude<D1Status, 'invalid-input'>;
  readonly failureReasons: readonly (D1RuntimeFailureReason | D1StatisticalFailureReason)[];
  readonly metrics: Readonly<Record<D1RepresentationId, D1SelectedMetrics>>;
  readonly seedGroups: readonly D1SeedGroupMetric[];
  readonly cardinalityMetrics: readonly D1CardinalityMetric[];
  readonly gates: Readonly<{
    action24OracleSafe: boolean;
    action24NonLowerSurvival: boolean;
    action24FrontHitFloor: boolean;
    action24FrontHitGain: boolean;
    allSeedGroupsNonNegative: boolean;
    positiveSeedGroupCount: number;
    scoreNonLower: boolean;
    tetrisNonLower: boolean;
    jointStrictImprovement: boolean;
  }>;
  readonly selectedPlacementDigest: string;
  readonly metricProjectionDigest: string;
}
export interface D1SelectedMetrics {
  readonly selectedPlacementIds: readonly string[];
  readonly selectedSurvivalTuples: readonly (readonly [number, number, number])[];
  readonly survivalBelowSubsetOracle: number;
  readonly subsetJointFrontHits: number;
  readonly sumScore: number;
  readonly scheduledPieces: 24576;
  readonly scoreRate: number;
  readonly tetrisNumerator: number;
  readonly tetrisDenominator: number;
  readonly tetrisShare: number;
}
export interface D1SeedGroupMetric {
  readonly groupOrdinal: number;
  readonly afterstate13FrontHits: number;
  readonly action24FrontHits: number;
  readonly groupFrontDelta: number;
}
export interface D1CompletedEvidence {
  readonly source: {
    readonly sourceHashes: Readonly<{ checkpoint: string; log: string }>;
    readonly vectorDigests: Readonly<{ 'gen6-best': string; 'gen10-mu': string }>;
  };
  readonly search: Readonly<{
    contract: 'bag-expectimax-hold-v2'; depth: 4; rootBeamWidth: 64;
    childBeamWidth: 32; maxWorkUnits: 3584; budgetCorpus: 'budget-corpus-v1';
    transpositionCacheEntries: 65536; placementCacheEntries: 16384;
  }>;
  readonly seeds: Readonly<{ behaviorSeedDigest: string; labelSeedDigest: string }>;
  readonly manifest: D1ManifestEvidence;
  readonly labels: D1LabelEvidence;
  readonly fits: Readonly<Record<D1RepresentationId, Readonly<{
    lambda: typeof D1_LAMBDAS[number]; normalizationDigest: string;
    weightDigest: string; convergenceDigest: string;
  }>>>;
  readonly validation: Readonly<Record<D1RepresentationId, Readonly<{
    lambda: typeof D1_LAMBDAS[number]; selectionDigest: string;
    survivalBelowSubsetOracle: number; subsetJointFrontHits: number;
  }>>>;
  readonly heldOut: D1HeldOutResult;
  readonly replays: Readonly<{ count: 16; records: readonly D1ReplayRecord[]; digest: string }>;
}
export type D1DiagnosticResult =
  | D1PrePoolFailureProjection
  | Readonly<{
      mode: typeof D1_PROTOCOL_ID; phase: 'worker' | 'optimizer' | 'test' | 'replay' | 'cleanup';
      status: 'runtime-fail'; failureReasons: readonly D1RuntimeFailureReason[];
      evidence: D1CompletedEvidence | null; resultDigest: string;
    }>
  | Readonly<{
      mode: typeof D1_PROTOCOL_ID; phase: 'complete';
      status: 'fail-joint-selection-not-shown' | 'fail-representation-gain-not-held-out';
      failureReasons: readonly [D1StatisticalFailureReason, ...D1StatisticalFailureReason[]];
      evidence: D1CompletedEvidence; resultDigest: string;
    }>
  | Readonly<{
      mode: typeof D1_PROTOCOL_ID; phase: 'complete';
      status: 'pass-action-conditioned-listwise-supported';
      failureReasons: readonly [];
      evidence: D1CompletedEvidence; resultDigest: string;
    }>;
export type D1InvalidInputReason =
  | 'runtime-identity-mismatch' | 'source-hash-mismatch'
  | 'source-identity-drift' | 'run-contract-mismatch'
  | 'vector-identity-mismatch' | 'seed-schedule-mismatch'
  | 'capture-missing-or-invalid' | 'state-fingerprint-mismatch'
  | 'placement-manifest-mismatch';
export type D1RuntimeFailureReason =
  | 'simulation-failure' | 'worker-pool-failure'
  | 'worker-pool-destroy-failure' | 'optimizer-failure'
  | 'abort' | 'malformed-metrics' | 'test-before-freeze'
  | 'nondeterministic-replay';
export type D1StatisticalFailureReason =
  | 'action24-survival-below-subset-oracle'
  | 'action24-survival-lower-than-afterstate13'
  | 'action24-score-lower-than-afterstate13'
  | 'action24-tetris-share-lower-than-afterstate13'
  | 'joint-score-and-tetris-not-strictly-higher'
  | 'action24-front-hit-floor-not-met'
  | 'action24-front-hit-gain-not-met'
  | 'seed-group-nonnegative-floor-not-met'
  | 'seed-group-positive-floor-not-met';
export interface D1CapturedState {
  readonly split: D1Split;
  readonly groupOrdinal: number;
  readonly behaviorSeed: number;
  readonly behaviorVectorId: D1VectorId;
  readonly behaviorVectorDigest: string;
  readonly captureSlot: 128 | 512;
  readonly state: PublicSearchState;
  readonly score: number;
  readonly lines: number;
  readonly level: number;
  readonly scheduledPieceNumber: 128 | 512;
  readonly sourceDiagnostics: SimulationSearchDiagnostics;
  readonly stateFingerprint: string;
}
export interface D1PlacementCandidate {
  readonly placementId: string;
  readonly placement: Placement;
  readonly boardAfter: Board;
  readonly linesCleared: number;
  readonly placedCells: readonly Position[];
  readonly pending: PendingPreviewState;
  readonly afterstate13: readonly number[];
  readonly action24: readonly number[];
}
export interface D1PlacementOutcome {
  readonly placementId: string;
  readonly pieceCapContexts: number;
  readonly minPieces: number;
  readonly sumPieces: number;
  readonly sumScore: number;
  readonly scoreRate: number;
  readonly totalTetrises: number;
  readonly totalLines: number;
  readonly tetrisNumerator: number;
  readonly tetrisDenominator: number;
  readonly tetrisShare: number;
  readonly clearCounts: LineClearCounts;
}
export interface D1CardinalityMetric {
  readonly selectedCount: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  readonly subsetCount: number;
  readonly afterstate13FrontHits: number;
  readonly action24FrontHits: number;
  readonly action24NonLowerSurvival: number;
  readonly frontDelta: number;
}
export interface D1SubsetCardinalityEvidence {
  readonly subsetId: string;
  readonly split: D1Split;
  readonly groupOrdinal: number;
  readonly behaviorVectorId: D1VectorId;
  readonly captureSlot: 128 | 512;
  readonly stateFingerprint: string;
  readonly legalCount: number;
  readonly selectedCount: number;
  readonly legalUniverseDigest: string;
  readonly selectedPlacementIds: readonly string[];
  readonly selectedPlacementProjections: readonly Pick<D1PlacementCandidate,
    'placementId' | 'boardAfter' | 'linesCleared' | 'placedCells' | 'pending' | 'afterstate13' | 'action24'>[];
  readonly selectedProjectionDigests: readonly string[];
  readonly subsetManifestDigest: string;
}
export interface D1CountHistogramBin {
  readonly count: number;
  readonly subsetCount: number;
}
export interface D1SplitCardinalityHistogram {
  readonly split: D1Split;
  readonly legalCountBins: readonly D1CountHistogramBin[];
  readonly selectedCountBins: readonly D1CountHistogramBin[]; // exact K=2..12, including zero bins
  readonly digest: string;
}
export interface D1GroupCardinalityHistogram {
  readonly groupOrdinal: number;
  readonly subsetCount: 4;
  readonly legalCountBins: readonly D1CountHistogramBin[];
  readonly selectedCountBins: readonly D1CountHistogramBin[]; // exact K=2..12, including zero bins
  readonly digest: string;
}
export interface D1ManifestEvidence {
  readonly stateCount: 160;
  readonly placementCount: number;
  readonly splitCounts: Readonly<{ train: 80; validation: 32; test: 48 }>;
  readonly subsetCardinalities: readonly D1SubsetCardinalityEvidence[];
  readonly splitLegalCounts: Readonly<{ train: number; validation: number; test: number }>;
  readonly splitPlacementCounts: Readonly<{ train: number; validation: number; test: number }>;
  readonly selectedCountHistogram: readonly D1CountHistogramBin[]; // exact K=2..12
  readonly splitCardinalityHistograms: readonly D1SplitCardinalityHistogram[]; // train,validation,test
  readonly groupCardinalityHistograms: readonly D1GroupCardinalityHistogram[]; // ordinals 0..39
  readonly cardinalityDigest: string;
  readonly stateManifestDigest: string;
  readonly legalUniverseDigest: string;
  readonly placementManifestDigest: string;
}
export interface D1LabelEvidence {
  readonly protocol: 'survival-first-joint-pareto-uniform-v2-variable-cardinality';
  readonly primaryContextCount: number;
  readonly trainValidationContextCount: number;
  readonly heldOutContextCount: number;
  readonly streamPrefixCount: 320;
  readonly futurePrefixDigest: string;
  readonly contextManifestDigest: string;
  readonly taskAssociationDigest: string;
  readonly labelDigest: string;
}
export interface D1ReplayRecord {
  readonly taskId: number;
  readonly subsetId: string;
  readonly placementId: string;
  readonly continuationVectorId: D1VectorId;
  readonly streamIndex: 0;
  readonly primaryProjectionDigest: string;
  readonly replayProjectionDigest: string;
}

export interface D1ContextTaskBatch {
  readonly tasks: readonly D1ContextTask[];
  readonly evidence: D1ContextManifestEvidence;
}
export interface D1LabeledSubsetProjection {
  readonly subsetId: string;
  readonly groupOrdinal: number;
  readonly placementIds: readonly string[];
  readonly afterstate13: readonly (readonly number[])[];
  readonly action24: readonly (readonly number[])[];
  readonly outcomes: readonly D1PlacementOutcome[];
  readonly survivalOracle: readonly [number, number, number];
  readonly jointFrontPlacementIds: readonly string[];
  readonly q: readonly number[];
}
export interface D1AuthenticatedLabeledBatch {
  readonly split: D1Split;
  readonly subsets: readonly D1LabeledSubsetProjection[];
  readonly batchDigest: string;
  readonly labelProjectionDigest: string;
}
export interface D1OpaqueRunIdentity {
  readonly kind: 'd1-run-identity';
}
export interface D1ContextTaskBatchAuthority {
  readonly runIdentity: D1OpaqueRunIdentity;
  readonly contextBatch: D1ContextTaskBatch;
}
export interface D1LabeledBatchAuthority {
  readonly runIdentity: D1OpaqueRunIdentity;
  readonly split: D1Split;
  readonly batchDigest: string;
  readonly labelProjectionDigest: string;
}
export interface D1TestLabelAttemptCapability {
  readonly kind: 'd1-test-label-attempt';
}
export interface D1FinalBundleTestAttestation {
  readonly kind: 'd1-final-bundle-test-attestation';
}
```

All parallel per-subset arrays have the same K in 2..12. `D1HeldOutResult` cannot represent invalid-input; Orchestrator maps invalid source/manifest/cardinality evidence before entering Fit. Existing canonical reason unions and precedence remain unchanged and may not be widened without a new design review.

`D1ContextTaskBatch` and `D1AuthenticatedLabeledBatch` are public read-only projections but also carry private module capabilities. Labels stores each authentic object in a `WeakMap` with an unexported fresh run authority and the exact verified canonical source. Its verifiers return only an opaque process-local run-identity object that Labels also authenticates by private `WeakMap`; identity equality is the sole same-run comparison. Object spread, JSON round-trip, identical manually constructed bytes, another run's batch, cross-split use and second materialization are not capabilities. The authority/identity objects never enter serialization, digests, evidence or worker payloads.

`buildD1ContextTasks` returns one authentic `D1ContextTaskBatch` and binds the authority to all 160 revalidated subsets, exact dynamic task ranges and association/context digests. Labels owns these exact internal APIs: `requireD1ContextTaskBatchAuthority(batch): D1ContextTaskBatchAuthority`; `requireD1LabeledBatchAuthority(batch, expectedSplit): D1LabeledBatchAuthority`; `consumeD1TestLabelCapability(finalModels,contextBatch): D1TestLabelAttemptCapability`; `failD1TestLabelAttempt(attempt): void`; and `materializeD1LabeledBatch({contextBatch,split,projections,testAttempt?}): D1AuthenticatedLabeledBatch`. Fit owns `consumeD1FinalBundleForTest(finalModels,expectedRunIdentity): D1FinalBundleTestAttestation`, `failD1FinalBundleTestAttestation(attestation): void`, and completion inside `evaluateD1HeldOut(finalModels,testBatch)`. Labels calls those Fit APIs internally; no Labels API accepts a caller-supplied run identity or attestation to begin test. `materializeD1LabeledBatch` may consume each true split once; it derives the split from the verified capture order, validates every assigned worker projection and returns the exact labeled projection above. The authority types are shape-visible only for typing: every authentic authority/identity/attestation/attempt is also registered in its owning module's private `WeakMap`, and no API accepts an unregistered copy/manual object.

Fit keeps `normalizeD1Rows` and the low-level solver structural for pure arithmetic tests, but their direct results have no operational capability. `fitD1TrainingRepresentation` alone accepts an authenticated train batch and mints one capability for each exact representation/lambda/run/batch digest. `selectD1Lambda` rejects raw/copied/foreign fits and accepts exactly five fits from the same train authority plus the same-run authenticated validation batch. `freezeD1FinalModels` accepts the two selection capabilities and the same train/validation batches, performs each representation's final `[train,validation]` fit exactly once, and mints at most one run-bound final bundle.

Labels owns the opaque `D1TestLabelAttemptCapability`, `consumeD1TestLabelCapability`, `failD1TestLabelAttempt`, test materialization, and the run-level `unconsumed -> in-flight -> materialized|failed` state machine. Fit owns final-bundle state and `consumeD1FinalBundleForTest(finalModels,expectedRunIdentity): D1FinalBundleTestAttestation`. Labels `consumeD1TestLabelCapability(finalModels,contextBatch)` gets the authentic context run identity, calls the Fit verifier, then consumes the returned attestation through Fit's registry validation before atomically starting the Labels attempt. A run identity alone cannot start test; a caller cannot obtain an authentic attestation from selections, raw models, copied final bundles or any pre-freeze value. Orchestrator calls the Labels crossing before the first test worker dispatch; a worker/abort/cleanup failure marks both Labels attempt and Fit final bundle failed before propagating any failure-hook error, while success passes the exact attempt into Labels test materialization and then the exact authenticated test batch plus final bundle into held-out evaluation. `evaluateD1HeldOut` accepts only that same-run pair and completes the Fit transition. Copied/plain/spread/JSON/manual/foreign/cross-split/duplicate-tuple/second-use attestations, attempts or batches are rejected. These are D1 diagnostic-only capability changes; the mathematical solver/tie-break/threshold capabilities remain unchanged.

## Canonical Serialization and Statistical Contract

- Serialize UTF-8 `JSON.stringify` with no whitespace and explicit ordered object construction. Reject `undefined`, NaN and Infinity; canonicalize every permitted numeric `-0` to `+0` before serialization. `resultDigest=sha256(JSON.stringify(resultWithoutResultDigest))`.
- Subset order is split `[train,validation,test]`, group ordinal, behavior vector `[gen6-best,gen10-mu]`, capture slot `[128,512]`; selected placements are placement-ID ascending; contexts then continuation vector and stream.
- Output ordered `D1SubsetCardinalityEvidence[]` exactly as frozen above, including `stateFingerprint`, selected IDs, canonical selected projections, their per-item digests and subset manifest digest. Report global exact K=2..12 selected-count bins, split histograms in `[train,validation,test]` order, and group histograms in ordinal 0..39 order. Legal-count bins are ascending nonzero bins; every selected-count histogram is the complete K=2..12 sequence including zero bins.
- Every digest uses an explicitly constructed preimage that omits its own digest field. A selected projection is first rebuilt as `[placementId,boardAfter,linesCleared,placedCells.map(({x,y})=>[x,y]),[pending.board,[pending.current.type,pending.current.rotation,pending.current.position.x,pending.current.position.y],pending.hold,pending.holdAvailable,pending.unseenBagMask],afterstate13,action24]`; `selectedProjectionDigest` hashes that tuple. `subsetManifestDigest = sha256(JSON.stringify([subsetId,split,groupOrdinal,behaviorVectorId,captureSlot,stateFingerprint,legalCount,selectedCount,legalUniverseDigest,selectedPlacementIds,selectedProjectionDigests]))`. Each split histogram digest hashes `[split,legalCountBins,selectedCountBins]`; each group digest hashes `[groupOrdinal,subsetCount,legalCountBins,selectedCountBins]`. `cardinalityDigest` hashes `[orderedSubsetManifestDigests,selectedCountHistogram,orderedSplitHistogramDigests,orderedGroupHistogramDigests,splitLegalCounts,splitPlacementCounts]`. Global `legalUniverseDigest` hashes the ordered 160 tuple array `[subsetId,stateFingerprint,legalCount,legalPlacementIds,legalUniverseDigest]`; `placementManifestDigest` hashes `[stateManifestDigest,legalUniverseDigest,orderedSubsetManifestDigests,cardinalityDigest]`. Tuple member order here is the canonical key order; no arbitrary object spread is a digest preimage. Independent literal fixtures recompute every digest family.
- K-stratified held-out metrics report subset count, old/new front hits, survival comparisons and front delta for every K=2..12. Empty K strata remain explicit zero-count rows; strata may not be merged/deleted. Each seed group is exactly the arithmetic mean/sum projection of its four equally weighted subsets; placement count never weights a group.
- Preserve the full v1 boundary matrix as permanent tests: action24 oracle regression 0; 48/48 non-lower survival; front hits 35/36; gain 7/8; nonnegative groups 11/12 versus 12/12; positive groups 5/12 versus 6/12; score lower/equal/higher; Tetris lower/equal/higher; strict-improvement equality; exact precedence.
- Pre-pool structured failure has ordered fields `mode,phase,status,failureReasons,source,seeds,completedCounts,manifestDigests,resultDigest`; unfrozen evidence is explicit `null`. It contains no paths, labels, outcomes or partial model evidence. If this projection cannot be safely formed, stdout is empty and stderr is one concise redacted line.

The exact pre-pool projection is:

```ts
export interface D1PrePoolFailureProjection {
  readonly mode: typeof D1_PROTOCOL_ID;
  readonly phase:
    | 'runtime-identity' | 'source' | 'seeds' | 'captures'
    | 'state-fingerprint' | 'legal-universe' | 'placement-manifest'
    | 'cardinality' | 'context-manifest';
  readonly status: 'invalid-input';
  readonly failureReasons: readonly D1InvalidInputReason[];
  readonly source: {
    readonly checkpointHash: string | null;
    readonly logHash: string | null;
    readonly gen6BestDigest: string | null;
    readonly gen10MuDigest: string | null;
  };
  readonly seeds: {
    readonly behaviorSeedDigest: string | null;
    readonly labelSeedDigest: string | null;
  };
  readonly completedCounts: {
    readonly states: number;
    readonly subsets: number;
    readonly splitSubsets: Readonly<{ train: number; validation: number; test: number }>;
    readonly placements: number;
    readonly splitPlacements: Readonly<{ train: number; validation: number; test: number }>;
    readonly contexts: number;
  };
  readonly manifestDigests: {
    readonly state: string | null;
    readonly legalUniverse: string | null;
    readonly placement: string | null;
    readonly cardinality: string | null;
    readonly context: string | null;
    readonly taskAssociation: string | null;
    readonly label: null;
  };
  readonly resultDigest: string;
}
```

Null/count matrix: `runtime-identity` has all source/seed/digest fields null and all total/split counts zero; `source` may expose only already validated source/vector fields; `seeds` may additionally expose validated seed digests; `captures` may expose only complete capture and split-subset counts; `state-fingerprint` may expose state digest only after all 160 unique states freeze; `legal-universe` may expose legal-universe evidence only after all 160 universes validate; `placement-manifest` may additionally expose placement digest and only fully validated total/split placement counts; `cardinality` may additionally expose cardinality digest/totals; `context-manifest` may expose context/task-association digests only after the entire task manifest freezes and then `contexts` must equal `4*placements`; every earlier phase has `contexts=0`. A digest is either validated value or null; a count is either complete validated value or zero, never partial/guessed. Each Task 4 RED injects failure at one exact phase and asserts this matrix.

---

### Task 1: Freeze the v2 legal universe and variable-cardinality manifest

**Files:** Core source/test only.

**Produces:**

```ts
export const D1_PROTOCOL_ID = 'd1-action-conditioned-held-out-listwise-v2-variable-cardinality' as const;
export const D1_PLACEMENT_SUBSET_TAG = 'd1-placement-subset-v2-variable-cardinality' as const;
export interface D1FrozenSubset {
  readonly subsetId: string;
  readonly capture: D1CapturedState;
  readonly legalCount: number;
  readonly selectedCount: number;
  readonly legalPlacementIds: readonly string[];
  readonly legalUniverseDigest: string;
  readonly placements: readonly D1PlacementCandidate[];
  readonly manifestDigest: string;
}
```

- [ ] Write test-owned 0/1/2/9/12/13/17 legal-ID fixtures. 0/1 throw `placement-manifest-mismatch`; 2/9/12 select all; 13/17 select exact digest-first 12 and finally sort by placement ID.
- [ ] Independently compute `sha256(JSON.stringify(sortedLegalIds))`; assert exact counts/digest, replayability, recursive freeze, repeated-byte identity, and action/label/score mutation blindness.
- [ ] Run only the new Core unit-test fixture and observe its expected fixed-12 RED. This is not, and must never invoke, the v1 operational D1 command.
- [ ] Implement minimum v2 guard and selection:

```ts
assert(legalIds.length >= 2 && new Set(legalIds).size === legalIds.length,
  'placement-manifest-mismatch');
const selectedCount = Math.min(12, legalIds.length);
const selected = placements
  .map((entry) => ({ ...entry, selectionDigest: digest([
    capture.stateFingerprint, entry.placementId, D1_PLACEMENT_SUBSET_TAG,
  ]) }))
  .sort((a, b) => a.selectionDigest.localeCompare(b.selectionDigest)
    || a.placementId.localeCompare(b.placementId))
  .slice(0, selectedCount)
  .sort((a, b) => a.placementId.localeCompare(b.placementId));
```

- [ ] Include legal IDs/counts/digest in the manifest projection; do not change features/SRS/transitions.
- [ ] Run Core test twice, exact owned ESLint/diff-check/index-empty.
- [ ] Independent Task 1 review: require PASS/APPROVED and no Critical/Important; fix with focused RED and scoped re-review.

---

### Task 2: Derive variable context tasks, associations, and labels

**Files:** Labels source/test only.

**Produces:**

```ts
export interface D1ContextManifestEvidence {
  readonly placementCount: number;
  readonly primaryContextCount: number;
  readonly trainValidationContextCount: number;
  readonly heldOutContextCount: number;
  readonly contextManifestDigest: string;
  readonly taskAssociationDigest: string;
  readonly selectedCountHistogram: readonly D1CountHistogramBin[];
  readonly splitCardinalityHistograms: readonly D1SplitCardinalityHistogram[];
  readonly groupCardinalityHistograms: readonly D1GroupCardinalityHistogram[];
}
```

- [ ] Write a 160-subset mixed-K RED (including K=2/9/12). Expected placements are `sum(selectedCount)` and tasks are four times that total with consecutive IDs.
- [ ] Independently hash ordered context tuples `[taskId,subsetIndex,placementId,continuationVectorId,streamIndex,labelSeed,prefixDigest]` and association tuples without label seed/prefix.
- [ ] Assert exact split totals plus global/split/group legal/selected histograms and their independent canonical digests, four contexts per placement, no retry/replacement, and unchanged sanitized worker payload.
- [ ] Run Labels+Core focused unit suite and observe legacy fixed-cardinality assertions fail. v2 acceptance uses `sum(K)` and `4*sum(K)` only; 7,680 is never a v2 expected total and no operational command is run.
- [ ] Re-enumerate and validate full legal universe, digest-first selection, replay, counts and canonical order before task creation. Return tasks plus frozen evidence.
- [ ] Make outcomes/q/front loops use `placementIds.length` in 2..12. Preserve four-context scheduled denominator and integer Tetris comparison.
- [ ] Run focused suite twice, exact owned ESLint/diff/index, then independent Task 2 PASS/APPROVED review.

---

### Task 3: Make fitting and held-out evaluation subset-equal for variable K, with authenticated provenance

**Files:** Labels source/test plus Fit source/test only. This four-file scope is the user-approved provenance amendment to the original Fit-only boundary; public `D1FitSubset`, `D1ContextTask` and worker payload shapes remain unchanged.

- [ ] Write mixed K=2/12 normalization RED. Independently compute `N=14` means/std in canonical row order.
- [ ] Prove loss is mean of subset losses, not mean of rows:

```ts
const loss = subsetLosses.reduce((sum, value) => sum + value, +0)
  / subsetLosses.length
  + lambda / 2 * squaredNorm(weights);
```

- [ ] Assert q/features/outcomes lengths equal K; softmax/logit/top-placement loops use K.
- [ ] Assert train normalization uses `sum(train K)`; one final fit per representation uses exactly `[train,validation]` with `sum(train+validation K)`, freezes before test, and rejects test rows.
- [ ] Write provenance REDs before capability production code: copied/plain/spread/JSON/manual context batch cannot materialize labels; each true split materializes once; a test batch cannot call `fitD1TrainingRepresentation`; raw low-level fits cannot enter `selectD1Lambda`; five fits from mixed train batches/runs or duplicated `(representation,lambda)` tuples fail; copied/foreign validation batches fail; final freeze rejects cross-run inputs and a second freeze; copied/plain/spread/JSON/manual/foreign/cross-split/second-use test attempts fail; no caller-provided `split` property is used as origin evidence.
- [ ] Make `buildD1ContextTasks` mint a fresh private run capability and return `D1ContextTaskBatch`. Labels implements `requireD1ContextTaskBatchAuthority`, `materializeD1LabeledBatch`, `requireD1LabeledBatchAuthority`, `consumeD1TestLabelCapability`, and `failD1TestLabelAttempt`; every returned opaque authority/attempt is registry-authenticated by object identity. Validate exact task assignment/projection digest and derive real split from the retained verified subset/task ranges before producing recursively frozen `D1LabeledSubsetProjection` rows and batch/label digests. Train/validation materialization rejects an attempt; test materialization requires the exact in-flight attempt and transitions it to `materialized` or `failed`.
- [ ] Keep structural low-level Fit helpers for arithmetic tests but make their direct results operationally unprivileged. Implement `fitD1TrainingRepresentation`; bind fit capabilities to exact run/train batch/representation/lambda; update `selectD1Lambda` and `freezeD1FinalModels` to require same-run authenticated train/validation authorities, exact five unique lambdas, ordered identities/features/outcomes/survival/front/q and one final fit per representation. Store final bundle authority and `unconsumed|in-flight|materialized|failed` test state in a Fit `WeakMap`, not a shape-only check. Fit owns `consumeD1FinalBundleForTest` plus attestation validation/failure/completion; Labels owns the exported crossing and cannot start it from run identity alone. Any failure transition is irreversible.
- [ ] Build 48 mixed-K held-out subsets from an authenticated test batch. Score denominator remains `48*4*128`; Tetris is one global integer fraction; four subsets remain equally weighted in each of 12 group gates. Restore the exact `D1CardinalityMetric` fields `selectedCount,subsetCount,afterstate13FrontHits,action24FrontHits,action24NonLowerSurvival,frontDelta` for every K=2..12, including zero-count strata that cannot be merged/deleted; `frontDelta=action24FrontHits-afterstate13FrontHits` and no `placementCount` alias remains.
- [ ] Port the complete v1 verdict boundary matrix: 48/48, 35/36, +7/+8, 11/12 versus 12/12 nonnegative groups, 5/12 versus 6/12 positive groups, score/Tetris lower/equal/higher, strict equality, invalid/runtime/statistical precedence.
- [ ] Run Fit+Labels focused unit suite and observe legacy fixed-cardinality slice assertions fail. v2 acceptance uses per-subset K and explicit row offsets only; no v1-mode or old-total assertion is retained.
- [ ] Implement one K validator and explicit row offsets; allocate logits/terms/p/logP from K. Do not change dimensions, lambda grid, binary64 recurrence, Newton/Hessian/Gaussian/Armijo constants, tie-breaks or verdict thresholds. Capability changes are limited exactly to the Labels-owned run/split provenance state machine frozen above.
- [ ] Run Core+Labels+Fit focused suite twice, exact four-file ESLint/diff/index, then independent review explicitly covering provenance origin versus substitution integrity, equal subset loss, normalization domains, exact-five lambda binding, once-only final fit, test freeze, complete cardinality metrics, aggregate formula, and unchanged solver/thresholds.

---

### Task 4: Publish canonical v2 evidence and preserve fail-closed orchestration

**Files:** Orchestrator source/test only.

- [ ] Write fake full-pipeline RED with historical blocker K=9 and other K=2/12 subsets. Assert 160 subsets, 320 streams, dynamic placement/context totals, 16 replays, byte-identical repeated JSON/digest.
- [ ] Replace bare task arrays with the authentic `D1ContextTaskBatch`; derive train/validation/test task ranges from its dynamic evidence/capability. After train+validation worker results, call Labels materialization separately for the true train and validation ranges, then use only capability-bound Fit APIs.
- [ ] Add run-bound test-freeze REDs: authentic run identity alone cannot start test; copied/foreign final bundles, context/final run mismatch, test materialization before final freeze, copied/plain/spread/JSON/manual/foreign/cross-split/second-use attestation or attempt, duplicate/missing/extra test task tuples, second materialization and test-batch use in training all produce `runtime-fail/test-before-freeze`. `consumeD1TestLabelCapability` runs before the test worker call; worker/abort/cleanup failure invokes the Labels/Fit failure crossings, and neither module restores `unconsumed`. Inject a throwing failure hook and prove both sides remain consumed, so no retry is possible even when cleanup itself fails.
- [ ] Require v2 result evidence:

```ts
manifest: {
  stateCount: 160,
  placementCount: number,
  splitCounts: { train: 80, validation: 32, test: 48 },
  subsetCardinalities: Array<{
    subsetId: string,
    split: D1Split,
    groupOrdinal: number,
    behaviorVectorId: D1VectorId,
    captureSlot: 128 | 512,
    stateFingerprint: string,
    legalCount: number,
    selectedCount: number,
    legalUniverseDigest: string,
    selectedPlacementIds: string[],
    selectedPlacementProjections: Array<Pick<D1PlacementCandidate,
      'placementId' | 'boardAfter' | 'linesCleared' | 'placedCells' | 'pending' | 'afterstate13' | 'action24'>>,
    selectedProjectionDigests: string[],
    subsetManifestDigest: string,
  }>,
  splitLegalCounts: { train: number, validation: number, test: number },
  splitPlacementCounts: { train: number, validation: number, test: number },
  selectedCountHistogram: D1CountHistogramBin[],
  splitCardinalityHistograms: D1SplitCardinalityHistogram[],
  groupCardinalityHistograms: D1GroupCardinalityHistogram[],
  cardinalityDigest: string,
  stateManifestDigest: string,
  legalUniverseDigest: string,
  placementManifestDigest: string,
},
labels: {
  protocol: 'survival-first-joint-pareto-uniform-v2-variable-cardinality',
  primaryContextCount: number,
  trainValidationContextCount: number,
  heldOutContextCount: number,
  streamPrefixCount: 320,
  futurePrefixDigest: string,
  contextManifestDigest: string,
  taskAssociationDigest: string,
  labelDigest: string,
}
```

- [ ] Add phase REDs: identity/source/seed/state/legal-universe/manifest/cardinality/digest failures are pre-pool invalid-input; worker/simulation/fit/abort/replay/test-before-freeze are runtime-fail. Assert the exact ordered failure schema, explicit nulls for unfrozen evidence, no path/partial label/outcome/model leakage, and unsafe-failure stdout-empty/stderr-redacted behavior.
- [ ] Run Orchestrator+Fit+Labels+Core focused unit suite and observe only legacy fixed-count unit assertions fail. The v2 acceptance values must be `sum(K)`, `4*sum(K)`, manifest-derived split boundaries, and v2 mode; old 1,920/5,376/7,680 totals are never v2 validity conditions and the operational v1 command is never run.
- [ ] Consume manifest-derived train/validation/test task boundaries; freeze same-run models before one-shot test materialization; materialize one authenticated test batch and pass it only to held-out/replay/evidence; select replay by canonical-first placement; construct explicit ordered v2 projection without arbitrary object spread. Apply the canonical UTF-8/no-whitespace/+0/finite rules and verify test-owned digest literals. Private run authority/identity/attempt metadata must be absent from JSON and every digest.
- [ ] Preserve one stdout JSON line, structured stderr empty, PASS-only exit 0, no file/lock writes, abort-aware destroy and cleanup reasons.
- [ ] Run focused suite twice, exact Orchestrator source/test ESLint and exact two-owned-file diff/index checks, then independent Task 4 PASS/APPROVED review.

---

### Task 5: Whole-change safe code gate

- [ ] Refresh HEAD/branch/ahead-behind/status/index/processes/locks/run/candidate/default-run/published hashes; stop on unexplained drift.
- [ ] Run the previously approved explicit 18-file D1 safe Vitest suite; protected probes must not appear. Stop on first failure; never use bare `npm test`.
- [ ] Run explicit D1/shared ESLint, `npm run build`, and the existing safe explicit-root train typecheck after asserting protected-probe roots are zero.
- [ ] Run exact owned path diff-checks, index-empty, active-v5 invariant checks and artifact/published hash checks.
- [ ] Dispatch separate independent whole-change spec and quality reviewers over design/plan/diffs/evidence. Require PASS/APPROVED and zero Critical/Important. One bounded focused fix/re-review wave only.
- [ ] Append evidence to SDD/continuity; Windows PowerShell 5.1 `Checkpoint -> Resume` with protected excludes must return match.

---

### Task 6: Run one operational D1 v2 and adjudicate

- [ ] Fresh operational pre-flight repeats Git/index/process/lock/run/artifact/hash checks and verifies v2 mode plus continuity match.
- [ ] Choose new non-existing git-ignored v2 stdout/stderr evidence paths; never overwrite v1 logs.
- [ ] Run exactly once: `npm run diagnose:action-conditioned-listwise --silent`. Capture wall time, exit, stdout/stderr bytes/lines/hashes. No retry/substitution/seed/slot/K/threshold change.
- [ ] For one structured JSON line, independently recompute result digest and validate v2 mode, source/search invariants, 160 subsets, dynamic counts/histograms/digests, fit/freeze evidence, held-out gates, and 16 replays.
- [ ] Dispatch fresh read-only adjudicator for protocol validity, statistical or non-statistical classification, two verdicts, and Critical/Important/Minor. Reviewer may not run D1 or modify files.
- [ ] Fresh post-flight; append terminal evidence to SDD/continuity; require `Checkpoint -> Resume match`.
- [ ] Stop regardless of PASS/FAIL/invalid/runtime. Do not enter production integration, training, benchmark, publication, or runtime acceptance.

## Self-Review

- [x] Every corrective-design requirement maps to a task and permanent test.
- [x] Variable selection, legal-universe binding, canonical digests/order, equal-subset loss, normalization/final fit, aggregate formulas, K-stratified evidence, fail-closed phases and replay are explicit.
- [x] No placeholders remain; types and names are consistent across tasks.
- [x] Protected probes and active v5/artifacts/weights are outside all read/write/run/review boundaries.
- [x] Operational D1 is after independent code gates, exactly once, and terminal.
