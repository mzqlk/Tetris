# Bag-Aware Deterministic Budget Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the non-viable exact depth-four production search with the approved deterministic work-unit `bag-expectimax-hold-v2` contract, calibrate one shared budget, migrate training to `score-rate-v5` schema 6, and make interrupted training stop at a recoverable generation boundary.

**Architecture:** One per-decision ledger charges placement evaluation, exact chance expansion, and cache-hit traversal before work occurs. Browser and Node production consumers share one frozen iterative-deepening configuration; only complete depths commit. A versioned 96-state public corpus selects a coarse 256-unit candidate below a 140 ms selection line, then validates the frozen value in three independent blocks below 160 ms before any trainer/schema migration proceeds.

**Tech Stack:** TypeScript 5.6, React 18, Zustand, Vitest 3, Node worker threads, Vite 6, PowerShell, Git.

## Global Constraints

- Read `AGENTS.md`, `docs/ai-training-handoff.md`, and `docs/superpowers/specs/2026-08-14-bag-aware-deterministic-budget-search-design.md` before implementation.
- Work directly on the current `master`; do not create a branch or worktree.
- Do not use subagents; the user requires controller/inline execution.
- Preserve the untracked `training/searchProbe.ts`, `training/searchProbeWorker.ts`, and `training/searchProbe.test.ts`. Never stage, edit, delete, move, reset, stash, absorb, or execute them.
- Retain deprecated compile-only `searchFixed`, `FIXED_SEARCH_LIMITS`, and `SearchDiagnostics.aborted` aliases until the protected probe receives separate cleanup authorization; no production consumer may import them and schema 6 must not serialize `aborted`.
- Search sees only `board/current/next/hold/holdAvailable/unseenBagMask`; no ordered bag, bag index, seed, or RNG enters `src/ai/search.ts`.
- Keep exact seven-bag probabilities, standard Hold, survival-first values, maximum depth 4, root beam 64, and child beam 32.
- Work units are charged before: legal placement evaluation, exact chance outcome expansion, and placement/transposition cache-hit traversal.
- One decision uses one ledger and bounded caches across depths 1-4; only a complete depth commits.
- Production config must guarantee depth 1 for every legal public state and must never use wall-clock abort or budget-external fallback.
- Browser speeds change animation delay only; training, benchmarks, and every browser speed use the same frozen search graph.
- Objective is `score-rate-v5`, schema is 6, search contract is `bag-expectimax-hold-v2`, and default output is `public/ai/score-rate-v5/`.
- Fitness remains exactly `meanScore / scheduled maxPieces`; search/Tetris/Hold diagnostics never enter CEM selection.
- `FEATURE_NAMES` remains the exact existing 13-entry order. Published version-3 `score-rate-v2` weights stay unchanged.
- Schema 1-5 and score-rate-v1-v4 checkpoint/log artifacts cannot resume or append into v5.
- Do not run `npm run train`, `npm run bench`, or `npm run bench:paired`.
- Do not modify, delete, or move `public/ai/`, `training-archive/`, `src/ai/trained-weights.json`, published weights, or the existing orphan lock.
- Do not publish, push, or perform browser/runtime acceptance.
- Use exact pathspecs for every `git add`; inspect staged scope before every commit.
- Use bounded serial Vitest commands first: `--pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false`.
- Calibration selection uses 256-unit steps from 1536, a 140 ms selection line, at most 32 candidates, and no adjacent `budget + 1` proof.
- Frozen-budget verification uses three isolated blocks, each with one corpus warmup plus five measured rounds; every block must stay at or below 160 ms.
- `calibrate:search` requires explicit `--select` or `--verify-frozen` mode and emits complete structured JSON on success and failure.

---

## File Responsibility Map

- `src/ai/searchBudget.ts`: pure v2 limits, static depth-one bound, unit ledger, metadata constants.
- `src/ai/searchBudget.test.ts`: ledger and finite-pose bound proofs.
- `src/ai/search.ts`: deterministic iterative-deepening orchestration and search diagnostics.
- `src/ai/searchCache.ts`: charged cache hits and atomic placement-prototype construction.
- `training/searchBudgetCorpus.ts`: 96 explicit public-state snapshots only.
- `training/calibrateSearchBudget.ts`: read-only deterministic budget selection and performance report.
- `src/ai/simulate.ts`: production v2 decision consumption and per-game search diagnostics.
- `training/runArtifacts.ts`: schema-6 exact artifact validation and v5 path isolation.
- `src/ai/trainingObjective.ts`: shared objective/schema/search identity.
- `training/train.ts`: v5 trainer metadata plus interrupt-safe generation boundaries.
- `src/training/dashboard/useTrainingLog.ts`: v5 dashboard path and diagnostics parser.

---

### Task 1: Deterministic Budget Contract and Depth-One Proof

**Files:**
- Create: `src/ai/searchBudget.ts`
- Create: `src/ai/searchBudget.test.ts`

**Interfaces:**
- Consumes: `BOARD_WIDTH`, `TOTAL_ROWS`, `PIECE_MATRICES`, and `PieceType`.
- Produces:

```ts
export type WorkUnitKind = 'placementEvaluation' | 'chanceExpansion' | 'cacheHit';

export interface WorkBudgetSnapshot {
  limit: number;
  used: number;
  placementEvaluationUnits: number;
  chanceExpansionUnits: number;
  cacheHitUnits: number;
  exhausted: boolean;
}

export class WorkBudgetLedger {
  constructor(limit: number);
  tryConsume(kind: WorkUnitKind): boolean;
  snapshot(): WorkBudgetSnapshot;
}

export interface SearchLimits {
  maxRootPlacements: number;
  maxChildPlacements: number;
  maxLockedDepth: 1 | 2 | 3 | 4;
  maxWorkUnits: number;
  transpositionCacheEntries: number;
  placementCacheEntries: number;
}

export const MAX_LEGAL_PLACEMENT_POSES = 756;
export const DEPTH_ONE_REQUIRED_WORK_UNITS = 1512;
export const SEARCH_BUDGET_CORPUS_ID = 'budget-corpus-v1' as const;
export const DETERMINISTIC_SEARCH_LIMITS: Readonly<SearchLimits>;
```

- [ ] **Step 1: Write ledger and pose-bound RED tests**

```ts
it('derives the finite legal-pose upper bound from all four rotations', () => {
  expect(legalPlacementPoseUpperBound()).toBe(756);
  expect(DEPTH_ONE_REQUIRED_WORK_UNITS).toBe(1512);
});

it('charges exactly once before refusing work at the limit', () => {
  const ledger = new WorkBudgetLedger(3);
  expect(ledger.tryConsume('placementEvaluation')).toBe(true);
  expect(ledger.tryConsume('chanceExpansion')).toBe(true);
  expect(ledger.tryConsume('cacheHit')).toBe(true);
  expect(ledger.tryConsume('cacheHit')).toBe(false);
  expect(ledger.snapshot()).toEqual({
    limit: 3, used: 3,
    placementEvaluationUnits: 1,
    chanceExpansionUnits: 1,
    cacheHitUnits: 1,
    exhausted: true,
  });
});

it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects invalid work-unit limit %s',
  (limit) => expect(() => new WorkBudgetLedger(limit)).toThrow(/positive safe integer/i),
);
```

- [ ] **Step 2: Run the new test and verify RED**

```powershell
npx vitest run src/ai/searchBudget.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL because `searchBudget.ts` does not exist.

- [ ] **Step 3: Implement the bounding-box proof**

For each piece rotation, find the minimum and maximum occupied row/column in its 4 x 4 matrix. Sum
`(BOARD_WIDTH - width + 1) * (TOTAL_ROWS - height + 1)` across all four rotations, then take the maximum across piece types 1-7. Keep duplicate O rotations in the proof because it is an upper bound over pose identity.

```ts
export function legalPlacementPoseUpperBound(): number {
  return Math.max(...([1, 2, 3, 4, 5, 6, 7] as PieceType[]).map((type) =>
    PIECE_MATRICES[type].reduce((sum, matrix) => {
      const cells = matrix.flatMap((row, y) =>
        row.flatMap((value, x) => value === 0 ? [] : [{ x, y }]),
      );
      const width = Math.max(...cells.map((cell) => cell.x))
        - Math.min(...cells.map((cell) => cell.x)) + 1;
      const height = Math.max(...cells.map((cell) => cell.y))
        - Math.min(...cells.map((cell) => cell.y)) + 1;
      return sum + (BOARD_WIDTH - width + 1) * (TOTAL_ROWS - height + 1);
    }, 0),
  ));
}
```

Assert module initialization produces 756 and set the depth-one requirement to twice that value. Initialize `DETERMINISTIC_SEARCH_LIMITS.maxWorkUnits` to `DEPTH_ONE_REQUIRED_WORK_UNITS`; Task 3 replaces it with the measured frozen integer.

- [ ] **Step 4: Implement the ledger and limit validation**

`tryConsume` returns false without changing category counts when `used === limit`; after any refusal, `snapshot().exhausted` is true. `snapshot()` returns a fresh frozen value so consumers cannot mutate the ledger.

- [ ] **Step 5: Run focused verification**

```powershell
npx vitest run src/ai/searchBudget.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
npx tsc -b --pretty false
```

Expected: PASS; constants are exactly 756/1512 and no production file changed.

- [ ] **Step 6: Review and commit Task 1**

```powershell
git status --short
git add -- src/ai/searchBudget.ts src/ai/searchBudget.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "feat(ai): add deterministic search budget"
```

Expected staged paths: only the two Task 1 files.

### Task 2: Budgeted Iterative Search and Transactional Caches

**Files:**
- Modify: `src/ai/search.ts`
- Modify: `src/ai/search.test.ts`
- Modify: `src/ai/searchCache.ts`
- Modify: `src/ai/searchCache.test.ts`
- Modify: `src/ai/searchCorpus.test.ts`

**Interfaces:**
- Consumes: Task 1 `SearchLimits`, `WorkBudgetLedger`, `DETERMINISTIC_SEARCH_LIMITS`, and `DEPTH_ONE_REQUIRED_WORK_UNITS`.
- Produces:

```ts
export interface SearchDiagnostics {
  completedDepth: 0 | 1 | 2 | 3 | 4;
  attemptedDepth: 1 | 2 | 3 | 4;
  workUnitsUsed: number;
  workUnitsLimit: number;
  placementEvaluationUnits: number;
  chanceExpansionUnits: number;
  cacheHitUnits: number;
  budgetExhausted: boolean;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
  placementCacheHits: number;
  placementCacheEntries: number;
  transpositionEntries: number;
  equivalentPlacementsRemoved: number;
  prunedChanceBranches: number;
  /** @deprecated Protected probe compile compatibility only. */
  aborted: boolean;
}

export function searchBudgeted(
  state: PublicSearchState,
  weights: number[],
  limits?: SearchLimits,
): SearchDecision | null;
```

`searchBudgeted` is the only production v2 entry. Retain deprecated `searchFixed` and `FIXED_SEARCH_LIMITS` wrappers solely so protected untracked probe sources continue to typecheck. The wrapper delegates to the shared implementation with a compile-compatible legacy budget shape; no tracked production file may import it and no verification command may execute the probe.

```ts
/** @deprecated Protected v1 probe compatibility only. */
export const FIXED_SEARCH_LIMITS = Object.freeze({
  maxRootPlacements: 64,
  maxChildPlacements: 32,
  maxLockedDepth: 4 as const,
});

/** @deprecated Protected v1 probe compatibility only. */
export interface LegacyFixedSearchBudget {
  maxRootPlacements: number;
  maxChildPlacements: number;
  maxLockedDepth: 1 | 2 | 3 | 4;
  shouldAbort: () => boolean;
  cacheEnabled?: boolean;
}

/** @deprecated Never import from production consumers or execute in verification. */
export function searchFixed(
  state: PublicSearchState,
  weights: number[],
  budget?: LegacyFixedSearchBudget,
): SearchDecision | null;
```

The wrapper supplies `Number.MAX_SAFE_INTEGER` work units to the shared engine and exists only for compilation. Keep `MAX_TRANSPOSITION_ENTRIES` and `MAX_PLACEMENT_CACHE_ENTRIES` as deprecated re-exports from `searchCache.ts` so the same protected source typechecks.

- [ ] **Step 1: Write budget-exhaustion RED tests**

Add tests proving:

```ts
it('returns the last complete depth without budget-external fallback', () => {
  const result = searchBudgeted(corpusState(), corpusWeights(), {
    ...DETERMINISTIC_SEARCH_LIMITS,
    maxWorkUnits: DEPTH_ONE_REQUIRED_WORK_UNITS,
  });
  expect(result).not.toBeNull();
  expect(result!.diagnostics.completedDepth).toBe(1);
  expect(result!.diagnostics.attemptedDepth).toBe(2);
  expect(result!.diagnostics.budgetExhausted).toBe(true);
  expect(result!.diagnostics.workUnitsUsed).toBe(DEPTH_ONE_REQUIRED_WORK_UNITS);
});

it('keeps work-unit accounting exact and deterministic', () => {
  const first = searchBudgeted(corpusState(), corpusWeights());
  const second = searchBudgeted(corpusState(), corpusWeights());
  expect(first).toEqual(second);
  const d = first!.diagnostics;
  expect(d.placementEvaluationUnits + d.chanceExpansionUnits + d.cacheHitUnits)
    .toBe(d.workUnitsUsed);
  expect(d.workUnitsUsed).toBeLessThanOrEqual(d.workUnitsLimit);
});

it('rejects a production budget below the global depth-one bound', () => {
  expect(() => searchBudgeted(state(), zeros(), {
    ...DETERMINISTIC_SEARCH_LIMITS,
    maxWorkUnits: DEPTH_ONE_REQUIRED_WORK_UNITS - 1,
  })).toThrow(/depth one/i);
});
```

Use the existing constrained corpus fixture; if it completes depth 2 within 1512 units, use its existing ordinary surviving fixture. Do not weaken the 1512 validation.

- [ ] **Step 2: Write cache atomicity RED tests**

Change `PlacementPrototypeCache.get` to return a discriminated result:

```ts
type PlacementPrototypeLookup =
  | { kind: 'complete'; prototypes: readonly PlacementPrototype[] }
  | { kind: 'exhausted' };
```

Test that a budget ending during prototype construction returns `exhausted`, leaves cache size zero, and consumes no placement-cache hit. A second call with a fresh sufficient ledger must rebuild every prototype and then insert one complete entry. Test that a placement-cache hit and a transposition-cache hit each consume exactly one `cacheHit` unit.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npx vitest run src/ai/searchBudget.test.ts src/ai/searchCache.test.ts src/ai/search.test.ts src/ai/searchCorpus.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL because search still depends on `shouldAbort`, fallback, and uncharged caches.

- [ ] **Step 4: Make placement-cache construction transactional**

Enumerate legal placements first. Before each `evaluatePlacement`, call
`ledger.tryConsume('placementEvaluation')`. Build prototypes in a local array and call cache `set` only after the whole array completes. On a cache hit, consume `cacheHit` before returning the stored list; if consumption fails, return `exhausted` without exposing it.

Use the configured `placementCacheEntries` instead of a module-private literal. Preserve prototype materialization and board immutability.

- [ ] **Step 5: Charge transposition and exact chance work**

Before using a known transposition entry, consume `cacheHit`; distinguish `miss`, `hit`, and `exhausted` so budget failure cannot look like a cache miss. Before each `enumerateBagOutcomes` child is revealed/evaluated, consume `chanceExpansion`. Keep all exact probabilities and strict survival pruning unchanged.

- [ ] **Step 6: Replace wall-clock abort with complete-depth commits**

Remove `shouldAbort`, `abortResult`, and `completePlacementFallback` from the v2 path. Create one ledger/context, then run depths 1-4 in order. Set deprecated `diagnostics.aborted` to the same Boolean as `budgetExhausted` only at the returned compatibility boundary:

```ts
let committed: SearchDecision | null = null;
for (let depth = 1; depth <= limits.maxLockedDepth; depth++) {
  diagnostics.attemptedDepth = depth as 1 | 2 | 3 | 4;
  const result = searchDecision(state, depth, true, context);
  if (!result.completed) {
    diagnostics.budgetExhausted = true;
    if (depth === 1) throw new Error('depth-one work budget invariant violated');
    break;
  }
  diagnostics.completedDepth = depth as 1 | 2 | 3 | 4;
  if (result.action !== null) committed = decisionFrom(result, diagnostics);
}
```

Snapshot ledger counters into diagnostics before returning. A complete terminal root may return null; it must not set `budgetExhausted`.

- [ ] **Step 7: Migrate existing search regressions**

Replace abort-call-count tests with exact work-unit boundaries. Preserve tests for 64/32 beam prefixes, Hold outside beam, exact chance probabilities, public-state fairness, terminal semantics, deterministic ties, equivalent collapse, survival pruning, and cache entry caps. For cache-on/off semantic parity, give both calls enough work units to complete the same requested shallow depth; do not compare two searches that completed different depths.

- [ ] **Step 8: Run focused and type gates**

```powershell
npx vitest run src/ai/searchBudget.test.ts src/ai/searchCache.test.ts src/ai/search.test.ts src/ai/searchCorpus.test.ts src/ai/stateTransitions.test.ts src/ai/placements.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
npx tsc -b --pretty false
npm run typecheck:train
```

Expected: PASS with no depth-4 ordinary-state probe and no Node process left behind.

- [ ] **Step 9: Review and commit Task 2**

```powershell
git status --short -- public/ai src/ai/trained-weights.json training/searchProbe.ts training/searchProbeWorker.ts training/searchProbe.test.ts
git add -- src/ai/search.ts src/ai/search.test.ts src/ai/searchCache.ts src/ai/searchCache.test.ts src/ai/searchCorpus.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "feat(ai): budget iterative expectimax work"
```

Expected: protected artifacts unchanged; probe files remain untracked and unstaged.

### Task 3: Versioned Corpus, Calibrator, and Frozen Budget Gate

**Files:**
- Create: `training/searchBudgetCorpus.ts`
- Create: `training/searchBudgetCorpus.test.ts`
- Create: `training/calibrateSearchBudget.ts`
- Create: `training/calibrateSearchBudget.test.ts`
- Modify: `src/ai/searchBudget.ts`
- Modify: `src/ai/searchBudget.test.ts`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-08-14-bag-aware-deterministic-budget-search-design.md`

**Interfaces:**
- Produces:

```ts
export type CorpusStratum = 'low' | 'medium' | 'high' | 'danger';

export interface SerializedBudgetState {
  id: string;
  stratum: CorpusStratum;
  rows: readonly number[]; // exactly 22 unsigned 10-bit occupancy masks
  current: Piece;
  next: PieceType;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: number;
}

export const BUDGET_CORPUS_V1: readonly SerializedBudgetState[];
export function materializeBudgetState(value: SerializedBudgetState): PublicSearchState;

export const BUDGET_CANDIDATE_STEP = 256;
export const SELECTION_P95_LIMIT_MS = 140;
export const VERIFICATION_P95_LIMIT_MS = 160;
export const MAX_SELECTION_CANDIDATES = 32;
export const VERIFICATION_BLOCKS = 3;

export interface CandidateMeasurement {
  budget: number;
  rounds: readonly [CalibrationRound, CalibrationRound, CalibrationRound, CalibrationRound, CalibrationRound];
  worstP95Ms: number;
  depthHistogram: readonly [number, number, number, number, number];
  workUnitsUsed: readonly number[]; // exactly 5 x 96 entries
  placementEvaluationUnits: number;
  chanceExpansionUnits: number;
  cacheHitUnits: number;
  allDepthOneComplete: boolean;
  allDepthFourComplete: boolean;
  overBudgetCount: number;
  deterministic: boolean;
  reasons: readonly string[];
}

export interface SelectionOutput {
  mode: 'select';
  status: 'pass' | 'fail';
  corpus: 'budget-corpus-v1';
  proposedBudget: number | null;
  candidates: readonly CandidateMeasurement[];
  failureReasons: readonly string[];
  environment: CalibrationEnvironment;
}

export interface VerificationOutput {
  mode: 'verify-frozen';
  status: 'pass' | 'fail';
  corpus: 'budget-corpus-v1';
  frozenBudget: number;
  blocks: readonly CandidateMeasurement[]; // exactly 3 entries
  failureReasons: readonly string[];
  environment: CalibrationEnvironment;
}

export function selectBudgetFromLadder(
  measure: (maxWorkUnits: number) => CandidateMeasurement,
  minimum?: number,
): Omit<SelectionOutput, 'environment'>;

export function verifyFrozenBudget(
  frozenBudget: number,
  measure: (maxWorkUnits: number) => CandidateMeasurement,
): Omit<VerificationOutput, 'environment'>;
```

- [ ] **Step 1: Write corpus contract RED tests**

```ts
it('contains 96 explicit public snapshots in four equal strata', () => {
  expect(BUDGET_CORPUS_V1).toHaveLength(96);
  for (const stratum of ['low', 'medium', 'high', 'danger'] as const) {
    expect(BUDGET_CORPUS_V1.filter((state) => state.stratum === stratum)).toHaveLength(24);
  }
});

it('contains only public state fields and valid 22-row masks', () => {
  for (const state of BUDGET_CORPUS_V1) {
    expect(Object.keys(state).sort()).toEqual([
      'current', 'hold', 'holdAvailable', 'id', 'next', 'rows', 'stratum', 'unseenBagMask',
    ]);
    expect(state.rows).toHaveLength(22);
    expect(state.rows.every((row) => Number.isInteger(row) && row >= 0 && row < 1024)).toBe(true);
    expect(state).not.toHaveProperty('bag');
    expect(state).not.toHaveProperty('seed');
    expect(state).not.toHaveProperty('rng');
  }
});

it('covers every piece and all public Hold/bag boundaries', () => {
  expect(new Set(BUDGET_CORPUS_V1.map((state) => state.current.type)).size).toBe(7);
  expect(new Set(BUDGET_CORPUS_V1.map((state) => state.next)).size).toBe(7);
  expect(BUDGET_CORPUS_V1.some((state) => state.hold === null)).toBe(true);
  expect(BUDGET_CORPUS_V1.some((state) => state.hold !== null)).toBe(true);
  expect(BUDGET_CORPUS_V1.some((state) => state.holdAvailable)).toBe(true);
  expect(BUDGET_CORPUS_V1.some((state) => !state.holdAvailable)).toBe(true);
  expect(BUDGET_CORPUS_V1.some((state) => state.unseenBagMask === 0)).toBe(true);
});
```

- [ ] **Step 2: Create the 96 explicit snapshots**

Store all row masks and public fields as literals. Use IDs `low-00` through `danger-23`. Assign strata by actual maximum occupied height: low 0-4, medium 5-9, high 10-15, danger 16-20. `materializeBudgetState` maps bit `x` in row `y` to a nonzero occupied cell and calls `assertPublicSearchState` before returning. Do not import `rng.ts`, `simulate.ts`, `generateBag`, or a seed.

- [ ] **Step 3: Write selection-ladder RED tests**

Inject measurements so tests run without real search or wall clock. Prove:

```ts
it('selects the largest scanned 256-unit candidate below the 140 ms line', () => {
  const result = selectBudgetFromLadder((budget) => fakeMeasurement({
    budget,
    worstP95Ms: budget <= 3584 ? 139 : 161,
  }));
  expect(result.status).toBe('pass');
  expect(result.proposedBudget).toBe(3584);
  expect(result.candidates.map((candidate) => candidate.budget)).toEqual([
    1536, 1792, 2048, 2304, 2560, 2816, 3072, 3328, 3584, 3840, 4096,
  ]);
});
```

Also prove that the selector:

- starts at 1536 even when the caller minimum is 1512;
- stops after every state completes depth 4;
- stops after two consecutive candidates exceed 160 ms;
- fails after 32 candidates if neither normal stop condition occurs;
- fails when no scanned candidate passes 140 ms;
- fails on incomplete depth 1, over-budget work, nondeterminism, a non-five-round measurement, a wrong 480-entry work-unit distribution, or a category-unit sum mismatch;
- does not require `proposedBudget + 1` to fail and does not overwrite earlier candidate traces.

- [ ] **Step 4: Write frozen-verification and JSON RED tests**

```ts
it('requires three isolated frozen-budget blocks below 160 ms', () => {
  let block = 0;
  const result = verifyFrozenBudget(3584, (budget) => fakeMeasurement({
    budget,
    worstP95Ms: [151, 159, 160][block++],
  }));
  expect(result.status).toBe('pass');
  expect(result.blocks).toHaveLength(3);
});
```

Add separate failures for block p95 above 160 ms and every structural invariant. Test success and failure serialization for both modes. Each output must retain all five rounds, the full 480-value work-unit distribution, category totals, depth histogram, qualification reasons, thresholds, corpus id, and environment. Invalid/missing/combined mode flags fail with structured JSON and a nonzero CLI result; do not test by reading source text.

- [ ] **Step 5: Run focused tests and verify RED**

```powershell
npx vitest run training/searchBudgetCorpus.test.ts training/calibrateSearchBudget.test.ts src/ai/searchBudget.test.ts src/ai/search.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL because the current WIP still implements noisy integer bisection, has no explicit modes, and omits auditable candidate/block output.

- [ ] **Step 6: Implement explicit snapshots and measurement traces**

Keep all 96 row masks and public fields as literals. `measureCandidate` warms the whole corpus once, then records exactly five complete rounds. Compare action, value, completed depth, and unit diagnostics for each state across rounds. Preserve all 480 `workUnitsUsed` values, category totals, depth histogram, p50/p95/max, depth-one/depth-four completion, over-budget count, deterministic status, and explicit qualification reasons. Validate internally that category totals reconstruct total work and that `worstP95Ms` equals the maximum of exactly five round p95 values.

- [ ] **Step 7: Implement the selection ladder**

Start at `Math.ceil(maximum(1512, minimum) / 256) * 256`. Measure ascending 256-unit candidates and retain every measurement. A candidate is selectable only when its structural invariants pass and `worstP95Ms <= 140`. Stop after all states complete depth 4, after two consecutive `worstP95Ms > 160`, or fail after 32 candidates. Return the largest selectable scanned budget; never perform an adjacent `+1` proof or overwrite an earlier measurement.

- [ ] **Step 8: Implement frozen verification and the import-safe CLI**

Add `"calibrate:search": "tsx training/calibrateSearchBudget.ts"` to `package.json`. The CLI must:

- require exactly one of `--select` and `--verify-frozen`;
- use `process.hrtime.bigint()` only for measurement, never for search decisions;
- run `--verify-frozen` as three sequential blocks, each with a new warmup plus five measured rounds;
- emit one complete `SelectionOutput` or `VerificationOutput` JSON on success and failure;
- include Node version, OS, CPU model, thresholds, candidate step, maximum candidate count, block count, and every measurement trace;
- exit nonzero exactly when output status is `fail`;
- never import filesystem write APIs or write artifacts/source.

Use an `isMain(import.meta.url)` guard so unit tests can import helpers without running calibration.

- [ ] **Step 9: Run unit and type tests**

```powershell
npx vitest run training/searchBudgetCorpus.test.ts training/calibrateSearchBudget.test.ts src/ai/searchBudget.test.ts src/ai/search.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
npm run typecheck:train
```

Expected: PASS without running real wall-clock calibration.

- [ ] **Step 10: Preflight and run the selection hard gate**

Refresh Node processes, protected paths, the stale external trainer lock, and Task 3 diff before execution. Do not delete the lock or run while another Tetris calibration/test/train process exists.

```powershell
npm run calibrate:search -- --select
```

Expected: exit 0 and `status: "pass"`; proposed budget is a 256-unit multiple at least 1536, its selection measurement has five-round worst p95 no more than 140 ms, all structural invariants pass, a normal stop condition is recorded, and complete candidate traces are present.

If the command fails, reaches the 32-candidate cap, lacks audit fields, crashes, or leaves a Node process: capture the bounded JSON/process evidence in the continuity checkpoint and stop the entire plan. Do not change 4/64/32, remove exact chance outcomes, run training, or continue to Task 4.

- [ ] **Step 11: Freeze only the proposed staircase integer**

Use `apply_patch` to replace the stale, rejected 4390 WIP with the exact JSON `proposedBudget`. Add a test asserting that integer. Do not add accepted calibration evidence to the design yet; selection alone is not acceptance.

- [ ] **Step 12: Run the frozen-budget verification hard gate**

```powershell
npm run calibrate:search -- --verify-frozen
```

Expected: exit 0 and `status: "pass"`; JSON contains exactly three blocks, every block has five complete rounds, every block worst p95 is no more than 160 ms, and all structural invariants pass. On failure or residual calibration process, checkpoint the evidence and stop the plan without selecting another budget.

- [ ] **Step 13: Append accepted evidence and re-run focused gates**

Only after verification passes, append a “Calibration evidence” section to the design containing the proposed/frozen integer, corpus id, selection candidate trace summary, all three verification block p95 arrays, depth/unit distributions, environment, command date, and explicit statement that 4390/3998 were rejected historical attempts.

```powershell
npx vitest run src/ai/searchBudget.test.ts training/searchBudgetCorpus.test.ts training/calibrateSearchBudget.test.ts src/ai/search.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
npm run typecheck:train
```

Expected: all focused tests and training typecheck pass; no calibration Node remains.

- [ ] **Step 14: Review and commit Task 3**

```powershell
git status --short -- public/ai src/ai/trained-weights.json training/searchProbe.ts training/searchProbeWorker.ts training/searchProbe.test.ts
git add -- training/searchBudgetCorpus.ts training/searchBudgetCorpus.test.ts training/calibrateSearchBudget.ts training/calibrateSearchBudget.test.ts src/ai/searchBudget.ts src/ai/searchBudget.test.ts package.json docs/superpowers/specs/2026-08-14-bag-aware-deterministic-budget-search-design.md
git diff --cached --check
git diff --cached --name-status
git commit -m "perf(ai): calibrate deterministic search budget"
```

### Task 4: Shared Browser, Simulator, Worker, and Diagnostic Consumption

**Files:**
- Modify: `src/hooks/useAiPlayer.ts`
- Modify: `src/hooks/useAiPlayer.test.ts`
- Modify: `src/ai/simulate.ts`
- Modify: `src/ai/simulate.test.ts`
- Modify: `training/worker.ts`
- Modify: `training/pool.ts`
- Modify: `training/pool.test.ts`
- Modify: `training/cem.ts`
- Modify: `training/cem.test.ts`
- Modify: `training/benchSummary.ts`
- Modify: `training/benchSummary.test.ts`

**Interfaces:**
- Production browser/simulator import `searchBudgeted` and `DETERMINISTIC_SEARCH_LIMITS` directly.
- `SimTask` no longer contains a search configuration.
- `SimulationSearchDiagnostics` becomes:

```ts
export interface SimulationSearchDiagnostics {
  searchCalls: number;
  holdActions: number;
  holdRate: number;
  meanCompletedDepth: number;
  minCompletedDepth: number;
  completedDepthHistogram: [number, number, number, number, number];
  totalWorkUnitsUsed: number;
  meanWorkUnitsUsed: number;
  maxWorkUnitsUsed: number;
  budgetExhaustedSearches: number;
  budgetExhaustionRate: number;
  placementEvaluationUnits: number;
  chanceExpansionUnits: number;
  cacheHitUnits: number;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
}
```

- [ ] **Step 1: Write browser-equivalence RED tests**

Change `planAction` to accept only `(state, weights)`. Spy on `searchBudgeted` and call plans with instant/normal/slow options; assert all calls receive the frozen config and no function/deadline argument. Keep plan replay, Hold, gravity invalidation, and hard-drop tests.

- [ ] **Step 2: Write simulation aggregation RED tests**

Run a one-piece controlled simulation and assert histogram sum equals `searchCalls`, category unit sums reconstruct total work, maximum never exceeds the frozen budget, and exhaustion rate is `budgetExhaustedSearches / searchCalls`. Add `aggregateFitness` tests proving changing only search diagnostics leaves fitness, elite order, `mu`, and `sigma` unchanged.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npx vitest run src/hooks/useAiPlayer.test.ts src/ai/simulate.test.ts training/pool.test.ts training/cem.test.ts training/benchSummary.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL on old `shouldAbort`, `searchFixed`, task search config, and abort diagnostics.

- [ ] **Step 4: Remove browser wall-clock decisions**

Delete the 100/200 ms deadline and `performance.now()` predicate. Keep existing action animation delays (`instant` 0, `normal` 40, `slow` 150 ms) unchanged. `planAction` calls `searchBudgeted(state, weights, DETERMINISTIC_SEARCH_LIMITS)`.

- [ ] **Step 5: Make simulator production search immutable**

Replace the production `searchFixed` call with `searchBudgeted`. Production `simulateGame` uses the frozen limits. If shallow injection is required for simulator-only unit tests, export `simulateGameWithSearchForTest(opts, limits)` from `simulate.ts`, document it as test-only, and assert no tracked production file imports it. Do not carry a configurable search object through `SimTask`, worker messages, trainer, or benchmark plans.

- [ ] **Step 6: Aggregate v2 diagnostics exactly**

Track per-search completed depth, used units, categories, and exhaustion in `SimState`. `totalWorkUnitsUsed` equals the three category totals and `meanWorkUnitsUsed` equals total divided by `searchCalls`. For multi-game CEM aggregation, sum `searchCalls`, histograms, total/category units, and exhaustion counts before deriving rates; take the true maximum for `maxWorkUnitsUsed`. Update failed-worker zero diagnostics to the full v2 shape.

- [ ] **Step 7: Update benchmark summary formatting without running a benchmark**

Replace `abortedSearches` with budget exhaustion count/rate, add completed-depth histogram and mean/max units, and keep score/tetris/survival calculations unchanged.

- [ ] **Step 8: Run focused and type gates**

```powershell
npx vitest run src/hooks/useAiPlayer.test.ts src/ai/simulate.test.ts training/pool.test.ts training/cem.test.ts training/benchSummary.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
npx tsc -b --pretty false
npm run typecheck:train
```

- [ ] **Step 9: Review and commit Task 4**

```powershell
git add -- src/hooks/useAiPlayer.ts src/hooks/useAiPlayer.test.ts src/ai/simulate.ts src/ai/simulate.test.ts training/worker.ts training/pool.ts training/pool.test.ts training/cem.ts training/cem.test.ts training/benchSummary.ts training/benchSummary.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "feat(ai): share budgeted search diagnostics"
```

### Task 5: Score-Rate-v5 Identity, Weights, Candidate, and Reevaluation Schemas

**Files:**
- Modify: `src/ai/trainingObjective.ts`
- Modify: `src/ai/weights.ts`
- Modify: `src/ai/weights.test.ts`
- Modify: `training/objective.ts`
- Modify: `training/candidateWeights.ts`
- Modify: `training/candidateWeights.test.ts`
- Modify: `training/reevaluationLog.ts`
- Modify: `training/reevaluationLog.test.ts`

**Interfaces:**
- Produce `SCORE_RATE_V4_OBJECTIVE = 'score-rate-v4'`, current
  `SCORE_RATE_OBJECTIVE = 'score-rate-v5'`, `SEARCH_CONTRACT = 'bag-expectimax-hold-v2'`, and `SEARCH_SCHEMA_VERSION = 6`.
- Produce one frozen exact metadata object:

```ts
export const SEARCH_METADATA = Object.freeze({
  searchContract: 'bag-expectimax-hold-v2',
  searchDepth: 4,
  rootBeamWidth: 64,
  childBeamWidth: 32,
  maxWorkUnits: DETERMINISTIC_SEARCH_LIMITS.maxWorkUnits,
  budgetCorpus: 'budget-corpus-v1',
  transpositionCacheEntries: 65_536,
  placementCacheEntries: 16_384,
} as const);
```

- [ ] **Step 1: Write current/legacy weight RED tests**

Test exact version-6 v5 metadata acceptance; missing/wrong/extra mutation rejection for every new field; version-5 v4 files accepted only by the in-memory legacy loader; schema-5 candidate/resume payload rejected by current validators; version-3 published weights still receive only in-memory zero extension and are not rewritten.

- [ ] **Step 2: Write candidate and reevaluation exact-key RED tests**

Extend fixtures with all eight metadata fields and the Task 4 diagnostics. For each of `maxWorkUnits`, `budgetCorpus`, `transpositionCacheEntries`, and `placementCacheEntries`, test missing, wrong, and extra-key mutations. Diagnostic absence in schema 6 must fail closed; do not synthesize zero diagnostics.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npx vitest run src/ai/weights.test.ts training/candidateWeights.test.ts training/reevaluationLog.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 4: Implement identity and metadata from one source**

Import limits/corpus constants into `trainingObjective.ts`, export `SEARCH_METADATA`, and spread/read it in writers and validators. Do not repeat string literals in trainer/candidate builders. Add v4 as an explicit legacy objective in the weight loader while keeping the existing feature-length compatibility behavior.

- [ ] **Step 5: Make schema-6 diagnostics fail closed**

Candidate and reevaluation validators require finite, internally consistent unit fields: category sum equals total/mean representation, histogram entries are non-negative, rates equal counts divided by calls within existing numeric tolerance, and maxima do not exceed `maxWorkUnits`.

- [ ] **Step 6: Run focused and type gates**

```powershell
npx vitest run src/ai/weights.test.ts training/candidateWeights.test.ts training/reevaluationLog.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
npx tsc -b --pretty false
npm run typecheck:train
```

- [ ] **Step 7: Review and commit Task 5**

```powershell
git add -- src/ai/trainingObjective.ts src/ai/weights.ts src/ai/weights.test.ts training/objective.ts training/candidateWeights.ts training/candidateWeights.test.ts training/reevaluationLog.ts training/reevaluationLog.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "feat(training): define score-rate-v5 schema"
```

### Task 6: Schema-6 Run Artifacts, Trainer, Bench Plans, and Dashboard

**Files:**
- Modify: `training/config.ts`
- Modify: `training/config.test.ts`
- Modify: `training/runArtifacts.ts`
- Modify: `training/runArtifacts.test.ts`
- Modify: `training/train.ts`
- Modify: `training/train-cli.test.ts`
- Modify: `training/bench.ts`
- Modify: `training/benchSummary.test.ts`
- Modify: `training/pairedBench.ts`
- Modify: `training/pairedBench.test.ts`
- Modify: `src/training/dashboard/useTrainingLog.ts`
- Modify: `src/training/dashboard/useTrainingLog.test.ts`
- Modify: `src/training/dashboard/types.ts`
- Modify: `src/training/dashboard/App.tsx` only where labels render old abort/search fields.

**Interfaces:**
- `TrainConfig` contains evolutionary/schedule values only; remove `searchDepth`, `rootBeamWidth`, and `childBeamWidth`.
- `resolveRunPaths(root, null)` resolves `public/ai/score-rate-v5`.
- Every schema-6 checkpoint/log/schedule contains exact `SEARCH_METADATA` fields.
- Benchmark and paired plans use the frozen shared search implicitly and expose no depth/budget flag.

- [ ] **Step 1: Write config/path isolation RED tests**

Assert default v5 paths, schema 1-5 resume rejection, v4 log append rejection, and a serializable config with no search keys. Verify the shared exported metadata is consumed at trainer/bench/paired boundaries through real payloads and type-level config absence; do not read or match source text.

- [ ] **Step 2: Write generation/checkpoint mutation RED tests**

For checkpoint, generation log, reevaluation schedule, and candidate linkage, mutate each new metadata field as missing/wrong/extra and expect validation before worker creation or file append. Assert exact schema version 6 and objective v5.

- [ ] **Step 3: Write dashboard RED tests**

Assert `LOG_URL === '/ai/score-rate-v5/training-log.jsonl'`; v5 lines with exact metadata parse; v1-v4 or wrong-budget lines are ignored; Task 4 histogram/unit diagnostics are normalized only after the schema-6 line passes metadata validation.

- [ ] **Step 4: Run focused tests and verify RED**

```powershell
npx vitest run training/config.test.ts training/runArtifacts.test.ts training/train-cli.test.ts training/benchSummary.test.ts training/pairedBench.test.ts src/training/dashboard/useTrainingLog.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 5: Remove duplicate search settings from trainer config**

Delete the three fixed search fields from `TrainConfig`, defaults, checkpoint config key lists, CLI/restoration logic, and console formatting. Print the frozen search metadata separately. `workers` remains the only execution throttle.

- [ ] **Step 6: Migrate run artifacts and trainer writes**

Set checkpoint/candidate versions to 6, default path to v5, and spread `SEARCH_METADATA` into checkpoint, generation, reevaluation, and schedule payloads. Worker tasks no longer carry search config. Preserve generation seeds, score-rate fitness, fixed reevaluation, qualification, and publication boundaries.

- [ ] **Step 7: Migrate bench and paired planning without executing them**

Both baseline and candidate use the same implicit `DETERMINISTIC_SEARCH_LIMITS`. Paired candidate validation requires schema 6 v5 metadata. Keep identical paired seeds/caps and CI math unchanged; do not add `--depth` or `--budget` flags.

- [ ] **Step 8: Migrate dashboard parsing/rendering**

Update v5 path/objective/metadata validation and show completed-depth histogram, mean/max units, and exhaustion rate. Replace “aborts” labels with “budget exhaustion”; do not imply exhaustion is a crash.

- [ ] **Step 9: Run focused and type/build gates**

```powershell
npx vitest run training/config.test.ts training/runArtifacts.test.ts training/train-cli.test.ts training/benchSummary.test.ts training/pairedBench.test.ts src/training/dashboard/useTrainingLog.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
npx tsc -b --pretty false
npm run typecheck:train
npm run build
```

- [ ] **Step 10: Review and commit Task 6**

```powershell
git status --short -- public/ai src/ai/trained-weights.json
git add -- training/config.ts training/config.test.ts training/runArtifacts.ts training/runArtifacts.test.ts training/train.ts training/train-cli.test.ts training/bench.ts training/benchSummary.test.ts training/pairedBench.ts training/pairedBench.test.ts src/training/dashboard/useTrainingLog.ts src/training/dashboard/useTrainingLog.test.ts src/training/dashboard/types.ts src/training/dashboard/App.tsx
git diff --cached --check
git diff --cached --name-status
git commit -m "feat(training): isolate score-rate-v5 runs"
```

### Task 7: Abortable Pool and Recoverable SIGINT Boundary

**Files:**
- Modify: `training/pool.ts`
- Modify: `training/pool.test.ts`
- Modify: `training/train.ts`
- Modify: `training/train-cli.test.ts`

**Interfaces:**
- Produce:

```ts
export class WorkerPoolAbortError extends Error {
  readonly name = 'WorkerPoolAbortError';
}

export interface WorkerPoolRunOptions { signal?: AbortSignal }

run(tasks: SimTask[], options?: WorkerPoolRunOptions): Promise<SimTaskResult[]>;
```

- [ ] **Step 1: Write pool abort RED tests**

Use controlled workers that never answer. Abort an in-flight run and assert `WorkerPoolAbortError`, exactly-once termination, no retry/replacement, no failed-fitness result, and idempotent concurrent `destroy()`. Test an already-aborted signal rejects before any `postMessage`.

- [ ] **Step 2: Run pool tests and verify RED**

```powershell
npx vitest run training/pool.test.ts --testNamePattern "abort|destroy" --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

- [ ] **Step 3: Implement one-shot abort and teardown**

Register one listener before feeding workers. Atomically settle, stop feed/retry/replacement, await one stored `destroyPromise`, remove listener, and reject with `WorkerPoolAbortError`. Normal completion/error removes the listener too. Preserve genuine crash retry when no abort signal fired.

- [ ] **Step 4: Isolate trainer CLI tests from the live repository**

In suite `beforeAll`, copy only required `training/`, `src/`, `package.json`, and TypeScript configs into one temporary directory, run `git init`, and execute the copied trainer with `process.execPath --import tsx`. Remove the temporary directory in `afterAll`. Tests must not inspect, rewrite, or remove the live orphan lock.

- [ ] **Step 5: Write controlled gen-0 SIGINT RED test**

Use a preload that blocks the first worker task and emits one SIGINT. Assert exit 0, message says the incomplete generation is abandoned, schema-6 v5 checkpoint has `gen: 0`, no generation log exists, a `--resume --generations 0` validation succeeds, and the temporary repository lock is released.

- [ ] **Step 6: Implement trainer cancellation**

Create one `AbortController` after pool construction. First SIGINT aborts current generation/reevaluation. Catch only `WorkerPoolAbortError` while stopping; do not update CEM, append logs, advance gen, or qualify a candidate. Save the last complete boundary once. Remove the SIGINT listener in `finally`; keep pool destruction and lock release in existing outer finally blocks. Second SIGINT sets nonzero exit status without a cleanup claim.

- [ ] **Step 7: Run cancellation and artifact gates**

```powershell
npx vitest run training/pool.test.ts training/train-cli.test.ts training/runLock.test.ts training/runArtifacts.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
npm run typecheck:train
```

Expected: PASS; all temporary artifacts removed; live orphan lock and `public/ai` unchanged.

- [ ] **Step 8: Review and commit Task 7**

```powershell
git status --short -- public/ai src/ai/trained-weights.json
git add -- training/pool.ts training/pool.test.ts training/train.ts training/train-cli.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "fix(training): checkpoint aborted generations safely"
```

### Task 8: Operator Documentation and Active Contract

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/ai-training-handoff.md`

**Interfaces:**
- Documents v5/schema6/v2/frozen budget/corpus/default path, calibration command, user-run smoke boundary, and unchanged published v3 model.

- [ ] **Step 1: Update active-contract text**

Replace statements that call v4/v1 the active trainer/search contract. Preserve historical sections as explicitly historical. State that scalar fitness and 13 feature order did not change.

- [ ] **Step 2: Add exact operator commands and gates**

Document:

```powershell
npm run calibrate:search -- --select
npm run calibrate:search -- --verify-frozen
npm test
npm run lint
npm run build
npm run typecheck:train
```

State that calibration is not training/benchmark/browser acceptance. Describe first-SIGINT behavior, gen-0 resume, and why stale-lock deletion is never automatic.

- [ ] **Step 3: Document the next user-run smoke procedure without running it**

Require fresh process/lock/artifact inspection, an operator-confirmed empty output directory, and a one-generation command supplied to the user only after those checks. State that the assistant must not execute it and that one generation is a signal gate, not publication evidence.

- [ ] **Step 4: Scan active text for stale identities**

```powershell
rg -n "active.*score-rate-v4|current.*score-rate-v4|default.*score-rate-v4|bag-expectimax-hold-v1|schema 5" AGENTS.md README.md docs/ai-training-handoff.md
```

Expected: remaining matches are clearly labeled historical/published compatibility statements, not active instructions.

- [ ] **Step 5: Review and commit Task 8**

```powershell
git add -- AGENTS.md README.md docs/ai-training-handoff.md
git diff --cached --check
git diff --cached --name-status
git commit -m "docs(training): hand off score-rate-v5 workflow"
```

### Task 9: Whole-Change Review, Fresh Gates, and User Handoff

**Files:**
- Modify only files required by confirmed whole-change findings.
- Update outside Git with `apply_patch`: `C:\Users\Administrator\.codex\continuity\workspaces\971086e837942ad7\bagv2.md`.

**Interfaces:**
- Consumes: design commit `2e5efc0` and Tasks 1-8.
- Produces: reviewed code-only/calibration handoff; no training, benchmark, publication, push, lock deletion, or browser acceptance.

- [ ] **Step 1: Verify real HEAD and protected WIP before review**

```powershell
git log --oneline --decorate -12
git status --short --branch
git diff --stat 2e5efc0..HEAD
git status --short -- training/searchProbe.ts training/searchProbeWorker.ts training/searchProbe.test.ts public/ai src/ai/trained-weights.json
```

Expected: probe files remain untracked and unchanged; protected artifact status is empty.

- [ ] **Step 2: Perform a whole-range semantic review**

Inspect `git diff 2e5efc0..HEAD -- src/ai src/hooks training src/training AGENTS.md README.md docs/ai-training-handoff.md package.json`. Check every fixed invariant: public-only state, exact chance, Hold, 4/64/32, charge-before-work, depth-one proof, no fallback, partial-cache exclusion, one production config, no time decision, schema 6 exact keys, v1-v5 resume rejection, unchanged fitness, diagnostic-only search metrics, cancellation without failure scoring, and lock cleanup paths.

For each confirmed Critical/Important issue, add a failing test, implement the smallest fix, run scoped tests, and commit with `fix(...)`. Do not make speculative refactors.

- [ ] **Step 3: Run fresh calibration verification**

```powershell
npm run calibrate:search -- --verify-frozen
```

Expected: `--verify-frozen` reports the already frozen budget, exactly three verification blocks, all 96 depth-1 complete in every block, no unit overrun/nondeterminism, and every block's five-round worst p95 <= 160 ms. `--select` is only run when choosing a new staircase candidate; it does not prove frozen acceptance. Stop on failure.

- [ ] **Step 4: Run fresh code gates separately**

```powershell
npm test
npm run lint
npm run build
npm run typecheck:train
git diff --check
```

Expected: every command exits 0. Do not replace failures with historical evidence.

- [ ] **Step 5: Refresh volatile process/artifact/lock evidence read-only**

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId,CommandLine
Get-ChildItem -Force 'public/ai/score-rate-v5' -ErrorAction SilentlyContinue
Get-ChildItem -Force $env:TEMP -Filter 'tetris-trainer-*.lock'
git status --short -- public/ai src/ai/trained-weights.json training/searchProbe.ts training/searchProbeWorker.ts training/searchProbe.test.ts
```

Expected: no calibration/test Node remains; no protected tracked change; probe WIP still untracked. Report the live lock state; never delete it.

- [ ] **Step 6: Update and checkpoint continuity**

Record exact commits, frozen budget, calibration environment/p95/depth distribution, test outputs, protected-path state, lock state, and all unexecuted gates in `bagv2.md`, then run:

```powershell
& "$HOME\.codex\skills\long-task-continuity\scripts\continuity.ps1" -Action Checkpoint -Workspace 'D:\WorkSpace\Tetris' -TaskId bagv2
```

- [ ] **Step 7: Hand off the user-run one-generation command**

Only if code/calibration gates pass and the user separately authorizes any necessary stale-lock cleanup, select a timestamped non-existing directory and provide—do not run—the command:

```powershell
$outputDir = 'public/ai/score-rate-v5-smoke-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
if (Test-Path -LiteralPath $outputDir) { throw "output directory already exists: $outputDir" }
npm run train -- --generations 1 --workers 8 --output-dir $outputDir
```

Tell the user to return the complete console output plus the generated checkpoint/log for analysis. Explicitly list that train, bench, paired, publication, push, and browser runtime acceptance were not run by the assistant.
