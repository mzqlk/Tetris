# Final Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every final-review finding around score-rate-v2 recovery safety, hard-drop pose fidelity, raw clear-count validation, placement stability, AI timer lifecycle, and project entry documentation without running or mutating training artifacts.

**Architecture:** Keep existing module boundaries and tighten validation at trust boundaries. `training/runArtifacts.ts` owns strict checkpoint-plus-log recovery validation before `train.ts` creates a directory or worker; placement enumeration preserves its resting-placement emission/dedup order while indexing pre-drop paths by full piece pose; CEM and benchmark validate raw per-game histograms before averaging; `useAiPlayer` is exercised through its real effect body, Zustand store, and fake timers.

**Tech Stack:** TypeScript 5.6, React 18 hooks, Zustand 5, Node worker_threads, Vitest 3, Vite 6, PowerShell.

## Global Constraints

- Execute inline in the current `master` checkout. The user explicitly forbids subagents, branch changes, worktrees, staging, commits, and pushes.
- Do not run training, smoke, benchmark, fixed reevaluation, or model publication.
- Do not touch `public/ai/**`, `training-archive/**`, or `src/ai/trained-weights.json`.
- Preserve the first nine `FEATURE_NAMES` and append-only tenth `lineClearValue` contract.
- Keep scalar fitness exactly `meanScore / scheduled maxPieces`; clear metrics and mean height remain diagnostic except the existing inclusive 0.1% fixed-reevaluation height tie-break.
- Keep `src/ai/` shared and pure: no Node, DOM, filesystem, or module-level mutable state; never mutate board rows; continue using engine rotation/SRS.
- Every implementation task starts with a focused failing regression test and ends with the shortest relevant green gate.

---

### Task 1: Atomic Resume and Fresh-Run Artifact Gates

**Files:**
- Modify: `training/runArtifacts.ts`
- Modify: `training/runArtifacts.test.ts`
- Modify: `training/train.ts`
- Modify: `training/train-cli.test.ts`

**Interfaces:**
- Produce `readCompatibleRunArtifacts(paths: RunPaths): ScoreRateCheckpoint`, which reads and validates both checkpoint and log without writing.
- Keep `readCompatibleCheckpoint(path)` for focused checkpoint tests.
- Make `assertFreshRun(paths)` reject every non-empty output directory, including an empty `training-log.jsonl` or an unrelated leftover file.

- [ ] **Step 1: Add failing unit tests for fresh-run directory occupancy.**

  Add cases proving an empty log file and an arbitrary leftover file both make `assertFreshRun` throw while an existing empty directory is allowed.

- [ ] **Step 2: Add strict score-rate-v2 log fixtures and failing unit tests.**

  Build valid generation records with generation indices `0..checkpoint.gen-1` and valid reevaluation records at every positive multiple of `checkpoint.config.reevalEvery`. Add mutations for v1 objective, mixed objective, malformed JSON, a non-newline-terminated tail, missing/duplicate/skipped/out-of-order generation, checkpoint generation mismatch, missing expected reevaluation history, and malformed generation/reevaluation schema fields.

- [ ] **Step 3: Run the artifact suite and verify RED.**

  Run: `npm test -- training/runArtifacts.test.ts`

  Expected: failures because only checkpoint validation exists and fresh-run ignores empty/other files.

- [ ] **Step 4: Implement strict read-only log validation.**

  Require an existing regular log file for resume, a final newline, valid nonblank JSONL lines, `objective === 'score-rate-v2'` on every record, complete finite/vector/count schemas, generation coverage exactly `0..checkpoint.gen-1`, and exactly one compatible reevaluation record at every configured interval. Recompute score rates, line totals, tetris shares, comparison deltas, and publication decisions within the existing numeric tolerance.

- [ ] **Step 5: Route resume through the combined gate before side effects.**

  Replace the checkpoint-only call in `training/train.ts` with `readCompatibleRunArtifacts(paths)` before `resolveWorkers`, `mkdirSync`, `new WorkerPool`, signal handlers, append/write calls, or console worker-start output.

- [ ] **Step 6: Add failing-then-green CLI byte-preservation cases.**

  Spawn `training/train.ts --resume --generations 0 --workers 1` against a valid checkpoint plus each invalid-log class. Assert nonzero exit, no `training with ... workers` marker, identical directory entries, and byte-identical files. Add fresh-run cases for an empty log and unrelated file with the same proof.

- [ ] **Step 7: Run the focused green gate.**

  Run: `npm test -- training/runArtifacts.test.ts training/train-cli.test.ts`

---

### Task 2: Full-Pose Hard-Drop Paths and Stable Placement Regression

**Files:**
- Modify: `src/ai/placements.ts`
- Modify: `src/ai/placements.test.ts`
- Modify: `src/hooks/useAiPlayer.ts`
- Modify: `src/hooks/useAiPlayer.test.ts`

**Interfaces:**
- `Placement.piece` stays the original resting pose and order.
- `Placement.moves` becomes the shortest path whose projected hard drop satisfies `samePiece(projected, Placement.piece)`.
- `planPlacement` rejects any target whose projected pose is not `samePiece`.

- [ ] **Step 1: Add failing known-I-pose regressions.**

  On `boardFrom(['....######','....######','.....#####'])`, assert the placements with cell keys `181,182,183,184` and `210,211,212,213` replay plus hard drop to rotation `2` with the exact declared `x/y`, not the cell-equivalent rotation `0` poses.

- [ ] **Step 2: Add three-board by seven-piece ordered stability fixtures.**

  Store a stable per-board/per-type ordered summary containing both `type:rotation:x:y` and `cellKey`. For every entry assert no duplicate `cellKey`, legal move replay, `samePiece(projectHardDrop(endpoint), placement.piece)`, resting position, and unchanged board rows. Keep explicit SRS and roofed-tuck existence assertions.

- [ ] **Step 3: Run placement and plan tests and verify RED.**

  Run: `npm test -- src/ai/placements.test.ts src/hooks/useAiPlayer.test.ts`

  Expected: the two known I placements and complete same-pose invariant fail under cell-only pre-drop lookup.

- [ ] **Step 4: Index and verify pre-drop paths by full pose.**

  Add a private immutable full-pose key containing type, rotation, x, and y. Record the first BFS path for each projected full pose, retrieve using the resting pose key, and throw a placement-specific error if the retrieved projection is not `samePiece`. Do not change candidate expansion order, `seenCells`, `cellKey` dedup, or resting emission.

- [ ] **Step 5: Tighten `planPlacement`.**

  Replace the `cellKey` comparison with `samePiece(projectHardDrop(board, preDrop), decision.placement.piece)` and retain path legality checks.

- [ ] **Step 6: Run the focused green gate.**

  Run: `npm test -- src/ai/placements.test.ts src/ai/search.test.ts src/ai/simulate.test.ts src/hooks/useAiPlayer.test.ts`

---

### Task 3: Raw Per-Game Clear-Count Integer Validation

**Files:**
- Modify: `training/cem.ts`
- Modify: `training/cem.test.ts`
- Modify: `training/benchSummary.ts`
- Modify: `training/benchSummary.test.ts`

**Interfaces:**
- Consume `assertLineClearCounts(counts, true)` at both raw result boundaries.
- Preserve `divideLineClearCounts(..., games)` for finite decimal `meanClearCounts` after raw validation.

- [ ] **Step 1: Add failing table-driven CEM and benchmark tests.**

  For each aggregator, test fractional, `Number.MAX_SAFE_INTEGER + 1`, negative, `NaN`, `Infinity`, and line-total mismatch inputs. Include a valid multi-game case whose averaged counts contain `0.5` and retain the exact scheduled-denominator fitness assertion.

- [ ] **Step 2: Run both suites and verify RED.**

  Run: `npm test -- training/cem.test.ts training/benchSummary.test.ts`

  Expected: fractional histograms with matching reconstructed lines are currently accepted.

- [ ] **Step 3: Validate before reconstruction or aggregation.**

  Call `assertLineClearCounts(result.clearCounts, true)` for every raw worker/benchmark result before `totalLinesFromCounts`, then keep all existing aggregation and fitness arithmetic unchanged.

- [ ] **Step 4: Run the focused green gate.**

  Run: `npm test -- src/ai/lineClears.test.ts src/ai/simulate.test.ts training/pool.test.ts training/cem.test.ts training/benchSummary.test.ts`

---

### Task 4: Real AI Timer and Lifecycle Integration

**Files:**
- Modify: `src/hooks/useAiPlayer.test.ts`
- Modify only if a test exposes a defect: `src/hooks/useAiPlayer.ts`

**Interfaces:**
- Exercise the exported `useAiPlayer` effect body with mocked `useEffect/useRef`, real `useGameStore`, `vi.useFakeTimers()`, and a stubbed `window` timer surface.

- [ ] **Step 1: Add the effect/store/fake-timer harness.**

  Capture the effect cleanup, reset the Zustand store to deterministic board/piece/status values before each case, spy on real store actions, and restore globals/timers/store after each case.

- [ ] **Step 2: Add lifecycle behavior tests before changing runtime code.**

  Cover normal and slow one-action-per-callback cadence; final action plus hard drop in one callback; zero-action and instant single hard drop; gravity pose drift triggering replan; paused/gameover/null-piece idling; cleanup preventing an already scheduled callback; and no duplicate/early/invalid action.

- [ ] **Step 3: Run the hook suite and verify any RED failures.**

  Run: `npm test -- src/hooks/useAiPlayer.test.ts`

- [ ] **Step 4: Make only test-proven lifecycle fixes.**

  Retain the status guard, stale-plan self-healing, one timer owner, same-callback final hard drop, instant termination, and cleanup cancellation.

- [ ] **Step 5: Run the focused green gate.**

  Run: `npm test -- src/hooks/useAiPlayer.test.ts src/store/gameStore.test.ts src/ai/placements.test.ts`

---

### Task 5: Current-v2 Versus Published-v1 Entry Documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] **Step 1: Update only current-contract statements.**

  State code/trainer objective `score-rate-v2`, checkpoint schema `3`, ten features, default `public/ai/score-rate-v2/`, dashboard `/ai/score-rate-v2/training-log.jsonl`, scalar fitness unchanged, and v1 checkpoint/log rejection.

- [ ] **Step 2: Preserve the publication transition boundary.**

  State that bundled/runtime weights remain version `2`, `score-rate-v1`, gen 20; v1 nine-key runtime weights are extended only in memory; do not rewrite historical v1 design evidence.

- [ ] **Step 3: Review the exact documentation diff.**

  Run: `git diff -- AGENTS.md README.md`

---

### Task 6: Code-Only Completion Verification

**Files:**
- Verify all modified paths.
- Protect: `src/ai/trained-weights.json`, `public/ai/**`, `training-archive/**`.

- [ ] **Step 1: Run the full requested code gate.**

  Run in order: `npm test`, `npm run build`, `npm run typecheck:train`, then `npm run lint` because the script exists.

- [ ] **Step 2: Run final Git and protected-path checks.**

  Run: `git status --short --branch`, `git diff --check`, `git diff -- src/ai/trained-weights.json`, `git diff --stat`, and `git diff`.

- [ ] **Step 3: Confirm scope and report acceptance boundary.**

  Confirm no protected artifact changes and report browser manual acceptance, smoke, benchmark, training, fixed reevaluation, publication, and tetris-strategy emergence as not executed/not proven.

---

## Independent Review Follow-up

### Task 7: Replay Recovery State From the Complete Log

**Files:**
- Modify: `training/runArtifacts.ts`
- Modify: `training/runArtifacts.test.ts`
- Modify: `training/train-cli.test.ts`

**Interfaces:**
- `readCompatibleRunArtifacts(paths)` remains read-only and returns the parsed checkpoint only after replaying both scheduled cap and publication winner state.
- A validated reevaluation produces `{ gen, currentBest, candidate, shouldPublish }`; the reducer converts its winner to `ScoreRateBestEver` by adding the checkpoint fixed schedule.
- Recovery equality covers weights, all scalar diagnostics, all four mean clear counts, generation, `evalGames`, and `evalMaxPieces`.

- [ ] **Step 1: Write failing fixed-reevaluation state-machine tests.**

  Add literal two-interval histories that reject a first `currentBest.gen` other than `-1`, a publish winner not forwarded to the next `currentBest`, a keep-current winner not forwarded, a stale/mutated checkpoint `bestEver`, `bestEver: null` after reevaluation, and non-null `bestEver` with no reevaluation. Include one valid publish-then-keep history.

- [ ] **Step 2: Write failing piece-cap replay tests.**

  Starting with `config.initialMaxPieces`, require each generation record's `maxPieces` to equal the replayed cap, then derive the next cap with `nextMaxPieces(current, elitePieces, config.maxPiecesCap)`. Reject a forged per-generation cap and a final checkpoint cap that disagrees with replay; accept unchanged, doubled, and capped transitions.

- [ ] **Step 3: Write the failing empty-log boundary.**

  Pair `checkpoint.gen = 0`, `checkpoint.bestEver = null`, and `checkpoint.maxPieces = config.initialMaxPieces` with a zero-byte log and require rejection before the CLI starts a worker or changes any output entry/byte.

- [ ] **Step 4: Run the focused artifact and CLI tests and verify RED.**

  Run: `npm test -- training/runArtifacts.test.ts training/train-cli.test.ts`

  Expected: the current validator accepts independently valid reevaluations without winner propagation, accepts forged cap history/final cap, and accepts the zero-generation empty log.

- [ ] **Step 5: Implement the minimal deterministic replay reducer.**

  Change generation validation to return its validated `elitePieces` and advance one local `expectedMaxPieces`. Change reevaluation validation to return the complete logged evaluations and computed decision. Fold records in file order, enforcing the initial `-1` baseline and exact prior-winner propagation; finally compare replayed cap and winner to the checkpoint, or require `bestEver === null` when no reevaluation exists.

- [ ] **Step 6: Run the focused green gate.**

  Run: `npm test -- training/runArtifacts.test.ts training/train-cli.test.ts`

---

### Task 8: Hold an Exclusive Trainer Lock Across Preflight and Writes

**Files:**
- Create: `training/runLock.ts`
- Create: `training/runLock.test.ts`
- Modify: `training/train.ts`
- Modify: `training/train-cli.test.ts`

**Interfaces:**
- Export `acquireRunLock(outputDir: string): { release(): void }`.
- Derive a lock filename in `tmpdir()` from a SHA-256 hash of the normalized absolute output path and create it atomically with `openSync(path, 'wx')`.
- Keep release idempotent, register synchronous process-exit cleanup, and never automatically steal an existing lock.

- [ ] **Step 1: Write failing lock ownership tests.**

  Require a second acquisition for the same output directory to fail, different directories to coexist, release to permit reacquisition, and repeated release to be harmless.

- [ ] **Step 2: Write the failing real-CLI contention test.**

  Acquire the production lock in the Vitest process, snapshot a valid resume directory, then spawn `training/train.ts --resume --generations 0 --workers 1`. Require a nonzero exit, no worker-start marker, and identical directory entries and bytes. Release the parent lock in `finally`.

- [ ] **Step 3: Run the lock and CLI tests and verify RED.**

  Run: `npm test -- training/runLock.test.ts training/train-cli.test.ts`

  Expected: the lock module/API does not yet exist and the trainer has no contention gate.

- [ ] **Step 4: Implement the atomic external lock.**

  Store only coordination metadata outside the output directory so failed artifact validation leaves the output unchanged. Convert `EEXIST` into a clear same-output trainer error; retain the original error for other filesystem failures.

- [ ] **Step 5: Hold the lock for the entire trainer lifecycle.**

  Acquire immediately after resolving paths and before checkpoint/log/fresh-run checks. Wrap preflight, directory creation, worker construction, generation loop, final checkpoint, and worker shutdown in `try/finally`; release after pool destruction. Replace the terminal `process.exit(0)` with natural completion so `finally` executes.

- [ ] **Step 6: Run the focused green gate.**

  Run: `npm test -- training/runLock.test.ts training/runArtifacts.test.ts training/train-cli.test.ts`

---

### Task 9: Replace Opaque Placement Hashes With Auditable Ordered Summaries

**Files:**
- Modify: `src/ai/placements.test.ts`

**Interfaces:**
- Store every fixture entry literally as `type:rotation:x:y@cellKey` in emission order for all three boards and seven piece types.
- Derive the expected cell-key list from the literal suffixes and compare it separately to `placements.map(({ piece }) => cellKey(piece))`.

- [ ] **Step 1: Generate the current literal summaries without writing artifacts.**

  Run an inline TypeScript reader over `enumeratePlacements` for the existing `empty`, `roofed`, and `jagged` boards and copy its 21 complete ordered summary lists into the test fixture.

- [ ] **Step 2: Remove the FNV-1a hash helper and hash constants.**

  Compare the complete actual ordered summary array to the literal fixture with assertion labels containing board and piece type. Keep per-placement labels containing board, type, index, pose, and cell key.

- [ ] **Step 3: Preserve the independent invariants.**

  Keep no-duplicate, legal replay, full-pose hard-drop, resting, SRS/tuck, board-value, and board-row-reference checks. This is a test-readability remediation rather than a production behavior change, so no source-grep/change-detector RED test is added.

- [ ] **Step 4: Run the placement green gate.**

  Run: `npm test -- src/ai/placements.test.ts src/ai/search.test.ts src/ai/simulate.test.ts src/hooks/useAiPlayer.test.ts`

---

### Task 10: Repeat Full Verification After Follow-up Fixes

- [ ] **Step 1:** Run `npm test`.
- [ ] **Step 2:** Run `npm run build`.
- [ ] **Step 3:** Run `npm run typecheck:train`.
- [ ] **Step 4:** Run `npm run lint`.
- [ ] **Step 5:** Run the requested Git, diff, and protected-path checks and review the complete diff before reporting readiness.

---

## Second Independent Review Follow-up

### Task 11: Repository-Identity Trainer Lock and Owned Retryable Release

**Files:**
- Modify: `training/runLock.ts`
- Modify: `training/runLock.test.ts`
- Modify: `training/train.ts`
- Modify: `training/train-cli.test.ts`
- Modify: `training/runArtifacts.ts`
- Modify: `training/runArtifacts.test.ts`

**Interfaces:**
- Replace output-path locking with a repository lock keyed by SHA-256 of `realpathSync.native(git rev-parse --git-common-dir)`. Junction, symlink, and host-supported 8.3 behavior are automated; UNC/mapped-drive claims remain capability-gated by Task 17.
- Store a cryptographic owner nonce plus canonical repository identity in the lock file and retain the created file identity from `fstatSync`.
- `release()` verifies both the current directory entry identity and nonce before unlinking, tracks close and unlink independently, and remains retryable until its own entry is removed.
- Recovery requires checkpoint and log paths to be ordinary non-symbolic-link files; fresh nonexistent output tails remain valid because the lock identity comes from existing Git metadata rather than the output path.

- [ ] **Step 1: Write failing repository-identity tests.**

  Assert that the real repository root, a directory junction, and a directory symlink all contend for the same lock. Replace an acquired lock path with another owner's entry and prove the old owner cannot unlink it. Corrupt the nonce without replacing the inode and prove release refuses deletion. Force one unlink failure and prove a later `release()` retries successfully.

- [ ] **Step 2: Write failing CLI/global-publication contention tests.**

  Hold the repository lock, invoke the trainer through real and aliased repository paths with both the same and different output directories, and require rejection before worker construction or any output write. This makes the shared `public/ai/best-weights.json` and `src/ai/trained-weights.json` publication surface mutually exclusive for the full trainer lifetime.

- [ ] **Step 3: Write failing artifact reparse-point tests.**

  Put an otherwise valid checkpoint or training log behind a file symlink and require resume rejection. Keep a non-existent fresh output tail accepted by the preflight path logic.

- [ ] **Step 4: Run the focused RED gate.**

  Run: `npm test -- training/runLock.test.ts training/runArtifacts.test.ts training/train-cli.test.ts`

- [ ] **Step 5: Implement the repository lock and strict artifact file identity.**

  Resolve the Git common directory through Git, canonicalize it with the native realpath implementation, create the temp lock atomically, record nonce and file identity, and conditionally unlink only the still-owned directory entry. Use `lstatSync`/file-descriptor identity checks so checkpoint and log symlinks/reparse points are rejected rather than followed.

- [ ] **Step 6: Run the focused GREEN gate.**

  Run: `npm test -- training/runLock.test.ts training/runArtifacts.test.ts training/train-cli.test.ts`

### Task 12: Generation-Derivation and CLI Generation-Budget Validation

**Files:**
- Modify: `training/runArtifacts.ts`
- Modify: `training/runArtifacts.test.ts`
- Modify: `training/train.ts`
- Modify: `training/train-cli.test.ts`

**Interfaces:**
- Recompute `medianScoreRate` as `medianScore / maxPieces` within the existing numeric tolerance.
- Require `medianPieces` and `elitePieces` to be finite non-negative values no greater than the scheduled `maxPieces`.
- Require both mean and median score rates to lie inclusively between logged worst and best rates.
- Require `--generations` to be a safe integer at least zero, and require a fresh run's explicit generation target to be greater than zero before lock acquisition or output mutation. Resume keeps zero as a read-only no-op target for artifact validation.

- [ ] **Step 1: Write failing generation-field mutation tests.**

  Start from internally consistent literal generation fixtures, then independently forge `medianScoreRate`, `medianPieces`, `elitePieces`, best/mean ordering, best/median ordering, mean/worst ordering, and median/worst ordering.

- [ ] **Step 2: Write failing fresh CLI argument tests.**

  Run fresh commands with generations `0`, `-1`, and `1.5`; require nonzero exit, no worker marker, and no output directory or file creation.

- [ ] **Step 3: Run RED, implement the minimal validation, then run GREEN.**

  Run: `npm test -- training/runArtifacts.test.ts training/train-cli.test.ts`

### Task 13: Failure-Safe Worker Factory and Signal-Ordered Teardown

**Files:**
- Modify: `training/pool.ts`
- Modify: `training/pool.test.ts`
- Modify: `training/train.ts`
- Modify: `training/train-cli.test.ts`

**Interfaces:**
- Replace direct construction with `await WorkerPool.create(size)`. If worker N throws during construction, terminate and await every worker already created before rejecting.
- Preserve the trainer's explicit nested resource order as `repository lock -> preflight -> async pool creation -> run -> pool.destroy() -> lock.release()`.
- The first real `process` SIGINT event requests an orderly stop. A second event only changes the eventual exit code to `1`; it never calls `process.exit()` and therefore cannot bypass pool destruction or lock release.

- [ ] **Step 1: Write the failing partial-construction test.**

  Inject a worker factory that creates real worker threads for the first N-1 slots and throws at N. Require `WorkerPool.create` to reject only after every previously created worker has exited.

- [ ] **Step 2: Write failing one/two-SIGINT lifecycle tests.**

  Start the real trainer on an already-complete resume target and use a preload harness to emit actual `process` SIGINT events at handler registration. Require one signal to request one orderly stop with exit code `0`, two signals to retain cleanup but return exit code `1`, no `process.exit()` call, and event order `destroy` before `release`.

- [ ] **Step 3: Run the focused RED gate.**

  Run: `npm test -- training/pool.test.ts training/train-cli.test.ts`

- [ ] **Step 4: Implement the async factory and signal-safe nested cleanup.**

  Keep worker replacement behavior intact, remove direct `process.exit`, await pool destruction, then release the repository lock.

- [ ] **Step 5: Run the focused GREEN gate.**

  Run: `npm test -- training/pool.test.ts training/train-cli.test.ts`

### Task 14: Final Code-Only Verification After Second Follow-up

- [ ] **Step 1:** Run `npm test`.
- [ ] **Step 2:** Run `npm run build`.
- [ ] **Step 3:** Run `npm run typecheck:train`.
- [ ] **Step 4:** Run `npm run lint`.
- [ ] **Step 5:** Run `git status --short --branch`, `git diff --check`, `git diff -- src/ai/trained-weights.json`, protected-path name checks, `git diff --stat`, and inspect the complete `git diff` before reporting readiness.

---

## Third Independent Review Follow-up

### Task 15: Make Resume Generation Zero a Strict Read-Only Probe

**Files:**
- Modify: `training/train.ts`
- Modify: `training/train-cli.test.ts`

**Interfaces:**
- `--resume --generations 0` acquires the repository lock and validates the complete checkpoint/log pair, then exits successfully from inside the lock scope.
- The early exit occurs before worker-count resolution, output-directory creation, worker construction, signal installation, console worker markers, checkpoint/log writes, or publication writes.
- Releasing the repository lock is the only write-side cleanup; a following owner can immediately reacquire it.

- [ ] **Step 1: Write the failing legal-resume CLI regression.**

  Create a valid generation-one checkpoint/log plus an unrelated sentinel, snapshot all directory entries and bytes, run resume generation zero with a deliberately different `--workers`, and require exit `0`, no worker marker, byte-identical output, and successful lock reacquisition.

- [ ] **Step 2: Run RED.**

  Run: `npm test -- training/train-cli.test.ts -t "generation-zero resume probe"`

- [ ] **Step 3: Add the post-validation early return and run GREEN.**

  Keep the return inside the outer lock `try/finally` so repository lock release is guaranteed.

### Task 16: Reject a Run When Replacement Worker Construction Fails

**Files:**
- Modify: `training/pool.ts`
- Modify: `training/pool.test.ts`

**Interfaces:**
- If a live worker dies and replacement construction or listener attachment throws, the current `run()` promise rejects with that error exactly once.
- No further queue feeding or replacement attempt occurs after settlement; the surviving workers remain owned by the pool and `destroy()` can terminate all of them.
- Trainer cleanup remains the existing `pool.destroy() -> runLock.release()` chain because the pool failure is a normal promise rejection rather than an uncaught event callback exception.
- A real CLI runtime-failure test uses a locked checkpoint write on an already-complete resume target to prove the same rejection path destroys the worker before releasing the lock without running a generation.

- [ ] **Step 1: Write the failing runtime-replacement regression.**

  Build the pool with real workers, make the factory throw only on the first replacement, start a real task batch, emit a worker error, and require `pool.run()` rejection without an uncaught exception. In `finally`, destroy the pool and prove every created worker exits.

- [ ] **Step 2: Run RED.**

  Run: `npm test -- training/pool.test.ts -t "replacement construction fails"`

- [ ] **Step 3: Catch replacement setup failure and run GREEN.**

  Settle once, reject the active run, and leave all currently owned workers reachable for `destroy()`.

### Task 17: Test Real 8.3 Aliases and Bound UNC/Mapped-Drive Claims

**Files:**
- Modify: `training/runLock.test.ts`
- Modify: `training/train-cli.test.ts`
- Modify: `docs/superpowers/plans/2026-08-07-final-review-remediation.md`

**Interfaces:**
- On Windows, obtain an actual short path with Win32 `GetShortPathNameW`; when the volume exposes a distinct alias, the long and short repository paths must contend for one lock.
- Optional real UNC and mapped-drive aliases are accepted through `TETRIS_TEST_REPOSITORY_UNC_ALIAS` and `TETRIS_TEST_REPOSITORY_MAPPED_ALIAS`. Tests explicitly skip with actionable reasons when no such host capability is configured.
- Automated readiness claims cover junction, symlink, and 8.3 on this host. UNC and mapped-drive behavior remain manual/capability-gated unless their tests actually run.

- [ ] **Step 1: Add the real Windows 8.3 contention test.**

  Call `GetShortPathNameW` through a PowerShell P/Invoke helper, assert the returned path is a distinct alias, and prove it cannot acquire while the long-path owner holds the repository lock.

- [ ] **Step 2: Add explicit UNC/mapped capability tests.**

  Run contention through configured aliases when present; otherwise emit skipped tests whose names state the required environment variable and manual boundary.

- [ ] **Step 3: Run the focused alias suite.**

  Run: `npm test -- training/runLock.test.ts training/train-cli.test.ts`

### Task 18: Final Verification After Third Follow-up

- [ ] **Step 1:** Run `npm test`.
- [ ] **Step 2:** Run `npm run build`.
- [ ] **Step 3:** Run `npm run typecheck:train`.
- [ ] **Step 4:** Run `npm run lint`.
- [ ] **Step 5:** Run the complete Git, protected-path, and full-diff audit without staging, committing, or pushing.
