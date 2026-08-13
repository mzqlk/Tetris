# I4 Fix Round 2 Report

## Scope

Addresses final scoped re-review finding I4 only. `formatSearchDiagnostics`
now emits the independently aggregated `search.minCompletedDepth` as
`search min completed depth <value>`. The existing per-game mean completed
depth distribution line remains unchanged.

## TDD evidence

1. Added the formatter assertion for `search min completed depth 2` to
   `training/benchSummary.test.ts` before changing production code.
2. Ran `npx vitest run training/benchSummary.test.ts` (0.56s): expected RED
   failure. The formatter output had the per-game distribution minimum `3`
   but omitted the separately aggregated global minimum `2`.
3. Added the one formatter line in `training/benchSummary.ts` and reran the
   focused test: 17 passed (0.60s).

## Fresh verification

- `npm test`: 30 files passed; 552 tests passed, 2 skipped (5.56s).
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run typecheck:train`: passed.
- `git diff --check`: passed.

No training, benchmark, paired benchmark, publication, push, merge, or
browser/runtime acceptance command was run. Protected concurrent WIP remains
outside this fix commit.
