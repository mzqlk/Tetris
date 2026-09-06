# score-rate-v5 D1 Action-Conditioned Held-Out Listwise Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and independently verify the diagnostic-only D1 action-conditioned held-out listwise protocol, while stopping before the expensive real diagnostic command is run.

**Architecture:** Reuse the already pinned C0 run reader to obtain only `gen6-best` and normalized `gen10-mu`, add a no-op-by-default shared simulator observation/continuation seam, and keep all new feature, label, fit, worker, verdict, replay, and CLI logic in D1-only training modules. Source states and label-blind placement subsets are frozen before labels exist; workers can execute only already-frozen continuation tasks; the fitter cannot access provenance, and test labels remain structurally unavailable until both complete final models (records, weights, and normalization) are immutably frozen.

**Tech Stack:** TypeScript 5.6, Node.js/tsx, Vitest 3, Node `worker_threads`, shared v5 simulator/search/SRS/public-state logic, SHA-256, deterministic ECMAScript binary64 arithmetic.

## Global Constraints

- Before edits, read `AGENTS.md`, `docs/ai-training-handoff.md`, the approved D1 spec, this plan, and the `v5-postmortem` checkpoint; use Windows PowerShell 5.1 with `C:\Users\Administrator\.codex\continuity\protected-probes-v5-postmortem.exclude` for `Locate -> read -> Resume`, then refresh HEAD/branch/ahead-behind/status/index, all Node command lines/CPU/memory, repository/index locks, preserved run entries/timestamps/hashes, candidate/default-run absence, and both published weight hashes.
- Work directly in `D:\WorkSpace\Tetris`; do not create a branch or worktree. Preserve all existing A+/B1/B1.1/B1.2/C0 WIP, especially the overlapping `package.json`, `training/archivedRepresentativeAudit.ts`, `training/archivedRepresentativeAudit.test.ts`, `src/ai/simulate.ts`, and `src/ai/simulate.test.ts` changes.
- Preserve exactly `score-rate-v5`, schema 6, the unchanged 13-entry `FEATURE_NAMES` order, `bag-expectimax-hold-v2`, depth 4, beams 64/32, `maxWorkUnits=3584`, `budget-corpus-v1`, caches 65536/16384, and fitness `meanScore / scheduled maxPieces`.
- Preserve standard Hold, exact seven-bag public information, SRS placement behavior, survival-first ordering, deterministic tie-breaks, browser/Node shared pure logic, and board-row immutability. D1 root list items are current-piece placements only; root Hold is not a list item and no hidden preview may enter a feature or candidate selection.
- Do not modify active `FEATURE_NAMES`, weights, search/search-budget/cache behavior, CEM, trainer, schema, checkpoint/log/candidate formats, browser/runtime AI behavior, or any published/run artifact. The additive simulator seam must be dormant when no D1 hook or frozen continuation is supplied.
- Do not modify, move, delete, archive, or rewrite `public/ai/score-rate-v5-smoke-20260820-200634`, `src/ai/trained-weights.json`, `public/ai/best-weights.json`, any other run artifact, or any repository/TEMP lock.
- Never read, execute, hash, modify, move, delete, stage, commit, typecheck, test, or review `training/searchProbe.ts`, `training/searchProbeWorker.ts`, or `training/searchProbe.test.ts`. Their path names may appear only in ordinary `git status` evidence and explicit exclusion assertions.
- Do not run bare `npm test`, bare repository lint, bare `npm run typecheck:train`, the D1 diagnostic script, any B1 diagnostic, calibration, training/resume/restart, bench, paired benchmark, publication, push, or browser/runtime acceptance.
- Use TDD for every production change: name the behavior break, write one focused test with hand-derived expectations, observe the expected RED, implement the minimum GREEN, and re-run the focused command. Tests must exercise real shared transitions; injected fakes are allowed only around filesystem, worker, runtime identity, and the expensive v5 search loop.
- Run Tasks 1–8 serially. Each Task gets a fresh implementer and then an independent task reviewer that must explicitly return both `spec-compliance PASS/FAIL` and `code-quality APPROVED/NEEDS FIXES`. Every Critical/Important finding enters a focused RED -> minimum GREEN -> independent scoped re-review loop before the next Task.
- Do not commit or stage during Tasks 1–8. Keep the real index empty. The SDD ledger and exact diff packages replace per-task commits because the current workspace contains overlapping protected WIP. Never broad-add, stash, reset, restore, checkout, clean, or normalize unrelated files.
- Before each implementer starts, the controller copies only that Task's exact owned files (or records an explicit absent marker for a new file) into `baseline-task-N/` inside this plan's SDD workspace. After the report, the controller builds one `git diff --no-index -U10` package per exact baseline/current file, concatenated in the Task's declared path order; exit 1 means a diff was produced, while exit >1 is an error. This package, the brief, and the report are the independent review inputs. `BASE_SHA` and `HEAD_SHA` both remain the verified repository HEAD, and no reviewer may infer a commit range. Never snapshot a directory or any protected probe.
- Record task briefs, reports, review packages, fix rounds, commands, exit codes, and verdicts only in this plan's git-ignored SDD workspace. A completed code gate authorizes only a separately preflighted one-time operational D1 diagnostic; it does not itself authorize execution or a production integration.
- A source decision with a committed active-v5 decision and a structurally valid complete diagnostics object is valid even when `budgetExhausted === true` or `completedDepth < 4`; those are expected v5 observations, not missing diagnostics. Null decisions, missing/non-finite fields, impossible counters, errors, aborts, or capture-point gameover fail closed.
- Operational solver identity is checked only at the D1 CLI boundary and is dependency-injected in unit tests. Focused fake-driven code gates must not depend on the controller shell's Node version.

---

## File Responsibility Map

| File | Operation | Responsibility |
| --- | --- | --- |
| `training/archivedRepresentativeAudit.ts` | Modify exact source-loading seam | Export the existing pinned checkpoint/log validation as a reusable C0 run snapshot that does not read published weights or add gen-9 to D1 |
| `training/archivedRepresentativeAudit.test.ts` | Modify | Prove the reusable snapshot shares C0 stable bytes, fails before pool creation on drift, and preserves existing C0 output |
| `src/ai/simulate.ts` | Modify additive seam only | Observe a real v5 pre-action decision and construct a continuation `SimState` backed by an explicit frozen future prefix without changing default simulation |
| `src/ai/simulate.test.ts` | Modify | Prove capture timing/Hold semantics, default parity, prefix consumption, and no board-row mutation |
| `training/d1ActionConditionedHeldOutListwiseCore.ts` | Create | Frozen source/seed contracts, real trajectory captures, canonical state/placement manifests, label-blind subsets, `afterstate13`, and diagnostic-only `action24` |
| `training/d1ActionConditionedHeldOutListwiseCore.test.ts` | Create | Source/vector/seed/capture/fingerprint/subset/SRS/feature/range/no-leak/no-mutation tests |
| `training/d1ActionConditionedHeldOutListwiseLabels.ts` | Create | Compatible future streams, frozen context tasks, exact outcomes, survival tier, Pareto front, and uniform listwise target |
| `training/d1ActionConditionedHeldOutListwiseLabels.test.ts` | Create | Shuffle/digest/draw/Hold/reveal/context/outcome/front tests with real shared transitions and injected search |
| `training/d1ActionConditionedHeldOutListwiseFitInternals.ts` | Create | Task-5-private, production-used Newton direction/controller seam for exact numeric guards and iteration control; imported only by Fit and Fit.test, never re-exported by Fit or consumed downstream |
| `training/d1ActionConditionedHeldOutListwiseFit.ts` | Create | Exact normalization, softmax, damped Newton, lambda selection, immutable freeze record, held-out metrics, verdict, and digests |
| `training/d1ActionConditionedHeldOutListwiseFit.test.ts` | Create | Binary64 recurrence, zero variance, pivot/tie/Armijo/non-convergence, freeze boundary, held-out gates, and precedence |
| `training/d1ActionConditionedHeldOutListwiseWorker.ts` | Create | Worker entry that accepts one frozen continuation task and returns one canonical result; no source/file/fit/verdict authority |
| `training/d1ActionConditionedHeldOutListwise.ts` | Create | Source/materialization freeze, D1 worker pool, 7,680 contexts, 16 replays, canonical result, abort cleanup, and stdout-only CLI |
| `training/d1ActionConditionedHeldOutListwise.test.ts` | Create | Fake-driven end-to-end ordering/count/digest/replay/CLI/no-write/cleanup tests without real 128-piece search |
| `package.json` | Modify one exact script entry | Add `diagnose:action-conditioned-listwise`; preserve every existing script and unrelated byte semantically |

## Frozen Cross-Task Interfaces

Use these exact public names. A later task may add private helpers but must not rename or widen these boundaries.

Interface ownership is frozen per symbol:

- `training/d1ActionConditionedHeldOutListwiseCore.ts` exports `D1_REPRESENTATIONS` and `D1RepresentationId`.
- `training/d1ActionConditionedHeldOutListwiseLabels.ts` exports `D1FitSubset`.
- `training/d1ActionConditionedHeldOutListwiseFit.ts` (Task 5) exports `D1_LAMBDAS`, `D1Normalization`, `D1NormalizedRows`, `D1ModelFreezeRecord`, `D1FinalModel`, `D1FitInput`, and `D1FitResult`.
- `training/d1ActionConditionedHeldOutListwiseFit.ts` (Task 6) exports `D1FinalModelBundle` and `D1ValidationSelection`.
- `D1RuntimeError` is private to the Fit implementation and is not a cross-task interface. It may be defined/exported only inside `d1ActionConditionedHeldOutListwiseFitInternals.ts` so Fit and Fit.test can share the real error path; Fit must not re-export it and downstream maps optimizer exceptions to `D1RuntimeFailureReason` `optimizer-failure`.
- `training/d1ActionConditionedHeldOutListwiseFitInternals.ts` is a Task-5-private module boundary. Its production-used numeric symbols may be imported only by Fit and Fit.test; Fit must not re-export them and Tasks 6–8 must not treat them as cross-task interfaces.

```ts
export const D1_MODE = 'd1-action-conditioned-held-out-listwise-v1' as const;
export const D1_SOURCE_RUN =
  'public/ai/score-rate-v5-smoke-20260820-200634' as const;
export const D1_BASE_SEED = 20260825 as const;
export const D1_CAPTURE_SLOTS = [128, 512] as const;
export const D1_PLACEMENTS_PER_SUBSET = 12 as const;
export const D1_CONTEXT_MAX_PIECES = 128 as const;
export const D1_STREAM_PREFIX_LENGTH = 256 as const;
export const D1_LAMBDAS = [0.0001, 0.001, 0.01, 0.1, 1] as const;
export const D1_REPRESENTATIONS = ['afterstate13', 'action24'] as const;

export type D1Split = 'train' | 'validation' | 'test';
export type D1VectorId = 'gen6-best' | 'gen10-mu';
export type D1RepresentationId = typeof D1_REPRESENTATIONS[number];
export type D1Status =
  | 'pass-action-conditioned-listwise-supported'
  | 'fail-representation-gain-not-held-out'
  | 'fail-joint-selection-not-shown'
  | 'invalid-input'
  | 'runtime-fail';
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

export interface D1Vector {
  id: D1VectorId;
  source: 'gen=6.bestWeights' | 'normalize(checkpoint.mu)';
  weights: number[];
  digest: string;
}

export interface D1CapturedState {
  split: D1Split;
  groupOrdinal: number;
  behaviorSeed: number;
  behaviorVectorId: D1VectorId;
  behaviorVectorDigest: string;
  captureSlot: 128 | 512;
  state: PublicSearchState;
  score: number;
  lines: number;
  level: number;
  scheduledPieceNumber: 128 | 512;
  sourceDiagnostics: SimulationSearchDiagnostics;
  stateFingerprint: string;
}

export interface D1PlacementCandidate {
  placementId: string;
  placement: Placement;
  boardAfter: Board;
  linesCleared: number;
  placedCells: Position[];
  pending: PendingPreviewState;
  afterstate13: number[];
  action24: number[];
}

export interface D1FrozenSubset {
  subsetId: string;
  capture: D1CapturedState;
  placements: readonly D1PlacementCandidate[];
}

export interface D1ContinuationCapture {
  state: PublicSearchState;
  score: number;
  lines: number;
  level: number;
}

export interface D1ContextTask {
  taskId: number;
  subsetId: string;
  placementId: string;
  continuationVectorId: D1VectorId;
  streamIndex: 0 | 1;
  capture: D1ContinuationCapture;
  placement: Placement;
  weights: readonly number[];
  futurePieces: readonly PieceType[];
}

export interface D1ContextProjection {
  taskId: number;
  subsetId: string;
  placementId: string;
  continuationVectorId: D1VectorId;
  streamIndex: 0 | 1;
  pieces: number;
  scoreDelta: number;
  clearCounts: LineClearCounts;
  reason: 'pieceCap' | 'gameover';
  searchDiagnostics: SimulationSearchDiagnostics;
  projectionDigest: string;
}

export interface D1PlacementOutcome {
  placementId: string;
  survivalTuple: readonly [pieceCapContexts: number, minPieces: number, sumPieces: number];
  sumScore: number;
  tetrisNumerator: number;
  tetrisDenominator: number;
  clearCounts: LineClearCounts;
}

export interface D1FitSubset {
  subsetId: string;
  placementIds: readonly string[];
  features: readonly (readonly number[])[];
  q: readonly number[];
}

export interface D1EvaluationSubset {
  subsetId: string;
  groupOrdinal: number;
  placementIds: readonly string[];
  features: readonly (readonly number[])[];
  outcomes: readonly D1PlacementOutcome[];
  survivalOracle: readonly [number, number, number];
  jointFrontPlacementIds: readonly string[];
}

export interface D1HeldOutSubset {
  subsetId: string;
  groupOrdinal: number;
  placementIds: readonly string[];
  afterstate13: readonly (readonly number[])[];
  action24: readonly (readonly number[])[];
  outcomes: readonly D1PlacementOutcome[];
  survivalOracle: readonly [number, number, number];
  jointFrontPlacementIds: readonly string[];
}

export interface D1ModelFreezeRecord {
  representationId: D1RepresentationId;
  lambda: typeof D1_LAMBDAS[number];
  normalizationDigest: string;
  weightDigest: string;
  gradientNorm: number;
  iterationCount: number;
}

export interface D1Normalization {
  mean: readonly number[];
  std: readonly number[];
}

export interface D1NormalizedRows {
  rows: readonly (readonly number[])[];
  stats: D1Normalization;
  digest: string;
}

export interface D1FinalModel extends D1ModelFreezeRecord {
  weights: readonly number[];
  normalization: D1Normalization;
}

export interface D1FinalModelBundle {
  models: Readonly<Record<D1RepresentationId, D1FinalModel>>;
}

export interface D1SelectedMetrics {
  selectedPlacementIds: readonly string[];
  selectedSurvivalTuples: readonly (readonly [number, number, number])[];
  survivalBelowSubsetOracle: number;
  subsetJointFrontHits: number;
  sumScore: number;
  scheduledPieces: 24576;
  scoreRate: number;
  tetrisNumerator: number;
  tetrisDenominator: number;
  tetrisShare: number;
}

export interface D1SeedGroupMetric {
  groupOrdinal: number;
  afterstate13FrontHits: number;
  action24FrontHits: number;
  groupFrontDelta: number;
}

export interface D1HeldOutResult {
  status: Exclude<D1Status, 'invalid-input'>;
  failureReasons: readonly (
    D1RuntimeFailureReason | D1StatisticalFailureReason
  )[];
  metrics: Readonly<Record<D1RepresentationId, D1SelectedMetrics>>;
  seedGroups: readonly D1SeedGroupMetric[];
  gates: {
    action24OracleSafe: boolean;
    action24NonLowerSurvival: boolean;
    action24FrontHitFloor: boolean;
    action24FrontHitGain: boolean;
    allSeedGroupsNonNegative: boolean;
    positiveSeedGroupCount: number;
    scoreNonLower: boolean;
    tetrisNonLower: boolean;
    jointStrictImprovement: boolean;
  };
  selectedPlacementDigest: string;
  metricProjectionDigest: string;
}
```

---

### Task 1: Reuse the pinned C0 run snapshot and freeze D1 source/seed provenance

**Files:**
- Modify: `training/archivedRepresentativeAudit.ts`
- Modify: `training/archivedRepresentativeAudit.test.ts`
- Create: `training/d1ActionConditionedHeldOutListwiseCore.ts`
- Create: `training/d1ActionConditionedHeldOutListwiseCore.test.ts`

**Interfaces:**
- Produces: `loadC0ValidatedRunSnapshot`, `loadD1Sources`, `buildD1SeedManifest`, `buildD1LabelSeeds`.
- The reusable C0 snapshot reads only the C0 run checkpoint/log/candidate boundary; D1 source loading must not read bundled/runtime weights or select gen-9.

- [ ] **Step 1: Write the pinned-source RED**

Add a test that changes the fake log bytes between the first pinned read and validation. Name the break: a D1 caller must never validate one log and extract vectors from another.

```ts
it('extracts D1 vectors from the same pinned bytes accepted by the strict run validator', () => {
  expect(() => loadC0ValidatedRunSnapshot(
    fakePinnedRun({ mutateLogAfterRead: true }),
  )).toThrow('source-identity-drift');
  expect(fakePoolCreations()).toBe(0);
});
```

- [ ] **Step 2: Run the RED**

```powershell
npx vitest run training/archivedRepresentativeAudit.test.ts training/d1ActionConditionedHeldOutListwiseCore.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL because `loadC0ValidatedRunSnapshot` and the D1 core do not exist; no real artifact is read.

- [ ] **Step 3: Extract the minimum shared snapshot seam**

Refactor the current C0 `defaultDependencies` pinned-byte registry without changing its stable-file checks. Add this exact export and make existing `loadC0Sources` consume it before its published/gen-9-specific work:

```ts
export interface C0ValidatedRunSnapshot {
  checkpoint: ScoreRateCheckpoint;
  records: readonly Record<string, unknown>[];
  sourceHashes: { checkpoint: string; log: string };
}

export function loadC0ValidatedRunSnapshot(
  dependencies: C0SourceDependencies = defaultDependencies(process.cwd()),
): C0ValidatedRunSnapshot;
```

It must perform before/after pinned hash equality, strict `validateCompatibleRunArtifactSnapshot`, exactly ten generation records followed by the gen-10 reevaluation, and return cloned records. Do not read either published weight file in this function.

- [ ] **Step 4: Freeze the exact D1 source vectors**

In the new core, define these exact hashes and select only two vectors from the validated snapshot:

```ts
export const D1_SOURCE_HASHES = Object.freeze({
  checkpoint: '93B2A63FF221B7E6EE1BD5CBFF8AE8C75B5B96411AD5B2EE4AFFA3806B6C06BD',
  log: 'C86457320694A8C2D85C734D64D9CE6E58166D913974F945370D15FBC7C651BA',
});
export const D1_VECTOR_DIGESTS = Object.freeze({
  'gen6-best': '233cc500168fe7258305d87654a640ad9aef3f67092d5e0e016f910b9d660ca9',
  'gen10-mu': 'b669671a3cf0132db1e2948cc610aef98bf22a0284f182ac248a74fdf3234b1b',
});
```

`loadD1Sources` must verify schema 6/v5/gen 10/all frozen search metadata, hash `gen=6.bestWeights`, hash `normalize(checkpoint.mu)`, require 13 finite values, clone both vectors, and reject extra vector selection APIs.

- [ ] **Step 5: Freeze behavior and label seeds**

Use `hashSeed(20260825, splitIndex, i)` and require this exact behavior manifest and digest:

```ts
export const D1_BEHAVIOR_SEEDS = Object.freeze({
  train: [3997649999,2652572990,1307495981,4257386268,2912309259,1567232250,222155241,3172045528,1826968519,481891510,3431781797,2086704788,741627779,3691518066,2346441057,1001364048,3951254335,2606177326,1261100317,4210990604],
  validation: [2430987566,3776064575,4035800844,1085910557,1345646826,2690723835,2950460104,569817],
  test: [864325133,3814215420,3554479151,2209402142,4073951689,2728874680,2469138411,1124061402,2988610949,1643533940,1383797671,38720662],
});
export const D1_BEHAVIOR_SEED_DIGEST =
  '19da6a75ad75ccc71e8e7238ea01378583ab7f63cd16786ce70fa7228f981341';
export const D1_LABEL_SEED_DIGEST =
  'a268a5e77c64e68faa4d8cad73727c0623df0531ba0390183742146dc365eb3f';
```

Generate label seeds in split/group/behavior-vector/capture-slot/stream order with `hashSeed(20260825,3,behaviorSeed,behaviorVectorIndex,captureSlotIndex,streamIndex)`. Assert 40 behavior seeds and 320 label seeds are individually unique and disjoint from each other, gen0–9 training seeds, fixed-reevaluation seeds, historical paired seeds, and all 30 C0 seeds. A collision is `invalid-input`; never replace it.

- [ ] **Step 6: Run focused GREEN and C0 parity**

```powershell
npx vitest run training/archivedRepresentativeAudit.test.ts training/d1ActionConditionedHeldOutListwiseCore.test.ts training/runArtifacts.test.ts src/ai/rng.test.ts src/ai/weights.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: all selected tests PASS; existing C0 source/output fixtures remain byte-identical.

- [ ] **Step 7: Independent Task 1 review and fix loop**

The reviewer must adjudicate pinned-byte ownership, no published/gen-9 dependency in D1, vector normalization/digests, all seed counts/order/digests/disjoint schedules, and failure-before-pool behavior. Require explicit spec and quality verdicts; fix every Critical/Important finding with a focused RED and scoped re-review.

---

### Task 2: Add a dormant shared simulator capture and frozen-continuation seam

**Files:**
- Modify: `src/ai/simulate.ts`
- Modify: `src/ai/simulate.test.ts`

**Interfaces:**
- Produces: `SimulationDecisionObservation`, optional `onDecision`, and `createFrozenContinuationState`.
- Consumes unchanged: `searchBudgeted`, `applyAction`, scorer, bag/public-state transitions, and `SimState` counters.

- [ ] **Step 1: Write capture timing and parity REDs**

```ts
it('observes the first real pre-action decision for each scheduled piece without changing results', () => {
  const baseline = simulateGame({ weights: zeros(), seed: 17, maxPieces: 8 });
  const observed: number[] = [];
  const state = createSimState(17);
  const result = simulateFromState(state, {
    weights: zeros(), maxPieces: 8,
    onDecision: ({ scheduledPieceNumber }) => observed.push(scheduledPieceNumber),
  });
  expect(result).toEqual(baseline);
  expect([...new Set(observed)]).toEqual([1,2,3,4,5,6,7,8]);
});
```

Add a Hold fixture that proves multiple decisions can share one scheduled number and that the D1 consumer can retain only the first. Assert the observed board/current/next/hold/mask are deep snapshots and mutating the callback value cannot change the simulator.

- [ ] **Step 2: Run the capture RED**

```powershell
npx vitest run src/ai/simulate.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL because `onDecision` is not accepted.

- [ ] **Step 3: Add the no-op-by-default observer**

Add the exact shape below. Call it after a non-null `searchBudgeted` decision and after that decision's diagnostics are recorded, but before Hold or placement is applied. Clone all board rows, pieces, and diagnostics.

```ts
export interface SimulationDecisionObservation {
  publicState: PublicSearchState;
  decision: SearchDecision;
  scheduledPieceNumber: number;
  score: number;
  lines: number;
  level: number;
  searchDiagnostics: SimulationSearchDiagnostics;
}

export interface SimulateFromStateOptions {
  weights: number[];
  maxPieces: number;
  limits?: SearchLimits;
  onDecision?: (observation: SimulationDecisionObservation) => void;
}
```

The callback cannot change decision selection. With no callback, the loop and result must remain structurally identical.

- [ ] **Step 4: Write frozen continuation REDs**

```ts
it('uses only the supplied future prefix and preserves public score and level', () => {
  const state = createFrozenContinuationState(capturedFixture, [2,3,4,5,6,7,1]);
  expect(projectPublicSearchState(state)).toEqual(capturedFixture.state);
  expect(state.score).toBe(1200);
  expect(state.lines).toBe(9);
  expect(state.level).toBe(1);
  expect(state.pieces).toBe(0);
});
```

Also assert that exhausting the supplied prefix throws `frozen future stream exhausted`, that board rows are cloned, and that all per-context clear/search/strategy counters start at zero while score/lines/level start at the capture.

- [ ] **Step 5: Implement the frozen continuation constructor**

```ts
export interface FrozenContinuationCapture {
  state: PublicSearchState;
  score: number;
  lines: number;
  level: number;
}

export function createFrozenContinuationState(
  capture: FrozenContinuationCapture,
  futurePieces: readonly PieceType[],
): SimState;
```

Validate `level === calculateLevel(lines)`, all values finite/non-negative integers, and at least one future piece. Copy every row/piece/future value. Set `bag` to the prefix and `rng` to a function that throws so the existing `drawFromBag` cannot silently generate an unfrozen bag. Reuse the existing simulator loop for all subsequent search/Hold/score/SRS behavior.

- [ ] **Step 6: Run focused GREEN and shared parity**

```powershell
npx vitest run src/ai/simulate.test.ts src/ai/search.test.ts src/ai/stateTransitions.test.ts src/ai/publicState.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: all selected tests PASS with the existing deterministic v5 fixtures unchanged.

- [ ] **Step 7: Independent Task 2 review and fix loop**

Review must cover callback timing across Hold, snapshot immutability, no hidden bag/RNG exposure, default parity, counter reset versus preserved public score/lines/level, prefix exhaustion, and absence of browser/production behavior changes.

---

### Task 3: Materialize real grouped states, label-blind placement subsets, and action24

**Files:**
- Extend: `training/d1ActionConditionedHeldOutListwiseCore.ts`
- Extend: `training/d1ActionConditionedHeldOutListwiseCore.test.ts`

**Interfaces:**
- Produces: `captureD1States`, `freezeD1PlacementManifest`, `extractD1Action24`, `D1FrozenSubset`.
- Consumes: Task 1 source/seed bundle and Task 2 observer; no label module is imported.

- [ ] **Step 1: Write grouped capture REDs**

Use an injected behavior runner that emits exact first-decision observations at pieces 128 and 512. Assert four subsets per seed in behavior-vector `[gen6-best,gen10-mu]`, capture-slot `[128,512]` order.

```ts
expect(captures.slice(0, 4).map((capture) => [
  capture.split,
  capture.groupOrdinal,
  capture.behaviorVectorId,
  capture.captureSlot,
])).toEqual([
  ['train',0,'gen6-best',128],
  ['train',0,'gen6-best',512],
  ['train',0,'gen10-mu',128],
  ['train',0,'gen10-mu',512],
]);
```

The full fixture must assert 160 captures, 80/32/48 split counts, 40 indivisible seed groups, and no capture substitution. Add failure fixtures for gameover before slot, null decision, malformed/non-finite diagnostics, missing slot, duplicate fingerprint, and callback mutation attempts. A valid `budgetExhausted:true` committed decision must remain accepted.

- [ ] **Step 2: Run capture RED**

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwiseCore.test.ts src/ai/simulate.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL because capture/materialization APIs do not exist.

- [ ] **Step 3: Implement exact state fingerprints and capture rules**

Hash UTF-8 `JSON.stringify` of this exact array and require global uniqueness:

```ts
[
  boardRows,
  current.type,current.rotation,current.position.x,current.position.y,
  next,hold,holdAvailable,unseenBagMask,
  score,lines,level,scheduledPieceNumber,
]
```

The real runner starts a fresh `createSimState(seed)`, uses active limits and the behavior vector, retains only the first observation for scheduled pieces 128 and 512, and stops only after both are captured or the trajectory fails. Provenance/diagnostics are output-only and must not enter candidates or features.

- [ ] **Step 4: Write label-blind subset REDs**

```ts
it('selects exactly twelve placements from state and placement identity only', () => {
  const board = createEmptyBoard();
  const state = {
    board, current: createPiece(1), next: 2 as PieceType, hold: 3 as PieceType,
    holdAvailable: true, unseenBagMask: 120,
  };
  const capture = captureFixture({
    state, score: 0, lines: 0, level: 1,
    scheduledPieceNumber: 128,
    stateFingerprint: 'd8aa1e61f6e6a8303c450e0999f42d14e5e39c917713dd09ebab52e85b3beb6c',
  });
  const subset = freezeD1PlacementManifest(capture);
  expect(subset.placements.map((entry) => entry.placementId)).toEqual([
    '1:181,191,201,211','1:182,192,202,212','1:183,193,203,213',
    '1:185,195,205,215','1:186,196,206,216','1:187,197,207,217',
    '1:210,211,212,213','1:211,212,213,214','1:212,213,214,215',
    '1:213,214,215,216','1:215,216,217,218','1:216,217,218,219',
  ]);
});
```

Fixture IDs must be hand-derived from actual `cellKey` placements, not generated by the production selector. Mutate source behavior action, weights, labels, scores, and diagnostic values and assert selected IDs do not change. Fewer than 12, duplicate IDs, replay mismatch, or non-unique state fingerprint is `invalid-input`.

- [ ] **Step 5: Implement canonical placement selection**

Enumerate only current-piece placements with shared BFS/SRS. Define `placementId = placedPieceType + ':' + cellKey(placement.piece)`. Sort all legal candidates by placement ID, hash UTF-8 `JSON.stringify([stateFingerprint,placementId,'d1-placement-subset-v1'])`, take the first 12 by digest then ID, and re-sort the selected subset by placement ID. Use `lockPlacement` to derive board-after, clears, cells, and pending branches; replay every selected placement.

- [ ] **Step 6: Write `afterstate13` and `action24` REDs**

Freeze this exact append order:

```ts
export const D1_ACTION_FEATURE_NAMES = [
  ...FEATURE_NAMES,
  'targetLaneUsableDepthDelta','targetLaneSetupProgressDelta',
  'targetLaneReadyRowsDelta','targetLanePlacedCellFraction',
  'placedPieceIsI','verticalIInTargetLane','targetLaneRemainsUsable',
  'futureIAccessProbabilityAfterAction','readyRowsTimesFutureIAccess',
  'setupProgressTimesFutureIAccess','nextDecisionLegalActionProbability',
] as const;
```

Tests must cover a null pre-lane forcing only the lane-dependent additions to zero: the three deltas, `targetLanePlacedCellFraction`, `verticalIInTargetLane`, `targetLaneRemainsUsable`, `readyRowsTimesFutureIAccess`, and `setupProgressTimesFutureIAccess`. In that same case, `placedPieceIsI` still follows the placed type, while `futureIAccessProbabilityAfterAction` and `nextDecisionLegalActionProbability` still use the exact public post-placement branches. Also cover same-column deltas, vertical I, exact chance probability for empty/non-empty Hold, a blocked promoted current causing shared `revealPreview` to return `null` and contribute zero legal-action probability without a synthetic Hold rescue, bounds, finite values, and unchanged input rows.

- [ ] **Step 7: Implement the pure diagnostic extractor**

Compute base 13 with existing `extractFeatures`. Freeze the pre-state lane; never switch columns after placement. Enumerate exact post-placement preview branches with `enumerateBagOutcomes` and shared `revealPreview`/`applyHold`. Materialize each branch with shared `revealPreview` first: a `null` result is runtime game-over and contributes zero legal-action probability, with no synthesized post-null state and no Hold attempt. For a materialized branch, a next decision is legal when either current placements exist or a standard-Hold continuation has a legal placement; do not run search and do not read labels/seeds/behavior identity.

- [ ] **Step 8: Freeze the pre-label manifest digest and run GREEN**

The manifest projection contains only state provenance/public state/fingerprint plus ordered placement IDs/cells/transitions/features. Compute its digest before any label API can be called.

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwiseCore.test.ts src/ai/simulate.test.ts src/ai/placements.test.ts src/ai/stateTransitions.test.ts src/ai/publicState.test.ts src/ai/features.test.ts src/ai/tetrisStrategy.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: all selected tests PASS; `FEATURE_NAMES` remains exactly 13 entries in the original order.

- [ ] **Step 9: Independent Task 3 review and fix loop**

Review must cover group isolation/count/order, capture semantics, diagnostic completeness interpretation, fingerprint uniqueness, label blindness, complete exclusion of root Hold items, SRS/dedup/replay, exact action24 meanings/ranges, branch probability, feature isolation, and board immutability.

---

### Task 4: Build compatible future streams and survival-first subset labels

**Files:**
- Create: `training/d1ActionConditionedHeldOutListwiseLabels.ts`
- Create: `training/d1ActionConditionedHeldOutListwiseLabels.test.ts`
- Use unchanged: `src/ai/simulate.ts`, `src/ai/publicState.ts`, `src/ai/stateTransitions.ts`

**Interfaces:**
- Produces: `buildD1FutureStreams`, `buildD1ContextTasks`, `runD1Context`, `aggregateD1PlacementOutcome`, `buildD1SubsetTarget`.
- Consumes: Task 3 immutable subsets and Task 2 frozen continuation state. This module cannot select or replace a placement.

- [ ] **Step 1: Write future-stream REDs with literal prefixes**

For one hand-computed label seed and unseen mask, assert the exact first two partial/full bags, all 256 piece types, the individual prefix digest, and the aggregate digest ordering. Name the break: changing Fisher-Yates direction, resetting RNG at a bag boundary, or re-inserting public current/next must fail.

```ts
it('continues one mulberry32 stream across the partial bag and every fresh bag', () => {
  const stream = buildD1FutureStream({
    labelSeed: 123456789, unseenBagMask: 0b0101100, streamIndex: 0,
  });
  expect(stream.pieces.slice(0, 10)).toEqual([6,4,3,5,1,4,3,7,2,6]);
  expect(stream.pieces).toHaveLength(256);
  expect(stream.digest).toBe('30e27899ee6c8f19e08a659243e8faed01209a66a1b25b89436ae6da56a81f77');
});
```

The expected values above are fixed independent literals; never regenerate them with `buildD1FutureStream`. Add `unseenBagMask===0`, one-bit mask, repeat-run, wrong aggregate order, and 320-stream uniqueness fixtures.

- [ ] **Step 2: Run the stream RED**

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwiseLabels.test.ts src/ai/rng.test.ts src/ai/publicState.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL because the stream module does not exist.

- [ ] **Step 3: Implement the exact compatible stream**

```ts
export interface D1FutureStream {
  labelSeed: number;
  streamIndex: 0 | 1;
  pieces: readonly PieceType[];
  digest: string;
}

export function buildD1FutureStream(input: {
  labelSeed: number;
  unseenBagMask: number;
  streamIndex: 0 | 1;
}): D1FutureStream;
```

Start `rng=mulberry32(labelSeed)`. Convert `unseenBagMask===0` to ascending `[1,2,3,4,5,6,7]`; otherwise use its set bits in ascending piece order. Shuffle in place for `i=length-1..1` with `j=Math.floor(rng()*(i+1))`; consume from index 0; use the same RNG for each fresh ascending seven-piece bag until exactly 256 values exist. Hash UTF-8 `JSON.stringify(pieces)`. Reject any value outside piece types 1..7.

- [ ] **Step 4: Write forced-placement context REDs**

Use a real `lockPlacement` fixture, a frozen prefix, and an injected search decision sequence. Assert:

- forced placement is scheduled piece 1 and consumes one preview after lock;
- each later lock consumes one preview;
- non-empty Hold consumes none;
- the first empty Hold consumes one extra preview and no second empty Hold is possible;
- each draw is checked by existing `revealPiece` against the evolving mask;
- each task gets a new cursor even when it shares the same stream array;
- contradictory or exhausted streams and incomplete results are `runtime-fail`.

```ts
expect(runD1Context(taskFixture, injectedSearch)).toMatchObject({
  pieces: 128,
  scoreDelta: 43200,
  reason: 'pieceCap',
});
expect(taskFixture.futurePieces).toEqual(originalPrefix);
```

- [ ] **Step 5: Run the context RED**

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwiseLabels.test.ts src/ai/simulate.test.ts src/ai/stateTransitions.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL because context task/materialization APIs do not exist.

- [ ] **Step 6: Implement canonical tasks and context execution**

Build task IDs in split `[train,validation,test]`, group ordinal, behavior vector, capture slot, placement ID, continuation vector `[gen6-best,gen10-mu]`, stream `[0,1]` order. Require exactly `160*12*2*2 = 7680` unique tasks.

The source-side builder must validate split, group ordinal, behavior vector, capture slot, subset identity, and canonical source order before deriving each task ID. Those provenance fields remain controller-local validation inputs and are not members of `D1ContextTask` or `D1ContextProjection`. For this step, canonical identifiers means exactly `taskId`, `subsetId`, `placementId`, `continuationVectorId`, and `streamIndex`.

For each source subset, the builder must explicitly deep-copy and recursively freeze one exact `D1ContinuationCapture` projection `{ state, score, lines, level }`; its 48 immutable tasks may share that sanitized projection. It must not retain, spread, or structurally clone the complete `D1CapturedState`; the copied public state and every copied board row must have independent identities from the source capture.

`runD1Context` must create a fresh frozen continuation state, assign the selected placement pose to `currentPiece`, call the shared hard-drop transition once, then call the shared active-v5 simulator to a total cap of 128. Project only score delta from capture, per-context pieces/clear counts/reason/search diagnostics, and the five canonical identifiers above. It must never call a label seed generator, filesystem API, or subset selector.

- [ ] **Step 7: Write outcome/front REDs**

Use twelve placements `A..L` in ID order. Give A/B the maximal tuple `[4,128,512]`; A has `(sumScore=100,tetrises=1,totalLines=8)`, B has `(90,2,8)`. Give C..K the same survival tuple but `(80,1,8)` so both A and B dominate them. Give L the lower tuple `[3,127,511]` with `(1000,4,16)` to prove score/Tetris cannot compensate survival. Cover zero Tetris denominator and equal fractions in additional cases.

```ts
expect(buildD1SubsetTarget(twelveLiteralOutcomes)).toEqual({
  survivalOracle: [4,128,512],
  jointFrontPlacementIds: ['A','B'],
  q: [0.5,0.5,0,0,0,0,0,0,0,0,0,0],
});
```

- [ ] **Step 8: Implement exact aggregate and target semantics**

For each placement aggregate four contexts into `pieceCapContexts`, `minPieces`, `sumPieces`, `sumScore`, `scoreRate=sumScore/(4*128)`, exact clear counts, and Tetris fraction `(4*totalTetrises)/totalLines`. Take the lexicographically maximal survival tuple first, then the non-dominated `(sumScore,tetrisShare)` front only within that tier. Sort the front by placement ID and assign uniform `q`; prohibit floating tolerance for fraction dominance.

- [ ] **Step 9: Run focused GREEN**

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwiseLabels.test.ts training/d1ActionConditionedHeldOutListwiseCore.test.ts src/ai/simulate.test.ts src/ai/stateTransitions.test.ts src/ai/publicState.test.ts src/ai/lineClears.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: all selected tests PASS; no real search trajectory longer than the tiny injected fixture runs.

- [ ] **Step 10: Independent Task 4 review and fix loop**

Review must cover exact seed/order/prefix/digest, cross-bag RNG continuity, preview/Hold consumption, context cursor isolation, forced placement count, no early stop/retry/replacement, scheduled denominator, survival lexicography, integer Tetris comparison, non-empty uniform target, and worker-ready immutable payloads.

#### Approved Task 4 sanitized worker-payload corrective gate

This is a separately approved correction discovered by Task 7 and is not a sixth round of the historical Task 4 breaker. It must complete before Task 7 resumes. Its implementation-owned repository scope is exactly:

- `training/d1ActionConditionedHeldOutListwiseLabels.ts`
- `training/d1ActionConditionedHeldOutListwiseLabels.test.ts`

The implementer must also append its evidence to this plan's git-ignored SDD report artifact. That bookkeeping file is not an implementation-owned repository path and grants no authority to edit another repository file.

The Frozen Cross-Task Interfaces are authoritative. Restore `D1ContinuationCapture`, `D1ContextTask`, and `D1ContextProjection` to their exact frozen shapes. Do not add a Task-7-private payload adapter and do not allow provenance fields into the worker payload. `buildD1ContextTasks` must still validate the full source provenance and canonical order before dispatch, but no returned task/projection may serialize `split`, `groupOrdinal`, `behaviorVectorId`, `captureSlot`, behavior/label seeds or digests, source diagnostics, state fingerprints, source paths, fit/lambda/q, or verdict data.

- [ ] Write one focused real-behavior RED that recursively walks a materialized task and fails on the current provenance-bearing payload. It must require exact top-level task keys in interface order; exact capture keys `state/score/lines/level`; no forbidden key substring; no source capture/state/board-row identity reuse; and recursive freezing of task, capture, public state, board array, and every board row.
- [ ] In the same RED, preserve association independently: require all 7,680 unique task IDs, exact first/final five canonical identifiers, and SHA-256 `d7898196a14057566b7978343685194ef9717b8668670e49c0d9eebd265dd423` over ordered tuples `[taskId,subsetId,placementId,continuationVectorId,streamIndex]`. This literal was derived before the correction from the already reviewed canonical fixture and does not include forbidden provenance.
- [ ] Run only the Labels-focused test command and observe the expected payload-shape/identity failure before production edits.
- [ ] Implement the minimum correction: remove the widened task/projection properties; construct one new capture object per source subset from the four allowed fields; deep-copy the public state, including independent board rows and piece positions; recursively freeze the copied graph; allow only that subset's 48 immutable tasks to share the sanitized capture; remove provenance fields from `runD1Context` output and projection digest. Do not weaken any existing source association validation.
- [ ] Run focused GREEN, then the exact Task 4 six-file suite, exact two-file ESLint, safe explicit-root typecheck proving protected probes zero, exact two owned baseline/current diff checks, and real-index-empty check. Do not run Task 7, operational D1, training, calibration, benchmark, or any other gate during this correction.
- [ ] Require a fresh independent corrective review with explicit `spec-compliance` and `code-quality` verdicts. Every Critical/Important finding enters its own focused RED/minimum GREEN/scoped re-review before Task 7 resumes.

---

### Task 5: Implement deterministic normalization and the damped Newton solver

**Files:**
- Previously modified, additive contract complete; do not re-edit or redo TDD absent a review finding: `training/d1ActionConditionedHeldOutListwiseCore.ts`
- Previously modified, additive contract complete; do not re-edit or redo TDD absent a review finding: `training/d1ActionConditionedHeldOutListwiseCore.test.ts`
- Previously modified, additive contract complete; do not re-edit or redo TDD absent a review finding: `training/d1ActionConditionedHeldOutListwiseLabels.ts`
- Previously modified, additive contract complete; do not re-edit or redo TDD absent a review finding: `training/d1ActionConditionedHeldOutListwiseLabels.test.ts`
- Create: `training/d1ActionConditionedHeldOutListwiseFitInternals.ts`
- Continue modifying the existing partial Task 5 implementation: `training/d1ActionConditionedHeldOutListwiseFit.ts`
- Continue modifying the existing partial Task 5 tests: `training/d1ActionConditionedHeldOutListwiseFit.test.ts`

Import `D1RepresentationId` from Core and `D1FitSubset` from Labels. Define and export the Task-5-owned fit contracts in Fit; the Core/Labels edits are additive contract-only exports and must not change their completed runtime behavior.

**Approved continuation boundary:** The ledger/report already contain the observed Core/Labels contract RED/GREEN, normalization RED/GREEN, and partial legal-public-input solver RED/GREEN. Those cycles are historical completed evidence: do not revert, delete, recreate, or rerun them as implementation work. The correction's first new RED is the missing private-internals import and the absence of permanent production-guard/controller tests. The minimum GREEN creates only FitInternals and modifies the partial Fit/Fit.test so production and tests share that implementation. Afterward, re-run the relevant existing GREEN commands as regression evidence, then complete the remaining Task 5 verification/report/review.

**Interfaces:**
- Produces: `D1_LAMBDAS`, `D1Normalization`, `D1NormalizedRows`, `D1ModelFreezeRecord`, `D1FinalModel`, `D1FitInput`, `D1FitResult`, `normalizeD1Rows`, `fitD1Representation`, `serializeD1FitDigest`.
- This Task receives only `D1FitSubset` feature rows/targets. It has no outcome, group, filesystem, worker, source-artifact, label-materialization, seed, or placement-selection dependency.

```ts
export function normalizeD1Rows(
  subsets: readonly D1FitSubset[],
): D1NormalizedRows;
export function serializeD1FitDigest(input: {
  representationId: D1RepresentationId;
  lambda: typeof D1_LAMBDAS[number];
  normalization: D1Normalization;
  weights: readonly number[];
  gradientNorm: number;
  iterationCount: number;
}): string;
```

- [x] **Step 1: Write exact normalization REDs — completed before the private-seam correction; do not redo**

Use 24 rows `row[i]=[i, i<12?0:2, 5]`, representing two 12-placement subsets. Its frozen binary64 stats are `[11.5,6.922186552431729,1,1,5,+0]`. Assert train and train+validation row order, `N=M*12`, two-pass recurrence, zero-variance `+0`, little-endian interleaved `[mean0,std0,mean1,std1,...]` digest, and that test rows cannot be passed to fit normalization.

```ts
expect(Object.is(normalized.stats.std[2], 0)).toBe(true);
expect(Object.is(normalized.rows[0][2], 0)).toBe(true);
expect(normalized.stats.mean).toEqual([11.5,1,5]);
expect(normalized.stats.std).toEqual([6.922186552431729,1,0]);
expect(normalized.digest).toBe('526e2eead3699199b12f86030f3e9c46b25c23315cbaffdfaf7f6df09d9f4c08');
```

- [x] **Step 2: Run normalization RED — completed before the private-seam correction; do not redo**

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwiseFit.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL because the fit module does not exist.

- [x] **Step 3: Implement frozen normalization and numeric primitives — completed before the private-seam correction; preserve and regression-check**

Process canonical subset then placement order. For every dimension: first pass `sum=+0; sum=sum+x`; `mean=sum/N`; second pass `squared=+0; delta=x-mean; squared=squared+delta*delta`; `variance=squared/N`; `std=Math.sqrt(variance)`. Ban compensated/parallel/reordered accumulation. Only `variance===0` maps std and normalized values to canonical `+0`; all non-finite/intermediate-negative variance cases throw the `D1RuntimeError` imported from FitInternals. FitInternals defines and exports that private-seam class; only Fit and Fit.test may import it, Fit must not re-export it, and downstream must not import or consume it. Its constructor accepts a concise detail string and the class itself prepends `runtime-fail:`.

Implement one helper that writes each dimension's mean then std as binary64 little-endian and another that writes weights in dimension order. Canonicalize `-0` to `+0`; reject NaN/Infinity.

- [ ] **Step 4: Write softmax/objective/Newton REDs**

Preserve the already-green legal-public-input zero-optimum and D=2 solver fixtures. Resume strict TDD by adding imports and permanent tests for the not-yet-created FitInternals module, then observe the focused RED because those symbols/file do not exist. The remaining tiny D=2 hand-derived fixtures must distinguish ordinary ordered addition from compensated/reordered addition; exact-tie placement ID selection; full versus mirrored Hessian; minimum-index pivot tie; non-normalized pivot row; back-substitution order; Armijo halving; and repeat-fit bit identity. Do not widen the frozen Fit exports, weaken lambda/input validation, cast an invalid lambda, or use mutable/getter inputs to claim valid-public-input coverage.

Exercise the production singular-pivot and non-descent guards through the Task-5-private, production-used controller below. It lives only in `training/d1ActionConditionedHeldOutListwiseFitInternals.ts`; Fit imports it for the real solver, Fit.test imports it for permanent defensive-path tests, and Fit never re-exports it:

```ts
export class D1RuntimeError extends Error {
  constructor(detail: string);
}
export interface D1NewtonSystem {
  objective: number;
  gradient: readonly number[];
  hessian: readonly (readonly number[])[];
}
export interface D1NewtonControllerInput {
  initialWeights: readonly number[];
  evaluateSystem: (weights: readonly number[]) => D1NewtonSystem;
  evaluateObjective: (weights: readonly number[]) => number;
  solveDirection: (
    hessian: readonly (readonly number[])[],
    gradient: readonly number[],
  ) => readonly number[];
}
export interface D1NewtonControllerResult {
  weights: readonly number[];
  gradientNorm: number;
  iterationCount: number;
}
export function solveD1NewtonDirection(
  hessian: readonly (readonly number[])[],
  gradient: readonly number[],
): readonly number[];
export function runD1NewtonController(
  input: D1NewtonControllerInput,
): D1NewtonControllerResult;
```

The production Fit path must call `runD1NewtonController` with its real ordered objective/system evaluators and `solveD1NewtonDirection`. A singular literal matrix must make the real direction solver throw `runtime-fail:` at the frozen pivot guard. A controller fixture with finite gradient `[1]`, Hessian `[[1]]`, and an injected direction `[1]` must make the real controller reject the non-descent dot before line search. For update 200, first use an independently derived legal frozen `D1FitInput` fixture if one is available; otherwise use the same real controller with an injected deterministic system/objective whose step is accepted on every update while the gradient remains above `1e-9`, and prove exactly 200 accepted updates followed by `runtime-fail:`. Reversible mutation evidence may supplement but must not replace these permanent tests. These private-seam tests are the new RED/GREEN cycle; do not replay the completed normalization RED or the original missing-Fit-module RED.

Add this concrete zero-optimum end-to-end fixture for the 13-dimensional representation:

```ts
const fit = fitD1Representation({
  representationId: 'afterstate13',
  lambda: 1,
  subsets: [{
    subsetId: 'uniform-zero',
    placementIds: Array.from({ length: 12 }, (_, index) => `p${index.toString().padStart(2,'0')}`),
    features: Array.from({ length: 12 }, () => Array(13).fill(0)),
    q: Array(12).fill(1/12),
  }],
});
expect(fit.weights).toEqual(Array(13).fill(0));
expect(fit.gradientNorm).toBe(0);
expect(fit.iterationCount).toBe(0);
expect(fit.weightDigest).toBe('39f37f8d1931b3bdf767e7510dd69509fbf23af1f7654933d0a4d291cbdd4418');
```

The D=2 expected literals must be written directly in their tests from independently checked arithmetic; never call the production fit helper to create expectations. Private-controller fixtures test only defensive guards and iteration control; all normalization, softmax, Hessian, public fit, digest, and repeatability claims still require legal frozen `D1FitInput` behavior tests.

- [ ] **Step 5: Implement the deterministic damped Newton solver**

Implement approved spec section 9.2 verbatim behind these APIs. Keep ordered normalization, softmax, objective, gradient, and full Hessian construction in Fit. Put the production Gaussian direction solve plus convergence/descent/Armijo/update controller in FitInternals, and make the public Fit path call that exact internal implementation; do not duplicate a test-only solver or controller:

```ts
export interface D1FitInput {
  representationId: D1RepresentationId;
  lambda: typeof D1_LAMBDAS[number];
  subsets: readonly D1FitSubset[];
}
export type D1FitResult = D1FinalModel;
export function fitD1Representation(input: D1FitInput): D1FitResult;
```

Logits begin at `+0` and add `w[d]*x[d]` in dimension order. Softmax scans placement ID order, subtracts the first maximal logit, evaluates `Math.exp`, accumulates denominator from `+0`, uses one `Math.log(denominator)`, and derives both `p` and `logP`. Objective, gradient, full `D*D` Hessian, Gaussian elimination, back substitution, gradient-direction dot, candidate weights, and Armijo comparisons must follow the exact loop order and constants in the approved spec. Initial weights are all `+0`; gradient infinity norm gate is `<=1e-9`; max updates 200; pivot threshold `1e-15`; Armijo `c1=1e-4`; step starts at 1 and halves at most 64 candidate evaluations. Any failed lambda makes the representation and gate `runtime-fail`.

- [ ] **Step 6: Run solver-focused GREEN twice**

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwiseFit.test.ts training/d1ActionConditionedHeldOutListwiseLabels.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
npx vitest run training/d1ActionConditionedHeldOutListwiseFit.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: all selected tests PASS; repeated solver output has identical weights/digests/iterations/gradient norms.

- [ ] **Step 7: Independent Task 5 review and fix loop**

Review must trace every normalization and numeric recurrence/loop order against spec section 9.2, validate test independence and bit-level expectations, and confirm this Task cannot access outcomes/groups/test materialization. Fix and scoped re-review all Critical/Important findings.

---

### Task 6: Add validation selection, opaque model freeze, held-out metrics, and verdict

**Files:**
- Extend: `training/d1ActionConditionedHeldOutListwiseFit.ts`
- Extend: `training/d1ActionConditionedHeldOutListwiseFit.test.ts`

Import `D1RepresentationId` from Core, `D1FitSubset` from Labels, and the Task-5-owned fit contracts from Fit. Define/export the Task-6-owned `D1ValidationSelection` and `D1FinalModelBundle` in Fit.

**Interfaces:**
- Produces: `selectD1Lambda`, `freezeD1FinalModels`, `assertD1FinalModelBundle`, `evaluateD1HeldOut`.
- Consumes pure `D1FitSubset` for fitting, `D1EvaluationSubset` for validation, and `D1HeldOutSubset` for final comparison. It never materializes labels and cannot access source files/workers/seeds.

```ts
export function selectD1Lambda(input: {
  representationId: D1RepresentationId;
  fits: readonly D1FitResult[];
  validation: readonly D1EvaluationSubset[];
}): D1ValidationSelection;
export interface D1ValidationSelection extends D1FinalModel {
  validationSurvivalBelowSubsetOracle: number;
  validationSubsetJointFrontHits: number;
  validationSelectionDigest: string;
}
export function freezeD1FinalModels(input: {
  selections: Readonly<Record<D1RepresentationId, D1ValidationSelection>>;
  train: Readonly<Record<D1RepresentationId, readonly D1FitSubset[]>>;
  validation: Readonly<Record<D1RepresentationId, readonly D1FitSubset[]>>;
}): D1FinalModelBundle;
export function assertD1FinalModelBundle(
  value: unknown,
): asserts value is D1FinalModelBundle;
export function evaluateD1HeldOut(input: {
  models: D1FinalModelBundle;
  subsets: readonly D1HeldOutSubset[];
}): D1HeldOutResult;
```

- [ ] **Step 1: Write validation/freeze capability REDs**

Assert each representation independently fits all five lambdas on train; evaluates selected placement against explicit validation outcomes; chooses lexicographically minimum survival regressions, maximum front hits, maximum lambda, then lexicographically smallest lowercase canonical weight digest. `selectD1Lambda` deep-copies and recursively freezes a new `D1ValidationSelection`, computes its canonical validation-selection digest, and registers that exact object in a module-private `WeakMap<object, Readonly<{ representationId: D1RepresentationId; lambda: typeof D1_LAMBDAS[number]; validationSelectionDigest: string }>>`. The private captured record is separately frozen. A structural clone, an input fit, or a fit never returned by validation selection is not eligible for final refit. Add a literal tie where digests `0f...` and `a0...` survive the first three criteria and require `0f...`.

```ts
const input = finalFreezeInput({
  afterstate13Selection: selectedAfterstate13,
  action24Selection: selectedAction24,
  trainSubsetCounts: [80, 80],
  validationSubsetCounts: [32, 32],
});
expect(() => freezeD1FinalModels({
  ...input,
  selections: { afterstate13: selectedAfterstate13 },
} as never)).toThrow('both selected representations are required');
expect(() => freezeD1FinalModels({
  ...input,
  selections: {
    ...input.selections,
    action24: { ...selectedAction24 },
  },
})).toThrow('unrecognized validation selection capability');
expect(Object.isFrozen(selectedAction24)).toBe(true);
expect(() => {
  (selectedAction24 as { lambda: number }).lambda = 0.1;
}).toThrow();
const freezes = freezeD1FinalModels(input);
expect(Object.isFrozen(freezes)).toBe(true);
expect(Object.isFrozen(freezes.models.action24.weights)).toBe(true);
expect(Object.isFrozen(freezes.models.action24.normalization.mean)).toBe(true);
expect(() => assertD1FinalModelBundle({ models: freezes.models }))
  .toThrow('unrecognized model freeze capability');
expect(() => assertD1FinalModelBundle(freezes)).not.toThrow();
```

`freezeD1FinalModels` is the only final-refit API. It first requires the exact two objects registered by `selectD1Lambda`, retrieves representation/lambda/selection digest only from the corresponding private frozen `WeakMap` values, verifies the public frozen records still match those captures, and then requires exact representation identities, 80 train and 32 validation subsets per representation, twelve ordered placements per subset, and matching dimensions. It concatenates only `[train, validation]` in that order, recomputes normalization, and calls the deterministic solver exactly once per representation with the privately captured lambda. It accepts no caller-supplied final weights or normalization. Only after both refits succeed does it deep-copy and recursively freeze the two complete final models, verify each copied digest against those parameters, and register the exact bundle object in a second module-private `WeakSet<object>`. Thus a train-only fit, arbitrary fit, mutable or structural-clone selection, partial refit, or caller-fabricated final model cannot acquire the test-label capability.

`assertD1FinalModelBundle` accepts only that registered bundle object; a structurally identical clone is not a capability. `evaluateD1HeldOut` begins by calling `assertD1FinalModelBundle` and then uses only these frozen weights and normalization values for both representations; it may not refit or recover parameters from hidden/module-global state. The orchestrator, not this module, owns future `materializeD1TestLabels(bundle)` and must also call this assertion before invoking any test dependency.

- [ ] **Step 2: Write validation/outcome and verdict matrix REDs**

Cover all boundaries: 0 survival regressions, 48/48 non-lower tuples, front hits 35/36, gain 7/8, 11/12 versus 12/12 non-negative groups, 5/6 positive groups, score lower/equal/higher, Tetris lower/equal/higher, malformed counts, nondeterminism, and precedence. The table must include these exact rows:

| New vs old survival | New hits | Gain | Non-negative/positive groups | Score relation | Tetris relation | Expected status |
| --- | ---: | ---: | ---: | --- | --- | --- |
| 48/48 non-lower | 36 | 8 | 12/6 | equal | equal | `fail-joint-selection-not-shown` |
| 47/48 non-lower | 48 | 20 | 12/12 | higher | higher | `fail-joint-selection-not-shown` |
| 48/48 non-lower | 35 | 8 | 12/6 | higher | equal | `fail-representation-gain-not-held-out` |
| 48/48 non-lower | 36 | 7 | 12/6 | higher | equal | `fail-representation-gain-not-held-out` |
| 48/48 non-lower | 36 | 8 | 12/5 | higher | equal | `fail-representation-gain-not-held-out` |
| 48/48 non-lower | 36 | 8 | 12/6 | higher | equal | `pass-action-conditioned-listwise-supported` |

- [ ] **Step 3: Implement validation evaluation, opaque freeze, metrics, and verdict**

Top placement uses the same logit recurrence, score descending, placement ID ascending. Aggregate test metrics over exactly 12 seed groups/48 subsets. Compare scores as integers and Tetris shares by integer cross multiplication. Apply precedence exactly:

```text
invalid-input -> runtime-fail -> fail-joint-selection-not-shown
-> fail-representation-gain-not-held-out
-> pass-action-conditioned-listwise-supported
```

PASS requires all ten approved gates; failure reasons are canonical and exhaustive within the selected status. Build metric/model/normalization/weight/selection digests from explicitly ordered projections and reject `undefined`, non-finite numbers, or `-0` before serialization.

Use only the frozen `D1StatisticalFailureReason` spellings from the cross-task interface, in the same order in which the corresponding gates appear there. A `runtime-fail` result contains only applicable `D1RuntimeFailureReason` values; statistical reasons cannot leak into it.

- [ ] **Step 4: Run selection/freeze/verdict-focused GREEN**

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwiseFit.test.ts training/d1ActionConditionedHeldOutListwiseLabels.test.ts training/d1ActionConditionedHeldOutListwiseCore.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: all selected tests PASS twice with identical digests/iterations/gradient norms.

- [ ] **Step 5: Independent Task 6 review and fix loop**

Review must verify pure fit versus evaluation input separation, survival/oracle/outcome/group availability, the ascending digest tie-break, recursively frozen selection plus private immutable lambda capture, module-private validation-selection and final-bundle capabilities, the single internal train+validation final-refit path, group metrics, all PASS thresholds, equality case, verdict precedence, bit digests, and fail-whole-gate behavior for one failed lambda.

---

### Task 7: Add the D1 worker pool, orchestration, replay, and stdout-only CLI

**Files:**
- Create: `training/d1ActionConditionedHeldOutListwiseWorker.ts`
- Create: `training/d1ActionConditionedHeldOutListwise.ts`
- Create: `training/d1ActionConditionedHeldOutListwise.test.ts`
- Modify one script entry: `package.json`

**Interfaces:**
- Produces: `D1WorkerPool`, `runD1Diagnostic`, `runD1DiagnosticCli`, `serializeD1Result`.
- Consumes all Tasks 1–6 only through frozen source/manifest/task/result/final-model interfaces.

- [ ] **Step 1: Write worker authority and order REDs**

Use an injected worker factory. Assert pool construction occurs only after source hashes, seeds, 160 fingerprints, 1,920 placements, manifest digest, and all 320 stream prefixes are frozen. Assert the worker receives one `D1ContextTask`, has no source path/seed/fit/verdict field, and returns the matching `D1ContextProjection`.

`D1ContextTask` and `D1ContextProjection` here mean the exact sanitized Frozen Cross-Task Interface shapes. No Task-7-private transport type or provenance rehydration adapter is allowed. The source-side orchestrator may retain its own immutable taskId-to-source-coordinate association for label assembly and replay selection, but that association is never serialized to a worker.

```ts
expect(dispatched).toHaveLength(7680);
expect(dispatched[0]).toMatchObject({
  taskId: 0,
  continuationVectorId: 'gen6-best',
  streamIndex: 0,
});
expect(Object.keys(dispatched[0])).not.toContain('sourceRun');
```

Recursively walk every serialized task key and require that no key contains `seed`, `split`, `groupOrdinal`, `behaviorVector`, `sourceDiagnostics`, `stateFingerprint`, `sourceRun`, `fit`, `lambda`, `q`, or `verdict`. The only capture payload is `{state,score,lines,level}`. `futurePieces` contains the already-frozen values but no label seed/digest.

Add out-of-order result, duplicate/missing task, worker warning, worker error, abort, recovery, destroy rejection, and post-freeze mutation fixtures.

- [ ] **Step 2: Run worker RED**

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwise.test.ts training/d1ActionConditionedHeldOutListwiseLabels.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL because worker/orchestrator files do not exist.

- [ ] **Step 3: Implement the D1-specific worker and pool**

The worker entry imports only `runD1Context`, receives one structured task, and posts one result or one redacted structured failure. `D1WorkerPool` follows the existing pool lifecycle: bounded workers, task IDs restored to canonical order, `execArgv:['--import','tsx']`, no retry/replacement, abort-aware run, one shared idempotent `destroy()` promise using `Promise.allSettled`, and no detached rejection. It never acquires the repository trainer lock.

- [ ] **Step 4: Write fake end-to-end and replay REDs**

Inject source loader, behavior runner, pool, runtime identity, stdout/stderr, and filesystem snapshot. The fake full run must prove:

- exact 160 subsets, 1,920 placements, 7,680 primary contexts;
- label materializer never sees test before both complete final models are frozen;
- 16 replay tasks use test group ordinals `[0,11]`, vector order, slots `[128,512]`, each subset's canonical-first placement, both continuation policies, and stream 0;
- replay projections/search diagnostics match their primary records exactly;
- result digest excludes only `resultDigest` and repeated run JSON is byte-identical;
- no repository/TEMP/public artifact write and no trainer lock.

Add the leakage capability test at the orchestration boundary:

```ts
expect(() => materializeD1TestLabels(structuralCloneOfFreeze, fakeTestDeps))
  .toThrow('unrecognized model freeze capability');
expect(materializeD1TestLabels(realFreezeBundle, fakeTestDeps)).toHaveLength(48);
```

`materializeD1TestLabels` must call `assertD1FinalModelBundle` before invoking any test dependency. This is the only function that may cross from opaque final-model freeze to test labels.

- [ ] **Step 5: Implement the orchestrator and canonical projection**

`runD1Diagnostic` executes these phases exactly once and in order:

```text
runtime identity -> pinned source -> seed/source captures -> placement manifest
-> future prefix freeze -> train/validation labels -> train fits/lambda selection
-> train+validation final fits -> immutable two-model freeze
-> test label materialization -> held-out evaluation -> 16 replays -> result digest
```

No phase can expose a callback that mutates an earlier frozen record. Any invalid input before pool construction returns `invalid-input`; simulation/worker/fit/replay failures return `runtime-fail`; neither may fall through to a statistical verdict. Do not optional-stop, drop a placement, retry, change seed, or reduce contexts.

For every completed structured status, construct one explicit ordered projection with: mode/status/canonical failure reasons; source hashes and the two vector digests; frozen search metadata; behavior/label seed digests; state/placement manifest digests and split counts; exact feature names/ranges/projection digests; label protocol/context counts/label digest; both representations' selected lambda/normalization/weight/convergence evidence; validation selection evidence; twelve test-group metrics and gate booleans; selected-placement digest; sixteen replay records/digests; then `resultDigest = sha256(JSON.stringify(projectionWithoutResultDigest))`. No module may spread arbitrary objects into this projection.

- [ ] **Step 6: Write CLI/runtime/stdout REDs**

Assert exact operational identity `{node:'24.14.0',v8:'13.6.233.17-node.41',platform:'win32',arch:'x64'}` is required before source read. Inject the accepted identity in unit tests. Assert pass exit 0, every structured fail exit 1, and SIGINT waits for pool destroy then emits one canonical `runtime-fail` JSON line with exit 1 rather than a partial statistical verdict. Completed structured output has stderr empty; exceptions that cannot safely form a structured failure leave stdout empty and write one concise redacted stderr line.

- [ ] **Step 7: Implement CLI and exact package entry**

```json
"diagnose:action-conditioned-listwise": "tsx training/d1ActionConditionedHeldOutListwise.ts"
```

Preserve every existing `package.json` entry. Use an `import.meta.url` main guard, install one SIGINT listener, restore it and any warning handler in `finally`, await pool cleanup, and never print raw paths, stack traces, vector values, labels, or partial JSON. The future operational command is `npm run diagnose:action-conditioned-listwise --silent`; do not run it in this plan.

- [ ] **Step 8: Run Task 7 focused GREEN and lifecycle parity**

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwise.test.ts training/d1ActionConditionedHeldOutListwiseFit.test.ts training/d1ActionConditionedHeldOutListwiseLabels.test.ts training/d1ActionConditionedHeldOutListwiseCore.test.ts training/archivedRepresentativeAudit.test.ts training/pool.test.ts training/runArtifacts.test.ts src/ai/simulate.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: all selected tests PASS; the package diagnostic is not executed.

- [ ] **Step 9: Independent Task 7 review and fix loop**

Review must cover phase capabilities/order, exact counts, no early/optional behavior, test-label freeze, worker payload authority, warnings/errors/abort/destroy, replay selection, runtime identity, canonical output/digest, stderr/redaction, exit codes, no lock/write, main guard, and package WIP preservation.

---

### Task 8: Run safe code gates, whole-change reviews, continuity closeout, and stop

**Files:**
- Review exact D1 spec, this plan, the fourteen source/test paths in the File Responsibility Map, and the single D1 package hunk.
- Scratch only: this plan's `.superpowers/sdd/2026-08-25-score-rate-v5-action-conditioned-held-out-listwise/` directory.

**Interfaces:**
- Consumes: reviewed Tasks 1–7 and their ledger.
- Produces: fresh code-gate evidence and an independent whole-change verdict; never a D1 diagnostic result.

- [ ] **Step 1: Refresh live pre-gate state**

Run continuity Resume with protected excludes plus fresh HEAD/branch/ahead-behind/status/index, all Node processes, repository/index locks, preserved run entries/timestamps/hashes, candidate/default-run absence, both published hashes, and exact scoped diff. Stop on artifact/weight drift, relevant process, lock, or non-empty real index; never delete a lock.

- [ ] **Step 2: Run the exact safe focused suite**

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwise.test.ts training/d1ActionConditionedHeldOutListwiseFit.test.ts training/d1ActionConditionedHeldOutListwiseLabels.test.ts training/d1ActionConditionedHeldOutListwiseCore.test.ts training/archivedRepresentativeAudit.test.ts training/runArtifacts.test.ts training/pool.test.ts src/ai/simulate.test.ts src/ai/search.test.ts src/ai/searchCache.test.ts src/ai/placements.test.ts src/ai/stateTransitions.test.ts src/ai/publicState.test.ts src/ai/features.test.ts src/ai/tetrisStrategy.test.ts src/ai/rng.test.ts src/ai/weights.test.ts src/ai/lineClears.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Record files/tests/skips/failures, exit code, and duration. Stop on the first failure; do not substitute a broader suite.

- [ ] **Step 3: Run explicit-file ESLint**

```powershell
npx eslint training/d1ActionConditionedHeldOutListwise.ts training/d1ActionConditionedHeldOutListwise.test.ts training/d1ActionConditionedHeldOutListwiseWorker.ts training/d1ActionConditionedHeldOutListwiseFitInternals.ts training/d1ActionConditionedHeldOutListwiseFit.ts training/d1ActionConditionedHeldOutListwiseFit.test.ts training/d1ActionConditionedHeldOutListwiseLabels.ts training/d1ActionConditionedHeldOutListwiseLabels.test.ts training/d1ActionConditionedHeldOutListwiseCore.ts training/d1ActionConditionedHeldOutListwiseCore.test.ts training/archivedRepresentativeAudit.ts training/archivedRepresentativeAudit.test.ts src/ai/simulate.ts src/ai/simulate.test.ts
```

Expected: exit 0 with no lint error. Do not run repository-wide lint.

- [ ] **Step 4: Run the production build**

```powershell
npm run build
```

Record exit code and Vite module count. This validates that the additive shared simulator seam does not break the browser build; it does not execute D1.

- [ ] **Step 5: Run safe explicit-root training typecheck**

Generate this plan's `safe-train-tsconfig.json` from tracked `.ts` roots returned by a pathspec that excludes the protected names before Git produces output:

```powershell
git ls-files -- ':(glob)training/*.ts' ':(glob)src/ai/*.ts' ':(glob)src/engine/*.ts' src/types.ts src/constants.ts ':(exclude)training/searchProbe.ts' ':(exclude)training/searchProbeWorker.ts' ':(exclude)training/searchProbe.test.ts'
```

Exclude `src/ai/loadWeights.ts`. Append only these untracked/plan-owned roots if not already tracked: the two archived audit files plus `training/d1ActionConditionedHeldOutListwiseCore.ts`, its test, the Labels source/test, `training/d1ActionConditionedHeldOutListwiseFitInternals.ts`, the Fit source/test, `training/d1ActionConditionedHeldOutListwiseWorker.ts`, and the top-level D1 source/test. Set `extends` to the correct relative `tsconfig.train.json`, `include:[]`, and relative `files`. Before running, assert the list contains none of the three protected probe path names and none of the unrelated B1/B1.1/B1.2 untracked roots.

```powershell
npx tsc -p .superpowers/sdd/2026-08-25-score-rate-v5-action-conditioned-held-out-listwise/safe-train-tsconfig.json --pretty false
```

Expected: exit 0. Do not run bare `npm run typecheck:train`.

- [ ] **Step 6: Run exact diff/index checks**

For each exact changed path, first use `git ls-files --error-unmatch -- <path>` only to classify whether it is tracked. Run `git diff --check -- <path>` and require exit 0 with no diagnostic output for tracked paths. For every untracked path, create one zero-byte `empty-baseline` inside this plan's SDD workspace and capture both streams from `git -c core.safecrlf=false diff --no-index --check -- <empty-baseline> <exact-path>`. Require exit 1 because the required non-empty file differs from the baseline **and** require the captured diagnostic output to contain zero lines; exit 0, exit greater than 1, or any whitespace/conflict-marker diagnostic is an error. Then require:

```powershell
git diff --cached --quiet --
```

This checks the full bytes of all untracked D1 and archived-audit files instead of silently ignoring them. Inspect the exact path diff, distinguish pre-existing WIP from D1 hunks, and prove `package.json` retains all prior entries plus exactly one D1 script. Never stage to manufacture a cleaner diff.

- [ ] **Step 7: Independent whole-change spec review**

Give a fresh reviewer only the D1 spec, this plan, exact D1/shared diffs, task reports/reviews, and fresh gate ledger. Require line-by-line adjudication of source hashes/vectors, seed manifests/digests/disjointness, 160 captures/1,920 placements/7,680 contexts, capture/fingerprint/subset rules, all 24 feature semantics, stream consumption, outcome/front, exact optimizer, freeze/test isolation, all held-out gates, replay, output, runtime identity, invariants, no writes, and protected-probe exclusion.

- [ ] **Step 8: Independent whole-change quality review**

Require review of shared-seam parity, immutable ownership, capability separation, stable bytes, validation composition, deterministic arithmetic, worker cleanup, global listener restoration, error redaction, test realism, runtime cost, no hidden operational run, and unrelated-WIP preservation.

- [ ] **Step 9: Apply at most one final fix wave and scoped re-review**

Dispatch one fixer with the complete Critical/Important list. Every finding first gets a focused RED that names the break, then minimum GREEN. Re-run affected tests, ESLint/typecheck/build when relevant, diff/index checks, and one scoped independent re-review. Any residual load-bearing Critical/Important finding blocks the code gate; do not run D1.

- [ ] **Step 10: Fresh post-flight, ledger/continuity closeout, and explicit stop**

Refresh all Step 1 live evidence again. Update this plan's SDD ledger and the `v5-postmortem` semantic Markdown, use Windows PowerShell 5.1 plus protected excludes for `Checkpoint -> Resume`, and require `match`.

Report explicitly that this command was not run:

```powershell
npm run diagnose:action-conditioned-listwise --silent
```

Also report no B1 diagnostic, calibration, training/resume/restart, bench/paired, publication, push, browser/runtime acceptance, artifact/weight/lock mutation, staging, or commit occurred. Only after this code gate is independently clean may the already-separated operational controller perform a new fresh pre-flight and run the D1 command exactly once.

---

## Plan Self-Review Checklist

- [x] File responsibilities separate pinned source, shared simulation seam, pure manifest/features, labels, deterministic fit, worker, and top-level orchestration.
- [x] D1 reads only the immutable checkpoint/log and selects only gen6-best/gen10-mu; published/gen9 cannot become diagnostic inputs.
- [x] Behavior seeds are 20/8/12 grouped; label seeds are 320; all frozen digests, ordering, uniqueness, and disjoint historical schedules are assigned to Task 1.
- [x] Capture points are first real pre-action decisions for scheduled pieces 128/512; Hold does not create a second subset; valid shallow/exhausted v5 diagnostics are not falsely called missing.
- [x] Root Hold is excluded from list items, but shared standard Hold remains active in source trajectories and continuations.
- [x] Candidate selection uses only fingerprint/placement identity, freezes exactly 12 placements, and has no label import or replacement path.
- [x] `afterstate13` preserves the exact 13 features/order; `action24` is D1-only and covers all eleven approved action-conditioned terms/ranges/chance semantics.
- [x] Frozen streams use exact cross-bag Fisher-Yates/RNG/draw rules; all 7,680 contexts are scheduled with independent cursors and no early stop/retry.
- [x] Survival lexicography precedes score/Tetris Pareto selection; scheduled denominators and integer fraction comparisons cannot reward death or floating tolerance.
- [x] Normalization, softmax, full Hessian, Gaussian elimination, back substitution, Armijo, lambda selection, freeze, top-placement tie-break, and digests are each assigned exact TDD coverage.
- [x] Test labels are structurally inaccessible before two immutable complete final models (records, weights, and normalization) are frozen; validation and test cannot refit, recover hidden parameters, or mutate thresholds/features/subsets.
- [x] Verdict tests cover all 36/48, +8, 12/12, 6/12, joint non-regression/strict-improvement gates and the exact fail-closed precedence.
- [x] Runtime identity is operational-only and injected in code-gate tests; the plan does not assume the controller shell already runs Node 24.14.0.
- [x] Replay is exactly 16 frozen test contexts and compares full projected outcomes/search diagnostics; completed JSON is one canonical line with a recomputed digest.
- [x] Safe tests, explicit lint, build, explicit-root typecheck, diff/index checks, task reviews, and whole-change reviews precede any real D1 run.
- [x] The code gate stops before D1; production integration, training, benchmarks, publication, push, runtime acceptance, artifacts, weights, and locks remain untouched.
