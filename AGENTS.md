# Tetris project instructions

## Before changing AI or training

- Read `docs/ai-training-handoff.md` before touching `src/ai/`, `training/`, checkpoints, or trained weights.
- Browser AI and the Node training system share the same pure logic in `src/ai/`; do not create a second training-only implementation.
- Keep `src/ai/` free of Node, DOM, filesystem, and module-level mutable state, except the documented browser-only `loadWeights.ts`.
- Treat `FEATURE_NAMES` order as part of the weight-file contract.
- Do not mutate board rows in place; engine operations can share row-array references.
- Placement enumeration must use the engine rotation/SRS behavior.

## Training objective

- Competent candidates can survive to the piece cap, so raw lines cleared saturates near the arithmetic ceiling and cannot rank elites.
- `meanLines - heightPenalty * meanHeight` was the retired `lines-height-v1` objective. Do not resume its checkpoint or describe it as the current fitness.
- The active code/trainer contract is `score-rate-v5`: checkpoint schema version 6, exact 13 `FEATURE_NAMES` in the unchanged order, and `bag-expectimax-hold-v2` fixed depth 4 with root/child beams 64/32, frozen `maxWorkUnits = 3584`, and `budget-corpus-v1`. Scalar fitness is exactly `meanScore / maxPieces`, using the scheduled piece cap rather than survived pieces. `meanHeight` is diagnostic and only the tie-breaker when fixed-reevaluation scores are within the inclusive 0.1% tolerance.
- Which model is currently published is live state, not a fact this file can pin. Read it from `docs/ai-training-handoff.md` and verify it on the spot; a stale claim here has already been wrong once. Compatibility loading may extend a shorter historical weight vector in memory only, and must never rewrite a published file as a side effect of loading it.
- `score-rate-v1`/`score-rate-v2`/`score-rate-v3`/`score-rate-v4` checkpoints and logs are historical artifacts. The v5 trainer must never resume or append to them.
- Judge training from the score-rate distribution and sigma, not only a generation's `bestScoreRate`.
- Do not “fix” saturation by raising the piece cap. Confirm objective behavior with a short run before spending hours on training.
- A fixed reevaluation can publish against the current best, but it does not prove superiority over a separate baseline. Any such claim requires an independent paired benchmark with identical seeds, depth, and piece cap; see `docs/ai-training-handoff.md` for the gen 20 publication evidence.

## Commands

Run from the repository root:

```powershell
npm test
npm run build
npm run typecheck:train
npm run bench -- --games 30 --max-pieces 2000
```

The benchmark command above uses the built-in handcrafted baseline and does not require a generated weights file. Bench uses the active `bag-expectimax-hold-v2` depth 4 with beams 64/32 and frozen budget 3584; there is no user-selectable `--depth` flag. Before any training command, inspect the selected output directory (default `public/ai/score-rate-v5/`), its checkpoint and log, the objective/config embedded in the checkpoint, the published weight files, and running processes. The dashboard reads `/ai/score-rate-v5/training-log.jsonl`. Explicitly choose resume, archive-and-restart, or a separate output location. Starting without `--resume` while any output-directory entry exists is rejected; never work around that guard by deleting or moving artifacts without authorization.

Before the next user-run one-generation smoke, perform a fresh process, lock, and artifact inspection and have the operator confirm that `public/ai/score-rate-v5/` is empty. Only then may the operator run `npm run train -- --generations 1 --output-dir public/ai/score-rate-v5`; the assistant must not execute that smoke. One generation is a signal gate only, not training completion, publication evidence, benchmark evidence, or browser/runtime acceptance.

Calibration is a separate read-only gate and is neither training nor benchmark or browser acceptance:

```powershell
npm run calibrate:search -- --select
npm run calibrate:search -- --verify-frozen
npm test
npm run lint
npm run build
npm run typecheck:train
```

The first SIGINT marks shutdown and aborts the in-flight generation/reevaluation; partial results are discarded, no CEM/log update is made, and the last complete boundary is checkpointed before the pool and lock are released. A fresh gen-0 interruption saves an initial gen-0 checkpoint; resuming with the same seed reruns the complete gen 0. A stale lock is never deleted automatically because a PID can be reused; removal requires refreshed PID/process/lock evidence and explicit operator authorization.

Use the shortest relevant command first. Do not start a training run, mutate artifacts, archive a checkpoint, or resume an existing run without explicit user authorization.

## Generated and tracked artifacts

- Training can overwrite tracked `src/ai/trained-weights.json`; inspect `git diff` after every smoke run and do not keep a generated model unintentionally.
- `public/ai/` and `training-archive/` contain run artifacts. Their presence and contents are live state: verify them before every run and never assume an old cap, objective, or “clean directory” note is still true.
- Worker threads require their TypeScript loader configuration; do not remove it as an apparent cleanup.
