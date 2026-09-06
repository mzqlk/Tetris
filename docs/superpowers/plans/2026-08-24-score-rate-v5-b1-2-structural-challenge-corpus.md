# score-rate-v5 B1.2 Structural Challenge Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and independently review the final pre-registered B1 structural challenge corpus, then run exactly one fail-closed diagnostic without changing active score-rate-v5 behavior.

**Architecture:** Add a deterministic, solver-blind finite builder that reproduces a frozen 32-state manifest. Eight exact old13-alias strategy pairs provide a mathematical challenge-validity ceiling, while sixteen controls and eight new safety states protect generalization and survival. A B1.2-only wrapper reuses the dimension-isolated protocol but owns its digest, identifiability disclosure, strict thresholds, stdout-only CLI, and early stop.

**Tech Stack:** TypeScript 5.6, Vitest 3, Node.js/tsx, existing engine SRS enumeration, `lockPlacement`, B1 candidate feature extractor, and shared representation protocol.

## Global Constraints

- Read `AGENTS.md`, `docs/ai-training-handoff.md`, the B1.2 spec, and continuity checkpoint before edits; refresh HEAD/status/index, all Node processes, repository locks, target run artifacts, and published weight hashes.
- Work directly in `D:\WorkSpace\Tetris`; do not create a branch or worktree. Preserve all existing A+/B1/B1.1 WIP and keep the real index empty.
- Preserve exactly `score-rate-v5`, schema 6, 13 production `FEATURE_NAMES`, `bag-expectimax-hold-v2`, depth 4, beams 64/32, `maxWorkUnits=3584`, `budget-corpus-v1`, and fitness `meanScore / scheduled maxPieces`.
- Do not modify production `src/ai/features.ts`, `src/ai/opportunityFeatures.ts`, `training/cem.ts`, `training/train.ts`, search contract/budget code, schema, weights, run artifacts, or either old corpus.
- Preserve standard Hold, exact seven-bag probabilities, public unseen mask, real SRS, survival-first ordering, browser/Node shared pure logic, and board-row immutability.
- Never read, execute, hash, modify, move, delete, stage, commit, or include in a test/typecheck/review package: `training/searchProbe.ts`, `training/searchProbeWorker.ts`, `training/searchProbe.test.ts`. Their path names may appear only in ordinary `git status`.
- Do not modify, move, delete, or archive `public/ai/score-rate-v5-smoke-20260820-200634`, `src/ai/trained-weights.json`, `public/ai/best-weights.json`, any published weight, or any repository/TEMP lock.
- Do not run bare `npm test`, bare repository lint, bare `npm run typecheck:train`, calibration, training/resume/restart, bench, paired benchmark, publication, push, browser/runtime acceptance, or any old diagnostic.
- Use TDD for every behavior change: record focused RED, add minimal GREEN, re-run affected tests. A Critical/Important review finding must be fixed under TDD and receive scoped re-review before advancing.
- Do not use representation solver output, margin, witness, accuracy, exclusion result, training artifacts, seeds, or RNG to select, relabel, reorder, or expand the manifest. The finite grammar and first-N rule are frozen by the spec.
- B1.2 is terminal for this corpus family. Insufficient grammar output, unresolved label review, code-gate failure, `challenge-inconclusive`, or diagnostic `fail` stops the work; do not create B1.3.
- Do not commit during this plan. Use exact pathspecs; never broad-add, stash, reset, restore, or clean.

---

## File Responsibility Map

| File | Operation | Responsibility |
| --- | --- | --- |
| `training/featureRepresentationStructuralChallengeBuilder.ts` | Create | Frozen finite grammar, structural label predicates, semantic non-reuse fingerprints, candidate order, first-N builder, review evidence |
| `training/featureRepresentationStructuralChallengeBuilder.test.ts` | Create | Grammar bounds/order, no RNG/solver dependency, exact alias, non-reuse, first-N determinism, insufficiency fail-closed |
| `training/featureRepresentationStructuralChallengeCorpus.ts` | Create | Literal 32-state manifest, materialization, validation, manifest projection and digest input |
| `training/featureRepresentationStructuralChallengeCorpus.test.ts` | Create | Shape/groups, SRS legality, one-pair-per-state, deep rematerialization, mutation, provenance, alias ceiling |
| `training/featureRepresentationStructuralChallengeReview.ts` | Create | Structure-only 32-record review projection; no feature vectors or solver evidence |
| `training/featureRepresentationStructuralChallengeReview.test.ts` | Create | Exact review fields, predicate evidence, no margin/witness/feature leakage, canonical order |
| `training/featureRepresentationStructuralChallengeGate.ts` | Create | B1.2 early-stop evaluator, strict judgment, wrapper digest, identifiability disclosure, stdout-only CLI |
| `training/featureRepresentationStructuralChallengeGate.test.ts` | Create | Synthetic judgment matrix, dimension isolation, legacy parity, determinism, no-file CLI, serialization |
| `package.json` | Modify | Add only `diagnose:feature-representation-structural-challenge` |

## Frozen Interfaces

```ts
export const B1_2_CORPUS_ID = 'b1-2-structural-challenge-corpus-v1' as const;

export type B1_2_StrategyGroup =
  | 'target-lane-alias'
  | 'lane-transfer-control'
  | 'public-i-context-control';

export interface B1_2_StateDescriptor {
  id: string;
  group: B1_2_StrategyGroup | 'safety-control';
  rows: readonly number[];
  current: Piece;
  next: PieceType;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: number;
  targetWellColumn: WellColumn;
}

export interface B1_2_PairDescriptor {
  id: string;
  stateId: string;
  group: B1_2_StrategyGroup | 'safety-control';
  category: 'strategy' | 'safety';
  positiveCellKey: string;
  negativeCellKey: string;
  positiveClass: 'preserve-target-lane' | 'safe-survival';
  negativeClass: 'break-target-lane' | 'risky-survival';
}

export interface B1_2_Identifiability {
  targetLaneDeltaIdentifiable: true;
  futureIAccessProbabilityIdentifiable: false;
  futureIAccessReason: 'same-state-pair-constant';
}
```

---

### Task 1: Build and materialize the provisional frozen corpus

**Files:**
- Create: `training/featureRepresentationStructuralChallengeBuilder.ts`
- Create: `training/featureRepresentationStructuralChallengeBuilder.test.ts`
- Create: `training/featureRepresentationStructuralChallengeCorpus.ts`
- Create: `training/featureRepresentationStructuralChallengeCorpus.test.ts`
- Read only: `training/featureRepresentationChallengeCorpus.ts`, `training/featureRepresentationCorpus.ts`, `training/tetrisOpportunityCorpus.ts`, `src/ai/features.ts`, `src/ai/tetrisStrategy.ts`, `src/ai/placements.ts`, `src/ai/stateTransitions.ts`

**Interfaces:**
- Produces `buildB1_2Manifest()`, `projectB1_2Manifest()`, `stateFingerprint()`, `structuralProvenanceFingerprint()`, `pairFingerprint()`, `validateB1_2Corpus()`, `materializeB1_2Pair()`, `materializeAllB1_2Pairs()`, literal `B1_2_STATES`, and literal `B1_2_PAIRS`.
- The builder may call `extractFeatures` only for the exact old13-alias admission predicate; it must not import the representation protocol/gates or any solver.

- [ ] **Step 1: Write RED contract tests before creating implementation modules**

  Add imports from the two nonexistent modules and assert the exact id, 32 states/pairs, group counts `8/8/8/8`, unique ids/fingerprints, and one pair per state:

  ```ts
  expect(B1_2_CORPUS_ID).toBe('b1-2-structural-challenge-corpus-v1');
  expect(B1_2_STATES).toHaveLength(32);
  expect(B1_2_PAIRS).toHaveLength(32);
  expect(groupCount('target-lane-alias')).toBe(8);
  expect(groupCount('lane-transfer-control')).toBe(8);
  expect(groupCount('public-i-context-control')).toBe(8);
  expect(groupCount('safety-control')).toBe(8);
  expect(new Set(B1_2_PAIRS.map((pair) => pair.stateId)).size).toBe(32);
  ```

- [ ] **Step 2: Run focused tests and record the expected RED**

  ```powershell
  npx vitest run training/featureRepresentationStructuralChallengeBuilder.test.ts training/featureRepresentationStructuralChallengeCorpus.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: FAIL because the B1.2 builder/corpus modules do not exist.

- [ ] **Step 3: Implement the finite grammar and canonical candidate order exactly as specified**

  Encode the ranges as readonly constants and nested iteration in spec order. Build boards from solid skyline heights; only the safety grammar may clear its one specified notch. Use real `enumeratePlacements`, `cellKey`, and `lockPlacement`. Do not add fallback ranges or RNG.

  ```ts
  export const B1_2_ALIAS_WELL_PAIRS = [[1, 8], [2, 7], [3, 6], [4, 5]] as const;
  export const B1_2_BASE_HEIGHTS = [4, 5, 6, 7, 8, 9] as const;
  export const B1_2_WELL_DROPS = [2, 3, 4] as const;
  export const B1_2_ALIAS_PIECES = [1, 2, 3] as const;
  export const B1_2_PUBLIC_MASKS = [0, 1, 2, 4, 8, 16, 32, 64, 127] as const;
  ```

  Reject any target mismatch with `summarizeTetrisWell(boardBefore).column`, all-zero pre-target summary, unequal line clears, unequal immediate score class, non-survival, or worse positive max height. Compare target summaries through `compareTetrisWellSummaries`.

- [ ] **Step 4: Implement exact alias and semantic non-reuse admission**

  Alias pairs must be mirror cell sets, have 13 old feature values equal by `Object.is`, and differ in at least one of the three target-lane delta values. Compare both full and board/current-only fingerprints against all three older corpora.

  ```ts
  const exactOldAlias = oldPositive.every((value, index) => Object.is(value, oldNegative[index]));
  const laneDeltaDiffers = newPositive.slice(13, 16)
    .some((value, index) => !Object.is(value, newNegative[13 + index]));
  if (!exactOldAlias || !laneDeltaDiffers) return null;
  ```

  Do not inspect dimension 16 (`futureIAccessProbability`) for admission.

- [ ] **Step 5: Materialize the first-N manifest as literal data**

  Take exactly the first 8 admitted candidates per group. Copy the resulting public rows/fields/cell keys into literal frozen arrays. `buildB1_2Manifest()` must independently reproduce `projectB1_2Manifest()` byte-for-byte in tests; production materialization reads only the literal arrays.

  If any group has fewer than 8 candidates, return a typed insufficiency error and stop Task 1 without changing ranges or predicates.

- [ ] **Step 6: Add GREEN structural, immutability, and provenance tests**

  Test all pairs are legal SRS placements, positive/negative are distinct, state rows remain unchanged, two independent materializations deep-equal but share no mutable board row arrays, 8 alias old13 deltas are exactly zero, and the design ceiling is `24 - 8 = 16`.

  Also test every same-state pair has equal `futureIAccessProbability`; this is a disclosure test, not an admission predicate.

- [ ] **Step 7: Run Task 1 focused GREEN suite**

  Run the Step 2 command. Expected: both files PASS, builder manifest exactly equals literal manifest, and no diagnostic/solver entry point executes.

- [ ] **Step 8: Independent Task 1 spec/quality and 32-label review**

  Reviewer must inspect every pair using pre-state, true SRS cells, post-clear board, lines, survival, max height, target summaries, vertical-I access when applicable, old-corpus fingerprint sets, and first-N order. It must not receive solver/margin/witness/accuracy output. Any Critical/Important finding enters the TDD fix/re-review loop.

---

### Task 2: Freeze the independent review projection and pre-registration digest

**Files:**
- Create: `training/featureRepresentationStructuralChallengeReview.ts`
- Create: `training/featureRepresentationStructuralChallengeReview.test.ts`
- Modify: `training/featureRepresentationStructuralChallengeCorpus.ts`
- Modify: `training/featureRepresentationStructuralChallengeCorpus.test.ts`

**Interfaces:**
- Consumes the independently approved Task 1 literal manifest.
- Produces `createB1_2LabelReviewRecords()`, `serializeB1_2ManifestForDigest()`, and literal `B1_2_PRE_REGISTRATION_DIGEST`.

- [ ] **Step 1: Write RED tests for the structure-only review schema and missing digest**

  ```ts
  const records = createB1_2LabelReviewRecords();
  expect(records).toHaveLength(32);
  expect(JSON.stringify(records)).not.toMatch(/featureVector|margin|witness|accuracy|excludedState/i);
  expect(B1_2_PRE_REGISTRATION_DIGEST).toMatch(/^[0-9a-f]{64}$/);
  ```

  Assert each record includes public pre-state, two cell keys, post-clear rows, equal lines, survival booleans, max heights, target summaries before/after, vertical-I availability/access, and each predicate verdict.

- [ ] **Step 2: Run the focused review tests and observe RED**

  ```powershell
  npx vitest run training/featureRepresentationStructuralChallengeReview.test.ts training/featureRepresentationStructuralChallengeCorpus.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: FAIL because the review projection and frozen digest do not exist.

- [ ] **Step 3: Implement the review projection without solver or feature-vector leakage**

  The module may use board/placement/transition/tetris-well functions. It must not import `featureRepresentationProtocol`, any gate, `fitLinearMarginWitness`, or expose old/new feature values. Sort records by canonical pair id.

- [ ] **Step 4: Freeze the reviewed manifest digest**

  Serialize only explicit projected fields in fixed key order, compute SHA-256 once, write the literal lowercase value into `B1_2_PRE_REGISTRATION_DIGEST`, and test recomputation equals the literal. Any subsequent label/state/order change must fail the test.

- [ ] **Step 5: Run Task 2 focused GREEN suite and scoped independent re-review**

  Run Step 2. Expected: PASS. Reviewer checks the record projection matches the 32/32 Task 1 approvals and the digest freezes those exact reviewed inputs. Resolve Critical/Important findings under TDD before Task 3.

---

### Task 3: Add the B1.2 wrapper, strict judgment, and stdout-only CLI

**Files:**
- Create: `training/featureRepresentationStructuralChallengeGate.ts`
- Create: `training/featureRepresentationStructuralChallengeGate.test.ts`
- Modify: `package.json`
- Read-only parity references: `training/featureRepresentationProtocol.ts`, `training/featureRepresentationGate.ts`, `training/featureRepresentationChallengeGate.ts`

**Interfaces:**
- Consumes `materializeAllB1_2Pairs`, `B1_2_PRE_REGISTRATION_DIGEST`, existing `evaluateRepresentationDimension`, old13 `extractFeatures`, and candidate `extractB1PlacementFeatures`.
- Produces `judgeB1_2Gate`, `evaluateB1_2Gate`, `serializeB1_2Result`, `runB1_2Cli`, and `emitB1_2Cli`.

- [ ] **Step 1: Write synthetic RED judgment tests**

  Cover these exact rows:

  | old13 | new17 | safety | LOSO | regressions | deterministic | expected |
  | ---: | ---: | ---: | ---: | ---: | --- | --- |
  | 21 | null | n/a | n/a | n/a | true | `challenge-inconclusive` |
  | 16 | 21 | 8 | 1 | 0 | true | `fail` |
  | 16 | 22 | 8 | 0.90 | 0 | true | `fail` |
  | 18 | 22 | 8 | 1 | 0 | true | `fail` because gain is 4 |
  | 16 | 22 | 8 | 22/24 | 0 | true | `pass` |
  | 16 | 24 | 7 | 1 | 0 | true | `fail` |
  | 16 | 24 | 8 | 1 | 1 | true | `fail` |
  | 16 | 24 | 8 | 1 | 0 | false | `fail` |

  Invalid fractional/out-of-range counts fail before challenge-inconclusive.

- [ ] **Step 2: Run the gate test and observe RED**

  ```powershell
  npx vitest run training/featureRepresentationStructuralChallengeGate.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: FAIL because the B1.2 gate module does not exist.

- [ ] **Step 3: Implement dimension isolation and early stop**

  Validate corpus/digest/alias invariants, evaluate old13 only, validate its pair order/count/determinism, and return `challenge-inconclusive` without calling new17 if old13 is above 20. Old13 nondeterminism or malformed dimension evidence is `fail`, not inconclusive.

- [ ] **Step 4: Implement strict B1.2 judgment**

  Require new17 `>=22`, integer gain `>=5`, safety `8`, LOSO `>0.90`, zero LOSO safety regressions, and deterministic identical SHA-256 digests. Project B1.2-only identifiability fields and pre-registration digest; do not modify the shared serializer or old wrappers.

- [ ] **Step 5: Add deterministic wrapper serialization and no-file CLI tests**

  Wrapper digest input includes the pre-registration digest, canonical pair order, identifiability object, projected summaries, strategy gain, and failure reasons. Run injected synthetic dependencies twice and require identical wrapper digests.

  Execute only an injected CLI in a newly created temporary working directory, snapshot the directory before/after, capture the write callback, and require one JSON line. Do not invoke the real default evaluator.

- [ ] **Step 6: Add the package script with a minimal byte-scoped change**

  Add only:

  ```json
  "diagnose:feature-representation-structural-challenge": "tsx training/featureRepresentationStructuralChallengeGate.ts"
  ```

  Preserve every existing script and file formatting outside that insertion.

- [ ] **Step 7: Run the explicit parity suite**

  ```powershell
  npx vitest run training/featureRepresentationStructuralChallengeBuilder.test.ts training/featureRepresentationStructuralChallengeCorpus.test.ts training/featureRepresentationStructuralChallengeReview.test.ts training/featureRepresentationStructuralChallengeGate.test.ts training/featureRepresentationChallengeGate.test.ts training/featureRepresentationChallengeCorpus.test.ts training/featureRepresentationProtocol.test.ts training/featureRepresentationGate.test.ts training/featureRepresentationCorpus.test.ts src/ai/opportunityFeatures.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: all ten files PASS; existing B1/B1.1 literal golden/result schema/digest parity remains unchanged. The real B1.2 diagnostic is not run here.

- [ ] **Step 8: Independent Task 3 review and fix loop**

  Reviewer checks validation precedence, old13 early stop, strict integer thresholds, LOSO `>0.90`, no shared serializer drift, wrapper digest coverage, identifiability honesty, stdout-only/no-file behavior, and legacy parity. Fix Critical/Important findings with RED/GREEN and scoped re-review.

---

### Task 4: Run safe code gates and whole-change review

**Files:**
- Only Tasks 1–3 files may change.
- Scratch evidence belongs only in `.superpowers/sdd/2026-08-24-score-rate-v5-b1-2-structural-challenge-corpus/`.

- [ ] **Step 1: Run the exact ten-file focused suite**

  Use Task 3 Step 7 verbatim and record exit, file count, test count, failures, and duration.

- [ ] **Step 2: Run explicit-file ESLint**

  ```powershell
  npx eslint -- training/featureRepresentationStructuralChallengeBuilder.ts training/featureRepresentationStructuralChallengeBuilder.test.ts training/featureRepresentationStructuralChallengeCorpus.ts training/featureRepresentationStructuralChallengeCorpus.test.ts training/featureRepresentationStructuralChallengeReview.ts training/featureRepresentationStructuralChallengeReview.test.ts training/featureRepresentationStructuralChallengeGate.ts training/featureRepresentationStructuralChallengeGate.test.ts training/featureRepresentationProtocol.ts training/featureRepresentationChallengeGate.ts training/featureRepresentationGate.ts
  ```

  Stop on failure; remediation requires TDD or a static-diagnostic RED and scoped re-review.

- [ ] **Step 3: Run production build**

  ```powershell
  npm run build
  ```

  Record exit and Vite module count. Build output is ignored and is not a publish action.

- [ ] **Step 4: Run a safe explicit-root train typecheck**

  Create a scratch tsconfig extending `../../../tsconfig.train.json`, with `include: []` and `files` equal to: tracked train roots from `git ls-files -- training src/ai src/engine src/types.ts src/constants.ts`, minus `src/ai/loadWeights.ts`, plus only the eight new B1.2 source/test paths. Filter the three protected path names without opening them. Assert the resulting list contains zero protected paths before invoking:

  ```powershell
  npx tsc -p .superpowers/sdd/2026-08-24-score-rate-v5-b1-2-structural-challenge-corpus/task-4-safe-train-tsconfig.json --pretty false
  ```

- [ ] **Step 5: Run scoped whitespace/index checks**

  Run `git diff --check` with exact pathspecs for the eight B1.2 files and `package.json`, then `git diff --cached --quiet --`. Do not check or hash protected paths.

- [ ] **Step 6: Independent whole-change review**

  Review only the B1.2 spec/plan and nine planned changes. It must re-adjudicate all frozen rules, 32 labels, provenance/non-reuse, exact alias proof, manifest digest, legacy parity, strict thresholds, no-file behavior, active-v5 invariants, and protected boundaries. One final fix wave is allowed; every Critical/Important fix gets one scoped re-review. Residual load-bearing findings stop before diagnostic.

---

### Task 5: Run exactly one B1.2 diagnostic and close out

**Files:**
- Modify only the SDD ledger and `v5-postmortem` continuity Markdown after the run.
- Do not modify corpus/gate code after observing diagnostic output.

- [ ] **Step 1: Fresh diagnostic pre-flight**

  Refresh HEAD/branch/divergence, full ordinary status, real index, every Node process with CPU/memory/command line, repository/index locks, active-v5 diffs, target run file names/timestamps/hashes/checkpoint contract/candidate absence, default-run absence, and both published weight hashes. Protected probes remain status-only.

- [ ] **Step 2: Execute the new diagnostic once**

  ```powershell
  npm run diagnose:feature-representation-structural-challenge --silent
  ```

  Capture elapsed time, exit, stdout bytes/line count/SHA-256, stderr bytes, parsed JSON, result digest, corpus digest, old13/new17 summaries, gain, safety, LOSO, and reasons. Do not rerun on failure, timeout, parse error, nondeterminism, or inconclusive result.

- [ ] **Step 3: Apply fail-closed adjudication**

  - `pass`: report only that B1.2 representation gate passed and a separate production integration design is technically eligible; do not integrate or train.
  - `challenge-inconclusive`: report old13 challenge failure and stop B1 corpus work permanently.
  - `fail`: report exact failed gates and stop B1 corpus work permanently.

- [ ] **Step 4: Fresh post-flight and continuity closeout**

  Repeat Step 1 live checks and prove no process/lock/artifact/weight/index drift. Append diagnostic evidence to this plan's SDD ledger and `v5-postmortem` checkpoint. Checkpoint with a Git excludes file covering protected probes, then Resume through Windows PowerShell with the same excludes and require `match` or report drift.

## Plan Self-Review Checklist

- [ ] The grammar ranges/order, first-N rule, label predicates, non-reuse fingerprints, and terminal insufficiency behavior are exact.
- [ ] Eight exact old13-alias pairs mathematically cap old13 at 16 without solver-based selection.
- [ ] Every state has one pair; LOSO does not use ambiguous same-state duplicates.
- [ ] The manifest becomes immutable only after independent 32/32 label approval and is then locked by a literal digest.
- [ ] `futureIAccessProbability` is disclosed as same-state-constant and is never credited for a B1.2 gain.
- [ ] Strict new17 thresholds are `>=22/24`, gain `>4`, safety `8/8`, LOSO `>0.90`, zero regressions, deterministic digest.
- [ ] B1/B1.1 serializers, schemas, literals, labels, goldens, and digests remain unchanged.
- [ ] Safe tests/lint/typecheck exclude all protected probes; active v5, artifacts, weights, locks, training, benchmark, publication, runtime acceptance, staging, and commit remain untouched.
- [ ] Exactly one new diagnostic runs only after clean code/review gates; no result-driven corpus change or rerun is permitted.

