# D1 v2 Final-Refit Authority Corrective Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove caller-controlled fitting from the authenticated final-model capability path while retaining a failure-only, non-authoritative test seam for terminal exact-once evidence.

**Architecture:** Keep `freezeD1FinalModelsStructural` as the non-operational mathematical seam. Route the authenticated production API and a hardwired failure-only test probe through one private authentication/state-transition helper; only the production path can complete two canonical refits and register an authoritative bundle.

**Tech Stack:** TypeScript, Vitest, existing D1 WeakMap capability registries, existing deterministic fitter, ESLint, safe explicit-root TypeScript.

## Global Constraints

- Current workspace only; no branch/worktree, stage, commit, stash, reset, restore, checkout, clean, or broad add.
- Preserve all unrelated A+/B1/C0/D1 WIP, overlapping `package.json`, active v5 contracts, run artifacts, weights, and locks.
- Never read, execute, hash, modify, move, delete, test, typecheck, review, diff, stage, or commit the three protected `training/searchProbe*` paths. Ordinary `git status` may show their names only.
- Modify only `training/d1ActionConditionedHeldOutListwiseFit.ts`, `training/d1ActionConditionedHeldOutListwiseFit.test.ts`, and `training/d1ActionConditionedHeldOutListwiseLabels.test.ts`, plus the exact SDD records enumerated below. Continuity is controller-only.
- Do not alter solver constants, normalization, lambda selection, model shapes, capability registries, test crossing, result serialization, thresholds, D1 protocol ID, active score-rate-v5/schema 6/13-feature/v2 search contracts, or any artifact.
- `freezeD1FinalModels` must accept only authentic `selections`, `train`, and `validation`; it has no caller-supplied fitter, hook, callback, mode, flag, or dependency.
- The test probe is failure-only and can never register or return a model/final-bundle/test capability.
- This plan performs only the narrow corrective task and its focused review. Parent 18-file gates and operational D1 v2 remain controller-owned downstream gates.

## File Responsibility Map

| File | Responsibility |
| --- | --- |
| `training/d1ActionConditionedHeldOutListwiseFit.ts` | exact production API, private authenticated transaction helper, hardwired failure-only test probe |
| `training/d1ActionConditionedHeldOutListwiseFit.test.ts` | exact public parameter/key type contract and structural-bundle rejection at Fit-owned authenticated crossings |
| `training/d1ActionConditionedHeldOutListwiseLabels.test.ts` | runtime trust-boundary RED, replacement terminal-failure test, normal success, and Labels crossing rejection |
| `.superpowers/sdd/2026-08-31-score-rate-v5-d1-final-refit-authority-corrective/progress.md` | corrective-task ledger |
| `.superpowers/sdd/2026-08-31-score-rate-v5-d1-final-refit-authority-corrective/task-1-brief.md` | exact implementer brief |
| `.superpowers/sdd/2026-08-31-score-rate-v5-d1-final-refit-authority-corrective/task-1-report.md` | RED/GREEN and gate evidence |
| `.superpowers/sdd/2026-08-31-score-rate-v5-d1-final-refit-authority-corrective/task-1-review.diff` | exact three-file baseline review package |
| `.superpowers/sdd/2026-08-31-score-rate-v5-d1-final-refit-authority-corrective/task-1-review.md` | independent verdict and findings |
| `.superpowers/sdd/2026-08-31-score-rate-v5-d1-final-refit-authority-corrective/task-1-baseline/d1ActionConditionedHeldOutListwiseFit.ts` | immutable source baseline |
| `.superpowers/sdd/2026-08-31-score-rate-v5-d1-final-refit-authority-corrective/task-1-baseline/d1ActionConditionedHeldOutListwiseFit.test.ts` | immutable Fit-test baseline |
| `.superpowers/sdd/2026-08-31-score-rate-v5-d1-final-refit-authority-corrective/task-1-baseline/d1ActionConditionedHeldOutListwiseLabels.test.ts` | immutable Labels-test baseline |

No other SDD path is writable. Implementers and reviewers must not write continuity. Only the controller may use the installed Windows PowerShell 5.1 helper for TaskId `v5-postmortem` with `C:\Users\Administrator\.codex\continuity\protected-probes-v5-postmortem.exclude`; it may update only the existing `C:\Users\Administrator\.codex\continuity\workspaces\971086e837942ad7\v5-postmortem.md`, `v5-postmortem.state.json`, and `active.json` records. Direct helper/excludes/continuity edits are forbidden.

---

### Task 1: Restore canonical authenticated final refit authority

**Files:**
- Modify: `training/d1ActionConditionedHeldOutListwiseFit.ts`
- Test: `training/d1ActionConditionedHeldOutListwiseFit.test.ts`
- Test: `training/d1ActionConditionedHeldOutListwiseLabels.test.ts`

**Interfaces:**
- Consumes: authentic validation selections and same-run `D1AuthenticatedLabeledBatch` train/validation capabilities.
- Produces: exact three-property `freezeD1FinalModels` and failure-only `exerciseD1FinalRefitFailureForTest`.

- [ ] **Step 1: Snapshot the exact three owned files and write the real trust-boundary RED**

Create only the exact SDD directory/files listed in the responsibility map and copy the exact three current files into `task-1-baseline`. `d1ActionConditionedHeldOutListwiseFit.test.ts` currently aliases the structural assertion to the authenticated-looking name `assertD1FinalModelBundle`. Replace that import with the explicit structural name `assertD1StructuralFinalModelBundle` and update every existing structural assertion call in this test to the explicit name. Separately import production `assertD1FinalModelBundle` as `assertD1FinalModelBundleAuthenticated`. Preserve the existing structural freeze alias and additionally import the production freeze function as `freezeD1FinalModelsAuthenticated`. Add a compile-time contract against the production freeze alias that proves the parameter tuple length and key set in both directions:

```ts
type FreezeParameters = Parameters<typeof freezeD1FinalModelsAuthenticated>;
type ExactParameterCount = FreezeParameters['length'] extends 1
  ? 1 extends FreezeParameters['length'] ? true : false
  : false;
type ProductionInputKeys = keyof FreezeParameters[0];
type ExpectedInputKeys = 'selections' | 'train' | 'validation';
type ExactInputKeys = [ProductionInputKeys] extends [ExpectedInputKeys]
  ? [ExpectedInputKeys] extends [ProductionInputKeys] ? true : false
  : false;
const exactParameterCount: ExactParameterCount = true;
const exactInputKeys: ExactInputKeys = true;
void exactParameterCount;
void exactInputKeys;
```

In `d1ActionConditionedHeldOutListwiseLabels.test.ts`, add the first permanent behavioral test without importing any missing probe. Build an authentic fresh run and selections, create an object variable with the three frozen inputs plus a `fitRepresentation` spy that delegates to `fitD1Representation`, pass that variable to the current production API, and assert the spy was never called. Also assert the returned bundle is accepted by `consumeD1FinalBundleForTest` for the matching run identity. Do not use a direct excess-property literal, `as any`, an ignore directive, source-text inspection, or a mock of `freezeD1FinalModels`.

- [ ] **Step 2: Run the focused RED and verify the expected failure**

Run:

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwiseLabels.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false -t "keeps the authenticated final fitter fixed while failure evidence remains terminal"
```

Expected behavioral RED: the selector reaches the real fitter spy and fails only because it was called by `freezeD1FinalModels`. An import/setup/type-transform failure is not acceptable evidence.

Run the unchanged safe explicit-root typecheck:

```powershell
npx tsc -p .superpowers/sdd/2026-08-25-score-rate-v5-action-conditioned-held-out-listwise/safe-train-tsconfig.json --pretty false
```

Expected compile RED: `true` is not assignable to `false` for `ExactInputKeys` while the fourth input key remains public. The exact parameter-count assertion should already pass. Confirm the config still has 79 roots and zero protected/B1/loadWeights roots before invoking it.

- [ ] **Step 3: Replace the old injected-failure test and add permanent crossing acceptance**

Only after the Step 2 behavioral RED has been captured, replace—not supplement—the existing test `makes a failed second-representation final refit terminal before the first fitter can repeat`. Import the planned `exerciseD1FinalRefitFailureForTest`; require its recursively frozen result to contain `attemptedRepresentations=['afterstate13','action24']` and `firstRefitReentryError='final model freeze already in flight'`; then require the same run's production retry to throw exactly `final model run already failed`. Add a separate normal authenticated run accepted by `consumeD1FinalBundleForTest`.

In `d1ActionConditionedHeldOutListwiseFit.test.ts`, use the existing structural fixtures and structural freeze alias to build a bundle with an injected fitter spy; require the spy to be called, confirm it remains accepted by `assertD1StructuralFinalModelBundle`, then prove rejection by the distinct imported names `assertD1FinalModelBundleAuthenticated` and `consumeD1FinalBundleForTest`. Do not reintroduce a local `assertD1FinalModelBundle` name. In `d1ActionConditionedHeldOutListwiseLabels.test.ts`, build an equivalent structural injected-fitter bundle from the authenticated run's public subset projections, then prove rejection by Labels `consumeD1TestLabelCapability`. Together the exact three authenticated rejections are:

1. `assertD1FinalModelBundle`;
2. `consumeD1FinalBundleForTest`;
3. Labels `consumeD1TestLabelCapability`.

After the third rejection, use a canonical authenticated bundle with the same authentic context to prove the failed structural crossing did not consume Labels run state. Adding the not-yet-existing probe import may now produce a compile/scaffold RED; record it as such, never as the qualifying behavioral trust-boundary RED.

- [ ] **Step 4: Implement one private transaction helper and the production wrapper**

In `d1ActionConditionedHeldOutListwiseFit.ts`, extract the existing same-run authority/selection validation and ordered refit transaction into one non-exported helper. Its private input may include a fitter dependency, but it must not access or receive `finalBundleCapabilities`, a registration function, or a mint callback. Preserve the exact fit order `afterstate13`, then `action24`; set `in-flight` before the first call; set `failed` before propagating any refit error; and return a structural bundle only when both calls complete.

The normal exported function must have exactly:

```ts
export function freezeD1FinalModels(input: {
  readonly selections: Readonly<Record<D1RepresentationId, D1ValidationSelection>>;
  readonly train: D1AuthenticatedLabeledBatch;
  readonly validation: D1AuthenticatedLabeledBatch;
}): D1FinalModelBundle;
```

It calls the private helper with canonical `fitD1Representation` only. The sole `finalBundleCapabilities.set(...)` statement remains in this production wrapper after both canonical refits complete; the wrapper then changes the run state to `materialized` and returns. No failed path or helper registers authoritative capability.

Replace the generic duplicate check with exact same-run state errors: `final model freeze already in flight`, `final model run already materialized`, and `final model run already failed`; preserve exact cross-run `final model run mismatch`. Runtime extra properties are ignored and are never inspected or forwarded.

- [ ] **Step 5: Implement the hardwired failure-only probe**

Add exactly:

```ts
export function exerciseD1FinalRefitFailureForTest(input: {
  readonly selections: Readonly<Record<D1RepresentationId, D1ValidationSelection>>;
  readonly train: D1AuthenticatedLabeledBatch;
  readonly validation: D1AuthenticatedLabeledBatch;
}): Readonly<{
  readonly attemptedRepresentations: readonly D1RepresentationId[];
  readonly firstRefitReentryError: 'final model freeze already in flight';
}>;
```

Use an unexported sentinel object, a local `attempted: D1RepresentationId[]`, and the authenticated run identity obtained during the shared validation. The private fitter wrapper appends the representation ID. On `afterstate13`, call the same private existing-state guard for that run, catch only the exact `D1RuntimeError('final model freeze already in flight')`, record that exact literal, and only then delegate to `fitD1Representation`. If the guard returns or throws anything else, propagate a failure. On `action24`, throw the sentinel. Catch only that sentinel after the shared transaction has recorded `failed`; return a recursively frozen object containing the attempted trace and exact reentry literal. Propagate any other error. The probe must contain no branch that can complete the second fitter and no call that registers `finalBundleCapabilities`.

- [ ] **Step 6: Run focused GREEN and mutation checks**

Run the selector from Step 2. Expected: one passing named test. Then run:

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwiseLabels.test.ts training/d1ActionConditionedHeldOutListwiseFit.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: both files pass. Also run the exact Fit-test selector covering structural injected-bundle rejection. Verify permanent tests fail for these mutations: add or rename any second public dependency; consult a runtime extra dependency key; move `in-flight` after the first fit so the first-refit guard cannot report the exact in-flight error; let the probe finish action24; register a bundle outside the production wrapper or before both canonical fits; report `materialized`/generic duplicate after probe failure; restore a failed run to `unconsumed`; collapse the explicit structural/authenticated assertion aliases; or allow any of the three structural-to-authenticated crossings.

- [ ] **Step 7: Run exact focused static gates**

Run exact three-file ESLint, the unchanged safe 79-root typecheck after root assertions, and exact three task-baseline `git diff --no-index --check` checks with zero diagnostics. Use only ordinary `git status --short --branch` to prove no staged entry; do not inspect protected content through an index diff. Do not run build or the parent 18-file suite in this task.

- [ ] **Step 8: Write the task report and request independent review**

The report must include exact RED/GREEN commands, outputs/counts, changed files, proof that production has one exact parameter/key set and no dependency path, proof that the probe never mints authority, three structural crossing rejections, failed-specific state evidence, and all static gate results. Dispatch a fresh read-only reviewer over this design, plan, report, and exact three-file baseline diff. Require spec-compliance PASS, code-quality APPROVED, and Critical/Important 0 before closing the task. Any fix requires focused TDD plus scoped re-review. Write the verdict to the exact `task-1-review.md` path; no reviewer may write code, SDD beyond that review file, or continuity.

## Downstream Controller Gate

After Task 1 review is clean, return control without running D1. The controller must run, in order:

1. fresh Git/index/process/lock/artifact/hash pre-flight;
2. exact parent 18-file safe Vitest suite;
3. exact 14-file ESLint;
4. `npm run build`;
5. unchanged safe 79-root typecheck;
6. exact diff/index, active-v5 invariant and artifact/hash checks;
7. fresh independent whole-change spec and quality review;
8. Windows PowerShell 5.1 continuity `Checkpoint -> Resume=match`;
9. exactly one D1 v2 operational run with new non-existing stdout/stderr evidence paths, independent digest validation and read-only adjudication;
10. terminal post-flight and stop regardless of PASS/FAIL/invalid/runtime.

## Self-Review

- [x] Root cause and trust boundary are explicit.
- [x] Production and test interfaces are exact and non-overlapping.
- [x] The test probe cannot mint a bundle or accept caller-controlled behavior.
- [x] TDD begins with a runtime RED that reaches the current injected fitter before any missing-probe scaffold failure.
- [x] Exact one-parameter/three-key typing and all three structural authenticated crossings are permanent acceptance.
- [x] Parent gates and operational D1 remain outside the corrective implementer's authority.
- [x] Protected paths and all artifacts/weights/locks remain outside access and mutation boundaries.
