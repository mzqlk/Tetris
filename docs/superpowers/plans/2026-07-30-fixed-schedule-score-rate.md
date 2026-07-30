# Fixed-Schedule Score-Rate Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the saturated lines/height CEM objective with fixed-schedule score rate, isolate its run artifacts, and publish only models that win a fixed 30-game × 5000-piece score reevaluation.

**Architecture:** Keep simulation and search in the existing shared pure `src/ai/` implementation. Add a small shared objective contract, make CEM aggregate raw score with the scheduled piece cap as a common denominator, and keep checkpoint/output safety in a Node-only boundary around `training/train.ts`. Long-game publication compares fixed-seed `meanScore` first and uses `meanHeight` only inside the approved 0.1% near-tie band.

**Tech Stack:** TypeScript 5.6, Node.js worker threads, React 18, Vite 6, Vitest 3, PowerShell.

## Global Constraints

- Training objective ID is exactly `score-rate-v1`.
- Fitness is exactly `meanScore / maxPieces`; the denominator is the scheduled cap, never actual survived pieces.
- `meanHeight` is diagnostic during training and only a secondary publication tiebreaker.
- Publication reevaluation is exactly 30 games × 5000 scheduled pieces and ranks by `meanScore`.
- Scores whose difference is at most 0.1% of the larger absolute `meanScore` are a near tie; only then may lower `meanHeight` win.
- Default run artifacts live under `public/ai/score-rate-v1/`; checkpoint and every log entry carry the objective ID.
- Missing or different objective IDs must reject `--resume` before worker creation or artifact writes.
- A fresh run must reject an existing checkpoint or non-empty log instead of overwriting or appending.
- Preserve all unrelated user changes. Never modify or stage `AGENTS.md` or `docs/ai-training-handoff.md`.
- Do not start or resume training, archive old artifacts, or modify `public/ai/checkpoint.json` and `public/ai/training-log.jsonl` while implementing this plan.
- Keep `src/ai/` free of Node, DOM, filesystem, and module-level mutable state.
- Preserve `FEATURE_NAMES` ordering and use the existing simulator/worker path; do not create training-only game logic.
- The intentional `src/ai/trained-weights.json` change is metadata-only until an authorized training run publishes a model; its nine weight values must remain byte-for-byte numerically identical.
- Final verification commands, in order, are `npm test`, `npm run typecheck:train`, and `npm run build`.

## File Structure

- Create `src/ai/trainingObjective.ts`: browser/Node-safe objective ID type shared by weights, trainer, and dashboard.
- Create `training/objective.ts`: Node-training constants for the score tie band and fixed publication schedule.
- Modify `src/ai/weights.ts` and `src/ai/trained-weights.json`: nullable score metadata with legacy compatibility.
- Modify `training/publication.ts`: fixed seeds and score-first publication comparison.
- Create `training/runArtifacts.ts`: run-directory resolution, fresh-run collision guard, and checkpoint objective validation.
- Modify `training/cem.ts`, `training/config.ts`, `training/train.ts`, and `training/pool.ts`: score-rate selection, score logs, fixed reevaluation, and isolated artifacts.
- Create `training/benchSummary.ts`: pure benchmark aggregation used by `training/bench.ts`.
- Modify `src/training/dashboard/`: new score-rate log schema, chart, and metrics.
- Add or modify adjacent `*.test.ts` files for each behavioral boundary.

## Execution Baseline

Before Task 1, run these read-only checks again because HEAD, processes, and ignored artifacts are live state:

```powershell
git rev-parse HEAD
git status --short --branch
git diff -- src/ai/trained-weights.json
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId,
    @{n='CPUsec';e={[math]::Round((Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).CPU,1)}},
    @{n='MemMB';e={[math]::Round($_.WorkingSetSize/1MB,0)}},CommandLine
Get-FileHash -Algorithm SHA256 public/ai/checkpoint.json,public/ai/training-log.jsonl
```

Expected before implementation: user changes remain limited to the already-observed `docs/ai-training-handoff.md` and untracked `AGENTS.md`; no training process is writing artifacts; `src/ai/trained-weights.json` has no pre-existing diff. If any of those observations changed, stop and re-establish ownership before editing.

---

### Task 1: Shared objective and backward-compatible weight metadata

**Files:**
- Create: `src/ai/trainingObjective.ts`
- Create: `training/objective.ts`
- Modify: `src/ai/weights.test.ts`
- Modify: `src/ai/weights.ts`
- Modify: `src/ai/trained-weights.json`

**Interfaces:**
- Produces: `SCORE_RATE_OBJECTIVE: 'score-rate-v1'` and `ScoreRateObjective`.
- Produces: `SCORE_TIE_RELATIVE_TOLERANCE`, `PUBLICATION_GAMES`, and `PUBLICATION_MAX_PIECES`.
- Produces: `WeightsFile.objective: string | null`, `meanScore: number | null`, and `evalMaxPieces: number | null`.
- Preserves: old weights files without the three new metadata fields parse successfully.

- [ ] **Step 1: Write failing weight-metadata tests**

Add these cases inside `describe('parseWeightsFile')` in `src/ai/weights.test.ts`:

```ts
it('carries score-goal metadata from a newly published file', () => {
  const parsed = parseWeightsFile({
    ...valid,
    version: 2,
    objective: 'score-rate-v1',
    meanScore: 123456.5,
    evalMaxPieces: 5000,
  });

  expect(parsed).toMatchObject({
    version: 2,
    objective: 'score-rate-v1',
    meanScore: 123456.5,
    evalMaxPieces: 5000,
  });
});

it('normalises score metadata to null for a legacy weights file', () => {
  const parsed = parseWeightsFile(valid);
  expect(parsed).not.toBeNull();
  expect(parsed!.objective).toBeNull();
  expect(parsed!.meanScore).toBeNull();
  expect(parsed!.evalMaxPieces).toBeNull();
});

it('does not turn malformed score metadata into a false numeric baseline', () => {
  const parsed = parseWeightsFile({
    ...valid,
    objective: 7,
    meanScore: '123456',
    evalMaxPieces: Number.NaN,
  });
  expect(parsed).toMatchObject({ objective: null, meanScore: null, evalMaxPieces: null });
});
```

Production mutation caught: deleting the new metadata fields from the parser, or coercing a missing/invalid `meanScore` to zero, makes these assertions fail.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- src/ai/weights.test.ts
```

Expected: FAIL because `WeightsFile`/`parseWeightsFile` do not expose `objective`, `meanScore`, or `evalMaxPieces`.

- [ ] **Step 3: Add the shared objective contracts**

Create `src/ai/trainingObjective.ts`:

```ts
/** Schema/fitness identity shared by trainer, weights metadata, and dashboard. */
export const SCORE_RATE_OBJECTIVE = 'score-rate-v1' as const;
export type ScoreRateObjective = typeof SCORE_RATE_OBJECTIVE;
```

Create `training/objective.ts`:

```ts
export { SCORE_RATE_OBJECTIVE } from '../src/ai/trainingObjective';

/** Height may break a publication tie only inside this relative score band. */
export const SCORE_TIE_RELATIVE_TOLERANCE = 0.001;

/** Every publish decision uses this fixed long-game schedule. */
export const PUBLICATION_GAMES = 30;
export const PUBLICATION_MAX_PIECES = 5000;
```

- [ ] **Step 4: Implement nullable metadata parsing**

Extend `WeightsFile` in `src/ai/weights.ts` and its returned value:

```ts
export interface WeightsFile {
  version: number;
  weights: Weights;
  objective: string | null;
  meanScore: number | null;
  evalMaxPieces: number | null;
  meanLines: number;
  meanHeight: number;
  evalGames: number;
  gen: number;
  searchDepth: 1 | 2;
  trainedAt: string;
}

const nullableNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

return {
  version: num(d.version, 1),
  weights,
  objective: typeof d.objective === 'string' ? d.objective : null,
  meanScore: nullableNum(d.meanScore),
  evalMaxPieces: nullableNum(d.evalMaxPieces),
  meanLines: num(d.meanLines, 0),
  meanHeight: num(d.meanHeight, 0),
  evalGames: num(d.evalGames, 0),
  gen: num(d.gen, 0),
  searchDepth: d.searchDepth === 1 ? 1 : 2,
  trainedAt: typeof d.trainedAt === 'string' ? d.trainedAt : '',
};
```

Keep `nullableNum` inside `parseWeightsFile`; no module-level mutable state is introduced.

- [ ] **Step 5: Mark the current model as an unmeasured legacy objective without changing weights**

Change only metadata in `src/ai/trained-weights.json`:

```json
{
  "version": 2,
  "weights": {
    "aggregateHeight": -0.3738787961463946,
    "holes": -0.20057166489064943,
    "bumpiness": -0.049717134366511845,
    "maxHeight": -0.3501786915010095,
    "linesCleared": 0.17388534204258943,
    "landingHeight": -0.5826913047737593,
    "rowTransitions": -0.3379553050795108,
    "colTransitions": -0.42490105942251594,
    "wellDepth": -0.17426639446021316
  },
  "objective": "lines-height-v1",
  "meanScore": null,
  "evalMaxPieces": 5000,
  "meanLines": 1998.4,
  "meanHeight": 3.10,
  "evalGames": 30,
  "gen": 20,
  "searchDepth": 2,
  "trainedAt": "2026-07-29T12:24:19.000Z"
}
```

The nine values under `weights` must not change.

- [ ] **Step 6: Run focused tests and inspect the model diff**

Run:

```powershell
npm test -- src/ai/weights.test.ts
git diff -- src/ai/trained-weights.json
```

Expected: weights tests PASS; the JSON diff contains schema/metadata lines only and no changed numeric weight value.

- [ ] **Step 7: Commit only Task 1 paths**

```powershell
git add -- src/ai/trainingObjective.ts training/objective.ts src/ai/weights.ts src/ai/weights.test.ts src/ai/trained-weights.json
git diff --cached --name-status
git diff --cached --check
git commit -m "feat(training): add score-rate weight metadata"
```

Expected staged paths: exactly the five paths listed above; never `AGENTS.md` or `docs/ai-training-handoff.md`.

---

### Task 2: Score-first long-game publication policy

**Files:**
- Modify: `training/publication.test.ts`
- Modify: `training/publication.ts`

**Interfaces:**
- Consumes: constants from `training/objective.ts`.
- Produces: `ReevaluationSummary` with `meanScore`, `scoreRate`, `meanLines`, and `meanHeight`.
- Produces: `shouldPublishScoreReevaluation(candidate, currentBest): boolean`.
- Produces: `fixedReevaluationSeeds(baseSeed, games): number[]`, independent of generation.

- [ ] **Step 1: Replace legacy publication tests with score-first cases**

Write `training/publication.test.ts` around this literal helper and cases:

```ts
import { describe, expect, it } from 'vitest';
import {
  fixedReevaluationSeeds,
  shouldPublishScoreReevaluation,
  type ReevaluationSummary,
} from './publication';

const summary = (meanScore: number, meanHeight: number): ReevaluationSummary => ({
  meanScore,
  scoreRate: meanScore / 5000,
  meanLines: 1998,
  meanHeight,
});

describe('shouldPublishScoreReevaluation', () => {
  it('prefers a materially higher fixed-schedule score even with worse height', () => {
    expect(shouldPublishScoreReevaluation(
      summary(1002, 8),
      summary(1000, 3),
    )).toBe(true);
  });

  it('rejects a materially lower score even with better height', () => {
    expect(shouldPublishScoreReevaluation(
      summary(998, 2),
      summary(1000, 8),
    )).toBe(false);
  });

  it('uses lower height inside the approved 0.1 percent near-tie band', () => {
    expect(shouldPublishScoreReevaluation(
      summary(1000.5, 3),
      summary(1000, 4),
    )).toBe(true);
  });

  it('does not publish a less tidy candidate inside the near-tie band', () => {
    expect(shouldPublishScoreReevaluation(
      summary(1000.5, 5),
      summary(1000, 4),
    )).toBe(false);
  });
});

describe('fixedReevaluationSeeds', () => {
  it('returns the same schedule whenever the base seed is the same', () => {
    expect(fixedReevaluationSeeds(20260727, 30))
      .toEqual(fixedReevaluationSeeds(20260727, 30));
    expect(fixedReevaluationSeeds(20260727, 30)).toHaveLength(30);
  });

  it('changes the schedule when the run base seed changes', () => {
    expect(fixedReevaluationSeeds(1, 3)).not.toEqual(fixedReevaluationSeeds(2, 3));
  });
});
```

Production mutations caught: comparing height before score, widening/narrowing the 0.1% boundary, or adding generation to reevaluation seeds breaks these tests.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
npm test -- training/publication.test.ts
```

Expected: FAIL because the score-first function and fixed seed helper do not exist.

- [ ] **Step 3: Implement the new publication contract**

Add to `training/publication.ts`:

```ts
import { hashSeed } from '../src/ai/rng';
import { SCORE_TIE_RELATIVE_TOLERANCE } from './objective';

const REEVALUATION_STREAM = 0x5eed;

export interface ReevaluationSummary {
  meanScore: number;
  scoreRate: number;
  meanLines: number;
  meanHeight: number;
}

export function fixedReevaluationSeeds(baseSeed: number, games: number): number[] {
  return Array.from({ length: games }, (_, game) =>
    hashSeed(baseSeed ^ REEVALUATION_STREAM, game));
}

export function shouldPublishScoreReevaluation(
  candidate: ReevaluationSummary,
  currentBest: ReevaluationSummary,
): boolean {
  const scale = Math.max(Math.abs(candidate.meanScore), Math.abs(currentBest.meanScore));
  const tolerance = SCORE_TIE_RELATIVE_TOLERANCE * scale;

  if (candidate.meanScore > currentBest.meanScore + tolerance) return true;
  if (candidate.meanScore < currentBest.meanScore - tolerance) return false;
  return candidate.meanHeight < currentBest.meanHeight;
}
```

Keep the old exported `shouldPublishReevaluation` temporarily so `training/train.ts` remains compilable until Task 3 switches callers. Task 3 deletes the legacy interface/function in the same commit that switches the trainer.

- [ ] **Step 4: Run the focused test and verify GREEN**

```powershell
npm test -- training/publication.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit only the publication paths**

```powershell
git add -- training/publication.ts training/publication.test.ts
git diff --cached --name-status
git diff --cached --check
git commit -m "feat(training): compare long-game score before height"
```

---

### Task 3: Score-rate CEM, isolated checkpoints, and fixed reevaluation orchestration

**Files:**
- Create: `training/runArtifacts.test.ts`
- Create: `training/runArtifacts.ts`
- Create: `training/reevaluation.test.ts`
- Create: `training/reevaluation.ts`
- Create: `training/train-cli.test.ts`
- Modify: `training/cem.test.ts`
- Modify: `training/cem.ts`
- Modify: `training/config.test.ts`
- Modify: `training/config.ts`
- Modify: `training/train.ts`
- Modify: `training/pool.ts`
- Modify: `src/ai/simulate.ts`
- Modify: `training/publication.ts`

**Interfaces:**
- Consumes: `SCORE_RATE_OBJECTIVE`, `PUBLICATION_GAMES`, `PUBLICATION_MAX_PIECES`.
- Consumes: `shouldPublishScoreReevaluation`, `fixedReevaluationSeeds`, `DEFAULT_WEIGHTS`, and `DEFAULT_WEIGHTS_META`.
- Produces: `CandidateStats.meanScore` and `fitness = meanScore / maxPieces`.
- Produces: checkpoint schema `{ version: 2, objective: 'score-rate-v1', ... }`.
- Produces: `resolveRunPaths`, `assertFreshRun`, and `readCompatibleCheckpoint`.
- Produces: `planReevaluation` so an empty score baseline evaluates published weights before `mu`.
- Produces: score-rate log fields consumed by Task 5 dashboard work.

- [ ] **Step 1: Rewrite CEM aggregate tests for raw score and the scheduled denominator**

In `training/cem.test.ts`, replace the `aggregateFitness` fixture/cases with score-bearing results and these core assertions:

```ts
describe('aggregateFitness', () => {
  const results = [
    { score: 900, lines: 10, pieces: 100, meanHeight: 4 },
    { score: 1500, lines: 20, pieces: 200, meanHeight: 6 },
    { score: 600, lines: 1, pieces: 20, meanHeight: 8 },
    { score: 900, lines: 3, pieces: 30, meanHeight: 10 },
  ];

  it('aggregates mean score and diagnostics candidate by candidate', () => {
    const stats = aggregateFitness(results, 2, 2, 300);
    expect(stats.meanScore).toEqual([1200, 750]);
    expect(stats.meanLines).toEqual([15, 2]);
    expect(stats.meanPieces).toEqual([150, 25]);
    expect(stats.meanHeight).toEqual([5, 9]);
  });

  it('uses meanScore divided by the scheduled maxPieces as fitness', () => {
    const stats = aggregateFitness(results, 2, 2, 300);
    expect(stats.fitness).toEqual([4, 2.5]);
  });

  it('keeps height diagnostic instead of subtracting it from fitness', () => {
    const tidy = { score: 900, lines: 10, pieces: 300, meanHeight: 2 };
    const messy = { score: 900, lines: 10, pieces: 300, meanHeight: 18 };
    const stats = aggregateFitness([tidy, messy], 2, 1, 300);
    expect(stats.fitness).toEqual([3, 3]);
    expect(stats.meanHeight).toEqual([2, 18]);
  });

  it('does not reward an early death by dividing by actual survived pieces', () => {
    const quitter = { score: 600, lines: 1, pieces: 20, meanHeight: 3 };
    const survivor = { score: 1200, lines: 100, pieces: 300, meanHeight: 9 };
    const { fitness } = aggregateFitness([quitter, survivor], 2, 1, 300);

    expect(quitter.score / quitter.pieces).toBeGreaterThan(survivor.score / survivor.pieces);
    expect(fitness[1]).toBeGreaterThan(fitness[0]);
    expect(fitness).toEqual([2, 4]);
  });

  it('rejects a non-positive scheduled piece cap', () => {
    expect(() => aggregateFitness(results, 2, 2, 0)).toThrow(/maxPieces/);
  });
});
```

Retain the existing row-major attribution, result-count, and single-game cases, but add literal `score` fields and pass a positive `maxPieces` argument.

- [ ] **Step 2: Add failing config-contract tests**

Replace the obsolete `heightPenalty` test in `training/config.test.ts` with:

```ts
it('uses the fixed publication schedule required by the score objective', () => {
  expect(DEFAULT_CONFIG.reevalGames).toBe(30);
  expect(DEFAULT_CONFIG.reevalMaxPieces).toBe(5000);
});
```

- [ ] **Step 3: Add failing run-artifact unit tests**

Create `training/runArtifacts.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertFreshRun,
  readCompatibleCheckpoint,
  resolveRunPaths,
} from './runArtifacts';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tetris-score-rate-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolveRunPaths', () => {
  it('defaults to the versioned score-rate directory', () => {
    const paths = resolveRunPaths('D:/repo', null);
    expect(paths.outputDir.replaceAll('\\', '/')).toBe('D:/repo/public/ai/score-rate-v1');
  });
});

describe('readCompatibleCheckpoint', () => {
  it('accepts the current checkpoint schema and objective', () => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify({ version: 2, objective: 'score-rate-v1' }));
    expect(readCompatibleCheckpoint(path)).toMatchObject({
      version: 2,
      objective: 'score-rate-v1',
    });
  });

  it.each([
    [{ version: 1 }, 'missing'],
    [{ version: 2, objective: 'lines-height-v1' }, 'lines-height-v1'],
  ])('rejects an incompatible checkpoint before resume: %j', (checkpoint, label) => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(new RegExp(`${label}.*score-rate-v1`));
  });
});

describe('assertFreshRun', () => {
  it('rejects an existing checkpoint', () => {
    const paths = resolveRunPaths(temp(), '.');
    writeFileSync(paths.checkpoint, '{}');
    expect(() => assertFreshRun(paths)).toThrow(/checkpoint/);
  });

  it('rejects a non-empty existing log', () => {
    const paths = resolveRunPaths(temp(), '.');
    writeFileSync(paths.log, '{"gen":0}\n');
    expect(() => assertFreshRun(paths)).toThrow(/training-log/);
  });
});
```

- [ ] **Step 4: Add a failing incumbent-baseline planning test**

Create `training/reevaluation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planReevaluation } from './reevaluation';
import type { ReevaluationSummary } from './publication';

const best: ReevaluationSummary = {
  meanScore: 1000,
  scoreRate: 0.2,
  meanLines: 1998,
  meanHeight: 3,
};

describe('planReevaluation', () => {
  const published = [1, 0];
  const candidate = [0, 1];

  it('evaluates published weights first when no score baseline exists', () => {
    expect(planReevaluation(null, published, candidate)).toEqual({
      weights: [published, candidate],
      baselineIndex: 0,
      candidateIndex: 1,
    });
  });

  it('evaluates only the candidate after a compatible bestEver is restored', () => {
    expect(planReevaluation(best, published, candidate)).toEqual({
      weights: [candidate],
      baselineIndex: null,
      candidateIndex: 0,
    });
  });
});
```

Production mutation caught: skipping the incumbent on a fresh score objective makes the first case fail and would allow an unmeasured candidate to replace generation 20 automatically.

- [ ] **Step 5: Add a failing real CLI resume-boundary test**

Create `training/train-cli.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

describe('train --resume objective gate', () => {
  it('rejects a lines-height checkpoint before worker startup', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'tetris-old-checkpoint-'));
    try {
      writeFileSync(join(outputDir, 'checkpoint.json'), JSON.stringify({
        version: 1,
        objective: 'lines-height-v1',
      }));

      const result = spawnSync(process.execPath, [
        '--import', 'tsx',
        resolve(ROOT, 'training/train.ts'),
        '--resume',
        '--output-dir', outputDir,
      ], { cwd: ROOT, encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(
        /lines-height-v1.*score-rate-v1/,
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/training with .* workers/);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
```

This exercises the production CLI rather than asserting source text. It must exit before `WorkerPool` prints its startup line.

- [ ] **Step 6: Run all Task 3 tests and verify RED**

```powershell
npm test -- training/cem.test.ts training/config.test.ts training/runArtifacts.test.ts training/reevaluation.test.ts training/train-cli.test.ts
```

Expected: FAIL for missing score aggregation, obsolete height config, missing artifact helpers, and unrecognised `--output-dir`/objective gating.

- [ ] **Step 7: Implement score aggregation in `training/cem.ts`**

Change the result shape and aggregation to:

```ts
export interface CandidateStats {
  /** `meanScore / maxPieces` — CEM's fixed-schedule selection target. */
  fitness: number[];
  meanScore: number[];
  meanLines: number[];
  meanPieces: number[];
  meanHeight: number[];
}

export function aggregateFitness(
  results: readonly {
    score: number;
    lines: number;
    pieces: number;
    meanHeight: number;
  }[],
  population: number,
  gamesPerCandidate: number,
  maxPieces: number,
): CandidateStats {
  if (!Number.isFinite(maxPieces) || maxPieces <= 0) {
    throw new Error(`maxPieces must be positive, got ${maxPieces}`);
  }
  const expected = population * gamesPerCandidate;
  if (results.length !== expected) {
    throw new Error(`expected ${expected} results, got ${results.length}`);
  }

  const fitness: number[] = [];
  const meanScore: number[] = [];
  const meanLines: number[] = [];
  const meanPieces: number[] = [];
  const meanHeight: number[] = [];

  for (let i = 0; i < population; i++) {
    let score = 0;
    let lines = 0;
    let pieces = 0;
    let height = 0;
    for (let j = 0; j < gamesPerCandidate; j++) {
      const result = results[i * gamesPerCandidate + j];
      score += result.score;
      lines += result.lines;
      pieces += result.pieces;
      height += result.meanHeight;
    }
    const candidateMeanScore = score / gamesPerCandidate;
    meanScore.push(candidateMeanScore);
    meanLines.push(lines / gamesPerCandidate);
    meanPieces.push(pieces / gamesPerCandidate);
    meanHeight.push(height / gamesPerCandidate);
    fitness.push(candidateMeanScore / maxPieces);
  }

  return { fitness, meanScore, meanLines, meanPieces, meanHeight };
}
```

Retain the existing row-major and per-game height explanations, updating them to score-rate terminology.

- [ ] **Step 8: Remove the height objective from config**

Delete `heightPenalty` from `TrainConfig` and `DEFAULT_CONFIG`. Replace the obsolete objective comments with:

```ts
/** Re-evaluate mu on the fixed publication schedule every N generations. */
reevalEvery: number;
reevalGames: number;
reevalMaxPieces: number;
```

Set defaults from the shared constants:

```ts
import { PUBLICATION_GAMES, PUBLICATION_MAX_PIECES } from './objective';

reevalEvery: 10,
reevalGames: PUBLICATION_GAMES,
reevalMaxPieces: PUBLICATION_MAX_PIECES,
```

- [ ] **Step 9: Implement run-path and checkpoint guards**

Create `training/runArtifacts.ts`:

```ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCORE_RATE_OBJECTIVE } from './objective';

export interface RunPaths {
  outputDir: string;
  checkpoint: string;
  log: string;
}

export function resolveRunPaths(root: string, requested: string | null): RunPaths {
  const outputDir = resolve(root, requested ?? 'public/ai/score-rate-v1');
  return {
    outputDir,
    checkpoint: resolve(outputDir, 'checkpoint.json'),
    log: resolve(outputDir, 'training-log.jsonl'),
  };
}

export function assertFreshRun(paths: RunPaths): void {
  if (existsSync(paths.checkpoint)) {
    throw new Error(`refusing to overwrite existing checkpoint at ${paths.checkpoint}; use --resume or another --output-dir`);
  }
  if (existsSync(paths.log) && statSync(paths.log).size > 0) {
    throw new Error(`refusing to append to existing training-log at ${paths.log}; use --resume or another --output-dir`);
  }
}

export function readCompatibleCheckpoint(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof value !== 'object' || value === null) {
    throw new Error(`checkpoint at ${path} is not an object`);
  }
  const checkpoint = value as Record<string, unknown>;
  const objective = typeof checkpoint.objective === 'string'
    ? checkpoint.objective
    : 'missing';
  if (objective !== SCORE_RATE_OBJECTIVE) {
    throw new Error(`checkpoint objective ${objective} is incompatible with ${SCORE_RATE_OBJECTIVE}`);
  }
  if (checkpoint.version !== 2) {
    throw new Error(`checkpoint schema ${String(checkpoint.version)} is incompatible with version 2`);
  }
  return checkpoint;
}
```

- [ ] **Step 10: Implement incumbent-baseline planning**

Create `training/reevaluation.ts`:

```ts
import type { ReevaluationSummary } from './publication';

export interface ReevaluationPlan {
  weights: number[][];
  baselineIndex: number | null;
  candidateIndex: number;
}

export function planReevaluation(
  bestEver: ReevaluationSummary | null,
  publishedWeights: number[],
  candidateWeights: number[],
): ReevaluationPlan {
  if (bestEver === null) {
    return {
      weights: [publishedWeights, candidateWeights],
      baselineIndex: 0,
      candidateIndex: 1,
    };
  }
  return {
    weights: [candidateWeights],
    baselineIndex: null,
    candidateIndex: 0,
  };
}
```

- [ ] **Step 11: Convert `training/train.ts` to score-rate state and isolated paths**

Update imports and top-level paths:

```ts
import {
  aggregateFitness,
  eliteCount,
  initCem,
  median,
  nextMaxPieces,
  noiseAt,
  sampleCandidates,
  updateCem,
  type CandidateStats,
  type CemState,
} from './cem';
import {
  DEFAULT_WEIGHTS,
  DEFAULT_WEIGHTS_META,
  fromVector,
  normalize,
  toVector,
} from '../src/ai/weights';
import {
  SCORE_RATE_OBJECTIVE,
} from './objective';
import {
  fixedReevaluationSeeds,
  shouldPublishScoreReevaluation,
  type ReevaluationSummary,
} from './publication';
import { planReevaluation } from './reevaluation';
import {
  assertFreshRun,
  readCompatibleCheckpoint,
  resolveRunPaths,
} from './runArtifacts';

const PUBLIC_AI = resolve(ROOT, 'public/ai');
const BEST_PUBLIC = resolve(PUBLIC_AI, 'best-weights.json');
const BEST_SRC = resolve(ROOT, 'src/ai/trained-weights.json');
```

Use score semantics for state:

```ts
interface BestEver extends ReevaluationSummary {
  weights: number[];
  gen: number;
  evalGames: number;
  evalMaxPieces: number;
}

interface Checkpoint {
  version: 2;
  objective: typeof SCORE_RATE_OBJECTIVE;
  gen: number;
  mu: number[];
  sigma: number[];
  baseSeed: number;
  maxPieces: number;
  config: TrainConfig;
  bestEver: BestEver | null;
}
```

Extend CLI parsing with `outputDir: string | null` and handle `--output-dir` as a required-value flag:

```ts
function parseArgs(argv: string[]): {
  generations: number | null;
  resume: boolean;
  workers: number | null;
  outputDir: string | null;
} {
  const out = {
    generations: null as number | null,
    resume: false,
    workers: null as number | null,
    outputDir: null as string | null,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--resume') out.resume = true;
    else if (argv[i] === '--generations') out.generations = num(argv[i], argv[++i]);
    else if (argv[i] === '--workers') out.workers = num(argv[i], argv[++i]);
    else if (argv[i] === '--output-dir') {
      const value = argv[++i];
      if (value === undefined) throw new Error('missing value for --output-dir');
      out.outputDir = value;
    } else throw new Error(`unknown flag ${argv[i]}`);
  }
  return out;
}
```

Resolve and validate artifacts before `mkdirSync` and before `new WorkerPool(...)`:

```ts
const args = parseArgs(process.argv.slice(2));
const paths = resolveRunPaths(ROOT, args.outputDir);

let checkpoint: Checkpoint | null = null;
if (args.resume) {
  if (!existsSync(paths.checkpoint)) {
    throw new Error(`--resume but no checkpoint at ${paths.checkpoint}`);
  }
  checkpoint = readCompatibleCheckpoint(paths.checkpoint) as unknown as Checkpoint;
} else {
  assertFreshRun(paths);
}

mkdirSync(paths.outputDir, { recursive: true });
```

Restore only the already-validated v2 checkpoint. Initialize `bestEver` to `null` for a fresh objective:

```ts
let state: CemState = initCem();
let maxPieces = cfg.initialMaxPieces;
let baseSeed = cfg.baseSeed;
let bestEver: BestEver | null = null;

if (checkpoint !== null) {
  state = { mu: checkpoint.mu, sigma: checkpoint.sigma, gen: checkpoint.gen };
  maxPieces = checkpoint.maxPieces;
  baseSeed = checkpoint.baseSeed;
  bestEver = checkpoint.bestEver;
  console.log(
    `resumed ${checkpoint.objective} from gen ${checkpoint.gen}, ` +
    `maxPieces ${maxPieces}, best mean score ` +
    `${bestEver === null ? 'none' : bestEver.meanScore.toFixed(1)}`,
  );
}
```

Save with:

```ts
const cp: Checkpoint = {
  version: 2,
  objective: SCORE_RATE_OBJECTIVE,
  gen: state.gen,
  mu: state.mu,
  sigma: state.sigma,
  baseSeed,
  maxPieces,
  config: cfg,
  bestEver,
};
writeFileSync(paths.checkpoint, JSON.stringify(cp, null, 2));
```

Delete `NO_BEST` and `restoreBestEver`; old objective checkpoints are rejected rather than converted.

- [ ] **Step 12: Change generation logging and console output to score fields**

Aggregate and rank with:

```ts
const {
  fitness: scoreRates,
  meanScore,
  meanLines,
  meanPieces,
  meanHeight,
} = aggregateFitness(results, candidates.length, cfg.gamesPerCandidate, maxPieces);

const bestScoreRate = Math.max(...scoreRates);
const worstScoreRate = Math.min(...scoreRates);
const meanScoreRate = scoreRates.reduce((sum, value) => sum + value, 0) / scoreRates.length;
const scoreRateStd = Math.sqrt(
  scoreRates.reduce((sum, value) => sum + (value - meanScoreRate) ** 2, 0) /
  scoreRates.length,
);
const bestWeights = candidates[scoreRates.indexOf(bestScoreRate)];
```

Build elites with `{ fit, pieces, score, height }`, then log:

```ts
const elites = scoreRates
  .map((fit, index) => ({
    fit,
    pieces: meanPieces[index],
    score: meanScore[index],
    height: meanHeight[index],
  }))
  .sort((a, b) => b.fit - a.fit)
  .slice(0, eliteCount(cfg.eliteFrac, candidates.length));
const elitePieces = median(elites.map((elite) => elite.pieces));
const eliteScore = median(elites.map((elite) => elite.score));
const eliteHeight = median(elites.map((elite) => elite.height));
```

Then log:

```ts
appendFileSync(paths.log, JSON.stringify({
  objective: SCORE_RATE_OBJECTIVE,
  gen,
  ts: Date.now(),
  bestScoreRate,
  meanScoreRate,
  medianScoreRate: median(scoreRates),
  worstScoreRate,
  scoreRateStd,
  mu: state.mu,
  sigma: state.sigma,
  bestWeights,
  maxPieces,
  medianPieces: median(meanPieces),
  elitePieces,
  medianScore: median(meanScore),
  eliteScore: median(elites.map((elite) => elite.score)),
  medianLines: median(meanLines),
  medianHeight: median(meanHeight),
  eliteHeight: median(elites.map((elite) => elite.height)),
  gamesPerCandidate: cfg.gamesPerCandidate,
  elapsedMs,
}) + '\n');
```

Print `bestRate`, `medianRate`, `eliteScore`, `eliteH`, and cap. Pass `scoreRates` to `updateCem`.

```ts
console.log(
  `gen ${String(gen).padStart(4)}` +
  `  bestRate ${bestScoreRate.toFixed(3).padStart(10)}` +
  `  medianRate ${median(scoreRates).toFixed(3).padStart(10)}` +
  `  eliteScore ${eliteScore.toFixed(1).padStart(12)}` +
  `  eliteH ${eliteHeight.toFixed(1).padStart(5)}` +
  `  cap ${maxPieces}  ${(elapsedMs / 1000).toFixed(1)}s`,
);

state = updateCem(state, candidates, scoreRates, {
  eliteFrac: cfg.eliteFrac,
  noise: noiseAt(gen, cfg),
});
```

- [ ] **Step 13: Implement fixed-schedule incumbent baseline and publication**

Add a local extractor:

```ts
function reevaluationSummary(
  stats: CandidateStats,
  index: number,
): ReevaluationSummary {
  return {
    meanScore: stats.meanScore[index],
    scoreRate: stats.fitness[index],
    meanLines: stats.meanLines[index],
    meanHeight: stats.meanHeight[index],
  };
}
```

At each reevaluation point, evaluate the current published model only when the new checkpoint has no score baseline, and always evaluate `mu` on the same fixed seeds:

```ts
const mu = normalize(state.mu);
const reevaluation = planReevaluation(
  bestEver,
  toVector(DEFAULT_WEIGHTS),
  mu,
);
const evaluationWeights = reevaluation.weights;
const seeds = fixedReevaluationSeeds(baseSeed, cfg.reevalGames);
const evalTasks: SimTask[] = [];
evaluationWeights.forEach((weights, candidateIndex) => {
  seeds.forEach((seed, gameIndex) => {
    evalTasks.push({
      taskId: candidateIndex * cfg.reevalGames + gameIndex,
      weights,
      seed,
      maxPieces: cfg.reevalMaxPieces,
      depth: cfg.depth,
    });
  });
});

const evalResults = await pool.run(evalTasks);
const evalStats = aggregateFitness(
  evalResults,
  evaluationWeights.length,
  cfg.reevalGames,
  cfg.reevalMaxPieces,
);

if (reevaluation.baselineIndex !== null) {
  const baseline = reevaluationSummary(evalStats, reevaluation.baselineIndex);
  bestEver = {
    weights: evaluationWeights[reevaluation.baselineIndex],
    ...baseline,
    gen: DEFAULT_WEIGHTS_META?.gen ?? -1,
    evalGames: cfg.reevalGames,
    evalMaxPieces: cfg.reevalMaxPieces,
  };
  console.log(
    `  established published baseline: mean score ${baseline.meanScore.toFixed(1)}, ` +
    `score rate ${baseline.scoreRate.toFixed(3)}, mean height ${baseline.meanHeight.toFixed(2)}`,
  );
}

const candidate = reevaluationSummary(evalStats, reevaluation.candidateIndex);
if (bestEver === null) {
  throw new Error('fixed reevaluation did not establish a published score baseline');
}
if (shouldPublishScoreReevaluation(candidate, bestEver)) {
  bestEver = {
    weights: mu,
    ...candidate,
    gen: state.gen,
    evalGames: cfg.reevalGames,
    evalMaxPieces: cfg.reevalMaxPieces,
  };
  writeWeightsFiles(bestEver, cfg.depth);
}
```

Update `writeWeightsFiles` to emit:

```ts
const payload = JSON.stringify({
  version: 2,
  weights: fromVector(best.weights),
  objective: SCORE_RATE_OBJECTIVE,
  meanScore: best.meanScore,
  evalMaxPieces: best.evalMaxPieces,
  meanLines: best.meanLines,
  meanHeight: best.meanHeight,
  evalGames: best.evalGames,
  gen: best.gen,
  searchDepth: depth,
  trainedAt: new Date().toISOString(),
}, null, 2);
```

Delete the legacy line-ceiling publication warning and remove the old `shouldPublishReevaluation` implementation/export from `training/publication.ts` now that no caller remains.

Replace the final process summary with score terminology:

```ts
console.log(
  bestEver === null
    ? `stopped at gen ${state.gen}; no fixed-schedule reevaluation yet`
    : `stopped at gen ${state.gen}; bestEver mean score ${bestEver.meanScore.toFixed(1)}, ` +
      `score rate ${bestEver.scoreRate.toFixed(3)}, mean height ` +
      `${bestEver.meanHeight.toFixed(2)} (gen ${bestEver.gen})`,
);
```

- [ ] **Step 14: Correct stale comments without changing simulator behavior**

In `training/pool.ts`, explain that `score: 0` makes a failed game lose under score rate and `TOTAL_ROWS` remains an honest diagnostic height. In `src/ai/simulate.ts`, replace the statement that fitness reads lines with a statement that score is returned to the fixed-schedule training objective. Do not change simulation code.

Use these exact replacement comments:

```ts
// training/pool.ts
/**
 * A game that never ran earns zero score, so fixed-schedule score rate ranks it
 * below any scoring game. TOTAL_ROWS remains the honest diagnostic height for
 * a failed result; height does not enter primary fitness.
 */

// src/ai/simulate.ts
/**
 * The simulator skips real-time gravity, but it returns the engine score used
 * by training's fixed-schedule score-rate objective. No per-second metric is
 * derived here.
 */
```

- [ ] **Step 15: Run Task 3 tests and typecheck; verify GREEN**

```powershell
npm test -- training/cem.test.ts training/config.test.ts training/publication.test.ts training/runArtifacts.test.ts training/reevaluation.test.ts training/train-cli.test.ts training/pool.test.ts
npm run typecheck:train
```

Expected: all focused tests PASS; training TypeScript reports no errors. The CLI mismatch test must show no worker-startup line.

- [ ] **Step 16: Prove ignored legacy artifacts were not touched**

Run:

```powershell
Get-FileHash -Algorithm SHA256 public/ai/checkpoint.json,public/ai/training-log.jsonl
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId,CommandLine
git diff -- src/ai/trained-weights.json
```

Expected: the two hashes match the Execution Baseline; there is no training process; the weights diff remains metadata-only.

- [ ] **Step 17: Commit only Task 3 paths**

```powershell
git add -- training/runArtifacts.ts training/runArtifacts.test.ts training/reevaluation.ts training/reevaluation.test.ts training/train-cli.test.ts training/cem.ts training/cem.test.ts training/config.ts training/config.test.ts training/train.ts training/pool.ts src/ai/simulate.ts training/publication.ts
git diff --cached --name-status
git diff --cached --check
git commit -m "feat(training): optimize fixed-schedule score rate"
```

---

### Task 4: Benchmark score and survival reporting

**Files:**
- Create: `training/benchSummary.test.ts`
- Create: `training/benchSummary.ts`
- Modify: `training/bench.ts`

**Interfaces:**
- Produces: `summarizeBench(results, maxPieces): BenchSummary`.
- `BenchSummary` contains distributions for score, score per scheduled piece, lines, and height, plus total pieces and capped-game count.
- Consumes: real `SimResult` values; no simulation mock or second simulator.

- [ ] **Step 1: Write failing pure benchmark-summary tests**

Create `training/benchSummary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summarizeBench } from './benchSummary';

describe('summarizeBench', () => {
  const games = [
    { score: 900, lines: 20, pieces: 300, meanHeight: 4, reason: 'pieceCap' },
    { score: 600, lines: 10, pieces: 20, meanHeight: 8, reason: 'topOut' },
  ];

  it('summarizes score, lines, height, and survival', () => {
    const summary = summarizeBench(games, 300);
    expect(summary.score).toEqual({ mean: 750, median: 750, min: 600, max: 900 });
    expect(summary.lines.mean).toBe(15);
    expect(summary.height.mean).toBe(6);
    expect(summary.cappedGames).toBe(1);
    expect(summary.totalPieces).toBe(320);
  });

  it('divides every game score by scheduled maxPieces rather than survived pieces', () => {
    const summary = summarizeBench(games, 300);
    expect(summary.scorePerScheduledPiece).toEqual({
      mean: 2.5,
      median: 2.5,
      min: 2,
      max: 3,
    });
    expect(600 / 20).toBe(30);
    expect(summary.scorePerScheduledPiece.min).toBe(2);
  });

  it('rejects an empty result set and a non-positive schedule', () => {
    expect(() => summarizeBench([], 300)).toThrow(/result/);
    expect(() => summarizeBench(games, 0)).toThrow(/maxPieces/);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
npm test -- training/benchSummary.test.ts
```

Expected: FAIL because `benchSummary.ts` does not exist.

- [ ] **Step 3: Implement the pure summary module**

Create `training/benchSummary.ts`:

```ts
interface BenchResult {
  score: number;
  lines: number;
  pieces: number;
  meanHeight: number;
  reason: string;
}

export interface Distribution {
  mean: number;
  median: number;
  min: number;
  max: number;
}

export interface BenchSummary {
  score: Distribution;
  scorePerScheduledPiece: Distribution;
  lines: Distribution;
  height: Distribution;
  totalPieces: number;
  cappedGames: number;
}

function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  const lo = Math.floor(middle);
  const hi = Math.ceil(middle);
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: (sorted[lo] + sorted[hi]) / 2,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export function summarizeBench(
  results: readonly BenchResult[],
  maxPieces: number,
): BenchSummary {
  if (results.length === 0) throw new Error('at least one benchmark result is required');
  if (!Number.isFinite(maxPieces) || maxPieces <= 0) {
    throw new Error(`maxPieces must be positive, got ${maxPieces}`);
  }
  return {
    score: distribution(results.map((result) => result.score)),
    scorePerScheduledPiece: distribution(
      results.map((result) => result.score / maxPieces),
    ),
    lines: distribution(results.map((result) => result.lines)),
    height: distribution(results.map((result) => result.meanHeight)),
    totalPieces: results.reduce((sum, result) => sum + result.pieces, 0),
    cappedGames: results.filter((result) => result.reason === 'pieceCap').length,
  };
}
```

- [ ] **Step 4: Update `training/bench.ts` to collect once and report all required fields**

Store each `simulateGame` result in one array. Per game, print:

```ts
const scoreRate = result.score / args.maxPieces;
const survived = result.reason === 'pieceCap' ? 'survived=yes' : 'survived=no';
console.log(
  `  game ${String(i + 1).padStart(3)}` +
  `  score ${String(result.score).padStart(10)}` +
  `  score/piece ${scoreRate.toFixed(3).padStart(9)}` +
  `  lines ${String(result.lines).padStart(6)}` +
  `  height ${result.meanHeight.toFixed(2).padStart(6)}` +
  `  pieces ${String(result.pieces).padStart(6)}` +
  `  ${survived}  ${result.reason}`,
);
```

Call `summarizeBench(results, args.maxPieces)` and print mean/median/min/max sections for `score`, `score per scheduled piece`, `lines`, and `mean stack height`, followed by `cappedGames/games`, throughput, and elapsed time:

```ts
const summary = summarizeBench(results, args.maxPieces);
const row = (label: string, values: Distribution, digits: number) =>
  `${label}\n` +
  `  mean    ${values.mean.toFixed(digits)}\n` +
  `  median  ${values.median.toFixed(digits)}\n` +
  `  min     ${values.min.toFixed(digits)}\n` +
  `  max     ${values.max.toFixed(digits)}`;

console.log(`
${row('score', summary.score, 1)}

${row('score per scheduled piece', summary.scorePerScheduledPiece, 3)}

${row('lines', summary.lines, 1)}

${row('mean stack height (diagnostic)', summary.height, 2)}

survival  ${summary.cappedGames}/${args.games} games hit the piece cap
throughput  ${Math.round(summary.totalPieces / (elapsedMs / 1000))} pieces/sec (single core)
elapsed     ${(elapsedMs / 1000).toFixed(1)}s`);
```

Import `Distribution` as a type from `benchSummary.ts`. When loading a weights file, print `meanScore` as `unmeasured` when it is `null`:

```ts
const scoreLabel = parsed.meanScore === null ? 'unmeasured' : parsed.meanScore.toFixed(1);
console.log(`weights: ${path} (gen ${parsed.gen}, meanScore ${scoreLabel})`);
```

- [ ] **Step 5: Run focused tests and training typecheck**

```powershell
npm test -- training/benchSummary.test.ts
npm run typecheck:train
```

Expected: PASS. Do not run the benchmark itself; the requested implementation verification does not require a long simulation.

- [ ] **Step 6: Commit only benchmark paths**

```powershell
git add -- training/benchSummary.ts training/benchSummary.test.ts training/bench.ts
git diff --cached --name-status
git diff --cached --check
git commit -m "feat(training): report benchmark score rate"
```

---

### Task 5: Score-rate training dashboard

**Files:**
- Modify: `src/training/dashboard/types.ts`
- Modify: `src/training/dashboard/useTrainingLog.test.ts`
- Modify: `src/training/dashboard/useTrainingLog.ts`
- Modify: `src/training/dashboard/App.tsx`
- Modify: `src/training/dashboard/charts.tsx`

**Interfaces:**
- Consumes: `SCORE_RATE_OBJECTIVE` from `src/ai/trainingObjective.ts`.
- Consumes: Task 3 log fields.
- Produces: `LogEntry` with score-rate names and diagnostic height fields.
- Produces: `ScoreRateChart`, replacing `FitnessChart`.

- [ ] **Step 1: Rewrite log parser fixtures and add objective-isolation tests**

In `src/training/dashboard/useTrainingLog.test.ts`, make `line(gen)` emit:

```ts
const line = (gen: number) => JSON.stringify({
  objective: 'score-rate-v1',
  gen,
  ts: 1785000000000 + gen,
  bestScoreRate: 125.5 + gen,
  meanScoreRate: 80,
  medianScoreRate: 75,
  worstScoreRate: 0,
  scoreRateStd: 10,
  mu: Array(9).fill(0.1),
  sigma: Array(9).fill(0.5),
  bestWeights: Array(9).fill(0.2),
  maxPieces: 300,
  medianPieces: 120,
  elitePieces: 260,
  medianScore: 22500,
  eliteScore: 37650,
  medianLines: 45,
  medianHeight: 7.5,
  eliteHeight: 4.2,
  gamesPerCandidate: 5,
  elapsedMs: 1000,
});
```

Add:

```ts
it('parses score-rate fields used by the dashboard', () => {
  const [entry] = parseLog(line(0));
  expect(entry).toMatchObject({
    objective: 'score-rate-v1',
    bestScoreRate: 125.5,
    medianScoreRate: 75,
    medianScore: 22500,
    eliteScore: 37650,
    eliteHeight: 4.2,
  });
});

it('does not mix a legacy objective into the score-rate dashboard', () => {
  const legacy = JSON.parse(line(0));
  legacy.objective = 'lines-height-v1';
  expect(parseLog(`${JSON.stringify(legacy)}\n${line(1)}`)).toHaveLength(1);
  expect(parseLog(`${JSON.stringify(legacy)}\n${line(1)}`)[0].gen).toBe(1);
});
```

Update the existing optional-field test to delete `medianScore`, `eliteScore`, `medianLines`, `medianHeight`, and `eliteHeight`, then assert each defaults to zero. Keep score-rate fields required because a line without them is not a score-rate generation.

- [ ] **Step 2: Run the parser test and verify RED**

```powershell
npm test -- src/training/dashboard/useTrainingLog.test.ts
```

Expected: FAIL because current required fields and types still use generic fitness names and accept legacy lines.

- [ ] **Step 3: Change the dashboard log type and parser**

Replace the objective fields in `LogEntry` with:

```ts
import type { ScoreRateObjective } from '../../ai/trainingObjective';

export interface LogEntry {
  objective: ScoreRateObjective;
  gen: number;
  ts: number;
  bestScoreRate: number;
  meanScoreRate: number;
  medianScoreRate: number;
  worstScoreRate: number;
  scoreRateStd: number;
  mu: number[];
  sigma: number[];
  bestWeights: number[];
  maxPieces: number;
  medianPieces: number;
  elitePieces: number;
  medianScore: number;
  eliteScore: number;
  medianLines: number;
  medianHeight: number;
  eliteHeight: number;
  gamesPerCandidate: number;
  elapsedMs: number;
}
```

In `useTrainingLog.ts`, point the panel at the isolated log and require these main fields:

```ts
import { SCORE_RATE_OBJECTIVE } from '../../ai/trainingObjective';

export const LOG_URL = '/ai/score-rate-v1/training-log.jsonl';

const NUMBER_FIELDS = [
  'gen',
  'bestScoreRate',
  'meanScoreRate',
  'medianScoreRate',
  'worstScoreRate',
] as const;
```

Before pushing an entry, skip it unless `e.objective === SCORE_RATE_OBJECTIVE`. Normalize score diagnostics, lines, heights, pieces, and elapsed time with the existing finite-number helper:

```ts
if (e.objective !== SCORE_RATE_OBJECTIVE) continue;

entries.push({
  ...(value as LogEntry),
  objective: SCORE_RATE_OBJECTIVE,
  ts: num(e.ts, 0),
  scoreRateStd: num(e.scoreRateStd, 0),
  maxPieces: num(e.maxPieces, 0),
  medianPieces: num(e.medianPieces, 0),
  elitePieces: num(e.elitePieces, 0),
  medianScore: num(e.medianScore, 0),
  eliteScore: num(e.eliteScore, 0),
  medianLines: num(e.medianLines, 0),
  medianHeight: num(e.medianHeight, 0),
  eliteHeight: num(e.eliteHeight, 0),
  gamesPerCandidate: num(e.gamesPerCandidate, 0),
  elapsedMs: num(e.elapsedMs, 0),
});
```

- [ ] **Step 4: Rename the chart and dashboard metrics**

Rename `FitnessChart` to `ScoreRateChart`. Use `bestScoreRate`, `medianScoreRate`, and `worstScoreRate` for extent/band/paths; set the SVG label to `Score rate per generation`.

The renamed chart's data access is:

```tsx
export function ScoreRateChart({ entries }: { entries: LogEntry[] }) {
  const [g0, g1] = extent(entries.map((entry) => entry.gen));
  const [, yMax] = extent(entries.map((entry) => entry.bestScoreRate));
  const x = linearScale(g0, g1, M.left, M.left + PLOT_W);
  const y = linearScale(0, yMax, M.top + PLOT_H, M.top);
  const band = [
    ...entries.map((entry): [number, number] => [x(entry.gen), y(entry.bestScoreRate)]),
    ...entries.slice().reverse().map(
      (entry): [number, number] => [x(entry.gen), y(entry.worstScoreRate)],
    ),
  ];

  return (
    <svg width={W} height={H} role="img" aria-label="Score rate per generation">
      <Axes x={x} y={y} xTicks={niceTicks(g0, g1, 5)} yTicks={niceTicks(0, yMax, 5)} xFmt={fmtInt} />
      <path d={`${path(band)} Z`} fill={BEST} fillOpacity={0.1} stroke="none" />
      <path d={path(entries.map((entry) => [x(entry.gen), y(entry.worstScoreRate)]))} fill="none" stroke={WORST} strokeWidth={1} opacity={0.7} />
      <path d={path(entries.map((entry) => [x(entry.gen), y(entry.medianScoreRate)]))} fill="none" stroke={MEDIAN} strokeWidth={1.5} />
      <path d={path(entries.map((entry) => [x(entry.gen), y(entry.bestScoreRate)]))} fill="none" stroke={BEST} strokeWidth={2} />
    </svg>
  );
}
```

In `BestWeightsChart`, change the footer to:

```tsx
gen {entry.gen} · score rate {entry.bestScoreRate.toFixed(2)}
```

In `App.tsx`, import `ScoreRateChart`, select the best entry by `bestScoreRate`, and use:

```ts
const bestEver = Math.max(...entries.map((entry) => entry.bestScoreRate));
const metrics: [string, string][] = [
  ['Generation', String(latest.gen)],
  ['Best score rate', bestEver.toFixed(2)],
  ['Median score rate', latest.medianScoreRate.toFixed(2)],
  ['Elite score', Math.round(latest.eliteScore).toLocaleString()],
  ['Median lines', Math.round(latest.medianLines).toLocaleString()],
  ['Median height', latest.medianHeight.toFixed(1)],
  ['Elite height', latest.eliteHeight.toFixed(1)],
  ['Piece cap', latest.maxPieces.toLocaleString()],
  ['Elapsed', formatDuration(totalMs)],
];
```

Set the card title to `Score rate per generation`. Keep height visibly diagnostic; do not combine it into score rate.

- [ ] **Step 5: Run dashboard tests and build**

```powershell
npm test -- src/training/dashboard/useTrainingLog.test.ts src/training/dashboard/charts.test.ts
npm run build
```

Expected: tests PASS and Vite builds both application entries. No training process is started.

- [ ] **Step 6: Commit only dashboard paths**

```powershell
git add -- src/training/dashboard/types.ts src/training/dashboard/useTrainingLog.ts src/training/dashboard/useTrainingLog.test.ts src/training/dashboard/App.tsx src/training/dashboard/charts.tsx
git diff --cached --name-status
git diff --cached --check
git commit -m "feat(training): show score-rate dashboard metrics"
```

---

### Task 6: Full verification and artifact-safety audit

**Files:**
- Verify only; modify a scoped production/test file only if a verification failure reveals a bug, and repeat its red-green cycle before continuing.

**Interfaces:**
- Verifies every requirement in `docs/superpowers/specs/2026-07-30-fixed-schedule-score-rate-design.md`.
- Produces fresh test/typecheck/build evidence without a training run.

- [ ] **Step 1: Inspect the complete implementation diff and user-owned paths**

```powershell
git status --short --branch
git log --oneline --decorate -8
git diff 2fb5f7e..HEAD --stat
git diff 2fb5f7e..HEAD -- src/ai/trained-weights.json
git diff -- docs/ai-training-handoff.md
git diff --cached --name-status
```

Expected: `AGENTS.md` remains untracked and unstaged; the handoff diff is still solely user-owned; the trained weight vector is unchanged and only metadata differs; the index is empty after task commits.

- [ ] **Step 2: Run the full test suite**

```powershell
npm test
```

Expected: exit code 0 and zero failed tests. Read the complete Vitest summary before making any claim.

- [ ] **Step 3: Run the training typecheck**

```powershell
npm run typecheck:train
```

Expected: exit code 0 with no TypeScript diagnostics.

- [ ] **Step 4: Run the production build**

```powershell
npm run build
```

Expected: exit code 0; both the game and training dashboard bundles are generated.

- [ ] **Step 5: Verify no training or legacy artifact mutation occurred**

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId,
    @{n='CPUsec';e={[math]::Round((Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).CPU,1)}},
    @{n='MemMB';e={[math]::Round($_.WorkingSetSize/1MB,0)}},CommandLine
Get-FileHash -Algorithm SHA256 public/ai/checkpoint.json,public/ai/training-log.jsonl
Get-ChildItem -LiteralPath public/ai -Force | Select-Object Name,Length,LastWriteTime
git status --short
```

Expected: no training process; legacy checkpoint/log hashes match the Execution Baseline; no `public/ai/score-rate-v1/` or smoke directory exists because no training command ran.

- [ ] **Step 6: Review the requirement-to-test matrix**

Confirm each row from actual code/test output:

| Requirement | Evidence |
|---|---|
| `meanScore` aggregation and `meanScore / maxPieces` | `training/cem.test.ts` |
| Early death cannot exploit actual pieces | `training/cem.test.ts` literal quitter/survivor case |
| Score first, height only near tie | `training/publication.test.ts` |
| Incompatible objective rejects `--resume` | `training/runArtifacts.test.ts` and real `training/train-cli.test.ts` |
| Fixed 30 × 5000 publication schedule | `training/config.test.ts` plus `training/train.ts` fixed seeds |
| Current published model gets a fresh score baseline | `training/train.ts` baseline branch and nullable old metadata |
| Benchmark exposes all score/lines/height/survival data | `training/benchSummary.test.ts` and `training/bench.ts` |
| Dashboard shows Score rate and Elite score | parser test, `App.tsx`, and successful build |
| Legacy weight files still load | `src/ai/weights.test.ts` |
| Old artifacts untouched and no training started | SHA256/process audit |

- [ ] **Step 7: Prepare the authorization-gated short-run handoff**

Report this command but do not execute it:

```powershell
npm run train -- --generations 2 --workers 4 --output-dir public/ai/score-rate-v1-smoke
```

Report expected observations:

- console and log contain best/median score rate plus elite score and elite height;
- early deaths stay penalized because every rate uses the scheduled cap;
- only `public/ai/score-rate-v1-smoke/checkpoint.json` and `training-log.jsonl` are created;
- the run stops before generation 10, so no long reevaluation or model publication occurs;
- root legacy checkpoint/log and both published weight copies remain unchanged.

Wait for explicit user authorization before running this or any other training command.
