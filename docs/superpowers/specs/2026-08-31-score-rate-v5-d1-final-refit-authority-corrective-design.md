# D1 v2 Final-Refit Authority Corrective Design

## Status and Scope

This design is the narrow successor to the 2026-08-31 Task 5 breaker in the D1 variable-cardinality code gate. It corrects one load-bearing capability regression only: the authenticated `freezeD1FinalModels` API currently accepts caller-supplied `fitRepresentation` and can mint an authoritative final bundle from a non-canonical fitter.

The correction may modify only:

- `training/d1ActionConditionedHeldOutListwiseFit.ts`
- `training/d1ActionConditionedHeldOutListwiseFit.test.ts`
- `training/d1ActionConditionedHeldOutListwiseLabels.test.ts`
- the exact SDD and controller-only continuity records enumerated below

It does not authorize D1 v1/v2 execution, parent gates, training, calibration, benchmark, publication, artifact/weight/lock mutation, staging, commit, branch/worktree, push, or runtime acceptance. Those remain downstream gates.

## Root Cause

The final-fix wave needed behavioral evidence that an exception during the second representation's final refit makes the run permanently non-retryable. It placed an optional general-purpose fitter dependency on the exported authenticated API:

```ts
freezeD1FinalModels({ selections, train, validation, fitRepresentation? })
```

That seam reaches the capability-minting path. A caller that holds authentic selections and train/validation batches can supply any same-signature fitter and receive an authenticated final bundle. Exact-once state transition behavior improved, but the final model's authority no longer proves use of the frozen canonical fitter. The defect is therefore at the dependency-injection boundary, not in the `unconsumed -> in-flight -> materialized|failed` state machine.

## Considered Approaches

### A. Private dependency plus failure-only non-authoritative probe — selected

Keep any injectable fitter only inside a module-private helper. Restore the exported authenticated API to the exact three inputs `selections`, `train`, and `validation`; its only fitter is `fitD1Representation`. Export one narrowly named test probe that reuses the same authentication and transition helper but is hardwired to fail before the second representation can complete. The probe never returns or registers a model bundle, final-bundle capability, or test attestation.

This preserves behavioral evidence for terminal failure while removing power amplification from the authoritative API.

### B. Test only the structural refit seam — rejected

`freezeD1FinalModelsStructural` already has no operational authority and may retain an injectable fitter for pure structural tests. Testing only that function cannot prove the authenticated run WeakMap becomes `failed` before a retry, so it does not cover the blocker.

### C. Mock the canonical fitter through Vitest/ESM — rejected

The authenticated wrapper and fitter live in the same module and use lexical bindings. Module mocking would be brittle, tool-dependent, and would test mocking mechanics instead of the frozen capability boundary.

## Frozen Interfaces and Authority

The production interface is exactly:

```ts
export function freezeD1FinalModels(input: {
  readonly selections: Readonly<Record<D1RepresentationId, D1ValidationSelection>>;
  readonly train: D1AuthenticatedLabeledBatch;
  readonly validation: D1AuthenticatedLabeledBatch;
}): D1FinalModelBundle;
```

It has no fitter, hook, callback, mode, flag, or test dependency. After authenticating the two selections and same-run train/validation capabilities, it moves the run to `in-flight`, calls the fixed `fitD1Representation` once for `afterstate13` and once for `action24` in that order, then either:

- returns both completed canonical refits to the production wrapper, which is the only code allowed to register exactly one authoritative final bundle and then move the run to `materialized`; or
- registers no authoritative bundle and moves irreversibly to `failed` before rethrowing.

The shared private transaction helper may receive the private fitter used by the production wrapper or failure probe, but it may neither access nor receive `finalBundleCapabilities`, a registration function, or any mint callback. It authenticates inputs, owns the `in-flight -> failed` transition around the two ordered refits, and returns a structural bundle only after both calls succeed. The sole `finalBundleCapabilities.set(...)` statement remains in `freezeD1FinalModels`, after the helper returns from two canonical `fitD1Representation` calls; only that wrapper then changes the freeze state from `in-flight` to `materialized`. No helper or probe can register authoritative capability.

JavaScript callers may pass an object variable that contains extra runtime properties, but no such property may influence production fitting. In particular, a runtime `fitRepresentation`, `fitter`, `fit`, `callback`, or equivalent extra key is ignored because the production wrapper has no dependency lookup or forwarding path.

The existing exported structural function may retain `fitRepresentation?` because its bundle is accepted only by the structural capability registry and is rejected by every authenticated operational crossing. No structural result may enter `consumeD1FinalBundleForTest`, Labels test materialization, authenticated held-out evaluation, replay, or canonical evidence.

## Failure-Only Test Probe

The Fit module may export exactly one test seam:

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

The probe uses the same private authentication and state-transition helper as production. Its private fitter wrapper records each attempted representation. On the first `afterstate13` call, before delegating to the real canonical fitter, it invokes the same private existing-state guard against the authenticated run identity. The guard must throw exactly `final model freeze already in flight`; the wrapper records that exact literal and proceeds only after observing it. If the transaction writes `in-flight` after invoking the first fitter, the guard does not throw and the probe itself fails, so the permanent test detects the ordering mutation. On `action24`, the wrapper throws one fixed internal sentinel. The probe catches only that exact sentinel after the shared helper has moved the run to `failed`, returns the recursively frozen object containing `attemptedRepresentations=['afterstate13','action24']` and the exact `firstRefitReentryError`, and never returns the first model.

The probe is failure-only by construction:

- callers cannot provide a function, error, phase, representation, flag, or model;
- the second refit can never complete through this entry point;
- the first refit cannot start until the same-run state guard has observed and thrown `final model freeze already in flight`;
- no final bundle is registered before either refit, and registration remains after both successful canonical refits only;
- no model, normalization, weights, selection, run identity, attestation, or partial evidence is returned;
- a later call to production `freezeD1FinalModels` for the same run must fail with exactly `final model run already failed`;
- copied, foreign, cross-run, or otherwise unauthentic inputs fail before state consumption exactly as the production path does.

The name and return type make the non-production purpose explicit. It is a diagnostic test seam, not an alternate final-refit API.

## Error and State Semantics

Authentication and selection validation occur before changing a fresh run state. After validation succeeds, the shared helper writes `in-flight` before invoking the first fitter. Any exception from the fixed production fitter or the hardwired probe sentinel writes `failed` before control returns to the caller. A failed run cannot transition back to `unconsumed` and cannot mint a final bundle on a later call.

Existing-state rejection is stable and distinguishable. After authenticating train/validation and rejecting a cross-run pair with `final model run mismatch`, an already-known same-run state must throw exactly:

- `in-flight` -> `final model freeze already in flight`;
- `materialized` -> `final model run already materialized`;
- `failed` -> `final model run already failed`.

These are externally observable state-machine outcomes, not aliases for one generic duplicate message. The failure probe acceptance test must assert the failed-specific outcome, so an implementation that records `materialized`, leaves `in-flight`, or merely adds the run to an undifferentiated set cannot pass.

The probe catches only its own unexported sentinel by object identity. An unexpected canonical fitter error propagates after the run is marked failed; it cannot be mistaken for the expected test probe event.

## TDD and Acceptance

The first permanent behavioral RED is the current public trust-boundary regression. A test passes an object variable containing an extra `fitRepresentation` spy to the existing exported `freezeD1FinalModels`, then asserts that the spy was never called and that the returned bundle is authenticated. Current bytes reach and call the spy, so the assertion fails at the real trust boundary. Missing probe exports, import/setup errors, source-text grep, `as any`, ignore directives, or a mock of the function under test do not count as this behavioral RED.

The compile contract separately proves both directions of the public type boundary: `Parameters<typeof freezeD1FinalModels>` is a tuple of length exactly one, and `keyof Parameters<typeof freezeD1FinalModels>[0]` is mutually assignable with exactly `selections | train | validation`. Checking only the old `fitRepresentation` name is insufficient because a renamed or second dependency parameter would otherwise escape the gate.

Minimum GREEN acceptance:

1. `freezeD1FinalModels` has exactly one parameter, its input key set is exactly the three frozen properties, and no runtime extra property can supply or influence its fitter.
2. The failure-only probe returns a recursively frozen result with trace `['afterstate13','action24']` and exact first-refit reentry outcome `final model freeze already in flight` after using the real first canonical refit.
3. The same authentic run then rejects production freeze with exactly `final model run already failed` and has no accepted final bundle.
4. Normal authenticated final freeze still produces one valid bundle accepted by `consumeD1FinalBundleForTest`.
5. A real bundle produced by `freezeD1FinalModelsStructural` with an injected fitter remains structural-only and is separately rejected by `assertD1FinalModelBundle`, `consumeD1FinalBundleForTest`, and Labels `consumeD1TestLabelCapability`; the rejected Labels crossing does not consume the authentic context run.
6. Focused Labels+Fit tests, exact three-file ESLint/baseline/index checks, and unchanged safe 79-root typecheck pass before independent scoped review.

## Exact Record Write Boundary

The corrective task may create or update only these workspace records under `D:\WorkSpace\Tetris\.superpowers\sdd\2026-08-31-score-rate-v5-d1-final-refit-authority-corrective`:

- `progress.md`
- `task-1-brief.md`
- `task-1-report.md`
- `task-1-review.diff`
- `task-1-review.md`
- `task-1-baseline\d1ActionConditionedHeldOutListwiseFit.ts`
- `task-1-baseline\d1ActionConditionedHeldOutListwiseFit.test.ts`
- `task-1-baseline\d1ActionConditionedHeldOutListwiseLabels.test.ts`

No other SDD path is writable in this corrective task. Implementers and reviewers do not write continuity. Only the controller may invoke the installed Windows PowerShell 5.1 continuity helper for TaskId `v5-postmortem`, with the existing protected excludes file, thereby updating only `C:\Users\Administrator\.codex\continuity\workspaces\971086e837942ad7\v5-postmortem.md`, `C:\Users\Administrator\.codex\continuity\workspaces\971086e837942ad7\v5-postmortem.state.json`, and `C:\Users\Administrator\.codex\continuity\workspaces\971086e837942ad7\active.json`. No helper, excludes file, or other continuity artifact may be modified directly.

## Downstream Gate

A clean corrective task review reopens Task 5 only. The controller must then rerun the exact parent 18-file safe suite, exact 14-file ESLint, production build, unchanged safe 79-root typecheck, exact diff/index/invariant/artifact gates, and independent whole-change review. Only clean gates plus Windows PowerShell 5.1 continuity `Checkpoint -> Resume=match` permit the already-authorized exactly-once D1 v2 operational run.
