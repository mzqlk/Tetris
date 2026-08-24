# score-rate-v5 C0 Archived Representative Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and independently verify a read-only C0 audit that evaluates four frozen archived vectors on one pre-registered matched-seed schedule, while stopping before the expensive audit command is run.

**Architecture:** Add one standalone training-side module with a dependency-injected pure core and a thin Node/WorkerPool adapter. The module first proves source provenance and seed independence, then runs seed-major tasks, converts them to validated per-game records, reorders them to the vector-major layout required by the existing aggregate helper, computes only the four pre-registered paired comparisons, and emits one canonical stdout JSON result. Artifact validation, simulation, statistics, and CLI execution remain separate internal units so every load-bearing rule can be tested without running any 5000-piece game.

**Tech Stack:** TypeScript 5.6, Node.js/tsx, Vitest 3, existing schema-6 run validators, `WorkerPool`, `aggregateFitness`, `pairedInterval30`, shared deterministic simulator/search logic, SHA-256.

## Global Constraints

- Before edits, read `AGENTS.md`, `docs/ai-training-handoff.md`, the approved C0 spec, this plan, and the `v5-postmortem` checkpoint; run `Locate -> read -> Resume`, then refresh HEAD/status/index, Node processes, repository/index locks, preserved run entries/hashes, candidate/default-run absence, and both published weight hashes.
- Work directly in `D:\WorkSpace\Tetris`; do not create a branch or worktree. Preserve all existing A+/B1/B1.1/B1.2 WIP, including the existing overlapping `package.json` changes.
- Preserve exactly `score-rate-v5`, schema 6, the unchanged 13-entry `FEATURE_NAMES` order, `bag-expectimax-hold-v2`, depth 4, beams 64/32, `maxWorkUnits=3584`, `budget-corpus-v1`, caches 65536/16384, and fitness `meanScore / scheduled maxPieces`.
- Preserve standard Hold, exact seven-bag public information, SRS placement behavior, survival-first ordering, deterministic tie-breaks, browser/Node shared pure logic, and board-row immutability.
- Do not modify `src/ai/features.ts`, `src/ai/weights.ts`, `src/ai/search.ts`, `src/ai/searchBudget.ts`, `src/ai/simulate.ts`, `training/cem.ts`, `training/pool.ts`, `training/runArtifacts.ts`, `training/pairedStats.ts`, `training/train.ts`, schema, checkpoint/log/candidate contracts, search metadata, or weights.
- Do not modify, move, delete, archive, or rewrite `public/ai/score-rate-v5-smoke-20260820-200634`, `src/ai/trained-weights.json`, `public/ai/best-weights.json`, any other run artifact, or any repository/TEMP lock.
- Never read, execute, hash, modify, move, delete, stage, commit, typecheck, test, or review `training/searchProbe.ts`, `training/searchProbeWorker.ts`, or `training/searchProbe.test.ts`. Their path names may appear only in ordinary `git status` evidence and explicit exclusion assertions.
- Do not run bare `npm test`, bare repository lint, bare `npm run typecheck:train`, the C0 audit script, any B1 diagnostic, calibration, training/resume/restart, bench, paired benchmark, publication, push, or browser/runtime acceptance.
- Use TDD for each behavior change: observe the named focused RED, implement the minimum behavior, then observe focused GREEN. Record commands, exit codes, test counts, review findings, and scoped re-review in `.superpowers/sdd/2026-08-24-score-rate-v5-c0-archived-representative-audit/`.
- Each Task receives an independent implementer, then independent spec review and code-quality review. Every Critical or Important finding must be reproduced or guarded by a focused RED, minimally fixed, and independently re-reviewed before the next Task.
- Do not commit during Tasks 1–4. The existing `package.json` contains protected unrelated WIP, so commit/integration remains a later exact-hunk gate. Keep the real index empty; never broad-add, stash, reset, restore, clean, or rewrite unrelated changes.
- Completed code gates authorize only a later, separately reviewed operational C0 audit. They do not authorize executing `npm run audit:c0-archived-representatives --silent`.

---

## File Responsibility Map

| File | Operation | Responsibility |
| --- | --- | --- |
| `training/archivedRepresentativeAudit.ts` | Create | Frozen provenance, vector extraction, schedule/task construction, per-game validation, aggregation, paired intervals, verdict, replay determinism, WorkerPool lifecycle, stdout-only CLI |
| `training/archivedRepresentativeAudit.test.ts` | Create | Source/hash/vector/seed gates, task order, aggregation alignment, verdict matrix, canonical digest, replay equality, runtime/abort cleanup, no-file CLI |
| `package.json` | Modify one exact script entry | Add `audit:c0-archived-representatives`; preserve every existing WIP script and all other JSON bytes semantically |

## Frozen Constants and Interfaces

Implement these names and literal values once in `training/archivedRepresentativeAudit.ts`; later Tasks extend their behavior without renaming them.

```ts
export const C0_MODE = 'c0-archived-representative-audit' as const;
export const C0_SCHEDULE_ID = 'c0-archived-representative-audit-v1' as const;
export const C0_SOURCE_RUN =
  'public/ai/score-rate-v5-smoke-20260820-200634' as const;
export const C0_BASE_SEED = 20260824 as const;
export const C0_HISTORICAL_PAIRED_SEED = 20260803 as const;
export const C0_GAMES = 30 as const;
export const C0_MAX_PIECES = 5000 as const;
export const C0_REPLAY_INDICES = [0, 29] as const;
export const C0_VECTOR_ORDER = [
  'published-baseline',
  'gen6-best',
  'gen9-best',
  'gen10-mu',
] as const;

export type C0VectorId = typeof C0_VECTOR_ORDER[number];
export type C0CompletedStatus =
  | 'pass-retention-loss-supported'
  | 'fail-signal-not-reproduced'
  | 'fail-joint-improvement-not-shown';
export type C0AuditStatus =
  | C0CompletedStatus
  | 'invalid-input'
  | 'runtime-fail';
export type C0CompletedFailureReason =
  | 'gen6-tetris-aggregate-below-0.01'
  | 'paired-tetris-lower-not-positive'
  | 'paired-score-lower-not-positive'
  | 'gen6-survival-lower';
export type C0InvalidInputReason =
  | 'source-hash-mismatch'
  | 'source-identity-drift'
  | 'run-contract-mismatch'
  | 'log-boundary-mismatch'
  | 'published-identity-mismatch'
  | 'vector-identity-mismatch'
  | 'seed-schedule-mismatch';
export type C0RuntimeFailureReason =
  | 'game-result-mismatch'
  | 'worker-pool-recovery'
  | 'worker-pool-failure'
  | 'worker-pool-destroy-failure'
  | 'nondeterministic-replay';

export interface C0Vector {
  id: C0VectorId;
  source: 'publishedBaseline.weights' | 'gen=6.bestWeights' |
    'gen=9.bestWeights' | 'normalize(checkpoint.mu)';
  weights: number[];
  digest: string;
}

export interface C0Schedule {
  id: typeof C0_SCHEDULE_ID;
  baseSeed: typeof C0_BASE_SEED;
  seeds: number[];
  seedDigest: string;
  games: typeof C0_GAMES;
  maxPieces: typeof C0_MAX_PIECES;
  vectorOrder: readonly C0VectorId[];
  taskOrder: 'seed-major';
}

export interface C0ScheduleEvidence {
  id: typeof C0_SCHEDULE_ID;
  baseSeed: typeof C0_BASE_SEED;
  seedDigest: string;
  games: typeof C0_GAMES;
  maxPieces: typeof C0_MAX_PIECES;
  vectorOrder: readonly C0VectorId[];
  taskOrder: 'seed-major';
  replayIndices: readonly [0, 29];
}

export interface C0SourceBundle {
  sourceHashes: {
    checkpoint: string;
    log: string;
    bundledWeights: string;
    runtimeWeights: string;
  };
  vectors: readonly C0Vector[];
  schedule: C0Schedule;
  checkpointWorkers: number;
}

export interface C0DeterministicGameProjection {
  vectorId: C0VectorId;
  gameIndex: number;
  seed: number;
  score: number;
  scoreRate: number;
  pieces: number;
  reason: 'pieceCap' | 'gameover';
  clearCounts: LineClearCounts;
  tetrisLineShare: number;
  meanHeight: number;
  strategyDiagnostics: StrategyDiagnostics;
  searchDiagnostics: SimulationSearchDiagnostics;
}

export interface C0GameRecord {
  taskId: number;
  projection: C0DeterministicGameProjection;
  projectionDigest: string;
}

export interface C0Comparison {
  role: 'primary' | 'negative-control' | 'qualification-context';
  left: C0VectorId;
  right: C0VectorId;
  scoreRateInterval: PairedInterval;
  tetrisLineShareInterval: PairedInterval;
  leftTetrisLineShare: number;
  rightTetrisLineShare: number;
  leftPieceCapGames: number;
  rightPieceCapGames: number;
}

export interface C0VectorAggregate {
  id: C0VectorId;
  source: C0Vector['source'];
  digest: string;
  meanScore: number;
  scoreRate: number;
  meanLines: number;
  meanHeight: number;
  meanClearCounts: LineClearCounts;
  tetrisLineShare: number;
  pieceCapGames: number;
  gameoverGames: number;
  strategyDiagnostics: StrategyDiagnostics;
  searchDiagnostics: SimulationSearchDiagnostics;
}

export interface C0GateEvidence {
  scoreLowerPositive: boolean;
  tetrisLowerPositive: boolean;
  gen6AggregateTetrisAtLeastOnePercent: boolean;
  gen6SurvivalNonLower: boolean;
  allPairsComplete: true;
  deterministicReplay: true;
}

export interface C0ReplayEvidence {
  indices: readonly [0, 29];
  recordCount: 8;
  deterministic: true;
  projectionDigests: string[];
}

export interface C0AuditProjection {
  mode: typeof C0_MODE;
  status: C0CompletedStatus;
  schedule: C0ScheduleEvidence;
  searchMetadata: SearchMetadata;
  sourceHashes: C0SourceBundle['sourceHashes'];
  vectors: C0VectorAggregate[];
  comparisons: C0Comparison[];
  gates: C0GateEvidence;
  failureReasons: C0CompletedFailureReason[];
  replay: C0ReplayEvidence;
}

export interface C0AuditOutput extends C0AuditProjection {
  resultDigest: string;
}

export type C0FailureOutput = {
  mode: typeof C0_MODE;
  status: 'invalid-input';
  failureReasons: [C0InvalidInputReason];
  resultDigest: string;
} | {
  mode: typeof C0_MODE;
  status: 'runtime-fail';
  failureReasons: [C0RuntimeFailureReason];
  resultDigest: string;
};

export class C0InvalidInputError extends Error {
  readonly name = 'C0InvalidInputError';
  constructor(readonly reason: C0InvalidInputReason) {
    super(`C0 invalid-input:${reason}`);
  }
}

export class C0RuntimeError extends Error {
  readonly name = 'C0RuntimeError';
  constructor(readonly reason: C0RuntimeFailureReason) {
    super(`C0 runtime-fail:${reason}`);
  }
}
```

The authoritative identities are:

```ts
export const C0_SOURCE_HASHES = Object.freeze({
  checkpoint: '93B2A63FF221B7E6EE1BD5CBFF8AE8C75B5B96411AD5B2EE4AFFA3806B6C06BD',
  log: 'C86457320694A8C2D85C734D64D9CE6E58166D913974F945370D15FBC7C651BA',
  bundledWeights: '062552496E7E1101502E62B8570DFDAF2A60B54EF4FEF1EA539723B910550D90',
  runtimeWeights: '062552496E7E1101502E62B8570DFDAF2A60B54EF4FEF1EA539723B910550D90',
});

export const C0_VECTOR_DIGESTS = Object.freeze({
  'published-baseline': 'f623fd7662d2b01b1c815d80897aa89379b72bbd66d654e1bbfe31e46ca7a67d',
  'gen6-best': '233cc500168fe7258305d87654a640ad9aef3f67092d5e0e016f910b9d660ca9',
  'gen9-best': 'f67d20457d421dbf4778e8c5196fd9611c711ba453e8e8fac0c2afe7a49be141',
  'gen10-mu': 'b669671a3cf0132db1e2948cc610aef98bf22a0284f182ac248a74fdf3234b1b',
});

export const C0_RAW_MU_DIGEST =
  '35c5623d1b07866673c636a0c1bf26fa32e53baf9ca9726482ec582261e62152';
export const C0_SEED_DIGEST =
  '1c2ce47837f0483d3f366a6817a29d88614029febfd6aca6dd42e376873b204b';
```

---

### Task 1: Freeze source provenance, vector extraction, and seed schedule

**Files:**
- Create: `training/archivedRepresentativeAudit.ts`
- Create: `training/archivedRepresentativeAudit.test.ts`

**Interfaces:**
- Consumes: `resolveRunPaths`, `readCompatibleRunArtifacts`, `ScoreRateCheckpoint`, `normalize`, `parseWeightsFile`, `toVector`, `hashSeed`, `fixedReevaluationSeeds`, `SEARCH_METADATA`, and the constants above.
- Produces: `loadC0Sources(dependencies?)`, `buildC0Schedule(checkpoint)`, `C0SourceDependencies`, `C0SourceBundle`, and all frozen constants/types above.

Test helpers in this Task must have these exact signatures and must return fresh deep-cloned values on every call:

```ts
type SourceMutation =
  | 'missing-gen6' | 'duplicate-gen6' | 'renormalized-gen6'
  | 'wrong-gen9-digest' | 'wrong-raw-mu-digest'
  | 'wrong-normalized-mu-digest' | 'qualified-candidate-present'
  | 'generation-count-not-ten' | 'reevaluation-not-final';

function validCheckpoint(): ScoreRateCheckpoint;
function validSourceDependencies(overrides?: {
  hashes?: Partial<C0SourceBundle['sourceHashes']>;
}): C0SourceDependencies;
function mutatedSourceDependencies(mutation: SourceMutation): C0SourceDependencies;
function trainingSeeds(checkpoint: ScoreRateCheckpoint): number[];
function historicalPairedSeeds(): number[];
function overlap(left: readonly number[], right: readonly number[]): number[];
```

- [ ] **Step 1: Create the Task 1 ledger and record fresh protected state**

  Record the fresh HEAD, ordinary status, empty real index, relevant Node process list, repository/index lock absence, preserved run entries/hashes, published hashes, and the fact that the C0 audit command remains forbidden. Do not copy artifact bodies or protected probe contents into the ledger.

- [ ] **Step 2: Write focused source-provenance RED tests**

  Add tests with an injected `C0SourceDependencies` fixture so no test depends on a 5000-piece simulation. The fixture returns a strict-validator-approved checkpoint, a parsed eleven-record log, exact hash strings, and parsed published vectors. Cover at least these exact cases:

  ```ts
  it('extracts only the four frozen vectors after strict schema-6 run validation', () => {
    const sources = loadC0Sources(validSourceDependencies());
    expect(sources.vectors.map(({ id, digest }) => ({ id, digest }))).toEqual([
      { id: 'published-baseline', digest: C0_VECTOR_DIGESTS['published-baseline'] },
      { id: 'gen6-best', digest: C0_VECTOR_DIGESTS['gen6-best'] },
      { id: 'gen9-best', digest: C0_VECTOR_DIGESTS['gen9-best'] },
      { id: 'gen10-mu', digest: C0_VECTOR_DIGESTS['gen10-mu'] },
    ]);
  });

  it.each([
    ['checkpoint hash', { checkpoint: '0'.repeat(64) }],
    ['training log hash', { log: '0'.repeat(64) }],
    ['bundled weights hash', { bundledWeights: '0'.repeat(64) }],
    ['runtime weights hash', { runtimeWeights: '0'.repeat(64) }],
  ])('rejects a mismatched %s before any simulation dependency exists', (_label, hashes) => {
    expect(() => loadC0Sources(validSourceDependencies({ hashes })))
      .toThrowError(/invalid-input:source-hash-mismatch/);
  });

  it.each([
    'missing-gen6',
    'duplicate-gen6',
    'renormalized-gen6',
    'wrong-gen9-digest',
    'wrong-raw-mu-digest',
    'wrong-normalized-mu-digest',
    'qualified-candidate-present',
    'generation-count-not-ten',
    'reevaluation-not-final',
  ] as const)('fails closed for %s', (mutation) => {
    expect(() => loadC0Sources(mutatedSourceDependencies(mutation)))
      .toThrowError(/^C0 invalid-input:/);
  });
  ```

  The successful fixture must use these literal archived vectors, not read the live run as test input:

  ```ts
  const PUBLISHED_BASELINE = [
    -0.03136702939998303, -0.49514382541551616, 0.07930716210288993,
    -0.06480046456829196, 0.14840680564236144, -0.300289317086154,
    -0.5541884383921293, -0.4223801328449683, -0.27054182855840314,
    0.2691450141912839, 0, 0, 0,
  ];
  const GEN6_BEST = [
    0.02185020330641181, -0.32193032364733, 0.24091173061177176,
    0.18568120986878886, -0.2568364480695082, -0.4468631052350419,
    -0.442665035753348, -0.4321598442115847, -0.16432404098948294,
    -0.18408869290566268, 0.19987304080346108, 0.23042001961989378,
    -0.03267637981563334,
  ];
  const GEN9_BEST = [
    -0.0698417594905203, 0.11051937184989932, -0.5469450555794332,
    0.2210366964381046, -0.030384760638833136, -0.03348790118386401,
    -0.18389285544100184, -0.39460398483620973, -0.2648930743038742,
    0.05229314998960565, 0.3524255406240832, 0.45374312965477115,
    -0.20084426305820857,
  ];
  const RAW_GEN10_MU = [
    -0.32308188574661295, -0.1380786127962525, -0.1827990265695491,
    0.1679900341497466, -0.0006042437943203343, -0.11895518210542955,
    -0.10370567102993666, -0.31156851199214525, -0.13318521092623947,
    0.17331741246784807, 0.12773366674138667, 0.14468594791202222,
    -0.06089197043033354,
  ];
  ```

  Assert `Math.hypot` equals the frozen L2 values within `1e-15`; generation-best vectors are never passed through `normalize`, while checkpoint `mu` is passed through existing `normalize` exactly once.

- [ ] **Step 3: Run Task 1 tests to observe RED**

  ```powershell
  npx vitest run training/archivedRepresentativeAudit.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: FAIL because `training/archivedRepresentativeAudit.ts` does not exist.

- [ ] **Step 4: Implement strict source adapters and extraction**

  Define the injected boundary exactly as follows:

  ```ts
  export interface C0SourceDependencies {
    root: string;
    validateRun(paths: RunPaths): ScoreRateCheckpoint;
    readLogRecords(path: string): readonly Record<string, unknown>[];
    hashRegularFile(path: string): string;
    readPublishedVector(path: string): number[];
  }
  ```

  The default adapter must:

  1. Resolve only the fixed source run plus the two fixed published paths under `root`.
  2. Hash a regular non-symlink file through `lstatSync -> openSync -> fstatSync -> readFileSync(descriptor) -> lstatSync`, requiring opened/before/after identity equality, and uppercase its SHA-256.
  3. Fingerprint all four files before and after strict parsing and reject any identity/hash drift.
  4. Call `readCompatibleRunArtifacts(resolveRunPaths(root, C0_SOURCE_RUN))` before using log records.
  5. Parse published files with `parseWeightsFile`, project with `toVector`, and require both projections to match `publishedBaseline.weights` exactly.
  6. Require checkpoint `gen=10`, `baseSeed=config.baseSeed=20260727`, `maxPieces=2000`, `gamesPerCandidate=5`, `reevalEvery=10`, `reevalGames=30`, `reevalMaxPieces=5000`, non-null published baseline, and null best qualified candidate.
  7. Require exactly ten ordered generation records `0..9` and one final `kind='reevaluation', gen=10` record. Extract only `gen=6.bestWeights` and `gen=9.bestWeights` from that already validated log.
  8. Require 13 finite values, frozen L2/digests, four distinct vector digests, the raw-mu digest/L2, and the normalized-mu digest/L2.

  Convert every validation failure to a stable redacted `C0InvalidInputError` code such as `source-hash-mismatch`, `run-contract-mismatch`, `log-boundary-mismatch`, or `vector-identity-mismatch`. Do not include absolute paths, JSON bodies, vector values, or raw exception messages in CLI-visible errors.

- [ ] **Step 5: Write and observe seed-independence RED tests**

  ```ts
  it('freezes thirty unique C0 seeds with zero historical overlap', () => {
    const schedule = buildC0Schedule(validCheckpoint());
    expect(schedule.seeds).toHaveLength(30);
    expect(new Set(schedule.seeds).size).toBe(30);
    expect(schedule.seedDigest).toBe(C0_SEED_DIGEST);
    expect(schedule.taskOrder).toBe('seed-major');
    expect(overlap(schedule.seeds, trainingSeeds(validCheckpoint()))).toEqual([]);
    expect(overlap(schedule.seeds, fixedReevaluationSeeds(20260727, 30))).toEqual([]);
    expect(overlap(schedule.seeds, historicalPairedSeeds())).toEqual([]);
  });

  it('rejects a duplicated or historically overlapping schedule', () => {
    expect(() => assertC0SeedSeparation(
      Array(30).fill(hashSeed(C0_BASE_SEED, 0)),
      validCheckpoint(),
    )).toThrowError(/invalid-input:seed-schedule-mismatch/);
  });
  ```

  Run the same focused command and confirm these new assertions fail before adding schedule validation.

- [ ] **Step 6: Implement the exact schedule and historical separation**

  `buildC0Schedule` must build `hashSeed(20260824, gameIndex)` for indices `0..29`, compute lowercase SHA-256 over UTF-8 `JSON.stringify(seeds)`, and require the frozen digest. Rebuild historical sets as:

  ```ts
  const trainingSeeds = Array.from({ length: 10 }, (_, gen) =>
    Array.from({ length: checkpoint.config.gamesPerCandidate }, (_, gameIndex) =>
      hashSeed(checkpoint.baseSeed, gen, gameIndex))).flat();
  const fixedSeeds = fixedReevaluationSeeds(checkpoint.baseSeed, 30);
  const pairedSeeds = Array.from({ length: 30 }, (_, gameIndex) =>
    hashSeed(C0_HISTORICAL_PAIRED_SEED, gameIndex));
  ```

  Require 30/30 C0 uniqueness and empty intersections with all three sets before returning the schedule.

- [ ] **Step 7: Run Task 1 focused GREEN and dependency parity tests**

  ```powershell
  npx vitest run training/archivedRepresentativeAudit.test.ts training/runArtifacts.test.ts src/ai/weights.test.ts src/ai/rng.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: all selected files PASS; no worker is created and no game is simulated.

- [ ] **Step 8: Independent Task 1 spec review, quality review, and fix loop**

  Spec review must re-check every source hash, vector digest/source/normalization rule, exact log boundary, published vector identity, seed digest, and zero-overlap proof. Quality review must check TOCTOU-resistant regular-file reads, dependency injection, redacted errors, no writes, and no production-contract edit. Fix all Critical/Important findings under focused TDD and obtain scoped re-review before Task 2.

---

### Task 2: Validate game records, compute paired statistics, and freeze verdict serialization

**Files:**
- Modify: `training/archivedRepresentativeAudit.ts`
- Modify: `training/archivedRepresentativeAudit.test.ts`

**Interfaces:**
- Consumes: Task 1 `C0SourceBundle`, `SimTaskResult`, `aggregateFitness`, `pairedInterval30`, `assertLineClearCounts`, `tetrisLineShare`, `totalLinesFromCounts`, and `SEARCH_METADATA`.
- Produces: `projectC0PrimaryResults`, `projectC0ReplayResults`, `evaluateC0Audit`, `serializeC0Audit`, `C0GameRecord`, `C0Comparison`, and `C0AuditOutput`.

Test helpers in this Task must use the exact frozen vector/schedule fixtures from Task 1 and these signatures:

```ts
type GameMutation =
  | 'failed' | 'error-reason' | 'non-finite-score' | 'bad-search' | 'bad-lines';
interface VerdictFixture {
  primary: C0GameRecord[];
  replay: C0GameRecord[];
}
function validSources(): C0SourceBundle;
function mutatedResults(mutation: GameMutation): SimTaskResult[];
function vectorIdForWeights(weights: readonly number[]): C0VectorId;
function recordsWithDistinctVectorScores(scores: readonly [number, number, number, number]): C0GameRecord[];
function validReplay(primary: readonly C0GameRecord[]): C0GameRecord[];
function passingRecords(): C0GameRecord[];
function passingReplay(): C0GameRecord[];
function passFixture(): VerdictFixture;
function tetrisAggregateLow(): VerdictFixture;
function tetrisLowerZero(): VerdictFixture;
function scoreLowerZero(): VerdictFixture;
function survivalLower(): VerdictFixture;
```

- [ ] **Step 1: Write RED tests for task/result alignment and record validation**

  Use tiny deterministic result fixtures; never call `simulateGame`. Cover task-id mapping, seed/vector identity, non-finite values, `failed=true`, `reason='error'`, malformed clear counts, lines/count mismatch, out-of-range pieces, malformed strategy/search diagnostics, and incorrect result count.

  ```ts
  it('maps seed-major task results without transposing vector ownership', () => {
    const tasks = buildC0PrimaryTasks(validSources());
    expect(tasks).toHaveLength(120);
    expect(tasks.slice(0, 8).map(({ taskId, seed, weights }) => ({
      taskId,
      seed,
      vectorId: vectorIdForWeights(weights),
    }))).toEqual([
      { taskId: 0, seed: hashSeed(C0_BASE_SEED, 0), vectorId: 'published-baseline' },
      { taskId: 1, seed: hashSeed(C0_BASE_SEED, 0), vectorId: 'gen6-best' },
      { taskId: 2, seed: hashSeed(C0_BASE_SEED, 0), vectorId: 'gen9-best' },
      { taskId: 3, seed: hashSeed(C0_BASE_SEED, 0), vectorId: 'gen10-mu' },
      { taskId: 4, seed: hashSeed(C0_BASE_SEED, 1), vectorId: 'published-baseline' },
      { taskId: 5, seed: hashSeed(C0_BASE_SEED, 1), vectorId: 'gen6-best' },
      { taskId: 6, seed: hashSeed(C0_BASE_SEED, 1), vectorId: 'gen9-best' },
      { taskId: 7, seed: hashSeed(C0_BASE_SEED, 1), vectorId: 'gen10-mu' },
    ]);
  });

  it.each(['failed', 'error-reason', 'non-finite-score', 'bad-search', 'bad-lines'])
    ('returns runtime-fail for malformed game result %s', (mutation) => {
      expect(() => projectC0PrimaryResults(
        validSources(),
        buildC0PrimaryTasks(validSources()),
        mutatedResults(mutation),
      )).toThrowError(/^C0 runtime-fail:/);
    });
  ```

- [ ] **Step 2: Run the focused test to observe RED**

  ```powershell
  npx vitest run training/archivedRepresentativeAudit.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: FAIL because task construction and result projection are not implemented.

- [ ] **Step 3: Implement seed-major tasks and canonical per-game projections**

  Build primary tasks with `taskId = gameIndex * 4 + vectorIndex`. Validate `WorkerPool` output position and `taskId` against the task manifest; never sort by completion time. Reject any failed/error result before aggregation.

  Construct `C0DeterministicGameProjection` in the exact interface field order. Compute `scoreRate = score / 5000`, shared `tetrisLineShare(clearCounts)`, and lowercase SHA-256 over UTF-8 `JSON.stringify(projection)`. `taskId` is intentionally outside the deterministic projection so a replay can be byte-identical to its primary record.

  Before accepting a projection, require:

  - non-negative safe-integer score/lines/pieces, pieces in `0..5000`, and finite mean height in `[0,20]`;
  - `reason` exactly `pieceCap` or `gameover`, and `pieceCap` implies `pieces===5000`;
  - shared strict clear-count validation and `lines===totalLinesFromCounts(clearCounts)`;
  - all three strategy diagnostics finite in `[0,4]`;
  - exact five-bin search histogram, internally consistent call/depth/work/rate totals, and `maxWorkUnitsUsed<=3584`.

- [ ] **Step 4: Write RED tests for vector-major aggregation and four fixed comparisons**

  ```ts
  it('reorders seed-major records before calling aggregateFitness', () => {
    const records = recordsWithDistinctVectorScores([100, 200, 300, 400]);
    const output = evaluateC0Audit(validSources(), records, validReplay(records));
    expect(output.vectors.map(({ id, scoreRate }) => ({ id, scoreRate }))).toEqual([
      { id: 'published-baseline', scoreRate: 100 / C0_MAX_PIECES },
      { id: 'gen6-best', scoreRate: 200 / C0_MAX_PIECES },
      { id: 'gen9-best', scoreRate: 300 / C0_MAX_PIECES },
      { id: 'gen10-mu', scoreRate: 400 / C0_MAX_PIECES },
    ]);
  });

  it('emits only the pre-registered comparisons in fixed order', () => {
    expect(evaluateC0Audit(validSources(), passingRecords(), passingReplay()).comparisons
      .map(({ left, right }) => `${left}-${right}`)).toEqual([
      'gen6-best-gen10-mu',
      'gen9-best-gen10-mu',
      'gen6-best-published-baseline',
      'gen9-best-published-baseline',
    ]);
  });
  ```

  Run the focused test and observe failures before implementing aggregation.

- [ ] **Step 5: Implement aggregation and paired intervals**

  Group records by `C0_VECTOR_ORDER`, assert each vector has game indices `0..29` exactly once, then flatten vector-major before calling:

  ```ts
  const vectorMajorResults = C0_VECTOR_ORDER.flatMap((vectorId) =>
    recordsByVector.get(vectorId)!.map(toAggregateFitnessResult));
  const stats = aggregateFitness(
    vectorMajorResults,
    C0_VECTOR_ORDER.length,
    C0_GAMES,
    C0_MAX_PIECES,
  );
  ```

  For each fixed comparison, align by `gameIndex` and call `pairedInterval30` over exactly 30 `left-right` score-rate deltas and 30 shared per-game Tetris-share deltas. Aggregate Tetris share comes from the shared counts/`aggregateFitness` result; survival is the exact piece-cap count.

- [ ] **Step 6: Write and observe the complete verdict-matrix RED**

  Add independent fixtures for every threshold edge:

  ```ts
  it.each([
    ['pass', passFixture(), 'pass-retention-loss-supported'],
    ['tetris aggregate below one percent', tetrisAggregateLow(), 'fail-signal-not-reproduced'],
    ['tetris lower bound equals zero', tetrisLowerZero(), 'fail-signal-not-reproduced'],
    ['score lower bound equals zero', scoreLowerZero(), 'fail-joint-improvement-not-shown'],
    ['gen6 survival lower than mu', survivalLower(), 'fail-joint-improvement-not-shown'],
  ])('%s -> %s', (_label, fixture, expected) => {
    expect(evaluateC0Audit(validSources(), fixture.primary, fixture.replay).status)
      .toBe(expected);
  });
  ```

  Include a case where gen9 looks better than gen6 and prove it cannot change the primary verdict. Use strict `>0` lower bounds and inclusive `>=0.01` aggregate gen6 Tetris share.

- [ ] **Step 7: Implement replay equality, verdict precedence, and canonical digest**

  Replay records must be exactly eight entries ordered by game index `0`, then `29`, and within each index by `C0_VECTOR_ORDER`. Compare `JSON.stringify(replay.projection)` byte-for-byte with the corresponding primary projection and require equal projection digests. Any mismatch is `runtime-fail:nondeterministic-replay`.

  Verdict precedence is exact:

  ```ts
  const status: C0AuditStatus =
    gen6.tetrisLineShare < 0.01 || primary.tetrisLineShareInterval.lower <= 0
      ? 'fail-signal-not-reproduced'
      : primary.scoreRateInterval.lower <= 0 ||
          gen6.pieceCapGames < gen10Mu.pieceCapGames
        ? 'fail-joint-improvement-not-shown'
        : 'pass-retention-loss-supported';
  ```

  Project the internal `C0Schedule` to `C0ScheduleEvidence`; do not emit the 30 raw seeds or any per-game record. Build the exact `C0AuditProjection` in interface field order. Compute `resultDigest` over UTF-8 `JSON.stringify(projection)` before spreading the projection and adding `resultDigest` last. For classifiable invalid/runtime failures, hash `{ mode, status, failureReasons }` before adding `resultDigest`. `serializeC0Audit` accepts `C0AuditOutput | C0FailureOutput` and is exactly `JSON.stringify(output)` with no pretty printing.

- [ ] **Step 8: Run Task 2 focused GREEN and shared-stat parity**

  ```powershell
  npx vitest run training/archivedRepresentativeAudit.test.ts training/cem.test.ts training/pairedStats.test.ts src/ai/lineClears.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: all selected tests PASS; no real worker, artifact write, or game simulation occurs.

- [ ] **Step 9: Independent Task 2 spec review, quality review, and fix loop**

  Spec review must recompute pair direction/order, strict threshold edges, gen9 non-substitution, vector-major reordering, replay byte equality, and digest projection. Quality review must check finite/range validation, no hidden optional stopping, no generic object-key sorting, immutable records, and shared helper parity. Fix and scoped re-review every Critical/Important finding before Task 3.

---

### Task 3: Add strict WorkerPool lifecycle and stdout-only CLI

**Files:**
- Modify: `training/archivedRepresentativeAudit.ts`
- Modify: `training/archivedRepresentativeAudit.test.ts`
- Modify exact script entry: `package.json`

**Interfaces:**
- Consumes: Tasks 1–2 pure functions, `WorkerPool`, `WorkerPoolAbortError`, `SimTask`, `SimTaskResult`, `cpus`, `AbortSignal`, and `pathToFileURL`.
- Produces: `runC0Audit`, `runC0AuditCli`, `C0AuditDependencies`, `C0CliResult`, and package script `audit:c0-archived-representatives`.

Test doubles must expose deterministic call evidence with these signatures; they must never construct a real worker or call `simulateGame`:

```ts
interface RecordingC0Pool extends C0Pool {
  runs: SimTask[][];
  destroyCalls: number;
  destroySettled: boolean;
}
function successfulPool(): RecordingC0Pool;
function blockingPool(): RecordingC0Pool;
function dependenciesWithPool(pool: RecordingC0Pool): C0AuditDependencies;
function invalidSourceDependencies(): C0AuditDependencies & {
  createPool: ReturnType<typeof vi.fn>;
};
function successfulDependencies(): C0AuditDependencies;
```

- [ ] **Step 1: Write orchestration RED tests with a fake pool**

  Define the boundary:

  ```ts
  export interface C0Pool {
    run(tasks: SimTask[], options?: { signal?: AbortSignal }): Promise<SimTaskResult[]>;
    destroy(): Promise<void>;
  }

  export interface C0AuditDependencies {
    loadSources(): C0SourceBundle;
    createPool(size: number): Promise<C0Pool>;
    logicalCpuCount(): number;
  }

  export interface C0CliResult {
    exitCode: 0 | 1 | 130;
    stdout: string;
    stderr: string;
  }
  ```

  Tests must prove exactly two pool calls after provenance succeeds: 120 primary tasks, then 8 replay tasks; no third call; task IDs `0..127`; seed-major/vector-major order as frozen; and `destroy()` awaited exactly once through the idempotent pool contract.

  ```ts
  it('runs all primary games before the exact replay set and always destroys the pool', async () => {
    const fake = successfulPool();
    await runC0Audit(dependenciesWithPool(fake));
    expect(fake.runs.map((tasks) => tasks.map((task) => task.taskId))).toEqual([
      Array.from({ length: 120 }, (_, index) => index),
      Array.from({ length: 8 }, (_, index) => 120 + index),
    ]);
    expect(fake.destroyCalls).toBe(1);
  });

  it('does not create a pool when source validation fails', async () => {
    const dependencies = invalidSourceDependencies();
    await expect(runC0Audit(dependencies)).rejects.toThrow(/^C0 invalid-input:/);
    expect(dependencies.createPool).not.toHaveBeenCalled();
  });
  ```

- [ ] **Step 2: Run orchestration tests to observe RED**

  ```powershell
  npx vitest run training/archivedRepresentativeAudit.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: FAIL because the async runner and pool lifecycle do not exist.

- [ ] **Step 3: Implement full-run orchestration without result-driven stopping**

  Load/validate sources before `WorkerPool.create`. Choose only the concurrency width, never the schedule:

  ```ts
  const workerCount = Math.max(
    1,
    Math.min(sources.checkpointWorkers, Math.max(1, dependencies.logicalCpuCount() - 1)),
  );
  ```

  Run all 120 primary tasks before computing any statistical verdict, then run all 8 replay tasks. A malformed/finally-failed task, pool rejection, or warning that signals WorkerPool recovery is `runtime-fail`; discard every returned result and never infer from a partial set.

  Existing `WorkerPool` may print `console.warn` while internally recovering a worker. For each `pool.run`, create a local strict `AbortController`, forward the caller's abort signal into it, and temporarily replace `console.warn` with a handler that records only `recoveryObserved=true` and immediately aborts that strict controller. Restore `console.warn` and remove the parent-signal listener in `finally`; never retain warning arguments, raw worker errors, or paths. Map any recovery to redacted `runtime-fail:worker-pool-recovery`. This prevents the pool's queued retry from producing an accepted result and keeps completed-verdict stderr empty.

  Always await `pool.destroy()` in `finally`. If both execution and destroy fail, preserve only stable failure codes; do not expose either raw exception.

- [ ] **Step 4: Write abort RED tests**

  ```ts
  it('aborts the in-flight pool, emits no partial verdict, and awaits destroy', async () => {
    const controller = new AbortController();
    const fake = blockingPool();
    const resultPromise = runC0AuditCli(dependenciesWithPool(fake), controller.signal);
    controller.abort();
    await expect(resultPromise).resolves.toEqual({
      exitCode: 130,
      stdout: '',
      stderr: '',
    });
    expect(fake.destroySettled).toBe(true);
  });
  ```

  Also cover an already-aborted signal, destroy rejection without unhandled promise rejection, and listener cleanup after success/failure.

- [ ] **Step 5: Implement CLI failure mapping and SIGINT boundary**

  `runC0AuditCli(dependencies, signal)` must return:

  - completed PASS: exit 0, exactly `serializeC0Audit(output) + '\n'`, empty stderr;
  - completed signal/joint FAIL: exit 1, exactly one JSON line, empty stderr;
  - safely classifiable invalid input/runtime failure: exit 1, one redacted fail-closed JSON line, empty stderr;
  - abort: exit 130, empty stdout/stderr;
  - unexpected unclassifiable failure: exit 1, empty stdout, exactly `C0 audit failed: internal-error\n` on stderr.

  The main guard installs one SIGINT handler backed by `AbortController`, removes it in `finally`, writes only the returned strings, and assigns `process.exitCode`. It never calls `process.exit()`.

- [ ] **Step 6: Write no-file/stdout/determinism RED tests**

  Run CLI functions against fake dependencies from a temporary empty cwd. Snapshot that cwd before/after and assert identical entries. Assert completed output is one newline-terminated JSON line, stderr empty, canonical result digest stable across two injected identical runs, and no repository-lock dependency is imported or called.

  ```ts
  it('emits one canonical JSON line and writes no files', async () => {
    const cwd = emptyTemporaryDirectory();
    const before = snapshotDirectory(cwd);
    const first = await runC0AuditCli(successfulDependencies());
    const second = await runC0AuditCli(successfulDependencies());
    expect(first).toEqual(second);
    expect(first.stdout.split('\n')).toHaveLength(2);
    expect(first.stdout.endsWith('\n')).toBe(true);
    expect(first.stderr).toBe('');
    expect(snapshotDirectory(cwd)).toEqual(before);
  });
  ```

- [ ] **Step 7: Add the exact package script without disturbing existing WIP**

  Add only:

  ```json
  "audit:c0-archived-representatives": "tsx training/archivedRepresentativeAudit.ts"
  ```

  Keep `diagnose:horizon`, both B1 diagnostic scripts, and every other current working-copy entry. Do not normalize unrelated whitespace or stage `package.json`.

- [ ] **Step 8: Run Task 3 focused GREEN and pool lifecycle parity**

  ```powershell
  npx vitest run training/archivedRepresentativeAudit.test.ts training/pool.test.ts training/runArtifacts.test.ts training/pairedStats.test.ts training/cem.test.ts src/ai/simulate.test.ts src/ai/rng.test.ts src/ai/weights.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Expected: all selected tests PASS. The real package audit script is not executed.

- [ ] **Step 9: Independent Task 3 spec review, quality review, and fix loop**

  Spec review must cover exact task/replay order, no early/optional stopping, WorkerPool warnings/failures, SIGINT no-partial behavior, stdout/stderr contract, exit codes, no repository lock, and no writes. Quality review must inspect global-warning restoration, listener cleanup, double-failure cleanup, injected fakes, main guard, redaction, and package WIP preservation. Fix and scoped re-review all Critical/Important findings before Task 4.

---

### Task 4: Run safe code gates, whole-change review, and stop before audit

**Files:**
- Review only: approved C0 spec, this plan, `training/archivedRepresentativeAudit.ts`, `training/archivedRepresentativeAudit.test.ts`, and the single C0 `package.json` script hunk.
- Scratch only: `.superpowers/sdd/2026-08-24-score-rate-v5-c0-archived-representative-audit/`.

**Interfaces:**
- Consumes: complete Tasks 1–3 change and review ledger.
- Produces: fresh safe verification evidence and an independent code-gate verdict; never an audit result.

- [ ] **Step 1: Refresh live state before verification**

  Re-run continuity Resume plus HEAD/status/index, Node process, repository/index lock, preserved run entries/hashes, candidate/default-run absence, and published hash checks. Stop on artifact/weight drift, relevant running process, repository lock, or non-empty real index. Do not delete any lock.

- [ ] **Step 2: Run the exact safe focused suite**

  ```powershell
  npx vitest run training/archivedRepresentativeAudit.test.ts training/pool.test.ts training/runArtifacts.test.ts training/pairedStats.test.ts training/cem.test.ts src/ai/simulate.test.ts src/ai/rng.test.ts src/ai/weights.test.ts src/ai/lineClears.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --fileParallelism=false
  ```

  Record files/tests passed, skipped, failed, exit code, and duration. Stop on the first failure; do not substitute a broader command.

- [ ] **Step 3: Run explicit-file ESLint**

  ```powershell
  npx eslint training/archivedRepresentativeAudit.ts training/archivedRepresentativeAudit.test.ts
  ```

  Expected: exit 0 with no lint error.

- [ ] **Step 4: Run the production build**

  ```powershell
  npm run build
  ```

  This build does not collect training test roots. Record exit code and Vite module count.

- [ ] **Step 5: Run safe explicit-root training typecheck**

  Build `.superpowers/sdd/2026-08-24-score-rate-v5-c0-archived-representative-audit/safe-train-tsconfig.json` from tracked `.ts` roots returned by:

  ```powershell
  git ls-files -- training src/ai src/engine src/types.ts src/constants.ts
  ```

  Keep only `.ts` files, exclude browser-only `src/ai/loadWeights.ts`, and add only the two C0 files. Set `extends` to `../../../tsconfig.train.json`, `include` to `[]`, and every `files` entry relative to the scratch config. Before typecheck, assert the file list contains none of the three protected probe path names, then run:

  ```powershell
  npx tsc -p .superpowers/sdd/2026-08-24-score-rate-v5-c0-archived-representative-audit/safe-train-tsconfig.json --pretty false
  ```

  Expected: exit 0. Do not use the bare train typecheck script because it can collect unrelated untracked training WIP.

- [ ] **Step 6: Run scoped diff/index checks**

  ```powershell
  git diff --check -- package.json training/archivedRepresentativeAudit.ts training/archivedRepresentativeAudit.test.ts
  git diff --cached --quiet --
  ```

  Require both exit 0. Inspect the exact three-path diff and prove `package.json` retains all prior WIP plus exactly one C0 script addition.

- [ ] **Step 7: Independent whole-change spec review**

  Give a fresh reviewer only the C0 spec, this plan, the two C0 files, the exact package hunk, and fresh verification ledger. Require line-by-line adjudication of source hashes, strict run reuse, vector identities, normalization count, seed separation, task/pair order, aggregate reordering, all thresholds, replay determinism, no optional stopping, runtime/abort failure behavior, output digest, active-v5 invariants, no-write boundary, and protected-probe exclusion.

- [ ] **Step 8: Independent whole-change quality review**

  Require review of validation composition, path/file identity checks, TypeScript types, immutable projections, WorkerPool cleanup, warning/listener restoration, error redaction, test realism, no hidden operational execution, and unrelated-WIP preservation.

- [ ] **Step 9: Apply at most one final fix wave and scoped re-review**

  Every Critical/Important finding gets a focused failing test before the minimum fix. Re-run the affected focused suite, ESLint/typecheck/build when relevant, diff-check, then ask the same reviewer to re-adjudicate only the finding and its fix. Residual Critical/Important findings stop the code gate.

- [ ] **Step 10: Refresh protected state, update continuity, and stop**

  Refresh HEAD/status/index/process/lock/artifact/weight evidence again. Update the SDD ledger and `v5-postmortem` checkpoint with Task/review outcomes and fresh verification counts, run Checkpoint then Windows PowerShell Resume with the protected excludes file, and require `match`.

  Report explicitly that the following command was not run:

  ```powershell
  npm run audit:c0-archived-representatives --silent
  ```

  Also report that no training, diagnostic, calibration, bench, paired benchmark, publication, push, browser/runtime acceptance, artifact mutation, lock deletion, staging, or commit occurred. Stop and wait for a separate operational audit authorization/review gate.

---

## Plan Self-Review Checklist

- [x] The plan creates only one C0 source, one C0 test, and one exact package script entry.
- [x] Source artifact hashes, vector digests/L2/normalization, run boundary, and published identity are exact and checked before pool creation.
- [x] C0 seeds are 30/30 unique with the frozen digest and zero overlap with training, fixed-reevaluation, and historical paired schedules.
- [x] Primary tasks are seed-major; aggregation is explicitly converted to vector-major; pair alignment remains by game index.
- [x] Gen6-vs-mu is the only primary hypothesis; gen9 cannot substitute; published comparisons are context only.
- [x] Thresholds remain score lower `>0`, Tetris lower `>0`, gen6 aggregate `>=0.01`, survival non-lower; final 20% publication rule remains untouched.
- [x] All 120 primary and 8 replay games are scheduled before a completed verdict; no statistic-driven early stop, seed change, or candidate dropping exists.
- [x] Invalid input, runtime failure, WorkerPool recovery, abort, and nondeterminism fail closed without partial inference or raw-path/error leakage.
- [x] Completed output is one deterministic JSON line, replay projection equality is byte-for-byte, and the result digest excludes only itself.
- [x] Tests use injected fakes and never execute the real audit or a 5000-piece simulation.
- [x] Safe tests/lint/build/typecheck/diff-check exclude protected probes and preserve existing WIP.
- [x] Code gate, operational audit, training, benchmark, publication, commit, and runtime acceptance remain separate gates.
