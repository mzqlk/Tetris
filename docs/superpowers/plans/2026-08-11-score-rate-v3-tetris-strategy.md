# Score-rate-v3 Stable Tetris Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dense, same-well Tetris setup features and an auditable score-rate-v3 training/acceptance pipeline that can produce a stable four-line strategy only when it also beats the published gen-40 score rate.

**Architecture:** Keep the shared pure afterstate evaluator, engine SRS placement enumeration, depth-2 search, and CEM score-rate fitness. Add one pure well-summary module, append three features without reordering the existing ten, propagate strategy/survival diagnostics through simulation and training, persist qualified candidates only inside the run directory, and use a separate fixed-schedule paired benchmark before any publication decision.

**Tech Stack:** TypeScript 5.6, Vitest 3, Node worker threads with `tsx`, React 18 dashboard, Vite 6, JSON/JSONL run artifacts.

## Global Constraints

- Work directly in the current workspace unless the user explicitly requests a branch or worktree.
- Read `docs/ai-training-handoff.md` before touching `src/ai/`, `training/`, checkpoints, or trained weights.
- Browser AI and Node training must continue sharing the pure logic under `src/ai/`; do not create a training-only evaluator.
- Keep `src/ai/` free of Node, DOM, filesystem APIs, and module-level mutable state, except the existing browser-only `loadWeights.ts` boundary.
- Preserve the first ten `FEATURE_NAMES` positions exactly; append `cleanWellDepth`, `tetrisSetupProgress`, and `tetrisReadyRows` in that order.
- Do not mutate board rows in place; placement enumeration must continue using engine rotation/SRS behavior.
- Keep scalar CEM fitness exactly `meanScore / scheduled maxPieces`; strategy and survival diagnostics never enter CEM sorting or updates.
- New contract: objective `score-rate-v3`, 13 weights, weight/checkpoint schema version 4, default output `public/ai/score-rate-v3/`.
- Version 1 and version 2 nine-key weights, plus version 3 ten-key weights, are extended only in memory; never rewrite legacy files during loading.
- Reject v1/v2/v3 checkpoints and logs from v4 resume/append; never delete, move, archive, or overwrite existing run artifacts to bypass a guard.
- Training, signal smoke, formal training, benchmark, paired acceptance, publication, and runtime/browser acceptance each require separate user authorization.
- The trainer may write `candidate-weights.json` only inside its selected run directory; it must never write `public/ai/best-weights.json` or `src/ai/trained-weights.json`.
- Stable-Tetris acceptance requires `tetrisLineShare >= 0.20`, survival not below gen-40, paired score-rate 95% CI lower bound `> 0`, and paired Tetris-line-share 95% CI lower bound `> 0`.
- Use exact pathspec staging for every commit; do not broad-add unrelated files or generated artifacts.

---

## File Structure

### New files

- `src/ai/tetrisStrategy.ts` — pure same-well summary, strategy diagnostic types, and arithmetic helpers.
- `src/ai/tetrisStrategy.test.ts` — synthetic-board contracts for well selection and diagnostic arithmetic.
- `training/pairedStats.ts` — pure paired confidence intervals and final acceptance decision.
- `training/pairedStats.test.ts` — fixed 30-pair statistical and gate tests.
- `training/pairedBench.ts` — read-only CLI that evaluates gen-40 and a v4 candidate on identical seeds.
- `training/pairedBench.test.ts` — paired CLI argument and fixed-schedule contract tests without running games.
- `training/candidateWeights.ts` — pure version-4 candidate payload builder plus run-local writer.
- `training/candidateWeights.test.ts` — exact schema and path-local serialization tests.

### Existing files with focused changes

- `src/ai/features.ts`, `src/ai/features.test.ts` — append three features and consume one `TetrisWellSummary`.
- `src/ai/trainingObjective.ts` — distinguish score-rate-v1, score-rate-v2, and current score-rate-v3 identities.
- `src/ai/weights.ts`, `src/ai/weights.test.ts` — 9/10/13-key parsing, in-memory zero extension, version-4 metadata.
- `src/ai/simulate.ts`, `src/ai/simulate.test.ts` — sample post-clear strategy diagnostics per lock.
- `training/pool.ts`, `training/pool.test.ts`, `training/worker.ts` — carry nested diagnostics and exact result reasons through workers.
- `training/cem.ts`, `training/cem.test.ts` — aggregate per-candidate strategy and survival diagnostics without changing fitness.
- `training/benchSummary.ts`, `training/benchSummary.test.ts`, `training/bench.ts` — report strategy and survival distributions.
- `training/publication.ts`, `training/publication.test.ts` — qualify candidates against the immutable published baseline.
- `training/reevaluation.ts`, `training/reevaluation.test.ts` — establish the baseline once and evaluate only the current mu afterward.
- `training/reevaluationLog.ts`, `training/reevaluationLog.test.ts` — persist baseline, prior qualified candidate, candidate, and qualification reason.
- `training/runArtifacts.ts`, `training/runArtifacts.test.ts` — version-4 fail-closed checkpoint/log/candidate replay.
- `training/config.ts`, `training/config.test.ts`, `training/objective.ts` — v3 default paths and fixed acceptance constants.
- `training/train.ts`, `training/train-cli.test.ts` — run-local candidate writes, no publication writes, new diagnostics.
- `src/training/dashboard/types.ts`, `useTrainingLog.ts`, `useTrainingLog.test.ts`, `App.tsx`, `chartColors.ts`, `charts.test.ts` — v3 log path, nested diagnostics, 13 feature colors.
- `package.json` — expose the read-only paired benchmark command.
- `README.md`, `docs/ai-training-handoff.md`, `docs/superpowers/specs/2026-08-11-score-rate-v3-tetris-strategy-design.md` — mark code-only completion without claiming training or publication.

---

### Task 1: Pure same-well summary and 13-dimensional feature vector

**Files:**
- Create: `src/ai/tetrisStrategy.ts`
- Create: `src/ai/tetrisStrategy.test.ts`
- Modify: `src/ai/features.ts:1-130`
- Modify: `src/ai/features.test.ts:1-145`
- Modify: `src/ai/search.test.ts:1-125`

**Interfaces:**
- Consumes: `Board`, `BOARD_WIDTH`, `TOTAL_ROWS`, and `columnHeights(board)`.
- Produces: `columnHeights(board)`, `TetrisWellSummary`, `StrategyDiagnostics`, `SurvivalDiagnostics`, `summarizeTetrisWell(board)`, `diagnosticsFromWell(summary)`, `emptyStrategyDiagnostics()`, `addStrategyDiagnostics(left, right)`, `divideStrategyDiagnostics(value, divisor)`, `SCORE_RATE_V2_FEATURE_NAMES`, and the 13-element `FEATURE_NAMES`.

- [ ] **Step 1: Write failing well-summary tests**

```ts
import { describe, expect, it } from 'vitest';
import { boardFrom } from './testUtils';
import {
  diagnosticsFromWell,
  summarizeTetrisWell,
} from './tetrisStrategy';

describe('summarizeTetrisWell', () => {
  it('returns a deterministic zero summary on an empty board', () => {
    expect(summarizeTetrisWell(boardFrom([]))).toEqual({
      column: 0, usableDepth: 0, setupCells: 0, readyRows: 0,
    });
  });

  it.each([
    ['left edge', ['.#########', '.#########', '.#########', '.#########'], 0],
    ['middle', ['####.#####', '####.#####', '####.#####', '####.#####'], 4],
    ['right edge', ['#########.', '#########.', '#########.', '#########.'], 9],
  ])('summarizes a complete %s Tetris well', (_label, rows, column) => {
    expect(summarizeTetrisWell(boardFrom(rows))).toEqual({
      column, usableDepth: 4, setupCells: 36, readyRows: 4,
    });
  });

  it('keeps all values tied to the same selected column', () => {
    const summary = summarizeTetrisWell(boardFrom([
      '####.#####', '####.#####', '####.#####', '####.####.',
    ]));
    expect(summary.column).toBe(4);
    expect(summary.readyRows).toBe(3);
    expect(summary.setupCells).toBe(35);
    expect(summary.usableDepth).toBe(4);
  });

  it('converts setup cells to a zero-to-four progress signal', () => {
    expect(diagnosticsFromWell({
      column: 9, usableDepth: 2, setupCells: 18, readyRows: 1,
    })).toEqual({
      meanCleanWellDepth: 2,
      meanTetrisSetupProgress: 2,
      meanTetrisReadyRows: 1,
    });
  });
});
```

- [ ] **Step 2: Run the new test and verify the missing-module failure**

Run: `npm test -- src/ai/tetrisStrategy.test.ts`

Expected: FAIL because `./tetrisStrategy` does not exist.

- [ ] **Step 3: Implement the pure summary and diagnostic helpers**

```ts
import type { Board } from '../types';
import { BOARD_WIDTH, TOTAL_ROWS } from '../constants';

export interface TetrisWellSummary {
  column: number;
  usableDepth: number;
  setupCells: number;
  readyRows: number;
}

export interface StrategyDiagnostics {
  meanCleanWellDepth: number;
  meanTetrisSetupProgress: number;
  meanTetrisReadyRows: number;
}

export interface SurvivalDiagnostics {
  pieceCapGames: number;
  gameoverGames: number;
}

export function columnHeights(board: Board): number[] {
  const heights = new Array<number>(BOARD_WIDTH).fill(0);
  for (let column = 0; column < BOARD_WIDTH; column++) {
    for (let row = 0; row < TOTAL_ROWS; row++) {
      if (board[row][column] !== 0) {
        heights[column] = TOTAL_ROWS - row;
        break;
      }
    }
  }
  return heights;
}

const zeroSummary = (column: number): TetrisWellSummary => ({
  column, usableDepth: 0, setupCells: 0, readyRows: 0,
});

const better = (left: TetrisWellSummary, right: TetrisWellSummary): boolean =>
  left.readyRows > right.readyRows ||
  (left.readyRows === right.readyRows && left.setupCells > right.setupCells) ||
  (left.readyRows === right.readyRows && left.setupCells === right.setupCells &&
    left.usableDepth > right.usableDepth) ||
  (left.readyRows === right.readyRows && left.setupCells === right.setupCells &&
    left.usableDepth === right.usableDepth && left.column < right.column);

export function summarizeTetrisWell(board: Board): TetrisWellSummary {
  const heights = columnHeights(board);
  let best = zeroSummary(0);
  for (let column = 0; column < BOARD_WIDTH; column++) {
    const targetHeight = heights[column];
    if (targetHeight + 4 > TOTAL_ROWS) continue;
    const left = column === 0 ? TOTAL_ROWS : heights[column - 1];
    const right = column === BOARD_WIDTH - 1 ? TOTAL_ROWS : heights[column + 1];
    const bottom = TOTAL_ROWS - targetHeight - 1;
    let setupCells = 0;
    let readyRows = 0;
    for (let row = bottom - 3; row <= bottom; row++) {
      let outside = 0;
      for (let c = 0; c < BOARD_WIDTH; c++) {
        if (c !== column && board[row][c] !== 0) outside++;
      }
      setupCells += outside;
      if (board[row][column] === 0 && outside === BOARD_WIDTH - 1) readyRows++;
    }
    const candidate = {
      column,
      usableDepth: Math.max(0, Math.min(4, Math.min(left, right) - targetHeight)),
      setupCells,
      readyRows,
    };
    if (better(candidate, best)) best = candidate;
  }
  return best;
}

export const diagnosticsFromWell = (well: TetrisWellSummary): StrategyDiagnostics => ({
  meanCleanWellDepth: well.usableDepth,
  meanTetrisSetupProgress: well.setupCells / 9,
  meanTetrisReadyRows: well.readyRows,
});

export const emptyStrategyDiagnostics = (): StrategyDiagnostics => ({
  meanCleanWellDepth: 0,
  meanTetrisSetupProgress: 0,
  meanTetrisReadyRows: 0,
});

export const addStrategyDiagnostics = (
  left: StrategyDiagnostics,
  right: StrategyDiagnostics,
): StrategyDiagnostics => ({
  meanCleanWellDepth: left.meanCleanWellDepth + right.meanCleanWellDepth,
  meanTetrisSetupProgress: left.meanTetrisSetupProgress + right.meanTetrisSetupProgress,
  meanTetrisReadyRows: left.meanTetrisReadyRows + right.meanTetrisReadyRows,
});

export function divideStrategyDiagnostics(
  value: StrategyDiagnostics,
  divisor: number,
): StrategyDiagnostics {
  if (!Number.isFinite(divisor) || divisor <= 0) throw new Error('divisor must be positive');
  return {
    meanCleanWellDepth: value.meanCleanWellDepth / divisor,
    meanTetrisSetupProgress: value.meanTetrisSetupProgress / divisor,
    meanTetrisReadyRows: value.meanTetrisReadyRows / divisor,
  };
}
```

Remove the old `columnHeights` body from `features.ts`, import it from `tetrisStrategy.ts`, and re-export it from `features.ts` so all existing consumers keep the same public import path without creating an import cycle.

- [ ] **Step 4: Add failing 13-feature order and extraction tests**

```ts
expect(SCORE_RATE_V2_FEATURE_NAMES).toEqual([
  ...LEGACY_FEATURE_NAMES, 'lineClearValue',
]);
expect(FEATURE_NAMES).toEqual([
  ...SCORE_RATE_V2_FEATURE_NAMES,
  'cleanWellDepth', 'tetrisSetupProgress', 'tetrisReadyRows',
]);
expect(FEATURE_COUNT).toBe(13);

const features = extractFeatures(
  boardFrom(['#########.', '#########.', '#########.', '#########.']),
  0,
  [{ x: 0, y: 0 }],
);
expect(features[FEATURE_NAMES.indexOf('cleanWellDepth')]).toBe(4);
expect(features[FEATURE_NAMES.indexOf('tetrisSetupProgress')]).toBe(4);
expect(features[FEATURE_NAMES.indexOf('tetrisReadyRows')]).toBe(4);
```

- [ ] **Step 5: Append the features without reordering the first ten**

```ts
export const SCORE_RATE_V2_FEATURE_NAMES = [
  ...LEGACY_FEATURE_NAMES, 'lineClearValue',
] as const;

export const FEATURE_NAMES = [
  ...SCORE_RATE_V2_FEATURE_NAMES,
  'cleanWellDepth', 'tetrisSetupProgress', 'tetrisReadyRows',
] as const;

// Inside extractFeatures, after boardAfter has already been cleared:
const strategy = diagnosticsFromWell(summarizeTetrisWell(boardAfter));

return [
  aggregateHeight,
  countHoles(boardAfter),
  bumpiness,
  maxHeight,
  linesCleared,
  landingHeight,
  rowTransitions(boardAfter),
  colTransitions(boardAfter),
  wellDepth(boardAfter, heights),
  lineClearValue(linesCleared),
  strategy.meanCleanWellDepth,
  strategy.meanTetrisSetupProgress,
  strategy.meanTetrisReadyRows,
];
```

- [ ] **Step 6: Run focused tests**

Add one search integration test before running the suite:

```ts
it('selects the legal placement with the greatest Tetris setup progress', () => {
  const board = boardFrom(['#########.', '#########.']);
  const piece = createPiece(2);
  const weights = only('tetrisSetupProgress');
  const optionScores = enumeratePlacements(board, piece)
    .map((placement) => evalMove(board, placement, weights).score);
  const decision = bestPlacement(board, piece, null, weights, 1)!;
  expect(decision.score).toBe(Math.max(...optionScores));
  expect(decision.score).toBeGreaterThan(0);
});
```

Run: `npm test -- src/ai/tetrisStrategy.test.ts src/ai/features.test.ts src/ai/search.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the pure feature slice**

```powershell
git add -- src/ai/tetrisStrategy.ts src/ai/tetrisStrategy.test.ts src/ai/features.ts src/ai/features.test.ts src/ai/search.test.ts
git commit -m "feat(ai): add stable tetris setup features"
```

---

### Task 2: Score-rate-v3 identity and weight compatibility

**Files:**
- Modify: `src/ai/trainingObjective.ts`
- Modify: `src/ai/weights.ts`
- Modify: `src/ai/weights.test.ts`
- Modify: `src/ai/simulate.test.ts:270-330`

**Interfaces:**
- Consumes: `LEGACY_FEATURE_NAMES`, `SCORE_RATE_V2_FEATURE_NAMES`, `FEATURE_NAMES`, strategy/survival diagnostic types.
- Produces: `SCORE_RATE_V2_OBJECTIVE`, current `SCORE_RATE_OBJECTIVE = 'score-rate-v3'`, exact version-4 `WeightsFile`, and zero-extended version 1/2/3 parsing.

- [ ] **Step 1: Write failing objective and compatibility tests**

```ts
const v3File = {
  version: 3,
  objective: 'score-rate-v2',
  weights: Object.fromEntries(SCORE_RATE_V2_FEATURE_NAMES.map((name, index) => [name, index])),
  meanScore: 3_289_243.3333333335,
  evalMaxPieces: 5000,
  meanLines: 1998,
  meanHeight: 4,
  meanClearCounts: { singles: 1456, doubles: 265, triples: 4, tetrises: 0 },
  tetrisLineShare: 0,
  evalGames: 30,
  gen: 40,
  searchDepth: 2,
  trainedAt: '2026-08-10T12:21:46.191Z',
};

it('zero-extends score-rate-v2 weights without rewriting metadata', () => {
  const parsed = parseWeightsFile(v3File)!;
  expect(parsed.objective).toBe('score-rate-v2');
  expect(parsed.weights.cleanWellDepth).toBe(0);
  expect(parsed.weights.tetrisSetupProgress).toBe(0);
  expect(parsed.weights.tetrisReadyRows).toBe(0);
  expect(Object.keys(parsed.weights)).toEqual([...FEATURE_NAMES]);
});

const v4File = {
  ...v3File,
  version: 4,
  objective: 'score-rate-v3',
  weights: Object.fromEntries(FEATURE_NAMES.map((name, index) => [name, index / 13])),
  strategyDiagnostics: {
    meanCleanWellDepth: 3,
    meanTetrisSetupProgress: 2.5,
    meanTetrisReadyRows: 1,
  },
  survivalDiagnostics: { pieceCapGames: 30, gameoverGames: 0 },
};

it('requires exact version-4 strategy and survival metadata', () => {
  expect(parseWeightsFile(v4File)).toMatchObject({
    version: 4,
    objective: 'score-rate-v3',
    strategyDiagnostics: v4File.strategyDiagnostics,
    survivalDiagnostics: v4File.survivalDiagnostics,
  });
  expect(parseWeightsFile({ ...v4File, strategyDiagnostics: null })).toBeNull();
  expect(parseWeightsFile({ ...v4File, survivalDiagnostics: { pieceCapGames: 31, gameoverGames: 0 } })).toBeNull();
});
```

- [ ] **Step 2: Run the weight tests and verify they fail on the old 10-key contract**

Run: `npm test -- src/ai/weights.test.ts`

Expected: FAIL because score-rate-v3/version 4 is not recognized and version 3 does not append three zeros.

- [ ] **Step 3: Add explicit three-generation objective constants**

```ts
export const LEGACY_SCORE_RATE_OBJECTIVE = 'score-rate-v1' as const;
export const SCORE_RATE_V2_OBJECTIVE = 'score-rate-v2' as const;
export const SCORE_RATE_OBJECTIVE = 'score-rate-v3' as const;
export type ScoreRateObjective = typeof SCORE_RATE_OBJECTIVE;
```

- [ ] **Step 4: Implement exact 9/10/13-key parsing**

```ts
const zeroV3 = {
  cleanWellDepth: 0,
  tetrisSetupProgress: 0,
  tetrisReadyRows: 0,
} as const;

if (version === 1 && !objectiveDeclared) {
  const legacy = parseExactWeights(raw, LEGACY_FEATURE_NAMES);
  if (legacy === null) return null;
  weights = { ...legacy, lineClearValue: 0, ...zeroV3 } as Weights;
} else if (version === 2 && objective === LEGACY_SCORE_RATE_OBJECTIVE) {
  const legacy = parseExactWeights(raw, LEGACY_FEATURE_NAMES);
  if (legacy === null) return null;
  weights = { ...legacy, lineClearValue: 0, ...zeroV3 } as Weights;
} else if (version === 3 && objective === SCORE_RATE_V2_OBJECTIVE) {
  const v2 = parseExactWeights(raw, SCORE_RATE_V2_FEATURE_NAMES);
  if (v2 === null) return null;
  weights = { ...v2, ...zeroV3 } as Weights;
  // Require meanScore, evalMaxPieces, meanLines, meanHeight, meanClearCounts,
  // tetrisLineShare, evalGames, gen, searchDepth, and trainedAt exactly as the
  // current version-3 parser does.
} else if (version === 4 && objective === SCORE_RATE_OBJECTIVE) {
  const current = parseExactWeights(raw, FEATURE_NAMES);
  if (current === null) return null;
  weights = current as Weights;
  // Require all v3 score metadata plus exact nested strategy/survival diagnostics.
} else {
  return null;
}
```

Extend `WeightsFile` with nullable `strategyDiagnostics` and `survivalDiagnostics`. Validate every strategy value as finite and within `cleanWellDepth 0..4`, `tetrisSetupProgress 0..4`, `tetrisReadyRows 0..4`. Validate survival counts as safe integers in `0..evalGames` and require `pieceCapGames + gameoverGames <= evalGames`.

- [ ] **Step 5: Extend handcrafted and test weight objects with three trailing zeros**

```ts
export const HANDCRAFTED_WEIGHTS: Weights = fromVector(normalize([
  -0.3, -0.6, -0.2, -0.1, 0.25, -0.35, -0.3, -0.4, -0.2, 0,
  0, 0, 0,
]));
```

Update every typed `Weights` fixture to include the three new keys. Do not edit `src/ai/trained-weights.json`; its version-3 ten-key payload must exercise the loader adapter.

- [ ] **Step 6: Pin gen-40 zero-extension compatibility**

Keep the existing fixed-seed expected results in `simulate.test.ts` unchanged and add:

```ts
expect(DEFAULT_WEIGHTS.cleanWellDepth).toBe(0);
expect(DEFAULT_WEIGHTS.tetrisSetupProgress).toBe(0);
expect(DEFAULT_WEIGHTS.tetrisReadyRows).toBe(0);
expect(DEFAULT_WEIGHTS_META).toMatchObject({ version: 3, objective: 'score-rate-v2', gen: 40 });
```

- [ ] **Step 7: Run focused compatibility tests**

Run: `npm test -- src/ai/weights.test.ts src/ai/simulate.test.ts`

Expected: PASS with the existing gen-40 seed/score/lines/height snapshots unchanged.

- [ ] **Step 8: Commit the contract migration**

```powershell
git add -- src/ai/trainingObjective.ts src/ai/weights.ts src/ai/weights.test.ts src/ai/simulate.test.ts
git commit -m "feat(ai): add score-rate-v3 weight contract"
```

---

### Task 3: Post-clear strategy diagnostics through simulation and workers

**Files:**
- Modify: `src/ai/simulate.ts`
- Modify: `src/ai/simulate.test.ts`
- Modify: `training/pool.ts`
- Modify: `training/pool.test.ts`
- Verify unchanged pass-through: `training/worker.ts`

**Interfaces:**
- Consumes: `summarizeTetrisWell`, diagnostic arithmetic, `SimResult.reason`.
- Produces: `SimState.strategyDiagnosticSum`, `SimResult.strategyDiagnostics`, exact `SimTaskResult.reason: 'gameover' | 'pieceCap' | 'error'`, and zero diagnostics for failed workers.

- [ ] **Step 1: Write failing post-clear sampling tests**

```ts
it('samples strategy diagnostics after the clear', () => {
  const { sim } = seedBoth(boardFrom(Array(4).fill('.#########')));
  const placement = enumeratePlacements(sim.board, sim.currentPiece!).find((p) =>
    getPieceCells(p.piece).every((cell) => cell.x === 0),
  )!;
  for (const move of placement.moves) {
    applyAction(sim, (move === 'down' ? 'softDrop' : move) as SimAction);
  }
  applyAction(sim, 'hardDrop');
  expect(sim.lines).toBe(4);
  expect(sim.strategyDiagnosticSum).toEqual(emptyStrategyDiagnostics());
});

it('reports finite per-piece strategy means', () => {
  const result = simulateGame({
    weights: toVector(DEFAULT_WEIGHTS), seed: 7, maxPieces: 60, depth: 2,
  });
  expect(result.strategyDiagnostics).toEqual(expect.objectContaining({
    meanCleanWellDepth: expect.any(Number),
    meanTetrisSetupProgress: expect.any(Number),
    meanTetrisReadyRows: expect.any(Number),
  }));
  Object.values(result.strategyDiagnostics).forEach((value) => expect(Number.isFinite(value)).toBe(true));
});
```

- [ ] **Step 2: Run the simulation test and verify missing fields**

Run: `npm test -- src/ai/simulate.test.ts`

Expected: FAIL because the state/result does not contain strategy diagnostics.

- [ ] **Step 3: Accumulate diagnostics immediately after clear**

```ts
// SimState
strategyDiagnosticSum: StrategyDiagnostics;

// createSimState
strategyDiagnosticSum: emptyStrategyDiagnostics(),

// lockAndSpawn, after state.board = newBoard and before spawning the next piece
state.strategyDiagnosticSum = addStrategyDiagnostics(
  state.strategyDiagnosticSum,
  diagnosticsFromWell(summarizeTetrisWell(newBoard)),
);

// simulateGame result
strategyDiagnostics: state.pieces === 0
  ? emptyStrategyDiagnostics()
  : divideStrategyDiagnostics(state.strategyDiagnosticSum, state.pieces),
```

Keep height and strategy sampling adjacent so both are visibly post-clear metrics.

- [ ] **Step 4: Add failing worker parity and failure-default tests**

```ts
expect(viaWorker.strategyDiagnostics).toEqual(direct.strategyDiagnostics);
expect(viaWorker.reason).toBe(direct.reason);
expect(FAILED_RESULT.strategyDiagnostics).toEqual(emptyStrategyDiagnostics());
expect(FAILED_RESULT.reason).toBe('error');
```

- [ ] **Step 5: Tighten worker result types and defaults**

```ts
export const FAILED_RESULT = {
  lines: 0,
  clearCounts: emptyLineClearCounts(),
  score: 0,
  pieces: 0,
  meanHeight: TOTAL_ROWS,
  strategyDiagnostics: emptyStrategyDiagnostics(),
  reason: 'error',
} as const;

export interface SimTaskResult {
  // existing fields
  strategyDiagnostics: StrategyDiagnostics;
  reason: 'gameover' | 'pieceCap' | 'error';
  failed: boolean;
  error?: string;
}
```

Continue cloning `clearCounts` and strategy diagnostics for each failed result so two failures share no mutable nested object.

- [ ] **Step 6: Run focused simulation/worker tests**

Run: `npm test -- src/ai/simulate.test.ts training/pool.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the simulation slice**

```powershell
git add -- src/ai/simulate.ts src/ai/simulate.test.ts training/pool.ts training/pool.test.ts
git commit -m "feat(ai): report tetris strategy diagnostics"
```

---

### Task 4: Candidate aggregation and benchmark observability

**Files:**
- Modify: `training/cem.ts`
- Modify: `training/cem.test.ts`
- Modify: `training/benchSummary.ts`
- Modify: `training/benchSummary.test.ts`
- Modify: `training/bench.ts`

**Interfaces:**
- Consumes: per-game `strategyDiagnostics` and exact result reasons.
- Produces: `CandidateStats.meanStrategyDiagnostics`, `CandidateStats.survivalDiagnostics`, benchmark strategy distributions, and explicit capped/gameover counts.

- [ ] **Step 1: Write failing CEM aggregation tests**

Extend the `result()` fixture with `strategyDiagnostics` and `reason`, then add:

```ts
it('averages strategy diagnostics per game and counts exact end reasons', () => {
  const stats = aggregateFitness([
    result({
      score: 1000,
      reason: 'pieceCap',
      strategyDiagnostics: {
        meanCleanWellDepth: 4,
        meanTetrisSetupProgress: 3,
        meanTetrisReadyRows: 2,
      },
    }),
    result({
      score: 800,
      reason: 'gameover',
      strategyDiagnostics: {
        meanCleanWellDepth: 2,
        meanTetrisSetupProgress: 1,
        meanTetrisReadyRows: 0,
      },
    }),
  ], 1, 2, 300);

  expect(stats.meanStrategyDiagnostics).toEqual([{
    meanCleanWellDepth: 3,
    meanTetrisSetupProgress: 2,
    meanTetrisReadyRows: 1,
  }]);
  expect(stats.survivalDiagnostics).toEqual([{ pieceCapGames: 1, gameoverGames: 1 }]);
  expect(stats.fitness).toEqual([3]);
});
```

- [ ] **Step 2: Run the CEM test and verify missing aggregation fields**

Run: `npm test -- training/cem.test.ts`

Expected: FAIL on `meanStrategyDiagnostics` and `survivalDiagnostics`.

- [ ] **Step 3: Implement diagnostic aggregation without touching fitness**

```ts
export interface CandidateStats {
  // existing arrays
  meanStrategyDiagnostics: StrategyDiagnostics[];
  survivalDiagnostics: SurvivalDiagnostics[];
}

// Per candidate:
let strategy = emptyStrategyDiagnostics();
let pieceCapGames = 0;
let gameoverGames = 0;

strategy = addStrategyDiagnostics(strategy, r.strategyDiagnostics);
if (r.reason === 'pieceCap') pieceCapGames++;
if (r.reason === 'gameover') gameoverGames++;

meanStrategyDiagnostics.push(divideStrategyDiagnostics(strategy, gamesPerCandidate));
survivalDiagnostics.push({ pieceCapGames, gameoverGames });
fitness.push(candidateMeanScore / maxPieces);
```

- [ ] **Step 4: Add failing benchmark summary tests**

```ts
expect(summary.strategy.cleanWellDepth).toEqual({ mean: 3, median: 3, min: 2, max: 4 });
expect(summary.strategy.tetrisSetupProgress.mean).toBe(2);
expect(summary.strategy.tetrisReadyRows.mean).toBe(1);
expect(summary.cappedGames).toBe(1);
expect(summary.gameoverGames).toBe(1);
```

- [ ] **Step 5: Extend benchmark summary and console output**

```ts
export interface BenchSummary {
  // existing fields
  gameoverGames: number;
  strategy: {
    cleanWellDepth: Distribution;
    tetrisSetupProgress: Distribution;
    tetrisReadyRows: Distribution;
  };
}

strategy: {
  cleanWellDepth: distribution(results.map((r) => r.strategyDiagnostics.meanCleanWellDepth)),
  tetrisSetupProgress: distribution(results.map((r) => r.strategyDiagnostics.meanTetrisSetupProgress)),
  tetrisReadyRows: distribution(results.map((r) => r.strategyDiagnostics.meanTetrisReadyRows)),
},
gameoverGames: results.filter((result) => result.reason === 'gameover').length,
```

Print the three strategy means below Tetris line share and print `capped/gameover/total` together. Do not add them to score-per-piece.

- [ ] **Step 6: Run focused aggregation and benchmark tests**

Run: `npm test -- training/cem.test.ts training/benchSummary.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit aggregation and reporting**

```powershell
git add -- training/cem.ts training/cem.test.ts training/benchSummary.ts training/benchSummary.test.ts training/bench.ts
git commit -m "feat(training): aggregate tetris strategy diagnostics"
```

---

### Task 5: Candidate qualification and paired acceptance statistics

**Files:**
- Modify: `training/objective.ts`
- Modify: `training/publication.ts`
- Modify: `training/publication.test.ts`
- Modify: `training/reevaluationLog.ts`
- Modify: `training/reevaluationLog.test.ts`
- Create: `training/pairedStats.ts`
- Create: `training/pairedStats.test.ts`

**Interfaces:**
- Consumes: `ReevaluationSummary` with line-clear, strategy, and survival diagnostics.
- Produces: `TETRIS_LINE_SHARE_THRESHOLD = 0.20`, `evaluateTetrisCandidate(candidate, publishedBaseline, currentQualified)`, `CandidateQualification`, `pairedInterval30(values)`, and `evaluatePairedAcceptance(baselineGames, candidateGames, maxPieces)`.

- [ ] **Step 1: Write failing candidate-qualification tests**

```ts
const evaluation = (overrides: Partial<ReevaluationSummary> = {}): ReevaluationSummary => ({
  meanScore: 3_300_000,
  scoreRate: 660,
  meanLines: 1998,
  meanHeight: 4,
  meanClearCounts: { singles: 1000, doubles: 100, triples: 0, tetrises: 199.5 },
  tetrisLineShare: 798 / 1998,
  strategyDiagnostics: {
    meanCleanWellDepth: 3,
    meanTetrisSetupProgress: 2,
    meanTetrisReadyRows: 1,
  },
  survivalDiagnostics: { pieceCapGames: 30, gameoverGames: 0 },
  ...overrides,
});

it('qualifies only a material score improvement with stable Tetris and survival', () => {
  const baseline = evaluation({
    meanScore: 3_289_243.33,
    scoreRate: 657.8487,
    meanClearCounts: { singles: 1998, doubles: 0, triples: 0, tetrises: 0 },
    tetrisLineShare: 0,
  });
  expect(evaluateTetrisCandidate(evaluation(), baseline, null)).toMatchObject({
    shouldSave: true,
    reason: 'qualified',
    scoreQualified: true,
    tetrisQualified: true,
    survivalQualified: true,
  });
});

it.each([
  ['score-not-higher', { meanScore: 3_290_000 }],
  ['tetris-share-too-low', { tetrisLineShare: 0.199999 }],
  ['survival-lower', { survivalDiagnostics: { pieceCapGames: 29, gameoverGames: 1 } }],
])('rejects %s', (reason, overrides) => {
  const baseline = evaluation({
    meanScore: 3_289_243.33,
    scoreRate: 657.8487,
    meanClearCounts: { singles: 1998, doubles: 0, triples: 0, tetrises: 0 },
    tetrisLineShare: 0,
  });
  expect(evaluateTetrisCandidate(evaluation(overrides), baseline, null).reason).toBe(reason);
});

it('keeps a higher-scoring qualified candidate from the same fixed schedule', () => {
  const baseline = evaluation({
    meanScore: 3_289_243.33,
    scoreRate: 657.8487,
    meanClearCounts: { singles: 1998, doubles: 0, triples: 0, tetrises: 0 },
    tetrisLineShare: 0,
  });
  const currentQualified = evaluation({ meanScore: 3_350_000, scoreRate: 670 });
  expect(evaluateTetrisCandidate(evaluation(), baseline, currentQualified).reason)
    .toBe('not-better-qualified-candidate');
});
```

- [ ] **Step 2: Run publication tests and verify the old score/height-only result**

Run: `npm test -- training/publication.test.ts`

Expected: FAIL because the old decision does not enforce Tetris share or survival.

- [ ] **Step 3: Implement exact qualification precedence**

```ts
export const TETRIS_LINE_SHARE_THRESHOLD = 0.20;

export type CandidateQualificationReason =
  | 'qualified'
  | 'score-not-higher'
  | 'tetris-share-too-low'
  | 'survival-lower'
  | 'not-better-qualified-candidate';

export interface CandidateQualification {
  shouldSave: boolean;
  reason: CandidateQualificationReason;
  scoreTolerance: number;
  scoreQualified: boolean;
  tetrisQualified: boolean;
  survivalQualified: boolean;
  betterThanCurrent: boolean;
}

export function evaluateTetrisCandidate(
  candidate: ReevaluationSummary,
  publishedBaseline: ReevaluationSummary,
  currentQualified: ReevaluationSummary | null,
): CandidateQualification {
  const scale = Math.max(Math.abs(candidate.meanScore), Math.abs(publishedBaseline.meanScore));
  const scoreTolerance = SCORE_TIE_RELATIVE_TOLERANCE * scale;
  const scoreQualified = candidate.meanScore > publishedBaseline.meanScore + scoreTolerance;
  const tetrisQualified = candidate.tetrisLineShare >= TETRIS_LINE_SHARE_THRESHOLD;
  const survivalQualified = candidate.survivalDiagnostics.pieceCapGames >=
    publishedBaseline.survivalDiagnostics.pieceCapGames;
  const betterThanCurrent = currentQualified === null ||
    candidate.meanScore > currentQualified.meanScore;

  const reason: CandidateQualificationReason =
    !scoreQualified ? 'score-not-higher'
    : !tetrisQualified ? 'tetris-share-too-low'
    : !survivalQualified ? 'survival-lower'
    : !betterThanCurrent ? 'not-better-qualified-candidate'
    : 'qualified';

  return {
    shouldSave: reason === 'qualified',
    reason,
    scoreTolerance,
    scoreQualified,
    tetrisQualified,
    survivalQualified,
    betterThanCurrent,
  };
}
```

- [ ] **Step 4: Replace reevaluation log semantics with auditable qualification**

The exact event shape is:

```ts
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
  publishedBaseline: LoggedReevaluation;
  currentQualified: LoggedReevaluation | null;
  candidate: LoggedReevaluation;
  qualification: CandidateQualification & {
    scoreDelta: number;
    scoreRateDelta: number;
    tetrisLineShareDelta: number;
    pieceCapGamesDelta: number;
    decision: 'save-candidate' | 'keep-current';
  };
}
```

Snapshot every vector, clear-count object, strategy object, and survival object. Tests must mutate all original nested values after construction and prove the log event is unchanged.

- [ ] **Step 5: Write failing paired-statistics tests**

```ts
it('computes the fixed 30-pair 95 percent interval', () => {
  const values = Array.from({ length: 30 }, (_, index) => 8 + (index % 3) - 1);
  const interval = pairedInterval30(values);
  expect(interval.mean).toBeCloseTo(8, 12);
  expect(interval.lower).toBeLessThan(interval.mean);
  expect(interval.upper).toBeGreaterThan(interval.mean);
});

it('accepts only when score, Tetris share, and survival all pass', () => {
  const pairedGame = (
    score: number,
    tetrisLineShare: 0 | 0.25,
    reason: 'pieceCap' | 'gameover',
  ) => ({
    score,
    reason,
    clearCounts: tetrisLineShare === 0
      ? { singles: 16, doubles: 0, triples: 0, tetrises: 0 }
      : { singles: 12, doubles: 0, triples: 0, tetrises: 1 },
  });
  const baseline = Array.from({ length: 30 }, () => pairedGame(3_000_000, 0, 'pieceCap'));
  const candidate = Array.from({ length: 30 }, () => pairedGame(3_100_000, 0.25, 'pieceCap'));
  expect(evaluatePairedAcceptance(baseline, candidate, 5000)).toMatchObject({
    accepted: true,
    candidateTetrisLineShare: 0.25,
    baselinePieceCapGames: 30,
    candidatePieceCapGames: 30,
  });
});
```

- [ ] **Step 6: Implement the fixed 30-pair statistics**

```ts
const T_95_DF_29 = 2.045229642132703;

export interface PairedInterval {
  mean: number;
  lower: number;
  upper: number;
}

export interface PairedGameResult {
  score: number;
  reason: 'pieceCap' | 'gameover';
  clearCounts: LineClearCounts;
}

export function pairedInterval30(values: readonly number[]): PairedInterval {
  if (values.length !== 30 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('paired acceptance requires exactly 30 finite values');
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  const margin = T_95_DF_29 * Math.sqrt(variance / values.length);
  return { mean, lower: mean - margin, upper: mean + margin };
}
```

`evaluatePairedAcceptance` must derive each game's score rate from the scheduled denominator, derive each game's Tetris share from its clear histogram, aggregate candidate Tetris share from total lines, count exact `pieceCap` reasons, and require all four global acceptance gates.

- [ ] **Step 7: Run qualification and paired-stat tests**

Run: `npm test -- training/publication.test.ts training/reevaluationLog.test.ts training/pairedStats.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit qualification and statistics**

```powershell
git add -- training/objective.ts training/publication.ts training/publication.test.ts training/reevaluationLog.ts training/reevaluationLog.test.ts training/pairedStats.ts training/pairedStats.test.ts
git commit -m "feat(training): qualify stable tetris candidates"
```

---

### Task 6: Version-4 checkpoint, log replay, and run-local candidate contract

**Files:**
- Modify: `training/config.ts`
- Modify: `training/config.test.ts`
- Modify: `training/reevaluation.ts`
- Modify: `training/reevaluation.test.ts`
- Modify: `training/runArtifacts.ts`
- Modify: `training/runArtifacts.test.ts`
- Create: `training/candidateWeights.ts`
- Create: `training/candidateWeights.test.ts`

**Interfaces:**
- Consumes: version-4 weights metadata, `CandidateQualification`, and fixed schedule constants.
- Produces: `ScoreRateEvaluation`, version-4 `ScoreRateCheckpoint`, `publishedBaseline`, `bestQualifiedCandidate`, `RunPaths.candidate`, and strict replay of `save-candidate` decisions.

- [ ] **Step 1: Write failing path and schema tests**

```ts
it('uses an isolated score-rate-v3 directory and candidate path', () => {
  expect(resolveRunPaths(ROOT, null)).toEqual({
    outputDir: resolve(ROOT, 'public/ai/score-rate-v3'),
    checkpoint: resolve(ROOT, 'public/ai/score-rate-v3/checkpoint.json'),
    log: resolve(ROOT, 'public/ai/score-rate-v3/training-log.jsonl'),
    candidate: resolve(ROOT, 'public/ai/score-rate-v3/candidate-weights.json'),
  });
});

it('rejects a version-3 score-rate-v2 checkpoint', () => {
  writeFileSync(path, JSON.stringify({ ...validCheckpoint(), version: 3, objective: 'score-rate-v2' }));
  expect(() => readCompatibleCheckpoint(path)).toThrow(/score-rate-v3|version 4/);
});
```

- [ ] **Step 2: Define exact version-4 checkpoint types**

```ts
export interface ScoreRateEvaluation extends ReevaluationSummary {
  weights: number[];
  gen: number;
  evalGames: number;
  evalMaxPieces: number;
}

export interface ScoreRateCheckpoint {
  version: 4;
  objective: typeof SCORE_RATE_OBJECTIVE;
  gen: number;
  mu: number[];
  sigma: number[];
  baseSeed: number;
  maxPieces: number;
  config: TrainConfig;
  publishedBaseline: ScoreRateEvaluation | null;
  bestQualifiedCandidate: ScoreRateEvaluation | null;
}
```

Replace the old `bestEver` field rather than retaining both semantics. Exact checkpoint keys, evaluation keys, strategy keys, survival keys, generation keys, reevaluation keys, schedule keys, and qualification keys must each be declared once and validated with `exactKeys`.

- [ ] **Step 3: Update the reevaluation plan to establish only the immutable baseline**

```ts
export function planReevaluation(
  publishedBaseline: ReevaluationSummary | null,
  publishedWeights: number[],
  candidateWeights: number[],
): ReevaluationPlan {
  return publishedBaseline === null
    ? { weights: [publishedWeights, candidateWeights], baselineIndex: 0, candidateIndex: 1 }
    : { weights: [candidateWeights], baselineIndex: null, candidateIndex: 0 };
}
```

The baseline evaluation gets `gen: -1` and never changes after the first fixed reevaluation.

- [ ] **Step 4: Implement fail-closed version-4 parsing and replay**

Replay rules:

1. Generation records are continuous from 0 and reconstruct the piece-cap schedule.
2. Every configured reevaluation generation appears exactly once.
3. The first event includes the generation `-1` published baseline; later events reproduce it byte-for-byte by value.
4. Each event's `currentQualified` equals the replayed qualified candidate or is null before the first qualification.
5. `save-candidate` replaces the replayed qualified candidate with the event candidate; `keep-current` preserves it.
6. Final replayed baseline and qualified candidate equal checkpoint fields.
7. If a candidate file exists, it must parse as version 4 and match `bestQualifiedCandidate`; if no qualified candidate exists, a candidate file is forbidden.
8. All validation happens before worker creation or writes.

- [ ] **Step 5: Write failing candidate payload tests**

```ts
it('builds an exact version-4 candidate without publication paths', () => {
  expect(buildCandidateWeights(evaluation, 2, '2026-08-11T00:00:00.000Z')).toEqual({
    version: 4,
    weights: fromVector(evaluation.weights),
    objective: 'score-rate-v3',
    meanScore: evaluation.meanScore,
    evalMaxPieces: evaluation.evalMaxPieces,
    meanLines: evaluation.meanLines,
    meanHeight: evaluation.meanHeight,
    meanClearCounts: evaluation.meanClearCounts,
    tetrisLineShare: evaluation.tetrisLineShare,
    strategyDiagnostics: evaluation.strategyDiagnostics,
    survivalDiagnostics: evaluation.survivalDiagnostics,
    evalGames: evaluation.evalGames,
    gen: evaluation.gen,
    searchDepth: 2,
    trainedAt: '2026-08-11T00:00:00.000Z',
  });
});
```

- [ ] **Step 6: Implement the run-local candidate writer**

`writeCandidateWeights(path, payload)` accepts the already-resolved `RunPaths.candidate`, writes only that path, and does not know `BEST_PUBLIC` or `BEST_SRC`. Validate the payload through `parseWeightsFile` before writing; reject if parsing returns null.

- [ ] **Step 7: Run artifact tests**

Run: `npm test -- training/config.test.ts training/reevaluation.test.ts training/runArtifacts.test.ts training/candidateWeights.test.ts`

Expected: PASS, including v2/v3 resume rejection and candidate replay.

- [ ] **Step 8: Commit artifact contracts**

```powershell
git add -- training/config.ts training/config.test.ts training/reevaluation.ts training/reevaluation.test.ts training/runArtifacts.ts training/runArtifacts.test.ts training/candidateWeights.ts training/candidateWeights.test.ts
git commit -m "feat(training): add score-rate-v3 run artifacts"
```

---

### Task 7: Trainer orchestration with candidate-only writes

**Files:**
- Modify: `training/train.ts`
- Modify: `training/train-cli.test.ts`

**Interfaces:**
- Consumes: v4 checkpoint/run paths, candidate qualification, nested diagnostics, `writeCandidateWeights`.
- Produces: v3 generation logs, fixed reevaluation logs, immutable baseline, run-local qualified candidate, and zero publication writes.

- [ ] **Step 1: Update CLI fixtures and write failing safety tests**

Change fixtures to version 4 / `score-rate-v3`, 13-dimensional vectors, nested diagnostics, `publishedBaseline`, and `bestQualifiedCandidate`. Add:

```ts
it('contains no publication path or publication writer', () => {
  const source = readFileSync(join(ROOT, 'training/train.ts'), 'utf8');
  expect(source).not.toMatch(/best-weights\.json/);
  expect(source).not.toMatch(/trained-weights\.json/);
  expect(source).not.toMatch(/writeWeightsFiles/);
  expect(source).toMatch(/writeCandidateWeights/);
});

const writeValidV4Run = (
  checkpointOverrides: Partial<ReturnType<typeof validCheckpoint>> = {},
) => {
  const outputDir = mkdtempSync(join(tmpdir(), 'tetris-v4-run-'));
  const checkpoint = { ...validCheckpoint(), ...checkpointOverrides };
  writeFileSync(join(outputDir, 'checkpoint.json'), JSON.stringify(checkpoint));
  writeFileSync(
    join(outputDir, 'training-log.jsonl'),
    `${JSON.stringify(validGeneration(0))}\n`,
  );
  return outputDir;
};

it('keeps a legal generation-zero v4 resume byte-identical', () => {
  const outputDir = writeValidV4Run({ bestQualifiedCandidate: null });
  const before = snapshotDirectory(outputDir);
  const result = runTrain(outputDir, true);
  expect(result.status).toBe(0);
  expect(snapshotDirectory(outputDir)).toEqual(before);
});
```

`writeValidV4Run` is the renamed existing fixture writer: it creates the exact version-4 checkpoint and continuous JSONL records in a temporary directory, then returns that directory. Candidate qualification and run-local candidate serialization are already exercised as pure tests in Tasks 5 and 6; this task verifies that the CLI consumes those exact artifacts read-only at generation zero.

Use the existing preload/stub pattern so these tests do not run long real simulations.

- [ ] **Step 2: Run CLI tests and verify old publication writes are caught**

Run: `npm test -- training/train-cli.test.ts`

Expected: FAIL because `writeWeightsFiles` still writes bundled/runtime files and the checkpoint is version 3.

- [ ] **Step 3: Remove publication-path knowledge from the trainer**

Delete `PUBLIC_AI`, `BEST_PUBLIC`, `BEST_SRC`, and `writeWeightsFiles`. Import only `writeCandidateWeights` and use `paths.candidate`.

- [ ] **Step 4: Log strategy diagnostics for best, population median, and elite median**

Generation records add exactly three nested objects:

```ts
bestStrategyDiagnostics: meanStrategyDiagnostics[bestIndex],
medianStrategyDiagnostics: {
  meanCleanWellDepth: median(meanStrategyDiagnostics.map((d) => d.meanCleanWellDepth)),
  meanTetrisSetupProgress: median(meanStrategyDiagnostics.map((d) => d.meanTetrisSetupProgress)),
  meanTetrisReadyRows: median(meanStrategyDiagnostics.map((d) => d.meanTetrisReadyRows)),
},
eliteStrategyDiagnostics: {
  meanCleanWellDepth: median(elites.map((e) => e.strategy.meanCleanWellDepth)),
  meanTetrisSetupProgress: median(elites.map((e) => e.strategy.meanTetrisSetupProgress)),
  meanTetrisReadyRows: median(elites.map((e) => e.strategy.meanTetrisReadyRows)),
},
```

Extend elite records with `strategy` and `survival`; do not pass either into `updateCem`.

- [ ] **Step 5: Replace `bestEver` with baseline plus qualified candidate**

At fixed reevaluation:

1. Establish `publishedBaseline` from zero-extended `DEFAULT_WEIGHTS` on the first event.
2. Build `candidate` from current normalized mu and all diagnostics.
3. Call `evaluateTetrisCandidate(candidate, publishedBaseline, bestQualifiedCandidate)`.
4. If `shouldSave`, update `bestQualifiedCandidate` and write `paths.candidate`.
5. Append the qualification event whether accepted or rejected.
6. Save both checkpoint fields.

The final console line reports `qualified candidate none` or its score rate/gen; it must not print `published` or `wrote best-weights`.

- [ ] **Step 6: Preserve resume-zero validation mode**

`npm run train -- --resume --generations 0 --output-dir <dir>` validates schema-4 checkpoint, log, and candidate consistency, prints the validated objective/gen, creates no worker, and leaves every file byte-identical.

- [ ] **Step 7: Run CLI and artifact regression tests**

Run: `npm test -- training/train-cli.test.ts training/runArtifacts.test.ts training/reevaluationLog.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit trainer orchestration**

```powershell
git add -- training/train.ts training/train-cli.test.ts
git commit -m "feat(training): isolate qualified tetris candidates"
```

---

### Task 8: Score-rate-v3 dashboard and 13-feature charts

**Files:**
- Modify: `src/training/dashboard/types.ts`
- Modify: `src/training/dashboard/useTrainingLog.ts`
- Modify: `src/training/dashboard/useTrainingLog.test.ts`
- Modify: `src/training/dashboard/App.tsx`
- Modify: `src/training/dashboard/chartColors.ts`
- Modify: `src/training/dashboard/charts.test.ts`

**Interfaces:**
- Consumes: v3 generation log nested strategy objects and 13-element arrays.
- Produces: v3-only parsing, `/ai/score-rate-v3/training-log.jsonl`, and visible best/elite setup diagnostics.

- [ ] **Step 1: Write failing v3 parser tests**

```ts
expect(LOG_URL).toBe('/ai/score-rate-v3/training-log.jsonl');

const entry = JSON.parse(line(0));
expect(entry.objective).toBe('score-rate-v3');
expect(parseLog(JSON.stringify(entry))[0]).toMatchObject({
  bestStrategyDiagnostics: {
    meanCleanWellDepth: 4,
    meanTetrisSetupProgress: 3,
    meanTetrisReadyRows: 2,
  },
});

const legacy = { ...entry, objective: 'score-rate-v2' };
expect(parseLog(JSON.stringify(legacy))).toEqual([]);
```

- [ ] **Step 2: Run dashboard tests and verify the old URL/objective failure**

Run: `npm test -- src/training/dashboard/useTrainingLog.test.ts src/training/dashboard/charts.test.ts`

Expected: FAIL on score-rate-v2 URL/objective and 10-color length.

- [ ] **Step 3: Extend `LogEntry` and normalize exact nested diagnostics**

```ts
export interface LogEntry {
  // existing fields
  bestStrategyDiagnostics: StrategyDiagnostics;
  medianStrategyDiagnostics: StrategyDiagnostics;
  eliteStrategyDiagnostics: StrategyDiagnostics;
}

const strategy = (value: unknown): StrategyDiagnostics => {
  const raw = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  return {
    meanCleanWellDepth: num(raw.meanCleanWellDepth, 0),
    meanTetrisSetupProgress: num(raw.meanTetrisSetupProgress, 0),
    meanTetrisReadyRows: num(raw.meanTetrisReadyRows, 0),
  };
};
```

Set `LOG_URL` to `/ai/score-rate-v3/training-log.jsonl`, accept only current `SCORE_RATE_OBJECTIVE`, and normalize all three nested fields. Re-evaluation events continue to be ignored because they lack required generation fields.

- [ ] **Step 4: Show setup metrics without adding new charts**

Add metric cards for:

```ts
['Best clean well', latest.bestStrategyDiagnostics.meanCleanWellDepth.toFixed(2)],
['Elite setup progress', latest.eliteStrategyDiagnostics.meanTetrisSetupProgress.toFixed(2)],
['Elite ready rows', latest.eliteStrategyDiagnostics.meanTetrisReadyRows.toFixed(2)],
```

Update visible path labels from score-rate-v2 to score-rate-v3. Do not add a charting dependency or a fifth chart.

- [ ] **Step 5: Add three distinct colors**

Append the exact three colors below to `SERIES_COLORS`, update the comment from ten to thirteen direct-labelled series, and retain the existing test requiring one color per `FEATURE_NAMES` entry:

```ts
'#24a0a8', '#b36ae2', '#8f9d2a',
```

- [ ] **Step 6: Run dashboard tests**

Run: `npm test -- src/training/dashboard/useTrainingLog.test.ts src/training/dashboard/charts.test.ts`

Expected: PASS with 13 distinct colors.

- [ ] **Step 7: Commit dashboard changes**

```powershell
git add -- src/training/dashboard/types.ts src/training/dashboard/useTrainingLog.ts src/training/dashboard/useTrainingLog.test.ts src/training/dashboard/App.tsx src/training/dashboard/chartColors.ts src/training/dashboard/charts.test.ts
git commit -m "feat(training-ui): display score-rate-v3 strategy metrics"
```

---

### Task 9: Read-only paired acceptance CLI

**Files:**
- Create: `training/pairedBench.ts`
- Create: `training/pairedBench.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: version-3 gen-40 baseline weights, version-4 run-local candidate, `hashSeed`, `simulateGame`, and `evaluatePairedAcceptance`.
- Produces: `npm run bench:paired -- --baseline <path> --candidate <path> --seed <integer>` with a fixed 30 × 5000 × depth-2 schedule and no writes.

- [ ] **Step 1: Add failing CLI argument tests around an exported parser**

Export `parsePairedBenchArgs(argv)` and test:

```ts
expect(parsePairedBenchArgs([
  '--baseline', 'baseline.json',
  '--candidate', 'candidate.json',
  '--seed', '20260811',
])).toEqual({
  baseline: 'baseline.json',
  candidate: 'candidate.json',
  seed: 20260811,
});

expect(() => parsePairedBenchArgs(['--baseline', 'a.json'])).toThrow(/candidate/);
expect(() => parsePairedBenchArgs([
  '--baseline', 'a.json', '--candidate', 'b.json', '--games', '5',
])).toThrow(/unknown flag/);
```

Guard CLI execution so importing the parser in the test has no side effects:

```ts
const isMain = process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await main();
```

- [ ] **Step 2: Implement fixed-schedule paired evaluation**

The CLI must:

1. Read and parse both weight files through `parseWeightsFile`.
2. Require baseline metadata `version: 3`, objective `score-rate-v2`, gen 40.
3. Require candidate metadata `version: 4`, objective `score-rate-v3`.
4. Derive 30 seeds as `hashSeed(args.seed, gameIndex)`.
5. Run baseline and candidate for each seed with `maxPieces: 5000`, `depth: 2`.
6. Preserve paired ordering in two 30-element result arrays.
7. Print per-game score-rate and Tetris-share deltas with no raw board or model output.
8. Print one JSON summary from `evaluatePairedAcceptance`.
9. Perform no filesystem writes and never import the trainer.

- [ ] **Step 3: Add the package command**

```json
"bench:paired": "tsx training/pairedBench.ts"
```

- [ ] **Step 4: Run only parser/statistical tests, not the real benchmark**

Run: `npm test -- training/pairedStats.test.ts training/pairedBench.test.ts`

Expected: PASS. Do not execute `npm run bench:paired`; the 30 × 5000 real run requires separate authorization.

- [ ] **Step 5: Commit the paired acceptance tool**

```powershell
git add -- training/pairedBench.ts training/pairedBench.test.ts package.json
git commit -m "feat(training): add paired tetris acceptance benchmark"
```

---

### Task 10: Code-only handoff, full verification, and review package

**Files:**
- Modify: `README.md`
- Modify: `docs/ai-training-handoff.md`
- Modify: `docs/superpowers/specs/2026-08-11-score-rate-v3-tetris-strategy-design.md`
- Verify unchanged: `src/ai/trained-weights.json`
- Verify unchanged: `public/ai/best-weights.json`

**Interfaces:**
- Consumes: all prior task contracts and fresh command output.
- Produces: current code-only handoff that distinguishes implementation, training, paired acceptance, and publication.

- [ ] **Step 1: Update docs to code-only status**

Document exactly:

- current code/trainer contract is score-rate-v3, 13 dimensions, schema 4;
- current published model remains gen-40 score-rate-v2 and is zero-extended only in memory;
- default new-run path is `public/ai/score-rate-v3/`;
- trainer writes only run-local `candidate-weights.json` after qualification;
- two-generation signal gate and 20% final Tetris threshold;
- paired CLI command exists but was not run;
- no training, benchmark, candidate production, acceptance, publication, or browser/runtime acceptance occurred during implementation.

- [ ] **Step 2: Run the shortest focused regression set**

Run:

```powershell
npm test -- src/ai/tetrisStrategy.test.ts src/ai/features.test.ts src/ai/weights.test.ts src/ai/simulate.test.ts training/cem.test.ts training/publication.test.ts training/runArtifacts.test.ts training/train-cli.test.ts training/pairedStats.test.ts training/pairedBench.test.ts src/training/dashboard/useTrainingLog.test.ts src/training/dashboard/charts.test.ts
```

Expected: PASS with zero failed tests.

- [ ] **Step 3: Run complete code gates**

Run, one command at a time:

```powershell
npm test
npm run lint
npm run build
npm run typecheck:train
```

Expected: every command exits 0. Do not run `npm run train`, `npm run bench`, or `npm run bench:paired`.

- [ ] **Step 4: Verify publication and artifact boundaries live**

Run:

```powershell
git diff -- src/ai/trained-weights.json
Get-FileHash src/ai/trained-weights.json,public/ai/best-weights.json -Algorithm SHA256
Get-ChildItem -Force public/ai/score-rate-v3 -ErrorAction SilentlyContinue
git status --short
git diff --check
```

Expected:

- no tracked weight diff;
- bundled/runtime hashes remain the pre-implementation values unless the user separately authorized a publication, which this plan does not;
- no score-rate-v3 run directory is created by code tests;
- only planned source/test/doc changes are present;
- `git diff --check` exits 0.

- [ ] **Step 5: Request independent review before the final commit**

Provide the reviewer the approved spec, this plan, `git diff`, fresh gate outputs, publication hashes, and the explicit statement that no training/benchmark/publication ran. Require findings to distinguish code-contract proof from runtime/model acceptance.

- [ ] **Step 6: Fix review findings and rerun affected plus full gates**

For every accepted finding, first add or tighten a failing test, observe the failure, make the minimal fix, run the focused test, then rerun the four complete code gates from Step 3.

- [ ] **Step 7: Commit the handoff with exact paths**

```powershell
git add -- README.md docs/ai-training-handoff.md docs/superpowers/specs/2026-08-11-score-rate-v3-tetris-strategy-design.md
git commit -m "docs(ai): hand off score-rate-v3 implementation"
```

- [ ] **Step 8: Report remaining authorization gates**

Report code/test/build status, commits, unchanged publication hashes, and these still-open gates: two-generation signal smoke, formal training, fixed reevaluation candidate creation, independent paired acceptance, publication, push, and browser/runtime acceptance.

---

## Execution Notes

- Implement tasks in order. Tasks 1–2 establish the vector contract consumed by every later task; Tasks 3–4 establish diagnostics; Tasks 5–7 establish qualification and artifacts; Tasks 8–9 expose observability and acceptance; Task 10 closes code-only evidence.
- Stop after the two-generation signal smoke if both `bestTetrisLineShare` and `eliteTetrisLineShare` stay below `0.01` in both generations. This operational gate is not part of code execution and requires separate authorization after the implementation is complete.
- If the signal gate fails, do not deepen search inside this plan. Write a new design comparing bag-aware beam/expectimax alternatives.
