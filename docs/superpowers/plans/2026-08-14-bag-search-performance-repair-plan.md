# Bag-Aware Search Performance Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the exact `bag-expectimax-hold-v1` depth-4 search complete an ordinary initial decision within a 512 MiB worker and about five seconds, then make SIGINT abandon an incomplete generation while saving the last complete checkpoint boundary and releasing the run lock.

**Architecture:** Keep the public search and scoring contracts unchanged. Replace verbose/unbounded per-call work with collision-free occupancy keys, capped pure caches, placement-prototype reuse, post-beam dominated-state reduction, and strict survival upper-bound pruning. After the search viability gate passes, add AbortSignal cancellation to the worker pool and make the trainer checkpoint only complete generation boundaries.

**Tech Stack:** TypeScript 5.6, Node.js 24 worker threads, Vitest 3, shared pure AI logic under `src/ai/`, PowerShell verification on Windows.

## Global Constraints

- Work directly on the existing `master` checkout; do not create a branch or worktree and do not use subagents.
- Search receives only `board`, `current`, `next`, `hold`, `holdAvailable`, and `unseenBagMask`; no ordered bag, bag index, seed, or RNG enters search keys or APIs.
- Preserve exact seven-bag chance enumeration, standard Hold, lock depth 4, root beam 64, child beam 32, stable placement ordering, and survival-first value comparison.
- Fixed training/evaluation search keeps `shouldAbort: () => false`; machine speed never changes its decision graph.
- Preserve score-rate-v4, schema 5, `bag-expectimax-hold-v1`, exact 13 `FEATURE_NAMES`, and fitness `meanScore / scheduled maxPieces`.
- Keep `src/ai/` free of Node, DOM, filesystem APIs, and module-level mutable state. Do not mutate board rows in place; use engine SRS placement enumeration.
- Set per-call caps exactly to `MAX_TRANSPOSITION_ENTRIES = 65_536` and `MAX_PLACEMENT_CACHE_ENTRIES = 16_384`; reaching a cap stops insertion and never changes a computed value.
- Do not run `npm run train`, `npm run bench`, or `npm run bench:paired`. The only runtime computation authorized here is the isolated fixed-search probe.
- Do not modify, delete, move, archive, stage, or publish `public/ai/`, `src/ai/trained-weights.json`, runtime weights, or the confirmed stale trainer lock.
- Before every commit, stage exact task paths, run `git diff --cached --check`, inspect the cached diff, and confirm protected paths remain untouched.

---

### Task 1: Compact Search Keys and Placement-Prototype Reuse

**Files:**
- Create: `src/ai/searchCache.ts`
- Create: `src/ai/searchCache.test.ts`
- Modify: `src/ai/search.ts`
- Modify: `src/ai/search.test.ts`
- Modify: `src/hooks/useAiPlayer.test.ts`

**Interfaces:**
- Consumes: `Board`, `Piece`, `Placement`, `PublicSearchState`, `PendingPreviewState`, `enumeratePlacements`, and `evaluatePlacement`.
- Produces:

```ts
export const MAX_TRANSPOSITION_ENTRIES = 65_536;
export const MAX_PLACEMENT_CACHE_ENTRIES = 16_384;

export function occupancyBoardKey(board: Board): string;
export function placementPrototypeKey(board: Board, current: Piece): string;
export function decisionStateKey(
  state: PublicSearchState,
  remainingDepth: number,
  root: boolean,
): string;
export function pendingStateKey(
  state: PendingPreviewState,
  remainingDepth: number,
  root: boolean,
): string;

export interface PlacementPrototype {
  placement: Placement;
  enumerationIndex: number;
  immediateHeuristic: number;
  boardAfter: Board;
}

export class PlacementPrototypeCache {
  constructor(weights: number[], enabled: boolean);
  get(state: PublicSearchState): readonly PlacementPrototype[];
  get size(): number;
  get hits(): number;
}

export function materializePending(
  prototype: PlacementPrototype,
  state: PublicSearchState,
): PendingPreviewState;
```

- `SearchDiagnostics` adds `placementCacheHits`, `placementCacheEntries`, and `transpositionEntries`. These remain decision-local diagnostics and are not added to schema-5 weight/checkpoint/log payloads.

- [ ] **Step 1: Write collision-free key tests**

Add to `src/ai/searchCache.test.ts`:

```ts
it('encodes occupancy without retaining locked piece identities', () => {
  const left = createEmptyBoard();
  const sameOccupancy = createEmptyBoard();
  left[21][0] = 1;
  sameOccupancy[21][0] = 7;
  expect(occupancyBoardKey(left)).toBe(occupancyBoardKey(sameOccupancy));

  const differentCell = createEmptyBoard();
  differentCell[21][1] = 1;
  expect(occupancyBoardKey(left)).not.toBe(occupancyBoardKey(differentCell));
  expect(occupancyBoardKey(left)).toHaveLength(TOTAL_ROWS);
});

it('includes the complete current pose in the placement key', () => {
  const board = createEmptyBoard();
  const current = createPiece(1);
  expect(placementPrototypeKey(board, current)).not.toBe(
    placementPrototypeKey(board, {
      ...current,
      rotation: 1,
      position: { ...current.position, x: current.position.x + 1 },
    }),
  );
});
```

- [ ] **Step 2: Run key tests and confirm RED**

Run:

```powershell
npx vitest run src/ai/searchCache.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
```

Expected: FAIL because `searchCache.ts` and the key functions do not exist.

- [ ] **Step 3: Implement compact keys**

In `src/ai/searchCache.ts`, encode one occupancy mask per row without hashing:

```ts
export function occupancyBoardKey(board: Board): string {
  return String.fromCharCode(...board.map((row) => {
    let mask = 0;
    for (let column = 0; column < row.length; column++) {
      if (row[column] !== 0) mask |= 1 << column;
    }
    return mask;
  }));
}

export function placementPrototypeKey(board: Board, current: Piece): string {
  return `${occupancyBoardKey(board)}|${current.type}|${current.rotation}|` +
    `${current.position.x}|${current.position.y}`;
}
```

Implement `decisionStateKey` and `pendingStateKey` with explicit field relevance:

```ts
const usesNext = remainingDepth > 1 ||
  (state.holdAvailable && state.hold === null);
const usesHold = remainingDepth > 1 || state.holdAvailable;
const usesMask = remainingDepth > 1;
```

Always include board, current pose, Hold availability, remaining depth, and root/child identity. Include `next`, Hold, and mask only under the predicates above. Pending chance keys include every field used by exact outcome enumeration; omit a field only when a test proves all outcomes produce the same subproblem.

- [ ] **Step 4: Write placement-reuse tests**

Add:

```ts
it('reuses geometry and features across visible preview changes', () => {
  const cache = new PlacementPrototypeCache(zeros(), true);
  const firstState = publicState({ next: 2, hold: null, unseenBagMask: 0b1111100 });
  const secondState = { ...firstState, next: 3 as PieceType, hold: 7 as PieceType };

  const first = cache.get(firstState);
  const second = cache.get(secondState);

  expect(second).toBe(first);
  expect(cache.hits).toBe(1);
  const pending = materializePending(second[0], secondState);
  expect(pending).toMatchObject({
    current: createPiece(3),
    hold: 7,
    unseenBagMask: secondState.unseenBagMask,
    holdAvailable: true,
  });
});

it('stops inserting placement entries at the exact cap', () => {
  const cache = new PlacementPrototypeCache(zeros(), true);
  for (let index = 0; index < MAX_PLACEMENT_CACHE_ENTRIES + 1; index++) {
    cache.get(publicState({ board: uniqueBoard(index) }));
  }
  expect(cache.size).toBe(MAX_PLACEMENT_CACHE_ENTRIES);
});
```

Use a test-local `uniqueBoard(index)` that changes a valid occupancy row mask without mutating a previously supplied board.

- [ ] **Step 5: Run placement tests and confirm RED**

Run the same focused Vitest command. Expected: key tests PASS and placement cache tests FAIL because reuse/capping/materialization are absent.

- [ ] **Step 6: Implement placement prototypes and integrate the hot path**

`PlacementPrototypeCache.get` must:

1. compute `placementPrototypeKey`;
2. return and count a hit when present;
3. enumerate placements and call `evaluatePlacement` once per placement on a miss;
4. retain only placement, enumeration index, heuristic, and `boardAfter`;
5. insert only while `size < MAX_PLACEMENT_CACHE_ENTRIES`;
6. return a fresh computed array without insertion after the cap.

`materializePending` must construct:

```ts
return {
  board: prototype.boardAfter,
  current: createPiece(state.next),
  hold: state.hold,
  holdAvailable: true,
  unseenBagMask: state.unseenBagMask,
};
```

Replace `rankPlacements` in `search.ts` so it selects the existing stable beam from materialized prototypes. Create one `PlacementPrototypeCache` per `searchFixed`/`searchIterative` context. At return, copy its `hits` and `size` into diagnostics. `cacheEnabled: false` disables both transposition insertion and placement-prototype reuse so the existing on/off result test remains a semantic oracle.

Add the three new decision-local diagnostic fields with zero values to the
handwritten `searchIterative` mocks in `src/hooks/useAiPlayer.test.ts`; do not
change hook behavior or persisted simulation diagnostics.

- [ ] **Step 7: Verify focused search behavior**

Run:

```powershell
npx vitest run src/ai/searchCache.test.ts src/ai/search.test.ts src/ai/searchCorpus.test.ts src/ai/stateTransitions.test.ts src/ai/placements.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
```

Expected: all files PASS; exact node-count fixtures are updated only for new diagnostics, not to hide action/value changes.

- [ ] **Step 8: Review and commit Task 1**

Run:

```powershell
git diff --check
git status --short -- public/ai src/ai/trained-weights.json
git add -- docs/superpowers/plans/2026-08-14-bag-search-performance-repair-plan.md src/ai/searchCache.ts src/ai/searchCache.test.ts src/ai/search.ts src/ai/search.test.ts src/ai/searchCorpus.test.ts src/hooks/useAiPlayer.test.ts
git diff --cached --check
git diff --cached
git commit -m "perf(ai): reuse compact placement prototypes"
```

Expected: protected-path status is empty and the commit contains only the five listed files.

### Task 2: Exact Equivalent-State Reduction and Survival Pruning

**Files:**
- Modify: `src/ai/searchCache.ts`
- Modify: `src/ai/searchCache.test.ts`
- Modify: `src/ai/search.ts`
- Modify: `src/ai/search.test.ts`
- Modify: `src/ai/searchCorpus.test.ts`

**Interfaces:**
- Consumes: Task 1 compact keys, placement prototypes, stable `selectPlacementBeam`, and `SURVIVAL_EPSILON`.
- Produces:

```ts
export class CappedCache<V> {
  constructor(limit: number, enabled: boolean);
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  get size(): number;
  get hits(): number;
}

export function collapseEquivalentPlacements<T extends {
  pending: PendingPreviewState;
  immediateHeuristic: number;
  enumerationIndex: number;
}>(entries: readonly T[], remainingDepth: number): T[];

export function chanceSurvivalUpperBound(
  accumulatedSurvival: number,
  remainingProbability: number,
): number;
export function shouldPruneChance(
  survivalUpperBound: number,
  incumbentSurvival: number,
): boolean;
```

- `SearchDiagnostics` adds `equivalentPlacementsRemoved` and `prunedChanceBranches`. These are not propagated into schema-5 artifacts.
- Internal `NodeResult` distinguishes `complete`, `aborted`, and `dominated`; only `complete` results enter the transposition table.

- [ ] **Step 1: Write capped-cache tests**

```ts
it('never exceeds the transposition cap and preserves exact cached values', () => {
  const cache = new CappedCache<number>(2, true);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  expect(cache.size).toBe(2);
  expect(cache.get('a')).toBe(1);
  expect(cache.get('b')).toBe(2);
  expect(cache.get('c')).toBeUndefined();
  expect(cache.hits).toBe(2);
});

it('does not insert or report hits when disabled', () => {
  const cache = new CappedCache<number>(2, false);
  cache.set('a', 1);
  expect(cache.get('a')).toBeUndefined();
  expect(cache.size).toBe(0);
  expect(cache.hits).toBe(0);
});
```

- [ ] **Step 2: Write reduction and pruning tests**

```ts
it('reduces equivalent futures only after retaining the beam winner', () => {
  const shared = pendingState();
  const reduced = collapseEquivalentPlacements([
    entry(shared, 3, 4),
    entry(shared, 5, 7),
    entry({ ...shared, hold: 2 }, 4, 1),
  ], 3);
  expect(reduced.map(({ immediateHeuristic, enumerationIndex }) =>
    [immediateHeuristic, enumerationIndex])).toEqual([[5, 7], [4, 1]]);
});

it('keeps the earlier enumeration index when equivalent heuristics tie', () => {
  const shared = pendingState();
  expect(collapseEquivalentPlacements([
    entry(shared, 5, 2), entry(shared, 5, 1),
  ], 3)[0].enumerationIndex).toBe(1);
});

it('prunes only a strictly worse survival upper bound', () => {
  expect(chanceSurvivalUpperBound(0.25, 0.5)).toBe(0.75);
  expect(shouldPruneChance(0.75, 0.8)).toBe(true);
  expect(shouldPruneChance(0.8, 0.8)).toBe(false);
  expect(shouldPruneChance(0.8 - SURVIVAL_EPSILON / 2, 0.8)).toBe(false);
});
```

- [ ] **Step 3: Run new tests and confirm RED**

Run:

```powershell
npx vitest run src/ai/searchCache.test.ts src/ai/search.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
```

Expected: FAIL because capped transpositions, equivalent collapse, and survival pruning are absent.

- [ ] **Step 4: Implement capped memoization and post-beam reduction**

Replace the raw `Map<string, SearchValue>` with
`new CappedCache<SearchValue>(MAX_TRANSPOSITION_ENTRIES, budget.cacheEnabled !== false)`.
Use compact `decisionStateKey`/`pendingStateKey` keys. Cache only complete node
results. Read `cache.size` and `cache.hits` into diagnostics at return.

Call `selectPlacementBeam` first, then `collapseEquivalentPlacements`. Build the
equivalence key from the exact pending public state plus remaining depth and
root/child identity. Keep the greater immediate heuristic, then the smaller
enumeration index. Count each discarded selected entry.

- [ ] **Step 5: Implement incumbent-aware chance pruning**

Change the chance call to receive `incumbentSurvival: number | null`. Accumulate
both exact value fields as before and also maintain remaining probability:

```ts
let remainingProbability = 1;
for (const outcome of enumerateBagOutcomes(pending.unseenBagMask)) {
  const child = /* existing exact revealed decision */;
  remainingProbability -= outcome.probability;
  survivalProbability += outcome.probability * child.value.survivalProbability;
  expectedHeuristicValue += outcome.probability * child.value.expectedHeuristicValue;

  if (incumbentSurvival !== null &&
      survivalProbability + remainingProbability <
        incumbentSurvival - SURVIVAL_EPSILON) {
    return dominatedResult(context);
  }
}
```

`dominatedResult` is neither an abort nor a complete value. The parent decision
skips that candidate and continues; it does not cache or add the partial
heuristic. Equality and epsilon-near equality must continue exact evaluation.

- [ ] **Step 6: Add integration parity assertions**

Extend existing cache-on/off and constrained depth-4 tests:

```ts
expect(stripDiagnostics(optimized)).toEqual(stripDiagnostics(oracle));
expect(optimized!.diagnostics.transpositionEntries)
  .toBeLessThanOrEqual(MAX_TRANSPOSITION_ENTRIES);
expect(optimized!.diagnostics.placementCacheEntries)
  .toBeLessThanOrEqual(MAX_PLACEMENT_CACHE_ENTRIES);
```

Add a high-stack state where the first completed action survives and another
candidate has a terminal chance outcome. Assert `prunedChanceBranches > 0`,
the optimized action/value matches cache-disabled search, and `aborted` remains
false.

- [ ] **Step 7: Run all search gates**

Run:

```powershell
npx vitest run src/ai/searchCache.test.ts src/ai/search.test.ts src/ai/searchCorpus.test.ts src/ai/stateTransitions.test.ts src/ai/placements.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
npx tsc -b --pretty false
npm run typecheck:train
```

Expected: all tests and both typechecks PASS with unchanged fixed-search action/value expectations.

- [ ] **Step 8: Review and commit Task 2**

```powershell
git status --short -- public/ai src/ai/trained-weights.json
git add -- src/ai/searchCache.ts src/ai/searchCache.test.ts src/ai/search.ts src/ai/search.test.ts src/ai/searchCorpus.test.ts
git diff --cached --check
git diff --cached
git commit -m "perf(ai): bound exact expectimax expansion"
```

### Task 3: Isolated 512 MiB Fixed-Search Viability Gate

**Files:**
- Create: `training/searchProbe.ts`
- Create: `training/searchProbeWorker.ts`
- Create: `training/searchProbe.test.ts`
- Modify: `tsconfig.train.json` only if its existing include patterns do not already cover both new files.

**Interfaces:**
- Consumes: `createSimState(20260727)`, `projectPublicSearchState`, `DEFAULT_WEIGHTS`, `toVector`, `searchFixed`, and `FIXED_SEARCH_LIMITS`.
- Produces:

```ts
export interface SearchProbeResult {
  seed: 20260727;
  maxOldGenerationSizeMb: 512;
  elapsedMs: number;
  heapUsedMiB: number;
  rssMiB: number;
  completedDepth: number;
  aborted: boolean;
  expandedDecisionNodes: number;
  expandedChanceNodes: number;
  cacheHits: number;
  placementCacheHits: number;
  transpositionEntries: number;
  placementCacheEntries: number;
  equivalentPlacementsRemoved: number;
  prunedChanceBranches: number;
}

export function runSearchProbe(timeoutMs?: number): Promise<SearchProbeResult>;
```

- [ ] **Step 1: Write import-safe probe tests**

```ts
it('uses the immutable production search contract and memory cap', () => {
  expect(SEARCH_PROBE_CONFIG).toEqual({
    seed: 20260727,
    maxOldGenerationSizeMb: 512,
    search: FIXED_SEARCH_LIMITS,
  });
});

it('rejects a worker result that did not complete exact depth four', () => {
  expect(() => assertSearchProbeResult({
    ...validProbeResult(), completedDepth: 3,
  })).toThrow(/completed depth 4/i);
  expect(() => assertSearchProbeResult({
    ...validProbeResult(), aborted: true,
  })).toThrow(/aborted/i);
});
```

- [ ] **Step 2: Run probe tests and confirm RED**

```powershell
npx vitest run training/searchProbe.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
```

Expected: FAIL because the probe modules do not exist.

- [ ] **Step 3: Implement the isolated worker probe**

`searchProbeWorker.ts` performs exactly one fixed search and posts one
`SearchProbeResult`. It never calls `simulateGame`, writes files, or reads a
hidden bag/RNG from search. It may use `createSimState` only to construct the
environment's initial public state before calling `projectPublicSearchState`.

`searchProbe.ts` creates:

```ts
new Worker(new URL('./searchProbeWorker.ts', import.meta.url), {
  execArgv: ['--import', 'tsx'],
  resourceLimits: { maxOldGenerationSizeMb: 512 },
});
```

Reject on worker error, nonzero exit, invalid result, or timeout. Always
terminate the worker and clear the timeout. Its import-safe CLI prints exactly
one JSON result and sets a nonzero exit code on failure.

- [ ] **Step 4: Run unit tests**

```powershell
npx vitest run training/searchProbe.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
npm run typecheck:train
```

Expected: PASS without running the full depth-4 probe.

- [ ] **Step 5: Run the approved viability probe**

Run exactly:

```powershell
npx tsx training/searchProbe.ts
```

Expected acceptance:

- exit 0;
- `completedDepth` exactly 4;
- `aborted` false;
- worker completes under its 512 MiB old-generation cap;
- `elapsedMs <= 5000` on this machine;
- cache entry counts do not exceed 65,536/16,384.

If any condition fails, record the JSON/error, elapsed time, process exit, and
worker OOM/timeout evidence in the continuity checkpoint, preserve all commits
and artifacts, and stop. Do not continue to Task 4, change 4/64/32, raise the
heap cap, run training, or delete the stale lock.

- [ ] **Step 6: Review and commit Task 3**

```powershell
git status --short -- public/ai src/ai/trained-weights.json
git add -- training/searchProbe.ts training/searchProbeWorker.ts training/searchProbe.test.ts tsconfig.train.json
git diff --cached --check
git diff --cached
git commit -m "test(ai): gate fixed-search memory viability"
```

Omit `tsconfig.train.json` from staging when it required no edit.

### Task 4: Abortable Worker Pool Without Failure Scoring

**Files:**
- Modify: `training/pool.ts`
- Modify: `training/pool.test.ts`

**Interfaces:**
- Consumes: existing task ordering, crash retry, replacement, and `destroy()` ownership.
- Produces:

```ts
export class WorkerPoolAbortError extends Error {
  readonly name = 'WorkerPoolAbortError';
}

export interface WorkerPoolRunOptions {
  signal?: AbortSignal;
}

run(tasks: SimTask[], options?: WorkerPoolRunOptions): Promise<SimTaskResult[]>;
```

- [ ] **Step 1: Write abort RED tests**

Use controlled `EventEmitter` workers whose `postMessage` never responds:

```ts
it('aborts in-flight work without retrying or returning failed fitness', async () => {
  const workers: BlockingWorker[] = [];
  const abortPool = await WorkerPool.create(2, () => {
    const worker = new BlockingWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const controller = new AbortController();
  const run = abortPool.run([task(0, 1), task(1, 2)], {
    signal: controller.signal,
  });

  controller.abort();

  await expect(run).rejects.toBeInstanceOf(WorkerPoolAbortError);
  expect(workers).toHaveLength(2);
  expect(workers.every((worker) => worker.terminateCalls === 1)).toBe(true);
  expect(workers.flatMap((worker) => worker.messages)).toHaveLength(2);
});

it('rejects an already-aborted nonempty run before posting work', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(abortPool.run([task(0, 1)], { signal: controller.signal }))
    .rejects.toBeInstanceOf(WorkerPoolAbortError);
  expect(posted).toEqual([]);
});
```

- [ ] **Step 2: Run pool tests and confirm RED**

```powershell
npx vitest run training/pool.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
```

Expected: FAIL because `run` has no options, abort error, or cancellation teardown.

- [ ] **Step 3: Implement one-shot abort and idempotent destroy**

At run start, reject an already-aborted nonempty task set. Register one abort
listener before feeding workers. The listener must atomically set `settled`,
remove itself, await the pool's idempotent `destroy()`, and reject with
`WorkerPoolAbortError`. `handleDeath` must return immediately when settled or
destroyed so intentional termination never replaces a worker or retries a
task. Normal completion/rejection also removes the listener.

Store a private `destroyPromise` so concurrent abort/finally calls terminate
each worker once:

```ts
async destroy(): Promise<void> {
  if (this.destroyPromise !== null) return this.destroyPromise;
  this.destroyed = true;
  const workers = this.workers;
  this.workers = [];
  this.destroyPromise = Promise.all(workers.map((worker) => worker.terminate()))
    .then(() => undefined);
  return this.destroyPromise;
}
```

Do not change genuine crash retry behavior without an active abort signal.

- [ ] **Step 4: Run pool and worker integration tests**

```powershell
npx vitest run training/pool.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
npm run typecheck:train
```

Expected: abort, ordering, genuine crash retry, replacement failure, and real worker parity tests PASS.

- [ ] **Step 5: Review and commit Task 4**

```powershell
git add -- training/pool.ts training/pool.test.ts
git diff --cached --check
git diff --cached
git commit -m "fix(training): cancel in-flight worker pools"
```

### Task 5: SIGINT Generation-Boundary Checkpoint and Lock Release

**Files:**
- Modify: `training/train.ts`
- Modify: `training/train-cli.test.ts`
- Modify: `docs/ai-training-handoff.md`

**Interfaces:**
- Consumes: Task 4 `WorkerPool.run(tasks, { signal })` and `WorkerPoolAbortError`, existing `saveCheckpoint`, outer `pool.destroy()`/`runLock.release()` finally blocks.
- Produces: first SIGINT aborts the active pool and saves the last complete CEM generation boundary; an interrupted gen-0 fresh run writes a valid schema-5 `gen: 0` checkpoint with no generation log line.

- [ ] **Step 1: Isolate trainer CLI tests from the live repository lock**

In `training/train-cli.test.ts`, create one suite-local temporary repository in
`beforeAll`: recursively copy `training/`, `src/`, `package.json`, and
`tsconfig.train.json`; run `git init`; execute copied `training/train.ts` while
continuing to use `process.execPath --import tsx`. Remove it in `afterAll`.
Change `runTrain` to default to this isolated repository. Keep source-text
assertions against the real `ROOT`.

Add a regression proving the isolated runner succeeds at
`--resume --generations 0` even while the live repository's confirmed stale
lock remains present. The test must never inspect, remove, or rewrite that live
lock.

- [ ] **Step 2: Write the controlled SIGINT RED test**

Create a preload in the isolated repository that intercepts the first worker
task, emits `process.emit('SIGINT')` on the next turn, and never posts a result:

```ts
it('abandons gen zero, writes a resumable boundary, and releases the lock', () => {
  const outputDir = emptyOutputDirectory(isolatedRepository);
  const preload = writeSigintWorkerPreload(isolatedRepository);
  const result = runFreshTrainWithPreload(outputDir, preload, 10_000);

  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/abandoning incomplete generation 0/i);
  expect(JSON.parse(readFileSync(join(outputDir, 'checkpoint.json'), 'utf8')))
    .toMatchObject({ version: 5, objective: 'score-rate-v4', gen: 0 });
  expect(existsSync(join(outputDir, 'training-log.jsonl'))).toBe(false);

  const resume = runTrain(outputDir, true);
  expect(resume.status).toBe(0);
});
```

- [ ] **Step 3: Run the SIGINT test and confirm RED**

```powershell
npx vitest run training/train-cli.test.ts --testNamePattern "abandons gen zero" --pool=threads --maxWorkers=1 --minWorkers=1
```

Expected: FAIL because the current handler does not abort `pool.run` or reach `saveCheckpoint`.

- [ ] **Step 4: Implement trainer cancellation**

Create one `AbortController` after pool construction. First SIGINT:

```ts
stopping = true;
console.log(`\ncaught SIGINT — abandoning incomplete generation ${state.gen}`);
stopController.abort();
```

Pass `{ signal: stopController.signal }` to generation and reevaluation
`pool.run` calls. In the main loop, catch only `WorkerPoolAbortError` when
`stopping` is true; do not update CEM, append a generation log, advance `gen`,
or run reevaluation. Then call the existing `saveCheckpoint()` once and print
that the last complete boundary was saved. Other errors still propagate.

Keep pool destruction and run-lock release in the existing nested `finally`
blocks. Ensure the SIGINT listener is removed during normal completion so
repeated in-process tests do not accumulate handlers. A second SIGINT sets
`process.exitCode = 1` and makes no checkpoint-complete claim.

- [ ] **Step 5: Run trainer and artifact tests**

```powershell
npx vitest run training/train-cli.test.ts training/pool.test.ts training/runLock.test.ts training/runArtifacts.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
npm run typecheck:train
```

Expected: all tests PASS; temp artifacts are cleaned by tests; the live stale lock and `public/ai` contents remain unchanged.

- [ ] **Step 6: Update the operator handoff**

Add a dated `score-rate-v4` performance-repair note to
`docs/ai-training-handoff.md` stating:

```text
- ordinary fixed depth-4 viability is gated by training/searchProbe.ts at 512 MiB;
- SIGINT abandons the incomplete generation and checkpoints the last complete boundary;
- gen-0 interruption resumes by rerunning gen 0 with identical seeds;
- stale-lock cleanup is never automatic and requires PID/process verification plus operator authorization;
- code/probe success is not training, Tetris-share, paired, publication, or runtime acceptance.
```

- [ ] **Step 7: Review and commit Task 5**

```powershell
git status --short -- public/ai src/ai/trained-weights.json
git add -- training/train.ts training/train-cli.test.ts docs/ai-training-handoff.md
git diff --cached --check
git diff --cached
git commit -m "fix(training): checkpoint cleanly on interrupt"
```

### Task 6: Whole-Change Review and Fresh Code Gates

**Files:**
- Modify only files required to fix verified findings in the Task 1-5 commit range.
- Update: `C:\Users\Administrator\.codex\continuity\workspaces\971086e837942ad7\bagperf.md` through `apply_patch`; this file is outside Git and must never be staged.

**Interfaces:**
- Consumes: commits from Tasks 1-5 and design commit `e40bdce`.
- Produces: evidence-backed final code verdict and the exact user-run training handoff; no training or artifact mutation.

- [ ] **Step 1: Perform a whole-range semantic review**

Inspect:

```powershell
git log --oneline 76ce2f3..HEAD
git diff --stat 76ce2f3..HEAD
git diff 76ce2f3..HEAD -- src/ai training docs/ai-training-handoff.md
```

Check every invariant from the design: public-only state, exact chance
probabilities, 4/64/32, post-beam-only reduction, strict survival pruning,
cache caps, no partial cache values, no fitness changes, no partial-generation
logs, cancellation without failure scoring, and guaranteed listener/worker/lock
cleanup. Fix only confirmed Critical/Important defects via a new failing test,
then a scoped commit.

- [ ] **Step 2: Rerun the isolated viability probe fresh**

```powershell
npx tsx training/searchProbe.ts
```

Expected: exact completed depth 4, not aborted, <=512 MiB configured heap,
elapsed <=5000 ms, cache caps respected. Stop on failure.

- [ ] **Step 3: Run all fresh code gates separately**

```powershell
npm test
npm run lint
npm run build
npm run typecheck:train
git diff --check
git status --short -- public/ai src/ai/trained-weights.json
```

Expected: every code command exits 0; protected-path status is empty. Do not
substitute historical outputs for these fresh gates.

- [ ] **Step 4: Verify live process, artifact, and lock boundaries**

Read only:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'"
Get-ChildItem -Force public/ai/score-rate-v4
Get-ChildItem -Force public/ai/score-rate-v
Get-ChildItem -Force $env:TEMP -Filter 'tetris-trainer-*.lock'
```

Expected: no probe/test Node remains; both run directories still contain zero
entries; the pre-existing stale lock still exists unchanged and still names a
non-running owner PID. Do not delete it.

- [ ] **Step 5: Checkpoint and hand off**

Update the continuity Markdown with commits, exact test/probe outputs, elapsed
time, memory cap, protected-artifact state, stale-lock state, and the next
operator action. Run `Checkpoint`.

Report to the user:

- the spec and plan paths;
- implementation commits;
- probe and code-gate evidence;
- confirmation that train/bench/paired/publication/runtime were not run;
- that stale-lock deletion remains separately unauthorized;
- only after the user authorizes stale-lock removal, provide the validated
  one-generation command for the user to run personally.
