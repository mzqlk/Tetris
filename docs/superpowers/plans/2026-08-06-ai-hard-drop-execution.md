# AI Hard-Drop Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every reachable Tetris landing decision while replacing full soft-drop replay with the shortest legal pre-positioning path followed by an immediate hard drop.

**Architecture:** Keep the existing BFS traversal and resting-placement emission order intact. While traversing, record the first reachable state whose vertical hard-drop projection reaches each final cell set; attach that shorter path to the original resting placement. The browser plan carries the locked target, validates `moves + hardDrop`, and uses a small testable step executor so normal/slow modes hard-drop in the same callback as their last positioning move.

**Tech Stack:** TypeScript 5.6, React 18 hooks, Zustand, Vitest 3, existing pure Tetris engine and SRS rotation logic.

## Global Constraints

- Work from repository root `D:\WorkSpace\Tetris` and read `docs/ai-training-handoff.md` before editing `src/ai/`.
- Source design: `docs/superpowers/specs/2026-08-06-ai-hard-drop-and-tetris-strategy-design.md`.
- Preserve unrelated WIP. Stage only exact files from the current task; never use broad `git add`, stash, checkout, reset, or restore.
- Commit steps are authorization gates. Run a listed commit only after the user explicitly authorizes commits; otherwise leave files unstaged and report the exact diff.
- Do not run `npm run train`, `npm run bench`, start a dev server, or read/move/delete/archive `public/ai/` and `training-archive/` artifacts under this plan.
- `src/ai/` stays free of Node, DOM, filesystem, and module-level mutable state.
- Do not mutate board rows or pieces in place. All rotations must use the engine `rotatePiece` SRS behavior.
- The ordered final `cellKey` list is part of this change's regression boundary. Search tie behavior must remain stable.
- UI hard-drop bonus changes are expected; training/simulation score semantics must not change.
- Every implementation task uses RED -> GREEN, then an independent review. Fix all Critical, Important, and Minor findings and rerun the task's focused tests before proceeding.

## File Map

- Modify `src/ai/placements.ts`: expose pure hard-drop projection and attach shortest pre-drop paths without changing resting-placement order.
- Modify `src/ai/placements.test.ts`: lock ordered landing fixtures, projection invariants, direct-drop behavior, tuck reachability, and SRS coverage.
- Modify `src/hooks/useAiPlayer.ts`: carry the locked target, validate `moves + hardDrop`, and immediately hard-drop after the last positioning move.
- Modify `src/hooks/useAiPlayer.test.ts`: test target projection, stale-plan behavior, and same-callback dispatch ordering through a pure step helper.
- Read-only verification: `src/ai/search.ts`, `src/ai/simulate.ts`, `src/store/gameStore.ts`, and `src/ai/trained-weights.json` must have no behavior or generated-weight diff from this plan.

---

### Task 1: Shortest Pre-Drop Paths Without Landing Drift

**Files:**
- Modify: `src/ai/placements.ts:6-97`
- Modify: `src/ai/placements.test.ts:1-119`

**Interfaces:**
- Consumes: `movePiece(board: Board, piece: Piece, dx: number, dy: number): Piece | null`, `rotatePiece(board, piece)`, and existing `cellKey(piece)`.
- Produces: `projectHardDrop(board: Board, piece: Piece): Piece` and the revised `Placement` contract `{ piece: restingPose; moves: shortestPreDropMoves }`.
- Invariant: replaying `moves` from spawn and then calling `projectHardDrop` yields the same `cellKey` as `Placement.piece`.

- [ ] **Step 1: Add ordered characterization fixtures before changing the algorithm**

Add these constants and test to `src/ai/placements.test.ts`:

```ts
const EMPTY_I_ORDER = [
  '185,195,205,215', '184,194,204,214', '186,196,206,216',
  '213,214,215,216', '183,193,203,213', '212,213,214,215',
  '187,197,207,217', '214,215,216,217', '182,192,202,212',
  '211,212,213,214', '188,198,208,218', '215,216,217,218',
  '210,211,212,213', '181,191,201,211', '216,217,218,219',
  '189,199,209,219', '180,190,200,210',
];

const TUCK_I_ORDER = [
  '155,165,175,185', '154,164,174,184', '156,166,176,186',
  '183,184,185,186', '182,183,184,185', '157,167,177,187',
  '184,185,186,187', '181,182,183,184', '158,168,178,188',
  '185,186,187,188', '183,193,203,213', '182,192,202,212',
  '186,187,188,189', '159,169,179,189', '181,191,201,211',
  '210,211,212,213', '180,190,200,210', '211,212,213,214',
];

const JAGGED_T_ORDER = [
  '174,182,183,184', '173,181,182,183', '162,172,182,183',
  '172,173,174,182', '195,203,204,205', '184,194,204,205',
  '172,180,181,182', '161,171,181,182', '183,193,203,204',
  '187,195,196,197', '176,186,196,197', '196,204,205,206',
  '185,195,205,206', '193,194,195,203', '181,182,183,191',
  '161,162,172,182', '188,196,197,198', '177,187,197,198',
  '194,195,196,204', '183,184,194,204', '180,190,200,201',
  '180,181,182,190', '182,183,193,203', '189,197,198,199',
  '195,196,197,205', '184,185,195,205', '188,198,208,209',
  '187,188,189,197', '196,197,198,206', '176,177,187,197',
  '185,186,196,206', '180,181,191,201', '188,189,199,209',
  '197,198,208,218',
];

it('keeps representative resting placements in their established order', () => {
  const tuck = boardFrom(['....######', '....######', '.....#####']);
  const jagged = boardFrom(['..#.......', '..#....#..', '##.#####.#']);

  expect(enumeratePlacements(EMPTY, createPiece(1)).map((p) => cellKey(p.piece)))
    .toEqual(EMPTY_I_ORDER);
  expect(enumeratePlacements(tuck, createPiece(1)).map((p) => cellKey(p.piece)))
    .toEqual(TUCK_I_ORDER);
  expect(enumeratePlacements(jagged, createPiece(7)).map((p) => cellKey(p.piece)))
    .toEqual(JAGGED_T_ORDER);
});
```

- [ ] **Step 2: Run the characterization test and confirm the baseline passes**

Run:

```powershell
npm test -- src/ai/placements.test.ts
```

Expected: PASS. If any ordered fixture differs at HEAD `8ff62fc0afd40602089aa242efb569ec01cfc8c0`, stop and re-inspect the current checkout rather than editing the expected data.

- [ ] **Step 3: Replace the old replay invariant with failing pre-drop-path tests**

Import `projectHardDrop` from `./placements`. Replace the test that expects `moves` alone to reproduce the locked pose with:

```ts
it.each(BOARDS)('replay plus hard drop reproduces every %s placement', (_name, board) => {
  for (const type of ALL_TYPES) {
    const spawn = createPiece(type);
    for (const placement of enumeratePlacements(board, spawn)) {
      const path = projectPath(board, spawn, placement.moves);
      expect(path).toHaveLength(placement.moves.length);
      const preDrop = path.at(-1) ?? spawn;
      expect(cellKey(projectHardDrop(board, preDrop))).toBe(cellKey(placement.piece));
    }
  }
});

it('rotates the centre I at spawn and hard-drops without unnecessary down moves', () => {
  const vertical = enumeratePlacements(EMPTY, createPiece(1))
    .find((placement) => cellKey(placement.piece) === '185,195,205,215');

  expect(vertical).toBeDefined();
  expect(vertical!.moves).toEqual(['rotate']);
});

it('retains only the downward moves needed for the roofed tuck', () => {
  const board = boardFrom(['....######', '....######', '.....#####']);
  const tuck = enumeratePlacements(board, createPiece(1))
    .find((placement) => cellKey(placement.piece) === '211,212,213,214');

  expect(tuck).toBeDefined();
  expect(tuck!.moves).toContain('down');
  const path = projectPath(board, createPiece(1), tuck!.moves);
  expect(cellKey(projectHardDrop(board, path.at(-1)!))).toBe('211,212,213,214');
});
```

- [ ] **Step 4: Run the focused test and verify RED**

Run:

```powershell
npm test -- src/ai/placements.test.ts
```

Expected: FAIL because `projectHardDrop` is not exported and the centre-I path currently contains 18 `down` moves before rotation.

- [ ] **Step 5: Implement hard-drop projection and first-projection path capture**

In `src/ai/placements.ts`, change the `Placement.moves` comment and add:

```ts
export interface Placement {
  /** The locked pose: valid, and one row further down is not. */
  piece: Piece;
  /** Shortest path to a pose whose hard drop reaches `piece`. */
  moves: AiMove[];
}

export function projectHardDrop(board: Board, piece: Piece): Piece {
  let dropped = piece;
  for (;;) {
    const next = movePiece(board, dropped, 0, 1);
    if (next === null) return dropped;
    dropped = next;
  }
}
```

Inside `enumeratePlacements`, keep the current BFS, `seenCells`, and result-emission point. Add a map populated before the resting-state check:

```ts
const preDropMoves = new Map<string, AiMove[]>();

// Inside `for (const node of frontier)`, before `if (down === null)`:
const projectedKey = cellKey(projectHardDrop(board, node.piece));
if (!preDropMoves.has(projectedKey)) {
  preDropMoves.set(projectedKey, node.moves);
}

if (down === null) {
  const key = cellKey(node.piece);
  if (!seenCells.has(key)) {
    const moves = preDropMoves.get(key);
    if (moves === undefined) {
      throw new Error(`missing pre-drop path for reachable placement ${key}`);
    }
    seenCells.add(key);
    results.push({ piece: node.piece, moves });
  }
}
```

Do not change candidate expansion order `[left, right, down, rotate]`, `visited`, `stateKey`, or the resting-state emission order.

- [ ] **Step 6: Run the placement tests and verify GREEN**

Run:

```powershell
npm test -- src/ai/placements.test.ts src/ai/search.test.ts src/ai/simulate.test.ts
```

Expected: PASS. The search and simulator suites prove that consuming `Placement.piece` remains valid while the path contract changes.

- [ ] **Step 7: Run the independent task review gate**

Give the reviewer only the design, this task, and the exact diff for `src/ai/placements.ts` plus `src/ai/placements.test.ts`. Require explicit checks for landing-list order, tuck completeness, SRS use, board immutability, and error behavior. Fix every Critical, Important, and Minor finding, then rerun Step 6 until all three severities are zero.

- [ ] **Step 8: Commit the isolated placement change if authorized**

```powershell
git add -- src/ai/placements.ts src/ai/placements.test.ts
git commit -m "fix(ai): shorten placement paths before hard drop"
```

If commit authorization is absent, do not stage; record the two exact paths for later review.

---

### Task 2: Target-Aware Browser Plan and Same-Callback Hard Drop

**Files:**
- Modify: `src/hooks/useAiPlayer.ts:18-145`
- Modify: `src/hooks/useAiPlayer.test.ts:1-72`

**Interfaces:**
- Consumes: `projectHardDrop`, `cellKey`, revised `Placement.moves`, `projectPath`, synchronous Zustand store actions.
- Produces: `AiPlan.target: Piece` and `advanceAiPlan(plan, dispatch, hardDrop): boolean` where `true` means the piece was hard-dropped in this call.
- Runtime rule: normal/slow executes at most one positioning move per timer callback, and executes hard drop in that same callback when the move completes the path.

- [ ] **Step 1: Write failing target and step-order tests**

Update imports in `src/hooks/useAiPlayer.test.ts` to include `advanceAiPlan`, `type AiPlan`, `cellKey`, and `projectHardDrop`. Replace the old “ends at a pose that cannot move down” test and add step-order tests:

```ts
it('stores a locked target reached by hard-dropping the path endpoint', () => {
  const board = boardFrom(['..#.......', '##.#####.#']);
  const origin = createPiece(7);
  const plan = planPlacement(board, origin, null, W, 1)!;
  const preDrop = plan.path.at(-1) ?? origin;

  expect(cellKey(projectHardDrop(board, preDrop))).toBe(cellKey(plan.target));
  expect(movePiece(board, plan.target, 0, 1)).toBeNull();
});

it('hard-drops in the same call as the final positioning move', () => {
  const origin = createPiece(1);
  const plan: AiPlan = {
    moves: ['rotate'],
    path: [{ ...origin, rotation: 1 }],
    cursor: 0,
    origin,
    target: { ...origin, rotation: 1, position: { x: 3, y: 18 } },
  };
  const events: string[] = [];

  const placed = advanceAiPlan(
    plan,
    (move) => events.push(move),
    () => events.push('hardDrop'),
  );

  expect(placed).toBe(true);
  expect(events).toEqual(['rotate', 'hardDrop']);
  expect(plan.cursor).toBe(1);
});

it('hard-drops an empty positioning plan immediately', () => {
  const origin = createPiece(2);
  const plan: AiPlan = { moves: [], path: [], cursor: 0, origin, target: origin };
  const events: string[] = [];

  expect(advanceAiPlan(plan, () => events.push('move'), () => events.push('hardDrop')))
    .toBe(true);
  expect(events).toEqual(['hardDrop']);
});

it('waits after a non-final positioning move', () => {
  const origin = createPiece(2);
  const plan: AiPlan = {
    moves: ['left', 'left'],
    path: [origin, origin],
    cursor: 0,
    origin,
    target: origin,
  };
  const events: string[] = [];

  expect(advanceAiPlan(plan, (move) => events.push(move), () => events.push('hardDrop')))
    .toBe(false);
  expect(events).toEqual(['left']);
  expect(plan.cursor).toBe(1);
});
```

- [ ] **Step 2: Run the hook tests and verify RED**

Run:

```powershell
npm test -- src/hooks/useAiPlayer.test.ts
```

Expected: FAIL because `AiPlan.target` and `advanceAiPlan` do not exist and the old plan assumes `moves` ends at the locked pose.

- [ ] **Step 3: Add target validation and the pure one-step executor**

In `src/hooks/useAiPlayer.ts`, import `cellKey` and `projectHardDrop`, then implement:

```ts
export interface AiPlan {
  moves: AiMove[];
  /** path[i] is the pose after moves[i], before the final hard drop. */
  path: Piece[];
  cursor: number;
  origin: Piece;
  target: Piece;
}

export function advanceAiPlan(
  plan: AiPlan,
  dispatch: (move: AiMove) => void,
  hardDrop: () => void,
): boolean {
  if (plan.cursor >= plan.moves.length) {
    hardDrop();
    return true;
  }

  dispatch(plan.moves[plan.cursor]);
  plan.cursor++;
  if (plan.cursor === plan.moves.length) {
    hardDrop();
    return true;
  }
  return false;
}
```

Update `planPlacement`:

```ts
const moves = decision.placement.moves;
const path = projectPath(board, current, moves);
if (path.length !== moves.length) return null;

const preDrop = path.at(-1) ?? current;
if (cellKey(projectHardDrop(board, preDrop)) !== cellKey(decision.placement.piece)) {
  return null;
}

return {
  moves,
  path,
  cursor: 0,
  origin: current,
  target: decision.placement.piece,
};
```

- [ ] **Step 4: Route instant and timed execution through the helper**

Replace the instant branch with:

```ts
if (speed === 'instant') {
  while (!advanceAiPlan(
    active,
    dispatch,
    () => useGameStore.getState().hardDrop(),
  )) {
    // All positioning actions intentionally run in this event-loop callback.
  }
  plan = null;
  schedule(0);
  return;
}
```

Replace the current timed “finished plan” and dispatch tail with:

```ts
const placed = advanceAiPlan(active, dispatch, () => useGameStore.getState().hardDrop());
if (placed) plan = null;
schedule(STEP_DELAY_MS[speed]);
```

Keep the status guard, stale-plan `isPlanValid` check, replanning, and idle scheduling unchanged. Add a comment that UI drop bonus changes are expected and remain outside simulation fitness.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
npm test -- src/hooks/useAiPlayer.test.ts src/ai/placements.test.ts src/store/gameStore.test.ts
```

Expected: PASS. The event-order tests must show `last positioning action -> hardDrop` without an intervening timer.

- [ ] **Step 6: Run the independent task review gate**

Review only `src/hooks/useAiPlayer.ts` and its test together with Task 1's public interfaces. Require checks for zero-move plans, one-move plans, stale gravity state, synchronous store assumptions, target validation, cancellation, timer cadence, and instant-mode termination. Fix all Critical, Important, and Minor findings and rerun Step 5 until all are zero.

- [ ] **Step 7: Commit the isolated browser execution change if authorized**

```powershell
git add -- src/hooks/useAiPlayer.ts src/hooks/useAiPlayer.test.ts
git commit -m "fix(ai): hard-drop after pre-positioning"
```

If commit authorization is absent, do not stage.

---

### Task 3: Whole-Plan Verification and Manual Acceptance Boundary

**Files:**
- Verify only: all files changed by Tasks 1–2
- Protected: `src/ai/trained-weights.json`, `public/ai/**`, `training-archive/**`

**Interfaces:**
- Consumes: completed Task 1 and Task 2 diffs.
- Produces: fresh code-gate evidence and a clearly separated browser/manual acceptance request.

- [ ] **Step 1: Verify exact scope before running tests**

Run:

```powershell
git status --short --untracked-files=all
git diff -- src/ai/placements.ts src/ai/placements.test.ts src/hooks/useAiPlayer.ts src/hooks/useAiPlayer.test.ts
git diff -- src/ai/trained-weights.json
```

Expected: only the approved spec/plan docs and the four implementation files are changed; trained weights have no diff. Stop if another path overlaps this work.

- [ ] **Step 2: Run the shortest combined regression gate**

```powershell
npm test -- src/ai/placements.test.ts src/ai/search.test.ts src/ai/simulate.test.ts src/hooks/useAiPlayer.test.ts src/store/gameStore.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full current code gate**

```powershell
npm run lint
npm test
npm run build
npm run typecheck:train
```

Expected: all commands exit 0. Report actual test counts and command output; do not reuse counts from earlier sessions.

- [ ] **Step 4: Recheck protected artifacts and working tree**

```powershell
git diff -- src/ai/trained-weights.json
git status --short --untracked-files=all
```

Expected: no trained-weight diff and no generated artifact path. This plan never runs benchmark or training, so no production/device acceptance claim is made.

- [ ] **Step 5: Request browser acceptance only if the user wants it**

Do not start `npm run dev` automatically. Ask for explicit authorization to start the local server, then have the user check one action at a time:

1. normal speed on an empty/low board positions near spawn and immediately hard-drops;
2. slow speed shows the same ordering;
3. a tuck-capable board still performs required low movement;
4. UI score may differ because hard-drop bonus replaces soft-drop bonus.

An open page or passing unit tests do not constitute this manual acceptance.

- [ ] **Step 6: Run the final independent review gate**

Review the entire four-file implementation against the design and this plan. Require `Critical 0 / Important 0 / Minor 0`. Apply targeted fixes through the responsible task, rerun its focused test, then rerun Steps 2–4 before claiming code completion.
