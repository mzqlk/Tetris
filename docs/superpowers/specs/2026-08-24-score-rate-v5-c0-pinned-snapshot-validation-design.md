# C0 Pinned-Snapshot Run Validation Design

**Date:** 2026-08-24

**Status:** Approved correctness scope. The user authorized this design by continuing from the documented blocker recommendation: add one shared pure snapshot-validation boundary in `training/runArtifacts.ts`, bind C0 descriptor-pinned bytes to it, and preserve the path-based wrapper.

## Context and Root Cause

The C0 audit code gate is blocked before operational execution. The current C0 adapter pins checkpoint and log bytes, calls `readCompatibleRunArtifacts(paths)`, and then verifies that the paths again expose the pinned bytes. This detects ordinary drift, but the strict validator independently reopens both paths. A valid alternate log can therefore appear only during that validator call and be restored before the second pinned read. The strict validator and C0 extraction can consume different log generations while every before/after equality check passes.

The defect is an ownership boundary, not a missing hash or timestamp check. Strict validation must consume the exact immutable checkpoint/log snapshot that C0 hashes and extracts.

## Goals

- Extract the existing schema-6 checkpoint/log/candidate validation into one synchronous pure snapshot validator.
- Make the existing path-based `readCompatibleRunArtifacts(paths)` a compatibility wrapper that performs stable regular-file reads once and delegates to that validator.
- Make the default C0 adapter pass its descriptor-pinned checkpoint/log bytes and explicit candidate presence/absence directly to the same validator.
- Preserve current path rejection behavior for missing files, symbolic links, reparse points, identity drift, truncated JSONL, candidate requirements, and all replayed run invariants.
- Close the ABA mismatch without temporary files, retries, alternate validators, or artifact mutation.

## Non-Goals

- No change to `score-rate-v5`, schema 6, the 13-entry `FEATURE_NAMES` order, `bag-expectimax-hold-v2`, depth 4, beams 64/32, `maxWorkUnits=3584`, `budget-corpus-v1`, caches 65536/16384, or fitness.
- No change to C0 vectors, hashes, seeds, task order, replay indices, thresholds, verdict precedence, stdout/stderr contract, or result digest.
- No training, diagnostic, calibration, bench, paired benchmark, publication, push, browser/runtime acceptance, audit execution, artifact/weight mutation, lock deletion, staging, or commit.
- No read, execution, hash, test, typecheck, review, modification, movement, deletion, staging, or commit of the three protected `training/searchProbe*` paths.

## Considered Approaches

### A. Shared immutable snapshot validator — selected

Introduce `CompatibleRunArtifactSnapshot` and `validateCompatibleRunArtifactSnapshot(snapshot)` in `training/runArtifacts.ts`. The snapshot owns exact checkpoint/log bytes plus either exact candidate bytes or `null` for absence. All strict replay logic remains in this one function. Both the path wrapper and C0 call it.

This closes the mismatch structurally: the validator has no path to reopen. It also keeps all strict logic reusable and prevents divergence.

### B. Inject a file reader into the existing path validator — rejected

A reader callback would reduce direct filesystem calls, but the validator would still own I/O sequencing and could accidentally request different generations for checkpoint, log, extraction, or candidate checks. The ownership boundary would remain harder to audit.

### C. Copy pinned bytes to temporary artifacts — rejected

This could make the old path validator read stable copies, but it violates the C0 no-write contract, creates cleanup and identity questions, and would make correctness depend on a second artifact lifecycle.

## Architecture

### Shared validator

`training/runArtifacts.ts` exports:

```ts
export interface CompatibleRunArtifactSnapshot {
  readonly checkpointBytes: Uint8Array;
  readonly logBytes: Uint8Array;
  readonly candidateBytes: Uint8Array | null;
  readonly labels?: Readonly<{
    checkpoint: string;
    log: string;
    candidate: string;
  }>;
}

export function validateCompatibleRunArtifactSnapshot(
  snapshot: CompatibleRunArtifactSnapshot,
): ScoreRateCheckpoint;
```

The function synchronously takes private copies or immutable decoded strings before parsing. It performs the exact current checkpoint schema validation, continuous generation replay, reevaluation replay, optimizer-state equality, schedule reconstruction, published/qualified candidate equality, and candidate presence/content rules. `candidateBytes === null` is the sole representation of candidate absence. Optional labels are inert diagnostic data, not filesystem capabilities: the normal path wrapper supplies its current checkpoint/log/candidate path labels, while C0 may supply redacted generic labels because its public failure output never exposes paths.

There is one validation implementation. `readCompatibleCheckpoint(path)` may retain its public API, but checkpoint parsing is factored into the same internal parser used by the snapshot validator. `readCompatibleRunArtifacts(paths)` reads checkpoint, log, and optional candidate through the existing regular-file/identity protections and delegates; it contains no replay validation of its own.

### C0 binding

The default C0 source adapter retains descriptor-based stable reads and byte/hash pinning. Its `validateRun(paths)` obtains the already pinned checkpoint/log buffers, obtains an explicit optional candidate snapshot, and invokes `validateCompatibleRunArtifactSnapshot` directly. It must not call `readCompatibleRunArtifacts(paths)`.

The adapter continues to use the same pinned log bytes for C0 record extraction and the same pinned checkpoint bytes for source hashing. The path may change after the snapshot is acquired, but neither strict validation nor extraction can observe another generation. Any later observed signature/byte drift still fails closed as `source-identity-drift`.

## Data Flow

```text
descriptor-stable reads
  -> exact checkpoint/log/candidate snapshot
  -> shared strict snapshot validator
  -> validated ScoreRateCheckpoint
  -> C0 extraction from the same pinned log bytes
  -> frozen vector/source/schedule checks
  -> pool creation only after all provenance checks
```

The compatibility path is:

```text
readCompatibleRunArtifacts(paths)
  -> stable regular-file reads once
  -> exact snapshot
  -> same shared strict snapshot validator
```

## Failure and Side-Effect Contract

- Shared validation preserves current error categories and diagnostic context. The path wrapper passes exact path labels so existing path-bearing messages remain compatible; representative message parity is tested. C0 passes redacted generic labels and maps strict failures to its existing redacted `invalid-input:run-contract-mismatch` boundary.
- Missing or forbidden candidate state remains distinguishable through `candidateBytes === null` versus non-null bytes.
- The pure validator performs no filesystem, process, network, worker, timer, or module-level mutable-state operation.
- Neither wrapper writes, renames, copies, deletes, retries, or repairs an artifact.

## Test Strategy

1. Add pure snapshot tests that validate a complete absent-candidate run and a qualified-candidate run without filesystem access.
2. Observe RED when the pure API is missing, then prove malformed/truncated log and candidate presence/content rules are identical to the existing path wrapper.
3. Prove snapshot ownership: capture a valid snapshot, mutate or replace its source paths, and show validation remains a function only of captured bytes.
4. Prove path-wrapper parity for accepted and rejected fixtures, including symbolic-link/reparse rejection before snapshot construction.
5. Add focused C0 regressions that make any path-based strict-validation call fail and verify the default adapter supplies the pinned snapshot to the shared validator. Test both candidate absence (`null`) and candidate presence (descriptor-stable non-null bytes that fail closed against the archived checkpoint), and verify later path drift still fails closed.
6. Re-run the original nine-file C0 suite, explicit four-file ESLint, build, protected-probe-excluded train typecheck, exact-path diff check, real-index check, per-task reviews, and independent whole-change spec/quality reviews.

## Acceptance Gates

- The focused ABA regression is RED before production changes and GREEN afterward.
- A single shared strict validation implementation is used by both the path wrapper and C0; reviewers find no duplicate validator.
- The C0 default adapter cannot reopen checkpoint/log paths during strict validation.
- All safe code gates and independent reviews are clean, HEAD is unchanged, and the real index is empty.
- Fresh process/lock/artifact/weight evidence is unchanged before any operational action.
- Only after all prior gates pass may the already authorized one-shot C0 audit become technically eligible.
