import { createHash } from 'node:crypto';

export interface LinearMarginWitnessOptions {
  margin: number;
  normCap: number;
  tolerance: number;
  learningStep: number;
  maxUpdates: number;
}

export interface LinearMarginWitnessResult {
  found: boolean;
  witness: number[] | null;
  minimumMargin: number | null;
  updatesUsed: number;
}

export interface RepresentationProtocolPair<Category extends string = string, FeatureInput = unknown> {
  pairId: string;
  stateId: string;
  category: Category;
  positive: FeatureInput;
  negative: FeatureInput;
}

export interface RepresentationCorpusJudgmentInput {
  pairCount: number;
  strategyCorrect13: number;
  strategyCorrect17: number;
  safetyCorrect17: number;
  leaveOneStateOutStrategyRate17: number;
  leaveOneStateOutSafetyRegressionCount17: number;
  repeatedRunDeterministic: boolean;
}

export interface RepresentationCorpusJudgmentThresholds {
  expectedPairCount: number;
  expectedSafetyCorrect17: number;
  minimumStrategyCorrect17: number;
  minimumLeaveOneStateOutStrategyRate17: number;
  expectedLeaveOneStateOutSafetyRegressionCount17: number;
  minimumStrategyGain: number;
  reasonPolicy?: Partial<RepresentationCorpusJudgmentReasonPolicy>;
}

export interface RepresentationCorpusJudgmentReasonPolicy {
  strategyCorrect17BelowMinimum: string;
  leaveOneStateOutStrategyRate17BelowMinimum: string;
  strategyGainBelowMinimum: string;
}

export interface RepresentationCorpusJudgment {
  status: 'pass' | 'fail';
  failureReasons: readonly string[];
}

export interface RepresentationCorpusEvaluationInput<SourcePair = unknown, Category extends string = string, FeatureInput = unknown> {
  mode: 'feature-representation-gate';
  corpus: string;
  materializePairs: () => readonly SourcePair[];
  canonicalizePair: (pair: SourcePair) => RepresentationProtocolPair<Category, FeatureInput>;
  extractOld: (input: FeatureInput) => readonly number[];
  extractNew: (input: FeatureInput) => readonly number[];
  strategyCategory: Category;
  safetyCategory: Category;
  solverOptions: LinearMarginWitnessOptions;
  judgmentThresholds: RepresentationCorpusJudgmentThresholds;
  validatePairs?: (pairs: readonly SourcePair[]) => void;
}

export interface RepresentationGatePairResult<Category extends string = string> {
  pairId: string;
  stateId: string;
  category: Category;
  correct: boolean;
  margin: number;
}

export interface RepresentationGateSummary<Category extends string = string> {
  dimensionCount: 13 | 17;
  selectedExclusionCount: number | null;
  excludedStateIds: readonly string[];
  witness: readonly number[] | null;
  pairResults: readonly RepresentationGatePairResult<Category>[];
  strategyCorrect: number;
  safetyCorrect: number;
  marginMinimum: number | null;
  leaveOneStateOutStrategyRate: number;
  leaveOneStateOutSafetyRegressionCount: number;
}

export interface RepresentationCorpusEvaluationResult<Category extends string = string> {
  mode: 'feature-representation-gate';
  status: 'pass' | 'fail';
  corpus: string;
  pairIds: readonly string[];
  pairCount: number;
  old13: RepresentationGateSummary<Category>;
  new17: RepresentationGateSummary<Category>;
  repeatedRunDigest: string;
  identicalRunDigest: string;
  repeatedRunDeterministic: boolean;
  failureReasons: readonly string[];
}

export interface RepresentationDimensionEvaluationResult<Category extends string = string> {
  dimensionCount: 13 | 17;
  pairIds: readonly string[];
  pairCount: number;
  summary: RepresentationGateSummary<Category>;
  repeatedRunDigest: string;
  identicalRunDigest: string;
  repeatedRunDeterministic: boolean;
  failureReasons: readonly string[];
}

export interface CanonicalRepresentationPair<Category extends string = string> {
  pairId: string;
  stateId: string;
  category: Category;
  delta13: readonly number[];
  delta17: readonly number[];
}

type CanonicalRepresentationSourcePair<Category extends string = string, FeatureInput = unknown> =
  RepresentationProtocolPair<Category, FeatureInput>;

const SAFE_EVALUATION_REASON = 'representation-gate-evaluation-error' as const;

export function compareRepresentationPairIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function dot(left: readonly number[], right: readonly number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index++) total += left[index]! * right[index]!;
  return total;
}

function l2Norm(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum);
}

function projectToNormCap(values: number[], normCap: number): number[] {
  const norm = l2Norm(values);
  if (norm <= normCap || norm === 0) return values;
  const scale = normCap / norm;
  return values.map((value) => value * scale);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function buildScales(deltas: readonly number[][]): number[] {
  const dimensions = deltas[0]?.length ?? 0;
  const scales = Array.from({ length: dimensions }, () => 1);
  for (const delta of deltas) {
    for (let index = 0; index < dimensions; index++) scales[index] = Math.max(scales[index]!, Math.abs(delta[index]!));
  }
  return scales.map((value) => Math.max(1, value));
}

function normalize(delta: readonly number[], scales: readonly number[]): number[] {
  return delta.map((value, index) => value / scales[index]!);
}

function exclusionSets(stateIds: readonly string[]): string[][] {
  const ordered = [...stateIds].sort();
  const sets: string[][] = [[]];
  for (const stateId of ordered) sets.push([stateId]);
  for (let left = 0; left < ordered.length; left++) {
    for (let right = left + 1; right < ordered.length; right++) sets.push([ordered[left]!, ordered[right]!]);
  }
  return sets;
}

function allSelectedConstraints<Category extends string>(
  pairs: readonly CanonicalRepresentationPair<Category>[],
  strategyCategory: Category,
  allowedStrategyStateIds: readonly string[],
  excludedStateIds: readonly string[],
): readonly CanonicalRepresentationPair<Category>[] {
  const excluded = new Set(excludedStateIds);
  const allowed = new Set(allowedStrategyStateIds);
  return pairs.filter((pair) => pair.category !== strategyCategory || (allowed.has(pair.stateId) && !excluded.has(pair.stateId)));
}

function solveConstraints<Category extends string>(
  constraints: readonly CanonicalRepresentationPair<Category>[],
  dimension: 13 | 17,
  scales: readonly number[],
  options: LinearMarginWitnessOptions,
): LinearMarginWitnessResult {
  const selected = [...constraints].sort((left, right) => compareRepresentationPairIds(left.pairId, right.pairId));
  const normalized = selected.map((pair) => normalize(dimension === 13 ? pair.delta13 : pair.delta17, scales));
  return fitLinearMarginWitness(normalized, options);
}

export function fitLinearMarginWitness(
  deltas: readonly (readonly number[])[],
  options: LinearMarginWitnessOptions,
): LinearMarginWitnessResult {
  if (deltas.length === 0) return { found: true, witness: [], minimumMargin: null, updatesUsed: 0 };

  let witness = Array.from({ length: deltas[0]!.length }, () => 0);
  const ordered = deltas.map((delta) => [...delta]);
  const isSatisfied = (): boolean => ordered.every((delta) => dot(witness, delta) >= options.margin - options.tolerance);
  if (isSatisfied()) return { found: true, witness, minimumMargin: Math.min(...ordered.map((delta) => dot(witness, delta))), updatesUsed: 0 };

  let updatesUsed = 0;
  while (updatesUsed < options.maxUpdates) {
    const delta = ordered[updatesUsed % ordered.length]!;
    const margin = dot(witness, delta);
    const violation = options.margin - margin;
    if (violation > options.tolerance) {
      witness = witness.map((value, index) => value + options.learningStep * violation * delta[index]!);
      witness = projectToNormCap(witness, options.normCap);
    }
    updatesUsed++;
    if (isSatisfied()) return { found: true, witness, minimumMargin: Math.min(...ordered.map((delta) => dot(witness, delta))), updatesUsed };
  }

  return { found: false, witness: null, minimumMargin: null, updatesUsed };
}

function materializeCanonicalRepresentationSourcePairs<SourcePair, Category extends string, FeatureInput>(
  input: RepresentationCorpusEvaluationInput<SourcePair, Category, FeatureInput>,
): readonly CanonicalRepresentationSourcePair<Category, FeatureInput>[] {
  const materialized = input.materializePairs();
  input.validatePairs?.(materialized);
  return materialized.map((pair) => input.canonicalizePair(pair))
    .sort((left, right) => compareRepresentationPairIds(left.pairId, right.pairId));
}

function deriveRepresentationDimension<SourcePair, Category extends string, FeatureInput>(
  sourcePairs: readonly CanonicalRepresentationSourcePair<Category, FeatureInput>[],
  input: RepresentationCorpusEvaluationInput<SourcePair, Category, FeatureInput>,
  dimensionCount: 13 | 17,
): { pairs: readonly CanonicalRepresentationPair<Category>[]; scales: number[] } {
  const extract = dimensionCount === 13 ? input.extractOld : input.extractNew;
  const deltas = sourcePairs.map((pair) => {
    const positive = extract(pair.positive);
    const negative = extract(pair.negative);
    if (positive.length !== dimensionCount || negative.length !== dimensionCount) {
      throw new Error(`feature vector length mismatch for ${pair.pairId}`);
    }
    if ([...positive, ...negative].some((value) => !finiteNumber(value))) {
      throw new Error(`non-finite feature value for ${pair.pairId}`);
    }
    return positive.map((value, index) => value - negative[index]!);
  });
  return {
    pairs: sourcePairs.map((pair, index) => ({
      pairId: pair.pairId,
      stateId: pair.stateId,
      category: pair.category,
      delta13: dimensionCount === 13 ? deltas[index]! : [],
      delta17: dimensionCount === 17 ? deltas[index]! : [],
    })),
    scales: buildScales(deltas),
  };
}

export function canonicalizeRepresentationPairs<SourcePair, Category extends string, FeatureInput>(
  input: RepresentationCorpusEvaluationInput<SourcePair, Category, FeatureInput>,
): { pairs: readonly CanonicalRepresentationPair<Category>[]; scales13: number[]; scales17: number[] } {
  const sourcePairs = materializeCanonicalRepresentationSourcePairs(input);
  const old13 = deriveRepresentationDimension(sourcePairs, input, 13);
  const new17 = deriveRepresentationDimension(sourcePairs, input, 17);
  return {
    pairs: sourcePairs.map((pair, index) => ({
      pairId: pair.pairId,
      stateId: pair.stateId,
      category: pair.category,
      delta13: old13.pairs[index]!.delta13,
      delta17: new17.pairs[index]!.delta17,
    })),
    scales13: old13.scales,
    scales17: new17.scales,
  };
}

function evaluateLeaveOneStateOut<SourcePair, Category extends string, FeatureInput>(
  pairs: readonly CanonicalRepresentationPair<Category>[],
  dimensionCount: 13 | 17,
  scales: readonly number[],
  strategyStateIds: readonly string[],
  input: RepresentationCorpusEvaluationInput<SourcePair, Category, FeatureInput>,
): { strategyRate: number; safetyRegressionCount: number } {
  let heldOutCorrect = 0;
  let safetyRegressionCount = 0;
  const safetyPairs = pairs.filter((pair) => pair.category === input.safetyCategory);
  for (const heldOutStateId of strategyStateIds) {
    const trainingPairs = pairs.filter((pair) => pair.category === input.safetyCategory || pair.stateId !== heldOutStateId);
    const trainingStates = strategyStateIds.filter((stateId) => stateId !== heldOutStateId);
    let witness: LinearMarginWitnessResult | null = null;
    for (const exclusionSet of exclusionSets(trainingStates)) {
      const candidate = solveConstraints(allSelectedConstraints(trainingPairs, input.strategyCategory, trainingStates, exclusionSet), dimensionCount, scales, input.solverOptions);
      if (candidate.found) {
        witness = candidate;
        break;
      }
    }
    if (witness === null || witness.witness === null) {
      safetyRegressionCount++;
      continue;
    }
    const heldOutPair = pairs.find((pair) => pair.stateId === heldOutStateId)!;
    const heldOutDelta = normalize(dimensionCount === 13 ? heldOutPair.delta13 : heldOutPair.delta17, scales);
    if (dot(witness.witness, heldOutDelta) >= input.solverOptions.margin - input.solverOptions.tolerance) heldOutCorrect++;
    const safetyRegressed = safetyPairs.some((pair) => {
      const delta = normalize(dimensionCount === 13 ? pair.delta13 : pair.delta17, scales);
      return dot(witness!.witness!, delta) < input.solverOptions.margin - input.solverOptions.tolerance;
    });
    if (safetyRegressed) safetyRegressionCount++;
  }
  return { strategyRate: heldOutCorrect / strategyStateIds.length, safetyRegressionCount };
}

function buildRepresentationRun<SourcePair, Category extends string, FeatureInput>(
  pairs: readonly CanonicalRepresentationPair<Category>[],
  dimensionCount: 13 | 17,
  scales: readonly number[],
  input: RepresentationCorpusEvaluationInput<SourcePair, Category, FeatureInput>,
): RepresentationGateSummary<Category> {
  const strategyStateIds = [...new Set(pairs.filter((pair) => pair.category === input.strategyCategory).map((pair) => pair.stateId))].sort();
  let selected: { exclusionSet: string[]; witness: LinearMarginWitnessResult } | null = null;
  for (const exclusionSet of exclusionSets(strategyStateIds)) {
    const candidate = solveConstraints(allSelectedConstraints(pairs, input.strategyCategory, strategyStateIds, exclusionSet), dimensionCount, scales, input.solverOptions);
    if (candidate.found) {
      selected = { exclusionSet, witness: candidate };
      break;
    }
  }
  if (selected === null) {
    return { dimensionCount, selectedExclusionCount: null, excludedStateIds: [], witness: null, pairResults: [], strategyCorrect: 0, safetyCorrect: 0, marginMinimum: null, leaveOneStateOutStrategyRate: 0, leaveOneStateOutSafetyRegressionCount: strategyStateIds.length };
  }
  const threshold = input.solverOptions.margin - input.solverOptions.tolerance;
  const pairResults = [...pairs].sort((left, right) => compareRepresentationPairIds(left.pairId, right.pairId)).map((pair) => {
    const delta = normalize(dimensionCount === 13 ? pair.delta13 : pair.delta17, scales);
    const margin = dot(selected!.witness.witness ?? [], delta);
    return { pairId: pair.pairId, stateId: pair.stateId, category: pair.category, correct: margin >= threshold, margin };
  });
  const leaveOneStateOut = evaluateLeaveOneStateOut(pairs, dimensionCount, scales, strategyStateIds, input);
  return {
    dimensionCount,
    selectedExclusionCount: selected.exclusionSet.length,
    excludedStateIds: selected.exclusionSet,
    witness: selected.witness.witness,
    pairResults,
    strategyCorrect: pairResults.filter((pair) => pair.category === input.strategyCategory && pair.correct).length,
    safetyCorrect: pairResults.filter((pair) => pair.category === input.safetyCategory && pair.correct).length,
    marginMinimum: pairResults.length === 0 ? null : Math.min(...pairResults.map((pair) => pair.margin)),
    leaveOneStateOutStrategyRate: leaveOneStateOut.strategyRate,
    leaveOneStateOutSafetyRegressionCount: leaveOneStateOut.safetyRegressionCount,
  };
}

export function judgeRepresentationCorpus(
  input: RepresentationCorpusJudgmentInput,
  thresholds: RepresentationCorpusJudgmentThresholds,
): RepresentationCorpusJudgment {
  const failureReasons: string[] = [];
  const reasons: RepresentationCorpusJudgmentReasonPolicy = {
    strategyCorrect17BelowMinimum: thresholds.reasonPolicy?.strategyCorrect17BelowMinimum ?? 'strategy-correct-17-below-minimum',
    leaveOneStateOutStrategyRate17BelowMinimum: thresholds.reasonPolicy?.leaveOneStateOutStrategyRate17BelowMinimum ?? 'loso-strategy-rate-17-below-minimum',
    strategyGainBelowMinimum: thresholds.reasonPolicy?.strategyGainBelowMinimum ?? 'strategy-gain-below-minimum',
  };
  if (input.pairCount !== thresholds.expectedPairCount) failureReasons.push('pair-count-mismatch');
  if (input.safetyCorrect17 !== thresholds.expectedSafetyCorrect17) failureReasons.push('safety-correct-17-mismatch');
  if (input.strategyCorrect17 < thresholds.minimumStrategyCorrect17) failureReasons.push(reasons.strategyCorrect17BelowMinimum);
  if (input.leaveOneStateOutStrategyRate17 < thresholds.minimumLeaveOneStateOutStrategyRate17) failureReasons.push(reasons.leaveOneStateOutStrategyRate17BelowMinimum);
  if (input.leaveOneStateOutSafetyRegressionCount17 !== thresholds.expectedLeaveOneStateOutSafetyRegressionCount17) failureReasons.push('loso-safety-regressions-17-nonzero');
  if (input.strategyCorrect17 - input.strategyCorrect13 < thresholds.minimumStrategyGain) failureReasons.push(reasons.strategyGainBelowMinimum);
  if (!input.repeatedRunDeterministic) failureReasons.push('repeated-run-not-deterministic');
  return { status: failureReasons.length === 0 ? 'pass' : 'fail', failureReasons };
}

function emptySummary<Category extends string>(dimensionCount: 13 | 17): RepresentationGateSummary<Category> {
  return { dimensionCount, selectedExclusionCount: null, excludedStateIds: [], witness: null, pairResults: [], strategyCorrect: 0, safetyCorrect: 0, marginMinimum: null, leaveOneStateOutStrategyRate: 0, leaveOneStateOutSafetyRegressionCount: 0 };
}

export function createSafeRepresentationCorpusEvaluationResult<Category extends string>(
  corpus: string,
): RepresentationCorpusEvaluationResult<Category> {
  const safeDigest = createHash('sha256').update(SAFE_EVALUATION_REASON).digest('hex');
  return {
    mode: 'feature-representation-gate',
    status: 'fail',
    corpus,
    pairIds: [],
    pairCount: 0,
    old13: emptySummary<Category>(13),
    new17: emptySummary<Category>(17),
    repeatedRunDigest: safeDigest,
    identicalRunDigest: safeDigest,
    repeatedRunDeterministic: false,
    failureReasons: [SAFE_EVALUATION_REASON],
  };
}

function runOnce<SourcePair, Category extends string, FeatureInput>(
  input: RepresentationCorpusEvaluationInput<SourcePair, Category, FeatureInput>,
): RepresentationCorpusEvaluationResult<Category> {
  const canonical = canonicalizeRepresentationPairs(input);
  const summary = {
    mode: input.mode,
    corpus: input.corpus,
    pairIds: canonical.pairs.map((pair) => pair.pairId),
    pairCount: canonical.pairs.length,
    old13: buildRepresentationRun(canonical.pairs, 13, canonical.scales13, input),
    new17: buildRepresentationRun(canonical.pairs, 17, canonical.scales17, input),
  };
  const digest = createHash('sha256').update(JSON.stringify(summary)).digest('hex');
  return { ...summary, status: 'fail', repeatedRunDigest: digest, identicalRunDigest: digest, repeatedRunDeterministic: true, failureReasons: [] };
}

function runDimensionOnce<SourcePair, Category extends string, FeatureInput>(
  input: RepresentationCorpusEvaluationInput<SourcePair, Category, FeatureInput>,
  dimensionCount: 13 | 17,
): RepresentationDimensionEvaluationResult<Category> {
  const sourcePairs = materializeCanonicalRepresentationSourcePairs(input);
  const dimension = deriveRepresentationDimension(sourcePairs, input, dimensionCount);
  const summary = buildRepresentationRun(dimension.pairs, dimensionCount, dimension.scales, input);
  const core = {
    dimensionCount,
    pairIds: sourcePairs.map((pair) => pair.pairId),
    pairCount: sourcePairs.length,
    summary,
  };
  const digest = createHash('sha256').update(JSON.stringify(core)).digest('hex');
  return {
    ...core,
    repeatedRunDigest: digest,
    identicalRunDigest: digest,
    repeatedRunDeterministic: true,
    failureReasons: [],
  };
}

function createSafeRepresentationDimensionEvaluationResult<Category extends string>(
  dimensionCount: 13 | 17,
): RepresentationDimensionEvaluationResult<Category> {
  const safeDigest = createHash('sha256').update(SAFE_EVALUATION_REASON).digest('hex');
  return {
    dimensionCount,
    pairIds: [],
    pairCount: 0,
    summary: emptySummary<Category>(dimensionCount),
    repeatedRunDigest: safeDigest,
    identicalRunDigest: safeDigest,
    repeatedRunDeterministic: false,
    failureReasons: [SAFE_EVALUATION_REASON],
  };
}

export function evaluateRepresentationDimension<SourcePair, Category extends string, FeatureInput>(
  input: RepresentationCorpusEvaluationInput<SourcePair, Category, FeatureInput>,
  dimensionCount: 13 | 17,
): RepresentationDimensionEvaluationResult<Category> {
  try {
    const first = runDimensionOnce(input, dimensionCount);
    const second = runDimensionOnce(input, dimensionCount);
    const repeatedRunDigest = createHash('sha256').update(serializeRepresentationDimensionResult(first)).digest('hex');
    const identicalRunDigest = createHash('sha256').update(serializeRepresentationDimensionResult(second)).digest('hex');
    return {
      ...first,
      repeatedRunDigest,
      identicalRunDigest,
      repeatedRunDeterministic: repeatedRunDigest === identicalRunDigest,
    };
  } catch {
    return createSafeRepresentationDimensionEvaluationResult<Category>(dimensionCount);
  }
}

export function evaluateRepresentationCorpus<SourcePair, Category extends string, FeatureInput>(
  input: RepresentationCorpusEvaluationInput<SourcePair, Category, FeatureInput>,
): RepresentationCorpusEvaluationResult<Category> {
  let trustedCorpus = 'representation-corpus';
  try {
    trustedCorpus = input.corpus;
    const first = runOnce(input);
    const second = runOnce(input);
    const repeatedRunDigest = createHash('sha256').update(serializeRepresentationSummary(first)).digest('hex');
    const identicalRunDigest = createHash('sha256').update(serializeRepresentationSummary(second)).digest('hex');
    const repeatedRunDeterministic = repeatedRunDigest === identicalRunDigest;
    const judgment = judgeRepresentationCorpus({
      pairCount: first.pairCount,
      strategyCorrect13: first.old13.strategyCorrect,
      strategyCorrect17: first.new17.strategyCorrect,
      safetyCorrect17: first.new17.safetyCorrect,
      leaveOneStateOutStrategyRate17: first.new17.leaveOneStateOutStrategyRate,
      leaveOneStateOutSafetyRegressionCount17: first.new17.leaveOneStateOutSafetyRegressionCount,
      repeatedRunDeterministic,
    }, input.judgmentThresholds);
    return { ...first, repeatedRunDigest, identicalRunDigest, repeatedRunDeterministic, status: judgment.status, failureReasons: judgment.failureReasons };
  } catch {
    return createSafeRepresentationCorpusEvaluationResult<Category>(trustedCorpus);
  }
}

export function projectRepresentationGateSummary<Category extends string>(summary: RepresentationGateSummary<Category>) {
  return {
    dimensionCount: summary.dimensionCount,
    selectedExclusionCount: summary.selectedExclusionCount,
    excludedStateIds: summary.excludedStateIds,
    witness: summary.witness,
    pairResults: summary.pairResults.map((pair) => ({
      pairId: pair.pairId,
      stateId: pair.stateId,
      category: pair.category,
      correct: pair.correct,
      margin: pair.margin,
    })),
    strategyCorrect: summary.strategyCorrect,
    safetyCorrect: summary.safetyCorrect,
    marginMinimum: summary.marginMinimum,
    leaveOneStateOutStrategyRate: summary.leaveOneStateOutStrategyRate,
    leaveOneStateOutSafetyRegressionCount: summary.leaveOneStateOutSafetyRegressionCount,
  };
}

export function serializeRepresentationSummary<Category extends string>(result: RepresentationCorpusEvaluationResult<Category>): string {
  return JSON.stringify({
    mode: result.mode,
    status: result.status,
    corpus: result.corpus,
    pairIds: result.pairIds,
    pairCount: result.pairCount,
    old13: projectRepresentationGateSummary(result.old13),
    new17: projectRepresentationGateSummary(result.new17),
    repeatedRunDigest: result.repeatedRunDigest,
    identicalRunDigest: result.identicalRunDigest,
    repeatedRunDeterministic: result.repeatedRunDeterministic,
    failureReasons: result.failureReasons,
  });
}

export function serializeRepresentationDimensionResult<Category extends string>(
  result: RepresentationDimensionEvaluationResult<Category>,
): string {
  return JSON.stringify({
    dimensionCount: result.dimensionCount,
    pairIds: result.pairIds,
    pairCount: result.pairCount,
    summary: projectRepresentationGateSummary(result.summary),
    repeatedRunDigest: result.repeatedRunDigest,
    identicalRunDigest: result.identicalRunDigest,
    repeatedRunDeterministic: result.repeatedRunDeterministic,
    failureReasons: result.failureReasons,
  });
}
