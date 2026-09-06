import { createHash } from 'node:crypto';
import { hashSeed, mulberry32 } from '../src/ai/rng';
import { applyAction, createFrozenContinuationState, simulateFromState, type FrozenContinuationCapture, type SimResult, type SimulationSearchDiagnostics } from '../src/ai/simulate';
import type { PieceType } from '../src/types';
import type { LineClearCounts } from '../src/ai/lineClears';
import {
  D1InvalidInputError,
  D1_VECTOR_DIGESTS,
  freezeD1PlacementManifest,
  type D1FrozenSubset,
  type D1VectorId,
} from './d1ActionConditionedHeldOutListwiseCore';
import { D1_PROFILE, flattenBehaviorSeeds, type ListwiseProtocolProfile } from './d2Protocol';
import type { Placement } from '../src/ai/placements';
import {
  consumeD1FinalBundleForTest,
  D1PipelineRuntimeError,
  failD1FinalBundleTestAttestation,
  type D1FinalBundleTestAttestation,
  type D1FinalModelBundle,
} from './d1ActionConditionedHeldOutListwiseFit';

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const pieceTypes = [1, 2, 3, 4, 5, 6, 7] as const;
function assertPiece(piece: number): asserts piece is PieceType {
  if (!Number.isInteger(piece) || piece < 1 || piece > 7) throw new D1InvalidInputError('seed-schedule-mismatch');
}

export interface D1FutureStream {
  readonly labelSeed: number;
  readonly streamIndex: 0 | 1;
  readonly pieces: readonly PieceType[];
  readonly digest: string;
}

export interface D1SubsetFutureStream extends D1FutureStream {
  readonly subsetId: string;
}

export interface D1FitSubset {
  readonly subsetId: string;
  readonly placementIds: readonly string[];
  readonly features: readonly (readonly number[])[];
  readonly q: readonly number[];
}

export function buildD1FutureStream(input: {
  labelSeed: number;
  unseenBagMask: number;
  streamIndex: 0 | 1;
}): D1FutureStream {
  if (!Number.isInteger(input.labelSeed) || !Number.isInteger(input.unseenBagMask) || input.unseenBagMask < 0 || input.unseenBagMask > 0x7f ||
    (input.streamIndex !== 0 && input.streamIndex !== 1)) {
    throw new D1InvalidInputError('seed-schedule-mismatch');
  }
  const rng = mulberry32(input.labelSeed);
  const firstBag: PieceType[] = input.unseenBagMask === 0
    ? [...pieceTypes]
    : pieceTypes.filter((piece) => (input.unseenBagMask & (1 << (piece - 1))) !== 0);
  if (firstBag.length === 0) throw new D1InvalidInputError('seed-schedule-mismatch');
  const pieces: PieceType[] = [];
  const shuffle = (bag: PieceType[]) => {
    for (let i = bag.length - 1; i >= 1; i--) {
      const j = Math.floor(rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
    for (const piece of bag) { assertPiece(piece); pieces.push(piece); if (pieces.length === 256) break; }
  };
  shuffle(firstBag);
  while (pieces.length < 256) shuffle([...pieceTypes]);
  return freeze({ labelSeed: input.labelSeed, streamIndex: input.streamIndex, pieces, digest: digest(pieces) });
}

export function buildD1FutureStreams(input: {
  readonly entries: readonly { subsetId: string; labelSeed: number; unseenBagMask: number; streamIndex: 0 | 1 }[];
  readonly profile?: ListwiseProtocolProfile;
}): Readonly<{ streams: readonly D1SubsetFutureStream[]; aggregateDigest: string }> {
  if (input.entries.length !== 320) throw new D1InvalidInputError('seed-schedule-mismatch');
  const profile = input.profile ?? D1_PROFILE;
  const behaviorSeeds = flattenBehaviorSeeds(profile);
  const expectedSeeds = behaviorSeeds.flatMap((behaviorSeed) =>
    [0, 1].flatMap((behaviorVectorIndex) => [0, 1].flatMap((captureSlotIndex) => [0, 1].map((streamIndex) =>
      hashSeed(profile.baseSeed, 3, behaviorSeed, behaviorVectorIndex, captureSlotIndex, streamIndex)))));
  if (digest(expectedSeeds) !== profile.labelSeedDigest) throw new D1InvalidInputError('seed-schedule-mismatch');
  const seenSeeds = new Set<number>(); const seenDigests = new Set<string>();
  const seenCoordinates = new Set<string>(); const seenSubsets = new Set<string>();
  const streams: D1SubsetFutureStream[] = [];
  for (const [entryIndex, entry] of input.entries.entries()) {
    const subsetIndex = Math.floor(entryIndex / 2);
    const expectedStreamIndex = (entryIndex % 2) as 0 | 1;
    const pair = input.entries[subsetIndex * 2];
    if (entry.streamIndex !== expectedStreamIndex || entry.labelSeed !== expectedSeeds[entryIndex] ||
      typeof entry.subsetId !== 'string' || entry.subsetId.length === 0 || pair?.subsetId !== entry.subsetId ||
      pair.unseenBagMask !== entry.unseenBagMask || (expectedStreamIndex === 0 && seenSubsets.has(entry.subsetId))) {
      throw new D1InvalidInputError('seed-schedule-mismatch');
    }
    if (expectedStreamIndex === 0) seenSubsets.add(entry.subsetId);
    const stream = freeze({ ...buildD1FutureStream(entry), subsetId: entry.subsetId });
    const coordinate = `${entry.subsetId}:${entry.streamIndex}`;
    if (seenSeeds.has(stream.labelSeed) || seenDigests.has(stream.digest) || seenCoordinates.has(coordinate)) {
      throw new D1InvalidInputError('seed-schedule-mismatch');
    }
    seenSeeds.add(stream.labelSeed); seenDigests.add(stream.digest); seenCoordinates.add(coordinate);
    streams.push(stream);
  }
  if (seenSeeds.size !== 320 || seenDigests.size !== 320 || seenCoordinates.size !== 320 || seenSubsets.size !== 160) {
    throw new D1InvalidInputError('seed-schedule-mismatch');
  }
  return freeze({ streams, aggregateDigest: digest(streams.map((stream) => stream.digest)) });
}

export interface D1ContinuationCapture {
  readonly state: FrozenContinuationCapture['state'];
  readonly score: number;
  readonly lines: number;
  readonly level: number;
}
export interface D1ContextTask {
  readonly taskId: number;
  readonly subsetId: string;
  readonly placementId: string;
  readonly continuationVectorId: D1VectorId;
  readonly streamIndex: 0 | 1;
  readonly capture: D1ContinuationCapture;
  readonly placement: Placement;
  readonly weights: readonly number[];
  readonly futurePieces: readonly PieceType[];
}
export interface D1ContextProjection {
  readonly taskId: number;
  readonly subsetId: string;
  readonly placementId: string;
  readonly continuationVectorId: D1VectorId;
  readonly streamIndex: 0 | 1;
  readonly pieces: number;
  readonly scoreDelta: number;
  readonly clearCounts: LineClearCounts;
  readonly reason: 'pieceCap' | 'gameover';
  readonly searchDiagnostics: SimulationSearchDiagnostics;
  readonly projectionDigest: string;
}

export interface D1CountHistogramBin {
  readonly count: number;
  readonly subsetCount: number;
}

export interface D1SplitCardinalityHistogram {
  readonly split: D1Split;
  readonly legalCountBins: readonly D1CountHistogramBin[];
  readonly selectedCountBins: readonly D1CountHistogramBin[];
  readonly digest: string;
}

export interface D1GroupCardinalityHistogram {
  readonly groupOrdinal: number;
  readonly subsetCount: 4;
  readonly legalCountBins: readonly D1CountHistogramBin[];
  readonly selectedCountBins: readonly D1CountHistogramBin[];
  readonly digest: string;
}

export interface D1ContextManifestEvidence {
  readonly placementCount: number;
  readonly primaryContextCount: number;
  readonly trainValidationContextCount: number;
  readonly heldOutContextCount: number;
  readonly contextManifestDigest: string;
  readonly taskAssociationDigest: string;
  readonly selectedCountHistogram: readonly D1CountHistogramBin[];
  readonly splitCardinalityHistograms: readonly D1SplitCardinalityHistogram[];
  readonly groupCardinalityHistograms: readonly D1GroupCardinalityHistogram[];
}

export type D1Split = 'train' | 'validation' | 'test';

export interface D1ContextTaskBatch {
  readonly tasks: readonly D1ContextTask[];
  readonly evidence: D1ContextManifestEvidence;
}

function countHistogram(values: readonly number[], completeSelectedRange = false): readonly D1CountHistogramBin[] {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const keys = completeSelectedRange
    ? Array.from({ length: 11 }, (_, index) => index + 2)
    : [...counts.keys()].sort((left, right) => left - right);
  return freeze(keys.map((count) => freeze({ count, subsetCount: counts.get(count) ?? 0 })));
}

export interface D1LabeledSubsetProjection {
  readonly subsetId: string;
  readonly groupOrdinal: number;
  readonly placementIds: readonly string[];
  readonly afterstate13: readonly (readonly number[])[];
  readonly action24: readonly (readonly number[])[];
  readonly outcomes: readonly D1PlacementOutcome[];
  readonly survivalOracle: readonly [number, number, number];
  readonly jointFrontPlacementIds: readonly string[];
  readonly q: readonly number[];
}

export interface D1AuthenticatedLabeledBatch {
  readonly split: D1Split;
  readonly subsets: readonly D1LabeledSubsetProjection[];
  readonly batchDigest: string;
  readonly labelProjectionDigest: string;
}

export interface D1OpaqueRunIdentity {
  readonly kind: 'd1-run-identity';
}

export interface D1ContextTaskBatchAuthority {
  readonly runIdentity: D1OpaqueRunIdentity;
  readonly contextBatch: D1ContextTaskBatch;
}

export interface D1LabeledBatchAuthority {
  readonly runIdentity: D1OpaqueRunIdentity;
  readonly split: D1Split;
  readonly batchDigest: string;
  readonly labelProjectionDigest: string;
}

export interface D1TestLabelAttemptCapability {
  readonly kind: 'd1-test-label-attempt';
}

type D1TestState = 'unconsumed' | 'in-flight' | 'materialized' | 'failed';
interface D1RunAuthorityRecord {
  readonly runIdentity: D1OpaqueRunIdentity;
  readonly contextBatch: D1ContextTaskBatch;
  readonly subsets: readonly D1FrozenSubset[];
  readonly splitTaskRanges: Readonly<Record<D1Split, readonly [number, number]>>;
  readonly materializedSplits: Set<D1Split>;
  testState: D1TestState;
  testAttempt?: D1TestLabelAttemptCapability;
}

interface D1LabeledAuthorityRecord {
  readonly run: D1RunAuthorityRecord;
  readonly batch: D1AuthenticatedLabeledBatch;
  readonly split: D1Split;
  readonly batchDigest: string;
  readonly labelProjectionDigest: string;
}

const contextBatchAuthorities = new WeakMap<object, D1RunAuthorityRecord>();
const runIdentityAuthorities = new WeakMap<object, D1RunAuthorityRecord>();
const contextAuthorityObjects = new WeakMap<object, D1RunAuthorityRecord>();
const labeledBatchAuthorities = new WeakMap<object, D1LabeledAuthorityRecord>();
const labeledAuthorityObjects = new WeakMap<object, D1LabeledAuthorityRecord>();
const testAttemptAuthorities = new WeakMap<object, Readonly<{
  run: D1RunAuthorityRecord;
  fitAttestation: D1FinalBundleTestAttestation;
}>>();

function testBoundaryFailure(detail: string): D1PipelineRuntimeError {
  return new D1PipelineRuntimeError('test', 'test-before-freeze', 'held-out-test-before-freeze', detail);
}

function materializationFailure(
  split: D1Split,
  kind: 'worker-projection-integrity' | 'train-validation-label-materialization',
  detail: string,
): D1PipelineRuntimeError {
  return split === 'test'
    ? testBoundaryFailure(detail)
    : new D1PipelineRuntimeError('worker', 'worker-pool-failure', kind, detail);
}

function labeledAuthorityFailure(expectedSplit: D1Split, detail: string): D1PipelineRuntimeError {
  return expectedSplit === 'test'
    ? testBoundaryFailure(detail)
    : new D1PipelineRuntimeError('optimizer', 'optimizer-failure', 'optimizer', detail);
}

export function requireD1ContextTaskBatchAuthority(batch: D1ContextTaskBatch): D1ContextTaskBatchAuthority {
  if (batch === null || typeof batch !== 'object') throw testBoundaryFailure('unrecognized context batch capability');
  const record = contextBatchAuthorities.get(batch);
  if (!record || record.contextBatch !== batch || !Object.isFrozen(batch)) {
    throw testBoundaryFailure('unrecognized context batch capability');
  }
  const authority = freeze({ runIdentity: record.runIdentity, contextBatch: batch });
  contextAuthorityObjects.set(authority, record);
  return authority;
}

export function requireD1LabeledBatchAuthority(
  batch: D1AuthenticatedLabeledBatch,
  expectedSplit: D1Split,
): D1LabeledBatchAuthority {
  if (batch === null || typeof batch !== 'object') throw labeledAuthorityFailure(expectedSplit, 'unrecognized labeled batch capability');
  const record = labeledBatchAuthorities.get(batch);
  if (!record || record.batch !== batch || record.split !== expectedSplit || batch.split !== expectedSplit ||
    batch.batchDigest !== record.batchDigest || batch.labelProjectionDigest !== record.labelProjectionDigest || !Object.isFrozen(batch)) {
    throw labeledAuthorityFailure(expectedSplit, 'unrecognized labeled batch capability');
  }
  const authority = freeze({
    runIdentity: record.run.runIdentity,
    split: record.split,
    batchDigest: record.batchDigest,
    labelProjectionDigest: record.labelProjectionDigest,
  });
  labeledAuthorityObjects.set(authority, record);
  return authority;
}

function buildD1ContinuationCapture(capture: FrozenContinuationCapture): D1ContinuationCapture {
  return freeze({
    state: {
      board: capture.state.board.map((row) => [...row]),
      current: { ...capture.state.current, position: { ...capture.state.current.position } },
      next: capture.state.next,
      hold: capture.state.hold,
      holdAvailable: capture.state.holdAvailable,
      unseenBagMask: capture.state.unseenBagMask,
    },
    score: capture.score,
    lines: capture.lines,
    level: capture.level,
  });
}

export function buildD1ContextTasks(input: {
  readonly subsets: readonly D1FrozenSubset[];
  readonly vectors: Readonly<Record<D1VectorId, readonly number[]>> | readonly { id: D1VectorId; weights: readonly number[] }[];
  readonly streams: readonly D1SubsetFutureStream[] | ReadonlyMap<string, readonly D1SubsetFutureStream[]>;
  readonly profile?: ListwiseProtocolProfile;
}): D1ContextTaskBatch {
  const profile = input.profile ?? D1_PROFILE;
  if (input.subsets.length !== 160) throw new D1InvalidInputError('capture-missing-or-invalid');
  let vectorEntries: readonly { id: D1VectorId; weights: readonly number[] }[];
  if (Array.isArray(input.vectors)) {
    vectorEntries = input.vectors;
  } else {
    const vectorRecord = input.vectors as Readonly<Record<D1VectorId, readonly number[]>>;
    vectorEntries = [
      { id: 'gen6-best', weights: vectorRecord['gen6-best'] },
      { id: 'gen10-mu', weights: vectorRecord['gen10-mu'] },
    ];
  }
  const streams = input.streams;
  if ((streams instanceof Map && streams.size !== 160) || (Array.isArray(streams) && streams.length !== 320)) {
    throw new D1InvalidInputError('seed-schedule-mismatch');
  }
  if (vectorEntries.length !== 2 || vectorEntries[0]?.id !== 'gen6-best' || vectorEntries[1]?.id !== 'gen10-mu' ||
    new Set(vectorEntries.map(({ id }) => id)).size !== 2 ||
    vectorEntries.some(({ weights }) => weights.length !== 13 || weights.some((weight: number) => !Number.isFinite(weight)))) {
    throw new D1InvalidInputError('vector-identity-mismatch');
  }
  const subsetIds = new Set<string>();
  const verifiedSubsets = input.subsets.map((subset, subsetIndex) => {
    const expectedSplit = subsetIndex < 80 ? 'train' : subsetIndex < 112 ? 'validation' : 'test';
    const splitBase = expectedSplit === 'train' ? 0 : expectedSplit === 'validation' ? 80 : 112;
    const expectedGroup = (subsetIndex - splitBase) >> 2;
    const expectedVector = subsetIndex % 4 < 2 ? 'gen6-best' : 'gen10-mu';
    const expectedSlot = subsetIndex % 2 === 0 ? 128 : 512;
    const expectedBehaviorSeed = profile.behaviorSeeds[expectedSplit][expectedGroup];
    const captureFingerprint = digest([
      subset.capture.state.board, subset.capture.state.current.type, subset.capture.state.current.rotation,
      subset.capture.state.current.position.x, subset.capture.state.current.position.y, subset.capture.state.next,
      subset.capture.state.hold, subset.capture.state.holdAvailable, subset.capture.state.unseenBagMask,
      subset.capture.score, subset.capture.lines, subset.capture.level, subset.capture.scheduledPieceNumber,
    ]);
    if (subsetIds.has(subset.subsetId)) throw new D1InvalidInputError('state-fingerprint-mismatch');
    if (subset.capture.split !== expectedSplit || subset.capture.groupOrdinal !== expectedGroup ||
      subset.capture.behaviorSeed !== expectedBehaviorSeed || subset.capture.behaviorVectorId !== expectedVector ||
      subset.capture.behaviorVectorDigest !== D1_VECTOR_DIGESTS[expectedVector] ||
      subset.capture.captureSlot !== expectedSlot || subset.capture.scheduledPieceNumber !== expectedSlot) {
      throw new D1InvalidInputError('capture-missing-or-invalid');
    }
    if (subset.subsetId !== subset.capture.stateFingerprint || subset.capture.stateFingerprint !== captureFingerprint) {
      throw new D1InvalidInputError('state-fingerprint-mismatch');
    }
    subsetIds.add(subset.subsetId);
    const verified = freezeD1PlacementManifest(subset.capture, profile);
    if (subset.subsetId !== verified.subsetId || subset.legalCount !== verified.legalCount ||
      subset.selectedCount !== verified.selectedCount || subset.selectedCount < 2 || subset.selectedCount > 12 ||
      subset.placements.length !== subset.selectedCount || subset.legalPlacementIds.length !== subset.legalCount ||
      subset.legalUniverseDigest !== verified.legalUniverseDigest || subset.manifestDigest !== verified.manifestDigest ||
      JSON.stringify(subset.legalPlacementIds) !== JSON.stringify(verified.legalPlacementIds) ||
      JSON.stringify(subset.placements) !== JSON.stringify(verified.placements)) {
      throw new D1InvalidInputError('placement-manifest-mismatch');
    }
    return verified;
  });

  const streamSeeds = new Set<number>(); const streamDigests = new Set<string>();
  const verifiedStreams = verifiedSubsets.map((subset, subsetIndex) => {
    let subsetStreams: readonly D1SubsetFutureStream[] | undefined;
    if (Array.isArray(streams)) {
      subsetStreams = streams.slice(subsetIndex * 2, subsetIndex * 2 + 2);
    } else {
      const streamMap = streams as ReadonlyMap<string, readonly D1SubsetFutureStream[]>;
      subsetStreams = streamMap.get(subset.subsetId);
    }
    if (!subsetStreams || subsetStreams.length !== 2 || subsetStreams[0]?.subsetId !== subset.subsetId || subsetStreams[1]?.subsetId !== subset.subsetId ||
      subsetStreams[0]?.streamIndex !== 0 || subsetStreams[1]?.streamIndex !== 1) {
      throw new D1InvalidInputError('seed-schedule-mismatch');
    }
    const expectedVectorIndex = subset.capture.behaviorVectorId === 'gen6-best' ? 0 : 1;
    const expectedSlotIndex = subset.capture.captureSlot === 128 ? 0 : 1;
    for (const [streamIndex, stream] of subsetStreams.entries()) {
      const expectedSeed = hashSeed(profile.baseSeed, 3, subset.capture.behaviorSeed, expectedVectorIndex, expectedSlotIndex, streamIndex);
      if (stream.labelSeed !== expectedSeed || streamSeeds.has(stream.labelSeed) || streamDigests.has(stream.digest)) {
        throw new D1InvalidInputError('seed-schedule-mismatch');
      }
      const expectedStream = buildD1FutureStream({
        labelSeed: expectedSeed,
        unseenBagMask: subset.capture.state.unseenBagMask,
        streamIndex: streamIndex as 0 | 1,
      });
      if (stream.pieces.length !== expectedStream.pieces.length || stream.digest !== expectedStream.digest ||
        stream.pieces.some((piece: PieceType, pieceIndex: number) => piece !== expectedStream.pieces[pieceIndex])) {
        throw new D1InvalidInputError('seed-schedule-mismatch');
      }
      streamSeeds.add(stream.labelSeed); streamDigests.add(stream.digest);
    }
    return subsetStreams;
  });

  const tasks: D1ContextTask[] = [];
  const contextTuples: unknown[][] = [];
  const associationTuples: unknown[][] = [];
  let trainValidationContextCount = 0; let heldOutContextCount = 0;
  for (const [subsetIndex, subset] of verifiedSubsets.entries()) {
    const subsetStreams = verifiedStreams[subsetIndex]!;
    const sanitizedCapture = buildD1ContinuationCapture(subset.capture);
    for (const placement of subset.placements) {
      for (const vector of vectorEntries) {
        for (const streamIndex of [0, 1] as const) {
          const stream = subsetStreams[streamIndex];
          if (!stream) throw new D1InvalidInputError('seed-schedule-mismatch');
          const taskId = tasks.length;
          tasks.push(freeze({ taskId, subsetId: subset.subsetId, placementId: placement.placementId,
            continuationVectorId: vector.id, streamIndex, capture: sanitizedCapture, placement: placement.placement,
            weights: Object.freeze([...vector.weights]), futurePieces: stream.pieces }));
          const association = [taskId, subsetIndex, placement.placementId, vector.id, streamIndex];
          associationTuples.push(association);
          contextTuples.push([...association, stream.labelSeed, stream.digest]);
          if (subsetIndex < 112) trainValidationContextCount++; else heldOutContextCount++;
        }
      }
    }
  }
  const placementCount = verifiedSubsets.reduce((sum, subset) => sum + subset.selectedCount, 0);
  if (tasks.length !== placementCount * 4 || new Set(tasks.map(({ taskId }) => taskId)).size !== tasks.length ||
    trainValidationContextCount + heldOutContextCount !== tasks.length) {
    throw new D1InvalidInputError('placement-manifest-mismatch');
  }
  const selectedCountHistogram = countHistogram(verifiedSubsets.map(({ selectedCount }) => selectedCount), true);
  const splitCardinalityHistograms = (['train', 'validation', 'test'] as const).map((split) => {
    const [start, end] = split === 'train' ? [0, 80] : split === 'validation' ? [80, 112] : [112, 160];
    const entries = verifiedSubsets.slice(start, end);
    const legalCountBins = countHistogram(entries.map(({ legalCount }) => legalCount));
    const selectedCountBins = countHistogram(entries.map(({ selectedCount }) => selectedCount), true);
    return freeze({
      split,
      legalCountBins,
      selectedCountBins,
      digest: digest([split, legalCountBins, selectedCountBins]),
    });
  });
  const groupCardinalityHistograms = Array.from({ length: 40 }, (_, groupOrdinal) => {
    const entries = verifiedSubsets.slice(groupOrdinal * 4, groupOrdinal * 4 + 4);
    if (entries.length !== 4) throw new D1InvalidInputError('placement-manifest-mismatch');
    const legalCountBins = countHistogram(entries.map(({ legalCount }) => legalCount));
    const selectedCountBins = countHistogram(entries.map(({ selectedCount }) => selectedCount), true);
    return freeze({
      groupOrdinal,
      subsetCount: 4 as const,
      legalCountBins,
      selectedCountBins,
      digest: digest([groupOrdinal, 4, legalCountBins, selectedCountBins]),
    });
  });
  const evidence: D1ContextManifestEvidence = {
    placementCount,
    primaryContextCount: tasks.length,
    trainValidationContextCount,
    heldOutContextCount,
    contextManifestDigest: digest(contextTuples),
    taskAssociationDigest: digest(associationTuples),
    selectedCountHistogram,
    splitCardinalityHistograms,
    groupCardinalityHistograms,
  };
  const contextBatch = freeze({ tasks, evidence });
  const trainTaskEnd = verifiedSubsets.slice(0, 80).reduce((sum, subset) => sum + subset.selectedCount * 4, 0);
  const validationTaskEnd = trainTaskEnd + verifiedSubsets.slice(80, 112)
    .reduce((sum, subset) => sum + subset.selectedCount * 4, 0);
  const runIdentity = freeze({ kind: 'd1-run-identity' as const });
  const record: D1RunAuthorityRecord = {
    runIdentity,
    contextBatch,
    subsets: Object.freeze([...verifiedSubsets]),
    splitTaskRanges: Object.freeze({
      train: Object.freeze([0, trainTaskEnd]) as readonly [number, number],
      validation: Object.freeze([trainTaskEnd, validationTaskEnd]) as readonly [number, number],
      test: Object.freeze([validationTaskEnd, tasks.length]) as readonly [number, number],
    }),
    materializedSplits: new Set<D1Split>(),
    testState: 'unconsumed',
  };
  contextBatchAuthorities.set(contextBatch, record);
  runIdentityAuthorities.set(runIdentity, record);
  return contextBatch;
}

const addCounts = (a: LineClearCounts, b: LineClearCounts): LineClearCounts => ({
  singles: a.singles + b.singles, doubles: a.doubles + b.doubles,
  triples: a.triples + b.triples, tetrises: a.tetrises + b.tetrises,
});
const emptyCounts = (): LineClearCounts => ({ singles: 0, doubles: 0, triples: 0, tetrises: 0 });
const sameCounts = (left: LineClearCounts, right: LineClearCounts): boolean =>
  left.singles === right.singles && left.doubles === right.doubles && left.triples === right.triples && left.tetrises === right.tetrises;
const DIAGNOSTIC_KEYS = ['searchCalls','holdActions','holdRate','meanCompletedDepth','minCompletedDepth','completedDepthHistogram','totalWorkUnitsUsed','meanWorkUnitsUsed','maxWorkUnitsUsed','budgetExhaustedSearches','budgetExhaustionRate','placementEvaluationUnits','chanceExpansionUnits','cacheHitUnits','expandedDecisionNodes','expandedChanceNodes','cacheHits'] as const;
const INTEGER_DIAGNOSTIC_KEYS = new Set<string>(['searchCalls', 'holdActions', 'minCompletedDepth', 'totalWorkUnitsUsed', 'maxWorkUnitsUsed',
  'budgetExhaustedSearches', 'placementEvaluationUnits', 'chanceExpansionUnits', 'cacheHitUnits', 'expandedDecisionNodes',
  'expandedChanceNodes', 'cacheHits']);
const validClearCounts = (value: unknown): value is LineClearCounts => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === 4 && ['singles', 'doubles', 'triples', 'tetrises'].every((key) => {
    const entry = (value as Record<string, unknown>)[key];
    return typeof entry === 'number' && Number.isFinite(entry) && Number.isSafeInteger(entry) && entry >= 0;
  });
const validDiagnostics = (value: unknown): value is SimulationSearchDiagnostics => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === DIAGNOSTIC_KEYS.length && DIAGNOSTIC_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
  Object.entries(value as Record<string, unknown>).every(([key, entry]) => {
    if (!DIAGNOSTIC_KEYS.includes(key as typeof DIAGNOSTIC_KEYS[number])) return false;
    if (key === 'completedDepthHistogram') {
      return Array.isArray(entry) && entry.length === 5 && entry.every((item) => typeof item === 'number' && Number.isFinite(item) && Number.isInteger(item) && item >= 0);
    }
    return typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && (!INTEGER_DIAGNOSTIC_KEYS.has(key) || Number.isInteger(entry));
  });
const STRATEGY_DIAGNOSTIC_KEYS = ['meanCleanWellDepth', 'meanTetrisSetupProgress', 'meanTetrisReadyRows'] as const;
const validStrategyDiagnostics = (value: unknown): value is SimResult['strategyDiagnostics'] => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === STRATEGY_DIAGNOSTIC_KEYS.length && STRATEGY_DIAGNOSTIC_KEYS.every((key) => {
    const entry = (value as Record<string, unknown>)[key];
    return typeof entry === 'number' && Number.isFinite(entry) && entry >= 0;
  });
const diagnosticsFromState = (state: ReturnType<typeof createFrozenContinuationState>): SimulationSearchDiagnostics => ({
  searchCalls: state.searchCalls,
  holdActions: state.holdActions,
  holdRate: state.searchCalls === 0 ? 0 : state.holdActions / state.searchCalls,
  meanCompletedDepth: state.searchCalls === 0 ? 0 : state.completedDepthSum / state.searchCalls,
  minCompletedDepth: state.searchCalls === 0 ? 0 : state.minCompletedDepth,
  completedDepthHistogram: [...state.completedDepthHistogram],
  totalWorkUnitsUsed: state.totalWorkUnitsUsed,
  meanWorkUnitsUsed: state.searchCalls === 0 ? 0 : state.totalWorkUnitsUsed / state.searchCalls,
  maxWorkUnitsUsed: state.maxWorkUnitsUsed,
  budgetExhaustedSearches: state.budgetExhaustedSearches,
  budgetExhaustionRate: state.searchCalls === 0 ? 0 : state.budgetExhaustedSearches / state.searchCalls,
  placementEvaluationUnits: state.placementEvaluationUnits,
  chanceExpansionUnits: state.chanceExpansionUnits,
  cacheHitUnits: state.cacheHitUnits,
  expandedDecisionNodes: state.expandedDecisionNodes,
  expandedChanceNodes: state.expandedChanceNodes,
  cacheHits: state.cacheHits,
});

export function runD1Context(
  task: D1ContextTask,
  runContinuation: (state: ReturnType<typeof createFrozenContinuationState>) => SimResult = (state) =>
    simulateFromState(state, { weights: [...task.weights], maxPieces: 128 }),
): D1ContextProjection {
  try {
    const state = createFrozenContinuationState(task.capture, task.futurePieces);
    if (state.currentPiece === null || state.currentPiece.type !== task.placement.piece.type) throw new Error('placement piece mismatch');
    state.currentPiece = { ...task.placement.piece, position: { ...task.placement.piece.position } };
    applyAction(state, 'hardDrop');
    if (state.pieces !== 1) throw new Error('forced placement did not lock');
    const result = runContinuation(state);
    const completedPieces: number = state.pieces;
    if ((result.reason !== 'pieceCap' && result.reason !== 'gameover') ||
      (result.reason === 'pieceCap' && (state.status !== 'playing' || completedPieces !== 128)) ||
      (result.reason === 'gameover' && (state.status !== 'gameover' || completedPieces >= 128)) ||
      !Number.isInteger(result.pieces) || result.pieces < 0 || result.pieces !== completedPieces ||
      !Number.isFinite(result.score) || result.score < 0 || result.score !== state.score ||
      !Number.isInteger(result.lines) || result.lines < 0 || result.lines !== state.lines ||
      !validClearCounts(result.clearCounts) || !sameCounts(result.clearCounts, state.clearCounts)) {
      throw new Error('incomplete continuation');
    }
    const expectedDiagnostics = diagnosticsFromState(state);
    if (!validDiagnostics(result.searchDiagnostics) || DIAGNOSTIC_KEYS.some((key) => key === 'completedDepthHistogram'
      ? (result.searchDiagnostics[key] as number[]).some((value, index) => value !== expectedDiagnostics[key][index])
      : result.searchDiagnostics[key] !== expectedDiagnostics[key])) {
      throw new Error('contradictory continuation result');
    }
    const expectedMeanHeight = completedPieces === 0 ? 0 : state.heightSum / completedPieces;
    const expectedStrategyDiagnostics: SimResult['strategyDiagnostics'] = {
      meanCleanWellDepth: completedPieces === 0 ? 0 : state.strategyDiagnosticSum.meanCleanWellDepth / completedPieces,
      meanTetrisSetupProgress: completedPieces === 0 ? 0 : state.strategyDiagnosticSum.meanTetrisSetupProgress / completedPieces,
      meanTetrisReadyRows: completedPieces === 0 ? 0 : state.strategyDiagnosticSum.meanTetrisReadyRows / completedPieces,
    };
    if (!Number.isFinite(result.meanHeight) || result.meanHeight < 0 || result.meanHeight !== expectedMeanHeight ||
      !validStrategyDiagnostics(result.strategyDiagnostics) ||
      STRATEGY_DIAGNOSTIC_KEYS.some((key) => result.strategyDiagnostics[key] !== expectedStrategyDiagnostics[key])) {
      throw new Error('contradictory continuation diagnostics');
    }
    const projection = {
      taskId: task.taskId, subsetId: task.subsetId, placementId: task.placementId,
      continuationVectorId: task.continuationVectorId, streamIndex: task.streamIndex,
      pieces: state.pieces, scoreDelta: state.score - task.capture.score,
      clearCounts: result.clearCounts, reason: result.reason,
      searchDiagnostics: result.searchDiagnostics,
    } as Omit<D1ContextProjection, 'projectionDigest'>;
    return freeze({ ...projection, projectionDigest: digest(projection) });
  } catch (error) {
    throw new Error(`runtime-fail: ${error instanceof Error ? error.message : 'context failure'}`);
  }
}

export interface D1PlacementOutcome {
  readonly placementId: string;
  readonly pieceCapContexts: number;
  readonly minPieces: number;
  readonly sumPieces: number;
  readonly sumScore: number;
  readonly scoreRate: number;
  readonly totalTetrises: number;
  readonly totalLines: number;
  readonly tetrisNumerator: number;
  readonly tetrisDenominator: number;
  readonly tetrisShare: number;
  readonly clearCounts: LineClearCounts;
}

export function aggregateD1PlacementOutcome(placementId: string, contexts: readonly D1ContextProjection[]): D1PlacementOutcome {
  if (contexts.length !== 4) throw new Error('runtime-fail: incomplete context results');
  let pieceCapContexts = 0; let minPieces = Number.POSITIVE_INFINITY; let sumPieces = 0; let sumScore = 0;
  let clearCounts = emptyCounts();
  const identity = new Set<string>(); const taskIds = new Set<number>(); const first = contexts[0]!;
  for (const context of contexts) {
    const key = `${context.continuationVectorId}:${context.streamIndex}`;
    if (context.subsetId !== first.subsetId || context.placementId !== placementId || !Number.isFinite(context.pieces) || !Number.isFinite(context.scoreDelta) ||
      !Number.isInteger(context.pieces) || context.pieces < 0 || !['pieceCap', 'gameover'].includes(context.reason) ||
      !Object.values(context.clearCounts).every((value) => Number.isInteger(value) && value >= 0) || identity.has(key) || taskIds.has(context.taskId) ||
      !validDiagnostics(context.searchDiagnostics) || (context.reason === 'pieceCap' && context.pieces !== 128) ||
      (context.reason === 'gameover' && context.pieces >= 128)) throw new Error('runtime-fail: malformed context');
    identity.add(key); taskIds.add(context.taskId);
    if (context.reason === 'pieceCap' && context.pieces === 128) pieceCapContexts++;
    minPieces = Math.min(minPieces, context.pieces); sumPieces += context.pieces; sumScore += context.scoreDelta;
    clearCounts = addCounts(clearCounts, context.clearCounts);
  }
  if (identity.size !== 4 || !['gen6-best:0', 'gen6-best:1', 'gen10-mu:0', 'gen10-mu:1'].every((key) => identity.has(key))) {
    throw new Error('runtime-fail: incomplete context results');
  }
  const totalLines = clearCounts.singles + 2 * clearCounts.doubles + 3 * clearCounts.triples + 4 * clearCounts.tetrises;
  const totalTetrises = clearCounts.tetrises;
  const tetrisNumerator = 4 * totalTetrises;
  const tetrisDenominator = totalLines;
  return freeze({ placementId, pieceCapContexts, minPieces, sumPieces, sumScore,
    scoreRate: sumScore / (contexts.length * 128), totalTetrises, totalLines,
    tetrisNumerator, tetrisDenominator,
    tetrisShare: tetrisDenominator === 0 ? 0 : tetrisNumerator / tetrisDenominator,
    clearCounts });
}

type D1SubsetTargetInput = Pick<D1PlacementOutcome,
  'placementId' | 'pieceCapContexts' | 'minPieces' | 'sumPieces' | 'sumScore' | 'clearCounts'>
  & Partial<Pick<D1PlacementOutcome, 'totalTetrises' | 'totalLines' | 'tetrisNumerator' | 'tetrisDenominator' | 'tetrisShare'>>;

function normalizeFraction(numerator: unknown, denominator: unknown): { numerator: number; denominator: number; share: number } {
  if (typeof numerator !== 'number' || typeof denominator !== 'number' || !Number.isFinite(numerator) || !Number.isFinite(denominator) ||
    !Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator < 0) {
    throw new Error('runtime-fail: invalid tetris fraction');
  }
  if (denominator === 0) {
    if (numerator !== 0) throw new Error('runtime-fail: invalid tetris fraction');
    return { numerator: 0, denominator: 0, share: 0 };
  }
  return { numerator, denominator, share: numerator / denominator };
}

export function buildD1SubsetTarget(outcomes: readonly D1SubsetTargetInput[]) {
  if (outcomes.length < 2 || outcomes.length > 12) throw new Error('runtime-fail: malformed placement outcome');
  const normalized = outcomes.map((outcome) => {
    const clearCounts = outcome.clearCounts as LineClearCounts;
    if (!validClearCounts(clearCounts) || !Number.isInteger(outcome.pieceCapContexts) || outcome.pieceCapContexts < 0 || outcome.pieceCapContexts > 4 ||
      !Number.isInteger(outcome.minPieces) || outcome.minPieces < 0 || !Number.isInteger(outcome.sumPieces) || outcome.sumPieces < 0 ||
      !Number.isFinite(outcome.sumScore) || outcome.sumScore < 0 || typeof outcome.placementId !== 'string' || outcome.placementId.length === 0) {
      throw new Error('runtime-fail: malformed placement outcome');
    }
    const totalLines = outcome.totalLines ?? (clearCounts.singles + 2 * clearCounts.doubles + 3 * clearCounts.triples + 4 * clearCounts.tetrises);
    const totalTetrises = outcome.totalTetrises ?? clearCounts.tetrises;
    if (!Number.isInteger(totalLines) || !Number.isInteger(totalTetrises) || totalLines < 0 || totalTetrises < 0) {
      throw new Error('runtime-fail: invalid tetris fraction');
    }
    if (totalLines !== clearCounts.singles + 2 * clearCounts.doubles + 3 * clearCounts.triples + 4 * clearCounts.tetrises ||
      totalTetrises !== clearCounts.tetrises || totalLines === 0 && totalTetrises !== 0) {
      throw new Error('runtime-fail: invalid tetris fraction');
    }
    const suppliedNumerator = outcome.tetrisNumerator ?? 4 * totalTetrises;
    const suppliedDenominator = outcome.tetrisDenominator ?? totalLines;
    const fraction = normalizeFraction(suppliedNumerator, suppliedDenominator);
    if (fraction.numerator !== 4 * totalTetrises || fraction.denominator !== totalLines ||
      outcome.tetrisShare !== undefined && (!Number.isFinite(outcome.tetrisShare) || outcome.tetrisShare < 0 || outcome.tetrisShare !== fraction.share)) {
      throw new Error('runtime-fail: invalid tetris fraction');
    }
    return { ...outcome, tetrisDenominator: fraction.denominator, tetrisNumerator: fraction.numerator,
      tetrisShare: fraction.share, totalLines, totalTetrises } as D1PlacementOutcome;
  });
  const survivalOracle: [number, number, number] = normalized.reduce((best, item) => {
    const tuple: [number, number, number] = [item.pieceCapContexts, item.minPieces, item.sumPieces];
    return tuple[0] > best[0] || (tuple[0] === best[0] && (tuple[1] > best[1] || (tuple[1] === best[1] && tuple[2] > best[2]))) ? tuple : best;
  }, [0, 0, 0] as [number, number, number]);
  const tier = normalized.filter((item) => item.pieceCapContexts === survivalOracle[0] && item.minPieces === survivalOracle[1] && item.sumPieces === survivalOracle[2]);
  const compareFractions = (left: D1PlacementOutcome, right: D1PlacementOutcome): number => {
    if (left.tetrisDenominator === 0 || right.tetrisDenominator === 0) {
      const leftIsZero = left.tetrisNumerator === 0;
      const rightIsZero = right.tetrisNumerator === 0;
      return leftIsZero === rightIsZero ? 0 : leftIsZero ? -1 : 1;
    }
    const leftProduct = BigInt(left.tetrisNumerator) * BigInt(right.tetrisDenominator);
    const rightProduct = BigInt(right.tetrisNumerator) * BigInt(left.tetrisDenominator);
    return leftProduct > rightProduct ? 1 : leftProduct < rightProduct ? -1 : 0;
  };
  const front = tier.filter((candidate) => !tier.some((other) => other !== candidate && other.sumScore >= candidate.sumScore &&
    compareFractions(other, candidate) >= 0 && (other.sumScore > candidate.sumScore || compareFractions(other, candidate) > 0)));
  front.sort((a, b) => a.placementId.localeCompare(b.placementId));
  const ids = front.map((item) => item.placementId);
  const q = normalized.map((item) => ids.includes(item.placementId) ? 1 / ids.length : 0);
  return freeze({ survivalOracle, jointFrontPlacementIds: ids, q });
}

const PROJECTION_KEYS = [
  'taskId', 'subsetId', 'placementId', 'continuationVectorId', 'streamIndex',
  'pieces', 'scoreDelta', 'clearCounts', 'reason', 'searchDiagnostics', 'projectionDigest',
] as const;

function assertExactContextProjection(split: D1Split, task: D1ContextTask, projection: D1ContextProjection): void {
  if (projection === null || typeof projection !== 'object' ||
    JSON.stringify(Object.keys(projection)) !== JSON.stringify(PROJECTION_KEYS) ||
    projection.taskId !== task.taskId || projection.subsetId !== task.subsetId ||
    projection.placementId !== task.placementId || projection.continuationVectorId !== task.continuationVectorId ||
    projection.streamIndex !== task.streamIndex || !Number.isSafeInteger(projection.pieces) || projection.pieces < 0 ||
    !Number.isSafeInteger(projection.scoreDelta) || projection.scoreDelta < 0 ||
    (projection.reason !== 'pieceCap' && projection.reason !== 'gameover') ||
    !validClearCounts(projection.clearCounts) || !validDiagnostics(projection.searchDiagnostics)) {
    throw materializationFailure(split, 'worker-projection-integrity', 'projection identity mismatch');
  }
  const projectionPreimage = {
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
  };
  if (projection.projectionDigest !== digest(projectionPreimage)) {
    throw materializationFailure(split, 'worker-projection-integrity', 'projection digest mismatch');
  }
}

function splitSubsetRange(split: D1Split): readonly [number, number] {
  return split === 'train' ? [0, 80] : split === 'validation' ? [80, 112] : [112, 160];
}

function materializeSplit(
  record: D1RunAuthorityRecord,
  split: D1Split,
  projections: readonly D1ContextProjection[],
): D1AuthenticatedLabeledBatch {
  const [taskStart, taskEnd] = record.splitTaskRanges[split];
  if (!Array.isArray(projections) || projections.length !== taskEnd - taskStart) {
    throw materializationFailure(split, 'worker-projection-integrity', 'incomplete split projections');
  }
  const projectionByTask = new Map<number, D1ContextProjection>();
  for (const projection of projections) {
    if (projectionByTask.has(projection.taskId)) {
      throw materializationFailure(split, 'worker-projection-integrity', 'duplicate task projection');
    }
    projectionByTask.set(projection.taskId, projection);
  }
  const [subsetStart, subsetEnd] = splitSubsetRange(split);
  const subsets: D1LabeledSubsetProjection[] = [];
  let taskCursor = taskStart;
  for (let subsetIndex = subsetStart; subsetIndex < subsetEnd; subsetIndex += 1) {
    const subset = record.subsets[subsetIndex]!;
    if (subset.capture.split !== split) {
      throw materializationFailure(split, 'train-validation-label-materialization', 'capture split mismatch');
    }
    const outcomes: D1PlacementOutcome[] = [];
    for (const placement of subset.placements) {
      const contexts: D1ContextProjection[] = [];
      for (let contextIndex = 0; contextIndex < 4; contextIndex += 1) {
        const task = record.contextBatch.tasks[taskCursor]!;
        const projection = projectionByTask.get(taskCursor);
        if (!task || !projection) {
          throw materializationFailure(split, 'worker-projection-integrity', 'missing task projection');
        }
        assertExactContextProjection(split, task, projection);
        contexts.push(projection);
        taskCursor += 1;
      }
      outcomes.push(aggregateD1PlacementOutcome(placement.placementId, contexts));
    }
    const target = buildD1SubsetTarget(outcomes);
    subsets.push(freeze({
      subsetId: subset.subsetId,
      groupOrdinal: subset.capture.groupOrdinal,
      placementIds: subset.placements.map(({ placementId }) => placementId),
      afterstate13: subset.placements.map(({ afterstate13 }) => [...afterstate13]),
      action24: subset.placements.map(({ action24 }) => [...action24]),
      outcomes,
      survivalOracle: [...target.survivalOracle] as [number, number, number],
      jointFrontPlacementIds: [...target.jointFrontPlacementIds],
      q: [...target.q],
    }));
  }
  if (taskCursor !== taskEnd || projectionByTask.size !== projections.length) {
    throw materializationFailure(split, 'worker-projection-integrity', 'extra task projection');
  }
  const batchDigest = digest([split, subsets.map((subset) => [
    subset.subsetId, subset.groupOrdinal, subset.placementIds, subset.afterstate13, subset.action24,
    subset.outcomes, subset.survivalOracle, subset.jointFrontPlacementIds, subset.q,
  ])]);
  const labelProjectionDigest = digest([split, subsets.map((subset) => [
    subset.subsetId, subset.outcomes, subset.survivalOracle, subset.jointFrontPlacementIds, subset.q,
  ])]);
  return freeze({ split, subsets, batchDigest, labelProjectionDigest });
}

export function materializeD1LabeledBatch(input: {
  readonly contextBatch: D1ContextTaskBatch;
  readonly split: D1Split;
  readonly projections: readonly D1ContextProjection[];
  readonly testAttempt?: D1TestLabelAttemptCapability;
}): D1AuthenticatedLabeledBatch {
  let contextAuthority: D1ContextTaskBatchAuthority;
  try {
    contextAuthority = requireD1ContextTaskBatchAuthority(input.contextBatch);
  } catch {
    throw materializationFailure(input.split, 'train-validation-label-materialization', 'unrecognized context batch capability');
  }
  const record = contextAuthorityObjects.get(contextAuthority);
  if (!record || runIdentityAuthorities.get(record.runIdentity) !== record ||
    (input.split !== 'train' && input.split !== 'validation' && input.split !== 'test')) {
    throw materializationFailure(input.split, 'train-validation-label-materialization', 'unrecognized run authority');
  }
  if (record.materializedSplits.has(input.split)) {
    throw materializationFailure(input.split, 'train-validation-label-materialization', 'split already materialized');
  }
  if (input.split !== 'test') {
    if (input.testAttempt !== undefined) {
      throw materializationFailure(input.split, 'train-validation-label-materialization', 'test attempt on non-test split');
    }
    let batch: D1AuthenticatedLabeledBatch;
    try {
      batch = materializeSplit(record, input.split, input.projections);
    } catch (error) {
      if (error instanceof D1PipelineRuntimeError) throw error;
      throw materializationFailure(input.split, 'train-validation-label-materialization', 'label materialization failure');
    }
    record.materializedSplits.add(input.split);
    const labeledRecord: D1LabeledAuthorityRecord = {
      run: record,
      batch,
      split: input.split,
      batchDigest: batch.batchDigest,
      labelProjectionDigest: batch.labelProjectionDigest,
    };
    labeledBatchAuthorities.set(batch, labeledRecord);
    return batch;
  }
  if (input.testAttempt === undefined || input.testAttempt === null || typeof input.testAttempt !== 'object') {
    throw testBoundaryFailure('test attempt required');
  }
  const attemptRecord = testAttemptAuthorities.get(input.testAttempt);
  if (!attemptRecord || attemptRecord.run !== record || record.testAttempt !== input.testAttempt || record.testState !== 'in-flight') {
    throw testBoundaryFailure('unrecognized test attempt capability');
  }
  try {
    const batch = materializeSplit(record, 'test', input.projections);
    record.materializedSplits.add('test');
    record.testState = 'materialized';
    const labeledRecord: D1LabeledAuthorityRecord = {
      run: record,
      batch,
      split: 'test',
      batchDigest: batch.batchDigest,
      labelProjectionDigest: batch.labelProjectionDigest,
    };
    labeledBatchAuthorities.set(batch, labeledRecord);
    return batch;
  } catch (error) {
    try {
      failD1TestLabelAttempt(input.testAttempt);
    } catch (crossingError) {
      if (crossingError instanceof D1PipelineRuntimeError) throw crossingError;
      throw new D1PipelineRuntimeError('cleanup', 'test-before-freeze', 'failure-crossing');
    }
    if (error instanceof D1PipelineRuntimeError) throw error;
    throw testBoundaryFailure('label materialization failure');
  }
}

export function consumeD1TestLabelCapability(
  finalModels: D1FinalModelBundle,
  contextBatch: D1ContextTaskBatch,
): D1TestLabelAttemptCapability {
  const authority = requireD1ContextTaskBatchAuthority(contextBatch);
  const record = contextAuthorityObjects.get(authority);
  if (!record || record.testState !== 'unconsumed') throw testBoundaryFailure('test attempt already consumed');
  const fitAttestation = consumeD1FinalBundleForTest(finalModels, record.runIdentity);
  const attempt = freeze({ kind: 'd1-test-label-attempt' as const });
  record.testState = 'in-flight';
  record.testAttempt = attempt;
  testAttemptAuthorities.set(attempt, { run: record, fitAttestation });
  return attempt;
}

export function failD1TestLabelAttempt(attempt: D1TestLabelAttemptCapability): void {
  if (attempt === null || typeof attempt !== 'object') throw testBoundaryFailure('unrecognized test attempt capability');
  const attemptRecord = testAttemptAuthorities.get(attempt);
  if (!attemptRecord || attemptRecord.run.testAttempt !== attempt || attemptRecord.run.testState !== 'in-flight') {
    throw testBoundaryFailure('unrecognized test attempt capability');
  }
  attemptRecord.run.testState = 'failed';
  let transitionError: unknown;
  try {
    failD1FinalBundleTestAttestation(attemptRecord.fitAttestation);
  } catch (error) {
    transitionError = error;
  }
  if (transitionError === undefined) return;
  try {
    failD1FinalBundleTestAttestation(attemptRecord.fitAttestation);
  } catch (retryError) {
    transitionError = new AggregateError([transitionError, retryError], 'test failure crossing did not complete cleanly');
  }
  throw new D1PipelineRuntimeError('cleanup', 'test-before-freeze', 'failure-crossing', 'failure transition error', transitionError);
}
