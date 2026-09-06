import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { extractFeatures } from '../src/ai/features';
import { extractB1PlacementFeatures, type B1PlacementFeatureInput } from '../src/ai/opportunityFeatures';
import {
  B1_1_CHALLENGE_CORPUS_ID,
  materializeAllChallengePlacementPairs,
  validateChallengeCorpus,
  type ChallengeCategory,
  type MaterializedChallengePlacementPair,
} from './featureRepresentationChallengeCorpus';
import {
  compareRepresentationPairIds,
  evaluateRepresentationDimension,
  judgeRepresentationCorpus,
  projectRepresentationGateSummary,
  type LinearMarginWitnessOptions,
  type RepresentationCorpusEvaluationInput,
  type RepresentationCorpusJudgment,
  type RepresentationDimensionEvaluationResult,
  type RepresentationGateSummary,
} from './featureRepresentationProtocol';

export type ChallengeDimensionResult = RepresentationDimensionEvaluationResult<ChallengeCategory>;
export type ChallengeProtocolInput = RepresentationCorpusEvaluationInput<
  MaterializedChallengePlacementPair,
  ChallengeCategory,
  B1PlacementFeatureInput
>;

export interface ChallengeRepresentationGateDependencies {
  materializeAllChallengePlacementPairs: () => readonly MaterializedChallengePlacementPair[];
  validateChallengeCorpus?: () => void;
  evaluateRepresentationDimension: (
    input: ChallengeProtocolInput,
    dimensionCount: 13 | 17,
  ) => ChallengeDimensionResult;
}

export interface ChallengeRepresentationGateJudgmentInput {
  old13StrategyCorrect: number;
  strategyCorrect17: number | null;
  safetyCorrect17?: number;
  losoRate17?: number;
  safetyRegressions17?: number;
  deterministic?: boolean;
  pairCount?: number;
}

export interface ChallengeRepresentationResult {
  mode: 'feature-representation-challenge';
  status: 'pass' | 'fail' | 'challenge-inconclusive';
  corpus: typeof B1_1_CHALLENGE_CORPUS_ID;
  pairCount: number;
  strategyCount: number;
  safetyCount: number;
  challengeValidity: {
    old13StrategyCorrect: number;
    old13StrategyMaximum: 20;
    status: 'valid' | 'inconclusive';
  };
  old13: RepresentationGateSummary<ChallengeCategory> | null;
  new17: RepresentationGateSummary<ChallengeCategory> | null;
  strategyGain: number | null;
  repeatedRunDeterministic: boolean;
  repeatedRunDigest: string;
  identicalRunDigest: string;
  failureReasons: readonly string[];
}

export type ChallengeRepresentationGateResult = ChallengeRepresentationResult;

const SAFE_EVALUATION_REASON = 'representation-gate-evaluation-error' as const;

const SOLVER_OPTIONS: LinearMarginWitnessOptions = Object.freeze({
  margin: 0.01,
  normCap: 1,
  tolerance: 1e-9,
  learningStep: 0.05,
  maxUpdates: 100000,
});

const CHALLENGE_JUDGMENT_THRESHOLDS = Object.freeze({
  expectedPairCount: 32,
  expectedSafetyCorrect17: 8,
  minimumStrategyCorrect17: 22,
  minimumLeaveOneStateOutStrategyRate17: 0.9,
  expectedLeaveOneStateOutSafetyRegressionCount17: 0,
  minimumStrategyGain: 5,
  reasonPolicy: {
    strategyCorrect17BelowMinimum: 'strategy-correct-17-below-22',
    leaveOneStateOutStrategyRate17BelowMinimum: 'loso-strategy-rate-17-below-0.90',
    strategyGainBelowMinimum: 'strategy-gain-not-above-4',
  },
});

function safeDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function emptyDimension(dimensionCount: 13 | 17): ChallengeDimensionResult {
  const digest = safeDigest(SAFE_EVALUATION_REASON);
  return {
    dimensionCount,
    pairIds: [],
    pairCount: 0,
    summary: {
      dimensionCount,
      selectedExclusionCount: null,
      excludedStateIds: [],
      witness: null,
      pairResults: [],
      strategyCorrect: 0,
      safetyCorrect: 0,
      marginMinimum: null,
      leaveOneStateOutStrategyRate: 0,
      leaveOneStateOutSafetyRegressionCount: 0,
    },
    repeatedRunDigest: digest,
    identicalRunDigest: digest,
    repeatedRunDeterministic: false,
    failureReasons: [SAFE_EVALUATION_REASON],
  };
}

function safeFailureResult(): ChallengeRepresentationResult {
  const old13 = emptyDimension(13);
  return {
    mode: 'feature-representation-challenge',
    status: 'fail',
    corpus: B1_1_CHALLENGE_CORPUS_ID,
    pairCount: 0,
    strategyCount: 0,
    safetyCount: 0,
    challengeValidity: {
      old13StrategyCorrect: 0,
      old13StrategyMaximum: 20,
      status: 'valid',
    },
    old13: null,
    new17: null,
    strategyGain: null,
    repeatedRunDeterministic: false,
    repeatedRunDigest: old13.repeatedRunDigest,
    identicalRunDigest: old13.identicalRunDigest,
    failureReasons: [SAFE_EVALUATION_REASON],
  };
}

function validateMaterializedChallengePairs(pairs: readonly MaterializedChallengePlacementPair[]): {
  strategyCount: number;
  safetyCount: number;
} {
  if (pairs.length !== 32) throw new Error('challenge pair count is invalid');
  const ids = new Set<string>();
  const strategyStates = new Set<string>();
  let strategyCount = 0;
  let safetyCount = 0;
  for (const pair of pairs) {
    const descriptor = pair.descriptor;
    if (ids.has(descriptor.id)) throw new Error('challenge pair ids are not unique');
    ids.add(descriptor.id);
    if (descriptor.category === 'strategy') {
      strategyCount++;
      if (strategyStates.has(descriptor.stateId)) throw new Error('challenge strategy states are not unique');
      strategyStates.add(descriptor.stateId);
    } else if (descriptor.category === 'safety') {
      safetyCount++;
    } else {
      throw new Error('challenge pair category is invalid');
    }
  }
  if (strategyCount !== 24 || safetyCount !== 8 || strategyStates.size !== 24) {
    throw new Error('challenge pair groups are invalid');
  }
  return { strategyCount, safetyCount };
}

function createChallengeProtocolInput(
  pairs: readonly MaterializedChallengePlacementPair[],
): ChallengeProtocolInput {
  return {
    mode: 'feature-representation-gate',
    corpus: B1_1_CHALLENGE_CORPUS_ID,
    materializePairs: () => pairs,
    canonicalizePair: (pair) => ({
      pairId: pair.descriptor.id,
      stateId: pair.descriptor.stateId,
      category: pair.descriptor.category,
      positive: pair.positive,
      negative: pair.negative,
    }),
    extractOld: (placement) => extractFeatures(
      placement.boardAfter,
      placement.linesCleared,
      placement.placedCells,
    ),
    extractNew: extractB1PlacementFeatures,
    strategyCategory: 'strategy',
    safetyCategory: 'safety',
    solverOptions: SOLVER_OPTIONS,
    judgmentThresholds: CHALLENGE_JUDGMENT_THRESHOLDS,
    validatePairs: validateMaterializedChallengePairs,
  };
}

function combinedDigests(
  old13: ChallengeDimensionResult,
  new17: ChallengeDimensionResult | null,
): { repeatedRunDigest: string; identicalRunDigest: string; repeatedRunDeterministic: boolean } {
  const dimensions = new17 === null ? [old13] : [old13, new17];
  const repeatedRunDigest = safeDigest(JSON.stringify(dimensions.map((result) => result.repeatedRunDigest)));
  const identicalRunDigest = safeDigest(JSON.stringify(dimensions.map((result) => result.identicalRunDigest)));
  return {
    repeatedRunDeterministic: dimensions.every(hasValidDeterminismEvidence),
    repeatedRunDigest,
    identicalRunDigest,
  };
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function hasValidDeterminismEvidence(result: ChallengeDimensionResult): boolean {
  return result.repeatedRunDeterministic === true
    && SHA256_HEX_PATTERN.test(result.repeatedRunDigest)
    && SHA256_HEX_PATTERN.test(result.identicalRunDigest)
    && result.repeatedRunDigest === result.identicalRunDigest;
}

function validFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateDimensionResult(
  result: ChallengeDimensionResult,
  dimensionCount: 13 | 17,
  pairIds: readonly string[],
): void {
  if (
    result.dimensionCount !== dimensionCount
    || result.summary.dimensionCount !== dimensionCount
    || result.pairCount !== 32
    || result.pairIds.length !== pairIds.length
    || result.pairIds.some((pairId, index) => pairId !== pairIds[index])
    || result.failureReasons.length > 0
    || !Number.isInteger(result.summary.strategyCorrect)
    || result.summary.strategyCorrect < 0
    || result.summary.strategyCorrect > 24
    || !Number.isInteger(result.summary.safetyCorrect)
    || result.summary.safetyCorrect < 0
    || result.summary.safetyCorrect > 8
    || !validFiniteNumber(result.summary.leaveOneStateOutStrategyRate)
    || result.summary.leaveOneStateOutStrategyRate < 0
    || result.summary.leaveOneStateOutStrategyRate > 1
    || !Number.isInteger(result.summary.leaveOneStateOutSafetyRegressionCount)
    || result.summary.leaveOneStateOutSafetyRegressionCount < 0
    || result.summary.leaveOneStateOutSafetyRegressionCount > 24
    || (result.summary.marginMinimum !== null && !validFiniteNumber(result.summary.marginMinimum))
    || typeof result.repeatedRunDigest !== 'string'
    || typeof result.identicalRunDigest !== 'string'
    || typeof result.repeatedRunDeterministic !== 'boolean'
  ) throw new Error('challenge dimension result is invalid');
}

export function judgeChallengeRepresentationGate(
  input: ChallengeRepresentationGateJudgmentInput,
): RepresentationCorpusJudgment | { status: 'challenge-inconclusive'; failureReasons: readonly string[] } {
  if (!Number.isInteger(input.old13StrategyCorrect) || input.old13StrategyCorrect < 0 || input.old13StrategyCorrect > 24) {
    return { status: 'fail', failureReasons: ['strategy-correct-13-invalid'] };
  }
  if (input.old13StrategyCorrect >= 21 && input.old13StrategyCorrect <= 24) {
    return {
      status: 'challenge-inconclusive',
      failureReasons: ['challenge-validity-old13-above-20'],
    };
  }
  return judgeRepresentationCorpus({
    pairCount: input.pairCount ?? 32,
    strategyCorrect13: input.old13StrategyCorrect,
    strategyCorrect17: input.strategyCorrect17 ?? 0,
    safetyCorrect17: input.safetyCorrect17 ?? 0,
    leaveOneStateOutStrategyRate17: input.losoRate17 ?? 0,
    leaveOneStateOutSafetyRegressionCount17: input.safetyRegressions17 ?? 1,
    repeatedRunDeterministic: input.deterministic ?? false,
  }, CHALLENGE_JUDGMENT_THRESHOLDS);
}

export function evaluateChallengeRepresentationGate(
  dependencies: Partial<ChallengeRepresentationGateDependencies> = {},
): ChallengeRepresentationResult {
  try {
    (dependencies.validateChallengeCorpus ?? validateChallengeCorpus)();
    const pairs = (dependencies.materializeAllChallengePlacementPairs ?? materializeAllChallengePlacementPairs)();
    const counts = validateMaterializedChallengePairs(pairs);
    const input = createChallengeProtocolInput(pairs);
    const evaluate = dependencies.evaluateRepresentationDimension ?? evaluateRepresentationDimension;
    const old13 = evaluate(input, 13);
    const pairIds = pairs.map((pair) => pair.descriptor.id).sort(compareRepresentationPairIds);
    validateDimensionResult(old13, 13, pairIds);
    const oldDigests = combinedDigests(old13, null);
    const challengeValidity = {
      old13StrategyCorrect: old13.summary.strategyCorrect,
      old13StrategyMaximum: 20 as const,
      status: old13.summary.strategyCorrect <= 20 ? 'valid' as const : 'inconclusive' as const,
    };
    if (!oldDigests.repeatedRunDeterministic) {
      return {
        mode: 'feature-representation-challenge',
        status: 'fail',
        corpus: B1_1_CHALLENGE_CORPUS_ID,
        pairCount: pairs.length,
        ...counts,
        challengeValidity,
        old13: projectRepresentationGateSummary(old13.summary),
        new17: null,
        strategyGain: null,
        ...oldDigests,
        failureReasons: ['old13-determinism-invalid'],
      };
    }

    const oldJudgment = judgeChallengeRepresentationGate({
      old13StrategyCorrect: old13.summary.strategyCorrect,
      strategyCorrect17: null,
    });
    if (oldJudgment.status === 'challenge-inconclusive') {
      return {
        mode: 'feature-representation-challenge',
        status: 'challenge-inconclusive',
        corpus: B1_1_CHALLENGE_CORPUS_ID,
        pairCount: pairs.length,
        ...counts,
        challengeValidity,
        old13: projectRepresentationGateSummary(old13.summary),
        new17: null,
        strategyGain: null,
        ...oldDigests,
        failureReasons: oldJudgment.failureReasons,
      };
    }

    const new17 = evaluate(input, 17);
    validateDimensionResult(new17, 17, pairIds);
    const digests = combinedDigests(old13, new17);
    const judgment = judgeChallengeRepresentationGate({
      old13StrategyCorrect: old13.summary.strategyCorrect,
      strategyCorrect17: new17.summary.strategyCorrect,
      safetyCorrect17: new17.summary.safetyCorrect,
      losoRate17: new17.summary.leaveOneStateOutStrategyRate,
      safetyRegressions17: new17.summary.leaveOneStateOutSafetyRegressionCount,
      deterministic: digests.repeatedRunDeterministic,
      pairCount: new17.pairCount,
    });
    return {
      mode: 'feature-representation-challenge',
      status: judgment.status,
      corpus: B1_1_CHALLENGE_CORPUS_ID,
      pairCount: pairs.length,
      ...counts,
      challengeValidity,
      old13: projectRepresentationGateSummary(old13.summary),
      new17: projectRepresentationGateSummary(new17.summary),
      strategyGain: new17.summary.strategyCorrect - old13.summary.strategyCorrect,
      ...digests,
      failureReasons: judgment.failureReasons,
    };
  } catch {
    return safeFailureResult();
  }
}

export function serializeChallengeRepresentationResult(result: ChallengeRepresentationResult): string {
  return JSON.stringify({
    mode: result.mode,
    status: result.status,
    corpus: result.corpus,
    pairCount: result.pairCount,
    strategyCount: result.strategyCount,
    safetyCount: result.safetyCount,
    challengeValidity: result.challengeValidity,
    old13: result.old13 === null ? null : projectRepresentationGateSummary(result.old13),
    new17: result.new17 === null ? null : projectRepresentationGateSummary(result.new17),
    strategyGain: result.strategyGain,
    repeatedRunDeterministic: result.repeatedRunDeterministic,
    repeatedRunDigest: result.repeatedRunDigest,
    identicalRunDigest: result.identicalRunDigest,
    failureReasons: result.failureReasons,
  });
}

export function runChallengeRepresentationGateCli(
  dependencies: Partial<ChallengeRepresentationGateDependencies> = {},
): { exitCode: 0 | 1; output: ChallengeRepresentationGateResult } {
  const output = evaluateChallengeRepresentationGate(dependencies);
  return { exitCode: output.status === 'pass' ? 0 : 1, output };
}

export function emitChallengeRepresentationGateCli(
  dependencies: Partial<ChallengeRepresentationGateDependencies> = {},
  write: (chunk: string) => void = (chunk) => { process.stdout.write(chunk); },
): { exitCode: 0 | 1; output: ChallengeRepresentationGateResult } {
  const result = runChallengeRepresentationGateCli(dependencies);
  write(`${serializeChallengeRepresentationResult(result.output)}\n`);
  return result;
}

function isMain(url: string): boolean {
  return process.argv[1] !== undefined && fileURLToPath(url) === resolve(process.argv[1]);
}

if (isMain(import.meta.url)) {
  const result = emitChallengeRepresentationGateCli();
  process.exitCode = result.exitCode;
}
