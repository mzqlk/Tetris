# Bag-Aware Expectimax + Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement one shared, player-visible-information Tetris policy with standard Hold, exact seven-bag chance nodes, deterministic 64/32 beam search, four-lock lookahead, browser iterative-deepening fallback, and score-rate-v4 artifact isolation.

**Architecture:** Keep the environment's ordered bag and RNG inside the browser store or simulator, and project only `PublicSearchState` into pure `src/ai/` functions. Build immutable public-bag and Hold transitions first, layer exact expectimax and local caching over them, then connect the same search action contract to the simulator and browser. Migrate trainer metadata only after the runtime contracts are tested, so schema 5 cannot exist without the search semantics it claims.

**Tech Stack:** TypeScript 5.6, React 18, Zustand 5, Vitest 3, Vite 6, Node worker threads, existing Tetris engine/SRS helpers.

## Global Constraints

- Search receives only `board`, `current`, `next`, `hold`, `holdAvailable`, and `unseenBagMask`; no search signature, cache key, task payload, diagnostic, or test fixture may expose the environment's ordered `bag`, bag index, or RNG state.
- Standard Hold is exact: one Hold per locked piece; empty Hold promotes the visible next piece and reveals exactly one new preview; non-empty Hold swaps without drawing; locking restores Hold availability.
- Chance nodes enumerate every type in the remaining seven-bag mask with equal conditional probability. They never sample RNG or prune piece-type branches.
- Fixed search is `maxLockedDepth = 4`, `maxRootPlacements = 64`, `maxChildPlacements = 32`; current piece is lock depth 1, and Hold never consumes lock depth.
- Browser planning uses iterative depths `1 -> 2 -> 3 -> 4`, with an injected monotonic-clock abort predicate: `instant` targets 100 ms and `normal`/`slow` target 200 ms. Only a fully completed depth may determine the action; if depth 1 is incomplete, perform a complete one-ply emergency placement ranking.
- Training, tests, and artifact evaluation use a fixed computation graph with `shouldAbort: () => false`; machine speed must not alter their decisions.
- Decision values compare `survivalProbability` first and `expectedHeuristicValue` second. Chance nodes average both fields; afterstate heuristic values add without a discount factor.
- CEM fitness remains exactly `meanScore / scheduled maxPieces`. Hold usage, search diagnostics, Tetris share, and survival diagnostics never enter fitness, elite ordering, or CEM updates.
- Preserve the exact 13-entry `FEATURE_NAMES` order. Historical 9/10/13-weight files are adapted only in memory; never modify `src/ai/trained-weights.json`.
- New metadata is objective `score-rate-v4`, search contract `bag-expectimax-hold-v1`, schema version `5`, lock depth `4`, root beam `64`, child beam `32`. Schema 1-4 checkpoints/logs must fail closed for resume/append.
- Do not mutate board rows in place. Placement enumeration continues to use engine rotation/SRS through `enumeratePlacements`.
- Keep `src/ai/` free of Node, DOM, filesystem, and module-level mutable state, except the existing browser-only `loadWeights.ts` exception.
- Do not run `npm run train`, `npm run bench`, or `npm run bench:paired`; do not create, move, delete, or modify `public/ai/`, training archives, bundled/runtime weights, or candidate files during this implementation.
- This plan authorizes code, unit/integration tests, reviews, and commits only. Training, benchmark, paired acceptance, publication, push, and browser/runtime acceptance remain separate gates.

---

## File Structure

- Create `src/ai/publicState.ts`: public seven-bag mask, public/pending state types, validation, and reveal outcomes.
- Create `src/ai/publicState.test.ts`: bag-boundary, probability, immutability, and invalid-state tests.
- Create `src/ai/stateTransitions.ts`: deterministic Hold and lock transitions that never draw hidden pieces.
- Create `src/ai/stateTransitions.test.ts`: standard Hold, pending preview, spawn failure, board immutability, and lock reset tests.
- Replace `src/ai/search.ts`: exact expectimax, stable beams, local transposition table, fixed-depth and iterative entry points.
- Replace `src/ai/search.test.ts`: value ordering, exact chance, beam, Hold, cache, depth, abort, and hidden-order-independence tests.
- Modify `src/ai/simulate.ts`: environment-only ordered bag, Hold execution, public-state projection, fixed search, and search diagnostics.
- Modify `src/ai/simulate.test.ts`: simulator/store parity including Hold and public bag, fixed depth-4 determinism, and diagnostic tests.
- Modify `training/pool.ts`, `training/worker.ts`, `training/benchSummary.ts`: carry fixed search configuration and non-fitness search diagnostics.
- Modify `training/pool.test.ts`, `training/benchSummary.test.ts`: propagation, failed-result defaults, and aggregation tests.
- Modify `src/types.ts`, `src/store/gameStore.ts`, `src/hooks/useGameLoop.ts`: visible Hold state/action, public bag tracking, and keyboard Hold.
- Create `src/components/PiecePreview.tsx`; refactor `src/components/NextPiece.tsx` and create `src/components/HoldPiece.tsx` as thin store adapters over the shared preview renderer; modify `src/components/Game.tsx`, `src/components/AiControls.tsx`, and styles for fixed-search controls.
- Modify `src/hooks/useAiPlayer.ts`: public-state search, 100/200 ms injected budget, Hold execution, and stale-plan recovery.
- Modify browser/store tests: Hold execution, iterative fallback, and same-public-state decision tests.
- Modify trainer schema files under `src/ai/` and `training/`: score-rate-v4/schema-5/search-contract metadata and exact artifact validation.
- Modify trainer/dashboard tests and `docs/ai-training-handoff.md`: current code contract and unexecuted operational gates.

---

### Task 1: Public Seven-Bag State Contract

**Files:**
- Create: `src/ai/publicState.ts`
- Create: `src/ai/publicState.test.ts`
- Modify: `src/types.ts`
- Modify: `src/store/gameStore.ts`
- Modify: `src/store/gameStore.test.ts`

**Interfaces:**
- Consumes: `Board`, `Piece`, and `PieceType` from `src/types.ts`; `createPiece` remains the only spawn constructor.
- Produces:

```ts
export type BagMask = number;
export const FULL_BAG_MASK: BagMask;

export interface PublicSearchState {
  board: Board;
  current: Piece;
  next: PieceType;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: BagMask;
}

export interface PendingPreviewState {
  board: Board;
  current: Piece;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: BagMask;
}

export interface BagOutcome {
  piece: PieceType;
  probability: number;
  nextMask: BagMask;
}

export function initialUnseenBagMask(current: PieceType, next: PieceType): BagMask;
export function revealPiece(mask: BagMask, piece: PieceType): BagMask;
export function enumerateBagOutcomes(mask: BagMask): BagOutcome[];
export function assertPublicSearchState(state: PublicSearchState): void;
```

- Add `holdPiece: PieceType | null`, `holdAvailable: boolean`, and `unseenBagMask: number` to `GameState`; environment `bag: PieceType[]` remains internal state and is never part of `PublicSearchState`.
- Keep the repository buildable at this task boundary by initializing store state to `holdPiece: null`, `holdAvailable: true`, and `unseenBagMask: 0`, and by setting `unseenBagMask = initialUnseenBagMask(current.type, next.type)` in `startGame`. Do not add a Hold action or change lock/spawn behavior yet; those remain Task 6.

- [ ] **Step 1: Write failing public-bag tests**

```ts
it('tracks two initial reveals from one seven-bag', () => {
  const mask = initialUnseenBagMask(1, 4);
  expect(enumerateBagOutcomes(mask).map((o) => o.piece)).toEqual([2, 3, 5, 6, 7]);
});

it('opens a fresh bag only when the visible bag is exhausted', () => {
  const outcomes = enumerateBagOutcomes(0);
  expect(outcomes).toHaveLength(7);
  expect(outcomes.every((o) => o.probability === 1 / 7)).toBe(true);
  expect(outcomes.find((o) => o.piece === 3)!.nextMask).toBe(
    FULL_BAG_MASK & ~(1 << (3 - 1)),
  );
});

it('rejects a reveal that contradicts a non-empty public mask', () => {
  expect(() => revealPiece(1 << (2 - 1), 3)).toThrow(/public bag/i);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx vitest run src/ai/publicState.test.ts`

Expected: FAIL because `publicState.ts`, `initialUnseenBagMask`, and the exported types do not exist.

- [ ] **Step 3: Implement the seven-bit mask and state validator**

```ts
export const FULL_BAG_MASK = 0b1111111;
const pieceBit = (piece: PieceType) => 1 << (piece - 1);

export function revealPiece(mask: BagMask, piece: PieceType): BagMask {
  const available = mask === 0 ? FULL_BAG_MASK : mask;
  const bit = pieceBit(piece);
  if ((available & bit) === 0) throw new Error('revealed piece contradicts public bag');
  return available & ~bit;
}
```

Implement `initialUnseenBagMask` by revealing current then next from a full bag. Implement `enumerateBagOutcomes` in ascending piece-type order, with equal probability over set bits and a post-reveal `nextMask`. Validate mask range, finite board cells, current/next/hold piece types, and boolean Hold availability without mutating any input.

- [ ] **Step 4: Run focused and type-adjacent tests**

Run: `npx vitest run src/ai/publicState.test.ts src/store/gameStore.test.ts`

Expected: all tests PASS with no warnings.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`

Expected: 0 failed test files; existing skips may remain.

```powershell
git add -- src/types.ts src/ai/publicState.ts src/ai/publicState.test.ts src/store/gameStore.ts src/store/gameStore.test.ts
git commit -m "feat(ai): add public seven-bag state"
```

### Task 2: Pure Standard-Hold and Lock Transitions

**Files:**
- Create: `src/ai/stateTransitions.ts`
- Create: `src/ai/stateTransitions.test.ts`
- Modify: `src/ai/search.ts` only to import the shared `evaluatePlacement` helper; do not implement recursive search in this task.

**Interfaces:**
- Consumes: `PublicSearchState`, `PendingPreviewState`, `revealPiece`; `Placement`; engine `lockPiece`, `clearLines`, `getPieceCells`, `isValidPosition`; `createPiece`; `extractFeatures`.
- Produces:

```ts
export type HoldTransition =
  | { kind: 'unavailable' }
  | { kind: 'ready'; state: PublicSearchState }
  | { kind: 'pending-preview'; state: PendingPreviewState };

export interface PlacementTransition {
  boardAfter: Board;
  linesCleared: number;
  placedCells: Position[];
  pending: PendingPreviewState;
}

export function applyHold(state: PublicSearchState): HoldTransition;
export function lockPlacement(
  state: PublicSearchState,
  placement: Placement,
): PlacementTransition;
export function revealPreview(
  pending: PendingPreviewState,
  preview: PieceType,
): PublicSearchState | null;
export function evaluatePlacement(
  state: PublicSearchState,
  placement: Placement,
  weights: number[],
): PlacementTransition & { heuristic: number };
```

- `revealPreview` returns `null` when the promoted current cannot spawn on `pending.board`; contradictory public-mask reveals throw rather than consulting the hidden bag.

- [ ] **Step 1: Write failing Hold/lock transition tests**

```ts
it('empty Hold promotes next and requests exactly one preview', () => {
  const result = applyHold(publicState({ current: 1, next: 4, hold: null }));
  expect(result).toMatchObject({
    kind: 'pending-preview',
    state: { current: createPiece(4), hold: 1, holdAvailable: false },
  });
});

it('non-empty Hold swaps without consuming next or bag mask', () => {
  const before = publicState({ current: 2, next: 6, hold: 1, unseenBagMask: 0b1010100 });
  const result = applyHold(before);
  expect(result).toMatchObject({
    kind: 'ready',
    state: { current: createPiece(1), next: 6, hold: 2, holdAvailable: false,
      unseenBagMask: 0b1010100 },
  });
  expect(before.current.type).toBe(2);
});

it('locking restores Hold and never mutates shared board rows', () => {
  const before = publicState({ holdAvailable: false });
  const row = before.board[21];
  const transition = lockPlacement(before, enumeratePlacements(before.board, before.current)[0]);
  expect(transition.pending.holdAvailable).toBe(true);
  expect(before.board[21]).toBe(row);
  expect(transition.boardAfter[21]).not.toBe(row);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx vitest run src/ai/stateTransitions.test.ts`

Expected: FAIL because the transition module does not exist.

- [ ] **Step 3: Implement deterministic transitions**

Implement `applyHold` with no draw operation. Empty Hold returns `pending-preview` with the old next spawned as current. Non-empty Hold returns `ready` with a spawned held piece and unchanged next/mask. `lockPlacement` performs lock → clear, promotes visible next into pending current, preserves hold, restores Hold, and leaves preview unresolved. `evaluatePlacement` computes the existing 13-feature dot product from the same post-clear board and placed cells.

- [ ] **Step 4: Run transition and placement/search compatibility tests**

Run: `npx vitest run src/ai/stateTransitions.test.ts src/ai/placements.test.ts src/ai/search.test.ts`

Expected: all tests PASS; old one/two-ply search behavior remains green at this intermediate commit.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`

Expected: 0 failed test files.

```powershell
git add -- src/ai/stateTransitions.ts src/ai/stateTransitions.test.ts src/ai/search.ts
git commit -m "feat(ai): add shared hold and lock transitions"
```

### Task 3: Fixed Exact Expectimax, Stable Beam, and Local Cache

**Files:**
- Modify: `src/ai/search.ts`
- Replace tests: `src/ai/search.test.ts`
- Create: `src/ai/searchCorpus.test.ts`

**Interfaces:**
- Consumes: public state and transitions from Tasks 1-2; `enumeratePlacements`; 13-value weight vectors.
- Produces:

```ts
export type SearchAction =
  | { kind: 'place'; placement: Placement }
  | { kind: 'hold' };

export interface SearchValue {
  survivalProbability: number;
  expectedHeuristicValue: number;
}

export interface SearchDiagnostics {
  completedDepth: number;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
  aborted: boolean;
}

export interface SearchBudget {
  maxRootPlacements: number;
  maxChildPlacements: number;
  maxLockedDepth: 1 | 2 | 3 | 4;
  shouldAbort: () => boolean;
  cacheEnabled?: boolean;
}

export interface SearchDecision {
  action: SearchAction;
  value: SearchValue;
  diagnostics: SearchDiagnostics;
}

export const FIXED_SEARCH_LIMITS = Object.freeze({
  maxRootPlacements: 64,
  maxChildPlacements: 32,
  maxLockedDepth: 4 as const,
});

export function searchFixed(
  state: PublicSearchState,
  weights: number[],
  budget?: SearchBudget,
): SearchDecision | null;
```

- [ ] **Step 1: Replace old depth-2 tests with failing expectimax tests**

```ts
it('compares survival before heuristic value', () => {
  expect(compareSearchValues(
    { survivalProbability: 1, expectedHeuristicValue: -100 },
    { survivalProbability: 0.5, expectedHeuristicValue: 10_000 },
  )).toBeGreaterThan(0);
});

it('keeps Hold outside the placement beam', () => {
  const result = searchFixed(holdFixture(), holdRewardWeights(), {
    ...fixedBudget(2), maxRootPlacements: 1, maxChildPlacements: 1,
  });
  expect(result!.action.kind).toBe('hold');
});

it('returns the same action and value with cache enabled or disabled', () => {
  const on = searchFixed(corpusState(), corpusWeights(), fixedBudget(4, true));
  const off = searchFixed(corpusState(), corpusWeights(), fixedBudget(4, false));
  expect(stripDiagnostics(on)).toEqual(stripDiagnostics(off));
});
```

Export `compareSearchValues` for direct value-contract tests. Add a constrained-board corpus whose mask contains one type and whose reachable placements are few; assert `completedDepth === 4`, stable action, finite value, exact node counts, and deterministic reruns. Add a fixture with two possible future pieces where one branch tops out; assert survival is strictly between 0 and 1 instead of `-Infinity`.

- [ ] **Step 2: Run search tests and confirm RED**

Run: `npx vitest run src/ai/search.test.ts src/ai/searchCorpus.test.ts`

Expected: FAIL because `searchFixed`, the new action/value types, and depth-4 diagnostics are absent.

- [ ] **Step 3: Implement fixed-depth expectimax**

Implement decision recursion with these exact rules:

```ts
const better = (a: SearchValue, b: SearchValue) =>
  a.survivalProbability !== b.survivalProbability
    ? a.survivalProbability > b.survivalProbability
    : a.expectedHeuristicValue > b.expectedHeuristicValue;
```

Sort placements by immediate heuristic descending and then original enumeration index ascending; slice 64 at root and 32 below. Always evaluate legal Hold separately. Place decrements remaining lock depth; Hold does not. For depth 1, do not reveal a preview after the leaf placement, and evaluate empty Hold by ranking the known promoted current without inventing next. Chance nodes enumerate every mask outcome and average both value fields. Terminal spawn/no-placement branches return survival 0. Use a per-call `Map<string, SearchValue>` whose key includes board cells, current pose, next, hold, Hold availability, mask, remaining depth, and root/child beam widths. Cache only complete nodes.

- [ ] **Step 4: Run search, transition, and SRS tests**

Run: `npx vitest run src/ai/search.test.ts src/ai/searchCorpus.test.ts src/ai/stateTransitions.test.ts src/ai/placements.test.ts`

Expected: all tests PASS, including the depth-4 constrained corpus.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`

Expected: 0 failed test files.

```powershell
git add -- src/ai/search.ts src/ai/search.test.ts src/ai/searchCorpus.test.ts
git commit -m "feat(ai): add exact bag-aware expectimax search"
```

### Task 4: Browser-Safe Iterative Deepening and Complete Fallback

**Files:**
- Modify: `src/ai/search.ts`
- Modify: `src/ai/search.test.ts`
- Modify: `src/ai/searchCorpus.test.ts`

**Interfaces:**
- Consumes: `searchFixed` internals and `SearchBudget` from Task 3.
- Produces:

```ts
export function searchIterative(
  state: PublicSearchState,
  weights: number[],
  budget: SearchBudget,
): SearchDecision | null;
```

- `searchFixed` remains the deterministic training entry point. `searchIterative` is the only browser entry point and may use an aborting predicate.

- [ ] **Step 1: Add failing scripted-abort tests**

```ts
it('returns the last complete depth and discards a partial next depth', () => {
  const baseline = searchFixed(corpusState(), corpusWeights(), fixedBudget(2));
  const calls = { value: 0 };
  const result = searchIterative(corpusState(), corpusWeights(), {
    ...fixedBudget(4), shouldAbort: () => ++calls.value > ABORT_DURING_DEPTH_3,
  });
  expect(result!.diagnostics).toMatchObject({ completedDepth: 2, aborted: true });
  expect(result!.action).toEqual(baseline!.action);
});

it('uses a complete one-ply placement fallback when depth one aborts', () => {
  const result = searchIterative(corpusState(), corpusWeights(), {
    ...fixedBudget(4), shouldAbort: () => true,
  });
  expect(result!.diagnostics).toMatchObject({ completedDepth: 0, aborted: true });
  expect(result!.action.kind).toBe('place');
});
```

Derive `ABORT_DURING_DEPTH_3` inside the test by first running an instrumented depth-2 search and using its abort-check count plus one, rather than a machine-time constant.

- [ ] **Step 2: Run iterative tests and confirm RED**

Run: `npx vitest run src/ai/search.test.ts src/ai/searchCorpus.test.ts`

Expected: FAIL because `searchIterative` does not exist.

- [ ] **Step 3: Implement iterative completion boundaries**

Run depths 1 through the configured maximum with a shared per-call cache. Commit a root decision only after the whole depth finishes. On abort, discard current-depth value/action and every incomplete cache entry. If no depth completes, enumerate the entire root placement set without consulting `shouldAbort`, evaluate one-ply afterstates with stable tie-breaking, and return a placement action with `completedDepth: 0`. Never return a partially evaluated Hold/chance branch.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/ai/search.test.ts src/ai/searchCorpus.test.ts`

Expected: all tests PASS and scripted aborts are deterministic.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`

Expected: 0 failed test files.

```powershell
git add -- src/ai/search.ts src/ai/search.test.ts src/ai/searchCorpus.test.ts
git commit -m "feat(ai): add complete-depth search fallback"
```

### Task 5: Simulator, Worker, and Search-Diagnostic Integration

**Files:**
- Modify: `src/ai/simulate.ts`
- Modify: `src/ai/simulate.test.ts`
- Modify: `training/pool.ts`
- Modify: `training/pool.test.ts`
- Modify: `training/worker.ts`
- Modify: `training/benchSummary.ts`
- Modify: `training/benchSummary.test.ts`

**Interfaces:**
- Consumes: `PublicSearchState`, `initialUnseenBagMask`, `revealPiece`, `applyHold`, `searchFixed`, and `FIXED_SEARCH_LIMITS`.
- Produces:

```ts
export interface SimulationSearchDiagnostics {
  holdActions: number;
  holdRate: number;
  meanCompletedDepth: number;
  minCompletedDepth: number;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
  abortedSearches: number;
}

export interface FixedSearchConfig {
  maxLockedDepth: 1 | 2 | 3 | 4;
  maxRootPlacements: number;
  maxChildPlacements: number;
}

export function simulateFromState(
  state: SimState,
  opts: { weights: number[]; maxPieces: number; search: FixedSearchConfig },
): SimResult;
```

- `SimState` adds `holdPiece`, `holdAvailable`, `unseenBagMask`, and raw search counters. `SimResult` adds `searchDiagnostics`. `SimTask` replaces `depth` with `search: FixedSearchConfig`.
- `simulateGame` accepts `search?: FixedSearchConfig`, defaulting to the frozen 4/64/32 production contract, and always calls fixed search with `shouldAbort: () => false`. Training and benchmark call sites may pass only 4/64/32. Existing simulator tests whose subject is scoring/engine parity rather than search may explicitly pass a shallower deterministic test config; depth-4 behavior is covered by the constrained search corpus and a constrained simulator state.

- [ ] **Step 1: Add failing simulator and propagation tests**

```ts
it('keeps hidden bag order outside the search projection', () => {
  const a = createSimState(11);
  const b = cloneWithDifferentHiddenOrder(a);
  expect(projectPublicSearchState(a)).toEqual(projectPublicSearchState(b));
});

it('executes Hold without counting it as a locked piece', () => {
  const state = createSimState(7);
  const beforePieces = state.pieces;
  applyAction(state, 'hold');
  expect(state.pieces).toBe(beforePieces);
  expect(state.holdAvailable).toBe(false);
  expect(state.holdPiece).not.toBeNull();
});

it('reports completed fixed depth and no aborted searches', () => {
  const result = simulateFromState(constrainedDepthFourState(), {
    weights, maxPieces: 1, search: FIXED_SEARCH_LIMITS,
  });
  expect(result.searchDiagnostics).toMatchObject({ minCompletedDepth: 4, abortedSearches: 0 });
});
```

Add pool failure assertions that search diagnostics are fresh zero-valued objects per failed task. Add bench-summary assertions for Hold rate, completed depth, node totals, cache hits, and aborted-search counts.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run src/ai/simulate.test.ts training/pool.test.ts training/benchSummary.test.ts`

Expected: FAIL because Hold/search diagnostics and the fixed search task contract are absent.

- [ ] **Step 3: Integrate fixed public-state search**

Initialize public mask from the first two visible pieces while retaining ordered `bag` and RNG only in `SimState`. Export `projectPublicSearchState(state)` and ensure its type contains no hidden fields. Add `'hold'` to `SimAction`; execute the shared Hold transition, draw from the environment only for pending preview, and update the public mask through `revealPiece`. In `simulateGame`, repeatedly execute a returned Hold action until a placement action locks; Hold availability prevents cycles. Accumulate diagnostics per search call, compute Hold rate per locked piece, and preserve the existing deterministic score contract.

Update worker/pool tasks to pass the exact fixed config. Extend failed-result and benchmark aggregation without feeding any new diagnostic into fitness.

- [ ] **Step 4: Run focused integration tests**

Run: `npx vitest run src/ai/simulate.test.ts training/pool.test.ts training/benchSummary.test.ts`

Expected: all tests PASS; deterministic simulator tests use fixed depth 4 and no wall-clock abort.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`

Expected: 0 failed test files.

```powershell
git add -- src/ai/simulate.ts src/ai/simulate.test.ts training/pool.ts training/pool.test.ts training/worker.ts training/benchSummary.ts training/benchSummary.test.ts
git commit -m "feat(training): integrate fixed public-state search"
```

### Task 6: Browser Store, Hold UI, Keyboard, and AI Budget Integration

**Files:**
- Modify: `src/store/gameStore.ts`
- Modify: `src/store/gameStore.test.ts`
- Modify: `src/hooks/useGameLoop.ts`
- Create: `src/hooks/useGameLoop.test.ts`
- Modify: `src/hooks/useAiPlayer.ts`
- Modify: `src/hooks/useAiPlayer.test.ts`
- Create: `src/components/PiecePreview.tsx`
- Modify: `src/components/NextPiece.tsx`
- Create: `src/components/HoldPiece.tsx`
- Modify: `src/components/Game.tsx`
- Modify: `src/components/Game.module.css`
- Modify: `src/components/AiControls.tsx`
- Modify: `src/components/AiControls.module.css`

**Interfaces:**
- Consumes: Task 1 public state, Task 2 Hold transition, Task 4 `searchIterative`, existing placement replay.
- Produces: `GameActions.hold: () => void`; `planAction(publicState, weights, shouldAbort): AiPlan | { kind: 'hold' } | null`; fixed browser search with 100/200 ms soft budgets.

- [ ] **Step 1: Add failing store and hook tests**

```ts
it('allows one empty Hold, reveals one preview, and restores Hold after lock', () => {
  const before = useGameStore.getState();
  const oldCurrent = before.currentPiece!.type;
  const oldNext = before.nextPiece!.type;
  before.hold();
  expect(useGameStore.getState()).toMatchObject({
    holdPiece: oldCurrent,
    currentPiece: createPiece(oldNext),
    holdAvailable: false,
  });
  const previewAfterFirstHold = useGameStore.getState().nextPiece!.type;
  useGameStore.getState().hold();
  expect(useGameStore.getState().nextPiece!.type).toBe(previewAfterFirstHold);
  useGameStore.getState().hardDrop();
  expect(useGameStore.getState().holdAvailable).toBe(true);
});

it.each([
  ['instant', 100], ['normal', 200], ['slow', 200],
] as const)('injects the %s planning budget', (speed, milliseconds) => {
  const clock = fakeMonotonicClock();
  runOneAiStep(options(speed), clock.now);
  expect(clock.lastDeadline).toBe(milliseconds);
});

it('executes Hold and replans only after the new preview is visible', () => {
  mockSearch.mockReturnValueOnce(holdDecision()).mockReturnValueOnce(placeDecision());
  runAiUntilPlacement();
  expect(store.hold).toHaveBeenCalledBefore(store.hardDrop);
  expect(mockSearch.mock.calls[1][0].holdAvailable).toBe(false);
});

it.each(['c', 'C', 'Shift'])('maps %s to the shared Hold action', (key) => {
  const actions = fakeGameActions();
  handleGameKeyDown(new KeyboardEvent('keydown', { key }), actions);
  expect(actions.hold).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run src/store/gameStore.test.ts src/hooks/useGameLoop.test.ts src/hooks/useAiPlayer.test.ts`

Expected: FAIL because browser Hold state/action and iterative search integration do not exist.

- [ ] **Step 3: Implement store and browser integration**

Maintain `unseenBagMask` alongside environment draws in `spawnInitial`, empty Hold, and lock/spawn. Add `hold()` to the store using standard semantics and no score/drop bonus. Bind `c`, `C`, and `Shift` keydown to Hold without interfering with existing controls. Extract the existing canvas drawing into `PiecePreview`; keep `NextPiece` and `HoldPiece` as thin read-only store adapters so the two previews cannot drift into duplicate rendering implementations.

Remove the user-selectable one/two-ply control from `AiControls`; display the fixed label `4-lock expectimax`. In `useAiPlayer`, create `deadline = performance.now() + (speed === 'instant' ? 100 : 200)` and inject `shouldAbort: () => performance.now() >= deadline`. If search returns Hold, call store Hold, clear the placement plan, and schedule a fresh decision. Placement actions continue through existing move replay/hard drop and stale-pose recovery.

- [ ] **Step 4: Run browser/store unit tests**

Run: `npx vitest run src/store/gameStore.test.ts src/hooks/useGameLoop.test.ts src/hooks/useAiPlayer.test.ts`

Expected: all tests PASS, including Hold-once and complete-depth fallback assertions.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`

Expected: 0 failed test files.

```powershell
git add -- src/store/gameStore.ts src/store/gameStore.test.ts src/hooks/useGameLoop.ts src/hooks/useGameLoop.test.ts src/hooks/useAiPlayer.ts src/hooks/useAiPlayer.test.ts src/components/PiecePreview.tsx src/components/NextPiece.tsx src/components/HoldPiece.tsx src/components/Game.tsx src/components/Game.module.css src/components/AiControls.tsx src/components/AiControls.module.css
git commit -m "feat(ui): add hold-aware expectimax controls"
```

### Task 7: Score-Rate-v4 Weight and Checkpoint Schema

**Files:**
- Modify: `src/ai/trainingObjective.ts`
- Modify: `src/ai/weights.ts`
- Modify: `src/ai/weights.test.ts`
- Modify: `training/objective.ts`
- Modify: `training/config.ts`
- Modify: `training/config.test.ts`
- Modify: `training/candidateWeights.ts`
- Modify: `training/candidateWeights.test.ts`
- Modify: `training/runArtifacts.ts`
- Modify: `training/runArtifacts.test.ts`

**Interfaces:**
- Consumes: `FixedSearchConfig` and `SimulationSearchDiagnostics` from Task 5; current 13-feature weights and publication rules.
- Produces:

```ts
export const SCORE_RATE_V3_OBJECTIVE = 'score-rate-v3' as const;
export const SCORE_RATE_OBJECTIVE = 'score-rate-v4' as const;
export const SEARCH_CONTRACT = 'bag-expectimax-hold-v1' as const;
export const SEARCH_SCHEMA_VERSION = 5 as const;

export interface SearchMetadata {
  searchContract: typeof SEARCH_CONTRACT;
  searchDepth: 4;
  rootBeamWidth: 64;
  childBeamWidth: 32;
}
```

- Schema-5 weight/candidate/checkpoint payloads include the four exact search metadata fields. Version-4 score-rate-v3 weight files remain readable as historical 13-weight inputs, but every schema 1-4 checkpoint is rejected by the v4 run reader.
- `TrainConfig` replaces `depth: 1 | 2` with exact `searchDepth: 4`, `rootBeamWidth: 64`, and `childBeamWidth: 32`. Default output path becomes `public/ai/score-rate-v4/`; no command in this task may create that directory.

- [ ] **Step 1: Write failing schema and non-fitness diagnostic tests**

```ts
it('accepts exact version-5 score-rate-v4 metadata', () => {
  expect(parseWeightsFile(validV5Weights())).toMatchObject({
    version: 5,
    objective: 'score-rate-v4',
    searchContract: 'bag-expectimax-hold-v1',
    searchDepth: 4,
    rootBeamWidth: 64,
    childBeamWidth: 32,
  });
});

it.each(['searchContract', 'searchDepth', 'rootBeamWidth', 'childBeamWidth'])
  ('rejects version-5 weights missing %s', (key) => {
    const payload = validV5Weights();
    Reflect.deleteProperty(payload, key);
    expect(parseWeightsFile(payload)).toBeNull();
  });

it('rejects a schema-4 score-rate-v3 checkpoint before workers or writes', () => {
  expect(() => readCompatibleRunArtifacts(v4RunPaths())).toThrow(/score-rate-v4|version 5/i);
  expect(snapshotDirectory(v4RunDir())).toEqual(beforeSnapshot);
});

```

- [ ] **Step 2: Run focused schema tests and confirm RED**

Run: `npx vitest run src/ai/weights.test.ts training/config.test.ts training/candidateWeights.test.ts training/runArtifacts.test.ts`

Expected: FAIL on score-rate-v4/schema-5/search metadata expectations.

- [ ] **Step 3: Implement objective, diagnostics, and artifact migration**

Keep separate constants for v1/v2/v3 parsing. Version 5 requires exact 13 weights, existing score/strategy/survival metadata, aggregated search diagnostics, and exact search metadata; malformed/missing/extra fields fail closed. Candidate and checkpoint builders write version 5 only. Make `resolveRunPaths` default to `public/ai/score-rate-v4`, but only return path strings; do not create the directory. Run-artifact parsing validates exact search metadata and rejects old checkpoints/log identity before callers can create workers or write files.

- [ ] **Step 4: Run focused schema and trainer tests**

Run: `npx vitest run src/ai/weights.test.ts training/config.test.ts training/candidateWeights.test.ts training/runArtifacts.test.ts`

Expected: all tests PASS without invoking train/bench/paired CLI main functions.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`

Expected: 0 failed test files. Verify `git status --short -- public/ai src/ai/trained-weights.json` prints nothing.

```powershell
git add -- src/ai/trainingObjective.ts src/ai/weights.ts src/ai/weights.test.ts training/objective.ts training/config.ts training/config.test.ts training/candidateWeights.ts training/candidateWeights.test.ts training/runArtifacts.ts training/runArtifacts.test.ts
git commit -m "feat(training): define score-rate-v4 artifact schema"
```

### Task 8: Training Aggregation, Logs, and Orchestration

**Files:**
- Modify: `training/cem.ts`
- Modify: `training/cem.test.ts`
- Modify: `training/reevaluationLog.ts`
- Modify: `training/reevaluationLog.test.ts`
- Modify: `training/train.ts`
- Modify: `training/train-cli.test.ts`
- Modify: `src/training/dashboard/useTrainingLog.ts`
- Modify: `src/training/dashboard/useTrainingLog.test.ts`

**Interfaces:**
- Consumes: schema-5 `TrainConfig`, search metadata, and `SimulationSearchDiagnostics` from Tasks 5 and 7.
- Produces: best/median/elite aggregated search diagnostics in generation/reevaluation records; version-5 trainer orchestration that passes only fixed 4/64/32 search tasks.

- [ ] **Step 1: Add failing non-fitness and log-schema tests**

```ts
it('keeps Hold/search diagnostics out of scalar fitness and elite order', () => {
  const stats = aggregateFitness(resultsDifferingOnlyInSearchDiagnostics(), 2, 1, 300);
  expect(stats.fitness).toEqual([100, 100]);
  expect(stats.meanSearchDiagnostics[0]).not.toEqual(stats.meanSearchDiagnostics[1]);
});

it('writes exact search metadata and aggregated diagnostics to generation logs', () => {
  expect(validGeneration()).toMatchObject({
    objective: 'score-rate-v4',
    searchContract: 'bag-expectimax-hold-v1',
    searchDepth: 4,
    rootBeamWidth: 64,
    childBeamWidth: 32,
  });
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run training/cem.test.ts training/reevaluationLog.test.ts training/train-cli.test.ts src/training/dashboard/useTrainingLog.test.ts`

Expected: FAIL because search diagnostics and schema-5 trainer/log fields are not propagated.

- [ ] **Step 3: Propagate diagnostics without changing selection**

Aggregate search diagnostics separately from score-rate fitness. Add best/median/elite search diagnostic fields to generation records and candidate/reevaluation snapshots. Update trainer task creation to pass exact fixed 4/64/32 search config; keep common seeds, `meanScore / maxPieces`, 0.1% score tolerance, 20% Tetris gate, and survival gate unchanged. Resume validation must reject schema 1-4 artifacts before worker construction or writes. Update dashboard parser types only; do not start a dashboard or fetch runtime data.

- [ ] **Step 4: Run focused orchestration tests**

Run: `npx vitest run training/cem.test.ts training/reevaluationLog.test.ts training/train-cli.test.ts src/training/dashboard/useTrainingLog.test.ts`

Expected: all tests PASS. Child-process tests may exercise temp-directory validation but must not run a training generation or touch repository `public/ai`.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`

Expected: 0 failed test files and no protected-path changes.

```powershell
git add -- training/cem.ts training/cem.test.ts training/reevaluationLog.ts training/reevaluationLog.test.ts training/train.ts training/train-cli.test.ts src/training/dashboard/useTrainingLog.ts src/training/dashboard/useTrainingLog.test.ts
git commit -m "feat(training): propagate fixed-search diagnostics"
```

### Task 9: Fixed Search CLI Contracts Without Execution

**Files:**
- Modify: `training/bench.ts`
- Modify: `training/pairedBench.ts`
- Modify: `training/pairedBench.test.ts`
- Modify: `training/benchSummary.test.ts`

**Interfaces:**
- Consumes: fixed 4/64/32 search config, schema-5 candidate parser, historical version-3 score-rate-v2 gen-40 baseline parser, and paired acceptance statistics.
- Produces:

```ts
export interface PairedSimulationPlan {
  seeds: number[];
  baseline: { weights: number[]; search: typeof FIXED_SEARCH_LIMITS };
  candidate: { weights: number[]; search: typeof FIXED_SEARCH_LIMITS };
  maxPieces: 5000;
}

export function buildPairedPlan(
  baseline: WeightsFile,
  candidate: WeightsFile,
  seed: number,
): PairedSimulationPlan;
```

- CLI modules force identical search settings, without running either CLI during this task.

- [ ] **Step 1: Add failing import-safe CLI contract tests**

```ts
it('uses one fixed search contract for both paired sides', () => {
  const plan = buildPairedPlan(validBaseline(), validCandidate(), 20260812);
  expect(plan.baseline.search).toEqual(FIXED_SEARCH_LIMITS);
  expect(plan.candidate.search).toEqual(FIXED_SEARCH_LIMITS);
});

it('rejects a candidate with mismatched search metadata', () => {
  expect(() => buildPairedPlan(validBaseline(), {
    ...validCandidate(), childBeamWidth: 16,
  }, 20260812)).toThrow(/search contract|beam/i);
});
```

- [ ] **Step 2: Run CLI module tests and confirm RED**

Run: `npx vitest run training/pairedBench.test.ts training/benchSummary.test.ts`

Expected: FAIL because `buildPairedPlan` and fixed search metadata validation do not exist.

- [ ] **Step 3: Implement fixed, import-safe CLI plans**

Remove the old user-selectable depth option from bench parsing. Both CLI modules construct simulation requests with exact 4/64/32 search. Paired CLI accepts the historical version-3 score-rate-v2 gen-40 baseline as immutable input and version-5 score-rate-v4 candidate, but simulates both under `bag-expectimax-hold-v1`; candidate metadata must exactly match. Retain 30 games × 5000 pieces and independent seed behavior. Keep `main()` behind the existing import guard so Vitest never executes a benchmark.

- [ ] **Step 4: Run focused CLI tests**

Run: `npx vitest run training/pairedBench.test.ts training/benchSummary.test.ts`

Expected: all tests PASS without invoking CLI main functions.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`

Expected: 0 failed test files.

```powershell
git add -- training/bench.ts training/pairedBench.ts training/pairedBench.test.ts training/benchSummary.test.ts
git commit -m "feat(training): fix v4 evaluation search contract"
```

### Task 10: Documentation, Static Contract Guards, and Final Code Gate

**Files:**
- Modify: `docs/ai-training-handoff.md`
- Modify: `README.md`
- Modify: `src/training/dashboard/App.tsx`
- Modify: `src/ai/searchCorpus.test.ts`
- Modify: `src/ai/simulate.test.ts`
- Modify: `training/runArtifacts.test.ts`

**Interfaces:**
- Consumes: all completed implementation contracts.
- Produces: current handoff documentation, dashboard path `public/ai/score-rate-v4/training-log.jsonl`, and static tests proving forbidden information/dependencies are absent.

- [ ] **Step 1: Add failing static contract guards**

```ts
it('keeps hidden environment fields out of the public search source contract', () => {
  const source = readFileSync(resolve(ROOT, 'src/ai/search.ts'), 'utf8');
  expect(source).not.toMatch(/\.bag\b|\brng\b|node:|document\.|window\.|performance\./);
});

it('keeps score-rate-v4 defaults isolated from v3 artifacts', () => {
  expect(resolveRunPaths(ROOT)).toMatchObject({
    outputDir: resolve(ROOT, 'public/ai/score-rate-v4'),
  });
  expect(readFileSync(resolve(ROOT, 'src/ai/trained-weights.json'), 'utf8'))
    .toContain('"objective": "score-rate-v2"');
});
```

Also assert `FEATURE_NAMES` remains the exact existing 13-entry order and that the depth-4 constrained search corpus reports finite values, complete depth 4, deterministic node counts, and no abort.

- [ ] **Step 2: Run guard tests and confirm RED where documentation/defaults are stale**

Run: `npx vitest run src/ai/searchCorpus.test.ts src/ai/simulate.test.ts training/runArtifacts.test.ts`

Expected: at least the current dashboard/documented v3 path or missing static guard expectation fails before the final edits.

- [ ] **Step 3: Update handoff and README without claiming runtime success**

Document these exact distinctions:

```text
published model: version 3 score-rate-v2 gen-40, unchanged
implemented code contract: score-rate-v4 / schema 5 / bag-expectimax-hold-v1
search: public information only, standard Hold, exact bag chance, depth 4, beams 64/32
fitness: meanScore / scheduled maxPieces
not performed: search smoke, training, benchmark, paired acceptance, publication, push, browser/runtime acceptance
protected artifact: public/ai/score-rate-v3 gen-10 remains untouched
```

Update dashboard copy to the v4 default path. Do not add a generated checkpoint/log, candidate, or weight file.

- [ ] **Step 4: Run all fresh verification commands**

Run each command separately and capture exit code/output in the task report:

```powershell
npm test
npm run lint
npm run build
npm run typecheck:train
git diff --check
git status --short -- public/ai src/ai/trained-weights.json
```

Expected: tests/lint/build/typecheck/diff-check exit 0; protected-path status output is empty. No train, bench, paired, or browser command is run.

- [ ] **Step 5: Commit documentation and guards**

```powershell
git add -- docs/ai-training-handoff.md README.md src/training/dashboard/App.tsx src/ai/searchCorpus.test.ts src/ai/simulate.test.ts training/runArtifacts.test.ts
git commit -m "docs(ai): hand off bag-aware search implementation"
```

After this task, the controller performs the required whole-branch review and any single final fix wave before claiming completion.
