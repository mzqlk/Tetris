# score-rate-v5 B1.1 Challenge Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate, pre-registered public challenge corpus that can falsify or support a generalizable gain from the B1 17-feature representation without changing active score-rate-v5 behavior.

**Architecture:** Keep `b1-placement-pair-corpus-v1` immutable and add `b1-1-challenge-corpus-v1` as a second literal public corpus. Reuse the existing SRS/`lockPlacement` materialization and deterministic margin/LOSO/safety protocol through a shared evaluator interface; the challenge runner adds an old13 challenge-validity gate before judging new17. The runner is stdout-only and remains disconnected from production features, CEM, training, weights, and run artifacts.

**Tech Stack:** TypeScript 5.6, Vitest 3, Node.js/tsx, existing engine SRS and `lockPlacement`, `src/ai/publicState.ts`, existing B1 feature and representation-gate modules.

## Global Constraints

- Read `AGENTS.md`, `docs/ai-training-handoff.md`, and the approved B1.1 spec before implementation; refresh HEAD/status, processes, locks, run artifacts, and published weights at the start of every execution session.
- Preserve the active contract exactly: `score-rate-v5`, schema 6, exact 13 `FEATURE_NAMES` order, `bag-expectimax-hold-v2`, depth 4, beams 64/32, `maxWorkUnits=3584`, `budget-corpus-v1`, and fitness `meanScore / scheduled maxPieces`.
- Do not modify production `src/ai/features.ts`, `training/cem.ts`, `training/train.ts`, search budget/contract code, schema/weights, or any v5 run artifact.
- Do not read, execute, hash, modify, move, delete, stage, or commit `training/searchProbe.ts`, `training/searchProbeWorker.ts`, or `training/searchProbe.test.ts`; ordinary `git status` is the only permitted observation of those paths.
- Preserve standard Hold, exact seven-bag probabilities, public `unseenBagMask`, SRS placement enumeration, survival-first ordering, board-row immutability, and shared browser/Node pure logic.
- Keep `b1-placement-pair-corpus-v1` unchanged. Challenge labels and corpus selection must not depend on weights, margins, solver output, seeds, RNG, hidden bag order, bag index, or training artifacts.
- The challenge diagnostic writes one JSON line to stdout only; it must not create locks or files under `public/ai`, `training-archive`, checkpoints, logs, weights, or published paths.
- Do not run `npm run diagnose:feature-representation-challenge`, calibration, training/resume/restart, bench, paired benchmark, publication, push, or browser/runtime acceptance as part of this implementation plan.
- No commit is authorized by this plan; preserve all pre-existing WIP and keep the real Git index empty.
- Any code-gate, corpus-review, or challenge-diagnostic failure is fail-closed: do not relax thresholds, add budget, add T4 bonuses, alter CEM, relabel the old corpus, or automatically switch to Pareto CEM.

---

## File Responsibility Map

| File | Operation | Responsibility |
| --- | --- | --- |
| `training/featureRepresentationChallengeCorpus.ts` | Create | 32 new literal public states, 24/8 group counts, reviewed pair descriptors, public-only validation, and shared-engine materialization |
| `training/featureRepresentationChallengeCorpus.test.ts` | Create | Literal schema, group/state uniqueness, public-only provenance, pair legality, immutability, and deterministic materialization tests |
| `training/featureRepresentationProtocol.ts` | Create | Generic deterministic old13/new17 pair evaluation, scale/solver/LOSO/safety protocol extracted once for both B1 corpora |
| `training/featureRepresentationProtocol.test.ts` | Create | Protocol parity, injected malformed corpus, deterministic ordering, and threshold behavior tests |
| `training/featureRepresentationGate.ts` | Modify | Adapt existing B1 v1 gate to the shared protocol without changing its current result schema or thresholds |
| `training/featureRepresentationGate.test.ts` | Modify | Preserve all existing B1 v1 tests and add parity tests for the extracted protocol |
| `training/featureRepresentationChallengeGate.ts` | Create | Challenge-validity gate, `challenge-inconclusive` result, stdout-only CLI, and challenge-specific serialization |
| `training/featureRepresentationChallengeGate.test.ts` | Create | Challenge floor, pass/fail/indeterminate judgments, privacy, deterministic digest, and no-file CLI tests |
| `package.json` | Modify | Add only `diagnose:feature-representation-challenge`; preserve pre-existing `diagnose:horizon` and B1 v1 script entries |

The plan intentionally does not modify `src/ai/opportunityFeatures.ts`; B1.1 consumes the already-reviewed feature extractor exactly as it is.

## Interfaces to Freeze Before Coding

```ts
export type ChallengeStrategyGroup =
  | 'lane-preservation'
  | 'completion-versus-lower-order'
  | 'public-i-access';

export type ChallengePairCategory = 'strategy' | 'safety';

export interface ChallengeStateDescriptor {
  id: string;
  group: ChallengeStrategyGroup | 'safety';
  rows: readonly number[];
  current: Piece;
  next: PieceType;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: number;
  targetWellColumn: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

export interface ChallengePlacementPairDescriptor {
  id: string;
  stateId: string;
  group: ChallengeStrategyGroup | 'safety';
  category: ChallengePairCategory;
  positiveCellKey: string;
  negativeCellKey: string;
  positiveClass: 'preserve-well' | 'complete-tetris' | 'safety-only';
  negativeClass: 'destroy-well' | 'lower-order' | 'risky-survival';
}

export interface ChallengeRepresentationResult {
  mode: 'feature-representation-challenge';
  status: 'pass' | 'fail' | 'challenge-inconclusive';
  corpus: 'b1-1-challenge-corpus-v1';
  pairCount: number;
  strategyCount: number;
  safetyCount: number;
  challengeValidity: {
    old13StrategyCorrect: number;
    old13StrategyMaximum: 20;
    status: 'valid' | 'inconclusive';
  };
  old13: RepresentationGateSummary | null;
  new17: RepresentationGateSummary | null;
  strategyGain: number | null;
  repeatedRunDeterministic: boolean;
  repeatedRunDigest: string;
  identicalRunDigest: string;
  failureReasons: readonly string[];
}
```

The implementation must use the existing `B1PlacementFeatureInput`, `MaterializedPlacementPair`, `RepresentationGateSummary`, `fitLinearMarginWitness`, and `judgeRepresentationGate` contracts where their semantics already match. Any adapter must be pure and preserve stable pair-id order.

---

### Task 1: Freeze and materialize the challenge corpus

**Files:**
- Create: `training/featureRepresentationChallengeCorpus.ts`
- Create: `training/featureRepresentationChallengeCorpus.test.ts`
- Read-only references: `training/tetrisOpportunityCorpus.ts`, `training/featureRepresentationCorpus.ts`, `src/ai/placements.ts`, `src/ai/stateTransitions.ts`, `src/ai/publicState.ts`

**Interfaces:**
- Consumes: `PublicSearchState`, `B1PlacementFeatureInput`, `enumeratePlacements`, `cellKey`, `lockPlacement`, and literal row-mask conventions from the existing corpus.
- Produces: `B1_1_CHALLENGE_CORPUS_ID`, `B1_1_CHALLENGE_STATES`, `B1_1_CHALLENGE_PAIR_DESCRIPTORS`, `materializeChallengePlacementPair`, and `materializeAllChallengePlacementPairs`.

- [ ] **Step 1: Add RED tests for the frozen shape and structural groups**

  Assert the exact corpus id, 32 states, 24 strategy states, 8 safety states, eight states in each of the three strategy groups, unique state ids, unique pair ids, one pair per state, and no descriptor keys matching `seed|rng|bagIndex|hidden`.

  ```ts
  expect(B1_1_CHALLENGE_CORPUS_ID).toBe('b1-1-challenge-corpus-v1');
  expect(B1_1_CHALLENGE_STATES).toHaveLength(32);
  expect(B1_1_CHALLENGE_STATES.filter((s) => s.group === 'lane-preservation')).toHaveLength(8);
  expect(B1_1_CHALLENGE_STATES.filter((s) => s.group === 'completion-versus-lower-order')).toHaveLength(8);
  expect(B1_1_CHALLENGE_STATES.filter((s) => s.group === 'public-i-access')).toHaveLength(8);
  expect(B1_1_CHALLENGE_STATES.filter((s) => s.group === 'safety')).toHaveLength(8);
  expect(new Set(B1_1_CHALLENGE_STATES.map((s) => s.id)).size).toBe(32);
  expect(JSON.stringify(B1_1_CHALLENGE_PAIR_DESCRIPTORS)).not.toMatch(/seed|rng|bagIndex|hidden/i);
  ```

- [ ] **Step 2: Run the focused test to observe RED**

  Run:

  ```powershell
  npx vitest run training/featureRepresentationChallengeCorpus.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: FAIL because the challenge corpus module and exports do not exist.

- [ ] **Step 3: Add 32 literal public states and 32 reviewed pair descriptors**

  Use exactly 8 new states per group. State rows must be literal 22-row unsigned 10-bit masks; public fields are only board/current/next/hold/holdAvailable/unseenBagMask plus the reviewed target/group metadata. Each strategy pair must compare a structurally meaningful preserve/complete action against a lower-order or well-destroying action; each safety pair must compare survival-preserving against risky survival. Do not derive labels from feature values or solver output.

  Validate at module load and through an exported test helper:

  ```ts
  export function validateChallengeCorpus(): void;
  ```

  It must reject wrong counts, duplicate state/pair ids, group/category mismatch, duplicate state/pair use, invalid row masks, invalid piece/hold fields, same positive/negative cell keys, unknown states, and missing public fields.

- [ ] **Step 4: Materialize every pair through the shared engine**

  Enumerate legal placements with SRS, resolve both explicit cell keys, and call `lockPlacement` once per side. Return `state`, `positive`, and `negative` with the same shape as the existing B1 materialized pair. Snapshot source rows before materialization and throw if any row changes. Reject a pair if the two descriptors do not share the same public pre-state.

- [ ] **Step 5: Run the corpus tests to observe GREEN**

  ```powershell
  npx vitest run training/featureRepresentationChallengeCorpus.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: all shape, legality, public-only, immutability, repeated-materialization, and group-count tests PASS.

- [ ] **Step 6: Obtain independent label review before any solver run**

  Create a read-only review package listing all 32 descriptors and the rendered public pre-state. The reviewer must verify SRS reachability, post-clear state, target lane consequence, and survival consequence. Fix only explicit literals/tests; never change solver thresholds to accommodate a label.

### Task 2: Extract one reusable deterministic representation protocol

**Files:**
- Create: `training/featureRepresentationProtocol.ts`
- Create: `training/featureRepresentationProtocol.test.ts`
- Modify: `training/featureRepresentationGate.ts`
- Modify: `training/featureRepresentationGate.test.ts`

**Interfaces:**
- Consumes: a readonly `MaterializedPlacementPair[]`, old/new feature extractors, the existing B1 solver constants, and pair categories.
- Produces: `canonicalizeRepresentationPairs`, `evaluateRepresentationCorpus`, `judgeRepresentationCorpus`, and `serializeRepresentationSummary`; the existing B1 v1 gate remains backward-compatible.

- [ ] **Step 1: Add RED protocol parity and generic-input tests**

  Inject the current B1 v1 materialized pairs into the new protocol and assert the old gate's exact `strategyCorrect13`, `strategyCorrect17`, safety counts, LOSO rates, exclusion order, witness determinism, failure reasons, and digest. Add a synthetic malformed corpus test that must return the safe `representation-gate-evaluation-error` reason without leaking the thrown message.

- [ ] **Step 2: Run the focused protocol tests to observe RED**

  ```powershell
  npx vitest run training/featureRepresentationProtocol.test.ts training/featureRepresentationGate.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: FAIL because the shared protocol module and generic adapter do not exist.

- [ ] **Step 3: Move only common mechanics behind the generic protocol**

  Extract scale derivation, 13/17 delta construction, deterministic exclusion enumeration, projected margin fitting, pair evaluation, LOSO, safety regression counting, stable serialization, and safe exception handling. Keep the existing `evaluateRepresentationGate()` output and current B1 v1 corpus id unchanged by adapting it to the generic protocol.

  The old B1 invocation must remain behaviorally identical: no new challenge threshold, corpus state, feature, fitness, CEM, search, or artifact field may enter it.

- [ ] **Step 4: Run protocol and B1 regression tests**

  ```powershell
  npx vitest run training/featureRepresentationProtocol.test.ts training/featureRepresentationGate.test.ts training/featureRepresentationCorpus.test.ts src/ai/opportunityFeatures.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: all existing B1 tests and new protocol parity tests PASS, including the known B1 v1 `strategy-gain-below-4` result.

### Task 3: Implement challenge-validity and challenge gate

**Files:**
- Create: `training/featureRepresentationChallengeGate.ts`
- Create: `training/featureRepresentationChallengeGate.test.ts`

**Interfaces:**
- Consumes: challenge materialization, `evaluateRepresentationCorpus`, `judgeRepresentationCorpus`, B1 old/new feature extractors, and stable serialization.
- Produces: `evaluateChallengeRepresentationGate`, `judgeChallengeRepresentationGate`, `serializeChallengeRepresentationResult`, `runChallengeRepresentationGateCli`, and `emitChallengeRepresentationGateCli`.

- [ ] **Step 1: Add RED tests for the challenge floor and status precedence**

  Cover these exact cases:

  ```ts
  expect(judgeChallengeRepresentationGate({ old13StrategyCorrect: 21, strategyCorrect17: null })).toEqual({
    status: 'challenge-inconclusive',
    failureReasons: ['challenge-validity-old13-above-20'],
  });
  expect(judgeChallengeRepresentationGate({ old13StrategyCorrect: 20, strategyCorrect17: 22, safetyCorrect17: 8, losoRate17: 0.9, safetyRegressions17: 0, deterministic: true })).toEqual({
    status: 'pass',
    failureReasons: [],
  });
  expect(judgeChallengeRepresentationGate({ old13StrategyCorrect: 20, strategyCorrect17: 21, safetyCorrect17: 8, losoRate17: 1, safetyRegressions17: 0, deterministic: true })).toEqual({
    status: 'fail',
    failureReasons: ['strategy-correct-17-below-22', 'strategy-gain-below-4'],
  });
  ```

  Also test pair-count/group errors, illegal placement, non-finite features, safety regression, LOSO below 0.90, nondeterministic digest, stdout-only behavior, and no-file side effects.

- [ ] **Step 2: Run challenge-gate tests to observe RED**

  ```powershell
  npx vitest run training/featureRepresentationChallengeGate.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: FAIL because the challenge evaluator and judgment exports do not exist.

- [ ] **Step 3: Implement the fail-closed challenge flow**

  Canonical flow:

  1. Materialize and validate all 32 challenge pairs.
  2. Evaluate old13 with the shared protocol.
  3. If old13 strategy correctness is `21..24`, return `status='challenge-inconclusive'`, include old13 summary, set new17 summary and gain to `null`, and do not relabel or retry the corpus.
  4. If old13 is `<=20`, evaluate new17 using the same pairs, scales, solver constants, exclusion order, and LOSO folds.
  5. Return `pass` only for new17 `>=22/24`, gain `>=4`, safety `8/8`, LOSO `>=0.90`, zero safety regression, and identical repeated digest; otherwise return `fail` with stable reason codes.

  The JSON result must include corpus id, counts, challenge validity, old/new summaries, gain, deterministic digests, status, and safe reason codes only. It must exclude absolute paths, raw exceptions, board dumps, seeds, RNG, hidden bag data, and candidate identity.

- [ ] **Step 4: Add the package command without changing existing commands**

  Add exactly:

  ```json
  "diagnose:feature-representation-challenge": "tsx training/featureRepresentationChallengeGate.ts"
  ```

  Preserve `diagnose:horizon`, `diagnose:feature-representation`, `train`, `bench`, and `bench:paired` entries byte-for-byte apart from the new line.

- [ ] **Step 5: Run the focused challenge suite**

  ```powershell
  npx vitest run training/featureRepresentationChallengeGate.test.ts training/featureRepresentationProtocol.test.ts training/featureRepresentationChallengeCorpus.test.ts training/featureRepresentationGate.test.ts training/featureRepresentationCorpus.test.ts src/ai/opportunityFeatures.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: all tests PASS; the challenge CLI itself is still not run in this implementation plan.

### Task 4: Complete the B1.1 code gate and independent review

**Files:**
- Only the files listed in Tasks 1–3 and the new package script may be changed.
- Do not include `training/searchProbe.ts`, `training/searchProbeWorker.ts`, or `training/searchProbe.test.ts` in any command or review package.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: a reviewed, code-gate-complete B1.1 implementation ready for a separately authorized challenge diagnostic.

- [ ] **Step 1: Run tracked focused tests with an explicit file list**

  Build the test list from `git ls-files` and append only the B1.1 files; exclude all three protected probes. Run the focused suite from Task 3 and record exact file/test counts.

- [ ] **Step 2: Run static gates with safe explicit scope**

  Run target-file ESLint, `npm run build`, a safe explicit-file train typecheck excluding `src/ai/loadWeights.ts` and the protected probes, and `git diff --check`. Do not use a bare test/lint command that could collect protected untracked probes.

- [ ] **Step 3: Prepare independent review package**

  Include only the B1.1 corpus/protocol/gate files and the new package script hunk. Review must check literal pre-registration, 24/8 and 8/8 group counts, public-only provenance, shared SRS/lock parity, old13 floor precedence, new17 thresholds, LOSO/safety/determinism, stdout privacy, no active v5/CEM/schema/artifact changes, and protected-path boundaries.

- [ ] **Step 4: Resolve only Critical/Important findings**

  Any fix must add a failing regression test first, run the affected focused test, and obtain scoped re-review. Do not change corpus labels to make the result pass and do not weaken thresholds.

- [ ] **Step 5: Refresh live state and stop before diagnostic execution**

  Refresh HEAD, branch/status, trainer/search process list, `.git` locks, target run directory, candidate absence, and published weight hashes. Update continuity checkpoint with code-gate status and stop. The next separately authorized command is `npm run diagnose:feature-representation-challenge --silent`.

## Acceptance Gates and Stop Conditions

1. **Corpus code gate:** all literal/public/schema/materialization tests pass; no active v5/CEM/artifact changes.
2. **Corpus review gate:** independent label review has no unresolved Critical/Important findings.
3. **Protocol parity gate:** existing B1 v1 results and thresholds remain unchanged under the extracted shared evaluator.
4. **Challenge diagnostic gate:** separate fresh state refresh, then challenge-validity and new17 thresholds produce `pass`, `fail`, or `challenge-inconclusive`; this command is not part of code-gate execution.
5. **Production design gate:** only a challenge diagnostic `pass` permits writing a new production integration design; it does not authorize code, schema, training, benchmark, paired, publication, or runtime acceptance.

## Plan Self-Review Checklist

- [ ] New corpus is independent, public-only, pre-registered, and never mutates the old B1 corpus.
- [ ] Exactly 8 states exist in each of three strategy groups and exactly 8 safety controls.
- [ ] old13 floor `<=20/24` is explicit and returns `challenge-inconclusive` instead of relabeling or weakening thresholds.
- [ ] new17 `>=22/24`, gain `>=4`, safety `8/8`, LOSO `>=0.90`, zero safety regression, and deterministic digest are explicit.
- [ ] Existing SRS, Hold, seven-bag, survival, board immutability, active v5 contract, protected probes, and artifact invariants are mapped to tasks.
- [ ] No diagnostic, training, benchmark, publication, or runtime command is run by this plan.
- [ ] No commit is authorized.

## Handoff

Plan is intentionally stopped after the B1.1 code gate. If the user authorizes execution, choose either subagent-driven-development or executing-plans, perform fresh state checks, implement Tasks 1–4, and stop before the challenge diagnostic command.
