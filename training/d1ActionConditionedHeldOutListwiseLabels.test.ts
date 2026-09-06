import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyBoard } from '../src/engine/board';
import { createPiece } from '../src/engine/piece';
import { enumeratePlacements } from '../src/ai/placements';
import { applyAction } from '../src/ai/simulate';
import {
  aggregateD1PlacementOutcome,
  buildD1ContextTasks,
  buildD1FutureStream,
  buildD1FutureStreams,
  buildD1SubsetTarget,
  consumeD1TestLabelCapability,
  failD1TestLabelAttempt,
  materializeD1LabeledBatch,
  requireD1ContextTaskBatchAuthority,
  requireD1LabeledBatchAuthority,
  runD1Context,
  type D1AuthenticatedLabeledBatch,
  type D1ContextTaskBatch,
  type D1Split,
  type D1TestLabelAttemptCapability,
} from './d1ActionConditionedHeldOutListwiseLabels';
import { D1_BEHAVIOR_SEEDS, D1InvalidInputError, D1_VECTOR_DIGESTS, freezeD1PlacementManifest, type D1CapturedState, type D1InvalidInputReason } from './d1ActionConditionedHeldOutListwiseCore';
import { hashSeed } from '../src/ai/rng';
import type { SimResult, SimState, SimulationSearchDiagnostics } from '../src/ai/simulate';
import type { D1ContextProjection } from './d1ActionConditionedHeldOutListwiseLabels';
import type { D1FitSubset } from './d1ActionConditionedHeldOutListwiseLabels';
import * as LabelsModule from './d1ActionConditionedHeldOutListwiseLabels';
import * as FitModule from './d1ActionConditionedHeldOutListwiseFit';
import {
  D1_LAMBDAS,
  consumeD1FinalBundleForTest,
  exerciseD1FinalRefitFailureForTest,
  evaluateD1HeldOut,
  failD1FinalBundleTestAttestation,
  fitD1Representation,
  fitD1TrainingRepresentation,
  freezeD1FinalModels,
  freezeD1FinalModelsStructural,
  selectD1Lambda,
  type D1FinalModelBundle,
  type D1FitResult,
} from './d1ActionConditionedHeldOutListwiseFit';

describe('D1 fit-subset contract', () => {
  it('exposes only ordered placement features and targets to the fitter', () => {
    const subset: D1FitSubset = {
      subsetId: 'fit-contract',
      placementIds: ['p00'],
      features: [[1, 2]],
      q: [1],
    };

    expect(subset).toEqual({
      subsetId: 'fit-contract',
      placementIds: ['p00'],
      features: [[1, 2]],
      q: [1],
    });
  });
});

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const zeroSearchDiagnostics = () => ({ searchCalls: 0, holdActions: 0, holdRate: 0, meanCompletedDepth: 0, minCompletedDepth: 0,
  completedDepthHistogram: [0, 0, 0, 0, 0] as [number, number, number, number, number], totalWorkUnitsUsed: 0,
  meanWorkUnitsUsed: 0, maxWorkUnitsUsed: 0, budgetExhaustedSearches: 0, budgetExhaustionRate: 0,
  placementEvaluationUnits: 0, chanceExpansionUnits: 0, cacheHitUnits: 0, expandedDecisionNodes: 0, expandedChanceNodes: 0, cacheHits: 0 });
const projectedMeanHeight = (state: SimState): number => state.pieces === 0 ? 0 : state.heightSum / state.pieces;
const projectedStrategyDiagnostics = (state: SimState) => ({
  meanCleanWellDepth: state.pieces === 0 ? 0 : state.strategyDiagnosticSum.meanCleanWellDepth / state.pieces,
  meanTetrisSetupProgress: state.pieces === 0 ? 0 : state.strategyDiagnosticSum.meanTetrisSetupProgress / state.pieces,
  meanTetrisReadyRows: state.pieces === 0 ? 0 : state.strategyDiagnosticSum.meanTetrisReadyRows / state.pieces,
});
const finishWithInjectedPlacements = (state: SimState): SimResult => {
  while (state.status === 'playing' && state.currentPiece) {
    const nextPlacement = enumeratePlacements(state.board, state.currentPiece)[0];
    if (!nextPlacement) break;
    state.currentPiece = nextPlacement.piece;
    applyAction(state, 'hardDrop');
  }
  return {
    lines: state.lines, clearCounts: { ...state.clearCounts }, score: state.score, pieces: state.pieces,
    meanHeight: projectedMeanHeight(state), strategyDiagnostics: projectedStrategyDiagnostics(state),
    searchDiagnostics: zeroSearchDiagnostics(), reason: state.status === 'gameover' ? 'gameover' : 'pieceCap',
  };
};
const FORBIDDEN_KEY_SUBSTRINGS = ['seed', 'split', 'groupOrdinal', 'behaviorVector', 'sourceDiagnostics', 'stateFingerprint', 'sourceRun', 'fit', 'lambda', 'q', 'verdict'] as const;
const expectDeepFrozen = (value: unknown) => {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  if (Array.isArray(value)) {
    value.forEach((item) => expectDeepFrozen(item));
    return;
  }
  Object.values(value).forEach((item) => expectDeepFrozen(item));
};
const expectNoForbiddenKeys = (value: unknown) => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => expectNoForbiddenKeys(item));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    expect(FORBIDDEN_KEY_SUBSTRINGS.some((token) => lowered.includes(token.toLowerCase()))).toBe(false);
    expectNoForbiddenKeys(child);
  }
};

function expectInvalidInput(run: () => unknown, reason: D1InvalidInputReason): void {
  try {
    run();
    throw new Error('expected D1 invalid input');
  } catch (error) {
    expect(error).toBeInstanceOf(D1InvalidInputError);
    expect((error as D1InvalidInputError).reason).toBe(reason);
  }
}

type CanonicalTaskFixture = Readonly<{
  subsets: readonly ReturnType<typeof freezeD1PlacementManifest>[];
  streams: ReturnType<typeof buildD1FutureStreams>['streams'];
}>;

const CARDINALITY_FIXTURES = [
  { pieceType: 1 as const, rowMasks: [[1, 0b0010000010], [2, 0b0001111100]] as const },
  { pieceType: 2 as const, rowMasks: [] as const },
  { pieceType: 2 as const, rowMasks: [[2, 0b0000001010]] as const },
] as const;

let canonicalTaskFixtureCache: CanonicalTaskFixture | undefined;
let quickTaskFixtureCache: CanonicalTaskFixture | undefined;

function buildCanonicalTaskFixture(cardinalityAt: (subsetIndex: number) => typeof CARDINALITY_FIXTURES[number]): CanonicalTaskFixture {
  const subsets = Array.from({ length: 160 }, (_, subsetIndex) => {
    const split = subsetIndex < 80 ? 'train' as const : subsetIndex < 112 ? 'validation' as const : 'test' as const;
    const splitBase = split === 'train' ? 0 : split === 'validation' ? 80 : 112;
    const groupOrdinal = (subsetIndex - splitBase) >> 2;
    const behaviorVectorId = subsetIndex % 4 < 2 ? 'gen6-best' as const : 'gen10-mu' as const;
    const captureSlot = subsetIndex % 2 === 0 ? 128 as const : 512 as const;
    const cardinalityFixture = cardinalityAt(subsetIndex);
    const board = createEmptyBoard();
    for (const [row, mask] of cardinalityFixture.rowMasks) {
      for (let column = 0; column < 10; column++) {
        if ((mask & (1 << column)) !== 0) board[row]![column] = 7;
      }
    }
    const state = { board, current: createPiece(cardinalityFixture.pieceType), next: 3 as const,
      hold: null, holdAvailable: true, unseenBagMask: 0 };
    const score = subsetIndex;
    const stateFingerprint = digest([
      state.board, state.current.type, state.current.rotation, state.current.position.x, state.current.position.y,
      state.next, state.hold, state.holdAvailable, state.unseenBagMask, score, 0, 1, captureSlot,
    ]);
    const capture: D1CapturedState = {
      split, groupOrdinal, behaviorSeed: D1_BEHAVIOR_SEEDS[split][groupOrdinal]!, behaviorVectorId,
      behaviorVectorDigest: D1_VECTOR_DIGESTS[behaviorVectorId], captureSlot, state, score, lines: 0, level: 1,
      scheduledPieceNumber: captureSlot, sourceDiagnostics: zeroSearchDiagnostics(), stateFingerprint,
    };
    return freezeD1PlacementManifest(capture);
  });
  const entries = subsets.flatMap((subset) => {
    const behaviorVectorIndex = subset.capture.behaviorVectorId === 'gen6-best' ? 0 : 1;
    const captureSlotIndex = subset.capture.captureSlot === 128 ? 0 : 1;
    return ([0, 1] as const).map((streamIndex) => ({
      subsetId: subset.subsetId,
      labelSeed: hashSeed(20260825, 3, subset.capture.behaviorSeed, behaviorVectorIndex, captureSlotIndex, streamIndex),
      unseenBagMask: subset.capture.state.unseenBagMask,
      streamIndex,
    }));
  });
  return Object.freeze({ subsets, streams: buildD1FutureStreams({ entries }).streams });
}

function canonicalTaskFixture(): CanonicalTaskFixture {
  canonicalTaskFixtureCache ??= buildCanonicalTaskFixture((subsetIndex) => CARDINALITY_FIXTURES[subsetIndex % 3]!);
  return canonicalTaskFixtureCache;
}

function quickTaskFixture(): CanonicalTaskFixture {
  quickTaskFixtureCache ??= buildCanonicalTaskFixture(() => CARDINALITY_FIXTURES[0]);
  return quickTaskFixtureCache;
}

describe('D1 future streams', () => {
  it('continues one mulberry32 stream across the partial bag and every fresh bag', () => {
    const stream = buildD1FutureStream({ labelSeed: 123456789, unseenBagMask: 0b0101100, streamIndex: 0 });
    expect(stream.pieces).toEqual([
      6,4,3,5,1,4,3,7,2,6,3,6,4,5,2,7,1,1,7,6,2,3,5,4,7,6,5,2,4,3,1,2,
      6,7,1,5,4,3,6,7,4,5,1,2,3,4,3,1,5,2,7,6,7,2,6,4,1,3,5,3,1,4,5,2,
      6,7,5,6,1,7,3,2,4,5,2,4,1,6,3,7,5,1,2,3,4,6,7,1,6,5,7,3,2,4,6,7,
      4,2,5,3,1,7,1,3,4,6,5,2,3,7,2,1,4,6,5,4,3,5,1,7,6,2,1,5,3,2,4,6,
      7,5,2,6,4,3,7,1,4,6,7,3,5,2,1,2,4,1,5,3,6,7,3,2,7,4,5,6,1,2,7,1,
      3,4,5,6,6,2,3,1,5,7,4,2,1,3,4,6,7,5,7,5,4,2,6,3,1,4,6,7,2,3,5,1,
      7,1,5,4,2,6,3,1,7,5,3,2,4,6,6,4,7,5,2,3,1,4,1,3,2,7,5,6,4,6,5,3,
      7,2,1,5,4,3,1,2,7,6,7,3,4,6,5,2,1,6,3,2,1,7,5,4,7,5,3,6,1,4,2,1,
    ]);
    expect(stream.pieces).toHaveLength(256);
    expect(stream.digest).toBe('30e27899ee6c8f19e08a659243e8faed01209a66a1b25b89436ae6da56a81f77');
  });

  it('uses each supplied label seed directly and preserves immutable repeated output', () => {
    const zero = buildD1FutureStream({ labelSeed: 123456789, unseenBagMask: 0, streamIndex: 0 });
    const one = buildD1FutureStream({ labelSeed: 123456789, unseenBagMask: 0, streamIndex: 1 });
    expect(one.digest).toBe(zero.digest);
    expect(buildD1FutureStream({ labelSeed: 123456789, unseenBagMask: 0, streamIndex: 1 })).toEqual(one);
    expect(Object.isFrozen(one.pieces)).toBe(true);
  });

  it('freezes independent full-bag literals for mask zero and a one-bit mask', () => {
    const full = buildD1FutureStream({ labelSeed: 123456789, unseenBagMask: 0, streamIndex: 0 });
    expect(full.pieces.slice(0, 14)).toEqual([3, 7, 5, 1, 4, 6, 2, 3, 4, 7, 5, 1, 2, 6]);
    expect(full.digest).toBe('9b7bfb169dd97e213fb9325d53590c80b76cc2070cd93a2464f1bbe75c808f60');
    const oneBit = buildD1FutureStream({ labelSeed: 123456789, unseenBagMask: 1, streamIndex: 0 });
    expect(oneBit.pieces.slice(0, 14)).toEqual([1, 3, 7, 5, 1, 4, 6, 2, 3, 4, 7, 5, 1, 2]);
    expect(oneBit.digest).toBe('375f3558534634a865289030d0b1f787cdb26be7f5a3554120bb80ed91c40370');
  });

  it('rejects reordered canonical stream entries and freezes the aggregate digest literal', () => {
    const entries = Array.from({ length: 320 }, (_, index) => ({
      subsetId: `subset-${String(Math.floor(index / 2)).padStart(3, '0')}`,
      labelSeed: (() => {
        const behaviorSeeds = [...D1_BEHAVIOR_SEEDS.train, ...D1_BEHAVIOR_SEEDS.validation, ...D1_BEHAVIOR_SEEDS.test];
        const behaviorSeed = behaviorSeeds[Math.floor(index / 8)]!;
        const vectorIndex = Math.floor((index % 8) / 4);
        const slotIndex = Math.floor((index % 4) / 2);
        return hashSeed(20260825, 3, behaviorSeed, vectorIndex, slotIndex, index % 2);
      })(),
      unseenBagMask: Math.floor(index / 2) % 2 === 0 ? 0b0101100 : 0,
      streamIndex: (index % 2) as 0 | 1,
    }));
    const built = buildD1FutureStreams({ entries });
    expect(built.aggregateDigest).toBe('874e0d75a1fb06ecff6c2a22bc1e64fbc573bc1343d08e0beb89c70f519c6fb8');
    expect(built.streams).toHaveLength(320);
    expect(new Set(built.streams.map((stream) => stream.labelSeed)).size).toBe(320);
    const reordered = [...entries];
    [reordered[0], reordered[2]] = [reordered[2]!, reordered[0]!];
    expectInvalidInput(() => buildD1FutureStreams({ entries: reordered }), 'seed-schedule-mismatch');
  });
});

describe('D1 forced contexts', () => {
  it('locks the selected current-piece placement once before an injected continuation', () => {
    const board = createEmptyBoard();
    const placement = enumeratePlacements(board, createPiece(1))[0]!;
    const task = {
      taskId: 7, subsetId: 'train:0:gen6-best:128', placementId: 'A', continuationVectorId: 'gen6-best' as const,
      streamIndex: 0 as const, split: 'train' as const, groupOrdinal: 0, behaviorVectorId: 'gen6-best' as const, captureSlot: 128 as const,
      placement, weights: new Array(13).fill(0), futurePieces: buildD1FutureStream({ labelSeed: 55, unseenBagMask: 0, streamIndex: 0 }).pieces,
      capture: { state: { board, current: createPiece(1), next: 2 as const, hold: null, holdAvailable: true, unseenBagMask: 0 }, score: 10, lines: 0, level: 1 },
    };
    const result = runD1Context(task, (state) => {
      expect(state.pieces).toBe(1);
      expect(state.currentPiece?.type).toBe(2);
      expect(state.nextPiece?.type).toBeGreaterThanOrEqual(1);
      expect(state.unseenBagMask).toBeGreaterThanOrEqual(0);
      while (state.status === 'playing' && state.pieces < 128 && state.currentPiece) {
        const nextPlacement = enumeratePlacements(state.board, state.currentPiece)[0];
        if (!nextPlacement) break;
        state.currentPiece = nextPlacement.piece;
        applyAction(state, 'hardDrop');
      }
      const reason = state.status === 'gameover' ? 'gameover' as const : 'pieceCap' as const;
      return { lines: state.lines, clearCounts: { ...state.clearCounts }, score: state.score, pieces: state.pieces,
        meanHeight: projectedMeanHeight(state), strategyDiagnostics: projectedStrategyDiagnostics(state),
        searchDiagnostics: { searchCalls: 0, holdActions: 0, holdRate: 0, meanCompletedDepth: 0, minCompletedDepth: 0,
          completedDepthHistogram: [0, 0, 0, 0, 0], totalWorkUnitsUsed: 0, meanWorkUnitsUsed: 0, maxWorkUnitsUsed: 0,
          budgetExhaustedSearches: 0, budgetExhaustionRate: 0, placementEvaluationUnits: 0, chanceExpansionUnits: 0,
          cacheHitUnits: 0, expandedDecisionNodes: 0, expandedChanceNodes: 0, cacheHits: 0 }, reason };
    });
    expect(result).toMatchObject({ taskId: 7, pieces: expect.any(Number), scoreDelta: expect.any(Number), reason: expect.any(String) });
    expect(task.futurePieces).toHaveLength(256);
  });

  it('fails closed when an injected continuation claims a cap without completing it', () => {
    const board = createEmptyBoard();
    const placement = enumeratePlacements(board, createPiece(1))[0]!;
    const task = { taskId: 8, subsetId: 's', placementId: 'A', continuationVectorId: 'gen6-best' as const, streamIndex: 0 as const,
      split: 'train' as const, groupOrdinal: 0, behaviorVectorId: 'gen6-best' as const, captureSlot: 128 as const,
      placement, weights: new Array(13).fill(0), futurePieces: [3, 4, 5] as const,
      capture: { state: { board, current: createPiece(1), next: 2 as const, hold: null, holdAvailable: true, unseenBagMask: 0b1111100 }, score: 0, lines: 0, level: 1 } };
    expect(() => runD1Context(task, (state) => ({ lines: 0, clearCounts: { ...state.clearCounts }, score: state.score, pieces: 1,
      meanHeight: 0, strategyDiagnostics: { meanCleanWellDepth: 0, meanTetrisSetupProgress: 0, meanTetrisReadyRows: 0 },
      searchDiagnostics: {} as never, reason: 'pieceCap' }))).toThrow('runtime-fail: incomplete continuation');
  });

  it('consumes one preview per lock, one extra preview for the first empty Hold, and no second empty Hold', () => {
    const board = createEmptyBoard();
    const placement = enumeratePlacements(board, createPiece(1))[0]!;
    const stream = buildD1FutureStream({ labelSeed: 123456789, unseenBagMask: 0, streamIndex: 0 });
    const task = {
      taskId: 9, subsetId: 's', placementId: 'A', continuationVectorId: 'gen6-best' as const, streamIndex: 0 as const,
      split: 'train' as const, groupOrdinal: 0, behaviorVectorId: 'gen6-best' as const, captureSlot: 128 as const,
      placement, weights: new Array(13).fill(0), futurePieces: stream.pieces,
      capture: { state: { board, current: createPiece(1), next: 2 as const, hold: null, holdAvailable: true, unseenBagMask: 0 }, score: 0, lines: 0, level: 1 },
    };
    expect(() => runD1Context(task, (state) => {
      expect(state.pieces).toBe(1);
      expect(state.unseenBagMask).toBe(123);
      expect(state.bag[0]).toBe(stream.pieces[1]);
      applyAction(state, 'hold');
      expect(state.holdAvailable).toBe(false);
      expect(state.unseenBagMask).toBe(59);
      expect(state.bag[0]).toBe(stream.pieces[2]);
      applyAction(state, 'hold');
      expect(state.bag[0]).toBe(stream.pieces[2]);
      const nextPlacement = enumeratePlacements(state.board, state.currentPiece!)[0]!;
      state.currentPiece = nextPlacement.piece;
      applyAction(state, 'hardDrop');
      expect(state.pieces).toBe(2);
      expect(state.unseenBagMask).toBe(43);
      expect(state.bag[0]).toBe(stream.pieces[3]);
      applyAction(state, 'hold');
      expect(state.holdAvailable).toBe(false);
      expect(state.bag[0]).toBe(stream.pieces[3]);
      throw new Error('stop after cursor assertions');
    })).toThrow('runtime-fail: stop after cursor assertions');
  });

  it('uses an independent cursor for repeated contexts sharing one frozen stream array', () => {
    const board = createEmptyBoard();
    const placement = enumeratePlacements(board, createPiece(1))[0]!;
    const stream = buildD1FutureStream({ labelSeed: 123456789, unseenBagMask: 0, streamIndex: 0 });
    const task = {
      taskId: 10, subsetId: 's', placementId: 'A', continuationVectorId: 'gen6-best' as const, streamIndex: 0 as const,
      split: 'train' as const, groupOrdinal: 0, behaviorVectorId: 'gen6-best' as const, captureSlot: 128 as const,
      placement, weights: new Array(13).fill(0), futurePieces: stream.pieces,
      capture: { state: { board, current: createPiece(1), next: 2 as const, hold: null, holdAvailable: true, unseenBagMask: 0 }, score: 0, lines: 0, level: 1 },
    };
    const firstDraws: number[][] = [];
    const inject = (state: SimState) => {
      firstDraws.push([...state.bag.slice(0, 3)]);
      throw new Error('cursor probe');
    };
    expect(() => runD1Context(task, inject)).toThrow('runtime-fail: cursor probe');
    expect(() => runD1Context({ ...task, taskId: 11 }, inject)).toThrow('runtime-fail: cursor probe');
    expect(firstDraws).toEqual([[stream.pieces[1], stream.pieces[2], stream.pieces[3]], [stream.pieces[1], stream.pieces[2], stream.pieces[3]]]);
    expect(task.futurePieces).toEqual(stream.pieces);
  });

  it('fails closed on an evolving-mask contradiction and on frozen-stream exhaustion', () => {
    const board = createEmptyBoard();
    const placement = enumeratePlacements(board, createPiece(1))[0]!;
    const base = {
      taskId: 13, subsetId: 's', placementId: 'A', continuationVectorId: 'gen6-best' as const, streamIndex: 0 as const,
      split: 'train' as const, groupOrdinal: 0, behaviorVectorId: 'gen6-best' as const, captureSlot: 128 as const,
      placement, weights: new Array(13).fill(0),
    };
    expect(() => runD1Context({ ...base, futurePieces: [2] as const,
      capture: { state: { board, current: createPiece(1), next: 2 as const, hold: null, holdAvailable: true, unseenBagMask: 1 }, score: 0, lines: 0, level: 1 } }))
      .toThrow('runtime-fail: revealed piece contradicts public bag');
    expect(() => runD1Context({ ...base, futurePieces: [1] as const,
      capture: { state: { board, current: createPiece(1), next: 2 as const, hold: null, holdAvailable: true, unseenBagMask: 0 }, score: 0, lines: 0, level: 1 } },
    (state) => {
      const nextPlacement = enumeratePlacements(state.board, state.currentPiece!)[0]!;
      state.currentPiece = nextPlacement.piece;
      applyAction(state, 'hardDrop');
      throw new Error('unreachable after exhausted draw');
    })).toThrow('runtime-fail: frozen future stream exhausted');
  });
});

describe('D1 survival-first labels', () => {
  it.each([2, 9, 12])('keeps a K=%i target aligned to its variable-cardinality placement order', (selectedCount) => {
    const outcomes = Array.from({ length: selectedCount }, (_, i) => ({
      placementId: String.fromCharCode(65 + i),
      pieceCapContexts: 4,
      minPieces: 128,
      sumPieces: 512,
      sumScore: i === 0 ? 100 : i === 1 ? 90 : 80,
      totalTetrises: i === 0 ? 1 : i === 1 ? 2 : 1,
      totalLines: 8,
      clearCounts: { singles: i === 0 || i >= 2 ? 4 : 0, doubles: 0, triples: 0,
        tetrises: i === 0 ? 1 : i === 1 ? 2 : 1 },
    }));
    expect(buildD1SubsetTarget(outcomes)).toEqual({
      survivalOracle: [4, 128, 512],
      jointFrontPlacementIds: ['A', 'B'],
      q: [0.5, 0.5, ...new Array(selectedCount - 2).fill(0)],
    });
  });

  it('rejects target cardinalities outside the frozen K=2..12 range', () => {
    const outcome = { placementId: 'A', pieceCapContexts: 4, minPieces: 128, sumPieces: 512, sumScore: 100,
      clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 0 } };
    expect(() => buildD1SubsetTarget([outcome])).toThrow('runtime-fail: malformed placement outcome');
    expect(() => buildD1SubsetTarget(Array.from({ length: 13 }, (_, index) => ({ ...outcome, placementId: String(index) }))))
      .toThrow('runtime-fail: malformed placement outcome');
  });
});

describe('D1 placement aggregates', () => {
  it('rejects an incomplete placement instead of shrinking the scheduled denominator', () => {
    expect(() => aggregateD1PlacementOutcome('A', [{
      taskId: 0, subsetId: 's', placementId: 'A', continuationVectorId: 'gen6-best', streamIndex: 0,
      pieces: 128, scoreDelta: 100, clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 1 }, reason: 'pieceCap',
      searchDiagnostics: {} as never, projectionDigest: 'x',
    }])).toThrow('runtime-fail: incomplete context results');
  });

  it('accepts exactly the four canonical context identities independent of input order', () => {
    const diagnostic = zeroSearchDiagnostics();
    const contexts = [
      ['gen10-mu', 1, 3], ['gen6-best', 0, 0], ['gen10-mu', 0, 2], ['gen6-best', 1, 1],
    ].map(([continuationVectorId, streamIndex, taskId]) => ({
      taskId, subsetId: 's', placementId: 'A', continuationVectorId, streamIndex,
      pieces: 128, scoreDelta: 100, clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 1 }, reason: 'pieceCap',
      searchDiagnostics: diagnostic, projectionDigest: String(taskId),
    })) as D1ContextProjection[];
    expect(aggregateD1PlacementOutcome('A', contexts)).toMatchObject({
      pieceCapContexts: 4, minPieces: 128, sumPieces: 512, sumScore: 400, scoreRate: 400 / 512,
      totalTetrises: 4, totalLines: 16, tetrisNumerator: 16, tetrisDenominator: 16,
    });
    expect(() => aggregateD1PlacementOutcome('A', [contexts[0], contexts[0], contexts[2], contexts[3]]))
      .toThrow('runtime-fail: malformed context');
  });

  it('preserves the true zero Tetris denominator in a zero-line placement outcome', () => {
    const diagnostic = zeroSearchDiagnostics();
    const contexts = [
      ['gen6-best', 0, 0], ['gen6-best', 1, 1], ['gen10-mu', 0, 2], ['gen10-mu', 1, 3],
    ].map(([continuationVectorId, streamIndex, taskId]) => ({
      taskId, subsetId: 's', placementId: 'A', continuationVectorId, streamIndex,
      pieces: 128, scoreDelta: 25, clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 0 }, reason: 'pieceCap',
      searchDiagnostics: diagnostic, projectionDigest: String(taskId),
    })) as D1ContextProjection[];

    expect(aggregateD1PlacementOutcome('A', contexts)).toMatchObject({
      totalTetrises: 0,
      totalLines: 0,
      tetrisNumerator: 0,
      tetrisDenominator: 0,
      tetrisShare: 0,
    });
  });

  it('rejects caller-supplied non-canonical zero denominators before dominance', () => {
    const base = {
      pieceCapContexts: 4, minPieces: 128, sumPieces: 512,
      clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 0 },
    };
    expect(() => buildD1SubsetTarget([{ ...base, placementId: 'A', sumScore: 100,
      totalTetrises: 0, totalLines: 0, tetrisNumerator: 1, tetrisDenominator: 0 },
    { ...base, placementId: 'B', sumScore: 90, totalTetrises: 0, totalLines: 0 }]))
      .toThrow('runtime-fail: invalid tetris fraction');
  });

  it('distinguishes BigInt cross-products beyond Number precision', () => {
    const left = {
      placementId: 'A', pieceCapContexts: 4, minPieces: 128, sumPieces: 512, sumScore: 100,
      clearCounts: { singles: 96636764, doubles: 0, triples: 0, tetrises: 42949673 },
      totalLines: 268435456, totalTetrises: 42949673,
      tetrisNumerator: 171798692, tetrisDenominator: 268435456,
    };
    const right = {
      placementId: 'B', pieceCapContexts: 4, minPieces: 128, sumPieces: 512, sumScore: 100,
      clearCounts: { singles: 96636773, doubles: 0, triples: 0, tetrises: 42949677 },
      totalLines: 268435481, totalTetrises: 42949677,
      tetrisNumerator: 171798708, tetrisDenominator: 268435481,
    };
    expect(buildD1SubsetTarget([left, right]).jointFrontPlacementIds).toEqual(['A']);
  });

  it('compares 0/0 as zero share locally and lets equal-score positive fractions dominate', () => {
    const base = { pieceCapContexts: 4, minPieces: 128, sumPieces: 512 };
    const result = buildD1SubsetTarget([
      { ...base, placementId: 'A', sumScore: 100, totalTetrises: 0, totalLines: 0, tetrisNumerator: 0, tetrisDenominator: 0, clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 0 } },
      { ...base, placementId: 'B', sumScore: 100, totalTetrises: 1, totalLines: 4, tetrisNumerator: 4, tetrisDenominator: 4, clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 1 } },
    ]);
    expect(result.jointFrontPlacementIds).toEqual(['B']);
    expect(result.q).toEqual([0, 1]);
  });

  it('uses exact integer cross-products for equal fractions', () => {
    const base = { pieceCapContexts: 4, minPieces: 128, sumPieces: 512 };
    const tetrisA = 562949953421312;
    const tetrisB = 562949953421311;
    const numeratorA = 4 * tetrisA;
    const numeratorB = 4 * tetrisB;
    const result = buildD1SubsetTarget([
      { ...base, placementId: 'A', sumScore: 100, totalTetrises: tetrisA, totalLines: 2 * numeratorA,
        tetrisNumerator: numeratorA, tetrisDenominator: 2 * numeratorA,
        clearCounts: { singles: numeratorA, doubles: 0, triples: 0, tetrises: tetrisA } },
      { ...base, placementId: 'B', sumScore: 101, totalTetrises: tetrisB, totalLines: 2 * numeratorB,
        tetrisNumerator: numeratorB, tetrisDenominator: 2 * numeratorB,
        clearCounts: { singles: numeratorB, doubles: 0, triples: 0, tetrises: tetrisB } },
    ]);
    expect(result.jointFrontPlacementIds).toEqual(['B']);
  });
});

describe('D1 canonical context materialization', () => {
  it('exposes the Labels-owned authentic provenance and final-freeze crossing capabilities', () => {
    const labels = LabelsModule as typeof LabelsModule & Record<string, unknown>;
    const fit = FitModule as typeof FitModule & Record<string, unknown>;

    expect(labels.requireD1ContextTaskBatchAuthority).toBeTypeOf('function');
    expect(labels.materializeD1LabeledBatch).toBeTypeOf('function');
    expect(labels.requireD1LabeledBatchAuthority).toBeTypeOf('function');
    expect(labels.consumeD1TestLabelCapability).toBeTypeOf('function');
    expect(labels.failD1TestLabelAttempt).toBeTypeOf('function');
    expect(fit.fitD1TrainingRepresentation).toBeTypeOf('function');
    expect(fit.consumeD1FinalBundleForTest).toBeTypeOf('function');
  });

  it('fails closed unless it receives every frozen subset and both streams', () => {
    expectInvalidInput(() => buildD1ContextTasks({
      subsets: [],
      vectors: { 'gen6-best': new Array(13).fill(0), 'gen10-mu': new Array(13).fill(0) },
      streams: [],
    }), 'capture-missing-or-invalid');
  });

  it('materializes the 160-subset mixed-K schedule with independent counts, digests, and exact worker payload', () => {
    const fixture = canonicalTaskFixture();
    const built = buildD1ContextTasks({ subsets: fixture.subsets,
      vectors: { 'gen6-best': new Array(13).fill(0), 'gen10-mu': new Array(13).fill(0) }, streams: fixture.streams });
    const { tasks, evidence } = built;
    const subsetIndexById = new Map(fixture.subsets.map((subset, subsetIndex) => [subset.subsetId, subsetIndex]));
    const contextTuples: unknown[][] = [];
    const associationTuples: unknown[][] = [];
    let expectedTaskId = 0;
    for (const [subsetIndex, subset] of fixture.subsets.entries()) {
      for (const { placementId } of subset.placements) {
        for (const continuationVectorId of ['gen6-best', 'gen10-mu'] as const) {
          for (const streamIndex of [0, 1] as const) {
            const stream = fixture.streams[subsetIndex * 2 + streamIndex]!;
            const association = [expectedTaskId, subsetIndex, placementId, continuationVectorId, streamIndex];
            associationTuples.push(association);
            contextTuples.push([...association, stream.labelSeed, stream.digest]);
            expectedTaskId++;
          }
        }
      }
    }

    expect(fixture.subsets.map(({ selectedCount }) => selectedCount).filter((count) => count === 2)).toHaveLength(54);
    expect(fixture.subsets.map(({ selectedCount }) => selectedCount).filter((count) => count === 9)).toHaveLength(53);
    expect(fixture.subsets.map(({ selectedCount }) => selectedCount).filter((count) => count === 12)).toHaveLength(53);
    expect(tasks).toHaveLength(4884);
    const selectedBins = (two: number, nine: number, twelve: number) => [
      { count: 2, subsetCount: two }, { count: 3, subsetCount: 0 },
      { count: 4, subsetCount: 0 }, { count: 5, subsetCount: 0 },
      { count: 6, subsetCount: 0 }, { count: 7, subsetCount: 0 },
      { count: 8, subsetCount: 0 }, { count: 9, subsetCount: nine },
      { count: 10, subsetCount: 0 }, { count: 11, subsetCount: 0 },
      { count: 12, subsetCount: twelve },
    ];
    const splitCardinalityHistograms = [
      { split: 'train' as const, legalCountBins: [{ count: 2, subsetCount: 27 }, { count: 9, subsetCount: 27 }, { count: 13, subsetCount: 26 }], selectedCountBins: selectedBins(27, 27, 26) },
      { split: 'validation' as const, legalCountBins: [{ count: 2, subsetCount: 11 }, { count: 9, subsetCount: 10 }, { count: 13, subsetCount: 11 }], selectedCountBins: selectedBins(11, 10, 11) },
      { split: 'test' as const, legalCountBins: [{ count: 2, subsetCount: 16 }, { count: 9, subsetCount: 16 }, { count: 13, subsetCount: 16 }], selectedCountBins: selectedBins(16, 16, 16) },
    ].map((histogram) => ({ ...histogram, digest: digest([
      histogram.split, histogram.legalCountBins, histogram.selectedCountBins,
    ]) }));
    const groupTemplates = [
      { legalCountBins: [{ count: 2, subsetCount: 2 }, { count: 9, subsetCount: 1 }, { count: 13, subsetCount: 1 }], selectedCountBins: selectedBins(2, 1, 1) },
      { legalCountBins: [{ count: 2, subsetCount: 1 }, { count: 9, subsetCount: 2 }, { count: 13, subsetCount: 1 }], selectedCountBins: selectedBins(1, 2, 1) },
      { legalCountBins: [{ count: 2, subsetCount: 1 }, { count: 9, subsetCount: 1 }, { count: 13, subsetCount: 2 }], selectedCountBins: selectedBins(1, 1, 2) },
    ];
    const groupCardinalityHistograms = Array.from({ length: 40 }, (_, groupOrdinal) => {
      const template = groupTemplates[groupOrdinal % 3]!;
      return {
        groupOrdinal,
        subsetCount: 4,
        legalCountBins: template.legalCountBins,
        selectedCountBins: template.selectedCountBins,
        digest: digest([groupOrdinal, 4, template.legalCountBins, template.selectedCountBins]),
      };
    });

    expect(evidence).toEqual({
      placementCount: 1221,
      primaryContextCount: 4884,
      trainValidationContextCount: 3412,
      heldOutContextCount: 1472,
      contextManifestDigest: digest(contextTuples),
      taskAssociationDigest: digest(associationTuples),
      selectedCountHistogram: selectedBins(54, 53, 53),
      splitCardinalityHistograms,
      groupCardinalityHistograms,
    });
    expect(Object.keys(tasks[0]!)).toEqual([
      'taskId', 'subsetId', 'placementId', 'continuationVectorId', 'streamIndex',
      'capture', 'placement', 'weights', 'futurePieces',
    ]);
    expect(Object.keys(tasks[0]!.capture)).toEqual(['state', 'score', 'lines', 'level']);
    expect(Object.keys(tasks[0]!.capture.state)).toEqual(['board', 'current', 'next', 'hold', 'holdAvailable', 'unseenBagMask']);
    expect(Object.keys(tasks[0]!.capture.state.current)).toEqual(['type', 'rotation', 'position']);
    expect(Object.keys(tasks[0]!.capture.state.current.position)).toEqual(['x', 'y']);
    expectNoForbiddenKeys(tasks);
    expect(tasks.slice(0, 5).map((task) => [task.taskId, task.placementId, task.continuationVectorId, task.streamIndex])).toEqual([
      [0, fixture.subsets[0]!.placements[0]!.placementId, 'gen6-best', 0],
      [1, fixture.subsets[0]!.placements[0]!.placementId, 'gen6-best', 1],
      [2, fixture.subsets[0]!.placements[0]!.placementId, 'gen10-mu', 0],
      [3, fixture.subsets[0]!.placements[0]!.placementId, 'gen10-mu', 1],
      [4, fixture.subsets[0]!.placements[1]!.placementId, 'gen6-best', 0],
    ]);
    expect(tasks.at(-1)).toMatchObject({ taskId: 4883, subsetId: fixture.subsets.at(-1)!.subsetId,
      placementId: fixture.subsets.at(-1)!.placements.at(-1)!.placementId, continuationVectorId: 'gen10-mu', streamIndex: 1 });
    expect(tasks.map(({ taskId }) => taskId)).toEqual(Array.from({ length: 4884 }, (_, taskId) => taskId));
    expect(tasks.map((task) => [task.taskId, subsetIndexById.get(task.subsetId), task.placementId,
      task.continuationVectorId, task.streamIndex])).toEqual(associationTuples);
    const placementContextCounts = new Map<string, number>();
    for (const task of tasks) {
      const key = `${task.subsetId}\0${task.placementId}`;
      placementContextCounts.set(key, (placementContextCounts.get(key) ?? 0) + 1);
    }
    expect(placementContextCounts.size).toBe(1221);
    expect([...placementContextCounts.values()].every((count) => count === 4)).toBe(true);
    expect(new Set(tasks.map((task) => JSON.stringify([
      task.taskId, task.subsetId, task.placementId, task.continuationVectorId, task.streamIndex,
    ]))).size).toBe(4884);
    expect(tasks[0]!.capture).toBe(tasks[7]!.capture);
    expect(tasks[0]!.capture).not.toBe(tasks[8]!.capture);
    expect(tasks[0]!.capture).not.toBe(fixture.subsets[0]!.capture);
    expect(tasks[0]!.capture.state).not.toBe(fixture.subsets[0]!.capture.state);
    expect(tasks[0]!.capture.state.board).not.toBe(fixture.subsets[0]!.capture.state.board);
    tasks[0]!.capture.state.board.forEach((row, rowIndex) => expect(row).not.toBe(fixture.subsets[0]!.capture.state.board[rowIndex]));
    expect(tasks[0]!.capture.state.current).not.toBe(fixture.subsets[0]!.capture.state.current);
    expect(tasks[0]!.capture.state.current.position).not.toBe(fixture.subsets[0]!.capture.state.current.position);
    expectDeepFrozen(built);
    const projection = runD1Context(tasks[0]!, finishWithInjectedPlacements);
    expect(Object.keys(projection)).toEqual([
      'taskId', 'subsetId', 'placementId', 'continuationVectorId', 'streamIndex',
      'pieces', 'scoreDelta', 'clearCounts', 'reason', 'searchDiagnostics', 'projectionDigest',
    ]);
    expectNoForbiddenKeys(projection);
    expectDeepFrozen(projection);
    expect(projection.projectionDigest).toBe(digest({
      taskId: projection.taskId,
      subsetId: projection.subsetId,
      placementId: projection.placementId,
      continuationVectorId: projection.continuationVectorId,
      streamIndex: projection.streamIndex,
      pieces: projection.pieces,
      scoreDelta: projection.scoreDelta,
      clearCounts: projection.clearCounts,
      reason: projection.reason,
      searchDiagnostics: projection.searchDiagnostics,
    }));
  }, 45_000);

  it('rejects caller-forged legal-universe evidence before materializing any task', () => {
    const fixture = canonicalTaskFixture();
    const subsets = [...fixture.subsets];
    const original = subsets[2]!;
    const legalPlacementIds = original.legalPlacementIds.slice(0, -1);
    subsets[2] = Object.freeze({ ...original, legalCount: legalPlacementIds.length,
      legalPlacementIds: Object.freeze(legalPlacementIds), legalUniverseDigest: digest(legalPlacementIds) });
    expectInvalidInput(() => buildD1ContextTasks({ subsets,
      vectors: { 'gen6-best': new Array(13).fill(0), 'gen10-mu': new Array(13).fill(0) }, streams: fixture.streams }),
    'placement-manifest-mismatch');
  });

  it('rejects one middle canonical-subset swap', () => {
    const fixture = quickTaskFixture();
    const reordered = [...fixture.subsets];
    [reordered[79], reordered[80]] = [reordered[80]!, reordered[79]!];
    expectInvalidInput(() => buildD1ContextTasks({ subsets: reordered,
      vectors: { 'gen6-best': new Array(13).fill(0), 'gen10-mu': new Array(13).fill(0) }, streams: fixture.streams }),
    'capture-missing-or-invalid');
  }, 30_000);

  it('rejects a forged canonical-stream payload even when its digest is recomputed', () => {
    const fixture = quickTaskFixture();
    const stream = fixture.streams[0]!;
    const pieces = [...stream.pieces];
    pieces[0] = pieces[0] === 1 ? 2 : 1;
    const forged = [...fixture.streams];
    forged[0] = Object.freeze({ ...stream, pieces: Object.freeze(pieces), digest: digest(pieces) });
    expectInvalidInput(() => buildD1ContextTasks({ subsets: fixture.subsets,
      vectors: { 'gen6-best': new Array(13).fill(0), 'gen10-mu': new Array(13).fill(0) }, streams: forged }),
    'seed-schedule-mismatch');
  }, 45_000);

  it('rejects duplicate subset identities before materializing a complete dynamic task schedule', () => {
    const fixture = quickTaskFixture();
    const subsets = [...fixture.subsets];
    subsets[1] = Object.freeze({ ...subsets[1]!, subsetId: subsets[0]!.subsetId });
    expectInvalidInput(() => buildD1ContextTasks({ subsets,
      vectors: { 'gen6-best': new Array(13).fill(0), 'gen10-mu': new Array(13).fill(0) }, streams: fixture.streams }),
    'state-fingerprint-mismatch');
  });

  it('classifies vector shape and placement order at their frozen pre-pool boundaries', () => {
    const fixture = quickTaskFixture();
    expectInvalidInput(() => buildD1ContextTasks({ subsets: fixture.subsets,
      vectors: { 'gen6-best': new Array(12).fill(0), 'gen10-mu': new Array(13).fill(0) }, streams: fixture.streams }),
    'vector-identity-mismatch');

    const subsets = [...fixture.subsets];
    const placements = [...subsets[0]!.placements];
    [placements[0], placements[1]] = [placements[1]!, placements[0]!];
    subsets[0] = Object.freeze({ ...subsets[0]!, placements: Object.freeze(placements) });
    expectInvalidInput(() => buildD1ContextTasks({ subsets,
      vectors: { 'gen6-best': new Array(13).fill(0), 'gen10-mu': new Array(13).fill(0) }, streams: fixture.streams }),
    'placement-manifest-mismatch');
  });

  it('rejects swapped scalar and histogram diagnostic shapes', () => {
    const board = createEmptyBoard();
    const placement = enumeratePlacements(board, createPiece(1))[0]!;
    const task = {
      taskId: 12, subsetId: 's', placementId: 'A', continuationVectorId: 'gen6-best' as const, streamIndex: 0 as const,
      split: 'train' as const, groupOrdinal: 0, behaviorVectorId: 'gen6-best' as const, captureSlot: 128 as const,
      placement, weights: new Array(13).fill(0), futurePieces: buildD1FutureStream({ labelSeed: 55, unseenBagMask: 0, streamIndex: 0 }).pieces,
      capture: { state: { board, current: createPiece(1), next: 2 as const, hold: null, holdAvailable: true, unseenBagMask: 0 }, score: 0, lines: 0, level: 1 },
    };
    const diagnostics = { searchCalls: [0, 0, 0, 0, 0], holdActions: 0, holdRate: 0, meanCompletedDepth: 0, minCompletedDepth: 0,
      completedDepthHistogram: 0, totalWorkUnitsUsed: 0, meanWorkUnitsUsed: 0, maxWorkUnitsUsed: 0, budgetExhaustedSearches: 0,
      budgetExhaustionRate: 0, placementEvaluationUnits: 0, chanceExpansionUnits: 0, cacheHitUnits: 0, expandedDecisionNodes: 0,
      expandedChanceNodes: 0, cacheHits: 0 } as unknown as SimulationSearchDiagnostics;
    expect(() => runD1Context(task, (state) => {
      while (state.status === 'playing' && state.currentPiece) {
        const nextPlacement = enumeratePlacements(state.board, state.currentPiece)[0];
        if (!nextPlacement) break;
        state.currentPiece = nextPlacement.piece;
        applyAction(state, 'hardDrop');
      }
      return { lines: state.lines, clearCounts: { ...state.clearCounts }, score: state.score, pieces: state.pieces,
        meanHeight: 0, strategyDiagnostics: { meanCleanWellDepth: 0, meanTetrisSetupProgress: 0, meanTetrisReadyRows: 0 },
        searchDiagnostics: diagnostics, reason: 'gameover' } as SimResult;
    })).toThrow('runtime-fail');
  });

  it('rejects bad reasons, result mismatches, and missing or extra diagnostics', () => {
    const board = createEmptyBoard();
    const placement = enumeratePlacements(board, createPiece(1))[0]!;
    const task = {
      taskId: 14, subsetId: 's', placementId: 'A', continuationVectorId: 'gen6-best' as const, streamIndex: 0 as const,
      split: 'train' as const, groupOrdinal: 0, behaviorVectorId: 'gen6-best' as const, captureSlot: 128 as const,
      placement, weights: new Array(13).fill(0), futurePieces: buildD1FutureStream({ labelSeed: 55, unseenBagMask: 0, streamIndex: 0 }).pieces,
      capture: { state: { board, current: createPiece(1), next: 2 as const, hold: null, holdAvailable: true, unseenBagMask: 0 }, score: 0, lines: 0, level: 1 },
    };
    const mutations: readonly ((result: SimResult) => SimResult)[] = [
      (result) => ({ ...result, reason: 'abort' } as unknown as SimResult),
      (result) => ({ ...result, score: result.score + 1 }),
      (result) => ({ ...result, lines: result.lines + 1 }),
      (result) => ({ ...result, clearCounts: { ...result.clearCounts, singles: result.clearCounts.singles + 1 } }),
      (result) => ({ ...result, searchDiagnostics: {} as SimulationSearchDiagnostics }),
      (result) => ({ ...result, searchDiagnostics: { ...result.searchDiagnostics, extra: 0 } as unknown as SimulationSearchDiagnostics }),
      (result) => {
        const missing: Partial<SimulationSearchDiagnostics> = { ...result.searchDiagnostics };
        delete missing.cacheHits;
        return { ...result, searchDiagnostics: missing as SimulationSearchDiagnostics };
      },
      (result) => ({ ...result, meanHeight: Number.NaN }),
      (result) => ({ ...result, strategyDiagnostics: { ...result.strategyDiagnostics, extra: 0 } as unknown as SimResult['strategyDiagnostics'] }),
    ];
    for (const mutate of mutations) {
      expect(() => runD1Context(task, (state) => mutate(finishWithInjectedPlacements(state)))).toThrow('runtime-fail');
    }
  });
});

function projectionsForSplit(
  contextBatch: D1ContextTaskBatch,
  fixture: CanonicalTaskFixture,
  split: D1Split,
): D1ContextProjection[] {
  const [start, end] = split === 'train' ? [0, 80] : split === 'validation' ? [80, 112] : [112, 160];
  const subsetIds = new Set(fixture.subsets.slice(start, end).map(({ subsetId }) => subsetId));
  return contextBatch.tasks.filter(({ subsetId }) => subsetIds.has(subsetId)).map((task) => {
    const projection = {
      taskId: task.taskId,
      subsetId: task.subsetId,
      placementId: task.placementId,
      continuationVectorId: task.continuationVectorId,
      streamIndex: task.streamIndex,
      pieces: 128,
      scoreDelta: 25,
      clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 0 },
      reason: 'pieceCap' as const,
      searchDiagnostics: zeroSearchDiagnostics(),
    };
    return { ...projection, projectionDigest: digest(projection) };
  });
}

function buildAuthenticatedRun(fixture: CanonicalTaskFixture): Readonly<{
  contextBatch: D1ContextTaskBatch;
  train: D1AuthenticatedLabeledBatch;
  validation: D1AuthenticatedLabeledBatch;
  testProjections: readonly D1ContextProjection[];
}> {
  const contextBatch = buildD1ContextTasks({
    subsets: fixture.subsets,
    vectors: { 'gen6-best': new Array(13).fill(0), 'gen10-mu': new Array(13).fill(0) },
    streams: fixture.streams,
  });
  const train = materializeD1LabeledBatch({
    contextBatch,
    split: 'train',
    projections: projectionsForSplit(contextBatch, fixture, 'train'),
  });
  const validation = materializeD1LabeledBatch({
    contextBatch,
    split: 'validation',
    projections: projectionsForSplit(contextBatch, fixture, 'validation'),
  });
  return { contextBatch, train, validation, testProjections: projectionsForSplit(contextBatch, fixture, 'test') };
}

function fitAuthenticatedRun(run: ReturnType<typeof buildAuthenticatedRun>): Readonly<{
  afterstate13Fits: readonly D1FitResult[];
  action24Fits: readonly D1FitResult[];
  finalModels: D1FinalModelBundle;
}> {
  const selections = selectAuthenticatedRun(run);
  return {
    afterstate13Fits: selections.afterstate13Fits,
    action24Fits: selections.action24Fits,
    finalModels: freezeD1FinalModels({ selections: selections.selections, train: run.train, validation: run.validation }),
  };
}

function selectAuthenticatedRun(run: ReturnType<typeof buildAuthenticatedRun>) {
  const afterstate13Fits = D1_LAMBDAS.map((lambda) => fitD1TrainingRepresentation({
    representationId: 'afterstate13', lambda, train: run.train,
  }));
  const action24Fits = D1_LAMBDAS.map((lambda) => fitD1TrainingRepresentation({
    representationId: 'action24', lambda, train: run.train,
  }));
  const selections = {
    afterstate13: selectD1Lambda({ representationId: 'afterstate13', fits: afterstate13Fits, validation: run.validation }),
    action24: selectD1Lambda({ representationId: 'action24', fits: action24Fits, validation: run.validation }),
  };
  return { afterstate13Fits, action24Fits, selections };
}

describe('D1 authenticated provenance crossing', () => {
  it('rejects mutable authenticated training fits while preserving exact-five selection', () => {
    const run = buildAuthenticatedRun(quickTaskFixture());
    const fits = D1_LAMBDAS.map((lambda) => fitD1TrainingRepresentation({
      representationId: 'afterstate13', lambda, train: run.train,
    }));
    const authenticFit = fits[0]!;
    const rawFit = fitD1Representation({
      representationId: 'afterstate13',
      lambda: authenticFit.lambda,
      subsets: run.train.subsets.map((subset, subsetIndex) => ({
        subsetId: subset.subsetId,
        placementIds: subset.placementIds,
        features: subset.afterstate13.map((row, placementIndex) => row.map((value, dimension) =>
          value + (subsetIndex === 0 && placementIndex === 0 && dimension === 0 ? 4096 : 0))),
        q: subset.q,
      })),
    });
    const authenticBytes = Buffer.from(JSON.stringify(authenticFit), 'utf8');
    expect(Buffer.from(JSON.stringify(rawFit), 'utf8')).not.toEqual(authenticBytes);

    const attemptMutation = (mutate: () => void): unknown => {
      try {
        mutate();
        return undefined;
      } catch (error) {
        return error;
      }
    };
    const topLevelMutation = attemptMutation(() => { Object.assign(authenticFit, rawFit); });
    const weightsMutation = attemptMutation(() => { Object.assign(authenticFit.weights, rawFit.weights); });
    const meanMutation = attemptMutation(() => {
      Object.assign(authenticFit.normalization.mean, rawFit.normalization.mean);
    });
    const stdMutation = attemptMutation(() => {
      Object.assign(authenticFit.normalization.std, rawFit.normalization.std);
    });

    expect(topLevelMutation).toBeInstanceOf(TypeError);
    expect(weightsMutation).toBeInstanceOf(TypeError);
    expect(meanMutation).toBeInstanceOf(TypeError);
    expect(stdMutation).toBeInstanceOf(TypeError);
    expect(Buffer.from(JSON.stringify(authenticFit), 'utf8')).toEqual(authenticBytes);
    expect(() => selectD1Lambda({
      representationId: 'afterstate13', fits, validation: run.validation,
    })).not.toThrow();
  }, 120_000);

  it('keeps the authenticated final fitter fixed while failure evidence remains terminal', () => {
    const run = buildAuthenticatedRun(quickTaskFixture());
    const { selections } = selectAuthenticatedRun(run);
    const fitRepresentation = vi.fn((input: Parameters<typeof fitD1Representation>[0]) => fitD1Representation(input));
    const input = {
      selections,
      train: run.train,
      validation: run.validation,
      fitRepresentation,
    };

    const finalModels = freezeD1FinalModels(input);

    expect(fitRepresentation).not.toHaveBeenCalled();
    expect(() => consumeD1FinalBundleForTest(
      finalModels,
      requireD1ContextTaskBatchAuthority(run.contextBatch).runIdentity,
    )).not.toThrow();
  }, 120_000);

  it('makes a failed second-representation final refit terminal before the first fitter can repeat', () => {
    const run = buildAuthenticatedRun(quickTaskFixture());
    const { selections } = selectAuthenticatedRun(run);
    const failure = exerciseD1FinalRefitFailureForTest({
      selections,
      train: run.train,
      validation: run.validation,
    });
    expect(failure).toEqual({
      attemptedRepresentations: ['afterstate13', 'action24'],
      firstRefitReentryError: 'final model freeze already in flight',
    });
    expect(Object.isFrozen(failure)).toBe(true);
    expect(Object.isFrozen(failure.attemptedRepresentations)).toBe(true);
    expect(() => freezeD1FinalModels({ selections, train: run.train, validation: run.validation }))
      .toThrow('final model run already failed');

    const succeedingRun = buildAuthenticatedRun(quickTaskFixture());
    const { selections: succeedingSelections } = selectAuthenticatedRun(succeedingRun);
    const finalModels = freezeD1FinalModels({
      selections: succeedingSelections,
      train: succeedingRun.train,
      validation: succeedingRun.validation,
    });
    expect(() => consumeD1FinalBundleForTest(
      finalModels,
      requireD1ContextTaskBatchAuthority(succeedingRun.contextBatch).runIdentity,
    )).not.toThrow();
  }, 120_000);

  it('rejects a structural injected-fitter bundle without consuming Labels state', () => {
    const run = buildAuthenticatedRun(quickTaskFixture());
    const { selections } = selectAuthenticatedRun(run);
    const fitSubsets = (batch: D1AuthenticatedLabeledBatch, representationId: 'afterstate13' | 'action24'): D1FitSubset[] =>
      batch.subsets.map((subset) => ({
        subsetId: subset.subsetId,
        placementIds: subset.placementIds,
        features: subset[representationId],
        q: subset.q,
      }));
    const fitRepresentation = vi.fn((input: Parameters<typeof fitD1Representation>[0]) => fitD1Representation(input));
    const structural = freezeD1FinalModelsStructural({
      selections,
      train: {
        afterstate13: fitSubsets(run.train, 'afterstate13'),
        action24: fitSubsets(run.train, 'action24'),
      },
      validation: {
        afterstate13: fitSubsets(run.validation, 'afterstate13'),
        action24: fitSubsets(run.validation, 'action24'),
      },
      fitRepresentation,
    });

    expect(fitRepresentation).toHaveBeenCalledTimes(2);
    expect(() => consumeD1TestLabelCapability(structural, run.contextBatch))
      .toThrow('unrecognized authenticated model freeze capability');

    const authenticated = freezeD1FinalModels({ selections, train: run.train, validation: run.validation });
    expect(() => consumeD1TestLabelCapability(authenticated, run.contextBatch)).not.toThrow();
  }, 120_000);

  it('rejects copied context/labeled capabilities, derives true split, and consumes each split once', () => {
    const fixture = quickTaskFixture();
    const contextBatch = buildD1ContextTasks({
      subsets: fixture.subsets,
      vectors: { 'gen6-best': new Array(13).fill(0), 'gen10-mu': new Array(13).fill(0) },
      streams: fixture.streams,
    });
    const contextCopies = [
      { tasks: contextBatch.tasks, evidence: contextBatch.evidence },
      { ...contextBatch },
      JSON.parse(JSON.stringify(contextBatch)),
      { tasks: [...contextBatch.tasks], evidence: { ...contextBatch.evidence } },
      { ...contextBatch, tasks: contextBatch.tasks.map((task, index) => index === 0 ? { ...task, split: 'test' } : task) },
    ];
    for (const copied of contextCopies) {
      expect(() => requireD1ContextTaskBatchAuthority(copied as D1ContextTaskBatch))
        .toThrow('unrecognized context batch capability');
      expect(() => materializeD1LabeledBatch({
        contextBatch: copied as D1ContextTaskBatch,
        split: 'train',
        projections: projectionsForSplit(contextBatch, fixture, 'train'),
      })).toThrow('unrecognized context batch capability');
    }

    const train = materializeD1LabeledBatch({
      contextBatch,
      split: 'train',
      projections: projectionsForSplit(contextBatch, fixture, 'train'),
    });
    expect(train.split).toBe('train');
    expect(train.subsets).toHaveLength(80);
    expect(() => requireD1LabeledBatchAuthority(train, 'train')).not.toThrow();
    for (const copied of [
      { ...train },
      JSON.parse(JSON.stringify(train)),
      { split: 'train', subsets: train.subsets, batchDigest: train.batchDigest, labelProjectionDigest: train.labelProjectionDigest },
    ]) {
      expect(() => requireD1LabeledBatchAuthority(copied as D1AuthenticatedLabeledBatch, 'train'))
        .toThrow('unrecognized labeled batch capability');
      expect(() => fitD1TrainingRepresentation({
        representationId: 'afterstate13', lambda: D1_LAMBDAS[0], train: copied as D1AuthenticatedLabeledBatch,
      })).toThrow('unrecognized labeled batch capability');
    }
    expect(() => requireD1LabeledBatchAuthority(train, 'validation')).toThrow('unrecognized labeled batch capability');
    expect(() => materializeD1LabeledBatch({
      contextBatch,
      split: 'train',
      projections: projectionsForSplit(contextBatch, fixture, 'train'),
    })).toThrow('split already materialized');
    expect(() => materializeD1LabeledBatch({
      contextBatch,
      split: 'test',
      projections: projectionsForSplit(contextBatch, fixture, 'test'),
    })).toThrow('test attempt required');
    expect(() => materializeD1LabeledBatch({
      contextBatch,
      split: 'test',
      projections: projectionsForSplit(contextBatch, fixture, 'test'),
      testAttempt: { kind: 'd1-test-label-attempt' },
    })).toThrow('unrecognized test attempt capability');
  }, 120_000);

  it('binds exact-five fits and one final bundle to one run, then crosses test once without retry', () => {
    const fixture = quickTaskFixture();
    const runA = buildAuthenticatedRun(fixture);
    const runB = buildAuthenticatedRun(fixture);
    const aAfter = D1_LAMBDAS.map((lambda) => fitD1TrainingRepresentation({
      representationId: 'afterstate13', lambda, train: runA.train,
    }));
    const aAction = D1_LAMBDAS.map((lambda) => fitD1TrainingRepresentation({
      representationId: 'action24', lambda, train: runA.train,
    }));
    const bAfter = D1_LAMBDAS.map((lambda) => fitD1TrainingRepresentation({
      representationId: 'afterstate13', lambda, train: runB.train,
    }));
    const bAction = D1_LAMBDAS.map((lambda) => fitD1TrainingRepresentation({
      representationId: 'action24', lambda, train: runB.train,
    }));

    expect(() => fitD1TrainingRepresentation({
      representationId: 'afterstate13', lambda: D1_LAMBDAS[0], train: runA.train,
    })).toThrow('duplicate authenticated training fit');
    expect(() => selectD1Lambda({
      representationId: 'afterstate13', fits: aAfter.slice(0, 4), validation: runA.validation,
    })).toThrow('exact five authenticated fits are required');
    expect(() => selectD1Lambda({
      representationId: 'afterstate13', fits: [aAfter[0]!, aAfter[1]!, aAfter[2]!, aAfter[3]!, aAfter[0]!],
      validation: runA.validation,
    })).toThrow('duplicate representation lambda tuple');
    expect(() => selectD1Lambda({
      representationId: 'afterstate13', fits: [...aAfter.slice(0, 4), bAfter[4]!], validation: runA.validation,
    })).toThrow('unrecognized authenticated training fit');
    expect(() => selectD1Lambda({
      representationId: 'afterstate13', fits: [...aAfter.slice(0, 4), { ...aAfter[4]! }], validation: runA.validation,
    })).toThrow('unrecognized authenticated training fit');
    expect(() => selectD1Lambda({
      representationId: 'afterstate13', fits: aAfter, validation: { ...runA.validation },
    })).toThrow('unrecognized labeled batch capability');
    expect(() => selectD1Lambda({
      representationId: 'afterstate13', fits: aAfter, validation: runB.validation,
    })).toThrow('unrecognized authenticated training fit');
    expect(() => selectD1Lambda({
      representationId: 'afterstate13',
      fits: D1_LAMBDAS.map((lambda) => fitD1Representation({
        representationId: 'afterstate13', lambda,
        subsets: runA.train.subsets.map((subset) => ({
          subsetId: subset.subsetId, placementIds: subset.placementIds, features: subset.afterstate13, q: subset.q,
        })),
      })),
      validation: runA.validation,
    })).toThrow('unrecognized authenticated training fit');

    const aSelections = {
      afterstate13: selectD1Lambda({ representationId: 'afterstate13', fits: aAfter, validation: runA.validation }),
      action24: selectD1Lambda({ representationId: 'action24', fits: aAction, validation: runA.validation }),
    };
    const bSelections = {
      afterstate13: selectD1Lambda({ representationId: 'afterstate13', fits: bAfter, validation: runB.validation }),
      action24: selectD1Lambda({ representationId: 'action24', fits: bAction, validation: runB.validation }),
    };
    expect(() => consumeD1TestLabelCapability({ models: {} } as D1FinalModelBundle, runA.contextBatch))
      .toThrow('unrecognized authenticated model freeze capability');
    expect(() => freezeD1FinalModels({ selections: aSelections, train: runB.train, validation: runA.validation }))
      .toThrow('final model run mismatch');
    const finalA = freezeD1FinalModels({ selections: aSelections, train: runA.train, validation: runA.validation });
    const finalB = freezeD1FinalModels({ selections: bSelections, train: runB.train, validation: runB.validation });
    expect(() => freezeD1FinalModels({ selections: aSelections, train: runA.train, validation: runA.validation }))
      .toThrow('final model run already materialized');
    expect(() => consumeD1TestLabelCapability({ ...finalA }, runA.contextBatch))
      .toThrow('unrecognized authenticated model freeze capability');
    expect(() => consumeD1TestLabelCapability(finalA, runB.contextBatch)).toThrow('test-before-freeze');

    const attemptA = consumeD1TestLabelCapability(finalA, runA.contextBatch);
    expect(() => consumeD1FinalBundleForTest(finalA, requireD1ContextTaskBatchAuthority(runA.contextBatch).runIdentity))
      .toThrow('test-before-freeze');
    for (const copied of [
      { ...attemptA },
      JSON.parse(JSON.stringify(attemptA)),
      { kind: 'd1-test-label-attempt' },
      Object.freeze({ kind: 'd1-test-label-attempt' }),
    ]) {
      expect(() => materializeD1LabeledBatch({
        contextBatch: runA.contextBatch,
        split: 'test',
        projections: runA.testProjections,
        testAttempt: copied as D1TestLabelAttemptCapability,
      })).toThrow('unrecognized test attempt capability');
    }
    expect(() => materializeD1LabeledBatch({
      contextBatch: runA.contextBatch,
      split: 'validation',
      projections: [],
      testAttempt: attemptA,
    })).toThrow();
    const unusedContext = buildD1ContextTasks({
      subsets: fixture.subsets,
      vectors: { 'gen6-best': new Array(13).fill(0), 'gen10-mu': new Array(13).fill(0) },
      streams: fixture.streams,
    });
    expect(() => materializeD1LabeledBatch({
      contextBatch: unusedContext,
      split: 'train',
      projections: projectionsForSplit(unusedContext, fixture, 'train'),
      testAttempt: attemptA,
    })).toThrow('test attempt on non-test split');

    const attemptB = consumeD1TestLabelCapability(finalB, runB.contextBatch);
    expect(() => materializeD1LabeledBatch({
      contextBatch: runA.contextBatch,
      split: 'test',
      projections: runA.testProjections,
      testAttempt: attemptB,
    })).toThrow('unrecognized test attempt capability');
    expect(() => failD1FinalBundleTestAttestation({ kind: 'd1-final-bundle-test-attestation' }))
      .toThrow('unrecognized final bundle test attestation');

    const testA = materializeD1LabeledBatch({
      contextBatch: runA.contextBatch,
      split: 'test',
      projections: runA.testProjections,
      testAttempt: attemptA,
    });
    expect(() => fitD1TrainingRepresentation({
      representationId: 'afterstate13', lambda: D1_LAMBDAS[0], train: testA,
    })).toThrow('unrecognized labeled batch capability');
    expect(() => evaluateD1HeldOut({ ...finalA }, testA)).toThrow('unrecognized authenticated model freeze capability');
    expect(() => evaluateD1HeldOut(finalB, testA)).toThrow('test-before-freeze');
    expect(() => evaluateD1HeldOut(finalA, runA.train)).toThrow('unrecognized labeled batch capability');
    for (const copied of [
      { ...testA },
      JSON.parse(JSON.stringify(testA)),
      { split: 'test', subsets: testA.subsets, batchDigest: testA.batchDigest, labelProjectionDigest: testA.labelProjectionDigest },
    ]) {
      expect(() => evaluateD1HeldOut(finalA, copied as D1AuthenticatedLabeledBatch))
        .toThrow('unrecognized labeled batch capability');
    }
    const heldOut = evaluateD1HeldOut(finalA, testA);
    expect(heldOut.status).not.toBe('runtime-fail');
    expect(heldOut.cardinalityMetrics).toHaveLength(11);
    expect(() => evaluateD1HeldOut(finalA, testA)).toThrow('test-before-freeze');
    expect(() => materializeD1LabeledBatch({
      contextBatch: runA.contextBatch,
      split: 'test',
      projections: runA.testProjections,
      testAttempt: attemptA,
    })).toThrow();

    const originalFailure = failD1FinalBundleTestAttestation;
    const failureHook = vi.spyOn(FitModule, 'failD1FinalBundleTestAttestation').mockImplementationOnce((attestation) => {
      originalFailure(attestation);
      throw new Error('injected failure hook');
    });
    expect(() => failD1TestLabelAttempt(attemptB))
      .toThrow('runtime-fail: cleanup: test-before-freeze: failure-crossing');
    failureHook.mockRestore();
    expect(() => failD1TestLabelAttempt(attemptB)).toThrow('unrecognized test attempt capability');
    expect(() => consumeD1TestLabelCapability(finalB, runB.contextBatch)).toThrow('test attempt already consumed');
    expect(() => consumeD1FinalBundleForTest(finalB, requireD1ContextTaskBatchAuthority(runB.contextBatch).runIdentity))
      .toThrow('test-before-freeze');
  }, 180_000);

  it('authenticates final-bundle attestations by identity and makes direct failure terminal', () => {
    const fixture = quickTaskFixture();
    const run = buildAuthenticatedRun(fixture);
    const { finalModels } = fitAuthenticatedRun(run);
    const foreignContext = buildD1ContextTasks({
      subsets: fixture.subsets,
      vectors: { 'gen6-best': new Array(13).fill(0), 'gen10-mu': new Array(13).fill(0) },
      streams: fixture.streams,
    });
    expect(() => consumeD1FinalBundleForTest(
      finalModels,
      requireD1ContextTaskBatchAuthority(foreignContext).runIdentity,
    )).toThrow('test-before-freeze');

    const attestation = consumeD1FinalBundleForTest(
      finalModels,
      requireD1ContextTaskBatchAuthority(run.contextBatch).runIdentity,
    );
    for (const copied of [
      { ...attestation },
      JSON.parse(JSON.stringify(attestation)),
      { kind: 'd1-final-bundle-test-attestation' },
      Object.freeze({ kind: 'd1-final-bundle-test-attestation' }),
    ]) {
      expect(() => failD1FinalBundleTestAttestation(copied as typeof attestation))
        .toThrow('unrecognized final bundle test attestation');
    }
    expect(() => failD1FinalBundleTestAttestation(attestation)).not.toThrow();
    expect(() => failD1FinalBundleTestAttestation(attestation))
      .toThrow('unrecognized final bundle test attestation');
    expect(() => consumeD1FinalBundleForTest(
      finalModels,
      requireD1ContextTaskBatchAuthority(run.contextBatch).runIdentity,
    )).toThrow('test-before-freeze');
    expect(() => consumeD1TestLabelCapability(finalModels, run.contextBatch)).toThrow('test-before-freeze');
  }, 180_000);
});
