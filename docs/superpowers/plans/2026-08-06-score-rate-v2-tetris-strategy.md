# Score-Rate v2 Tetris Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add measurable 1/2/3/4-line-clear behavior and a learnable nonlinear clear-value feature while preserving fixed-schedule score-rate fitness, current v1 runtime behavior, and strict artifact isolation.

**Architecture:** Introduce one pure shared line-clear module, append `lineClearValue` as the tenth feature, and explicitly adapt only recognized nine-key legacy weight schemas with a zero coefficient. Propagate clear histograms through simulation, workers, benchmark, CEM diagnostics, fixed reevaluation, published metadata, and the dashboard. Atomically version the complete trainable-policy contract to `score-rate-v2`, checkpoint schema 3, and `public/ai/score-rate-v2/`; never resume or mutate v1 artifacts.

**Tech Stack:** TypeScript 5.6, Node worker_threads, React 18, Zustand, Vitest 3, Vite 6, existing CEM trainer and pure browser/Node AI core.

## Global Constraints

- Work from `D:\WorkSpace\Tetris`; read `docs/ai-training-handoff.md` before editing `src/ai/`, `training/`, checkpoints, or weights.
- Source design: `docs/superpowers/specs/2026-08-06-ai-hard-drop-and-tetris-strategy-design.md`.
- Execute the separate hard-drop plan first or preserve its public `Placement` contract if both plans are integrated later. This plan does not modify placement-path behavior.
- Preserve unrelated WIP and use exact path staging only. Never broad-add, stash, checkout, reset, restore, move, delete, or archive user files/artifacts.
- Commit steps require explicit user authorization. Without it, do not stage or commit.
- This implementation plan authorizes code and documentation changes only. It does not authorize `npm run train`, `npm run bench`, smoke, resume, formal training, fixed-reevaluation writes, model publication, or artifact mutation.
- Do not inspect or rely on ignored `public/ai/` state during ordinary implementation. Any future run requires a fresh process/artifact/config/hash preflight and a separate authorization.
- Fitness remains exactly `meanScore / scheduled maxPieces`; never divide by survived pieces and never add time, survival, height, or tetris bonuses.
- `meanHeight` remains diagnostic and only breaks a fixed-reevaluation score tie inside the inclusive 0.1% band.
- Preserve all existing height, holes, transition, landing-height, and well-depth features. Append `lineClearValue`; do not reorder the first nine `FEATURE_NAMES`.
- `src/ai/` remains pure and shared by browser/Node. No Node, DOM, filesystem, training-only AI implementation, module-level mutable state, or board-row mutation.
- No new runtime dependency or chart library.
- Every task follows RED -> GREEN and receives an independent review. Fix Critical, Important, and Minor findings to zero and rerun the focused gate before proceeding.

## File Map

- Create `src/ai/lineClears.ts`: shared types, exact clear-value mapping via the engine scorer, immutable aggregation, line total, and tetris share.
- Create `src/ai/lineClears.test.ts`: pure boundary and arithmetic tests.
- Modify `src/ai/features.ts` and tests: append the tenth feature without moving the first nine.
- Modify `src/ai/weights.ts` and tests: strict versioned nine-key adaptation and ten-key v2 parsing; keep tracked weight JSON unchanged until a separately authorized publication.
- Modify `src/training/dashboard/chartColors.ts` and test: add one distinct color for the tenth feature.
- Modify `src/ai/simulate.ts` and tests: record per-game clear counts.
- Modify `training/pool.ts`, worker-facing result types, and tests: carry clear counts and produce all-zero failure counts.
- Modify `training/benchSummary.ts`, `training/bench.ts`, and tests: aggregate and print clear distributions.
- Modify `training/cem.ts`, `training/train.ts`, and tests: aggregate tetris diagnostics without changing fitness.
- Modify `src/training/dashboard/types.ts`, `useTrainingLog.ts`, `App.tsx`, and tests: parse/display best and elite tetris line share.
- Modify `src/ai/trainingObjective.ts`, `training/objective.ts`, `training/runArtifacts.ts`, CLI tests, publication/reevaluation files and tests: atomically move to objective v2, schema 3, v2 paths, and strict metadata consistency.
- Modify `docs/ai-training-handoff.md` only after all code gates pass: describe code-ready v2 versus still-published v1 and retain all authorization boundaries.

---

### Task 1: Pure Line-Clear Domain Module

**Files:**
- Create: `src/ai/lineClears.ts`
- Create: `src/ai/lineClears.test.ts`

**Interfaces:**
- Consumes: `calculateScore(linesCleared: number, level: number)` from `src/engine/scorer.ts`.
- Produces:
  - `LineClearCounts`
  - `emptyLineClearCounts(): LineClearCounts`
  - `recordLineClear(counts, linesCleared): LineClearCounts`
  - `addLineClearCounts(left, right): LineClearCounts`
  - `divideLineClearCounts(counts, divisor): LineClearCounts`
  - `totalLinesFromCounts(counts): number`
  - `tetrisLineShare(counts): number`
  - `lineClearValue(linesCleared): number`
  - `assertLineClearCounts(counts, requireIntegers): void`

- [ ] **Step 1: Write the complete failing pure-function test suite**

Create `src/ai/lineClears.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addLineClearCounts,
  assertLineClearCounts,
  divideLineClearCounts,
  emptyLineClearCounts,
  lineClearValue,
  recordLineClear,
  tetrisLineShare,
  totalLinesFromCounts,
} from './lineClears';

describe('lineClearValue', () => {
  it('uses the engine single/double/triple/tetris proportions', () => {
    expect([0, 1, 2, 3, 4].map(lineClearValue)).toEqual([0, 1, 3, 5, 8]);
  });

  it.each([-1, 1.5, 5, Number.NaN])('rejects invalid clear count %s', (value) => {
    expect(() => lineClearValue(value)).toThrow(/integer from 0 to 4/);
  });
});

describe('LineClearCounts', () => {
  it('starts at independent all-zero objects', () => {
    const a = emptyLineClearCounts();
    const b = emptyLineClearCounts();
    expect(a).toEqual({ singles: 0, doubles: 0, triples: 0, tetrises: 0 });
    expect(a).not.toBe(b);
  });

  it('records clear events without mutating the input', () => {
    const start = emptyLineClearCounts();
    const afterSingle = recordLineClear(start, 1);
    const afterTetris = recordLineClear(afterSingle, 4);
    expect(start).toEqual({ singles: 0, doubles: 0, triples: 0, tetrises: 0 });
    expect(afterTetris).toEqual({ singles: 1, doubles: 0, triples: 0, tetrises: 1 });
    expect(recordLineClear(afterTetris, 0)).toEqual(afterTetris);
  });

  it('adds and averages counts component-wise', () => {
    const total = addLineClearCounts(
      { singles: 2, doubles: 1, triples: 0, tetrises: 3 },
      { singles: 4, doubles: 3, triples: 2, tetrises: 1 },
    );
    expect(total).toEqual({ singles: 6, doubles: 4, triples: 2, tetrises: 4 });
    expect(divideLineClearCounts(total, 2)).toEqual({
      singles: 3, doubles: 2, triples: 1, tetrises: 2,
    });
  });

  it('rejects a non-positive averaging divisor', () => {
    expect(() => divideLineClearCounts(emptyLineClearCounts(), 0)).toThrow(/positive/);
  });

  it('rejects negative, non-finite, and fractional raw counts', () => {
    expect(() => assertLineClearCounts(
      { singles: -1, doubles: 0, triples: 0, tetrises: 0 }, false,
    )).toThrow(/non-negative/);
    expect(() => assertLineClearCounts(
      { singles: Number.NaN, doubles: 0, triples: 0, tetrises: 0 }, false,
    )).toThrow(/finite/);
    expect(() => assertLineClearCounts(
      { singles: 0.5, doubles: 0, triples: 0, tetrises: 0 }, true,
    )).toThrow(/integer/);
  });

  it('derives lines and tetris line share', () => {
    const counts = { singles: 2, doubles: 1, triples: 0, tetrises: 2 };
    expect(totalLinesFromCounts(counts)).toBe(12);
    expect(tetrisLineShare(counts)).toBeCloseTo(8 / 12, 12);
    expect(tetrisLineShare(emptyLineClearCounts())).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm test -- src/ai/lineClears.test.ts
```

Expected: FAIL because `src/ai/lineClears.ts` does not exist.

- [ ] **Step 3: Implement the pure module without a duplicate score table**

Create `src/ai/lineClears.ts`:

```ts
import { calculateScore } from '../engine/scorer';

export interface LineClearCounts {
  singles: number;
  doubles: number;
  triples: number;
  tetrises: number;
}

export function emptyLineClearCounts(): LineClearCounts {
  return { singles: 0, doubles: 0, triples: 0, tetrises: 0 };
}

function assertClearCount(linesCleared: number): void {
  if (!Number.isInteger(linesCleared) || linesCleared < 0 || linesCleared > 4) {
    throw new Error(`linesCleared must be an integer from 0 to 4, got ${linesCleared}`);
  }
}

export function assertLineClearCounts(
  counts: LineClearCounts,
  requireIntegers: boolean,
): void {
  const names = ['singles', 'doubles', 'triples', 'tetrises'] as const;
  for (const name of names) {
    const value = counts[name];
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
    if (value < 0) throw new Error(`${name} must be non-negative`);
    if (requireIntegers && !Number.isSafeInteger(value)) {
      throw new Error(`${name} must be an integer`);
    }
  }
}

export function lineClearValue(linesCleared: number): number {
  assertClearCount(linesCleared);
  return calculateScore(linesCleared, 1) / 100;
}

export function recordLineClear(
  counts: LineClearCounts,
  linesCleared: number,
): LineClearCounts {
  assertClearCount(linesCleared);
  assertLineClearCounts(counts, true);
  if (linesCleared === 0) return { ...counts };
  const keys = ['singles', 'doubles', 'triples', 'tetrises'] as const;
  const key = keys[linesCleared - 1];
  const result = { ...counts, [key]: counts[key] + 1 };
  assertLineClearCounts(result, true);
  return result;
}

export function addLineClearCounts(
  left: LineClearCounts,
  right: LineClearCounts,
): LineClearCounts {
  assertLineClearCounts(left, false);
  assertLineClearCounts(right, false);
  const result = {
    singles: left.singles + right.singles,
    doubles: left.doubles + right.doubles,
    triples: left.triples + right.triples,
    tetrises: left.tetrises + right.tetrises,
  };
  assertLineClearCounts(result, false);
  return result;
}

export function divideLineClearCounts(
  counts: LineClearCounts,
  divisor: number,
): LineClearCounts {
  assertLineClearCounts(counts, false);
  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw new Error(`divisor must be positive, got ${divisor}`);
  }
  const result = {
    singles: counts.singles / divisor,
    doubles: counts.doubles / divisor,
    triples: counts.triples / divisor,
    tetrises: counts.tetrises / divisor,
  };
  assertLineClearCounts(result, false);
  return result;
}

export function totalLinesFromCounts(counts: LineClearCounts): number {
  assertLineClearCounts(counts, false);
  const total = counts.singles + 2 * counts.doubles + 3 * counts.triples + 4 * counts.tetrises;
  if (!Number.isFinite(total)) throw new Error('total cleared lines must be finite');
  return total;
}

export function tetrisLineShare(counts: LineClearCounts): number {
  const lines = totalLinesFromCounts(counts);
  return lines === 0 ? 0 : (4 * counts.tetrises) / lines;
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

```powershell
npm test -- src/ai/lineClears.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run independent review and fix all severities**

Review purity, scorer reuse, integer-event validation, immutable returns, zero denominator, finite divisor, and naming. Fix all Critical/Important/Minor findings and rerun Step 4 until zero.

- [ ] **Step 6: Commit if authorized**

```powershell
git add -- src/ai/lineClears.ts src/ai/lineClears.test.ts
git commit -m "feat(ai): add line-clear diagnostics"
```

---

### Task 2: Tenth Feature and Strict Legacy Weight Adaptation

**Files:**
- Modify: `src/ai/features.ts:1-126`
- Modify: `src/ai/features.test.ts:1-117`
- Modify: `src/ai/weights.ts:1-97`
- Modify: `src/ai/weights.test.ts:1-151`
- Modify: `src/ai/simulate.test.ts:255-300`
- Modify: `src/training/dashboard/chartColors.ts:1-24`
- Modify: `src/training/dashboard/charts.test.ts:1-28`
- Protected: `src/ai/trained-weights.json` must remain byte-for-byte unchanged.

**Interfaces:**
- Consumes: `lineClearValue(linesCleared)` from Task 1.
- Produces: `LEGACY_FEATURE_NAMES` (nine fixed names), `FEATURE_NAMES` (the same nine plus `lineClearValue`), ten-dimensional `Weights`, and explicit version 1/version 2 legacy adaptation to `lineClearValue: 0`.
- Compatibility: version 3 + `score-rate-v2` must contain exactly ten current keys; version 2 + `score-rate-v1` exactly nine; version 1/missing metadata exactly nine. Declared v2+ missing objective is rejected.

- [ ] **Step 1: Write failing feature-order and value tests**

Update the `FEATURE_NAMES` test and add a clear-value assertion:

```ts
expect(LEGACY_FEATURE_NAMES).toEqual([
  'aggregateHeight', 'holes', 'bumpiness', 'maxHeight', 'linesCleared',
  'landingHeight', 'rowTransitions', 'colTransitions', 'wellDepth',
]);
expect(FEATURE_NAMES).toEqual([...LEGACY_FEATURE_NAMES, 'lineClearValue']);
expect(FEATURE_COUNT).toBe(10);

it('appends nonlinear clear value after the established nine features', () => {
  const board = createEmptyBoard();
  const placedCells = [
    { x: 0, y: 18 }, { x: 0, y: 19 }, { x: 0, y: 20 }, { x: 0, y: 21 },
  ];
  const features = extractFeatures(board, 4, placedCells);
  expect(features[FEATURE_NAMES.indexOf('linesCleared')]).toBe(4);
  expect(features[FEATURE_NAMES.indexOf('lineClearValue')]).toBe(8);
});
```

- [ ] **Step 2: Write failing strict-parser and behavior-preservation tests**

In `src/ai/weights.test.ts`, define a legacy nine-key object from `LEGACY_FEATURE_NAMES` and test:

```ts
it('adapts an exact score-rate-v1 file with a zero nonlinear coefficient', () => {
  const legacyWeights = Object.fromEntries(
    LEGACY_FEATURE_NAMES.map((name, index) => [name, index - 4]),
  );
  const parsed = parseWeightsFile({
    version: 2,
    objective: 'score-rate-v1',
    weights: legacyWeights,
    meanScore: 123,
    evalMaxPieces: 5000,
  });

  expect(parsed).not.toBeNull();
  expect(parsed!.weights.lineClearValue).toBe(0);
  expect(Object.keys(parsed!.weights)).toEqual([...FEATURE_NAMES]);
});

it('accepts only an exact ten-key score-rate-v2 file', () => {
  const weights = Object.fromEntries(FEATURE_NAMES.map((name, index) => [name, index]));
  expect(parseWeightsFile({ version: 3, objective: 'score-rate-v2', weights }))
    .not.toBeNull();
  const { lineClearValue: _removed, ...missing } = weights;
  expect(parseWeightsFile({ version: 3, objective: 'score-rate-v2', weights: missing }))
    .toBeNull();
  expect(parseWeightsFile({
    version: 3,
    objective: 'score-rate-v2',
    weights: { ...weights, extra: 1 },
  })).toBeNull();
});

it('does not downgrade a declared version 2 file with missing objective', () => {
  const weights = Object.fromEntries(LEGACY_FEATURE_NAMES.map((name) => [name, 0]));
  expect(parseWeightsFile({ version: 2, weights })).toBeNull();
});

it.each([Number.NaN, '2'])('rejects a malformed declared version %s', (version) => {
  const weights = Object.fromEntries(LEGACY_FEATURE_NAMES.map((name) => [name, 0]));
  expect(parseWeightsFile({ version, weights })).toBeNull();
});
```

Also extend the typed `sample: Weights` fixture with `lineClearValue: -10`, change its expected vector to `[-1, -2, -3, -4, 5, -6, -7, -8, -9, -10]`, and replace hard-coded nine-element normalization arrays with `FEATURE_COUNT`-sized arrays. In `features.test.ts`, append the expected clear value to every full-vector assertion (`0` for no clear, `1/3/5/8` for 1/2/3/4 clears).

In `src/ai/simulate.test.ts`, add the pre-change golden regression using the bundled model:

```ts
it.each([
  [7, { lines: 22, score: 3800, pieces: 60, meanHeight: 3.1166666666666667 }],
  [11, { lines: 22, score: 3600, pieces: 60, meanHeight: 3.7 }],
  [20260806, { lines: 23, score: 4100, pieces: 60, meanHeight: 3.4833333333333334 }],
])('keeps the zero-extended v1 model deterministic for seed %i', (seed, expected) => {
  expect(simulateGame({
    weights: toVector(DEFAULT_WEIGHTS), seed, maxPieces: 60, depth: 2,
  })).toMatchObject({ ...expected, reason: 'pieceCap' });
});
```

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm test -- src/ai/features.test.ts src/ai/weights.test.ts src/ai/simulate.test.ts src/training/dashboard/charts.test.ts
```

Expected: FAIL because the tenth feature, legacy list, strict schema branches, and tenth chart color do not exist.

- [ ] **Step 4: Append the feature without moving the old nine**

In `src/ai/features.ts`:

```ts
import { lineClearValue } from './lineClears';

export const LEGACY_FEATURE_NAMES = [
  'aggregateHeight', 'holes', 'bumpiness', 'maxHeight', 'linesCleared',
  'landingHeight', 'rowTransitions', 'colTransitions', 'wellDepth',
] as const;

export const FEATURE_NAMES = [...LEGACY_FEATURE_NAMES, 'lineClearValue'] as const;
```

Append `lineClearValue(linesCleared)` to the value returned by `extractFeatures`; do not move or change the first nine values.

- [ ] **Step 5: Implement exact versioned parser branches**

In `src/ai/weights.ts`, add a helper that validates an exact key list and returns finite numbers. Use these branches inside `parseWeightsFile`:

```ts
const version = d.version === undefined ? 1 : d.version;
if (typeof version !== 'number' || !Number.isSafeInteger(version)) return null;
const objective = typeof d.objective === 'string' ? d.objective : null;

let weights: Weights;
if (version === 1 && objective === null) {
  const legacy = parseExactWeights(raw, LEGACY_FEATURE_NAMES);
  if (legacy === null) return null;
  weights = { ...legacy, lineClearValue: 0 } as Weights;
} else if (version === 2 && objective === 'score-rate-v1') {
  const legacy = parseExactWeights(raw, LEGACY_FEATURE_NAMES);
  if (legacy === null) return null;
  weights = { ...legacy, lineClearValue: 0 } as Weights;
} else if (version === 3 && objective === 'score-rate-v2') {
  const current = parseExactWeights(raw, FEATURE_NAMES);
  if (current === null) return null;
  weights = current as Weights;
} else {
  return null;
}
```

Define `parseExactWeights` to require `Object.keys(raw).length === names.length`, every required name, no unknown extras, and finite numeric values. Update `HANDCRAFTED_WEIGHTS` by appending a trailing `0` to its raw vector; normalization then preserves its first nine values. Do not edit `trained-weights.json`.

- [ ] **Step 6: Add the tenth chart color**

Append `'#8f6bd8'` to `SERIES_COLORS`, update its comment from nine to ten direct-labeled series, and retain the existing uniqueness/hex tests. Do not add a chart dependency or claim new external color validation evidence.

- [ ] **Step 7: Run focused and compatibility tests**

```powershell
npm test -- src/ai/lineClears.test.ts src/ai/features.test.ts src/ai/weights.test.ts src/ai/search.test.ts src/ai/simulate.test.ts src/training/dashboard/charts.test.ts
git diff -- src/ai/trained-weights.json
```

Expected: all tests PASS; trained weights have no diff; the three golden simulation results remain unchanged.

- [ ] **Step 8: Run independent review and fix all severities**

Require checks for feature order, parser downgrade paths, unknown keys, finite values, v1 zero-extension norm, bundled fallback, chart array length, and no tracked-weight mutation. Fix all findings and rerun Step 7 until `Critical 0 / Important 0 / Minor 0`.

- [ ] **Step 9: Commit if authorized**

```powershell
git add -- src/ai/features.ts src/ai/features.test.ts src/ai/weights.ts src/ai/weights.test.ts src/ai/simulate.test.ts src/training/dashboard/chartColors.ts src/training/dashboard/charts.test.ts
git commit -m "feat(ai): add nonlinear line-clear feature"
```

---

### Task 3: Simulation and Worker Clear Histograms

**Files:**
- Modify: `src/ai/simulate.ts:13-192`
- Modify: `src/ai/simulate.test.ts:65-203,236-366`
- Modify: `training/pool.ts:1-31`
- Modify: `training/pool.test.ts:1-88`
- Verify: `training/worker.ts`

**Interfaces:**
- Consumes: Task 1's `LineClearCounts`, `emptyLineClearCounts`, `recordLineClear`, and `totalLinesFromCounts`.
- Produces: `SimState.clearCounts`, `SimResult.clearCounts`, and `SimTaskResult.clearCounts` with integer per-game counts.
- Invariant: every successful `SimResult.lines === totalLinesFromCounts(clearCounts)`; `FAILED_RESULT` has zero counts.

- [ ] **Step 1: Extend line-clear parity fixtures with failing count assertions**

In the existing `line-clear parity` table, associate expected counts with single/double/triple/tetris. After `driveBoth`, assert:

```ts
const EXPECTED_COUNTS = {
  single: { singles: 1, doubles: 0, triples: 0, tetrises: 0 },
  double: { singles: 0, doubles: 1, triples: 0, tetrises: 0 },
  triple: { singles: 0, doubles: 0, triples: 1, tetrises: 0 },
  tetris: { singles: 0, doubles: 0, triples: 0, tetrises: 1 },
} as const;

expect(sim.clearCounts).toEqual(EXPECTED_COUNTS[name]);
expect(sim.lines).toBe(totalLinesFromCounts(sim.clearCounts));
```

Add a `simulateGame` assertion that returned counts reconstruct returned lines.

- [ ] **Step 2: Add failing worker parity and failure-result tests**

In `training/pool.test.ts`:

```ts
expect(viaWorker.clearCounts).toEqual(direct.clearCounts);

expect(FAILED_RESULT.clearCounts).toEqual({
  singles: 0, doubles: 0, triples: 0, tetrises: 0,
});
```

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm test -- src/ai/simulate.test.ts training/pool.test.ts
```

Expected: FAIL because state/results do not expose clear counts.

- [ ] **Step 4: Record counts at the single lock-and-clear boundary**

In `src/ai/simulate.ts`:

```ts
import {
  emptyLineClearCounts,
  recordLineClear,
  type LineClearCounts,
} from './lineClears';

// SimState and SimResult:
clearCounts: LineClearCounts;

// createSimState:
clearCounts: emptyLineClearCounts(),

// lockAndSpawn, immediately after linesCleared is known:
state.clearCounts = recordLineClear(state.clearCounts, linesCleared);

// simulateGame result:
clearCounts: { ...state.clearCounts },
```

Do not change engine score, level, board, bag, height, or piece-cap behavior.

- [ ] **Step 5: Propagate the field through the worker pool**

Import the type into `training/pool.ts`, add `clearCounts: LineClearCounts` to `SimTaskResult`, and add `clearCounts: emptyLineClearCounts()` to `FAILED_RESULT`. Do not modify `training/worker.ts`; it already returns the complete `simulateGame` result structurally.

- [ ] **Step 6: Run focused tests and verify GREEN**

```powershell
npm test -- src/ai/simulate.test.ts training/pool.test.ts
npm run typecheck:train
```

Expected: PASS.

- [ ] **Step 7: Run independent review and fix all severities**

Review the single update point, raw integer counts, copies at result boundaries, line-count invariant, worker parity, and zero failure result. Fix all findings and rerun Step 6 until zero.

- [ ] **Step 8: Commit if authorized**

```powershell
git add -- src/ai/simulate.ts src/ai/simulate.test.ts training/pool.ts training/pool.test.ts
git commit -m "feat(ai): track line-clear histograms"
```

---

### Task 4: Benchmark Strategy Reporting

**Files:**
- Modify: `training/benchSummary.ts:1-58`
- Modify: `training/benchSummary.test.ts:1-35`
- Modify: `training/bench.ts:65-112`

**Interfaces:**
- Consumes: `SimResult.clearCounts` and Task 1 aggregation functions.
- Produces: `BenchSummary.clearCounts`, `BenchSummary.tetrisLineShare`, `BenchSummary.tetrisesPer100ScheduledPieces`, and `formatLineClearCounts(counts): string`.

- [ ] **Step 1: Write failing benchmark summary tests**

Update the two benchmark fixtures to include consistent counts:

```ts
const games = [
  {
    score: 900, lines: 20, pieces: 300, meanHeight: 4, reason: 'pieceCap',
    clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 5 },
  },
  {
    score: 600, lines: 10, pieces: 20, meanHeight: 8, reason: 'topOut',
    clearCounts: { singles: 0, doubles: 1, triples: 0, tetrises: 2 },
  },
];

it('summarizes clear strategy against the scheduled denominator', () => {
  const summary = summarizeBench(games, 300);
  expect(summary.clearCounts).toEqual({ singles: 0, doubles: 1, triples: 0, tetrises: 7 });
  expect(summary.tetrisLineShare).toBeCloseTo(28 / 30, 12);
  expect(summary.tetrisesPer100ScheduledPieces).toBeCloseTo(100 * 7 / 600, 12);
  expect(formatLineClearCounts(summary.clearCounts)).toBe('1/2/3/4 clears 0/1/0/7');
});

it('rejects a result whose lines disagree with its histogram', () => {
  const inconsistent = { ...games[0], lines: 19 };
  expect(() => summarizeBench([inconsistent], 300)).toThrow(/clearCounts.*lines/);
});
```

Keep the existing early-death score-rate test; add counts to its fixtures rather than changing its expected scheduled denominator.

- [ ] **Step 2: Run the summary test and verify RED**

```powershell
npm test -- training/benchSummary.test.ts
```

Expected: FAIL because the new summary fields and formatter do not exist.

- [ ] **Step 3: Implement pure summary fields**

Extend `BenchResult` with `clearCounts`. Extend `BenchSummary` with:

```ts
clearCounts: LineClearCounts;
tetrisLineShare: number;
tetrisesPer100ScheduledPieces: number;
```

After validating inputs, require `totalLinesFromCounts(result.clearCounts) === result.lines` for every game and throw an error mentioning `clearCounts` and `lines` on mismatch. Then sum counts with `addLineClearCounts` and return:

```ts
const clearCounts = results.reduce(
  (sum, result) => addLineClearCounts(sum, result.clearCounts),
  emptyLineClearCounts(),
);

return {
  // existing fields unchanged
  clearCounts,
  tetrisLineShare: tetrisLineShare(clearCounts),
  tetrisesPer100ScheduledPieces:
    (100 * clearCounts.tetrises) / (results.length * maxPieces),
};
```

Add:

```ts
export const formatLineClearCounts = (counts: LineClearCounts): string =>
  `1/2/3/4 clears ${counts.singles}/${counts.doubles}/${counts.triples}/${counts.tetrises}`;
```

- [ ] **Step 4: Update CLI output without changing simulation behavior**

In `training/bench.ts`, append `formatLineClearCounts(result.clearCounts)` to each per-game line. In the summary block add:

```ts
${formatLineClearCounts(summary.clearCounts)}
tetris line share  ${(100 * summary.tetrisLineShare).toFixed(2)}%
tetrises/100 scheduled pieces  ${summary.tetrisesPer100ScheduledPieces.toFixed(3)}
```

Retain all existing score, score/scheduled-piece, lines, height, survival, throughput, and elapsed output. Do not run the benchmark.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
npm test -- training/benchSummary.test.ts
npm run typecheck:train
```

Expected: PASS.

- [ ] **Step 6: Run independent review and fix all severities**

Require checks for consistent counts, fixed scheduled denominator, zero-line share, output labels, and no accidental benchmark execution. Fix all findings and rerun Step 5 until zero.

- [ ] **Step 7: Commit if authorized**

```powershell
git add -- training/benchSummary.ts training/benchSummary.test.ts training/bench.ts
git commit -m "feat(training): report line-clear distributions"
```

---

### Task 5: CEM Diagnostics, Generation Logs, and Dashboard Summary

**Files:**
- Modify: `training/cem.ts:88-159`
- Modify: `training/cem.test.ts:154-227`
- Modify: `training/train.ts:219-281`
- Modify: `src/training/dashboard/types.ts:1-25`
- Modify: `src/training/dashboard/useTrainingLog.ts:1-85`
- Modify: `src/training/dashboard/useTrainingLog.test.ts:1-134`
- Modify: `src/training/dashboard/App.tsx:12-52`

**Interfaces:**
- Consumes: `SimTaskResult.clearCounts`, Task 1 count aggregation/share, and existing score-rate elite selection.
- Produces: `CandidateStats.meanClearCounts`, `CandidateStats.tetrisLineShares`, generation fields `bestTetrisLineShare`, `medianTetrisLineShare`, `eliteTetrisLineShare`.
- Invariant: `CandidateStats.fitness` remains exactly `candidateMeanScore / maxPieces`; no clear metric affects sorting or CEM update.

- [ ] **Step 1: Add a typed result helper and failing CEM diagnostics test**

In `training/cem.test.ts`, import `type LineClearCounts` from `../src/ai/lineClears` and introduce a helper so every existing fixture gets counts consistent with its `lines` value:

```ts
const result = (overrides: Partial<{
  score: number;
  lines: number;
  pieces: number;
  meanHeight: number;
  clearCounts: LineClearCounts;
}> = {}) => {
  const lines = overrides.lines ?? 0;
  return {
    score: 0,
    lines,
    pieces: 0,
    meanHeight: 0,
    // Existing tests that only care about score/fitness use all-single counts.
    clearCounts: overrides.clearCounts ?? {
      singles: lines, doubles: 0, triples: 0, tetrises: 0,
    },
    ...overrides,
  };
};
```

Convert existing aggregate fixtures through `result(...)`, then add:

```ts
it('aggregates clear counts and tetris share without changing fitness', () => {
  const stats = aggregateFitness([
    result({
      score: 900, lines: 4, pieces: 100,
      clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 1 },
    }),
    result({
      score: 1100, lines: 4, pieces: 100,
      clearCounts: { singles: 4, doubles: 0, triples: 0, tetrises: 0 },
    }),
  ], 1, 2, 100);

  expect(stats.meanScore).toEqual([1000]);
  expect(stats.fitness).toEqual([10]);
  expect(stats.meanClearCounts).toEqual([
    { singles: 2, doubles: 0, triples: 0, tetrises: 0.5 },
  ]);
  expect(stats.tetrisLineShares).toEqual([0.5]);
});

it('rejects a worker result whose line total disagrees with its histogram', () => {
  expect(() => aggregateFitness([
    result({
      lines: 4,
      clearCounts: { singles: 1, doubles: 0, triples: 0, tetrises: 0 },
    }),
  ], 1, 1, 100)).toThrow(/clearCounts.*lines/);
});
```

- [ ] **Step 2: Run CEM tests and verify RED**

```powershell
npm test -- training/cem.test.ts
```

Expected: FAIL because `CandidateStats` has no clear diagnostics.

- [ ] **Step 3: Aggregate counts per candidate while preserving fitness**

Extend `CandidateStats`:

```ts
meanClearCounts: LineClearCounts[];
tetrisLineShares: number[];
```

For each raw result, first require `totalLinesFromCounts(r.clearCounts) === r.lines`. Then sum each candidate's game counts, divide by `gamesPerCandidate`, and derive share from the mean counts. Keep the existing score/line/piece/height arithmetic and this line unchanged:

```ts
fitness.push(candidateMeanScore / maxPieces);
```

Return the two new arrays with the existing statistics.

- [ ] **Step 4: Add generation fields and console diagnostics**

In `training/train.ts`, destructure `tetrisLineShares`. Use the existing best index and extend elite records:

```ts
const bestIndex = scoreRates.indexOf(bestScoreRate);
const bestWeights = candidates[bestIndex];

const elites = scoreRates.map((fit, index) => ({
  fit,
  pieces: meanPieces[index],
  score: meanScore[index],
  height: meanHeight[index],
  tetrisLineShare: tetrisLineShares[index],
}))
  .sort((a, b) => b.fit - a.fit)
  .slice(0, eliteCount(cfg.eliteFrac, candidates.length));

const bestTetrisLineShare = tetrisLineShares[bestIndex];
const eliteTetrisLineShare = median(elites.map((elite) => elite.tetrisLineShare));
```

Append these JSON fields:

```ts
bestTetrisLineShare,
medianTetrisLineShare: median(tetrisLineShares),
eliteTetrisLineShare,
```

Add `bestT4 ${(100 * bestTetrisLineShare).toFixed(1)}%` and `eliteT4 ${(100 * eliteTetrisLineShare).toFixed(1)}%` to the console line. Do not add these values to `updateCem` or publication comparison.

- [ ] **Step 5: Write failing dashboard parser tests**

Extend the canonical log fixture with:

```ts
bestTetrisLineShare: 0.25,
medianTetrisLineShare: 0.1,
eliteTetrisLineShare: 0.2,
```

Assert all three parse. In the optional-diagnostics test delete them and assert all default to `0`. Include them in the “never undefined numeric field” list.

- [ ] **Step 6: Update dashboard types, parser, and two summary cards**

Add all three numeric fields to `LogEntry` and normalize each with `num(e.field, 0)`. In `App.tsx`, add only:

```ts
['Best Tetris lines', `${(100 * latest.bestTetrisLineShare).toFixed(1)}%`],
['Elite Tetris lines', `${(100 * latest.eliteTetrisLineShare).toFixed(1)}%`],
```

Do not add a chart or change score-rate/sigma charts.

- [ ] **Step 7: Run focused tests and build**

```powershell
npm test -- training/cem.test.ts src/training/dashboard/useTrainingLog.test.ts src/training/dashboard/charts.test.ts
npm run typecheck:train
npm run build
```

Expected: PASS.

- [ ] **Step 8: Run independent review and fix all severities**

Require proof that score rates still control best index, elite membership, `updateCem`, and publication; review median semantics, percentage ranges, parser defaults, and dashboard scope. Fix all findings and rerun Step 7 until zero.

- [ ] **Step 9: Commit if authorized**

```powershell
git add -- training/cem.ts training/cem.test.ts training/train.ts src/training/dashboard/types.ts src/training/dashboard/useTrainingLog.ts src/training/dashboard/useTrainingLog.test.ts src/training/dashboard/App.tsx
git commit -m "feat(training): expose tetris strategy diagnostics"
```

---

### Task 6: Atomic score-rate-v2 Artifact, Reevaluation, and Weight Contract

**Files:**
- Modify: `src/ai/trainingObjective.ts:1-3`
- Modify: `src/ai/weights.ts` and `src/ai/weights.test.ts`
- Modify: `training/objective.ts:1-8`
- Modify: `training/runArtifacts.ts:1-223`
- Modify: `training/runArtifacts.test.ts:1-142`
- Modify: `training/train-cli.test.ts:1-82`
- Modify: `training/publication.ts:1-62`
- Modify: `training/publication.test.ts`
- Modify: `training/reevaluation.ts` and `training/reevaluation.test.ts`
- Modify: `training/reevaluationLog.ts:1-82`
- Modify: `training/reevaluationLog.test.ts:1-80`
- Modify: `training/train.ts:90-185,294-399`
- Modify: `src/training/dashboard/useTrainingLog.ts` and tests
- Modify: `src/training/dashboard/App.tsx:15-45`

**Interfaces:**
- Consumes: ten-dimensional current weights, `meanClearCounts`, `tetrisLineShares`, and existing fixed reevaluation schedule.
- Produces: `LEGACY_SCORE_RATE_OBJECTIVE = 'score-rate-v1'`, `SCORE_RATE_OBJECTIVE = 'score-rate-v2'`, checkpoint version 3, v2 default paths, and v3 published metadata.
- `ReevaluationSummary` gains `meanClearCounts` and `tetrisLineShare`; `evaluateScoreReevaluation` must continue reading only score and height.
- Artifact consistency tolerance: `1e-12 * max(1, abs(expected))` for derived score rate, mean lines, and tetris share.

- [ ] **Step 1: Write failing objective/path/schema tests**

Update `training/runArtifacts.test.ts` fixtures to version 3/objective v2 and add mean counts:

```ts
const meanClearCounts = {
  singles: 10,
  doubles: 20,
  triples: 20,
  tetrises: 460,
};

const validCheckpoint = () => ({
  version: 3,
  objective: 'score-rate-v2',
  gen: 2,
  mu: Array(FEATURE_COUNT).fill(0),
  sigma: Array(FEATURE_COUNT).fill(1),
  baseSeed: DEFAULT_CONFIG.baseSeed,
  maxPieces: 1200,
  config: { ...DEFAULT_CONFIG },
  bestEver: {
    weights: unitVector(),
    meanScore: 25000,
    scoreRate: 5,
    meanLines: 1950,
    meanHeight: 3.5,
    meanClearCounts: { ...meanClearCounts },
    tetrisLineShare: (4 * 460) / 1950,
    gen: 1,
    evalGames: 30,
    evalMaxPieces: 5000,
  },
});
```

Change the default-path expectation to `public/ai/score-rate-v2`. Add rejection tests by mutating complete `validCheckpoint()` values:

```ts
it('rejects the old objective before reading the rest of the checkpoint', () => {
  const path = join(temp(), 'checkpoint.json');
  const checkpoint = validCheckpoint();
  checkpoint.version = 2 as 3;
  checkpoint.objective = 'score-rate-v1' as 'score-rate-v2';
  writeFileSync(path, JSON.stringify(checkpoint));
  expect(() => readCompatibleCheckpoint(path)).toThrow(/score-rate-v1.*score-rate-v2/);
});

it('rejects an inconsistent tetris share', () => {
  const path = join(temp(), 'checkpoint.json');
  const checkpoint = validCheckpoint();
  checkpoint.bestEver!.tetrisLineShare = 0;
  writeFileSync(path, JSON.stringify(checkpoint));
  expect(() => readCompatibleCheckpoint(path)).toThrow(/tetrisLineShare/);
});

it('rejects mean lines inconsistent with clear counts', () => {
  const path = join(temp(), 'checkpoint.json');
  const checkpoint = validCheckpoint();
  checkpoint.bestEver!.meanLines = 1949;
  writeFileSync(path, JSON.stringify(checkpoint));
  expect(() => readCompatibleCheckpoint(path)).toThrow(/meanLines/);
});
```

- [ ] **Step 2: Add failing no-write CLI gates for v1 and malformed v2**

Update `training/train-cli.test.ts` so the old tagged checkpoint is version 2/objective v1 and expected error mentions v2. Make the malformed current checkpoint version 3/objective v2 with a nine-element `mu`. Preserve the sentinel directory/file byte checks proving rejection before workers or writes.

Run:

```powershell
npm test -- training/runArtifacts.test.ts training/train-cli.test.ts
```

Expected: FAIL because the current contract is still v1/schema 2/path v1.

- [ ] **Step 3: Define the new objective identity and strict checkpoint parser**

In `src/ai/trainingObjective.ts`:

```ts
export const LEGACY_SCORE_RATE_OBJECTIVE = 'score-rate-v1' as const;
export const SCORE_RATE_OBJECTIVE = 'score-rate-v2' as const;
export type ScoreRateObjective = typeof SCORE_RATE_OBJECTIVE;
```

Update `training/objective.ts` to re-export both objective constants while leaving the 0.1% tolerance and fixed 30 × 5000 publication constants unchanged.

Change `ScoreRateCheckpoint.version` to `3`, default output to `public/ai/score-rate-v2`, and require version 3/objective v2. Extend `ScoreRateBestEver` with:

```ts
meanClearCounts: LineClearCounts;
tetrisLineShare: number;
```

Add a parser that requires an object with exactly the four keys `singles/doubles/triples/tetrises`, each a non-negative finite number and with no extras. After parsing `bestEver`, verify:

```ts
assertClose(result.meanLines, totalLinesFromCounts(result.meanClearCounts), 'meanLines');
assertClose(result.tetrisLineShare, tetrisLineShare(result.meanClearCounts), 'tetrisLineShare');
```

Implement `assertClose` with the tolerance declared in this task. Keep the existing normalized-vector, config, fixed-schedule, maxPieces, and score-rate checks.

- [ ] **Step 4: Extend reevaluation summaries without changing decisions**

In `training/publication.ts`:

```ts
export interface ReevaluationSummary {
  meanScore: number;
  scoreRate: number;
  meanLines: number;
  meanHeight: number;
  meanClearCounts: LineClearCounts;
  tetrisLineShare: number;
}
```

Update publication fixtures through a helper that supplies valid default counts/share. Add a test where only clear counts/share differ and assert `evaluateScoreReevaluation` returns the same decision as before. Do not read these fields in the decision function.

Update `planReevaluation` tests only for the new objective/types; retain baseline + candidate ordering and fixed seeds.

- [ ] **Step 5: Snapshot new fields in reevaluation events**

Update `LoggedReevaluation` through its extended summary. Change `snapshot` to deep-copy both mutable fields:

```ts
const snapshot = (evaluation: LoggedReevaluation): LoggedReevaluation => ({
  ...evaluation,
  weights: evaluation.weights.slice(),
  meanClearCounts: { ...evaluation.meanClearCounts },
});
```

Extend `reevaluationLog.test.ts` to mutate the caller's weights and `meanClearCounts` after building the event, then prove the logged snapshot stays unchanged. Keep `seedStrategy: 'fixed-reevaluation-v1'` because the seed algorithm itself is unchanged.

- [ ] **Step 6: Write v3 weights and v3 checkpoints from the trainer**

Update `reevaluationSummary`:

```ts
return {
  meanScore: stats.meanScore[index],
  scoreRate: stats.fitness[index],
  meanLines: stats.meanLines[index],
  meanHeight: stats.meanHeight[index],
  meanClearCounts: stats.meanClearCounts[index],
  tetrisLineShare: stats.tetrisLineShares[index],
};
```

Update weight payload and checkpoint writes:

```ts
version: 3,
objective: SCORE_RATE_OBJECTIVE,
meanClearCounts: best.meanClearCounts,
tetrisLineShare: best.tetrisLineShare,
```

Ensure the baseline established from `DEFAULT_WEIGHTS` always runs through the current fixed 30 × 5000 evaluation and receives fresh counts/share; never copy v1 metadata as a current score baseline.

Extend reevaluation-event construction for both current best and candidate with counts/share. Keep write order unchanged: successful weight writes (if publishing), append event, then checkpoint.

- [ ] **Step 7: Make v3 weight parsing require v2 diagnostics**

Extend `WeightsFile` with:

```ts
meanClearCounts: LineClearCounts | null;
tetrisLineShare: number | null;
```

For version 1 and version 2/v1 return `null` for both. For version 3/v2 require a valid non-negative finite counts object, recompute total lines/share, and reject inconsistent `meanLines` or `tetrisLineShare`. Preserve the exact ten-key requirement from Task 2.

Update Task 2's version-3 parser fixture to include consistent metadata:

```ts
const meanClearCounts = { singles: 2, doubles: 1, triples: 0, tetrises: 3 };
const v2File = {
  version: 3,
  objective: 'score-rate-v2',
  weights: Object.fromEntries(FEATURE_NAMES.map((name, index) => [name, index])),
  meanScore: 123456,
  evalMaxPieces: 5000,
  meanLines: 16,
  meanHeight: 4,
  meanClearCounts,
  tetrisLineShare: 12 / 16,
  evalGames: 30,
  gen: 1,
  searchDepth: 2,
  trainedAt: '2026-08-06T00:00:00.000Z',
};
expect(parseWeightsFile(v2File)).not.toBeNull();
expect(parseWeightsFile({ ...v2File, tetrisLineShare: 0 })).toBeNull();
```

- [ ] **Step 8: Switch dashboard identity and path atomically**

Change `LOG_URL` to `/ai/score-rate-v2/training-log.jsonl`; parser objective filtering follows the new constant. Update all dashboard test fixtures to objective v2. Change both `App.tsx` subtitle paths from v1 to v2. Add a test proving a v1 generation line is ignored.

- [ ] **Step 9: Run focused artifact and publication gates**

```powershell
npm test -- src/ai/weights.test.ts training/runArtifacts.test.ts training/train-cli.test.ts training/publication.test.ts training/reevaluation.test.ts training/reevaluationLog.test.ts src/training/dashboard/useTrainingLog.test.ts
npm run typecheck:train
npm run build
```

Expected: PASS. The CLI tests must prove old/malformed checkpoints cause no worker-start marker and no file changes.

- [ ] **Step 10: Run independent review and fix all severities**

Require checks for objective/schema identity, exact vector length, counts/share arithmetic, parser downgrade resistance, first-baseline reevaluation, write ordering, reevaluation snapshots, unchanged score/height decision logic, v1 artifact isolation, and dashboard filtering. Fix all findings and rerun Step 9 until `Critical 0 / Important 0 / Minor 0`.

- [ ] **Step 11: Commit the atomic contract migration if authorized**

```powershell
git add -- src/ai/trainingObjective.ts src/ai/weights.ts src/ai/weights.test.ts training/objective.ts training/runArtifacts.ts training/runArtifacts.test.ts training/train-cli.test.ts training/publication.ts training/publication.test.ts training/reevaluation.ts training/reevaluation.test.ts training/reevaluationLog.ts training/reevaluationLog.test.ts training/train.ts src/training/dashboard/useTrainingLog.ts src/training/dashboard/useTrainingLog.test.ts src/training/dashboard/App.tsx
git commit -m "feat(training): introduce score-rate-v2 artifacts"
```

---

### Task 7: Handoff Update and Full Code-Only Verification

**Files:**
- Modify: `docs/ai-training-handoff.md`
- Verify: every file changed by Tasks 1–6
- Protected: `src/ai/trained-weights.json`, `public/ai/**`, `training-archive/**`

**Interfaces:**
- Consumes: complete code-ready score-rate-v2 implementation.
- Produces: current documentation and fresh code-gate evidence, without claiming trained strategy acceptance.

- [ ] **Step 1: Update the handoff with the exact transitional state**

Update the top-level status and code map to state all of the following explicitly:

```text
- Code/trainer contract: score-rate-v2, checkpoint schema 3, ten features.
- Scalar fitness remains meanScore / scheduled maxPieces.
- New feature: lineClearValue; clear histograms are diagnostic only.
- Default new output: public/ai/score-rate-v2/.
- Current tracked/runtime published model remains the version 2 score-rate-v1 gen-20 model until a separately authorized v2 run passes publication.
- v1 nine-key weights are adapted in memory with lineClearValue = 0.
- v1 checkpoints/logs are never resumed or appended by v2.
- No smoke, benchmark, training, fixed reevaluation, or publication was run during implementation.
- Code tests do not prove that a tetris strategy emerged.
```

Add links to the approved design and both implementation plans. Retain all existing process/artifact preflight and authorization warnings.

- [ ] **Step 2: Run exact-scope and protected-file checks**

```powershell
git status --short --untracked-files=all
git diff -- src/ai/trained-weights.json
git diff --stat
```

Expected: no trained-weight diff and no generated artifact path. Stop if unrelated WIP overlaps any planned file.

- [ ] **Step 3: Run the shortest integrated regression gate**

```powershell
npm test -- src/ai/lineClears.test.ts src/ai/features.test.ts src/ai/weights.test.ts src/ai/simulate.test.ts training/pool.test.ts training/benchSummary.test.ts training/cem.test.ts training/runArtifacts.test.ts training/train-cli.test.ts training/publication.test.ts training/reevaluation.test.ts training/reevaluationLog.test.ts src/training/dashboard/useTrainingLog.test.ts src/training/dashboard/charts.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the full current code gate**

```powershell
npm run lint
npm test
npm run build
npm run typecheck:train
```

Expected: all commands exit 0. Record fresh counts and outputs rather than copying historical results.

- [ ] **Step 5: Verify fitness and publication contracts explicitly**

Run focused tests again after the full gate:

```powershell
npm test -- training/cem.test.ts -t "scheduled maxPieces"
npm test -- training/cem.test.ts -t "height diagnostic"
npm test -- training/publication.test.ts
npm test -- training/train-cli.test.ts
```

Expected: scheduled denominator remains fixed, height remains diagnostic/tie-only, clear metrics cannot affect publication, and malformed/legacy checkpoints cause no writes.

- [ ] **Step 6: Recheck protected state and do not cross the runtime gate**

```powershell
git diff -- src/ai/trained-weights.json
git status --short --untracked-files=all
```

Do not run benchmark or training. Report code-ready status separately from runtime/model acceptance.

- [ ] **Step 7: Run the final independent review gate**

Review the entire plan diff against every design section. Require `Critical 0 / Important 0 / Minor 0`. Route each finding to its owning task, fix narrowly, rerun that task's focused gate, then rerun Steps 3–6.

- [ ] **Step 8: Commit the handoff update if authorized**

```powershell
git add -- docs/ai-training-handoff.md
git commit -m "docs: document score-rate-v2 implementation boundary"
```

## Post-Implementation Authorization Gate

This plan ends after code-only verification. A later, explicit user authorization is required before even a two-generation smoke run. At that time, perform a fresh preflight in this order:

1. Verify real HEAD, branch, dirty paths, Node processes/command lines, and listener provenance.
2. Inspect `public/ai/score-rate-v2-smoke/` directly, including checkpoint/log presence; Git status cannot reveal ignored artifacts.
3. Record hashes and diffs for `public/ai/best-weights.json` and tracked `src/ai/trained-weights.json` without printing sensitive data.
4. Explicitly choose an empty isolated output or refuse the run; never delete/move artifacts to bypass the fresh-run guard.
5. Only after authorization, the candidate smoke command is:

```powershell
npm run train -- --generations 2 --workers 4 --output-dir public/ai/score-rate-v2-smoke
```

The smoke proves signal movement and artifact safety only. If both `bestTetrisLineShare` and `eliteTetrisLineShare` remain below `0.01` for both generations, stop. No formal run is authorized. Any superiority or visible-tetris claim still requires the design's independent paired 30 × 5000 acceptance, including positive score-rate and tetris-share confidence intervals and `tetrisLineShare >= 0.20`.
