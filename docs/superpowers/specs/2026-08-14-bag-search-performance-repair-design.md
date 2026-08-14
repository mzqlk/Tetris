# Bag-Aware Search Performance Repair Design

**Date:** 2026-08-14

## 1. Purpose

The implemented `bag-expectimax-hold-v1` contract is correct on constrained
corpora but is not viable on an ordinary low-stack board. A fresh
`score-rate-v4` generation started with eight workers caused every observed
simulation task to exhaust its worker heap and retry. Generation zero never
completed, so no checkpoint or log was produced.

This repair makes the existing exact search bounded enough to evaluate before
any further training is attempted. It does not introduce a new search contract
or weaken the approved one.

## 2. Live Failure Evidence

On the initial public state for seed `20260727`:

- the root has 17 legal placements;
- each root placement has five exact preview outcomes;
- those 85 child decision states contain 2,890 raw placements and 2,720 after
  the child beam;
- the unpruned four-lock shape is approximately
  `17 * 5 * 32 * 4 * 32 * 3 * 32 = 33,423,360` leaf placement evaluations,
  before Hold branches;
- a bounded probe stopped after 100,000 abort checks, took about 4.5 seconds,
  expanded 4,965 decision and 1,180 chance nodes, and recorded zero cache hits;
- cache-on and cache-off probes both peaked near 75 MiB at that early boundary;
- Node 24 reports an approximately 4.3 GiB heap limit per worker, while eight
  such workers run on a machine with 31.8 GiB physical memory.

The primary defect is therefore exact-tree execution cost and retained search
state, not a small configured worker heap or an ordinary deadlock. Reducing the
worker count can reduce aggregate pressure but cannot make one exploding root
search viable.

The interrupted run also exposed an orchestration defect: the SIGINT handler
prints that it is writing a checkpoint but only sets a Boolean. The current
`pool.run()` must finish before `saveCheckpoint()` executes. A forced exit can
therefore leave neither a checkpoint nor a released repository lock.

## 3. Fixed Contracts

The repair must preserve all of these invariants:

- Search input remains exactly public `board`, `current`, `next`, `hold`,
  `holdAvailable`, and `unseenBagMask`. Search does not read an ordered bag,
  bag index, seed, or RNG state.
- Chance nodes enumerate every remaining seven-bag piece with its exact equal
  conditional probability. No chance outcome is sampled or removed.
- Fixed training/evaluation search remains lock depth 4, root beam 64, and
  child beam 32. The current piece is lock depth 1 and Hold consumes no lock
  depth.
- Placement ordering remains immediate heuristic descending, then original
  enumeration index ascending. Decision values remain lexicographic:
  `survivalProbability`, then `expectedHeuristicValue`.
- The scalar fitness remains exactly `meanScore / scheduled maxPieces`.
- The 13-entry `FEATURE_NAMES` order, score-rate-v4 schema 5, and
  `bag-expectimax-hold-v1` metadata remain unchanged.
- Browser and training continue to import the same pure implementation under
  `src/ai/`. No Node, DOM, filesystem API, or module-level mutable cache is
  added there.
- Board rows are never mutated in place, and placement enumeration continues
  to use engine SRS behavior.

## 4. Selected Approach

The selected approach is exact semantic optimization plus cancellable trainer
orchestration. Merely raising worker heaps or lowering worker count is rejected
because it does not address single-search complexity. Lowering depth or beam
width, sampling preview pieces, or adding a wall-clock abort to fixed training
search is rejected because it changes the computation graph.

### 4.1 Collision-free occupancy keys

Search behavior depends on whether each board cell is occupied, not on the
numeric identity of an already locked piece. Encode each of the 22 rows as one
10-bit occupancy mask and pack those masks into a fixed-length internal string.
The encoding is collision-free for board occupancy and is much smaller than
the current comma/semicolon representation.

State keys append only fields that can affect the requested subproblem:

- current type, rotation, x, and y;
- next type when that depth/Hold state can consume it;
- Hold piece and Hold availability;
- unseen bag mask when another preview can be revealed;
- remaining lock depth and root/child identity.

Beam widths do not need to be repeated in each key because one search context
has one immutable budget. Irrelevant public fields may be omitted only where a
test proves that the subproblem cannot read them. For example, a depth-one
placement-only state with Hold unavailable cannot consume `next` or the bag
mask.

### 4.2 Placement prototype reuse

Introduce a per-search placement-prototype cache keyed by occupancy board plus
the full current-piece pose. A prototype contains:

- the enumerated placement and its original enumeration index;
- the post-clear board, cleared-line count, and placed cells;
- the extracted feature vector and its dot product for this search's weights.

These values do not depend on visible `next`, Hold contents, Hold availability,
or unseen bag mask. Each decision state materializes its own pending public
state from the prototype and its public fields. This reuses the expensive SRS,
lock/clear, and feature work across chance outcomes without sharing mutable
board rows.

### 4.3 Equivalent-action reduction after the beam

The 64/32 beam is selected before any reduction. Among selected placements,
two entries may be collapsed only when their future public pending-state key is
identical. Because they then have exactly the same future value, retain the
entry with the higher immediate heuristic; on equality retain the earlier
enumeration index. The discarded entry is mathematically dominated and cannot
win under the existing comparison rule.

Hold remains outside the placement beam and is never merged with a placement
action.

### 4.4 Bounded exact memoization

Use the compact public-state key for the per-search transposition table. Cache
only complete results. Set `MAX_TRANSPOSITION_ENTRIES = 65_536` and
`MAX_PLACEMENT_CACHE_ENTRIES = 16_384` per search call. Once a cache reaches its
cap, stop inserting new entries while retaining existing entries; a cache miss
recomputes the same pure subproblem and therefore cannot alter the result. The
512 MiB acceptance probe verifies these initial limits rather than silently
raising them.

Do not use hash-only keys, probabilistic eviction, cross-call state, or global
mutable caches. A collision or weight leak would silently change decisions.

### 4.5 Incumbent-aware exact pruning

When a decision node already has a completed incumbent, pass its survival
probability into candidate chance evaluation. After each exact outcome, the
maximum possible final survival for that candidate is:

```text
accumulated weighted survival + remaining probability mass * 1
```

If this upper bound is strictly below the incumbent survival by more than
`SURVIVAL_EPSILON`, stop evaluating that candidate. It cannot win regardless
of its heuristic value. Equality is not pruned because the heuristic tie-break
could still win. A pruned partial value is never cached or returned as a
completed chance value.

No heuristic pruning is introduced in this repair because no sufficiently
tight, proven feature bound currently exists.

## 5. Trainer Cancellation and Checkpoint Boundary

`WorkerPool.run` accepts an optional `AbortSignal`. Aborting a run must:

- settle the active pool promise with a distinct abort error;
- stop feeding or replacing workers;
- terminate in-flight workers through the existing pool teardown path;
- remove signal listeners exactly once;
- never convert cancellation into zero-fitness failed games.

The trainer owns one abort controller. On the first SIGINT it records the stop
request, aborts the active pool run, and reports that it is abandoning the
incomplete generation. The trainer then writes the last completed generation
boundary. For a fresh run interrupted during generation zero, that checkpoint
contains the initial CEM state at `gen: 0`; resume deliberately reruns the whole
generation with the same seeds. Partial candidate results never enter CEM.

The existing outer `finally` blocks must destroy the pool and release the
repository lock after cancellation. A second SIGINT may request an immediate
nonzero exit, with no claim that cleanup completed.

The repair does not automatically reclaim an existing stale lock. The current
lock format contains a PID but no process-start identity, so PID reuse prevents
safe automatic deletion. The already confirmed stale lock remains a separate
operator-authorized cleanup action before the next run.

## 6. Testing Strategy

### 6.1 Search equivalence

- Compare optimized and cache-disabled results on deterministic depth 1-3
  states and constrained depth-4 corpora: action, survival, and heuristic value
  must match; diagnostics may differ.
- Prove collision-free occupancy keys distinguish every changed occupied cell
  and deliberately treat nonzero piece identities as the same occupancy.
- Prove placement prototypes are reused across states that differ only in
  preview/Hold/bag fields while materialized pending states retain those exact
  public fields.
- Prove equivalent reduction happens after beam selection and preserves the
  higher heuristic/earlier enumeration winner.
- Prove incumbent pruning occurs only on a strictly worse survival upper bound;
  equality still evaluates the heuristic tie-break and no pruned node is
  cached.
- Retain exact bag probabilities, Hold, terminal, abort fallback, deterministic
  rerun, and 64/32 cutoff regressions.

### 6.2 Memory and throughput probe

Run an ordinary initial-state fixed search in an isolated worker capped at
512 MiB. The worker must return a deterministic, non-aborted, completed-depth-4
decision. On the approved development machine the same probe must finish in
approximately five seconds or less. Wall-clock time is recorded as a local
acceptance measurement rather than a normal unit-test assertion, to avoid a
machine-speed-dependent test suite.

If the exact search cannot meet both the 512 MiB completion boundary and the
local five-second target after the selected optimizations, stop. Report the
measured nodes, cache entries/hits, elapsed time, and peak memory as evidence
that the fixed contract remains a load-bearing blocker. Do not silently lower
4/64/32 or ask the user to run another generation.

### 6.3 Cancellation

- Abort a pool with an in-flight worker and assert prompt rejection, no retry,
  no zero-fitness result, and complete worker teardown.
- Exercise trainer SIGINT through its existing child-process test harness using
  a controlled blocked worker. Assert a schema-5 gen-0 checkpoint is valid,
  the log has no partial generation, the process exits, and a subsequent lock
  acquisition succeeds.
- Preserve existing crash-retry behavior for genuine worker failures when no
  abort signal is active.

## 7. Verification and Authorization Boundaries

Implementation verification may run focused Vitest files, the full unit suite,
TypeScript checks, lint, build, and `git diff --check`. The isolated search
probe is authorized as part of this repair because it neither trains nor writes
run artifacts.

The assistant must not run `npm run train`, `npm run bench`, or
`npm run bench:paired`; must not publish; and must not modify
`public/ai/`, `src/ai/trained-weights.json`, or runtime weights. After code
verification, the user decides whether to authorize stale-lock removal and
runs the next one-generation training command personally.

## 8. Completion Criteria

The repair is code-complete only when:

1. semantic parity and optimization regressions pass;
2. ordinary initial fixed depth-4 search completes below the 512 MiB worker
   cap and meets the approximately five-second local target;
3. SIGINT leaves a valid last-boundary checkpoint and releases the run lock in
   the controlled test;
4. full test, lint, build, training typecheck, and diff checks pass;
5. protected artifacts and the confirmed stale lock remain unchanged;
6. the implementation diff is reviewed before commit.

Passing these code gates establishes search execution viability only. It does
not establish score-rate improvement, Tetris share, survival qualification,
paired superiority, publication readiness, or browser/runtime acceptance.
