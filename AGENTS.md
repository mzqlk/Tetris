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
- Fitness is `meanLines - heightPenalty * meanHeight`; judge training with `eliteH`, distribution statistics, and sigma rather than the lines component alone.
- Do not “fix” saturation by raising the piece cap. Confirm objective behavior with a short run before spending hours on training.
- A new full training run under the combined objective is required before claiming trained weights outperform hand-tuned weights.

## Commands

Run from the repository root:

```powershell
npm test
npm run build
npm run typecheck:train
npm run bench -- --games 30 --depth 2 --max-pieces 2000
```

The benchmark command above uses the built-in handcrafted baseline and does not require a generated weights file. Before any training command, inspect `public/ai/checkpoint.json`, `public/ai/training-log.jsonl`, the objective/config embedded in the checkpoint, and running processes. Explicitly choose resume, archive-and-restart, or a separate output location. Starting without `--resume` while artifacts exist can mix incompatible log generations and overwrite the checkpoint.

Use the shortest relevant command first. Do not start a training run, mutate artifacts, archive a checkpoint, or resume an existing run without explicit user authorization.

## Generated and tracked artifacts

- Training can overwrite tracked `src/ai/trained-weights.json`; inspect `git diff` after every smoke run and do not keep a generated model unintentionally.
- `public/ai/` and `training-archive/` contain run artifacts. Their presence and contents are live state: verify them before every run and never assume an old cap, objective, or “clean directory” note is still true.
- Worker threads require their TypeScript loader configuration; do not remove it as an apparent cleanup.
