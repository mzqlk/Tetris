# D1 Task 4 Corrective Evidence Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task with an independent review gate. This corrective plan is a new scope after the prior Task 4 breaker; it is not a sixth fix round of the blocked plan.

**Goal:** Close only the remaining Task 4 evidence defect by adding a BigInt-vs-Number distinguishing fraction fixture and independent RED/GREEN evidence for the already implemented canonical identity/fraction tests.

**Architecture:** Preserve the existing Task 4 production implementation and all previously addressed findings. Persist only the distinguishing BigInt fixture and any minimal test-only strengthening needed to exercise the existing production boundary. Produce exactly four fresh independent RED/GREEN pairs: concrete 12-placement identity/order, full 7,680-task canonical identity/order including the middle-swap guard, isolated fraction validation, and the BigInt boundary. The prior forged-stream and duplicate-subset RED/GREEN pairs remain inherited evidence: they are not separately mutated or focused-rerun and are not claimed as new evidence here, although the final whole-file regression suite necessarily executes those unchanged tests.

**Tech Stack:** TypeScript, Vitest, ESLint, PowerShell, existing D1 label module and exact focused test command.

## Global Constraints

- Work directly in `D:\WorkSpace\Tetris` on current `master`; do not create a branch or worktree.
- Tasks in this corrective plan must not stage or commit; keep the real index empty.
- The only persistent execution-time repository modification is `training/d1ActionConditionedHeldOutListwiseLabels.test.ts`. The plan-owned ledger, brief, report, review packages, `empty-baseline`, and `production-before.ts` are temporary scratch confined to `.superpowers/sdd/2026-08-25-score-rate-v5-d1-task4-corrective-evidence/`; retain them through independent review, then delete that exact plan workspace only after a clean review and continuity/parent-controller handback are durably recorded.
- `training/d1ActionConditionedHeldOutListwiseLabels.ts` is temporary-mutation-only: each named RED may change only the expression specified below, and that mutation must be restored in the same cycle before any other mutation or final verification. Before the first mutation, copy the production file to `.superpowers/sdd/2026-08-25-score-rate-v5-d1-task4-corrective-evidence/production-before.ts` and record its SHA-256. After every restoration and at final closeout, require both an identical SHA-256 and `git diff --no-index --quiet -- <production-before.ts> training/d1ActionConditionedHeldOutListwiseLabels.ts` exit 0. Persist a production change only if a new test proves a genuine defect, and stop for controller adjudication before doing so.
- Preserve all closed Task 4 findings and all active v5/D1 contracts. Do not alter stream generation, canonical task construction, context validation, aggregation, or public production interfaces.
- Never read, execute, hash, modify, move, delete, typecheck, test, review, stage, or commit `training/searchProbe.ts`, `training/searchProbeWorker.ts`, or `training/searchProbe.test.ts`.
- Do not run bare `npm test`, repository-wide lint, bare `npm run typecheck:train`, diagnostics, calibration, training, resume/restart, bench/paired benchmark, publication, push, or browser/runtime acceptance.
- Every new behavior assertion follows strict TDD. If the current implementation already passes the new assertion, apply one narrow reversible controlled mutation to the exact production expression under test, observe RED, restore the mutation, and observe GREEN. Never retain a mutation.

### Task 1: BigInt boundary and independent evidence

**Files:**

- Modify: `training/d1ActionConditionedHeldOutListwiseLabels.test.ts`
- Temporary mutation only, restore in the same RED/GREEN cycle: `training/d1ActionConditionedHeldOutListwiseLabels.ts`
- Create/modify scratch report: `.superpowers/sdd/2026-08-25-score-rate-v5-d1-task4-corrective-evidence/task-1-report.md`
- Scratch zero-byte diff baseline: `.superpowers/sdd/2026-08-25-score-rate-v5-d1-task4-corrective-evidence/empty-baseline`
- Scratch immutable production baseline: `.superpowers/sdd/2026-08-25-score-rate-v5-d1-task4-corrective-evidence/production-before.ts`

**Interfaces:**

- Consumes unchanged `buildD1SubsetTarget` and the already implemented canonical Task 4 test fixtures.
- Produces no new production API and no new runtime behavior outside the exact test evidence.

- [ ] **Step 1: Add the exact BigInt-distinguishing fixture before any source mutation.**

Add one real-behavior test named `distinguishes BigInt cross-products beyond Number precision` using two equal-survival/equal-score outcomes:

```ts
const left = {
  placementId: 'A', pieceCapContexts: 4, minPieces: 128, sumPieces: 512, sumScore: 100,
  clearCounts: { singles: 96636764, doubles: 0, triples: 0, tetrises: 42949673 },
  totalLines: 268435456, totalTetrises: 42949673,
  tetrisNumerator: 171798692, tetrisDenominator: 268435456,
};
const right = {
  placementId: 'B', pieceCapContexts: 4, minPieces: 128, sumPieces: 512, sumScore: 100,
  clearCounts: { singles: 96636773, doubles: 0, triples: 0, tetrises: 42949677 },
  totalLines: 268435481, totalTetrises: 42949677,
  tetrisNumerator: 171798708, tetrisDenominator: 268435481,
};
expect(buildD1SubsetTarget([left, right]).jointFrontPlacementIds).toEqual(['A']);
```

The exact cross-products are `171798692 * 268435481` and `171798708 * 268435456`; they differ by 4 while each product is beyond Number's exact integer range. Both numerators/denominators and all clear counts are safe integers, and each numerator equals four times its Tetris count.

- [ ] **Step 2: Freeze the temporary-mutation baselines before any RED.**

Ensure the corrective SDD workspace contains a zero-byte `empty-baseline`. Copy the current production file byte-for-byte to `production-before.ts`, record SHA-256 for both paths, and require equality before the first mutation. No test command runs in this step, so the new BigInt assertion has not been observed GREEN before its controlled RED.

- [ ] **Step 3: Independently verify the BigInt fixture arithmetic.**

Use PowerShell `System.Numerics.BigInteger` values to require:

```powershell
$leftProduct = [System.Numerics.BigInteger]171798692 * [System.Numerics.BigInteger]268435481
$rightProduct = [System.Numerics.BigInteger]171798708 * [System.Numerics.BigInteger]268435456
if ($leftProduct - $rightProduct -ne 4) { throw 'unexpected exact cross-product difference' }
if (([double]171798692 * [double]268435481) -ne ([double]171798708 * [double]268435456)) { throw 'fixture does not collide under Number precision' }
```

This is fixture validation only. The actual production RED/GREEN occurs exactly once in Step 5 group 4.

- [ ] **Step 4: Add isolated evidence checks for the existing canonical tests.**

Add or retain independent tests for the four evidence gaps, with expected literals not generated from the assertion's selector. In the existing concrete-12 test, also invoke `buildD1ContextTasks` on the complete canonical fixture before checking the literals so a production expected-placement selector mutation is behaviorally observed rather than merely testing the local fixture:

```ts
expect(concreteCanonicalPlacementIds).toEqual([
  '1:181,191,201,211', '1:182,192,202,212', '1:183,193,203,213', '1:184,194,204,214',
  '1:188,198,208,218', '1:189,199,209,219', '1:211,212,213,214', '1:212,213,214,215',
  '1:213,214,215,216', '1:214,215,216,217', '1:215,216,217,218', '1:216,217,218,219',
]);
expect(canonicalTaskIdentityDigest).toBe('3c7d8769e191a7b60d9bc774fe2f97c203884f453462f234f66539ba3dad463e');
expect(isolatedFractionFailure).toThrow('runtime-fail: invalid tetris fraction');
```

The existing frozen 12-ID fixture, full 7,680 identity digest/middle-swap test, forged-stream test, duplicate-subset test, and isolated nonzero-over-zero test must remain single-variable. Do not weaken their independent literals or replace those literals with calls to production builders. The added `buildD1ContextTasks` call is only the production-boundary assertion for the concrete-12 test.

- [ ] **Step 5: Prove exactly four evidence groups catch regressions.**

Run each of the following as an independent cycle. Start from the recorded production baseline, apply only the named temporary mutation, run the exact selector and observe the specified RED, immediately restore the production file, prove its SHA-256 and byte diff match the baseline, then rerun the identical command and observe the specified GREEN.

1. Concrete 12-placement IDs/order:
   - Test/selector: `freezes one concrete canonical subset fingerprint and all 12 placement identities in order`.
   - Temporary production mutation: in the `expectedPlacements` pipeline, replace only `.slice(0, 12)` with `.slice(1, 13)`.
   - Command:

     ```powershell
     npx vitest run training/d1ActionConditionedHeldOutListwiseLabels.test.ts -t "freezes one concrete canonical subset fingerprint and all 12 placement identities in order" --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
     ```

   - RED: exit 1 with `runtime-fail: non-canonical placement manifest` from the production-boundary call.
   - GREEN: exit 0, exactly this selected test passes, and the frozen subset fingerprint plus all 12 literal IDs remain exact and ordered.

2. Full 7,680-task canonical identity/order plus middle-swap guard:
   - Tests/selector: `materializes all 7,680 tasks in exact canonical coordinate order with coordinate-derived endpoints` and `rejects one middle canonical-subset swap`.
   - Temporary production mutation: replace only `input.subsets.entries()` in the outer canonical-subset loop with `input.subsets.map((subset, index, subsets) => index === 79 ? subsets[80]! : index === 80 ? subsets[79]! : subset).entries()`. This reverses only the middle pair at the consumed-loop boundary.
   - Command:

     ```powershell
     npx vitest run training/d1ActionConditionedHeldOutListwiseLabels.test.ts -t "materializes all 7,680 tasks in exact canonical coordinate order with coordinate-derived endpoints|rejects one middle canonical-subset swap" --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
     ```

   - RED: exit 1; the canonical fixture is rejected as `runtime-fail: non-canonical subset manifest`, while the caller-swapped middle pair is incorrectly accepted and produces the Vitest `expected [Function] to throw` mismatch.
   - GREEN: exit 0, both selected tests pass, including identity digest `3c7d8769e191a7b60d9bc774fe2f97c203884f453462f234f66539ba3dad463e` and the middle-swap rejection.

3. Isolated caller-supplied fraction validation:
   - Test/selector: `rejects caller-supplied non-canonical zero denominators before dominance`.
   - Temporary production mutation: replace only `const suppliedNumerator = outcome.tetrisNumerator ?? 4 * totalTetrises;` with `const suppliedNumerator = 4 * totalTetrises;`, thereby ignoring the caller's invalid nonzero numerator.
   - Command:

     ```powershell
     npx vitest run training/d1ActionConditionedHeldOutListwiseLabels.test.ts -t "rejects caller-supplied non-canonical zero denominators before dominance" --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
     ```

   - RED: exit 1 with `expected [Function] to throw an error` because the isolated invalid `1/0` caller fraction is accepted.
   - GREEN: exit 0 and exactly this selected test passes with `runtime-fail: invalid tetris fraction`.

4. BigInt boundary:
   - Test/selector: `distinguishes BigInt cross-products beyond Number precision`.
   - Temporary production mutation: replace only the two `BigInt(...) * BigInt(...)` product expressions inside `compareFractions` with the corresponding Number products `left.tetrisNumerator * right.tetrisDenominator` and `right.tetrisNumerator * left.tetrisDenominator`.
   - Command:

     ```powershell
     npx vitest run training/d1ActionConditionedHeldOutListwiseLabels.test.ts -t "distinguishes BigInt cross-products beyond Number precision" --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
     ```

   - RED: exit 1 because Number rounds the two cross-products equal and the actual front is `['A', 'B']` rather than `['A']`.
   - GREEN: exit 0 and exactly this selected test passes with front `['A']`.

The report must contain exactly these four fresh RED/GREEN pairs. Reference the prior forged-stream and duplicate-subset RED/GREEN pairs as inherited evidence only; do not mutate or focused-rerun them separately in this corrective task. Their later execution inside the final whole-file regression suite is recorded only in the aggregate regression result and is not a fresh RED/GREEN claim.

- [ ] **Step 6: Run the complete corrective verification.**

```powershell
npx vitest run training/d1ActionConditionedHeldOutListwiseLabels.test.ts training/d1ActionConditionedHeldOutListwiseCore.test.ts src/ai/simulate.test.ts src/ai/stateTransitions.test.ts src/ai/publicState.test.ts src/ai/lineClears.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
npx eslint training/d1ActionConditionedHeldOutListwiseLabels.ts training/d1ActionConditionedHeldOutListwiseLabels.test.ts
```

Expected: all six files pass; ESLint exits 0 with no output. Require the production SHA-256 and byte diff to match `production-before.ts`. Then run both exact owned-path checks below against the corrective SDD workspace's zero-byte baseline; for each command require exit 1 because the owned file is nonempty and require captured stdout plus stderr to contain zero diagnostic lines:

```powershell
git -c core.safecrlf=false diff --no-index --check -- .superpowers/sdd/2026-08-25-score-rate-v5-d1-task4-corrective-evidence/empty-baseline training/d1ActionConditionedHeldOutListwiseLabels.test.ts
git -c core.safecrlf=false diff --no-index --check -- .superpowers/sdd/2026-08-25-score-rate-v5-d1-task4-corrective-evidence/empty-baseline .superpowers/sdd/2026-08-25-score-rate-v5-d1-task4-corrective-evidence/task-1-report.md
git diff --cached --quiet --
```

The first two commands pass this gate only with exit 1 and empty stdout/stderr; exit 0, exit greater than 1, or any whitespace/conflict-marker diagnostic fails the gate. The index command must exit 0.

- [ ] **Step 7: Write the corrective report.**

The report must state no commits/staging, list the exact command, mutation, named RED mismatch, restoration proof, and GREEN result for exactly the four groups above, state which prior forged-stream/duplicate-subset evidence is inherited rather than rerun, include the final production hash/byte-restoration proof and six-file/ESLint/two-owned-file-diff/index output, and state that no protected path or operational command was touched.

- [ ] **Step 8: Independent corrective review.**

The fresh reviewer must return both `spec-compliance` and `code-quality` verdicts, verify the BigInt fixture fails under Number multiplication, verify expected values are independent literals, and verify the report contains all required RED/GREEN evidence. Any Critical/Important finding enters the corrective plan's single review/fix loop; this plan permits at most one corrective fix round because the prior blocker was already adjudicated.

- [ ] **Step 9: Record handback and remove only this corrective workspace after a clean review.**

Only after Step 8 returns `spec-compliance: PASS`, `code-quality: APPROVED`, and zero Critical/Important findings, update this corrective plan's ledger with the final verdict. The controller then records the corrective outcome in `v5-postmortem`, performs Windows PowerShell 5.1 `Checkpoint -> Resume`, and requires `match`. After switching back to the parent D1 controller scope and durably recording the handback there, remove only `.superpowers/sdd/2026-08-25-score-rate-v5-d1-task4-corrective-evidence/` and assert that exact directory is absent. Do not remove or alter any other plan workspace.
