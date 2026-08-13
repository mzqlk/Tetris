# Task 5 report

## Outcome

- Integrated fixed public-state search into the deterministic simulator, including standard Hold execution, public seven-bag projection, fixed-search diagnostics, worker propagation, failed-task defaults, and benchmark aggregation.
- Preserved the prior implementer's seven-file WIP and completed it in place; no reset, checkout, stash, or restart was used.
- Production defaults remain the frozen `4/64/32` contract with `shouldAbort: () => false`. Scoring/engine-parity simulator tests use an explicitly shallow deterministic test config; the depth-4 simulator assertion uses a constrained state.
- Search diagnostics remain observational only and do not enter fitness.

## TDD and bounded diagnosis

- This was a takeover of existing RED/GREEN WIP, so the original failing-test run was not independently witnessed and was not reconstructed by destroying the preserved WIP.
- First bounded reproduction: `npx vitest run src/ai/simulate.test.ts -t "reports completed fixed depth and no aborted searches" --maxWorkers=1 --minWorkers=1` — 1 passed, 26 skipped, Vitest duration 2.01s, depth-4 test body 1.75s.
- Diagnosis: the constrained fixed-contract simulator case terminates normally; the previous non-converging run was caused by unconstrained Vitest worker fan-out, not this depth-4 fixture. No production limit was lowered.
- Focused integration: `npx vitest run src/ai/simulate.test.ts training/pool.test.ts training/benchSummary.test.ts --maxWorkers=1 --minWorkers=1 --fileParallelism=false` — 3 files, 49 tests passed, Vitest duration 5.80s.
- Added a success-path worker assertion that `searchDiagnostics` exactly matches the in-process simulation. Focused pool rerun: 1 file, 10 tests passed, Vitest duration 1.82s.

## Verification

- Exact implementation commit: `446a6d2eba1a97615599bea6749b5eef010ba8e6` (`feat(training): integrate fixed public-state search`).
- Bounded full suite (single execution): `npm test -- --maxWorkers=1 --minWorkers=1 --fileParallelism=false` — 29 files passed; 479 tests passed, 2 skipped; Vitest duration 19.43s; exit 0.
- `npm run typecheck:train` — exit 0.
- `npm run build` — exit 0; 73 modules transformed.
- `git diff --check` — exit 0.
- Exact implementation diff before commit: seven Task 5 files only, 384 insertions and 46 deletions.

## Cross-task compatibility

- `SimTask.depth` and optional `SimTask.search` remain as a temporary type bridge for the still-unmigrated `training/train.ts` call sites owned by Task 8. `WorkerPool` overwrites an omitted search field with `FIXED_SEARCH_LIMITS`, and `worker.ts` passes only `search` to `simulateGame`.
- `simulateGame.depth` remains ignored compatibility metadata until the `training/bench.ts` and `training/pairedBench.ts` call sites owned by Task 9 migrate. Every actual simulation in this Task 5 implementation uses `search`, defaulting to exact `4/64/32`.

## Boundaries

- Did not run training, benchmark, paired benchmark, browser/runtime acceptance, publication, push, or deployment.
- Did not modify, move, delete, archive, or resume `public/ai/`, `training-archive/`, checkpoints, logs, candidate files, or `src/ai/trained-weights.json`.
- Did not edit the SDD ledger.

## Review fix round 1

- Supersedes the first bullet under **Cross-task compatibility**: `SimTask` now requires `search: FixedSearchConfig`, no longer accepts legacy `depth`, and `WorkerPool` forwards the task unchanged without supplying a fallback.
- Migrated both `training/train.ts` producers to pass the exact frozen `FIXED_SEARCH_LIMITS` (`4/64/32`). This is contract propagation only; no training or benchmark command was run.
- Added compile-time assertions for the required `search` field and rejected `depth` field, plus a worker-message assertion that the exact task object is forwarded without rewriting.
- Takeover note: the scoped code/test changes were already present as uncommitted WIP when this fix round began. They were preserved and verified in place; the original RED was not reconstructed by reverting WIP.
- Focused verification: `npx vitest run training/pool.test.ts --maxWorkers=1 --minWorkers=1 --fileParallelism=false` - 1 file, 11 tests passed; `npm run typecheck:train` - exit 0.
- Required full-suite execution (run once): `npm test -- --maxWorkers=1 --minWorkers=1 --fileParallelism=false` - 28 files passed and 2 failed; 482 tests passed, 4 failed, 2 skipped. The scoped pool suite passed 11/11. Failures are in protected concurrent WIP: untracked `src/hooks/useGameLoop.test.ts` imports missing `HoldPiece`/`PiecePreview` modules, while four unchanged simulator parity tests reach the modified `src/store/gameStore.ts` and fail its new public-bag assertion. These paths were not edited in this fix round.
- `npm run build` - failed during TypeScript compilation for the same missing imports in untracked protected `src/hooks/useGameLoop.test.ts`; `npm run typecheck:train` was refreshed separately and exited 0.

## Review fix round 2

- Addressed the supplemental review P1 in `training/pool.test.ts`: the compile-time helper is now a typed zero-argument implementation (`const acceptsSimTask: (task: SimTask) => void = () => {};`). Its declared function type still contextually checks both `@ts-expect-error` calls, preserving the missing-`search` and legacy-`depth` contract assertions without an unused implementation parameter.
- Focused verification: `npx vitest run training/pool.test.ts --maxWorkers=1 --minWorkers=1 --fileParallelism=false` - 1 file, 11 tests passed; `npx eslint training/pool.test.ts` - exit 0; `git diff --check` - exit 0.
- `npm run typecheck:train` was refreshed and is blocked by pre-existing protected WIP outside this round: `training/candidateWeights.ts` expects search diagnostics not supplied by the current evaluation type, and `training/config.ts` / `training/objective.ts` removed `TrainConfig.depth` while `training/runArtifacts.ts`, `training/train-cli.test.ts`, and `training/train.ts` still reference it. No blocked path was edited.
