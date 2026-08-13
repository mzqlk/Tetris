# Final fix wave report

## Scope

This single final-fix wave addressed every Important finding in
`whole-branch-review-round2.md`, both listed Minors, and the deferred spent-Hold
regression. The committed review baseline was `4166303` (full SHA verified as
`41663038cc65c84853ad1ced35a2e25302133e85`).

Protected work-in-progress was preserved and excluded from this wave:

- `training/publication.ts`
- `training/runArtifacts.ts`
- `training/runArtifacts.test.ts`
- `.superpowers/sdd/progress.md`
- `task-10-review.md`

No train, bench, paired benchmark, publication, push, merge, browser, or
runtime-acceptance command was run.

## Findings addressed

1. Search survival ordering now normalizes probabilities at 0 and 1 and uses a
   documented `1e-12` epsilon. The tolerance is far below the minimum genuine
   depth-four seven-bag path gap (`1/840`), so accumulation noise enters the
   heuristic tie-break while a real probability difference remains survival
   first. Regressions cover alternate accumulation paths and the smallest real
   depth-four gap.
2. Simulator Hold diagnostics now count only Holds that complete a valid cycle;
   a Hold that immediately causes spawn gameover is not added to the locked-piece
   denominator. Direct zero-lock and prior-lock terminal regressions verify
   bounded, internally consistent `holdActions`/`holdRate` and successful
   `aggregateFitness` handling.
3. `AGENTS.md`, `README.md`, and `docs/ai-training-handoff.md` now document the
   active `score-rate-v4`/schema-5 contract, default `public/ai/score-rate-v4/`,
   fixed `bag-expectimax-hold-v1` depth 4 with beams 64/32, and unchanged
   published version-3 `score-rate-v2` gen-40. Removed `--depth` commands and
   stale active 1/2-ply wording are corrected; legacy helpers are labeled as
   compatibility-only. Static tests verify documented bench commands are
   `parseBenchArgs`-parseable and contain no `--depth`.
4. Added a pure `formatSearchDiagnostics` formatter and wired it into bench CLI
   output. Tests assert Hold count/rate, completed-depth distribution and global
   minimum, decision/chance nodes, cache hits, and aborts are all emitted.
5. `buildCandidateWeights` now accepts only literal depth `4` and fails closed
   for legacy `1`/`2`; misuse regressions cover both values.
6. Added the direct unavailable/spent-Hold state-transition regression with
   input immutability assertions.

## Verification

Focused final-fix tests:

```text
npx vitest run src/ai/search.test.ts src/ai/simulate.test.ts src/ai/stateTransitions.test.ts training/candidateWeights.test.ts training/benchSummary.test.ts
5 files passed, 83 tests passed
```

Fresh code-only gates:

```text
npm test                  PASS — 30 files, 552 passed, 2 skipped
npm run lint              PASS
npm run build             PASS
npm run typecheck:train   PASS
git diff --check          PASS
```

## Commit

Implementation commit: `d547cc4452f8cfc29ade08b64dcf551711e37c11`
(`fix(ai): close bag-aware search review findings`).

Exact implementation scope:

```text
AGENTS.md
README.md
docs/ai-training-handoff.md
src/ai/search.test.ts
src/ai/search.ts
src/ai/simulate.test.ts
src/ai/simulate.ts
src/ai/stateTransitions.test.ts
training/bench.ts
training/benchSummary.test.ts
training/benchSummary.ts
training/candidateWeights.test.ts
training/candidateWeights.ts
```

This report is committed separately as the only path in its report commit so
the implementation SHA can be recorded without self-reference. Both commits
exclude every protected WIP path.

## Not performed

Per the final-fix boundary, no training run, benchmark execution, paired
benchmark, artifact publication, push/merge, browser acceptance, or runtime
acceptance was performed. Passing code-only gates do not establish those
operational outcomes.
