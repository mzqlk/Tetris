import os from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_COUNT } from '../src/ai/features';
import { searchBudgeted, type SearchDecision } from '../src/ai/search';
import {
  DEPTH_ONE_REQUIRED_WORK_UNITS,
  DETERMINISTIC_SEARCH_LIMITS,
} from '../src/ai/searchBudget';
import { BUDGET_CORPUS_V1, materializeBudgetState } from './searchBudgetCorpus';

export const BUDGET_CANDIDATE_STEP = 256;
export const SELECTION_P95_LIMIT_MS = 140;
export const VERIFICATION_P95_LIMIT_MS = 160;
export const MAX_SELECTION_CANDIDATES = 32;
export const VERIFICATION_BLOCKS = 3;
const MEASUREMENT_ROUNDS = 5;
const MEASUREMENTS_PER_CANDIDATE = MEASUREMENT_ROUNDS * BUDGET_CORPUS_V1.length;
const WEIGHTS = Object.freeze(Array(FEATURE_COUNT).fill(0));

export interface CalibrationRound {
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface CandidateMeasurement {
  budget: number;
  rounds: readonly [
    CalibrationRound,
    CalibrationRound,
    CalibrationRound,
    CalibrationRound,
    CalibrationRound,
  ];
  worstP95Ms: number;
  depthHistogram: readonly [number, number, number, number, number];
  workUnitsUsed: readonly number[];
  placementEvaluationUnits: number;
  chanceExpansionUnits: number;
  cacheHitUnits: number;
  allDepthOneComplete: boolean;
  allDepthFourComplete: boolean;
  overBudgetCount: number;
  deterministic: boolean;
  reasons: readonly string[];
}

export interface CalibrationEnvironment {
  nodeVersion: string;
  platform: string;
  release: string;
  arch: string;
  cpuModel: string;
  selectionP95LimitMs: number;
  verificationP95LimitMs: number;
  candidateStep: number;
  maxSelectionCandidates: number;
  verificationBlocks: number;
  roundsPerMeasurement: number;
  corpusSize: number;
}

export type SelectionStopReason =
  | 'all-depth-four-complete'
  | 'two-consecutive-above-verification-limit';

export interface SelectionOutput {
  mode: 'select';
  status: 'pass' | 'fail';
  corpus: 'budget-corpus-v1';
  proposedBudget: number | null;
  candidates: readonly CandidateMeasurement[];
  stopReason: SelectionStopReason | null;
  failureReasons: readonly string[];
  environment: CalibrationEnvironment;
}

export interface VerificationOutput {
  mode: 'verify-frozen';
  status: 'pass' | 'fail';
  corpus: 'budget-corpus-v1';
  frozenBudget: number;
  blocks: readonly CandidateMeasurement[];
  failureReasons: readonly string[];
  environment: CalibrationEnvironment;
}

export interface InvalidModeOutput {
  mode: 'invalid';
  status: 'fail';
  corpus: 'budget-corpus-v1';
  failureReasons: readonly ['exactly-one-calibration-mode-required'];
  environment: CalibrationEnvironment;
}

export type CalibrationOutput = SelectionOutput | VerificationOutput | InvalidModeOutput;
export type MeasurementFunction = (maxWorkUnits: number) => CandidateMeasurement;

interface CliRunResult {
  exitCode: 0 | 1;
  output: CalibrationOutput;
}

interface SelectionCoreOutput extends Omit<SelectionOutput, 'environment'> {}
interface VerificationCoreOutput extends Omit<VerificationOutput, 'environment'> {}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function measurementStructuralErrors(
  expectedBudget: number,
  measurement: CandidateMeasurement,
): string[] {
  const errors: string[] = [];
  if (measurement.budget !== expectedBudget) errors.push('budget-mismatch');
  if (!Array.isArray(measurement.rounds) || measurement.rounds.length !== MEASUREMENT_ROUNDS) {
    errors.push('round-count-must-be-five');
  }
  const validRounds = Array.isArray(measurement.rounds)
    && measurement.rounds.length === MEASUREMENT_ROUNDS
    && measurement.rounds.every((round) => finiteNonNegative(round?.p50Ms)
      && finiteNonNegative(round?.p95Ms)
      && finiteNonNegative(round?.maxMs)
      && round.p50Ms <= round.p95Ms
      && round.p95Ms <= round.maxMs);
  if (!validRounds) errors.push('invalid-round-statistics');
  if (!finiteNonNegative(measurement.worstP95Ms)) errors.push('invalid-worst-p95');
  if (validRounds) {
    const reconstructedWorstP95 = Math.max(...measurement.rounds.map((round) => round.p95Ms));
    if (measurement.worstP95Ms !== reconstructedWorstP95) errors.push('worst-p95-mismatch');
  }

  const histogram = measurement.depthHistogram;
  const validHistogram = Array.isArray(histogram)
    && histogram.length === 5
    && histogram.every(nonNegativeInteger)
    && histogram.reduce((sum, count) => sum + count, 0) === MEASUREMENTS_PER_CANDIDATE;
  if (!validHistogram) errors.push('invalid-depth-histogram');
  if (validHistogram) {
    if (measurement.allDepthOneComplete !== (histogram[0] === 0)) {
      errors.push('depth-one-completion-mismatch');
    }
    if (measurement.allDepthFourComplete !== (histogram[4] === MEASUREMENTS_PER_CANDIDATE)) {
      errors.push('depth-four-completion-mismatch');
    }
  }
  if (!measurement.allDepthOneComplete) errors.push('incomplete-depth-one');

  const workUnits = measurement.workUnitsUsed;
  const validWorkUnits = Array.isArray(workUnits)
    && workUnits.length === MEASUREMENTS_PER_CANDIDATE
    && workUnits.every(nonNegativeInteger);
  if (!validWorkUnits) errors.push('work-unit-distribution-must-have-480-integers');
  const observedOverBudget = validWorkUnits
    ? workUnits.filter((used) => used > expectedBudget).length
    : -1;
  if (!nonNegativeInteger(measurement.overBudgetCount)
    || (validWorkUnits && measurement.overBudgetCount !== observedOverBudget)) {
    errors.push('over-budget-count-mismatch');
  }
  if (measurement.overBudgetCount !== 0) errors.push('over-budget-work');

  const categoryValues = [
    measurement.placementEvaluationUnits,
    measurement.chanceExpansionUnits,
    measurement.cacheHitUnits,
  ];
  if (!categoryValues.every(nonNegativeInteger)) {
    errors.push('invalid-category-unit-total');
  } else if (validWorkUnits) {
    const categoryTotal = categoryValues.reduce((sum, value) => sum + value, 0);
    const observedTotal = workUnits.reduce((sum, value) => sum + value, 0);
    if (categoryTotal !== observedTotal) errors.push('category-unit-sum-mismatch');
  }
  if (!measurement.deterministic) errors.push('nondeterministic-search-result');
  if (!Array.isArray(measurement.reasons)
    || measurement.reasons.some((reason) => typeof reason !== 'string')) {
    errors.push('invalid-reasons');
  }
  return errors;
}

function annotateMeasurement(
  expectedBudget: number,
  measurement: CandidateMeasurement,
  mode: 'selection' | 'verification',
): { measurement: CandidateMeasurement; structuralErrors: readonly string[] } {
  const structuralErrors = measurementStructuralErrors(expectedBudget, measurement);
  const reasons = Array.isArray(measurement.reasons) ? [...measurement.reasons] : [];
  if (structuralErrors.length === 0) {
    reasons.push('structural-invariants-pass');
    if (mode === 'selection') {
      reasons.push(measurement.worstP95Ms <= SELECTION_P95_LIMIT_MS
        ? 'selection-p95-at-or-below-limit'
        : 'selection-p95-above-limit');
    } else {
      reasons.push(measurement.worstP95Ms <= VERIFICATION_P95_LIMIT_MS
        ? 'verification-p95-at-or-below-limit'
        : 'verification-p95-above-limit');
    }
  } else {
    reasons.push(...structuralErrors.map((reason) => `invalid:${reason}`));
  }
  return {
    measurement: { ...measurement, reasons },
    structuralErrors,
  };
}

function failedSelection(
  candidates: readonly CandidateMeasurement[],
  failureReasons: readonly string[],
  stopReason: SelectionStopReason | null,
): SelectionCoreOutput {
  return {
    mode: 'select',
    status: 'fail',
    corpus: 'budget-corpus-v1',
    proposedBudget: null,
    candidates,
    stopReason,
    failureReasons,
  };
}

export function selectBudgetFromLadder(
  measure: MeasurementFunction,
  minimum = DEPTH_ONE_REQUIRED_WORK_UNITS,
): SelectionCoreOutput {
  if (!Number.isSafeInteger(minimum) || minimum < 1) {
    return failedSelection([], ['minimum-budget-must-be-a-positive-safe-integer'], null);
  }
  const start = Math.ceil(Math.max(DEPTH_ONE_REQUIRED_WORK_UNITS, minimum)
    / BUDGET_CANDIDATE_STEP) * BUDGET_CANDIDATE_STEP;
  const candidates: CandidateMeasurement[] = [];
  const selectable: CandidateMeasurement[] = [];
  const failureReasons: string[] = [];
  let consecutiveAboveVerificationLimit = 0;
  let stopReason: SelectionStopReason | null = null;

  for (let offset = 0; offset < MAX_SELECTION_CANDIDATES; offset++) {
    const budget = start + offset * BUDGET_CANDIDATE_STEP;
    let raw: CandidateMeasurement;
    try {
      raw = measure(budget);
    } catch (error) {
      failureReasons.push(`candidate-${budget}-measurement-error:${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    const annotated = annotateMeasurement(budget, raw, 'selection');
    candidates.push(annotated.measurement);
    if (annotated.structuralErrors.length > 0) {
      failureReasons.push(`candidate-${budget}-structural-invariants-failed`);
      break;
    }
    if (annotated.measurement.worstP95Ms <= SELECTION_P95_LIMIT_MS) {
      selectable.push(annotated.measurement);
    }
    if (annotated.measurement.allDepthFourComplete) {
      stopReason = 'all-depth-four-complete';
      break;
    }
    if (annotated.measurement.worstP95Ms > VERIFICATION_P95_LIMIT_MS) {
      consecutiveAboveVerificationLimit++;
    } else {
      consecutiveAboveVerificationLimit = 0;
    }
    if (consecutiveAboveVerificationLimit === 2) {
      stopReason = 'two-consecutive-above-verification-limit';
      break;
    }
  }

  if (failureReasons.length === 0 && stopReason === null) {
    failureReasons.push('maximum-selection-candidates-reached-without-normal-stop');
  }
  if (selectable.length === 0) {
    failureReasons.push('no-candidate-at-or-below-selection-limit');
  }
  if (failureReasons.length > 0) return failedSelection(candidates, failureReasons, stopReason);

  return {
    mode: 'select',
    status: 'pass',
    corpus: 'budget-corpus-v1',
    proposedBudget: selectable[selectable.length - 1].budget,
    candidates,
    stopReason,
    failureReasons: [],
  };
}

export function verifyFrozenBudget(
  frozenBudget: number,
  measure: MeasurementFunction,
): VerificationCoreOutput {
  const blocks: CandidateMeasurement[] = [];
  const failureReasons: string[] = [];
  if (!Number.isSafeInteger(frozenBudget) || frozenBudget < 1) {
    failureReasons.push('frozen-budget-must-be-a-positive-safe-integer');
  } else {
    for (let block = 0; block < VERIFICATION_BLOCKS; block++) {
      try {
        const annotated = annotateMeasurement(frozenBudget, measure(frozenBudget), 'verification');
        blocks.push(annotated.measurement);
        if (annotated.structuralErrors.length > 0) {
          failureReasons.push(`block-${block + 1}-structural-invariants-failed`);
        }
        if (annotated.structuralErrors.length === 0
          && annotated.measurement.worstP95Ms > VERIFICATION_P95_LIMIT_MS) {
          failureReasons.push(`block-${block + 1}-above-verification-limit`);
        }
      } catch (error) {
        failureReasons.push(`block-${block + 1}-measurement-error:${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return {
    mode: 'verify-frozen',
    status: failureReasons.length === 0 && blocks.length === VERIFICATION_BLOCKS ? 'pass' : 'fail',
    corpus: 'budget-corpus-v1',
    frozenBudget,
    blocks,
    failureReasons,
  };
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function decisionSignature(decision: SearchDecision | null): string {
  if (decision === null) return 'null';
  return JSON.stringify({
    action: decision.action,
    value: decision.value,
    completedDepth: decision.diagnostics.completedDepth,
    workUnitsUsed: decision.diagnostics.workUnitsUsed,
    placementEvaluationUnits: decision.diagnostics.placementEvaluationUnits,
    chanceExpansionUnits: decision.diagnostics.chanceExpansionUnits,
    cacheHitUnits: decision.diagnostics.cacheHitUnits,
  });
}

export function measureCandidate(budget: number): CandidateMeasurement {
  const limits = { ...DETERMINISTIC_SEARCH_LIMITS, maxWorkUnits: budget };
  const weights = [...WEIGHTS];
  for (const serialized of BUDGET_CORPUS_V1) {
    searchBudgeted(materializeBudgetState(serialized), weights, limits);
  }

  const rounds: CalibrationRound[] = [];
  const depthHistogram = [0, 0, 0, 0, 0] as [number, number, number, number, number];
  const workUnitsUsed: number[] = [];
  const baseline = new Map<string, string>();
  let placementEvaluationUnits = 0;
  let chanceExpansionUnits = 0;
  let cacheHitUnits = 0;
  let allDepthOneComplete = true;
  let allDepthFourComplete = true;
  let overBudgetCount = 0;
  let deterministic = true;

  for (let round = 0; round < MEASUREMENT_ROUNDS; round++) {
    const timings: number[] = [];
    for (const serialized of BUDGET_CORPUS_V1) {
      const start = process.hrtime.bigint();
      const decision = searchBudgeted(materializeBudgetState(serialized), weights, limits);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      timings.push(elapsedMs);

      const depth = decision?.diagnostics.completedDepth ?? 0;
      const used = decision?.diagnostics.workUnitsUsed ?? 0;
      const placement = decision?.diagnostics.placementEvaluationUnits ?? 0;
      const chance = decision?.diagnostics.chanceExpansionUnits ?? 0;
      const cacheHit = decision?.diagnostics.cacheHitUnits ?? 0;
      depthHistogram[depth]++;
      workUnitsUsed.push(used);
      placementEvaluationUnits += placement;
      chanceExpansionUnits += chance;
      cacheHitUnits += cacheHit;
      if (depth < 1) allDepthOneComplete = false;
      if (depth !== 4) allDepthFourComplete = false;
      if (used > budget) overBudgetCount++;

      const signature = decisionSignature(decision);
      if (round === 0) baseline.set(serialized.id, signature);
      else if (baseline.get(serialized.id) !== signature) deterministic = false;
    }
    rounds.push({
      p50Ms: percentile(timings, 0.5),
      p95Ms: percentile(timings, 0.95),
      maxMs: Math.max(...timings),
    });
  }

  const fiveRounds = rounds as [
    CalibrationRound,
    CalibrationRound,
    CalibrationRound,
    CalibrationRound,
    CalibrationRound,
  ];
  return {
    budget,
    rounds: fiveRounds,
    worstP95Ms: Math.max(...fiveRounds.map((round) => round.p95Ms)),
    depthHistogram,
    workUnitsUsed,
    placementEvaluationUnits,
    chanceExpansionUnits,
    cacheHitUnits,
    allDepthOneComplete,
    allDepthFourComplete,
    overBudgetCount,
    deterministic,
    reasons: ['warmup-complete', 'five-measured-rounds-complete'],
  };
}

export function calibrationEnvironment(): CalibrationEnvironment {
  return {
    nodeVersion: process.version,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    selectionP95LimitMs: SELECTION_P95_LIMIT_MS,
    verificationP95LimitMs: VERIFICATION_P95_LIMIT_MS,
    candidateStep: BUDGET_CANDIDATE_STEP,
    maxSelectionCandidates: MAX_SELECTION_CANDIDATES,
    verificationBlocks: VERIFICATION_BLOCKS,
    roundsPerMeasurement: MEASUREMENT_ROUNDS,
    corpusSize: BUDGET_CORPUS_V1.length,
  };
}

export function runCalibrationCli(
  args: readonly string[],
  measure: MeasurementFunction = measureCandidate,
  environment: CalibrationEnvironment = calibrationEnvironment(),
  frozenBudget = DETERMINISTIC_SEARCH_LIMITS.maxWorkUnits,
): CliRunResult {
  if (args.length !== 1 || (args[0] !== '--select' && args[0] !== '--verify-frozen')) {
    return {
      exitCode: 1,
      output: {
        mode: 'invalid',
        status: 'fail',
        corpus: 'budget-corpus-v1',
        failureReasons: ['exactly-one-calibration-mode-required'],
        environment,
      },
    };
  }
  const output: SelectionOutput | VerificationOutput = args[0] === '--select'
    ? { ...selectBudgetFromLadder(measure), environment }
    : { ...verifyFrozenBudget(frozenBudget, measure), environment };
  return { exitCode: output.status === 'pass' ? 0 : 1, output };
}

export function serializeCalibrationOutput(output: CalibrationOutput): string {
  return JSON.stringify(output);
}

function isMain(url: string): boolean {
  return process.argv[1] !== undefined
    && fileURLToPath(url) === resolve(process.argv[1]);
}

if (isMain(import.meta.url)) {
  const result = runCalibrationCli(process.argv.slice(2));
  process.stdout.write(`${serializeCalibrationOutput(result.output)}\n`);
  process.exitCode = result.exitCode;
}
