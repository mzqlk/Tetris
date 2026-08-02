# Score-rate Reevaluation Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every future fixed score-rate reevaluation as a self-contained, auditable JSONL event without changing training, publication, dashboard, or artifact semantics.

**Architecture:** Keep generation lines unchanged and append a typed `reevaluation` event to the existing run log. Centralize publication reasoning in a pure comparison function, build the event through a second pure function, and let the side-effecting training loop only orchestrate evaluation, publication, append, and checkpoint save.

**Tech Stack:** TypeScript 5.6, Node.js `appendFileSync`, Vitest 3, existing CEM/worker training modules.

## Global Constraints

- Read `AGENTS.md` and `docs/ai-training-handoff.md` before implementation.
- Do not run `npm run train`, resume training, publish weights, archive artifacts, or modify files under `public/ai/`.
- Do not modify `src/ai/`, the fitness objective, CEM sampling/update logic, fixed reevaluation seeds/schedule, checkpoint schema, benchmark CLI, or dashboard UI.
- Preserve `FEATURE_NAMES` ordering and treat all logged weight vectors as immutable snapshots.
- Keep existing `shouldPublishScoreReevaluation` behavior, including the inclusive 0.1% score-tolerance boundary.
- Do not backfill the lost gen 10 reevaluation result.
- Stage only exact task paths and keep unrelated work untouched.

---

### Task 1: Return an explained publication decision

**Files:**
- Modify: `training/publication.ts`
- Modify: `training/publication.test.ts`

**Interfaces:**
- Consumes: existing `ReevaluationSummary` and `SCORE_TIE_RELATIVE_TOLERANCE`.
- Produces: `evaluateScoreReevaluation(candidate, currentBest): ReevaluationDecision` while preserving `shouldPublishScoreReevaluation(candidate, currentBest): boolean`.

- [ ] **Step 1: Add failing decision-reason tests**

Extend the import and add assertions covering every reason and the inclusive boundary:

```ts
import {
  evaluateScoreReevaluation,
  fixedReevaluationSeeds,
  shouldPublishScoreReevaluation,
  type ReevaluationSummary,
} from './publication';

describe('evaluateScoreReevaluation', () => {
  it.each([
    [summary(1002, 8), summary(1000, 3), true, 'higher-score'],
    [summary(998, 2), summary(1000, 8), false, 'lower-score'],
    [summary(1000.5, 3), summary(1000, 4), true,
      'lower-height-within-score-tolerance'],
    [summary(1000.5, 5), summary(1000, 4), false,
      'height-not-lower-within-score-tolerance'],
  ] as const)(
    'returns %s for an explained comparison',
    (candidate, currentBest, shouldPublish, reason) => {
      expect(evaluateScoreReevaluation(candidate, currentBest)).toMatchObject({
        shouldPublish,
        reason,
      });
    },
  );

  it('keeps the exact 0.1 percent boundary inside the height tie-break', () => {
    expect(evaluateScoreReevaluation(
      summary(1000, 8),
      summary(999, 3),
    )).toEqual({
      shouldPublish: false,
      scoreTolerance: 1,
      reason: 'height-not-lower-within-score-tolerance',
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- training/publication.test.ts
```

Expected: FAIL because `evaluateScoreReevaluation` is not exported.

- [ ] **Step 3: Implement the pure decision API**

Add to `training/publication.ts`:

```ts
export type ReevaluationDecisionReason =
  | 'higher-score'
  | 'lower-score'
  | 'lower-height-within-score-tolerance'
  | 'height-not-lower-within-score-tolerance';

export interface ReevaluationDecision {
  shouldPublish: boolean;
  scoreTolerance: number;
  reason: ReevaluationDecisionReason;
}

export function evaluateScoreReevaluation(
  candidate: ReevaluationSummary,
  currentBest: ReevaluationSummary,
): ReevaluationDecision {
  const scale = Math.max(Math.abs(candidate.meanScore), Math.abs(currentBest.meanScore));
  const scoreTolerance = SCORE_TIE_RELATIVE_TOLERANCE * scale;

  if (candidate.meanScore > currentBest.meanScore + scoreTolerance) {
    return { shouldPublish: true, scoreTolerance, reason: 'higher-score' };
  }
  if (candidate.meanScore < currentBest.meanScore - scoreTolerance) {
    return { shouldPublish: false, scoreTolerance, reason: 'lower-score' };
  }
  if (candidate.meanHeight < currentBest.meanHeight) {
    return {
      shouldPublish: true,
      scoreTolerance,
      reason: 'lower-height-within-score-tolerance',
    };
  }
  return {
    shouldPublish: false,
    scoreTolerance,
    reason: 'height-not-lower-within-score-tolerance',
  };
}

export function shouldPublishScoreReevaluation(
  candidate: ReevaluationSummary,
  currentBest: ReevaluationSummary,
): boolean {
  return evaluateScoreReevaluation(candidate, currentBest).shouldPublish;
}
```

Replace the old inline boolean implementation; do not keep duplicate comparison logic.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npm test -- training/publication.test.ts
```

Expected: PASS, including all existing publication tests.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- training/publication.ts training/publication.test.ts
git commit -m "refactor(training): explain reevaluation decisions"
```

---

### Task 2: Build a self-contained reevaluation event

**Files:**
- Create: `training/reevaluationLog.ts`
- Create: `training/reevaluationLog.test.ts`

**Interfaces:**
- Consumes: `ReevaluationSummary`, `ReevaluationDecision`, and `SCORE_RATE_OBJECTIVE`.
- Produces: `buildReevaluationLogEntry(args): ReevaluationLogEntry` with copied weight arrays and finite zero-score behavior.

- [ ] **Step 1: Write the failing event-builder tests**

Create `training/reevaluationLog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluateScoreReevaluation } from './publication';
import { buildReevaluationLogEntry } from './reevaluationLog';

const evaluated = (
  gen: number,
  weights: number[],
  meanScore: number,
  meanHeight: number,
) => ({
  gen,
  weights,
  meanScore,
  scoreRate: meanScore / 5000,
  meanLines: 1998,
  meanHeight,
});

describe('buildReevaluationLogEntry', () => {
  it('records an auditable candidate-minus-current comparison', () => {
    const currentBest = evaluated(20, Array(9).fill(0.1), 3_000_000, 3.1);
    const candidate = evaluated(30, Array(9).fill(0.2), 3_006_000, 3.2);
    const decision = evaluateScoreReevaluation(candidate, currentBest);

    const event = buildReevaluationLogEntry({
      gen: 30,
      ts: 123,
      schedule: {
        games: 30,
        maxPieces: 5000,
        depth: 2,
        baseSeed: 20260727,
      },
      currentBest,
      candidate,
      decision,
    });

    expect(event).toMatchObject({
      objective: 'score-rate-v1',
      kind: 'reevaluation',
      gen: 30,
      schedule: { seedStrategy: 'fixed-reevaluation-v1' },
      comparison: {
        scoreDelta: 6000,
        scoreTolerance: 3006,
        decision: 'publish',
        reason: 'higher-score',
      },
    });
    expect(event.comparison.scoreRateDelta).toBeCloseTo(1.2);
    expect(event.comparison.relativeScoreDelta).toBeCloseTo(6000 / 3_006_000);
    expect(event.comparison.heightDelta).toBeCloseTo(0.1);
  });

  it('uses zero relative delta when both scores are zero', () => {
    const currentBest = evaluated(20, Array(9).fill(0.1), 0, 4);
    const candidate = evaluated(30, Array(9).fill(0.2), 0, 3);
    const event = buildReevaluationLogEntry({
      gen: 30,
      ts: 123,
      schedule: { games: 30, maxPieces: 5000, depth: 2, baseSeed: 1 },
      currentBest,
      candidate,
      decision: evaluateScoreReevaluation(candidate, currentBest),
    });
    expect(event.comparison.relativeScoreDelta).toBe(0);
    expect(Number.isFinite(event.comparison.relativeScoreDelta)).toBe(true);
  });

  it('copies weight vectors instead of retaining mutable references', () => {
    const currentWeights = Array(9).fill(0.1);
    const candidateWeights = Array(9).fill(0.2);
    const currentBest = evaluated(20, currentWeights, 1000, 4);
    const candidate = evaluated(30, candidateWeights, 1001, 3);
    const event = buildReevaluationLogEntry({
      gen: 30,
      ts: 123,
      schedule: { games: 30, maxPieces: 5000, depth: 2, baseSeed: 1 },
      currentBest,
      candidate,
      decision: evaluateScoreReevaluation(candidate, currentBest),
    });

    currentWeights[0] = 99;
    candidateWeights[0] = 99;
    expect(event.currentBest.weights[0]).toBe(0.1);
    expect(event.candidate.weights[0]).toBe(0.2);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- training/reevaluationLog.test.ts
```

Expected: FAIL because `training/reevaluationLog.ts` does not exist.

- [ ] **Step 3: Implement the event types and builder**

Create `training/reevaluationLog.ts` with the interfaces from the approved design and this builder:

```ts
import { SCORE_RATE_OBJECTIVE } from './objective';
import type {
  ReevaluationDecision,
  ReevaluationDecisionReason,
  ReevaluationSummary,
} from './publication';

export interface LoggedReevaluation extends ReevaluationSummary {
  gen: number;
  weights: number[];
}

export interface ReevaluationLogEntry {
  objective: typeof SCORE_RATE_OBJECTIVE;
  kind: 'reevaluation';
  gen: number;
  ts: number;
  schedule: {
    games: number;
    maxPieces: number;
    depth: 1 | 2;
    baseSeed: number;
    seedStrategy: 'fixed-reevaluation-v1';
  };
  currentBest: LoggedReevaluation;
  candidate: LoggedReevaluation;
  comparison: {
    scoreDelta: number;
    scoreRateDelta: number;
    relativeScoreDelta: number;
    scoreTolerance: number;
    heightDelta: number;
    decision: 'publish' | 'keep-current';
    reason: ReevaluationDecisionReason;
  };
}

interface BuildReevaluationLogEntryArgs {
  gen: number;
  ts: number;
  schedule: Omit<ReevaluationLogEntry['schedule'], 'seedStrategy'>;
  currentBest: LoggedReevaluation;
  candidate: LoggedReevaluation;
  decision: ReevaluationDecision;
}

const snapshot = (evaluation: LoggedReevaluation): LoggedReevaluation => ({
  ...evaluation,
  weights: evaluation.weights.slice(),
});

export function buildReevaluationLogEntry(
  args: BuildReevaluationLogEntryArgs,
): ReevaluationLogEntry {
  const scoreDelta = args.candidate.meanScore - args.currentBest.meanScore;
  const scale = Math.max(
    Math.abs(args.candidate.meanScore),
    Math.abs(args.currentBest.meanScore),
  );
  return {
    objective: SCORE_RATE_OBJECTIVE,
    kind: 'reevaluation',
    gen: args.gen,
    ts: args.ts,
    schedule: {
      ...args.schedule,
      seedStrategy: 'fixed-reevaluation-v1',
    },
    currentBest: snapshot(args.currentBest),
    candidate: snapshot(args.candidate),
    comparison: {
      scoreDelta,
      scoreRateDelta: args.candidate.scoreRate - args.currentBest.scoreRate,
      relativeScoreDelta: scale === 0 ? 0 : scoreDelta / scale,
      scoreTolerance: args.decision.scoreTolerance,
      heightDelta: args.candidate.meanHeight - args.currentBest.meanHeight,
      decision: args.decision.shouldPublish ? 'publish' : 'keep-current',
      reason: args.decision.reason,
    },
  };
}
```

- [ ] **Step 4: Run focused tests and training typecheck**

Run:

```powershell
npm test -- training/publication.test.ts training/reevaluationLog.test.ts
npm run typecheck:train
```

Expected: both commands PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- training/reevaluationLog.ts training/reevaluationLog.test.ts
git commit -m "feat(training): build reevaluation log events"
```

---

### Task 3: Append the event from the fixed reevaluation gate

**Files:**
- Modify: `training/train.ts`

**Interfaces:**
- Consumes: `evaluateScoreReevaluation` and `buildReevaluationLogEntry`.
- Produces: one JSONL event after every completed fixed reevaluation; generation lines and checkpoint behavior remain unchanged.

- [ ] **Step 1: Replace the boolean-only imports**

Import `evaluateScoreReevaluation` instead of `shouldPublishScoreReevaluation`, and import the event builder:

```ts
import {
  evaluateScoreReevaluation,
  fixedReevaluationSeeds,
  type ReevaluationSummary,
} from './publication';
import { buildReevaluationLogEntry } from './reevaluationLog';
```

- [ ] **Step 2: Capture the compared current best and candidate**

Immediately after `candidate` is calculated and the null guard passes, preserve the pre-decision best and create the explained decision:

```ts
const currentBest = bestEver;
const decision = evaluateScoreReevaluation(candidate, currentBest);
```

Keep `currentBest` unchanged even if the candidate is published later.

- [ ] **Step 3: Publish through the explained decision**

Replace the old boolean call with:

```ts
if (decision.shouldPublish) {
  bestEver = {
    weights: mu,
    ...candidate,
    gen: state.gen,
    evalGames: cfg.reevalGames,
    evalMaxPieces: cfg.reevalMaxPieces,
  };
  writeWeightsFiles(bestEver, cfg.depth);
  console.log(`  new best — wrote best-weights.json and trained-weights.json`);
}
```

- [ ] **Step 4: Append the self-contained event after a successful publication write**

After the publication block and before `saveCheckpoint()`, append:

```ts
const reevaluationEvent = buildReevaluationLogEntry({
  gen: state.gen,
  ts: Date.now(),
  schedule: {
    games: cfg.reevalGames,
    maxPieces: cfg.reevalMaxPieces,
    depth: cfg.depth,
    baseSeed,
  },
  currentBest: {
    weights: currentBest.weights,
    meanScore: currentBest.meanScore,
    scoreRate: currentBest.scoreRate,
    meanLines: currentBest.meanLines,
    meanHeight: currentBest.meanHeight,
    gen: currentBest.gen,
  },
  candidate: {
    weights: mu,
    ...candidate,
    gen: state.gen,
  },
  decision,
});
appendFileSync(paths.log, `${JSON.stringify(reevaluationEvent)}\n`);
```

Do not append an event outside the `state.gen % cfg.reevalEvery === 0` branch.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
npm test -- training/publication.test.ts training/reevaluationLog.test.ts
npm run typecheck:train
```

Expected: both commands PASS. Do not run the trainer as an integration test.

- [ ] **Step 6: Verify protected artifacts remain unchanged**

Run:

```powershell
git diff -- public/ai src/ai/trained-weights.json
Get-ChildItem -LiteralPath public/ai/score-rate-v1 -Force |
  Select-Object Name, Length, LastWriteTime
```

Expected: no Git diff for protected paths; `score-rate-v1` still contains only the existing checkpoint and generation log with unchanged timestamps.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- training/train.ts
git commit -m "feat(training): persist fixed reevaluation events"
```

---

### Task 4: Lock dashboard compatibility with event lines

**Files:**
- Modify: `src/training/dashboard/useTrainingLog.ts`
- Modify: `src/training/dashboard/useTrainingLog.test.ts`

**Interfaces:**
- Consumes: mixed JSONL containing generation records and `kind: "reevaluation"` events.
- Produces: the same `LogEntry[]` generation-only result as before.

- [ ] **Step 1: Add the characterization test**

Add to `useTrainingLog.test.ts`:

```ts
it('ignores reevaluation events between generation records', () => {
  const reevaluation = JSON.stringify({
    objective: 'score-rate-v1',
    kind: 'reevaluation',
    gen: 10,
    ts: 1785000000010,
    schedule: {},
    currentBest: {},
    candidate: {},
    comparison: {},
  });

  const entries = parseLog(`${line(9)}\n${reevaluation}\n${line(10)}\n`);
  expect(entries.map((entry) => entry.gen)).toEqual([9, 10]);
});
```

This is a compatibility characterization: it may pass before the comment update because the parser already rejects non-generation records.

- [ ] **Step 2: Update the stale parser comment**

Replace “The log is one line per generation” with wording that states the file has one generation line per generation plus sparse typed event lines, and that the dashboard intentionally returns only generation records.

- [ ] **Step 3: Run the dashboard and reevaluation tests**

Run:

```powershell
npm test -- src/training/dashboard/useTrainingLog.test.ts training/publication.test.ts training/reevaluationLog.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit Task 4**

```powershell
git add -- src/training/dashboard/useTrainingLog.ts src/training/dashboard/useTrainingLog.test.ts
git commit -m "test(training): ignore reevaluation dashboard events"
```

---

### Task 5: Full verification and safety audit

**Files:**
- Verify only; no planned modifications.

**Interfaces:**
- Consumes: Tasks 1–4 commits.
- Produces: fresh evidence that code passes and protected artifacts were untouched.

- [ ] **Step 1: Run the complete training-side typecheck**

```powershell
npm run typecheck:train
```

Expected: exit code 0.

- [ ] **Step 2: Run the complete test suite**

```powershell
npm test
```

Expected: exit code 0 with zero failed tests.

- [ ] **Step 3: Build both application entries**

```powershell
npm run build
```

Expected: exit code 0 and successful Vite output.

- [ ] **Step 4: Verify no training process or protected artifact mutation**

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'training[\\/]train\.ts|score-rate-v1' } |
  Select-Object ProcessId, CommandLine

Get-ChildItem -LiteralPath public/ai/score-rate-v1 -Force |
  Select-Object Name, Length, LastWriteTime

git diff -- public/ai src/ai/trained-weights.json
git status --short --branch
```

Expected: no training process, unchanged protected artifacts, and no uncommitted task changes.

- [ ] **Step 5: Report the authorization boundary**

Report implementation commits and verification evidence. Explicitly state that gen 10 remains resumable but no resume command was run. Do not present or execute training as an automatic next step; wait for separate user authorization.
