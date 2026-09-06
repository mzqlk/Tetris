import { createHash } from 'node:crypto';
import type { D1RepresentationId } from './d1ActionConditionedHeldOutListwiseCore';
import {
  requireD1LabeledBatchAuthority,
  type D1AuthenticatedLabeledBatch,
  type D1FitSubset,
  type D1OpaqueRunIdentity,
  type D1PlacementOutcome,
} from './d1ActionConditionedHeldOutListwiseLabels';
import {
  D1RuntimeError,
  runD1NewtonController,
  solveD1NewtonDirection,
} from './d1ActionConditionedHeldOutListwiseFitInternals';

export const D1_LAMBDAS = Object.freeze([0.0001, 0.001, 0.01, 0.1, 1] as const);

export interface D1Normalization {
  readonly mean: readonly number[];
  readonly std: readonly number[];
}

export interface D1NormalizedRows {
  readonly rows: readonly (readonly number[])[];
  readonly stats: D1Normalization;
  readonly digest: string;
}

export interface D1ModelFreezeRecord {
  readonly representationId: D1RepresentationId;
  readonly lambda: typeof D1_LAMBDAS[number];
  readonly normalizationDigest: string;
  readonly weightDigest: string;
  readonly gradientNorm: number;
  readonly iterationCount: number;
}

export interface D1FinalModel extends D1ModelFreezeRecord {
  readonly weights: readonly number[];
  readonly normalization: D1Normalization;
}

export interface D1FitInput {
  readonly representationId: D1RepresentationId;
  readonly lambda: typeof D1_LAMBDAS[number];
  readonly subsets: readonly D1FitSubset[];
}

export type D1FitResult = D1FinalModel;

export interface D1EvaluationSubset {
  readonly subsetId: string;
  readonly groupOrdinal: number;
  readonly placementIds: readonly string[];
  readonly features: readonly (readonly number[])[];
  readonly outcomes: readonly D1PlacementOutcome[];
  readonly survivalOracle: readonly [number, number, number];
  readonly jointFrontPlacementIds: readonly string[];
}

export interface D1HeldOutSubset {
  readonly subsetId: string;
  readonly groupOrdinal: number;
  readonly placementIds: readonly string[];
  readonly afterstate13: readonly (readonly number[])[];
  readonly action24: readonly (readonly number[])[];
  readonly outcomes: readonly D1PlacementOutcome[];
  readonly survivalOracle: readonly [number, number, number];
  readonly jointFrontPlacementIds: readonly string[];
}

export interface D1ValidationSelection extends D1FinalModel {
  readonly validationSurvivalBelowSubsetOracle: number;
  readonly validationSubsetJointFrontHits: number;
  readonly validationSelectionDigest: string;
}

export interface D1FinalModelBundle {
  readonly models: Readonly<Record<D1RepresentationId, D1FinalModel>>;
}

export interface D1FinalBundleTestAttestation {
  readonly kind: 'd1-final-bundle-test-attestation';
}

export type D1RuntimeFailureReason =
  | 'simulation-failure' | 'worker-pool-failure' | 'worker-pool-destroy-failure' | 'optimizer-failure'
  | 'abort' | 'malformed-metrics' | 'test-before-freeze' | 'nondeterministic-replay';
export type D1RuntimePhase = 'worker' | 'optimizer' | 'test' | 'replay' | 'cleanup';
export type D1PipelineFailureKind =
  | 'simulation'
  | 'worker-projection-integrity'
  | 'train-validation-label-materialization'
  | 'optimizer'
  | 'held-out-test-before-freeze'
  | 'failure-crossing'
  | 'worker-cleanup'
  | 'replay-integrity';
export class D1PipelineRuntimeError extends Error {
  readonly name = 'D1PipelineRuntimeError';

  constructor(
    readonly phase: D1RuntimePhase,
    readonly reason: D1RuntimeFailureReason,
    readonly kind: D1PipelineFailureKind,
    detail: string = reason,
    readonly cause?: unknown,
  ) {
    super(`runtime-fail: ${phase}: ${reason}: ${kind}: ${detail}`);
  }
}
export type D1StatisticalFailureReason =
  | 'action24-survival-below-subset-oracle' | 'action24-survival-lower-than-afterstate13'
  | 'action24-score-lower-than-afterstate13' | 'action24-tetris-share-lower-than-afterstate13'
  | 'joint-score-and-tetris-not-strictly-higher' | 'action24-front-hit-floor-not-met'
  | 'action24-front-hit-gain-not-met' | 'seed-group-nonnegative-floor-not-met'
  | 'seed-group-positive-floor-not-met';
export type D1HeldOutStatus = 'runtime-fail' | 'fail-joint-selection-not-shown' |
  'fail-representation-gain-not-held-out' | 'pass-action-conditioned-listwise-supported';

export interface D1SelectedMetrics {
  readonly selectedPlacementIds: readonly string[];
  readonly selectedSurvivalTuples: readonly (readonly [number, number, number])[];
  readonly survivalBelowSubsetOracle: number;
  readonly subsetJointFrontHits: number;
  readonly sumScore: number;
  readonly scheduledPieces: 24576;
  readonly scoreRate: number;
  readonly tetrisNumerator: number;
  readonly tetrisDenominator: number;
  readonly tetrisShare: number;
}
export interface D1SeedGroupMetric {
  readonly groupOrdinal: number;
  readonly afterstate13FrontHits: number;
  readonly action24FrontHits: number;
  readonly groupFrontDelta: number;
}
export interface D1CardinalityMetric {
  readonly selectedCount: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  readonly subsetCount: number;
  readonly afterstate13FrontHits: number;
  readonly action24FrontHits: number;
  readonly action24NonLowerSurvival: number;
  readonly frontDelta: number;
}
export interface D1HeldOutResult {
  readonly status: D1HeldOutStatus;
  readonly failureReasons: readonly (D1RuntimeFailureReason | D1StatisticalFailureReason)[];
  readonly metrics: Readonly<Record<D1RepresentationId, D1SelectedMetrics>>;
  readonly cardinalityMetrics: readonly D1CardinalityMetric[];
  readonly seedGroups: readonly D1SeedGroupMetric[];
  readonly gates: {
    action24OracleSafe: boolean;
    action24NonLowerSurvival: boolean;
    action24FrontHitFloor: boolean;
    action24FrontHitGain: boolean;
    allSeedGroupsNonNegative: boolean;
    positiveSeedGroupCount: number;
    scoreNonLower: boolean;
    tetrisNonLower: boolean;
    jointStrictImprovement: boolean;
  };
  readonly selectedPlacementDigest: string;
  readonly metricProjectionDigest: string;
}

const validationSelectionCapabilities = new WeakMap<object, Readonly<{
  representationId: D1RepresentationId;
  lambda: typeof D1_LAMBDAS[number];
  validationSelectionDigest: string;
}>>();
const structuralFinalModelBundleCapabilities = new WeakSet<object>();

interface D1TrainingFitCapabilityRecord {
  readonly runIdentity: D1OpaqueRunIdentity;
  readonly trainBatch: D1AuthenticatedLabeledBatch;
  readonly representationId: D1RepresentationId;
  readonly lambda: typeof D1_LAMBDAS[number];
}

interface D1SelectionCapabilityRecord {
  readonly runIdentity: D1OpaqueRunIdentity;
  readonly trainBatch: D1AuthenticatedLabeledBatch;
  readonly validationBatch: D1AuthenticatedLabeledBatch;
  readonly representationId: D1RepresentationId;
  readonly lambda: typeof D1_LAMBDAS[number];
}

type D1FinalTestState = 'unconsumed' | 'in-flight' | 'materialized' | 'failed';
type D1FinalFreezeState = 'in-flight' | 'materialized' | 'failed';
interface D1FinalBundleCapabilityRecord {
  readonly runIdentity: D1OpaqueRunIdentity;
  readonly trainBatch: D1AuthenticatedLabeledBatch;
  readonly validationBatch: D1AuthenticatedLabeledBatch;
  readonly bundle: D1FinalModelBundle;
  testState: D1FinalTestState;
  attestation?: D1FinalBundleTestAttestation;
}

const trainingFitCapabilities = new WeakMap<object, D1TrainingFitCapabilityRecord>();
const selectionCapabilities = new WeakMap<object, D1SelectionCapabilityRecord>();
const finalAttestationCapabilities = new WeakMap<object, D1FinalBundleCapabilityRecord>();
const fitUsesByRun = new WeakMap<object, Set<string>>();
const selectionUsesByRun = new WeakMap<object, Set<D1RepresentationId>>();
const finalFreezeStatesByRun = new WeakMap<object, D1FinalFreezeState>();
const d1FinalRefitFailureSentinel = Object.freeze({ kind: 'd1-final-refit-failure-sentinel' });
let lookupD1FinalBundleCapability: (value: object) => D1FinalBundleCapabilityRecord | undefined;

function finite(value: number, detail: string): number {
  if (!Number.isFinite(value)) throw new D1RuntimeError(detail);
  return value;
}

function canonicalZero(value: number): number {
  return Object.is(value, -0) ? +0 : value;
}

function binary64Digest(values: readonly number[]): string {
  const bytes = Buffer.alloc(values.length * 8);
  for (let index = 0; index < values.length; index += 1) {
    const value = canonicalZero(finite(values[index]!, 'non-finite digest value'));
    bytes.writeDoubleLE(value, index * 8);
  }
  return createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonicalDigest(value: unknown): string {
  const assertSerializable = (entry: unknown): void => {
    if (entry === undefined || typeof entry === 'number' && (!Number.isFinite(entry) || Object.is(entry, -0))) {
      throw new D1RuntimeError('non-canonical digest projection');
    }
    if (entry !== null && typeof entry === 'object') {
      if (Array.isArray(entry)) {
        for (let index = 0; index < entry.length; index += 1) {
          if (!Object.prototype.hasOwnProperty.call(entry, index)) throw new D1RuntimeError('non-canonical digest projection');
          assertSerializable(entry[index]);
        }
      } else {
        for (const child of Object.values(entry as Record<string, unknown>)) assertSerializable(child);
      }
    }
  };
  assertSerializable(value);
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function expectedDimensions(representationId: D1RepresentationId): 13 | 24 {
  return representationId === 'afterstate13' ? 13 : 24;
}

function assertCanonicalNumber(value: unknown, detail: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) throw new D1RuntimeError(detail);
}

function assertCanonicalVector(values: unknown, dimensions: number, detail: string): asserts values is readonly number[] {
  if (!Array.isArray(values) || values.length !== dimensions) throw new D1RuntimeError(detail);
  for (const value of values) assertCanonicalNumber(value, detail);
}

function placementCardinality(
  placementIds: unknown,
  alignedValues: readonly unknown[],
  detail: string,
): number {
  if (!Array.isArray(placementIds) || placementIds.length < 2 || placementIds.length > 12 ||
    alignedValues.some((values) => !Array.isArray(values) || values.length !== placementIds.length)) {
    throw new D1RuntimeError(detail);
  }
  return placementIds.length;
}

function assertLowercaseDigest(value: unknown, detail: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new D1RuntimeError(detail);
}

function compareSurvival(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! !== right[index]!) return left[index]! > right[index]! ? 1 : -1;
  }
  return 0;
}

function compareTetrisFractions(
  leftNumerator: number,
  leftDenominator: number,
  rightNumerator: number,
  rightDenominator: number,
): number {
  const leftIsZero = leftNumerator === 0;
  const rightIsZero = rightNumerator === 0;
  if (leftIsZero || rightIsZero) return leftIsZero === rightIsZero ? 0 : leftIsZero ? -1 : 1;
  const leftProduct = BigInt(leftNumerator) * BigInt(rightDenominator);
  const rightProduct = BigInt(rightNumerator) * BigInt(leftDenominator);
  return leftProduct > rightProduct ? 1 : leftProduct < rightProduct ? -1 : 0;
}

function assertOutcome(outcome: D1PlacementOutcome, placementId: string): void {
  if (outcome === null || typeof outcome !== 'object' || outcome.placementId !== placementId ||
    !Number.isSafeInteger(outcome.pieceCapContexts) || Object.is(outcome.pieceCapContexts, -0) || outcome.pieceCapContexts < 0 || outcome.pieceCapContexts > 4 ||
    !Number.isSafeInteger(outcome.minPieces) || Object.is(outcome.minPieces, -0) || outcome.minPieces < 0 ||
    !Number.isSafeInteger(outcome.sumPieces) || Object.is(outcome.sumPieces, -0) || outcome.sumPieces < 0 ||
    !Number.isSafeInteger(outcome.sumScore) || Object.is(outcome.sumScore, -0) || outcome.sumScore < 0 ||
    !Number.isSafeInteger(outcome.totalTetrises) || Object.is(outcome.totalTetrises, -0) || outcome.totalTetrises < 0 ||
    !Number.isSafeInteger(outcome.totalLines) || Object.is(outcome.totalLines, -0) || outcome.totalLines < 0 ||
    !Number.isSafeInteger(outcome.tetrisNumerator) || Object.is(outcome.tetrisNumerator, -0) || outcome.tetrisNumerator < 0 ||
    !Number.isSafeInteger(outcome.tetrisDenominator) || Object.is(outcome.tetrisDenominator, -0) || outcome.tetrisDenominator < 0) {
    throw new D1RuntimeError('malformed evaluation outcome');
  }
  assertCanonicalNumber(outcome.scoreRate, 'malformed evaluation outcome');
  assertCanonicalNumber(outcome.tetrisShare, 'malformed evaluation outcome');
  const counts = outcome.clearCounts;
  if (counts === null || typeof counts !== 'object' ||
    !Number.isSafeInteger(counts.singles) || Object.is(counts.singles, -0) || counts.singles < 0 ||
    !Number.isSafeInteger(counts.doubles) || Object.is(counts.doubles, -0) || counts.doubles < 0 ||
    !Number.isSafeInteger(counts.triples) || Object.is(counts.triples, -0) || counts.triples < 0 ||
    !Number.isSafeInteger(counts.tetrises) || Object.is(counts.tetrises, -0) || counts.tetrises < 0) {
    throw new D1RuntimeError('malformed evaluation outcome');
  }
  const totalLines = counts.singles + 2 * counts.doubles + 3 * counts.triples + 4 * counts.tetrises;
  const denominator = totalLines;
  const nonCapContexts = 4 - outcome.pieceCapContexts;
  const minimumPossibleSum = outcome.pieceCapContexts * 128 + nonCapContexts * outcome.minPieces;
  const maximumPossibleSum = outcome.pieceCapContexts === 4
    ? 512
    : outcome.pieceCapContexts * 128 + outcome.minPieces + (nonCapContexts - 1) * 127;
  if (outcome.minPieces > 128 || outcome.sumPieces > 512 ||
    (outcome.pieceCapContexts === 4
      ? outcome.minPieces !== 128 || outcome.sumPieces !== 512
      : outcome.minPieces >= 128 || outcome.sumPieces < minimumPossibleSum || outcome.sumPieces > maximumPossibleSum) ||
    outcome.totalLines !== totalLines ||
    outcome.totalTetrises !== counts.tetrises || outcome.tetrisNumerator !== 4 * counts.tetrises ||
    outcome.tetrisDenominator !== denominator || outcome.tetrisShare !== (denominator === 0 ? 0 : outcome.tetrisNumerator / denominator) ||
    outcome.scoreRate !== outcome.sumScore / 512) {
    throw new D1RuntimeError('contradictory evaluation outcome');
  }
}

function deriveExactOutcomeEvidence(
  placementIds: readonly string[],
  outcomes: readonly D1PlacementOutcome[],
): Readonly<{
  survivalOracle: readonly [number, number, number];
  jointFrontPlacementIds: readonly string[];
}> {
  const placementCount = placementCardinality(placementIds, [outcomes], 'malformed outcome evidence');
  for (let index = 0; index < placementCount; index += 1) assertOutcome(outcomes[index]!, placementIds[index]!);
  const survivalOracle = outcomes.reduce<readonly [number, number, number]>((best, outcome) => {
    const tuple = [outcome.pieceCapContexts, outcome.minPieces, outcome.sumPieces] as const;
    return compareSurvival(tuple, best) > 0 ? tuple : best;
  }, [0, 0, 0] as const);
  const tier = outcomes.filter((outcome) => compareSurvival(
    [outcome.pieceCapContexts, outcome.minPieces, outcome.sumPieces],
    survivalOracle,
  ) === 0);
  const jointFrontPlacementIds = tier.filter((candidate) => !tier.some((other) => {
    if (other === candidate || other.sumScore < candidate.sumScore) return false;
    const tetrisComparison = compareTetrisFractions(
      other.tetrisNumerator,
      other.tetrisDenominator,
      candidate.tetrisNumerator,
      candidate.tetrisDenominator,
    );
    return tetrisComparison >= 0 && (other.sumScore > candidate.sumScore || tetrisComparison > 0);
  })).map(({ placementId }) => placementId);
  return { survivalOracle, jointFrontPlacementIds };
}

function assertExactOutcomeEvidence(input: {
  placementIds: readonly string[];
  outcomes: readonly D1PlacementOutcome[];
  survivalOracle: readonly [number, number, number];
  jointFrontPlacementIds: readonly string[];
}, detail: string): void {
  const exact = deriveExactOutcomeEvidence(input.placementIds, input.outcomes);
  if (!Array.isArray(input.survivalOracle) || input.survivalOracle.length !== 3 ||
    input.survivalOracle.some((value) => !Number.isSafeInteger(value) || Object.is(value, -0) || value < 0) ||
    compareSurvival(input.survivalOracle, exact.survivalOracle) !== 0 ||
    !Array.isArray(input.jointFrontPlacementIds) ||
    input.jointFrontPlacementIds.length !== exact.jointFrontPlacementIds.length ||
    input.jointFrontPlacementIds.some((placementId, index) => placementId !== exact.jointFrontPlacementIds[index])) {
    throw new D1RuntimeError(detail);
  }
}

function assertHeldOutEvidence(subset: D1HeldOutSubset): void {
  assertExactOutcomeEvidence(subset, 'malformed held-out evidence');
}

function assertEvaluationSubset(subset: D1EvaluationSubset, dimensions: number): void {
  if (subset === null || typeof subset !== 'object' || typeof subset.subsetId !== 'string' || subset.subsetId.length === 0 ||
    !Number.isSafeInteger(subset.groupOrdinal) || subset.groupOrdinal < 0) {
    throw new D1RuntimeError('malformed evaluation subset');
  }
  const placementCount = placementCardinality(
    subset.placementIds,
    [subset.features, subset.outcomes],
    'malformed evaluation subset',
  );
  for (let placementIndex = 0; placementIndex < placementCount; placementIndex += 1) {
    const placementId = subset.placementIds[placementIndex];
    if (typeof placementId !== 'string' || placementId.length === 0 ||
      placementIndex > 0 && subset.placementIds[placementIndex - 1]!.localeCompare(placementId) >= 0) {
      throw new D1RuntimeError('malformed evaluation subset');
    }
    assertCanonicalVector(subset.features[placementIndex], dimensions, 'malformed evaluation features');
  }
  assertExactOutcomeEvidence(subset, 'malformed evaluation evidence');
}

function assertFitResult(fit: D1FitResult, representationId: D1RepresentationId): void {
  const dimensions = expectedDimensions(representationId);
  if (fit === null || typeof fit !== 'object' || fit.representationId !== representationId || !D1_LAMBDAS.includes(fit.lambda) ||
    !Number.isSafeInteger(fit.iterationCount) || fit.iterationCount < 0) throw new D1RuntimeError('malformed fit result');
  assertCanonicalNumber(fit.gradientNorm, 'malformed fit result');
  assertCanonicalVector(fit.weights, dimensions, 'malformed fit result');
  assertCanonicalVector(fit.normalization.mean, dimensions, 'malformed fit result');
  assertCanonicalVector(fit.normalization.std, dimensions, 'malformed fit result');
  assertLowercaseDigest(fit.weightDigest, 'malformed fit result');
  assertLowercaseDigest(fit.normalizationDigest, 'malformed fit result');
  if (binary64Digest(fit.weights) !== fit.weightDigest || normalizationDigest(fit.normalization) !== fit.normalizationDigest) {
    throw new D1RuntimeError('fit digest mismatch');
  }
}

function selectedPlacementId(
  placementIds: readonly string[],
  features: readonly (readonly number[])[],
  model: D1FinalModel,
): string {
  let selected = 0;
  let selectedLogit = Number.NEGATIVE_INFINITY;
  for (let placementIndex = 0; placementIndex < placementIds.length; placementIndex += 1) {
    let logit = +0;
    for (let dimension = 0; dimension < model.weights.length; dimension += 1) {
      const normalized = model.normalization.std[dimension] === 0
        ? +0
        : finite((features[placementIndex]![dimension]! - model.normalization.mean[dimension]!) /
          model.normalization.std[dimension]!, 'non-finite validation normalization');
      logit = finite(logit + finite(model.weights[dimension]! * normalized, 'non-finite validation logit product'),
        'non-finite validation logit');
    }
    if (logit > selectedLogit || logit === selectedLogit && placementIds[placementIndex]!.localeCompare(placementIds[selected]!) < 0) {
      selected = placementIndex;
      selectedLogit = logit;
    }
  }
  return placementIds[selected]!;
}

function normalizationDigest(stats: D1Normalization): string {
  const values: number[] = [];
  for (let dimension = 0; dimension < stats.mean.length; dimension += 1) {
    values.push(stats.mean[dimension]!, stats.std[dimension]!);
  }
  return binary64Digest(values);
}

function validateFitSubsets(subsets: readonly D1FitSubset[]): number {
  if (subsets.length === 0) throw new D1RuntimeError('empty fit subsets');
  let dimensions = 0;
  for (let subsetIndex = 0; subsetIndex < subsets.length; subsetIndex += 1) {
    const subset = subsets[subsetIndex]!;
    if (Object.prototype.hasOwnProperty.call(subset, 'split')) throw new D1RuntimeError('split-tagged subset');
    if (typeof subset.subsetId !== 'string' || subset.subsetId.length === 0) throw new D1RuntimeError('malformed fit subset');
    const placementCount = placementCardinality(
      subset.placementIds,
      [subset.features, subset.q],
      'malformed fit subset',
    );
    for (let placementIndex = 0; placementIndex < placementCount; placementIndex += 1) {
      const row = subset.features[placementIndex]!;
      if (subsetIndex === 0 && placementIndex === 0) {
        dimensions = row.length;
        if (dimensions === 0) throw new D1RuntimeError('empty feature row');
      }
      if (row.length !== dimensions || !row.every(Number.isFinite) ||
        typeof subset.placementIds[placementIndex] !== 'string' || subset.placementIds[placementIndex]!.length === 0 ||
        placementIndex > 0 && subset.placementIds[placementIndex - 1]!.localeCompare(subset.placementIds[placementIndex]!) >= 0 ||
        !Number.isFinite(subset.q[placementIndex]) || subset.q[placementIndex]! < 0) {
        throw new D1RuntimeError('malformed fit row');
      }
    }
  }
  return dimensions;
}

export function normalizeD1Rows(subsets: readonly D1FitSubset[]): D1NormalizedRows {
  const dimensions = validateFitSubsets(subsets);
  const rowCount = subsets.reduce((sum, subset) => sum + subset.placementIds.length, 0);
  const mean = new Array<number>(dimensions);
  const std = new Array<number>(dimensions);

  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    let sum = +0;
    for (let subsetIndex = 0; subsetIndex < subsets.length; subsetIndex += 1) {
      const features = subsets[subsetIndex]!.features;
      for (let placementIndex = 0; placementIndex < features.length; placementIndex += 1) {
        sum = finite(sum + features[placementIndex]![dimension]!, 'non-finite normalization sum');
      }
    }
    mean[dimension] = finite(sum / rowCount, 'non-finite normalization mean');

    let squared = +0;
    for (let subsetIndex = 0; subsetIndex < subsets.length; subsetIndex += 1) {
      const features = subsets[subsetIndex]!.features;
      for (let placementIndex = 0; placementIndex < features.length; placementIndex += 1) {
        const delta = finite(features[placementIndex]![dimension]! - mean[dimension]!, 'non-finite normalization delta');
        squared = finite(squared + finite(delta * delta, 'non-finite squared delta'), 'non-finite variance sum');
      }
    }
    const variance = finite(squared / rowCount, 'non-finite variance');
    if (variance < 0) throw new D1RuntimeError('negative variance');
    std[dimension] = variance === 0 ? +0 : finite(Math.sqrt(variance), 'non-finite standard deviation');
  }

  const rows: number[][] = [];
  for (let subsetIndex = 0; subsetIndex < subsets.length; subsetIndex += 1) {
    const features = subsets[subsetIndex]!.features;
    for (let placementIndex = 0; placementIndex < features.length; placementIndex += 1) {
      const normalized = new Array<number>(dimensions);
      for (let dimension = 0; dimension < dimensions; dimension += 1) {
        normalized[dimension] = std[dimension] === 0
          ? +0
          : finite((features[placementIndex]![dimension]! - mean[dimension]!) / std[dimension]!, 'non-finite normalized value');
      }
      rows.push(normalized);
    }
  }

  const stats = { mean, std };
  return { rows, stats, digest: normalizationDigest(stats) };
}

export function serializeD1FitDigest(input: {
  representationId: D1RepresentationId;
  lambda: typeof D1_LAMBDAS[number];
  normalization: D1Normalization;
  weights: readonly number[];
  gradientNorm: number;
  iterationCount: number;
}): string {
  if ((input.representationId !== 'afterstate13' && input.representationId !== 'action24') ||
    !D1_LAMBDAS.includes(input.lambda) || input.normalization.mean.length !== input.normalization.std.length ||
    input.normalization.mean.length !== input.weights.length || !Number.isInteger(input.iterationCount) || input.iterationCount < 0) {
    throw new D1RuntimeError('invalid fit digest record');
  }
  const canonical = {
    representationId: input.representationId,
    lambda: input.lambda,
    normalization: {
      mean: input.normalization.mean.map((value) => canonicalZero(finite(value, 'non-finite normalization mean'))),
      std: input.normalization.std.map((value) => canonicalZero(finite(value, 'non-finite normalization standard deviation'))),
    },
    weights: input.weights.map((value) => canonicalZero(finite(value, 'non-finite weight'))),
    gradientNorm: canonicalZero(finite(input.gradientNorm, 'non-finite gradient norm')),
    iterationCount: input.iterationCount,
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

interface Evaluation {
  readonly objective: number;
  readonly gradient: readonly number[];
  readonly hessian: readonly (readonly number[])[];
}

function validateSolverInput(input: D1FitInput): number {
  if (!D1_LAMBDAS.includes(input.lambda) ||
    (input.representationId !== 'afterstate13' && input.representationId !== 'action24')) {
    throw new D1RuntimeError('invalid fit contract');
  }
  const dimensions = validateFitSubsets(input.subsets);
  if (dimensions !== expectedDimensions(input.representationId)) {
    throw new D1RuntimeError('fit dimension mismatch');
  }
  return dimensions;
}

function softmax(features: readonly (readonly number[])[], weights: readonly number[]): {
  p: number[];
  logP: number[];
} {
  const placementCount = features.length;
  const logits = new Array<number>(placementCount);
  for (let placementIndex = 0; placementIndex < placementCount; placementIndex += 1) {
    let logit = +0;
    for (let dimension = 0; dimension < weights.length; dimension += 1) {
      const product = finite(weights[dimension]! * features[placementIndex]![dimension]!, 'non-finite logit product');
      logit = finite(logit + product, 'non-finite logit');
    }
    logits[placementIndex] = logit;
  }

  let maxLogit = logits[0]!;
  for (let placementIndex = 1; placementIndex < placementCount; placementIndex += 1) {
    if (logits[placementIndex]! > maxLogit) maxLogit = logits[placementIndex]!;
  }
  const terms = new Array<number>(placementCount);
  let denominator = +0;
  for (let placementIndex = 0; placementIndex < placementCount; placementIndex += 1) {
    const term = finite(Math.exp(logits[placementIndex]! - maxLogit), 'non-finite softmax term');
    terms[placementIndex] = term;
    denominator = finite(denominator + term, 'non-finite softmax denominator');
  }
  if (!(denominator > 0)) throw new D1RuntimeError('invalid softmax denominator');
  const logDenominator = finite(Math.log(denominator), 'non-finite log denominator');
  const p = new Array<number>(placementCount);
  const logP = new Array<number>(placementCount);
  for (let placementIndex = 0; placementIndex < placementCount; placementIndex += 1) {
    p[placementIndex] = finite(terms[placementIndex]! / denominator, 'non-finite probability');
    logP[placementIndex] = finite((logits[placementIndex]! - maxLogit) - logDenominator, 'non-finite log probability');
  }
  return { p, logP };
}

function objective(
  subsets: readonly D1FitSubset[],
  weights: readonly number[],
  lambda: number,
  subsetProbabilities?: readonly ReturnType<typeof softmax>[],
): number {
  const subsetLosses = new Array<number>(subsets.length);
  for (let subsetIndex = 0; subsetIndex < subsets.length; subsetIndex += 1) {
    const subset = subsets[subsetIndex]!;
    const probabilities = subsetProbabilities?.[subsetIndex] ?? softmax(subset.features, weights);
    let subsetLoss = +0;
    for (let placementIndex = 0; placementIndex < subset.placementIds.length; placementIndex += 1) {
      subsetLoss = finite(
        subsetLoss + finite(-subset.q[placementIndex]! * probabilities.logP[placementIndex]!, 'non-finite loss term'),
        'non-finite subset loss',
      );
    }
    subsetLosses[subsetIndex] = subsetLoss;
  }
  let loss = finite(
    subsetLosses.reduce((sum, value) => finite(sum + value, 'non-finite loss'), +0) / subsetLosses.length,
    'non-finite mean loss',
  );
  for (let dimension = 0; dimension < weights.length; dimension += 1) {
    loss = finite(loss + finite(lambda / 2 * weights[dimension]! * weights[dimension]!, 'non-finite regularizer'),
      'non-finite regularized loss');
  }
  return loss;
}

function evaluate(subsets: readonly D1FitSubset[], weights: readonly number[], lambda: number): Evaluation {
  const subsetProbabilities = new Array<ReturnType<typeof softmax>>(subsets.length);
  for (let subsetIndex = 0; subsetIndex < subsets.length; subsetIndex += 1) {
    subsetProbabilities[subsetIndex] = softmax(subsets[subsetIndex]!.features, weights);
  }
  const loss = objective(subsets, weights, lambda, subsetProbabilities);

  const gradient = new Array<number>(weights.length);
  for (let dimension = 0; dimension < weights.length; dimension += 1) {
    gradient[dimension] = +0;
    for (let subsetIndex = 0; subsetIndex < subsets.length; subsetIndex += 1) {
      const subset = subsets[subsetIndex]!;
      const p = subsetProbabilities[subsetIndex]!.p;
      let local = +0;
      for (let placementIndex = 0; placementIndex < subset.placementIds.length; placementIndex += 1) {
        local = finite(local + finite((p[placementIndex]! - subset.q[placementIndex]!) *
          subset.features[placementIndex]![dimension]!, 'non-finite gradient term'), 'non-finite local gradient');
      }
      gradient[dimension] = finite(gradient[dimension]! + local / subsets.length, 'non-finite gradient');
    }
    gradient[dimension] = finite(gradient[dimension]! + lambda * weights[dimension]!, 'non-finite regularized gradient');
  }

  const hessian = Array.from({ length: weights.length }, () => new Array<number>(weights.length).fill(+0));
  for (let subsetIndex = 0; subsetIndex < subsets.length; subsetIndex += 1) {
    const features = subsets[subsetIndex]!.features;
    const p = subsetProbabilities[subsetIndex]!.p;
    const mu = new Array<number>(weights.length);
    for (let dimension = 0; dimension < weights.length; dimension += 1) {
      mu[dimension] = +0;
      for (let placementIndex = 0; placementIndex < features.length; placementIndex += 1) {
        mu[dimension] = finite(mu[dimension]! + p[placementIndex]! * features[placementIndex]![dimension]!, 'non-finite Hessian mean');
      }
    }
    for (let dimension = 0; dimension < weights.length; dimension += 1) {
      for (let column = 0; column < weights.length; column += 1) {
        let local = +0;
        for (let placementIndex = 0; placementIndex < features.length; placementIndex += 1) {
          local = finite(local + p[placementIndex]! * (features[placementIndex]![dimension]! - mu[dimension]!) *
            (features[placementIndex]![column]! - mu[column]!), 'non-finite Hessian term');
        }
        hessian[dimension]![column] = finite(hessian[dimension]![column]! + local / subsets.length, 'non-finite Hessian');
      }
    }
  }
  for (let dimension = 0; dimension < weights.length; dimension += 1) {
    hessian[dimension]![dimension] = finite(hessian[dimension]![dimension]! + lambda, 'non-finite regularized Hessian');
  }
  return { objective: loss, gradient, hessian };
}

export function fitD1Representation(input: D1FitInput): D1FitResult {
  const dimensions = validateSolverInput(input);
  const normalized = normalizeD1Rows(input.subsets);
  let rowOffset = 0;
  const normalizedSubsets = input.subsets.map((subset) => {
    const nextRowOffset = rowOffset + subset.placementIds.length;
    const normalizedSubset = {
      subsetId: subset.subsetId,
      placementIds: subset.placementIds,
      features: normalized.rows.slice(rowOffset, nextRowOffset),
      q: subset.q,
    };
    rowOffset = nextRowOffset;
    return normalizedSubset;
  });
  const fitted = runD1NewtonController({
    initialWeights: new Array<number>(dimensions).fill(+0),
    evaluateSystem: (weights) => evaluate(normalizedSubsets, weights, input.lambda),
    evaluateObjective: (weights) => objective(normalizedSubsets, weights, input.lambda),
    solveDirection: solveD1NewtonDirection,
  });
  return {
    representationId: input.representationId,
    lambda: input.lambda,
    normalizationDigest: normalized.digest,
    weightDigest: binary64Digest(fitted.weights),
    gradientNorm: fitted.gradientNorm,
    iterationCount: fitted.iterationCount,
    weights: fitted.weights,
    normalization: normalized.stats,
  };
}

export function selectD1LambdaStructural(input: {
  representationId: D1RepresentationId;
  fits: readonly D1FitResult[];
  validation: readonly D1EvaluationSubset[];
}): D1ValidationSelection {
  const dimensions = expectedDimensions(input.representationId);
  if (input.validation.length !== 32) {
    throw new D1RuntimeError('incomplete validation selection input');
  }
  const seenSubsetIds = new Set<string>();
  for (const subset of input.validation) {
    assertEvaluationSubset(subset, dimensions);
    if (seenSubsetIds.has(subset.subsetId)) throw new D1RuntimeError('duplicate validation subset');
    seenSubsetIds.add(subset.subsetId);
  }
  const presentLambdas = new Set<number>();
  const candidates = input.fits.map((fit) => {
    assertFitResult(fit, input.representationId);
    presentLambdas.add(fit.lambda);
    let survivalBelow = 0;
    let frontHits = 0;
    for (const subset of input.validation) {
      const placementId = selectedPlacementId(subset.placementIds, subset.features, fit);
      const outcomeIndex = subset.placementIds.indexOf(placementId);
      const outcome = subset.outcomes[outcomeIndex]!;
      const tuple = [outcome.pieceCapContexts, outcome.minPieces, outcome.sumPieces] as const;
      if (compareSurvival(tuple, subset.survivalOracle) < 0) survivalBelow += 1;
      if (subset.jointFrontPlacementIds.includes(placementId)) frontHits += 1;
    }
    return { fit, survivalBelow, frontHits };
  });
  if (D1_LAMBDAS.some((lambda) => !presentLambdas.has(lambda))) throw new D1RuntimeError('all five lambdas are required');
  candidates.sort((left, right) => left.survivalBelow - right.survivalBelow ||
    right.frontHits - left.frontHits || right.fit.lambda - left.fit.lambda ||
    left.fit.weightDigest.localeCompare(right.fit.weightDigest));
  const winner = candidates[0]!;
  const publicProjection = {
    representationId: winner.fit.representationId,
    lambda: winner.fit.lambda,
    normalizationDigest: winner.fit.normalizationDigest,
    weightDigest: winner.fit.weightDigest,
    gradientNorm: winner.fit.gradientNorm,
    iterationCount: winner.fit.iterationCount,
    weights: [...winner.fit.weights],
    normalization: { mean: [...winner.fit.normalization.mean], std: [...winner.fit.normalization.std] },
    validationSurvivalBelowSubsetOracle: winner.survivalBelow,
    validationSubsetJointFrontHits: winner.frontHits,
  };
  const validationSelectionDigest = canonicalDigest({
    representationId: publicProjection.representationId,
    lambda: publicProjection.lambda,
    normalizationDigest: publicProjection.normalizationDigest,
    weightDigest: publicProjection.weightDigest,
    gradientNorm: publicProjection.gradientNorm,
    iterationCount: publicProjection.iterationCount,
    weights: publicProjection.weights,
    normalizationMean: publicProjection.normalization.mean,
    normalizationStd: publicProjection.normalization.std,
    validationSurvivalBelowSubsetOracle: publicProjection.validationSurvivalBelowSubsetOracle,
    validationSubsetJointFrontHits: publicProjection.validationSubsetJointFrontHits,
  });
  const selection = deepFreeze({ ...publicProjection, validationSelectionDigest });
  validationSelectionCapabilities.set(selection, Object.freeze({
    representationId: input.representationId,
    lambda: winner.fit.lambda,
    validationSelectionDigest,
  }));
  return selection;
}

function assertFrozenSelection(
  value: unknown,
  representationId: D1RepresentationId,
): { selection: D1ValidationSelection; capture: Readonly<{
  representationId: D1RepresentationId;
  lambda: typeof D1_LAMBDAS[number];
  validationSelectionDigest: string;
}> } {
  if (value === null || typeof value !== 'object') throw new D1RuntimeError('unrecognized validation selection capability');
  const capture = validationSelectionCapabilities.get(value);
  if (!capture) throw new D1RuntimeError('unrecognized validation selection capability');
  const selection = value as D1ValidationSelection;
  if (!Object.isFrozen(selection) || capture.representationId !== representationId || selection.representationId !== capture.representationId ||
    selection.lambda !== capture.lambda || selection.validationSelectionDigest !== capture.validationSelectionDigest) {
    throw new D1RuntimeError('validation selection capability mismatch');
  }
  assertFitResult(selection, representationId);
  return { selection, capture };
}

function assertRefitSubsets(
  subsets: readonly D1FitSubset[],
  requiredCount: number,
  dimensions: number,
  seen: Set<string>,
): void {
  if (!Array.isArray(subsets) || subsets.length !== requiredCount) throw new D1RuntimeError('incorrect refit subset count');
  validateFitSubsets(subsets);
  for (const subset of subsets) {
    if (seen.has(subset.subsetId)) throw new D1RuntimeError('duplicate refit subset');
    seen.add(subset.subsetId);
    if (subset.features.some((row: readonly number[]) => row.length !== dimensions)) throw new D1RuntimeError('refit dimension mismatch');
  }
}

function copiedFinalModel(model: D1FitResult): D1FinalModel {
  assertFitResult(model, model.representationId);
  return deepFreeze({
    representationId: model.representationId,
    lambda: model.lambda,
    normalizationDigest: model.normalizationDigest,
    weightDigest: model.weightDigest,
    gradientNorm: model.gradientNorm,
    iterationCount: model.iterationCount,
    weights: [...model.weights],
    normalization: { mean: [...model.normalization.mean], std: [...model.normalization.std] },
  });
}

export function freezeD1FinalModelsStructural(input: {
  selections: Readonly<Record<D1RepresentationId, D1ValidationSelection>>;
  train: Readonly<Record<D1RepresentationId, readonly D1FitSubset[]>>;
  validation: Readonly<Record<D1RepresentationId, readonly D1FitSubset[]>>;
  fitRepresentation?: typeof fitD1Representation;
}): D1FinalModelBundle {
  const exactRepresentations = (value: unknown): boolean => value !== null && typeof value === 'object' &&
    Object.keys(value).length === 2 && Object.prototype.hasOwnProperty.call(value, 'afterstate13') &&
    Object.prototype.hasOwnProperty.call(value, 'action24');
  if (input?.selections === null || typeof input?.selections !== 'object' ||
    !Object.prototype.hasOwnProperty.call(input.selections, 'afterstate13') ||
    !Object.prototype.hasOwnProperty.call(input.selections, 'action24')) {
    throw new D1RuntimeError('both selected representations are required');
  }
  if (!exactRepresentations(input.selections) || !exactRepresentations(input.train) || !exactRepresentations(input.validation)) {
    throw new D1RuntimeError('exact representation identities are required');
  }
  const afterstate13 = assertFrozenSelection(input.selections.afterstate13, 'afterstate13');
  const action24 = assertFrozenSelection(input.selections.action24, 'action24');
  const afterstateSeen = new Set<string>();
  const actionSeen = new Set<string>();
  assertRefitSubsets(input.train.afterstate13, 80, 13, afterstateSeen);
  assertRefitSubsets(input.validation.afterstate13, 32, 13, afterstateSeen);
  assertRefitSubsets(input.train.action24, 80, 24, actionSeen);
  assertRefitSubsets(input.validation.action24, 32, 24, actionSeen);
  const assertMatchingIdentities = (left: readonly D1FitSubset[], right: readonly D1FitSubset[]): void => {
    for (let index = 0; index < left.length; index += 1) {
      if (left[index]!.subsetId !== right[index]!.subsetId || left[index]!.placementIds.length !== right[index]!.placementIds.length ||
        left[index]!.placementIds.some((placementId, placementIndex) => placementId !== right[index]!.placementIds[placementIndex])) {
        throw new D1RuntimeError('refit representation identity mismatch');
      }
    }
  };
  assertMatchingIdentities(input.train.afterstate13, input.train.action24);
  assertMatchingIdentities(input.validation.afterstate13, input.validation.action24);

  const fitRepresentation = input.fitRepresentation ?? fitD1Representation;
  const afterstate13Model = copiedFinalModel(fitRepresentation({
    representationId: afterstate13.capture.representationId,
    lambda: afterstate13.capture.lambda,
    subsets: [...input.train.afterstate13, ...input.validation.afterstate13],
  }));
  const action24Model = copiedFinalModel(fitRepresentation({
    representationId: action24.capture.representationId,
    lambda: action24.capture.lambda,
    subsets: [...input.train.action24, ...input.validation.action24],
  }));
  const bundle = deepFreeze({ models: { afterstate13: afterstate13Model, action24: action24Model } });
  structuralFinalModelBundleCapabilities.add(bundle);
  return bundle;
}

export function assertD1StructuralFinalModelBundle(value: unknown): asserts value is D1FinalModelBundle {
  if (value === null || typeof value !== 'object' || !structuralFinalModelBundleCapabilities.has(value)) {
    throw new D1RuntimeError('unrecognized model freeze capability');
  }
}

function fitSubsetsFromBatch(
  batch: D1AuthenticatedLabeledBatch,
  representationId: D1RepresentationId,
): readonly D1FitSubset[] {
  return batch.subsets.map((subset) => ({
    subsetId: subset.subsetId,
    placementIds: subset.placementIds,
    features: subset[representationId],
    q: subset.q,
  }));
}

function evaluationSubsetsFromBatch(
  batch: D1AuthenticatedLabeledBatch,
  representationId: D1RepresentationId,
): readonly D1EvaluationSubset[] {
  return batch.subsets.map((subset) => ({
    subsetId: subset.subsetId,
    groupOrdinal: subset.groupOrdinal,
    placementIds: subset.placementIds,
    features: subset[representationId],
    outcomes: subset.outcomes,
    survivalOracle: subset.survivalOracle,
    jointFrontPlacementIds: subset.jointFrontPlacementIds,
  }));
}

function heldOutSubsetsFromBatch(batch: D1AuthenticatedLabeledBatch): readonly D1HeldOutSubset[] {
  return batch.subsets.map((subset) => ({
    subsetId: subset.subsetId,
    groupOrdinal: subset.groupOrdinal,
    placementIds: subset.placementIds,
    afterstate13: subset.afterstate13,
    action24: subset.action24,
    outcomes: subset.outcomes,
    survivalOracle: subset.survivalOracle,
    jointFrontPlacementIds: subset.jointFrontPlacementIds,
  }));
}

function useSet<K extends object, V>(registry: WeakMap<K, Set<V>>, key: K): Set<V> {
  let used = registry.get(key);
  if (!used) {
    used = new Set<V>();
    registry.set(key, used);
  }
  return used;
}

export function fitD1TrainingRepresentation(input: {
  readonly representationId: D1RepresentationId;
  readonly lambda: typeof D1_LAMBDAS[number];
  readonly train: D1AuthenticatedLabeledBatch;
}): D1FitResult {
  const authority = requireD1LabeledBatchAuthority(input.train, 'train');
  const useKey = `${input.representationId}:${input.lambda}`;
  const used = useSet(fitUsesByRun, authority.runIdentity);
  if (used.has(useKey)) throw new D1RuntimeError('duplicate authenticated training fit');
  const fit = deepFreeze(fitD1Representation({
    representationId: input.representationId,
    lambda: input.lambda,
    subsets: fitSubsetsFromBatch(input.train, input.representationId),
  }));
  used.add(useKey);
  trainingFitCapabilities.set(fit, {
    runIdentity: authority.runIdentity,
    trainBatch: input.train,
    representationId: input.representationId,
    lambda: input.lambda,
  });
  return fit;
}

export function selectD1Lambda(input: {
  readonly representationId: D1RepresentationId;
  readonly fits: readonly D1FitResult[];
  readonly validation: D1AuthenticatedLabeledBatch;
}): D1ValidationSelection {
  const validationAuthority = requireD1LabeledBatchAuthority(input.validation, 'validation');
  if (!Array.isArray(input.fits) || input.fits.length !== D1_LAMBDAS.length) {
    throw new D1RuntimeError('exact five authenticated fits are required');
  }
  let trainBatch: D1AuthenticatedLabeledBatch | undefined;
  const seenTuples = new Set<string>();
  for (const fit of input.fits) {
    const record = fit !== null && typeof fit === 'object' ? trainingFitCapabilities.get(fit) : undefined;
    if (!record || record.representationId !== input.representationId || record.runIdentity !== validationAuthority.runIdentity) {
      throw new D1RuntimeError('unrecognized authenticated training fit');
    }
    if (trainBatch !== undefined && trainBatch !== record.trainBatch) {
      throw new D1RuntimeError('mixed authenticated train batches');
    }
    trainBatch = record.trainBatch;
    const tuple = `${record.representationId}:${record.lambda}`;
    if (seenTuples.has(tuple)) throw new D1RuntimeError('duplicate representation lambda tuple');
    seenTuples.add(tuple);
  }
  if (!trainBatch || D1_LAMBDAS.some((lambda) => !seenTuples.has(`${input.representationId}:${lambda}`))) {
    throw new D1RuntimeError('exact five authenticated fits are required');
  }
  const usedSelections = useSet(selectionUsesByRun, validationAuthority.runIdentity);
  if (usedSelections.has(input.representationId)) throw new D1RuntimeError('duplicate validation selection');
  const selection = selectD1LambdaStructural({
    representationId: input.representationId,
    fits: input.fits,
    validation: evaluationSubsetsFromBatch(input.validation, input.representationId),
  });
  usedSelections.add(input.representationId);
  selectionCapabilities.set(selection, {
    runIdentity: validationAuthority.runIdentity,
    trainBatch,
    validationBatch: input.validation,
    representationId: input.representationId,
    lambda: selection.lambda,
  });
  return selection;
}

type D1AuthenticatedFinalRefitInput = {
  readonly selections: Readonly<Record<D1RepresentationId, D1ValidationSelection>>;
  readonly train: D1AuthenticatedLabeledBatch;
  readonly validation: D1AuthenticatedLabeledBatch;
};

function assertD1FinalFreezeState(runIdentity: D1OpaqueRunIdentity): void {
  switch (finalFreezeStatesByRun.get(runIdentity)) {
    case undefined:
      return;
    case 'in-flight':
      throw new D1RuntimeError('final model freeze already in flight');
    case 'materialized':
      throw new D1RuntimeError('final model run already materialized');
    case 'failed':
      throw new D1RuntimeError('final model run already failed');
  }
}

function refitD1AuthenticatedFinalModels(
  input: D1AuthenticatedFinalRefitInput,
  fitterForRun: (runIdentity: D1OpaqueRunIdentity) => typeof fitD1Representation,
): Readonly<{ runIdentity: D1OpaqueRunIdentity; bundle: D1FinalModelBundle }> {
  const trainAuthority = requireD1LabeledBatchAuthority(input.train, 'train');
  const validationAuthority = requireD1LabeledBatchAuthority(input.validation, 'validation');
  if (trainAuthority.runIdentity !== validationAuthority.runIdentity) throw new D1RuntimeError('final model run mismatch');
  assertD1FinalFreezeState(trainAuthority.runIdentity);
  if (input.selections === null || typeof input.selections !== 'object' ||
    Object.keys(input.selections).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(input.selections, 'afterstate13') ||
    !Object.prototype.hasOwnProperty.call(input.selections, 'action24')) {
    throw new D1RuntimeError('both exact selected representations are required');
  }
  for (const representationId of ['afterstate13', 'action24'] as const) {
    const selection = input.selections[representationId];
    const record = selection !== null && typeof selection === 'object' ? selectionCapabilities.get(selection) : undefined;
    if (!record || record.runIdentity !== trainAuthority.runIdentity || record.representationId !== representationId ||
      record.trainBatch !== input.train || record.validationBatch !== input.validation) {
      throw new D1RuntimeError('unrecognized authenticated validation selection');
    }
  }
  finalFreezeStatesByRun.set(trainAuthority.runIdentity, 'in-flight');
  let bundle: D1FinalModelBundle;
  try {
    bundle = freezeD1FinalModelsStructural({
      selections: input.selections,
      train: {
        afterstate13: fitSubsetsFromBatch(input.train, 'afterstate13'),
        action24: fitSubsetsFromBatch(input.train, 'action24'),
      },
      validation: {
        afterstate13: fitSubsetsFromBatch(input.validation, 'afterstate13'),
        action24: fitSubsetsFromBatch(input.validation, 'action24'),
      },
      fitRepresentation: fitterForRun(trainAuthority.runIdentity),
    });
  } catch (error) {
    finalFreezeStatesByRun.set(trainAuthority.runIdentity, 'failed');
    throw error;
  }
  return { runIdentity: trainAuthority.runIdentity, bundle };
}

export const freezeD1FinalModels = (() => {
  const finalBundleCapabilities = new WeakMap<object, D1FinalBundleCapabilityRecord>();
  lookupD1FinalBundleCapability = (value) => finalBundleCapabilities.get(value);

  return function freezeD1FinalModels(input: {
    readonly selections: Readonly<Record<D1RepresentationId, D1ValidationSelection>>;
    readonly train: D1AuthenticatedLabeledBatch;
    readonly validation: D1AuthenticatedLabeledBatch;
  }): D1FinalModelBundle {
    const { runIdentity, bundle } = refitD1AuthenticatedFinalModels(input, () => fitD1Representation);
    finalBundleCapabilities.set(bundle, {
      runIdentity,
      trainBatch: input.train,
      validationBatch: input.validation,
      bundle,
      testState: 'unconsumed',
    });
    finalFreezeStatesByRun.set(runIdentity, 'materialized');
    return bundle;
  };
})();

export function exerciseD1FinalRefitFailureForTest(input: {
  readonly selections: Readonly<Record<D1RepresentationId, D1ValidationSelection>>;
  readonly train: D1AuthenticatedLabeledBatch;
  readonly validation: D1AuthenticatedLabeledBatch;
}): Readonly<{
  readonly attemptedRepresentations: readonly D1RepresentationId[];
  readonly firstRefitReentryError: 'final model freeze already in flight';
}> {
  const attempted: D1RepresentationId[] = [];
  let firstRefitReentryError: 'final model freeze already in flight' | undefined;
  try {
    refitD1AuthenticatedFinalModels(input, (runIdentity) => (fitInput) => {
      attempted.push(fitInput.representationId);
      if (fitInput.representationId === 'afterstate13') {
        try {
          assertD1FinalFreezeState(runIdentity);
          throw new Error('final model freeze guard unexpectedly returned');
        } catch (error) {
          if (error instanceof D1RuntimeError && error.message === 'runtime-fail: final model freeze already in flight') {
            firstRefitReentryError = 'final model freeze already in flight';
          } else {
            throw error;
          }
        }
        return fitD1Representation(fitInput);
      }
      throw d1FinalRefitFailureSentinel;
    });
  } catch (error) {
    if (error === d1FinalRefitFailureSentinel && firstRefitReentryError !== undefined) {
      return deepFreeze({ attemptedRepresentations: attempted, firstRefitReentryError });
    }
    throw error;
  }
  throw new Error('final refit failure probe unexpectedly completed');
}

export function assertD1FinalModelBundle(value: unknown): asserts value is D1FinalModelBundle {
  if (value === null || typeof value !== 'object' || lookupD1FinalBundleCapability(value)?.bundle !== value) {
    throw new D1RuntimeError('unrecognized authenticated model freeze capability');
  }
}

export function consumeD1FinalBundleForTest(
  finalModels: D1FinalModelBundle,
  expectedRunIdentity: D1OpaqueRunIdentity,
): D1FinalBundleTestAttestation {
  assertD1FinalModelBundle(finalModels);
  const record = lookupD1FinalBundleCapability(finalModels)!;
  if (record.runIdentity !== expectedRunIdentity || record.testState !== 'unconsumed') {
    throw new D1RuntimeError('runtime-fail: test-before-freeze');
  }
  const attestation = deepFreeze({ kind: 'd1-final-bundle-test-attestation' as const });
  record.testState = 'in-flight';
  record.attestation = attestation;
  finalAttestationCapabilities.set(attestation, record);
  return attestation;
}

export function failD1FinalBundleTestAttestation(attestation: D1FinalBundleTestAttestation): void {
  if (attestation === null || typeof attestation !== 'object') {
    throw new D1RuntimeError('unrecognized final bundle test attestation');
  }
  const record = finalAttestationCapabilities.get(attestation);
  if (!record || record.attestation !== attestation || record.testState !== 'in-flight') {
    throw new D1RuntimeError('unrecognized final bundle test attestation');
  }
  record.testState = 'failed';
}

function makeSelectedMetrics(
  model: D1FinalModel,
  representationId: D1RepresentationId,
  subsets: readonly D1HeldOutSubset[],
): D1SelectedMetrics {
  let survivalBelowSubsetOracle = 0;
  let subsetJointFrontHits = 0;
  let sumScore = 0;
  let tetrisNumerator = 0;
  let tetrisDenominator = 0;
  const selectedPlacementIds: string[] = [];
  const selectedSurvivalTuples: (readonly [number, number, number])[] = [];
  for (const subset of subsets) {
    const features = subset[representationId];
    if (!Array.isArray(features) || features.length !== subset.placementIds.length) {
      throw new D1RuntimeError('malformed held-out metrics');
    }
    const placementId = selectedPlacementId(subset.placementIds, features, model);
    const index = subset.placementIds.indexOf(placementId);
    if (index < 0) throw new D1RuntimeError('malformed held-out metrics');
    const outcome = subset.outcomes[index]!;
    assertOutcome(outcome, placementId);
    const tuple = [outcome.pieceCapContexts, outcome.minPieces, outcome.sumPieces] as const;
    selectedPlacementIds.push(placementId);
    selectedSurvivalTuples.push(tuple);
    if (compareSurvival(tuple, subset.survivalOracle) < 0) survivalBelowSubsetOracle += 1;
    if (subset.jointFrontPlacementIds.includes(placementId)) subsetJointFrontHits += 1;
    sumScore += outcome.sumScore;
    tetrisNumerator += outcome.tetrisNumerator;
    tetrisDenominator += outcome.tetrisDenominator;
  }
  if (subsets.length !== 48 || !Number.isSafeInteger(sumScore) || !Number.isSafeInteger(tetrisNumerator) ||
    !Number.isSafeInteger(tetrisDenominator)) throw new D1RuntimeError('malformed held-out metrics');
  return Object.freeze({
    selectedPlacementIds: Object.freeze(selectedPlacementIds),
    selectedSurvivalTuples: Object.freeze(selectedSurvivalTuples),
    survivalBelowSubsetOracle, subsetJointFrontHits, sumScore,
    scheduledPieces: 24576,
    scoreRate: sumScore / 24576,
    tetrisNumerator, tetrisDenominator,
    tetrisShare: tetrisDenominator === 0 ? 0 : tetrisNumerator / tetrisDenominator,
  });
}

function runtimeHeldOutResult(reason: D1RuntimeFailureReason): D1HeldOutResult {
  const emptyMetric = Object.freeze({
    selectedPlacementIds: Object.freeze([]), selectedSurvivalTuples: Object.freeze([]),
    survivalBelowSubsetOracle: 0, subsetJointFrontHits: 0, sumScore: 0, scheduledPieces: 24576 as const,
    scoreRate: 0, tetrisNumerator: 0, tetrisDenominator: 0, tetrisShare: 0,
  });
  const metrics = Object.freeze({ afterstate13: emptyMetric, action24: emptyMetric });
  const cardinalityMetrics = Object.freeze(Array.from({ length: 11 }, (_, index) => Object.freeze({
    selectedCount: (index + 2) as D1CardinalityMetric['selectedCount'],
    subsetCount: 0,
    afterstate13FrontHits: 0,
    action24FrontHits: 0,
    action24NonLowerSurvival: 0,
    frontDelta: 0,
  })));
  const gates = Object.freeze({
    action24OracleSafe: false, action24NonLowerSurvival: false, action24FrontHitFloor: false,
    action24FrontHitGain: false, allSeedGroupsNonNegative: false, positiveSeedGroupCount: 0,
    scoreNonLower: false, tetrisNonLower: false, jointStrictImprovement: false,
  });
  const failureReasons = Object.freeze([reason]);
  const selectedPlacementDigest = canonicalDigest({ afterstate13: [], action24: [] });
  const metricProjectionDigest = canonicalDigest({
    status: 'runtime-fail', failureReasons, metrics, cardinalityMetrics, seedGroups: [], gates,
  });
  return deepFreeze({
    status: 'runtime-fail' as const, failureReasons, metrics, cardinalityMetrics, seedGroups: [], gates,
    selectedPlacementDigest, metricProjectionDigest,
  });
}

function snapshotHeldOutSubsets(subsets: readonly D1HeldOutSubset[]): readonly D1HeldOutSubset[] {
  return deepFreeze(subsets.map((subset) => ({
    subsetId: subset.subsetId,
    groupOrdinal: subset.groupOrdinal,
    placementIds: [...subset.placementIds],
    afterstate13: subset.afterstate13.map((row) => [...row]),
    action24: subset.action24.map((row) => [...row]),
    outcomes: subset.outcomes.map((outcome) => ({
      placementId: outcome.placementId,
      pieceCapContexts: outcome.pieceCapContexts,
      minPieces: outcome.minPieces,
      sumPieces: outcome.sumPieces,
      sumScore: outcome.sumScore,
      scoreRate: outcome.scoreRate,
      totalTetrises: outcome.totalTetrises,
      totalLines: outcome.totalLines,
      tetrisNumerator: outcome.tetrisNumerator,
      tetrisDenominator: outcome.tetrisDenominator,
      tetrisShare: outcome.tetrisShare,
      clearCounts: {
        singles: outcome.clearCounts.singles, doubles: outcome.clearCounts.doubles,
        triples: outcome.clearCounts.triples, tetrises: outcome.clearCounts.tetrises,
      },
    })),
    survivalOracle: [...subset.survivalOracle] as [number, number, number],
    jointFrontPlacementIds: [...subset.jointFrontPlacementIds],
  })));
}

function heldOutInputDigest(subsets: readonly D1HeldOutSubset[]): string {
  return canonicalDigest(snapshotHeldOutSubsets(subsets));
}

export function evaluateD1HeldOutStructural(input: {
  models: D1FinalModelBundle;
  subsets: readonly D1HeldOutSubset[];
}): D1HeldOutResult {
  assertD1StructuralFinalModelBundle(input.models);
  try {
    if (!Array.isArray(input.subsets) || input.subsets.length !== 48) throw new D1RuntimeError('malformed held-out subset count');
    const sourceDigest = heldOutInputDigest(input.subsets);
    const subsets = snapshotHeldOutSubsets(input.subsets);
    const snapshotDigest = heldOutInputDigest(subsets);
    if (sourceDigest !== snapshotDigest) {
      throw new D1RuntimeError('nondeterministic replay');
    }
    const seen = new Set<string>();
    const groupCounts = new Map<number, number>();
    const cardinalityCounts = new Array<number>(11).fill(0);
    for (let subsetIndex = 0; subsetIndex < subsets.length; subsetIndex += 1) {
      const subset = subsets[subsetIndex]!;
      if (subset === null || typeof subset !== 'object' || typeof subset.subsetId !== 'string' || subset.subsetId.length === 0 ||
        !Number.isSafeInteger(subset.groupOrdinal) || subset.groupOrdinal !== Math.floor(subsetIndex / 4) ||
        subset.survivalOracle.length !== 3 || subset.jointFrontPlacementIds.length === 0 || seen.has(subset.subsetId)) {
        throw new D1RuntimeError('malformed held-out subset');
      }
      const placementCount = placementCardinality(
        subset.placementIds,
        [subset.afterstate13, subset.action24, subset.outcomes],
        'malformed held-out subset',
      );
      seen.add(subset.subsetId);
      groupCounts.set(subset.groupOrdinal, (groupCounts.get(subset.groupOrdinal) ?? 0) + 1);
      cardinalityCounts[placementCount - 2] = cardinalityCounts[placementCount - 2]! + 1;
      for (let index = 0; index < placementCount; index += 1) {
        if (typeof subset.placementIds[index] !== 'string' || index > 0 && subset.placementIds[index - 1]!.localeCompare(subset.placementIds[index]!) >= 0) {
          throw new D1RuntimeError('malformed held-out subset');
        }
        assertCanonicalVector(subset.afterstate13[index], 13, 'malformed held-out representation');
        assertCanonicalVector(subset.action24[index], 24, 'malformed held-out representation');
      }
      assertHeldOutEvidence(subset);
    }
    if (groupCounts.size !== 12 || [...groupCounts.values()].some((count) => count !== 4)) throw new D1RuntimeError('malformed held-out groups');
    const metrics = {
      afterstate13: makeSelectedMetrics(input.models.models.afterstate13, 'afterstate13', subsets),
      action24: makeSelectedMetrics(input.models.models.action24, 'action24', subsets),
    } as const;
    const cardinalityMetrics = Object.freeze(cardinalityCounts.map((subsetCount, cardinalityIndex) => {
      const selectedCount = (cardinalityIndex + 2) as D1CardinalityMetric['selectedCount'];
      let afterstate13FrontHits = 0;
      let action24FrontHits = 0;
      let action24NonLowerSurvival = 0;
      for (let subsetIndex = 0; subsetIndex < subsets.length; subsetIndex += 1) {
        const subset = subsets[subsetIndex]!;
        if (subset.placementIds.length !== selectedCount) continue;
        if (subset.jointFrontPlacementIds.includes(metrics.afterstate13.selectedPlacementIds[subsetIndex]!)) {
          afterstate13FrontHits += 1;
        }
        if (subset.jointFrontPlacementIds.includes(metrics.action24.selectedPlacementIds[subsetIndex]!)) {
          action24FrontHits += 1;
        }
        if (compareSurvival(
          metrics.action24.selectedSurvivalTuples[subsetIndex]!,
          metrics.afterstate13.selectedSurvivalTuples[subsetIndex]!,
        ) >= 0) {
          action24NonLowerSurvival += 1;
        }
      }
      return Object.freeze({
        selectedCount,
        subsetCount,
        afterstate13FrontHits,
        action24FrontHits,
        action24NonLowerSurvival,
        frontDelta: action24FrontHits - afterstate13FrontHits,
      });
    }));
    const seedGroups: D1SeedGroupMetric[] = [];
    for (let groupOrdinal = 0; groupOrdinal < 12; groupOrdinal += 1) {
      const start = groupOrdinal * 4;
      let afterstate13FrontHits = 0;
      let action24FrontHits = 0;
      for (let index = start; index < start + 4; index += 1) {
        const subset = subsets[index]!;
        if (subset.jointFrontPlacementIds.includes(metrics.afterstate13.selectedPlacementIds[index]!)) afterstate13FrontHits += 1;
        if (subset.jointFrontPlacementIds.includes(metrics.action24.selectedPlacementIds[index]!)) action24FrontHits += 1;
      }
      seedGroups.push(Object.freeze({ groupOrdinal, afterstate13FrontHits, action24FrontHits, groupFrontDelta: action24FrontHits - afterstate13FrontHits }));
    }
    const action24OracleSafe = metrics.action24.survivalBelowSubsetOracle === 0;
    const action24NonLowerSurvival = metrics.action24.selectedSurvivalTuples.every((tuple, index) =>
      compareSurvival(tuple, metrics.afterstate13.selectedSurvivalTuples[index]!) >= 0);
    const action24FrontHitFloor = metrics.action24.subsetJointFrontHits >= 36;
    const action24FrontHitGain = metrics.action24.subsetJointFrontHits - metrics.afterstate13.subsetJointFrontHits >= 8;
    const allSeedGroupsNonNegative = seedGroups.every((group) => group.groupFrontDelta >= 0);
    const positiveSeedGroupCount = seedGroups.filter((group) => group.groupFrontDelta > 0).length;
    const scoreNonLower = metrics.action24.sumScore >= metrics.afterstate13.sumScore;
    const tetrisComparison = compareTetrisFractions(
      metrics.action24.tetrisNumerator,
      metrics.action24.tetrisDenominator,
      metrics.afterstate13.tetrisNumerator,
      metrics.afterstate13.tetrisDenominator,
    );
    const tetrisNonLower = tetrisComparison >= 0;
    const jointStrictImprovement = scoreNonLower && tetrisNonLower &&
      (metrics.action24.sumScore > metrics.afterstate13.sumScore || tetrisComparison > 0);
    const gates = {
      action24OracleSafe, action24NonLowerSurvival, action24FrontHitFloor, action24FrontHitGain,
      allSeedGroupsNonNegative, positiveSeedGroupCount, scoreNonLower, tetrisNonLower, jointStrictImprovement,
    };
    const status: D1HeldOutStatus = !action24OracleSafe || !action24NonLowerSurvival || !jointStrictImprovement
      ? 'fail-joint-selection-not-shown'
      : !action24FrontHitFloor || !action24FrontHitGain || !allSeedGroupsNonNegative || positiveSeedGroupCount < 6
        ? 'fail-representation-gain-not-held-out'
        : 'pass-action-conditioned-listwise-supported';
    const failureReasons: D1StatisticalFailureReason[] = [];
    if (status === 'fail-joint-selection-not-shown') {
      if (!action24OracleSafe) failureReasons.push('action24-survival-below-subset-oracle');
      if (!action24NonLowerSurvival) failureReasons.push('action24-survival-lower-than-afterstate13');
      if (!scoreNonLower) failureReasons.push('action24-score-lower-than-afterstate13');
      if (!tetrisNonLower) failureReasons.push('action24-tetris-share-lower-than-afterstate13');
      if (!jointStrictImprovement) failureReasons.push('joint-score-and-tetris-not-strictly-higher');
    } else if (status === 'fail-representation-gain-not-held-out') {
      if (!action24FrontHitFloor) failureReasons.push('action24-front-hit-floor-not-met');
      if (!action24FrontHitGain) failureReasons.push('action24-front-hit-gain-not-met');
      if (!allSeedGroupsNonNegative) failureReasons.push('seed-group-nonnegative-floor-not-met');
      if (positiveSeedGroupCount < 6) failureReasons.push('seed-group-positive-floor-not-met');
    }
    const frozenReasons = Object.freeze(failureReasons);
    const frozenGroups = Object.freeze(seedGroups);
    const frozenGates = Object.freeze(gates);
    const selectedPlacementDigest = canonicalDigest({
      afterstate13: metrics.afterstate13.selectedPlacementIds,
      action24: metrics.action24.selectedPlacementIds,
    });
    const metricProjectionDigest = canonicalDigest({
      status, failureReasons: frozenReasons, metrics, cardinalityMetrics, seedGroups: frozenGroups, gates: frozenGates,
    });
    if (heldOutInputDigest(input.subsets) !== snapshotDigest) {
      throw new D1RuntimeError('nondeterministic replay');
    }
    return deepFreeze({
      status, failureReasons: frozenReasons, metrics, cardinalityMetrics, seedGroups: frozenGroups, gates: frozenGates,
      selectedPlacementDigest, metricProjectionDigest,
    });
  } catch (error) {
    return runtimeHeldOutResult(error instanceof D1RuntimeError && error.message.includes('nondeterministic')
      ? 'nondeterministic-replay' : 'malformed-metrics');
  }
}

export function evaluateD1HeldOut(
  finalModels: D1FinalModelBundle,
  testBatch: D1AuthenticatedLabeledBatch,
): D1HeldOutResult {
  assertD1FinalModelBundle(finalModels);
  const finalRecord = lookupD1FinalBundleCapability(finalModels)!;
  const testAuthority = requireD1LabeledBatchAuthority(testBatch, 'test');
  if (finalRecord.runIdentity !== testAuthority.runIdentity || finalRecord.testState !== 'in-flight') {
    throw new D1RuntimeError('runtime-fail: test-before-freeze');
  }
  try {
    const result = evaluateD1HeldOutStructural({
      models: finalModels,
      subsets: heldOutSubsetsFromBatch(testBatch),
    });
    finalRecord.testState = result.status === 'runtime-fail' ? 'failed' : 'materialized';
    return result;
  } catch (error) {
    finalRecord.testState = 'failed';
    throw error;
  }
}
