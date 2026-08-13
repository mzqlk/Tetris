# Task 8 report

## Scope

Committed Task 8 changes for independent search-diagnostics aggregation, fixed
4/64/32 orchestration metadata, generation/reevaluation propagation, and
dashboard parser types. Existing Task 7 WIP in `training/publication.ts`,
`training/runArtifacts.ts`, and `training/runArtifacts.test.ts` was left
unstaged and untouched by this commit; `task-7-report.md` remains untracked.

## TDD and implementation

- RED: `npx vitest run --maxWorkers=1 training/cem.test.ts training/reevaluationLog.test.ts training/train-cli.test.ts src/training/dashboard/useTrainingLog.test.ts`; initial failures covered missing search diagnostics and dashboard v4 fields.
- Implemented `CandidateStats.meanSearchDiagnostics`, validated and averaged worker `SimulationSearchDiagnostics` independently from fitness, and emitted best/median/elite search diagnostics in generation records.
- Reevaluation summaries consume the same independent aggregate; search diagnostics do not enter scalar fitness, elite sorting, or CEM update.
- Trainer tasks retain fixed `FIXED_SEARCH_LIMITS` (4/64/32), and dashboard parsing only was updated.

## Verification

- Focused: `npx vitest run --maxWorkers=1 training/cem.test.ts training/reevaluationLog.test.ts training/train-cli.test.ts src/training/dashboard/useTrainingLog.test.ts` -> 4 files, 97 passed, 2 skipped.
- Full: `npm test` -> 30 files, 534 passed, 2 skipped.
- `npm run typecheck:train` -> passed.
- `npm run build` -> passed.
- `git diff --check` -> passed.
- No train, bench, paired benchmark, browser/runtime acceptance, public/ai, training-archive, or weight writes were run.

## Unresolved / concerns

The working tree still contains pre-existing unstaged Task 7 changes in
`training/publication.ts`, `training/runArtifacts.ts`, and
`training/runArtifacts.test.ts`, plus untracked `task-7-report.md`; they are
outside this Task 8 commit.

## Commit

`f013aff` (`feat(training): propagate fixed-search diagnostics`)

## Fix round 1

Review finding I-1 identified a mutable alias: reevaluation `snapshot()` did
not copy `searchDiagnostics`. The actual repair is commit `f87786b`
(`fix(training): snapshot reevaluation search diagnostics`): its mutation
regression changes each input evaluation's `searchDiagnostics.holdActions`
after entry construction and asserts the baseline, current-qualified, and
candidate snapshots retain their original value. `snapshot()` now copies the
diagnostics object field-for-field through object spread.

Fresh verification after review:

- `npx vitest run --maxWorkers=1 training/reevaluationLog.test.ts training/cem.test.ts training/train-cli.test.ts src/training/dashboard/useTrainingLog.test.ts` -> 4 files, 97 passed, 2 skipped.
- `npm run typecheck:train` -> passed.
- `git diff --check` -> passed.

No train, bench, paired benchmark, runtime/browser, artifact, or weight action
was run in this fix round.
