# Task 7 report — fix round 2

## Verdict

Task 7 schema implementation was committed in `933eec8`, with the review fix in
`029e7d4`; this round adds the authorized top-level mutation matrix and direct
v5 compile-consumer migration. Task 8/9 diagnostics/dashboard migrations remain
outside scope.

## Preserved implementation and scope

- Commit `933eec8ca29505c53c89dfa987e7209181f03740` contains seven Task 7 paths:
  `src/ai/trainingObjective.ts`, `src/ai/weights.test.ts`, `src/ai/weights.ts`,
  `training/candidateWeights.ts`, `training/config.ts`, `training/objective.ts`,
  and `training/runArtifacts.ts`.
- Commit `029e7d4` contains the six-path review repair:
  `training/candidateWeights.test.ts`, `training/candidateWeights.ts`,
  `training/config.test.ts`, `training/config.ts`,
  `training/runArtifacts.test.ts`, and `training/runArtifacts.ts`.
- Current fix-round-2 WIP is limited to six authorized paths:
  `training/reevaluationLog.test.ts`, `training/reevaluationLog.ts`,
  `training/runArtifacts.test.ts`, `training/runArtifacts.ts`,
  `training/train-cli.test.ts`, and `training/train.ts`.
- `training/cem.ts` and `training/publication.ts` remain protected unrelated WIP
  and are excluded from this commit.
- No training, benchmark, paired benchmark, publication, push, or runtime
  acceptance was run.

## Focused evidence

Command (serial, one worker, outer timeout 60 seconds):

```powershell
npx vitest run src/ai/weights.test.ts training/config.test.ts training/candidateWeights.test.ts training/runArtifacts.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Initial result: 4 files, 148 tests; 147 passed and 1 failed. The failure was an
obsolete assertion expecting a checkpoint-depth mismatch after setting candidate
`searchDepth` to 1. Exact schema v5 requires literal search metadata
`bag-expectimax-hold-v1 / 4 / 64 / 32`, so the candidate parser correctly rejects
that payload before checkpoint comparison. The test was narrowed to assert exact
v5-schema rejection; no production code was changed for this failure.

Fresh focused result after that test correction: **4 files passed, 148 tests
passed**, exit 0.

Focused coverage proves:

- exact candidate/checkpoint v5 metadata is required;
- schema-4 score-rate-v3 checkpoints and legacy candidates are rejected;
- rejected legacy artifacts remain byte-identical and default path resolution
  creates no output directory;
- search diagnostics are validated and compared as artifact diagnostics, while
  score rate remains `meanScore / evalMaxPieces` and diagnostics do not enter
  scalar fitness.

## Full-suite blocking evidence

The required bounded full suite was run once only:

```powershell
npm test -- --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
```

Historical result: **30 files total; 27 passed, 3 failed. 510 tests total; 493
passed, 15 failed, 2 skipped.**

Failures are schema/objective migration gaps outside the authorized ten paths:

- `training/train-cli.test.ts`: 6 failures. Fixtures and expected errors still
  use score-rate-v3/schema v4, so resume/orchestration reaches the intentional
  v5 rejection gate instead of the later lifecycle assertions.
- `src/training/dashboard/useTrainingLog.test.ts`: 8 failures. Its fixtures and
  labels still use score-rate-v3 while the parser now accepts the current
  score-rate-v4 objective; generated entries are consequently filtered out.
- `training/reevaluationLog.test.ts`: 1 failure. Expected objective remains
  `score-rate-v3`, actual is the intended `score-rate-v4`.

The dashboard fixture failures remain outside this round's authorized scope; no
dashboard files were changed.

## Required successor plan

1. Explicitly authorize the three additional test paths above (and any directly
   demonstrated dashboard URL/source path if a RED test proves it is required).
2. Migrate fixtures to exact v5 metadata, preserving tests that legacy v1-v4
   checkpoints are rejected before workers or writes.
3. Add/retain no-write snapshots around every rejected resume case.
4. Re-run the focused Task 7 suite, then the affected CLI/dashboard/reevaluation
   tests, then one bounded full suite.
5. Run `npm run typecheck:train`, `npm run build`, and relevant lint only after
   tests are green; then exact-path commit and verify protected hashes/status.

## Verification and status

- `npm run typecheck:train`: PASS.
- Current focused Task 7/CLI/reevaluation suite: 6 files, 205 tests passed,
  2 skipped.
- Real HEAD before this round: `029e7d461cd49de6d589111434cd194050b4ac36`.
- Commit accounting: `933eec8` has seven paths (including
  `training/runArtifacts.ts`); `029e7d4` is the six-path review repair.
- No training, benchmark, paired benchmark, publication, push, runtime, or
  public/ai/weight writes were performed.
