# C0 Pinned-Snapshot Run Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the C0 ABA provenance gap by making both normal resume validation and the C0 adapter consume one shared immutable run-artifact snapshot validator.

**Architecture:** `training/runArtifacts.ts` owns one pure validator over checkpoint/log/candidate bytes. Its existing path API becomes a stable-read wrapper, while the C0 default adapter passes descriptor-pinned bytes directly into the same validator and continues extracting from those pinned bytes.

**Tech Stack:** TypeScript 5.6, Node.js filesystem descriptors and `Buffer`/`Uint8Array`, Vitest 3, ESLint 9, existing score-rate-v5 run-artifact validators.

## Global Constraints

- Work directly in `D:\WorkSpace\Tetris`; do not create a branch or worktree.
- Do not stage or commit. HEAD must remain `dd9b1e795fa35a97087ce2be6d94c8021abc1013` and the real index must remain empty.
- Preserve all A+/B1/B1.1/B1.2 WIP and the overlapping `package.json`; do not use broad add, stash, reset, restore, checkout, or clean.
- Do not read, execute, hash, modify, move, delete, test, typecheck, review, stage, or commit `training/searchProbe.ts`, `training/searchProbeWorker.ts`, or `training/searchProbe.test.ts`. Only ordinary `git status` may show those path names.
- Preserve `score-rate-v5`, schema 6, exact 13-entry `FEATURE_NAMES` order, `bag-expectimax-hold-v2`, depth 4, beams 64/32, `maxWorkUnits=3584`, `budget-corpus-v1`, caches 65536/16384, and exact `meanScore / scheduled maxPieces` fitness.
- Preserve standard Hold, exact public seven-bag state, SRS, survival-first ordering, deterministic tie-breaks, and board-row immutability.
- Do not modify `public/ai/score-rate-v5-smoke-20260820-200634`, either published weight file, any run artifact, repository/TEMP lock, active v5 feature/search/CEM/train/schema contract, or the existing C0 package script.
- Do not run the real C0 audit, any B1 diagnostic, calibration, training/resume/restart, bench/paired benchmark, publication, push, or browser/runtime acceptance during Tasks 1–3.
- Use focused tests first. Do not run bare `npm test`, bare repository lint, or bare `npm run typecheck:train`.
- This approved pinned-snapshot successor scope overrides only the original C0 design/plan restriction against modifying `training/runArtifacts.ts` and its test. Every other original C0 freeze and operational boundary remains binding.

---

### Task 1: Extract one strict immutable run-artifact snapshot validator

**Files:**
- Modify: `training/runArtifacts.ts`
- Modify: `training/runArtifacts.test.ts`

**Interfaces:**
- Consumes: existing checkpoint parser, log replay validators, candidate parser, `readRegularArtifact`, and `RunPaths`.
- Produces:

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

- [ ] **Step 1: Write the pure-snapshot RED tests**

Add literal fixture helpers that create `Uint8Array` values from the existing `CHECKPOINT`, generation/reevaluation records, and candidate fixture. Test an absent-candidate run and a qualified-candidate run through `validateCompatibleRunArtifactSnapshot` without writing files:

```ts
const bytes = (text: string) => Buffer.from(text, 'utf8');
const snapshot = (
  checkpoint: unknown,
  records: readonly unknown[],
  candidate: unknown | null,
): CompatibleRunArtifactSnapshot => ({
  checkpointBytes: bytes(JSON.stringify(checkpoint)),
  logBytes: bytes(`${records.map((record) => JSON.stringify(record)).join('\n')}\n`),
  candidateBytes: candidate === null ? null : bytes(JSON.stringify(candidate)),
});
```

Assert the accepted results match the current path wrapper. Add rejected cases for a truncated log, forbidden candidate bytes, required candidate absence, and mismatched candidate bytes. Supply literal diagnostic labels and assert representative validation failures include the selected label.

- [ ] **Step 2: Run the focused test and observe RED**

```powershell
npx vitest run training/runArtifacts.test.ts -t "snapshot" --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: FAIL because `validateCompatibleRunArtifactSnapshot` and its type do not exist.

- [ ] **Step 3: Extract the minimum shared validation core**

Move the body that currently starts after checkpoint/log reads in `readCompatibleRunArtifacts` into the new synchronous pure validator. Decode private byte copies once, parse the checkpoint with the same internal parser, replay the log with the existing validators, and parse candidate bytes only when non-null. Keep every existing schedule, optimizer, reevaluation, baseline, qualified-candidate, and candidate-presence check unchanged.

`readCompatibleRunArtifacts(paths)` must become only:

```ts
return validateCompatibleRunArtifactSnapshot({
  checkpointBytes: readRegularArtifactBytes(paths.checkpoint, 'checkpoint'),
  logBytes: readRegularArtifactBytes(paths.log, 'training log'),
  candidateBytes: pathEntryExists(paths.candidate)
    ? readRegularArtifactBytes(paths.candidate, 'candidate weights')
    : null,
  labels: {
    checkpoint: paths.checkpoint,
    log: paths.log,
    candidate: paths.candidate,
  },
});
```

The exact helper name may follow current naming, but the wrapper must perform no replay validation and each present path must be read only once for this call.

- [ ] **Step 4: Add snapshot ownership and wrapper-parity tests**

Capture a valid snapshot, replace the originating temp files, then validate the captured snapshot and assert the result still matches its original bytes. Separately assert path-wrapper and snapshot-validator equality for accepted fixtures and matching rejection categories for invalid fixtures. Add representative path-bearing message parity checks for empty/truncated log and candidate mismatch/requirement failures. Retain the existing symbolic-link/reparse path test to prove rejection occurs before delegation.

- [ ] **Step 5: Run Task 1 GREEN**

```powershell
npx vitest run training/runArtifacts.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: all `training/runArtifacts.test.ts` tests PASS with no warning or file leak outside its existing temporary directories.

- [ ] **Step 6: Self-review and write the task report**

Confirm there is one replay-validation implementation, the validator has no path/fs/process dependency, byte inputs are privately owned before parsing, error redaction has not weakened, and the path wrapper preserves candidate/symlink behavior. Do not stage or commit.

- [ ] **Step 7: Independent Task 1 review and fix loop**

The reviewer must return both verdicts: `spec compliance: PASS|FAIL` and `code quality: APPROVED|NEEDS FIXES`. Every Critical/Important finding enters a focused RED -> minimum GREEN fix -> scoped independent re-review loop before Task 2.

---

### Task 2: Bind C0 descriptor-pinned bytes to the shared validator

**Files:**
- Modify: `training/archivedRepresentativeAudit.ts`
- Modify: `training/archivedRepresentativeAudit.test.ts`

**Interfaces:**
- Consumes: `CompatibleRunArtifactSnapshot`, `validateCompatibleRunArtifactSnapshot`, current `StableRead`, `readPinned`, and C0 redacted invalid-input mapping.
- Produces: a default C0 source adapter whose strict validator and record extraction consume the same pinned checkpoint/log generation.

- [ ] **Step 1: Write the focused ABA-boundary RED**

Add a deterministic component-boundary test that fails if default C0 strict validation calls `readCompatibleRunArtifacts(paths)` or otherwise reopens checkpoint/log paths. The test must observe that the exact pinned checkpoint/log byte objects supplied to the shared validator are the bytes later used for C0 extraction. Use an injected module/dependency seam only at the shared-validator boundary; do not add a second production validator or assert on source text.

Add both candidate branches:

- candidate absent: the shared validator receives `candidateBytes: null`;
- candidate present: descriptor-stable non-null candidate bytes reach the shared validator and the archived checkpoint (`bestQualifiedCandidate === null`) fails closed rather than silently forcing `null`.

Retain a drift case proving a later changed stable read maps to `C0 invalid-input:source-identity-drift`.

- [ ] **Step 2: Run the focused test and observe RED**

```powershell
npx vitest run training/archivedRepresentativeAudit.test.ts -t "pinned snapshot|ABA|candidate absence|candidate present" --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: at least the path-reopen regression FAILS because the current adapter calls `readCompatibleRunArtifacts(paths)`.

- [ ] **Step 3: Make the default adapter consume the pinned snapshot**

Replace the path-validator import with the shared snapshot validator. `validateRun(paths)` must synchronously obtain the already pinned checkpoint/log buffers plus an explicit optional candidate buffer and call:

```ts
validateCompatibleRunArtifactSnapshot({
  checkpointBytes,
  logBytes,
  candidateBytes,
});
```

Keep candidate presence/absence fail-closed through a stable optional read: absence maps only to `null`, while a present regular file contributes its exact non-null pinned bytes. Keep later checkpoint/log hash and extraction reads bound to the same cached `StableRead`. Remove the checkpoint JSON projection comparison that existed only to compensate for path reopening. Do not change `C0SourceDependencies`, frozen constants, vector extraction, seed construction, thresholds, task/replay order, output, pool lifecycle, or package script unless the minimal tested boundary requires a type-only addition.

- [ ] **Step 4: Run Task 2 focused GREEN and shared parity**

```powershell
npx vitest run training/archivedRepresentativeAudit.test.ts training/runArtifacts.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Expected: both files PASS; no real WorkerPool, simulation, audit command, repository artifact, or published weight is touched.

- [ ] **Step 5: Run explicit changed-file lint/type evidence**

```powershell
npx eslint training/runArtifacts.ts training/runArtifacts.test.ts training/archivedRepresentativeAudit.ts training/archivedRepresentativeAudit.test.ts
```

Expected: exit 0 with no warning/error.

- [ ] **Step 6: Self-review and write the task report**

Trace the actual default data flow from descriptor read to shared validator to C0 extraction. Confirm no path is available inside strict snapshot validation, later drift remains fail-closed, no temporary artifact exists, and no frozen C0 or active-v5 contract changed. Do not stage or commit.

- [ ] **Step 7: Independent Task 2 review and fix loop**

The reviewer must independently return `spec compliance` and `code quality` verdicts and explicitly adjudicate the former ABA scenario. Every Critical/Important finding requires focused RED, minimum GREEN, and scoped independent re-review before Task 3.

---

### Task 3: Re-run the complete safe C0 code gate and independent closeout

**Files:**
- Review only: this design, this plan, the original C0 design/plan, `training/runArtifacts.ts`, `training/runArtifacts.test.ts`, `training/archivedRepresentativeAudit.ts`, `training/archivedRepresentativeAudit.test.ts`, and the exact existing C0 `package.json` hunk.
- Scratch only: `.superpowers/sdd/2026-08-24-score-rate-v5-c0-pinned-snapshot-validation/`.

**Interfaces:**
- Consumes: clean Task 1 and Task 2 reviews.
- Produces: fresh code-gate evidence and whole-change verdicts; never an operational audit result.

- [ ] **Step 1: Refresh continuity and live state**

Run Windows PowerShell 5.1 continuity `Resume` with the existing protected excludes file, then refresh HEAD/branch/ahead-behind, ordinary status, real index, Node command lines/CPU/memory, repository/index locks, preserved run entries/timestamps/hashes/contract, candidate/default absence, and both published hashes. Stop on unexplained drift, relevant process, lock, artifact/weight mutation, or non-empty index.

- [ ] **Step 2: Run the exact safe nine-file suite**

```powershell
npx vitest run training/archivedRepresentativeAudit.test.ts training/pool.test.ts training/runArtifacts.test.ts training/pairedStats.test.ts training/cem.test.ts src/ai/simulate.test.ts src/ai/rng.test.ts src/ai/weights.test.ts src/ai/lineClears.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Record file/test counts, failures/skips, exit code, and duration. Stop on failure.

- [ ] **Step 3: Run explicit four-file ESLint**

```powershell
npx eslint training/runArtifacts.ts training/runArtifacts.test.ts training/archivedRepresentativeAudit.ts training/archivedRepresentativeAudit.test.ts
```

- [ ] **Step 4: Run the production build**

```powershell
npm run build
```

Record exit code and Vite module count.

- [ ] **Step 5: Regenerate and run the protected-probe-excluded train typecheck**

Regenerate `.superpowers/sdd/2026-08-24-score-rate-v5-c0-pinned-snapshot-validation/safe-train-tsconfig.json` from tracked `.ts` roots returned by `git ls-files -- training src/ai src/engine src/types.ts src/constants.ts`, exclude `src/ai/loadWeights.ts`, and add only the two untracked C0 files. Assert none of the three protected probe path names appears, then run:

```powershell
npx tsc -p .superpowers/sdd/2026-08-24-score-rate-v5-c0-pinned-snapshot-validation/safe-train-tsconfig.json --pretty false
```

- [ ] **Step 6: Run exact diff/index/package checks**

```powershell
git diff --check -- package.json training/runArtifacts.ts training/runArtifacts.test.ts training/archivedRepresentativeAudit.ts training/archivedRepresentativeAudit.test.ts
git diff --cached --quiet --
```

Require both exit 0. Verify the real index is empty and `package.json` retains all prior WIP with exactly one unchanged `audit:c0-archived-representatives` entry.

- [ ] **Step 7: Independent Task 3 review**

The reviewer receives the verification report plus exact scoped diff and returns independent `spec compliance` and `code quality` verdicts. Critical/Important findings use the normal Task fix loop; no operational command may run.

- [ ] **Step 8: Independent whole-change spec and quality reviews**

Give fresh reviewers only the two designs, two plans, four changed owner files, exact package hunk, task reports, ledger, and fresh gate evidence. Spec review must prove immutable-snapshot ownership and every original C0 invariant. Quality review must inspect validation reuse, path-wrapper compatibility, descriptor lifecycle, optional candidate semantics, tests, redaction, and WIP preservation.

- [ ] **Step 9: Apply at most one final fix wave and one scoped re-review**

If whole-change reviews contain any Critical/Important findings, dispatch one fresh final fixer with the complete list. Each finding needs focused RED before minimum GREEN. Then run exactly one scoped independent re-review. Any residual load-bearing finding keeps the code gate blocked.

- [ ] **Step 10: Fresh closeout and continuity match**

Repeat the full live-state refresh, update the new SDD ledger and `v5-postmortem` Markdown, then run continuity `Checkpoint -> Resume` with Windows PowerShell 5.1 and the existing protected excludes file; require `match`. Report explicitly whether the real audit was not run.

Only when every Task review, whole-change review, safe gate, continuity check, and fresh operational pre-flight is clean may the controller run the single already-authorized command:

```powershell
npm run audit:c0-archived-representatives --silent
```

## Plan Self-Review Checklist

- [x] One shared strict validator consumes immutable snapshot bytes; no duplicate validator or temporary artifact exists.
- [x] The existing path API remains compatible and delegates after one stable read per present artifact.
- [x] C0 strict validation and extraction consume the same descriptor-pinned checkpoint/log generation.
- [x] Candidate presence/absence is explicit and strict.
- [x] The original C0 vectors, seeds, thresholds, schedule, output, and operational single-run contract are unchanged.
- [x] Safe commands exclude protected probes and preserve all unrelated WIP.
- [x] Implementation, code gate, operational audit, later design work, training, publication, commit, and runtime acceptance remain separate gates.
