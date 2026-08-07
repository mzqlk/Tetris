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
- The current code/trainer contract is `score-rate-v2`: checkpoint schema version 3 and ten `FEATURE_NAMES`, with `lineClearValue` in the tenth position. Scalar fitness is still exactly `meanScore / maxPieces`, using the scheduled piece cap rather than survived pieces. `meanHeight` is diagnostic and is only the tie-breaker when fixed-reevaluation scores are within the inclusive 0.1% tolerance.
- The currently published bundled/runtime model remains the version 2, `score-rate-v1` gen-20 model. Its nine weights are extended only in memory with `lineClearValue = 0`; do not rewrite the published file during compatibility loading.
- `score-rate-v1` checkpoints and logs are legacy artifacts. A v2 trainer must never resume them or append to their logs.
- Judge training from the score-rate distribution and sigma, not only a generation's `bestScoreRate`.
- Do not “fix” saturation by raising the piece cap. Confirm objective behavior with a short run before spending hours on training.
- A fixed reevaluation can publish against the current best, but it does not prove superiority over a separate baseline. Any such claim requires an independent paired benchmark with identical seeds, depth, and piece cap; see `docs/ai-training-handoff.md` for the gen 20 publication evidence.

## Commands

Run from the repository root:

```powershell
npm test
npm run build
npm run typecheck:train
npm run bench -- --games 30 --depth 2 --max-pieces 2000
```

The benchmark command above uses the built-in handcrafted baseline and does not require a generated weights file. Before any training command, inspect the selected output directory (default `public/ai/score-rate-v2/`), its checkpoint and log, the objective/config embedded in the checkpoint, the published weight files, and running processes. The dashboard reads `/ai/score-rate-v2/training-log.jsonl`. Explicitly choose resume, archive-and-restart, or a separate output location. Starting without `--resume` while any output-directory entry exists is rejected; never work around that guard by deleting or moving artifacts without authorization.

Use the shortest relevant command first. Do not start a training run, mutate artifacts, archive a checkpoint, or resume an existing run without explicit user authorization.

## Generated and tracked artifacts

- Training can overwrite tracked `src/ai/trained-weights.json`; inspect `git diff` after every smoke run and do not keep a generated model unintentionally.
- `public/ai/` and `training-archive/` contain run artifacts. Their presence and contents are live state: verify them before every run and never assume an old cap, objective, or “clean directory” note is still true.
- Worker threads require their TypeScript loader configuration; do not remove it as an apparent cleanup.
