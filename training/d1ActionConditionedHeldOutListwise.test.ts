import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyBoard } from '../src/engine/board';
import { createPiece } from '../src/engine/piece';
import { initialUnseenBagMask } from '../src/ai/publicState';
import type {
  SimulationDecisionObservation,
  SimulationSearchDiagnostics,
} from '../src/ai/simulate';
import {
  buildD1ObservedFeatureEvidence,
  D1WorkerPool,
  runD1Diagnostic,
  runD1DiagnosticCli,
  runD1Main,
  serializeD1Result,
  type D1DiagnosticResult,
  type D1InvalidInputReason,
} from './d1ActionConditionedHeldOutListwise';
import {
  D1_SOURCE_HASHES,
  D1InvalidInputError,
  D1_VECTOR_DIGESTS,
  freezeD1PlacementManifest,
  type D1BehaviorRunner,
  type D1FrozenSubset,
  type D1Sources,
} from './d1ActionConditionedHeldOutListwiseCore';
import {
  requireD1ContextTaskBatchAuthority,
  type D1ContextProjection,
  type D1ContextTask,
  type D1ContextTaskBatch,
} from './d1ActionConditionedHeldOutListwiseLabels';
import * as LabelsModule from './d1ActionConditionedHeldOutListwiseLabels';
import {
  consumeD1FinalBundleForTest,
  type D1FinalModelBundle,
  type D1RuntimeFailureReason,
  type D1StatisticalFailureReason,
} from './d1ActionConditionedHeldOutListwiseFit';
import * as FitModule from './d1ActionConditionedHeldOutListwiseFit';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;
type RuntimeResult = Extract<D1DiagnosticResult, { status: 'runtime-fail' }>;
type StatisticalResult = Extract<D1DiagnosticResult, {
  phase: 'complete';
  status: 'fail-joint-selection-not-shown' | 'fail-representation-gain-not-held-out';
}>;
type PassResult = Extract<D1DiagnosticResult, { status: 'pass-action-conditioned-listwise-supported' }>;
type CanonicalReason = D1DiagnosticResult['failureReasons'][number];
const canonicalReasonTypeAssertions: readonly [
  Assert<Equal<Extract<D1DiagnosticResult, { status: 'invalid-input' }>['failureReasons'], readonly D1InvalidInputReason[]>>,
  Assert<Equal<RuntimeResult['failureReasons'], readonly D1RuntimeFailureReason[]>>,
  Assert<Equal<StatisticalResult['failureReasons'], readonly [D1StatisticalFailureReason, ...D1StatisticalFailureReason[]]>>,
  Assert<Equal<PassResult['failureReasons'], readonly []>>,
  Assert<Equal<'unknown-reason' extends CanonicalReason ? true : false, false>>,
] = [true, true, true, true, true];

const task = (taskId: number): D1ContextTask => Object.freeze({
  taskId,
  subsetId: 'subset-0',
  placementId: '3:0,1,2,3',
  continuationVectorId: 'gen6-best',
  streamIndex: 0 as const,
  capture: Object.freeze({
    state: Object.freeze({
      board: createEmptyBoard(), current: createPiece(3), next: 1 as const, hold: null,
      holdAvailable: true, unseenBagMask: initialUnseenBagMask(3, 1),
    }),
    score: 0, lines: 0, level: 1,
  }),
  placement: Object.freeze({ piece: createPiece(3), moves: [] }),
  weights: Object.freeze(new Array<number>(13).fill(0)),
  futurePieces: Object.freeze([1 as const]),
});

const projection = (taskId: number, overrides: Partial<D1ContextProjection> = {}): D1ContextProjection => {
  const input = task(taskId);
  const base = {
    taskId: input.taskId,
    subsetId: input.subsetId,
    placementId: input.placementId,
    continuationVectorId: input.continuationVectorId,
    streamIndex: input.streamIndex,
    pieces: 128,
    scoreDelta: 1,
    clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 0 },
    reason: 'pieceCap' as const,
    searchDiagnostics: emptySearchDiagnostics(),
    ...overrides,
  };
  const withoutDigest = Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'projectionDigest'));
  return Object.freeze({ ...base, projectionDigest: createHash('sha256').update(JSON.stringify(withoutDigest), 'utf8').digest('hex') });
};

function controllableWorker() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    dispatched: [] as D1ContextTask[],
    postMessage(message: D1ContextTask) { this.dispatched.push(message); },
    on(event: string, listener: (...args: unknown[]) => void) {
      const current = listeners.get(event) ?? [];
      current.push(listener); listeners.set(event, current); return this;
    },
    once(event: string, listener: (...args: unknown[]) => void) { return this.on(event, listener); },
    removeListener(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== listener)); return this;
    },
    terminate: async () => undefined,
    emit(event: string, ...args: unknown[]) { for (const listener of listeners.get(event) ?? []) listener(...args); },
  };
}

const emptySearchDiagnostics = (): SimulationSearchDiagnostics => ({
  searchCalls: 0,
  holdActions: 0,
  holdRate: 0,
  meanCompletedDepth: 0,
  minCompletedDepth: 0,
  completedDepthHistogram: [0, 0, 0, 0, 0],
  totalWorkUnitsUsed: 0,
  meanWorkUnitsUsed: 0,
  maxWorkUnitsUsed: 0,
  budgetExhaustedSearches: 0,
  budgetExhaustionRate: 0,
  placementEvaluationUnits: 0,
  chanceExpansionUnits: 0,
  cacheHitUnits: 0,
  expandedDecisionNodes: 0,
  expandedChanceNodes: 0,
  cacheHits: 0,
});

const emptyDecisionDiagnostics = () => ({
  completedDepth: 4 as const,
  attemptedDepth: 4 as const,
  workUnitsUsed: 1,
  workUnitsLimit: 3584,
  placementEvaluationUnits: 1,
  chanceExpansionUnits: 0,
  cacheHitUnits: 0,
  budgetExhausted: false,
  expandedDecisionNodes: 1,
  expandedChanceNodes: 0,
  cacheHits: 0,
  placementCacheHits: 0,
  placementCacheEntries: 1,
  transpositionEntries: 1,
  equivalentPlacementsRemoved: 0,
  prunedChanceBranches: 0,
  aborted: false,
});

function fakeSources(): D1Sources {
  return Object.freeze({
    metadata: Object.freeze({
      version: 6 as const,
      objective: 'score-rate-v5' as const,
      gen: 10 as const,
      searchContract: 'bag-expectimax-hold-v2' as const,
      searchDepth: 4 as const,
      rootBeamWidth: 64,
      childBeamWidth: 32,
      maxWorkUnits: 3584,
      budgetCorpus: 'budget-corpus-v1' as const,
      transpositionCacheEntries: 65536,
      placementCacheEntries: 16384,
      unexpectedSearchMetadata: 'must-not-cross-the-canonical-boundary',
    }) as D1Sources['metadata'],
    sourceHashes: Object.freeze({
      checkpoint: D1_SOURCE_HASHES.checkpoint,
      log: D1_SOURCE_HASHES.log,
    }),
    vectors: Object.freeze([
      Object.freeze({
        id: 'gen6-best' as const,
        weights: Object.freeze([0.25, ...new Array<number>(12).fill(0)]),
        digest: D1_VECTOR_DIGESTS['gen6-best'],
      }),
      Object.freeze({
        id: 'gen10-mu' as const,
        weights: Object.freeze([0.5, ...new Array<number>(12).fill(0)]),
        digest: D1_VECTOR_DIGESTS['gen10-mu'],
      }),
    ]),
  });
}

const CARDINALITY_FIXTURES = [
  { legalCount: 2, selectedCount: 2, pieceType: 1 as const, rowMasks: [[1, 0b0010000010], [2, 0b0001111100]] as const },
  { legalCount: 9, selectedCount: 9, pieceType: 2 as const, rowMasks: [] as const },
  { legalCount: 12, selectedCount: 12, pieceType: 2 as const, rowMasks: [[2, 0b0000000101]] as const },
  { legalCount: 13, selectedCount: 12, pieceType: 2 as const, rowMasks: [[2, 0b0000001010]] as const },
] as const;

const variableCardinalityAt = (subsetIndex: number) => {
  if (subsetIndex === 17) return CARDINALITY_FIXTURES[1]!;
  if (subsetIndex % 6 === 2) return CARDINALITY_FIXTURES[2]!;
  if (subsetIndex % 6 === 5) return CARDINALITY_FIXTURES[3]!;
  return CARDINALITY_FIXTURES[subsetIndex % 3]!;
};

function makeBehaviorRunner(
  onCall: () => number,
  cardinalityAt?: (subsetIndex: number) => typeof CARDINALITY_FIXTURES[number],
): D1BehaviorRunner {
  return ({ onDecision }) => {
    const callOrdinal = onCall();
    for (const [slotIndex, slot] of ([128, 512] as const).entries()) {
      const fixture = cardinalityAt?.(callOrdinal * 2 + slotIndex);
      const board = createEmptyBoard();
      if (fixture !== undefined) {
        for (const [row, mask] of fixture.rowMasks) {
          for (let column = 0; column < 10; column += 1) {
            if ((mask & (1 << column)) !== 0) board[row]![column] = 7;
          }
        }
      }
      const observation: SimulationDecisionObservation = {
        publicState: {
          board,
          current: createPiece(fixture?.pieceType ?? 3),
          next: 1,
          hold: null,
          holdAvailable: true,
          unseenBagMask: initialUnseenBagMask(3, 1),
        },
        decision: {
          action: { kind: 'hold' },
          value: { survivalProbability: 1, expectedHeuristicValue: 0 },
          diagnostics: emptyDecisionDiagnostics(),
        },
        scheduledPieceNumber: slot,
        score: callOrdinal * 1000 + slot,
        lines: 0,
        level: 1,
        searchDiagnostics: emptySearchDiagnostics(),
      };
      onDecision(observation);
    }
    return { reason: 'pieceCap', pieces: 512 };
  };
}

function fakeProjection(input: D1ContextTask): D1ContextProjection {
  const projection = {
    taskId: input.taskId,
    subsetId: input.subsetId,
    placementId: input.placementId,
    continuationVectorId: input.continuationVectorId,
    streamIndex: input.streamIndex,
    pieces: 128,
    scoreDelta: 1,
    clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 0 },
    reason: 'pieceCap' as const,
    searchDiagnostics: emptySearchDiagnostics(),
  };
  return Object.freeze({
    ...projection,
    projectionDigest: createHash('sha256').update(JSON.stringify(projection), 'utf8').digest('hex'),
  });
}

async function runFakeFullPipeline(options: Readonly<{
  replayFault?: 'copied-digest' | 'duplicate';
  trainProjectionDrift?: boolean;
  testProjectionFault?: 'duplicate' | 'missing' | 'extra';
  snapshotDrift?: boolean;
  testWorkerFailure?: boolean;
  destroyFailure?: boolean;
  beforeTestWorker?: () => void;
}> = {}) {
  const dispatchBatches: D1ContextTask[][] = [];
  let behaviorCalls = 0;
  let poolCreations = 0;
  let poolDestroys = 0;
  let snapshotCalls = 0;
  const forbiddenKeys = [
    'seed', 'split', 'groupOrdinal', 'behaviorVector', 'sourceDiagnostics',
    'stateFingerprint', 'sourceRun', 'fit', 'lambda', 'q', 'verdict',
  ];
  const assertSanitized = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      expect(forbiddenKeys.some((forbidden) => key.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false);
      assertSanitized(child);
    }
  };
  const pool = {
    run: async (tasks: readonly D1ContextTask[]) => {
      dispatchBatches.push([...tasks]);
      expect(tasks.every(Object.isFrozen)).toBe(true);
      tasks.forEach(assertSanitized);
      if (dispatchBatches.length === 2) options.beforeTestWorker?.();
      if (options.testWorkerFailure && dispatchBatches.length === 2) {
        throw new Error('worker-pool-failure');
      }
      const projections = tasks.map(fakeProjection);
      if (dispatchBatches.length === 1 && options.trainProjectionDrift) {
        projections[0] = Object.freeze({ ...projections[0]!, scoreDelta: projections[0]!.scoreDelta + 1 });
      } else if (dispatchBatches.length === 2 && options.testProjectionFault === 'duplicate') {
        projections[1] = projections[0]!;
      } else if (dispatchBatches.length === 2 && options.testProjectionFault === 'missing') {
        projections.pop();
      } else if (dispatchBatches.length === 2 && options.testProjectionFault === 'extra') {
        projections.push(projections[0]!);
      }
      if (options.replayFault === 'copied-digest' && dispatchBatches.length === 3) {
        projections[0] = Object.freeze({ ...projections[0]!, scoreDelta: projections[0]!.scoreDelta + 1 });
      } else if (options.replayFault === 'duplicate' && dispatchBatches.length === 3) {
        projections[1] = projections[0]!;
      }
      return projections;
    },
    destroy: async () => {
      poolDestroys += 1;
      if (options.destroyFailure) throw new Error('sensitive destroy failure');
    },
  };
  const dependencies = {
    runtimeIdentity: () => ({ node: '24.14.0', v8: '13.6.233.17-node.41', platform: 'win32', arch: 'x64' }),
    loadSources: () => fakeSources(),
    runBehavior: makeBehaviorRunner(() => behaviorCalls++, variableCardinalityAt),
    createPool: async (evidence: Readonly<Record<string, unknown>>) => {
      poolCreations += 1;
      expect(behaviorCalls).toBe(80);
      expect(evidence).toMatchObject({
        stateCount: 160,
        placementCount: 1218,
        contextTaskCount: 4872,
        streamPrefixCount: 320,
      });
      expect(Object.isFrozen(evidence)).toBe(true);
      return pool;
    },
    filesystemSnapshot: () => {
      snapshotCalls += 1;
      return options.snapshotDrift && snapshotCalls > 1 ? 'changed-workspace' : 'unchanged-workspace';
    },
  };

  const result = await runD1Diagnostic(dependencies as Parameters<typeof runD1Diagnostic>[0]);
  return {
    result,
    behaviorCalls,
    dispatchBatches,
    poolCreations,
    poolDestroys,
    snapshotCalls,
  };
}

const LITERAL_AFTERSTATE13_NAMES = [
  'aggregateHeight', 'holes', 'bumpiness', 'maxHeight', 'linesCleared',
  'landingHeight', 'rowTransitions', 'colTransitions', 'wellDepth',
  'lineClearValue', 'cleanWellDepth', 'tetrisSetupProgress', 'tetrisReadyRows',
] as const;
const LITERAL_ACTION24_NAMES = [
  ...LITERAL_AFTERSTATE13_NAMES,
  'targetLaneUsableDepthDelta', 'targetLaneSetupProgressDelta',
  'targetLaneReadyRowsDelta', 'targetLanePlacedCellFraction',
  'placedPieceIsI', 'verticalIInTargetLane', 'targetLaneRemainsUsable',
  'futureIAccessProbabilityAfterAction', 'readyRowsTimesFutureIAccess',
  'setupProgressTimesFutureIAccess', 'nextDecisionLegalActionProbability',
] as const;
const LITERAL_AFTERSTATE13_RANGES = [
  { min: 0, max: 1919 }, { min: 1000, max: 2919 }, { min: 2000, max: 3919 },
  { min: 3000, max: 4919 }, { min: 4000, max: 5919 }, { min: 5000, max: 6919 },
  { min: 6000, max: 7919 }, { min: 7000, max: 8919 }, { min: 8000, max: 9919 },
  { min: 9000, max: 10919 }, { min: 10000, max: 11919 }, { min: 11000, max: 12919 },
  { min: 12000, max: 13919 },
] as const;
const LITERAL_ACTION24_RANGES = [
  ...LITERAL_AFTERSTATE13_RANGES,
  { min: 20000, max: 23838 }, { min: 21000, max: 24838 }, { min: 22000, max: 25838 },
  { min: 23000, max: 26838 }, { min: 24000, max: 27838 }, { min: 25000, max: 28838 },
  { min: 26000, max: 29838 }, { min: 27000, max: 30838 }, { min: 28000, max: 31838 },
  { min: 29000, max: 32838 }, { min: 30000, max: 33838 },
] as const;
const REAL_AFTERSTATE13_RANGES = [
  { min: 4, max: 146 }, { min: 0, max: 135 }, { min: 2, max: 84 },
  { min: 2, max: 22 }, { min: 0, max: 0 }, { min: 1.5, max: 21.5 },
  { min: 44, max: 52 }, { min: 10, max: 24 }, { min: 0, max: 423 },
  { min: 0, max: 0 }, { min: 0, max: 4 },
  { min: 0, max: 0.4444444444444444 }, { min: 0, max: 0 },
] as const;
const REAL_ACTION24_RANGES = [
  ...REAL_AFTERSTATE13_RANGES,
  { min: -1, max: 0 }, { min: 0, max: 0.1111111111111111 }, { min: 0, max: 0 },
  { min: 0, max: 0.5 }, { min: 0, max: 1 }, { min: 0, max: 0 },
  { min: 0, max: 1 }, { min: 0, max: 1 }, { min: 0, max: 0 },
  { min: 0, max: 0.11111111111111112 }, { min: 0, max: 1 },
] as const;
const REAL_FEATURE_PROJECTION_DIGESTS = {
  afterstate13: '61fd9c5611034a22914c94895d3e80c624775b7984e9df24ab35193e6a2b5730',
  action24: '8423d923c2b414df9b96337b83355032a490909575e6a0ae00452aa500ab3379',
} as const;
const REAL_PIPELINE_DIGESTS = {
  manifest: {
    stateManifest: 'f6705ef0e424b44f8643ce30a4b4af7a780ac75990151b618e09822e6f305fbc',
    legalUniverse: '2d76c5a5687b5f3dc6e1a8edba9650280592505b1c5f16c8880228fd164f09ec',
    placementManifest: '63b6571eeaec5c7bc689dc1997b08fb5e7156806963c8a78c4a73b2b67e66307',
    cardinality: 'd6e2976cccc9d05d635fe0fa3014c7379a8023124b9482b600580499cb81b64b',
  },
  labels: {
    futurePrefix: '7e9664f2d45561d6c12ccc51a64ea16224f037b583fee4944e479b63274a1974',
    contextManifest: 'ab1d68a4c7ad3594f32371cf12374df69760cf627ffee7c453e615cf6893bada',
    taskAssociation: 'efa88cf99a8cbd766ab3a2d05cbc48eba27d2c0c21ef881a681e78caf9c2afc2',
    label: '91e0cb77fc46c3bd97a7cbe2d5ad37b5984bf3a6428e5eddadaf849ed3b5e53d',
  },
  replay: '727797453ba674b73c064adda77e3b56cd0241886226d2536ca1812a39c276a0',
  result: '83b542f7c919f39803cf386f433ea4036357347c8a118b44ec2eb4826726f05f',
} as const;
function canonicalFeatureFixture(options: Readonly<{
  readonly subsetCount?: number;
  readonly placementCount?: number;
  readonly afterstateLength?: number;
  readonly actionLength?: number;
  readonly nonFinite?: boolean;
  readonly prefixMismatch?: boolean;
  readonly interiorActionDelta?: boolean;
}> = {}): readonly D1FrozenSubset[] {
  const subsetCount = options.subsetCount ?? 160;
  const placementCount = options.placementCount ?? 12;
  const afterstateLength = options.afterstateLength ?? 13;
  const actionLength = options.actionLength ?? 24;
  return Object.freeze(Array.from({ length: subsetCount }, (_, subsetOrdinal) => Object.freeze({
    subsetId: `literal-subset-${subsetOrdinal}`,
    selectedCount: placementCount,
    placements: Object.freeze(Array.from({ length: placementCount }, (_, placementOrdinal) => {
      const rowOrdinal = subsetOrdinal * 12 + placementOrdinal;
      const afterstate13 = Array.from({ length: afterstateLength }, (_, dimension) =>
        dimension * 1000 + rowOrdinal);
      if (subsetOrdinal === 0 && placementOrdinal === 0 && afterstate13.length > 0) afterstate13[0] = -0;
      if (options.nonFinite && subsetOrdinal === 0 && placementOrdinal === 0 && afterstate13.length > 1) afterstate13[1] = Number.POSITIVE_INFINITY;
      const action24 = [
        ...afterstate13.slice(0, 13),
        ...Array.from({ length: Math.max(0, actionLength - 13) }, (_, dimension) => 20000 + dimension * 1000 + rowOrdinal * 2),
      ].slice(0, actionLength);
      if (options.prefixMismatch && subsetOrdinal === 17 && placementOrdinal === 3 && action24.length > 0) action24[0] = 999999;
      if (options.interiorActionDelta && subsetOrdinal === 17 && placementOrdinal === 3 && action24.length > 13) action24[13] += 0.5;
      return Object.freeze({
        placementId: `literal-placement-${placementOrdinal}`,
        afterstate13: Object.freeze(afterstate13),
        action24: Object.freeze(action24),
      });
    })),
  })) as unknown as readonly D1FrozenSubset[]);
}

function expectRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) expectRecursivelyFrozen(child);
}

function malformedFeatureSubset(placements: unknown): D1FrozenSubset {
  return Object.freeze({
    subsetId: 'malformed-feature-subset',
    capture: Object.freeze({}),
    placements,
    manifestDigest: 'm'.repeat(64),
  } as unknown as D1FrozenSubset);
}

async function runPrePoolManifestFault(
  mutateFirst: (subset: D1FrozenSubset) => D1FrozenSubset,
) {
  let behaviorCalls = 0;
  let subsetOrdinal = 0;
  const result = await runD1Diagnostic({
    runtimeIdentity: () => ({ node: '24.14.0', v8: '13.6.233.17-node.41', platform: 'win32', arch: 'x64' }),
    loadSources: () => fakeSources(),
    runBehavior: makeBehaviorRunner(() => behaviorCalls++),
    freezePlacementManifest: (capture) => {
      const subset = freezeD1PlacementManifest(capture);
      return subsetOrdinal++ === 0 ? mutateFirst(subset) : subset;
    },
    createPool: async () => { throw new Error('pre-pool fault must not create a worker pool'); },
  });
  expect(behaviorCalls).toBe(80);
  return result;
}

function prePoolEvidenceMatrix(result: Awaited<ReturnType<typeof runD1Diagnostic>>) {
  if (result.status !== 'invalid-input') throw new Error('expected pre-pool invalid-input result');
  const frozen = (value: string | null) => value === null ? null : 'frozen';
  return {
    source: Object.fromEntries(Object.entries(result.source).map(([key, value]) => [key, frozen(value)])),
    seeds: Object.fromEntries(Object.entries(result.seeds).map(([key, value]) => [key, frozen(value)])),
    completedCounts: result.completedCounts,
    manifestDigests: Object.fromEntries(Object.entries(result.manifestDigests)
      .map(([key, value]) => [key, frozen(value)])),
  };
}

describe('D1 Task 7 worker and orchestration contracts', () => {
  it('keeps canonical failure reasons discriminated at compile time', () => {
    expect(canonicalReasonTypeAssertions).toEqual([true, true, true, true, true]);
  });

  it('classifies missing canonical placement arrays as placement-manifest invalid input before runtime work', async () => {
    let behaviorCalls = 0;
    const result = await runD1Diagnostic({
      runtimeIdentity: () => ({ node: '24.14.0', v8: '13.6.233.17-node.41', platform: 'win32', arch: 'x64' }),
      loadSources: () => fakeSources(),
      runBehavior: makeBehaviorRunner(() => behaviorCalls++),
      createPool: async () => ({ run: async (tasks: readonly D1ContextTask[]) => tasks.map(fakeProjection), destroy: async () => undefined }),
      freezePlacementManifest: () => malformedFeatureSubset(undefined),
    } as Parameters<typeof runD1Diagnostic>[0]);

    expect(result.status).toBe('invalid-input');
    expect(result.phase).toBe('placement-manifest');
    expect(result.failureReasons).toEqual(['placement-manifest-mismatch']);
  });

  it('classifies a self-consistent K/L mismatch as cardinality invalid input before runtime work', async () => {
    const result = await runPrePoolManifestFault((subset) => {
      expect(subset.legalCount).toBeGreaterThan(12);
      expect(subset.selectedCount).toBe(12);
      return Object.freeze({
        ...subset,
        selectedCount: 11,
        placements: Object.freeze(subset.placements.slice(0, 11)),
      });
    });

    expect(result.status).toBe('invalid-input');
    expect(result.phase).toBe('cardinality');
    expect(result.failureReasons).toEqual(['placement-manifest-mismatch']);
  }, 120_000);

  it.each([
    ['legal-universe', 'placement-manifest-mismatch', () => {
      throw new D1InvalidInputError('placement-manifest-mismatch');
    }],
    ['cardinality', 'placement-manifest-mismatch', (subset: D1FrozenSubset) => Object.freeze({
      ...subset,
      placements: Object.freeze([
        Object.freeze({ ...subset.placements[0]!, afterstate13: Object.freeze(subset.placements[0]!.afterstate13.slice(0, 12)) }),
        ...subset.placements.slice(1),
      ]),
    })],
    ['context-manifest', 'placement-manifest-mismatch', (subset: D1FrozenSubset) => Object.freeze({
      ...subset, manifestDigest: '0'.repeat(64),
    })],
  ] as const)(
    'classifies a %s integrity fault as ordered pre-pool invalid input',
    async (phase, reason, mutateFirst) => {
      const result = await runPrePoolManifestFault(mutateFirst);

      expect(result.status).toBe('invalid-input');
      expect(result.phase).toBe(phase);
      expect(result.failureReasons).toEqual([reason]);
      expect(result).not.toHaveProperty('evidence');
      expect(serializeD1Result(result)).not.toMatch(/(?:[A-Z]:\\|\/[^"\s]+\/)|outcomes|models|partialLabel/i);
      expect(Object.keys(result)).toEqual([
        'mode', 'phase', 'status', 'failureReasons', 'source', 'seeds',
        'completedCounts', 'manifestDigests', 'resultDigest',
      ]);
    },
    120_000,
  );

  it('commits each pre-pool phase evidence atomically without reason-string phase fallback', async () => {
    const runtimeIdentity = () => ({ node: '24.14.0', v8: '13.6.233.17-node.41', platform: 'win32', arch: 'x64' });
    const noPool = async () => { throw new Error('pre-pool fault must not create a worker pool'); };
    const seedFailure = await runD1Diagnostic({
      runtimeIdentity,
      loadSources: () => fakeSources(),
      buildSeedManifest: () => { throw new D1InvalidInputError('seed-schedule-mismatch'); },
      createPool: noPool,
    });
    const captureFailure = await runD1Diagnostic({
      runtimeIdentity,
      loadSources: () => fakeSources(),
      runBehavior: () => { throw new D1InvalidInputError('capture-missing-or-invalid'); },
      createPool: noPool,
    });
    const placementFailure = await runPrePoolManifestFault(() => malformedFeatureSubset(undefined));
    const cardinalityFailure = await runPrePoolManifestFault((subset) => Object.freeze({
      ...subset,
      selectedCount: 11,
      placements: Object.freeze(subset.placements.slice(0, 11)),
    }));
    const contextFailure = await runPrePoolManifestFault((subset) => Object.freeze({
      ...subset,
      manifestDigest: '0'.repeat(64),
    }));
    const zeroSplit = { train: 0, validation: 0, test: 0 };
    const completeSplitSubsets = { train: 80, validation: 32, test: 48 };
    const cardinalitySplitPlacements = { train: 959, validation: 384, test: 576 };
    const completeSplitPlacements = { train: 960, validation: 384, test: 576 };

    expect([
      [seedFailure.phase, seedFailure.failureReasons, prePoolEvidenceMatrix(seedFailure)],
      [captureFailure.phase, captureFailure.failureReasons, prePoolEvidenceMatrix(captureFailure)],
      [placementFailure.phase, placementFailure.failureReasons, prePoolEvidenceMatrix(placementFailure)],
      [cardinalityFailure.phase, cardinalityFailure.failureReasons, prePoolEvidenceMatrix(cardinalityFailure)],
      [contextFailure.phase, contextFailure.failureReasons, prePoolEvidenceMatrix(contextFailure)],
    ]).toEqual([
      ['seeds', ['seed-schedule-mismatch'], {
        source: { checkpointHash: 'frozen', logHash: 'frozen', gen6BestDigest: 'frozen', gen10MuDigest: 'frozen' },
        seeds: { behaviorSeedDigest: null, labelSeedDigest: null },
        completedCounts: { states: 0, subsets: 0, splitSubsets: zeroSplit, placements: 0, splitPlacements: zeroSplit, contexts: 0 },
        manifestDigests: { state: null, legalUniverse: null, placement: null, cardinality: null, context: null, taskAssociation: null, label: null },
      }],
      ['captures', ['capture-missing-or-invalid'], {
        source: { checkpointHash: 'frozen', logHash: 'frozen', gen6BestDigest: 'frozen', gen10MuDigest: 'frozen' },
        seeds: { behaviorSeedDigest: 'frozen', labelSeedDigest: 'frozen' },
        completedCounts: { states: 0, subsets: 0, splitSubsets: zeroSplit, placements: 0, splitPlacements: zeroSplit, contexts: 0 },
        manifestDigests: { state: null, legalUniverse: null, placement: null, cardinality: null, context: null, taskAssociation: null, label: null },
      }],
      ['placement-manifest', ['placement-manifest-mismatch'], {
        source: { checkpointHash: 'frozen', logHash: 'frozen', gen6BestDigest: 'frozen', gen10MuDigest: 'frozen' },
        seeds: { behaviorSeedDigest: 'frozen', labelSeedDigest: 'frozen' },
        completedCounts: { states: 160, subsets: 0, splitSubsets: completeSplitSubsets, placements: 0, splitPlacements: zeroSplit, contexts: 0 },
        manifestDigests: { state: 'frozen', legalUniverse: null, placement: null, cardinality: null, context: null, taskAssociation: null, label: null },
      }],
      ['cardinality', ['placement-manifest-mismatch'], {
        source: { checkpointHash: 'frozen', logHash: 'frozen', gen6BestDigest: 'frozen', gen10MuDigest: 'frozen' },
        seeds: { behaviorSeedDigest: 'frozen', labelSeedDigest: 'frozen' },
        completedCounts: { states: 160, subsets: 160, splitSubsets: completeSplitSubsets, placements: 1919, splitPlacements: cardinalitySplitPlacements, contexts: 0 },
        manifestDigests: { state: 'frozen', legalUniverse: 'frozen', placement: 'frozen', cardinality: null, context: null, taskAssociation: null, label: null },
      }],
      ['context-manifest', ['placement-manifest-mismatch'], {
        source: { checkpointHash: 'frozen', logHash: 'frozen', gen6BestDigest: 'frozen', gen10MuDigest: 'frozen' },
        seeds: { behaviorSeedDigest: 'frozen', labelSeedDigest: 'frozen' },
        completedCounts: { states: 160, subsets: 160, splitSubsets: completeSplitSubsets, placements: 1920, splitPlacements: completeSplitPlacements, contexts: 0 },
        manifestDigests: { state: 'frozen', legalUniverse: 'frozen', placement: 'frozen', cardinality: 'frozen', context: null, taskAssociation: null, label: null },
      }],
    ]);
  }, 360_000);

  it('derives frozen literal observed feature evidence from canonical dynamic-cardinality rows', () => {
    const canonical = canonicalFeatureFixture();
    const evidence = buildD1ObservedFeatureEvidence(canonical);

    expect(evidence.names).toEqual({ afterstate13: LITERAL_AFTERSTATE13_NAMES, action24: LITERAL_ACTION24_NAMES });
    expect(evidence.dimensions).toEqual({ afterstate13: 13, action24: 24 });
    expect(evidence.ranges.afterstate13).toEqual(LITERAL_AFTERSTATE13_RANGES);
    expect(evidence.ranges.action24).toEqual(LITERAL_ACTION24_RANGES);
    expect(evidence.ranges.action24.slice(0, 13)).toEqual(evidence.ranges.afterstate13);
    expect(Object.is(evidence.ranges.afterstate13[0]!.min, -0)).toBe(false);
    expectRecursivelyFrozen(evidence);
    expect(JSON.stringify(buildD1ObservedFeatureEvidence(canonical))).toBe(JSON.stringify(evidence));

    const alteredInterior = buildD1ObservedFeatureEvidence(canonicalFeatureFixture({ interiorActionDelta: true }));
    expect(alteredInterior.ranges).toEqual(evidence.ranges);
    expect(alteredInterior.projectionDigests.afterstate13).toBe(evidence.projectionDigests.afterstate13);
    expect(alteredInterior.projectionDigests.action24).not.toBe(evidence.projectionDigests.action24);

    for (const malformed of [
      canonicalFeatureFixture({ subsetCount: 159 }),
      canonicalFeatureFixture({ subsetCount: 161 }),
      canonicalFeatureFixture({ placementCount: 1 }),
      canonicalFeatureFixture({ placementCount: 13 }),
      canonicalFeatureFixture({ afterstateLength: 12 }),
      canonicalFeatureFixture({ afterstateLength: 14 }),
      canonicalFeatureFixture({ actionLength: 23 }),
      canonicalFeatureFixture({ actionLength: 25 }),
      canonicalFeatureFixture({ nonFinite: true }),
      canonicalFeatureFixture({ prefixMismatch: true }),
    ]) {
      expect(() => buildD1ObservedFeatureEvidence(malformed)).toThrow('placement-manifest-mismatch');
    }
    expect(() => buildD1ObservedFeatureEvidence(canonicalFeatureFixture({ placementCount: 2 }))).not.toThrow();
    expect(() => buildD1ObservedFeatureEvidence(canonicalFeatureFixture({ placementCount: 11 }))).not.toThrow();
  });

  it('serializes a structured result including its digest', () => {
    const result = { mode: 'd1-action-conditioned-held-out-listwise-v2-variable-cardinality', phase: 'worker', status: 'runtime-fail', failureReasons: ['abort'], evidence: null, resultDigest: 'a'.repeat(64) } as const;
    const serialized = serializeD1Result(result);
    expect(JSON.parse(serialized)).toMatchObject({ mode: result.mode, status: result.status });
    expect(serialized).toContain('resultDigest');
  });

  it('constructs a bounded pool API with an idempotent destroy promise', async () => {
    const terminated: number[] = [];
    const pool = await D1WorkerPool.create(2, (index) => ({
      postMessage() {},
      on() { return this; },
      once() { return this; },
      removeListener() { return this; },
      terminate: async () => { terminated.push(index); },
    }));
    const first = pool.destroy();
    const second = pool.destroy();
    await Promise.all([first, second]);
    expect(terminated.sort()).toEqual([0, 1]);
  });

  it('rejects an unapproved runtime before a source reader can run', async () => {
    let sourceReads = 0;
    let behaviorRuns = 0;
    let manifestFreezes = 0;
    let poolCreations = 0;
    let snapshotReads = 0;

    const result = await runD1Diagnostic({
      runtimeIdentity: () => ({ node: '0.0.0', v8: '0', platform: 'win32', arch: 'x64' }),
      loadSources: () => {
        sourceReads += 1;
        throw new Error('source reader must not run');
      },
      runBehavior: () => {
        behaviorRuns += 1;
        throw new Error('behavior runner must not run');
      },
      freezePlacementManifest: () => {
        manifestFreezes += 1;
        throw new Error('manifest freezer must not run');
      },
      createPool: async () => {
        poolCreations += 1;
        throw new Error('pool must not be created');
      },
      filesystemSnapshot: () => {
        snapshotReads += 1;
        return 'must-not-be-read';
      },
    });

    expect(result.status).toBe('invalid-input');
    expect(result.failureReasons).toEqual(['runtime-identity-mismatch']);
    expect(Object.keys(result)).toEqual([
      'mode', 'phase', 'status', 'failureReasons', 'source', 'seeds',
      'completedCounts', 'manifestDigests', 'resultDigest',
    ]);
    expect(result).toMatchObject({
      mode: 'd1-action-conditioned-held-out-listwise-v2-variable-cardinality',
      phase: 'runtime-identity',
      source: { checkpointHash: null, logHash: null, gen6BestDigest: null, gen10MuDigest: null },
      seeds: { behaviorSeedDigest: null, labelSeedDigest: null },
      completedCounts: {
        states: 0, subsets: 0, splitSubsets: { train: 0, validation: 0, test: 0 },
        placements: 0, splitPlacements: { train: 0, validation: 0, test: 0 }, contexts: 0,
      },
      manifestDigests: {
        state: null, legalUniverse: null, placement: null, cardinality: null,
        context: null, taskAssociation: null, label: null,
      },
    });
    expect(sourceReads).toBe(0);
    expect(behaviorRuns).toBe(0);
    expect(manifestFreezes).toBe(0);
    expect(poolCreations).toBe(0);
    expect(snapshotReads).toBe(0);
  });

  it('uses only the accepted injected orchestrator identity throughout every later phase', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'node')!;
    Object.defineProperty(process.versions, 'node', { ...descriptor, value: 'controller-shell-must-not-be-read' });
    try {
      const run = await runFakeFullPipeline();
      expect(run.poolCreations).toBe(1);
      expect(run.dispatchBatches.map((batch) => batch.length)).toEqual([3400, 1472, 16]);
      expect(run.result.status).toBe('fail-joint-selection-not-shown');
      expect(run.result.failureReasons).not.toContain('runtime-identity-mismatch');
    } finally {
      Object.defineProperty(process.versions, 'node', descriptor);
    }
  }, 120_000);

  it('returns the exact pre-pool capture reason without creating a pool or entering later phases', async () => {
    let behaviorCalls = 0;
    let manifestFreezes = 0;
    let poolCreations = 0;
    let poolRuns = 0;
    const result = await runD1Diagnostic({
      runtimeIdentity: () => ({ node: '24.14.0', v8: '13.6.233.17-node.41', platform: 'win32', arch: 'x64' }),
      loadSources: () => fakeSources(),
      runBehavior: makeBehaviorRunner(() => behaviorCalls++),
      freezePlacementManifest: (capture) => {
        const subset = freezeD1PlacementManifest(capture);
        const ordinal = manifestFreezes++;
        return ordinal === 0
          ? Object.freeze({ ...subset, capture: Object.freeze({ ...subset.capture, split: 'test' as const }) })
          : subset;
      },
      createPool: async () => {
        poolCreations += 1;
        return {
          run: async () => { poolRuns += 1; return []; },
          destroy: async () => undefined,
        };
      },
    });

    expect(result.status).toBe('invalid-input');
    expect(result.failureReasons).toEqual(['capture-missing-or-invalid']);
    expect(behaviorCalls).toBe(80);
    expect(manifestFreezes).toBe(160);
    expect(poolCreations).toBe(0);
    expect(poolRuns).toBe(0);
  }, 120_000);

  it('turns a structured runtime failure into one stdout JSON line and exit 1', async () => {
    const result = await runD1DiagnosticCli({
      runDiagnostic: async () => ({
        mode: 'd1-action-conditioned-held-out-listwise-v2-variable-cardinality' as const,
        phase: 'worker' as const,
        status: 'runtime-fail' as const,
        failureReasons: ['abort'],
        evidence: null,
        resultDigest: 'a'.repeat(64),
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('{"mode":"d1-action-conditioned-held-out-listwise-v2-variable-cardinality","phase":"worker","status":"runtime-fail","failureReasons":["abort"],"evidence":null,"resultDigest":"' + 'a'.repeat(64) + '"}\n');
  });

  it('uses exit 0 only for the completed PASS status', async () => {
    const result = await runD1DiagnosticCli({
      runDiagnostic: async () => ({
        mode: 'd1-action-conditioned-held-out-listwise-v2-variable-cardinality' as const,
        phase: 'complete' as const,
        status: 'pass-action-conditioned-listwise-supported' as const,
        failureReasons: [],
        evidence: {} as never,
        resultDigest: 'b'.repeat(64),
      }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.endsWith('\n')).toBe(true);
  });

  it('keeps stdout empty and redacts an unstructured exception', async () => {
    const result = await runD1DiagnosticCli({
      runDiagnostic: async () => { throw new Error('sensitive path and values'); },
    });

    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'D1 diagnostic failed: internal-error\n' });
  });

  it('passes the abort signal into the default diagnostic invocation', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const result = await runD1DiagnosticCli({
      signal: controller.signal,
      runDiagnostic: async (signal?: AbortSignal) => {
        received = signal;
        return {
          mode: 'd1-action-conditioned-held-out-listwise-v2-variable-cardinality' as const,
          phase: 'worker' as const,
          status: 'runtime-fail' as const,
          failureReasons: ['abort'],
          evidence: null,
          resultDigest: 'a'.repeat(64),
        };
      },
    });

    expect(result.exitCode).toBe(1);
    expect(received).toBe(controller.signal);
  });

  it('waits for SIGINT cleanup before output and restores its sole listener', async () => {
    const listeners: Array<() => void> = [];
    const events: string[] = [];
    const processLike = {
      exitCode: undefined as number | undefined,
      stdout: { write: (text: string) => { events.push(text.endsWith('\n') ? 'stdout' : 'bad-stdout'); } },
      stderr: { write: (text: string) => { events.push(text.endsWith('\n') ? 'stderr' : 'bad-stderr'); } },
      once: (_event: 'SIGINT', listener: () => void) => { listeners.push(listener); events.push('listener-added'); return processLike; },
      removeListener: (_event: 'SIGINT', listener: () => void) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
        events.push('listener-removed');
        return processLike;
      },
    };
    const pending = runD1Main({
      process: processLike,
      runDiagnostic: (signal) => new Promise((resolve) => {
        signal!.addEventListener('abort', () => {
          events.push('abort');
          queueMicrotask(() => {
            events.push('destroyed');
            resolve({
              mode: 'd1-action-conditioned-held-out-listwise-v2-variable-cardinality',
              phase: 'worker',
              status: 'runtime-fail',
              failureReasons: ['abort'],
              evidence: null,
              resultDigest: 'a'.repeat(64),
            });
          });
        }, { once: true });
      }),
    });

    expect(listeners).toHaveLength(1);
    listeners[0]!();
    await pending;

    expect(events).toEqual(['listener-added', 'abort', 'destroyed', 'stdout', 'listener-removed']);
    expect(listeners).toHaveLength(0);
    expect(processLike.exitCode).toBe(1);
  });

  it('restores out-of-order worker messages to canonical task order', async () => {
    const first = controllableWorker();
    const second = controllableWorker();
    const pool = await D1WorkerPool.create(2, (index) => index === 0 ? first : second);
    const pending = pool.run([task(0), task(1)]);

    second.emit('message', { kind: 'result', result: projection(1) });
    first.emit('message', { kind: 'result', result: projection(0) });

    await expect(pending).resolves.toEqual([projection(0), projection(1)]);
    await pool.destroy();
  });

  it('fails closed when a worker exits before its assigned result', async () => {
    const worker = controllableWorker();
    const pool = await D1WorkerPool.create(1, () => worker);
    const pending = pool.run([task(0)]);

    worker.emit('exit', 0);

    await expect(pending).rejects.toThrow('worker-pool-failure');
    await pool.destroy();
  });

  it.each(['warning', 'error'] as const)('fails closed on a worker %s without retry or replacement', async (event) => {
    const worker = controllableWorker();
    let factoryCalls = 0;
    const pool = await D1WorkerPool.create(1, () => { factoryCalls += 1; return worker; });
    const pending = pool.run([task(0)]);

    worker.emit(event, new Error('sensitive worker detail'));

    await expect(pending).rejects.toThrow('worker-pool-failure');
    expect(factoryCalls).toBe(1);
    await pool.destroy();
  });

  it('redacts a synchronous worker dispatch failure and releases the active run', async () => {
    const worker = controllableWorker();
    worker.postMessage = () => { throw new Error('sensitive dispatch detail'); };
    const pool = await D1WorkerPool.create(1, () => worker);

    await expect(pool.run([task(0)])).rejects.toThrow('worker-pool-failure');
    await expect(pool.run([task(1)])).rejects.toThrow('worker-pool-failure');
    await pool.destroy();
  });

  it('reports a settled destroy rejection through the shared idempotent promise', async () => {
    const pool = await D1WorkerPool.create(1, () => ({
      postMessage() {},
      on() { return this; },
      once() { return this; },
      removeListener() { return this; },
      terminate: async () => { throw new Error('sensitive terminate detail'); },
    }));

    const first = pool.destroy();
    const second = pool.destroy();

    expect(first).toBe(second);
    await expect(first).rejects.toThrow('worker-pool-destroy-failure');
  });

  it('destroys the pool and rejects when its run is aborted', async () => {
    const worker = controllableWorker();
    const pool = await D1WorkerPool.create(1, () => worker);
    const controller = new AbortController();
    const pending = pool.run([task(0)], { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toThrow('abort');
    await expect(pool.destroy()).resolves.toBeUndefined();
  });

  it('rejects duplicate or unexpected worker result task IDs', async () => {
    const worker = controllableWorker();
    const pool = await D1WorkerPool.create(1, () => worker);
    const pending = pool.run([task(0)]);

    worker.emit('message', { kind: 'result', result: projection(9) });

    await expect(pending).rejects.toThrow('worker-pool-failure');
    await pool.destroy();
  });

  it('rejects a projection whose identity differs from the assigned task', async () => {
    const worker = controllableWorker();
    const pool = await D1WorkerPool.create(1, () => worker);
    const pending = pool.run([task(0)]);

    const wrongSubset = projection(0, { subsetId: 'subset-other' });
    worker.emit('message', { kind: 'result', result: wrongSubset });

    await expect(pending).rejects.toThrow('worker-pool-failure');
    await pool.destroy();
  });

  it.each([
    ['digest mismatch', () => ({ ...projection(0), projectionDigest: '0'.repeat(64) })],
    ['missing field', () => {
      const value = projection(0) as unknown as Record<string, unknown>;
      return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'scoreDelta'));
    }],
    ['extra field', () => ({ ...projection(0), unexpected: true })],
  ] as const)('rejects a projection with %s at the pool boundary', async (_name, makeProjection) => {
    const worker = controllableWorker();
    const pool = await D1WorkerPool.create(1, () => worker);
    const pending = pool.run([task(0)]);

    worker.emit('message', { kind: 'result', result: makeProjection() });

    await expect(pending).rejects.toThrow('worker-pool-failure');
    await pool.destroy();
  });

  it('rejects a colluding worker that swaps two assigned task projections', async () => {
    const worker = controllableWorker();
    const pool = await D1WorkerPool.create(1, () => worker);
    const pending = pool.run([task(0), task(1)]);

    worker.emit('message', { kind: 'result', result: projection(1) });

    await expect(pending).rejects.toThrow('worker-pool-failure');
    await pool.destroy();
  });

  it('turns a malformed worker message into a redacted pool failure', async () => {
    const worker = controllableWorker();
    const pool = await D1WorkerPool.create(1, () => worker);
    const pending = pool.run([task(0)]);

    expect(() => worker.emit('message', null)).not.toThrow();
    await expect(pending).rejects.toThrow('worker-pool-failure');
    await pool.destroy();
  });

  it('propagates a matching structured simulation failure without retry', async () => {
    const worker = controllableWorker();
    const pool = await D1WorkerPool.create(1, () => worker);
    const pending = pool.run([task(0), task(1)]);

    worker.emit('message', { kind: 'failure', taskId: 0, reason: 'simulation-failure' });

    await expect(pending).rejects.toThrow('simulation-failure');
    expect(worker.dispatched.map(({ taskId }) => taskId)).toEqual([0]);
    await pool.destroy();
  });

  it.each([
    ['wrong task', { kind: 'failure', taskId: 1, reason: 'simulation-failure' }],
    ['wrong reason', { kind: 'failure', taskId: 0, reason: 'sensitive-detail' }],
    ['extra field', { kind: 'failure', taskId: 0, reason: 'simulation-failure', detail: 'sensitive-detail' }],
  ] as const)('maps a %s structured failure to worker-pool-failure', async (_name, message) => {
    const worker = controllableWorker();
    const pool = await D1WorkerPool.create(1, () => worker);
    const pending = pool.run([task(0)]);

    worker.emit('message', message);

    await expect(pending).rejects.toThrow('worker-pool-failure');
    await pool.destroy();
  });

  it('maps an injected worker simulation failure to the runtime simulation reason', async () => {
    let behaviorCalls = 0;
    const result = await runD1Diagnostic({
      runtimeIdentity: () => ({ node: '24.14.0', v8: '13.6.233.17-node.41', platform: 'win32', arch: 'x64' }),
      loadSources: () => fakeSources(),
      runBehavior: makeBehaviorRunner(() => behaviorCalls++),
      createPool: async () => ({
        run: async () => {
          throw new FitModule.D1PipelineRuntimeError('worker', 'simulation-failure', 'simulation');
        },
        destroy: async () => undefined,
      }),
    });

    expect(result.status).toBe('runtime-fail');
    expect(result.failureReasons).toEqual(['simulation-failure']);
  }, 120_000);

  it('classifies a capability-bound fit exception as optimizer-failure before any test dispatch', async () => {
    const fitSpy = vi.spyOn(FitModule, 'fitD1TrainingRepresentation').mockImplementationOnce(() => {
      throw new Error('sensitive optimizer detail');
    });
    try {
      const run = await runFakeFullPipeline();

      expect(run.dispatchBatches.map((batch) => batch.length)).toEqual([3400]);
      expect(run.result).toEqual(expect.objectContaining({
        phase: 'optimizer',
        status: 'runtime-fail',
        failureReasons: ['optimizer-failure'],
        evidence: null,
      }));
      expect(serializeD1Result(run.result)).not.toMatch(/sensitive|optimizer detail/i);
    } finally {
      fitSpy.mockRestore();
    }
  }, 120_000);

  it('keeps train projection integrity distinct from the held-out freeze boundary', async () => {
    const trainDrift = await runFakeFullPipeline({ trainProjectionDrift: true });
    expect(trainDrift.result).toMatchObject({
      phase: 'worker',
      status: 'runtime-fail',
      failureReasons: ['worker-pool-failure'],
      evidence: null,
    });

    const heldOutViolation = await runFakeFullPipeline({ testProjectionFault: 'duplicate' });
    expect(heldOutViolation.result).toMatchObject({
      phase: 'test',
      status: 'runtime-fail',
      failureReasons: ['test-before-freeze'],
      evidence: null,
    });
  }, 120_000);

  it('composes primary, destroy, and post-flight reasons once in frozen order before one redacted CLI line', async () => {
    const runCase = async (input: Readonly<{
      primary: 'abort' | 'simulation-failure';
      destroyFailure: boolean;
      snapshotDrift: boolean;
    }>) => {
      let behaviorCalls = 0;
      let snapshotReads = 0;
      const controller = new AbortController();
      if (input.primary === 'abort') controller.abort();
      return runD1Diagnostic({
        runtimeIdentity: () => ({ node: '24.14.0', v8: '13.6.233.17-node.41', platform: 'win32', arch: 'x64' }),
        loadSources: () => fakeSources(),
        runBehavior: makeBehaviorRunner(() => behaviorCalls++),
        signal: controller.signal,
        createPool: async () => ({
          run: async () => {
            if (input.primary === 'simulation-failure') {
              throw new FitModule.D1PipelineRuntimeError('worker', 'simulation-failure', 'simulation');
            }
            throw new Error('sensitive primary C:\\private\\task.json');
          },
          destroy: async () => {
            if (input.destroyFailure) throw new Error('sensitive destroy C:\\private\\worker.log');
          },
        }),
        filesystemSnapshot: () => {
          snapshotReads += 1;
          return input.snapshotDrift && snapshotReads > 1 ? 'sensitive-after-state' : 'before-state';
        },
      });
    };

    const abortAndDestroy = await runCase({ primary: 'abort', destroyFailure: true, snapshotDrift: false });
    const simulationAndDestroy = await runCase({ primary: 'simulation-failure', destroyFailure: true, snapshotDrift: false });
    const simulationAndDrift = await runCase({ primary: 'simulation-failure', destroyFailure: false, snapshotDrift: true });

    expect(abortAndDestroy.failureReasons).toEqual(['abort', 'worker-pool-destroy-failure']);
    expect(simulationAndDestroy.failureReasons).toEqual(['simulation-failure', 'worker-pool-destroy-failure']);
    expect(simulationAndDrift.failureReasons).toEqual(['simulation-failure', 'malformed-metrics']);
    for (const result of [abortAndDestroy, simulationAndDestroy, simulationAndDrift]) {
      expect(result.status).toBe('runtime-fail');
      expect(new Set(result.failureReasons).size).toBe(result.failureReasons.length);
      const { resultDigest, ...projection } = result;
      expect(resultDigest).toBe(createHash('sha256').update(JSON.stringify(projection), 'utf8').digest('hex'));
    }

    const firstCli = await runD1DiagnosticCli({ runDiagnostic: async () => abortAndDestroy });
    const secondCli = await runD1DiagnosticCli({ runDiagnostic: async () => abortAndDestroy });
    expect(firstCli).toEqual(secondCli);
    expect(firstCli.exitCode).toBe(1);
    expect(firstCli.stderr).toBe('');
    expect(firstCli.stdout.split('\n')).toHaveLength(2);
    expect(JSON.parse(firstCli.stdout)).toEqual(abortAndDestroy);
    expect(firstCli.stdout).not.toMatch(/sensitive|private|task\.json|worker\.log/i);
  }, 120_000);

  it('keeps invalid input above cleanup runtime failures and runtime above statistical verdicts', async () => {
    let snapshotReads = 0;
    const invalid = await runD1Diagnostic({
      runtimeIdentity: () => ({ node: '24.14.0', v8: '13.6.233.17-node.41', platform: 'win32', arch: 'x64' }),
      loadSources: () => { throw new D1InvalidInputError('source-hash-mismatch'); },
      filesystemSnapshot: () => snapshotReads++ === 0 ? 'before' : 'after',
    });
    expect(invalid.status).toBe('invalid-input');
    expect(invalid.failureReasons).toEqual(['source-hash-mismatch']);

    const statisticalWithDrift = await runFakeFullPipeline({ snapshotDrift: true });
    expect(statisticalWithDrift.result.status).toBe('runtime-fail');
    expect(statisticalWithDrift.result.failureReasons).toEqual(['malformed-metrics']);
  }, 120_000);

  it('consumes test authority before test work and leaves Labels/Fit terminal when the failure hook throws', async () => {
    const realConsume = LabelsModule.consumeD1TestLabelCapability;
    const realFail = LabelsModule.failD1TestLabelAttempt;
    let capturedFinal: D1FinalModelBundle | undefined;
    let capturedContext: D1ContextTaskBatch | undefined;
    let capturedAttempt: ReturnType<typeof realConsume> | undefined;
    const consumeSpy = vi.spyOn(LabelsModule, 'consumeD1TestLabelCapability').mockImplementation((finalModels, contextBatch) => {
      capturedFinal = finalModels;
      capturedContext = contextBatch;
      capturedAttempt = realConsume(finalModels, contextBatch);
      return capturedAttempt;
    });
    const failureSpy = vi.spyOn(LabelsModule, 'failD1TestLabelAttempt').mockImplementation((attempt) => {
      realFail(attempt);
      throw new Error('injected failure hook');
    });

    try {
      const run = await runFakeFullPipeline({
        testWorkerFailure: true,
        destroyFailure: true,
        beforeTestWorker: () => expect(consumeSpy).toHaveBeenCalledTimes(1),
      });

      expect(run.dispatchBatches.map((batch) => batch.length)).toEqual([3400, 1472]);
      expect(run.poolDestroys).toBe(1);
      expect(run.result).toMatchObject({
        phase: 'cleanup',
        status: 'runtime-fail',
        failureReasons: ['worker-pool-failure', 'worker-pool-destroy-failure', 'test-before-freeze'],
        evidence: null,
      });
      expect(failureSpy).toHaveBeenCalledTimes(1);
      expect(failureSpy).toHaveBeenCalledWith(capturedAttempt);
      expect(capturedFinal).toBeDefined();
      expect(capturedContext).toBeDefined();
      const final = capturedFinal;
      const context = capturedContext;
      const attempt = capturedAttempt;
      if (final === undefined || context === undefined || attempt === undefined) {
        throw new Error('expected authentic final bundle, context batch, and test attempt');
      }
      expect(() => realConsume(final, context)).toThrow('test attempt already consumed');
      const runIdentity = requireD1ContextTaskBatchAuthority(context).runIdentity;
      expect(() => consumeD1FinalBundleForTest(final, runIdentity)).toThrow('test-before-freeze');
    } finally {
      failureSpy.mockRestore();
      consumeSpy.mockRestore();
    }
  }, 120_000);

  it.each(['before', 'after'] as const)(
    'makes both test authorities terminal when the Fit failure transition throws %s mutation',
    async (throwTiming) => {
      const realConsume = LabelsModule.consumeD1TestLabelCapability;
      const realFitFailure = FitModule.failD1FinalBundleTestAttestation;
      let capturedFinal: D1FinalModelBundle | undefined;
      let capturedContext: D1ContextTaskBatch | undefined;
      let capturedAttestation: Parameters<typeof realFitFailure>[0] | undefined;
      const consumeSpy = vi.spyOn(LabelsModule, 'consumeD1TestLabelCapability').mockImplementation((finalModels, contextBatch) => {
        capturedFinal = finalModels;
        capturedContext = contextBatch;
        return realConsume(finalModels, contextBatch);
      });
      const fitFailureSpy = vi.spyOn(FitModule, 'failD1FinalBundleTestAttestation').mockImplementationOnce((attestation) => {
        capturedAttestation = attestation;
        if (throwTiming === 'after') realFitFailure(attestation);
        throw new Error(`sensitive Fit ${throwTiming} transition C:\\private\\fit.log`);
      });

      try {
        const run = await runFakeFullPipeline({ testWorkerFailure: true, destroyFailure: true });
        expect(run.result).toMatchObject({
          phase: 'cleanup',
          status: 'runtime-fail',
          failureReasons: ['worker-pool-failure', 'worker-pool-destroy-failure', 'test-before-freeze'],
          evidence: null,
        });
        expect(JSON.stringify(run.result)).not.toMatch(/sensitive|private|fit\.log/i);
        expect(capturedFinal).toBeDefined();
        expect(capturedContext).toBeDefined();
        expect(capturedAttestation).toBeDefined();
        const final = capturedFinal;
        const context = capturedContext;
        const attestation = capturedAttestation;
        if (final === undefined || context === undefined || attestation === undefined) {
          throw new Error('expected authentic final bundle, context batch, and Fit attestation');
        }
        expect(() => realFitFailure(attestation)).toThrow('unrecognized final bundle test attestation');
        expect(() => realConsume(final, context)).toThrow('test attempt already consumed');
        expect(() => consumeD1FinalBundleForTest(
          final,
          requireD1ContextTaskBatchAuthority(context).runIdentity,
        )).toThrow('test-before-freeze');
      } finally {
        fitFailureSpy.mockRestore();
        consumeSpy.mockRestore();
      }
    },
    120_000,
  );

  it('does not let the test-only phase harness bypass the concrete pipeline', async () => {
    const result = await runD1Diagnostic({
      runtimeIdentity: () => ({ node: '24.14.0', v8: '13.6.233.17-node.41', platform: 'win32', arch: 'x64' }),
      loadSources: () => fakeSources(),
      runBehavior: () => { throw new Error('concrete pipeline must run'); },
      phaseHarness: { run: async () => { throw new Error('phase harness must not be callable'); } },
    } as Parameters<typeof runD1Diagnostic>[0]);

    expect(result.status).toBe('runtime-fail');
    expect(result.failureReasons).toEqual(['simulation-failure']);
  });

  it('executes the real frozen pipeline before crossing once into held-out labels and canonical replays', async () => {
    const materializations: Array<Readonly<{
      contextBatch: D1ContextTaskBatch;
      split: 'train' | 'validation' | 'test';
      projectionCount: number;
      hasTestAttempt: boolean;
    }>> = [];
    const realMaterialize = LabelsModule.materializeD1LabeledBatch;
    const materializeSpy = vi.spyOn(LabelsModule, 'materializeD1LabeledBatch').mockImplementation((input) => {
      materializations.push({
        contextBatch: input.contextBatch,
        split: input.split,
        projectionCount: input.projections.length,
        hasTestAttempt: input.testAttempt !== undefined,
      });
      return realMaterialize(input);
    });
    let first: Awaited<ReturnType<typeof runFakeFullPipeline>>;
    let second: Awaited<ReturnType<typeof runFakeFullPipeline>>;
    try {
      first = await runFakeFullPipeline();
      second = await runFakeFullPipeline();
    } finally {
      materializeSpy.mockRestore();
    }

    expect(first.behaviorCalls).toBe(80);
    expect(first.poolCreations).toBe(1);
    expect(first.poolDestroys).toBe(1);
    expect(first.snapshotCalls).toBe(2);
    expect(first.dispatchBatches.map((batch) => batch.length)).toEqual([3400, 1472, 16]);
    expect(first.dispatchBatches[0]!.map(({ taskId }) => taskId)).toEqual(
      Array.from({ length: 3400 }, (_, taskId) => taskId),
    );
    expect(first.dispatchBatches[1]!.map(({ taskId }) => taskId)).toEqual(
      Array.from({ length: 1472 }, (_, index) => 3400 + index),
    );
    expect(first.dispatchBatches[2]).toHaveLength(16);
    expect(new Set(first.dispatchBatches[2]!.map(({ taskId }) => taskId)).size).toBe(16);
    expect(first.dispatchBatches[2]!.every(({ streamIndex }) => streamIndex === 0)).toBe(true);
    expect(materializations.map(({ split, projectionCount, hasTestAttempt }) => ({
      split, projectionCount, hasTestAttempt,
    }))).toEqual([
      { split: 'train', projectionCount: 2424, hasTestAttempt: false },
      { split: 'validation', projectionCount: 976, hasTestAttempt: false },
      { split: 'test', projectionCount: 1472, hasTestAttempt: true },
      { split: 'train', projectionCount: 2424, hasTestAttempt: false },
      { split: 'validation', projectionCount: 976, hasTestAttempt: false },
      { split: 'test', projectionCount: 1472, hasTestAttempt: true },
    ]);
    expect(materializations[0]!.contextBatch).toBe(materializations[1]!.contextBatch);
    expect(materializations[1]!.contextBatch).toBe(materializations[2]!.contextBatch);
    expect(materializations[3]!.contextBatch).toBe(materializations[4]!.contextBatch);
    expect(materializations[4]!.contextBatch).toBe(materializations[5]!.contextBatch);
    expect(materializations[0]!.contextBatch).not.toBe(materializations[3]!.contextBatch);
    expect(first.dispatchBatches[0]![0]).toMatchObject({
      taskId: 0,
      continuationVectorId: 'gen6-best',
      streamIndex: 0,
    });
    expect(Object.keys(first.dispatchBatches[0]![0]!.capture)).toEqual(['state', 'score', 'lines', 'level']);
    expect(first.result).toMatchObject({
      mode: 'd1-action-conditioned-held-out-listwise-v2-variable-cardinality',
      phase: 'complete',
      status: 'fail-joint-selection-not-shown',
      evidence: {
        manifest: {
          stateCount: 160,
          placementCount: 1218,
          splitCounts: { train: 80, validation: 32, test: 48 },
          splitPlacementCounts: { train: 606, validation: 244, test: 368 },
        },
        labels: {
          protocol: 'survival-first-joint-pareto-uniform-v2-variable-cardinality',
          primaryContextCount: 4872,
          trainValidationContextCount: 3400,
          heldOutContextCount: 1472,
          streamPrefixCount: 320,
        },
        replays: { count: 16 },
      },
    });
    const evidence = 'evidence' in first.result && first.result.evidence;
    expect(evidence).not.toBeNull();
    if (!evidence) throw new Error('expected completed result evidence');
    expect(evidence.search).not.toHaveProperty('unexpectedSearchMetadata');
    const featureResult = evidence.features;
    expect(featureResult.names.afterstate13.map((name, index) => [name, featureResult.ranges.afterstate13[index]!])).toEqual(
      LITERAL_AFTERSTATE13_NAMES.map((name, index) => [name, REAL_AFTERSTATE13_RANGES[index]!]),
    );
    expect(featureResult.names.action24.map((name, index) => [name, featureResult.ranges.action24[index]!])).toEqual(
      LITERAL_ACTION24_NAMES.map((name, index) => [name, REAL_ACTION24_RANGES[index]!]),
    );
    expect(featureResult.ranges.afterstate13).toHaveLength(13);
    expect(featureResult.ranges.action24).toHaveLength(24);
    expect(featureResult.names.afterstate13).toHaveLength(13);
    expect(featureResult.names.action24).toHaveLength(24);
    expect(featureResult.ranges.action24.slice(0, 13)).toEqual(featureResult.ranges.afterstate13);
    for (const range of [...featureResult.ranges.afterstate13, ...featureResult.ranges.action24]) {
      expect(Number.isFinite(range.min)).toBe(true);
      expect(Number.isFinite(range.max)).toBe(true);
      expect(range.min).toBeLessThanOrEqual(range.max);
    }
    expect(featureResult.ranges.afterstate13).not.toBe('active-v5-feature-contract');
    expect(featureResult.projectionDigests).toEqual(REAL_FEATURE_PROJECTION_DIGESTS);
    expect(evidence.manifest.subsetCardinalities).toHaveLength(160);
    expect(evidence.manifest.selectedCountHistogram).toEqual([
      { count: 2, subsetCount: 54 }, { count: 3, subsetCount: 0 }, { count: 4, subsetCount: 0 },
      { count: 5, subsetCount: 0 }, { count: 6, subsetCount: 0 }, { count: 7, subsetCount: 0 },
      { count: 8, subsetCount: 0 }, { count: 9, subsetCount: 54 }, { count: 10, subsetCount: 0 },
      { count: 11, subsetCount: 0 }, { count: 12, subsetCount: 52 },
    ]);
    expect([...new Set(evidence.manifest.subsetCardinalities.map(({ legalCount, selectedCount }) =>
      `${legalCount}/${selectedCount}`))].sort()).toEqual(['12/12', '13/12', '2/2', '9/9']);
    expect(evidence.manifest.subsetCardinalities.every(({ legalCount, selectedCount }) =>
      legalCount >= 2 && selectedCount === Math.min(12, legalCount))).toBe(true);
    expect(evidence.manifest.splitCardinalityHistograms.map(({ split }) => split)).toEqual(['train', 'validation', 'test']);
    expect(evidence.manifest.groupCardinalityHistograms.map(({ groupOrdinal }) => groupOrdinal)).toEqual(
      Array.from({ length: 40 }, (_, groupOrdinal) => groupOrdinal),
    );
    const serialized = serializeD1Result(first.result);
    expect(Object.keys(first.result)).toEqual(['mode', 'phase', 'status', 'failureReasons', 'evidence', 'resultDigest']);
    expect(Object.keys(evidence)).toEqual([
      'source', 'search', 'seeds', 'manifest', 'features', 'labels', 'fits', 'validation', 'heldOut', 'replays',
    ]);
    expect(serialized).not.toMatch(/runIdentity|authority|attestation|testAttempt|d1-test-label-attempt/i);
    expect(serialized).not.toContain('-0');
    expect(serialized).not.toMatch(/[\r\n]/);
    expect(serialized).toBe(JSON.stringify(first.result));
    const { resultDigest, ...projection } = first.result;
    expect(resultDigest).toBe(createHash('sha256').update(JSON.stringify(projection), 'utf8').digest('hex'));
    expect({
      manifest: {
        stateManifest: evidence.manifest.stateManifestDigest,
        legalUniverse: evidence.manifest.legalUniverseDigest,
        placementManifest: evidence.manifest.placementManifestDigest,
        cardinality: evidence.manifest.cardinalityDigest,
      },
      labels: {
        futurePrefix: evidence.labels.futurePrefixDigest,
        contextManifest: evidence.labels.contextManifestDigest,
        taskAssociation: evidence.labels.taskAssociationDigest,
        label: evidence.labels.labelDigest,
      },
      replay: evidence.replays.digest,
      result: first.result.resultDigest,
    }).toEqual(REAL_PIPELINE_DIGESTS);
    expect(first.result.resultDigest).toBe(second.result.resultDigest);
    expect(serializeD1Result(first.result)).toBe(serializeD1Result(second.result));
  }, 120_000);

  it('fails a replay whose projected values differ despite a copied digest', async () => {
    const run = await runFakeFullPipeline({ replayFault: 'copied-digest' });

    expect(run.result.status).toBe('runtime-fail');
    expect(run.result.failureReasons).toEqual(['nondeterministic-replay']);
  }, 120_000);

  it.each(['duplicate', 'missing', 'extra'] as const)(
    'fails a %s test projection tuple set at the one-shot freeze boundary',
    async (testProjectionFault) => {
      const run = await runFakeFullPipeline({ testProjectionFault });

      expect(run.result).toMatchObject({
        phase: 'test',
        status: 'runtime-fail',
        failureReasons: ['test-before-freeze'],
        evidence: null,
      });
      expect(run.dispatchBatches).toHaveLength(2);
    },
    120_000,
  );

  it('fails a replay batch that duplicates one task and omits another', async () => {
    const run = await runFakeFullPipeline({ replayFault: 'duplicate' });

    expect(run.result.status).toBe('runtime-fail');
    expect(run.result.failureReasons).toEqual(['worker-pool-failure']);
  }, 120_000);
});
