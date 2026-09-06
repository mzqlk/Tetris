import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { extractFeatures } from '../src/ai/features';
import { extractB1PlacementFeatures, type B1PlacementFeatureInput } from '../src/ai/opportunityFeatures';
import {
  B1_PLACEMENT_PAIR_CORPUS_ID,
  materializeAllPlacementPairs,
  type B1PlacementPairCategory,
  type MaterializedPlacementPair,
} from './featureRepresentationCorpus';
import {
  evaluateRepresentationCorpus,
  createSafeRepresentationCorpusEvaluationResult,
  fitLinearMarginWitness,
  judgeRepresentationCorpus,
  serializeRepresentationSummary,
  type LinearMarginWitnessOptions,
  type LinearMarginWitnessResult,
  type RepresentationCorpusEvaluationInput,
  type RepresentationCorpusJudgment,
  type RepresentationCorpusJudgmentInput,
  type RepresentationGatePairResult as ProtocolPairResult,
  type RepresentationGateSummary as ProtocolSummary,
} from './featureRepresentationProtocol';

export type { LinearMarginWitnessOptions, LinearMarginWitnessResult };

export interface RepresentationGateEvaluationInput {
  materializeAllPlacementPairs: () => readonly MaterializedPlacementPair[];
  extractFeatures: typeof extractFeatures;
  extractB1PlacementFeatures: typeof extractB1PlacementFeatures;
}

export type RepresentationGatePairResult = ProtocolPairResult<B1PlacementPairCategory>;
export type RepresentationGateSummary = ProtocolSummary<B1PlacementPairCategory>;

export interface RepresentationGateResult {
  mode: 'feature-representation-gate';
  status: 'pass' | 'fail';
  corpus: typeof B1_PLACEMENT_PAIR_CORPUS_ID;
  pairIds: readonly string[];
  pairCount: number;
  old13: RepresentationGateSummary;
  new17: RepresentationGateSummary;
  repeatedRunDigest: string;
  identicalRunDigest: string;
  repeatedRunDeterministic: boolean;
  failureReasons: readonly string[];
}

export type RepresentationGateJudgmentInput = RepresentationCorpusJudgmentInput;
export type RepresentationGateJudgment = RepresentationCorpusJudgment;

const SOLVER_OPTIONS: LinearMarginWitnessOptions = Object.freeze({
  margin: 0.01,
  normCap: 1,
  tolerance: 1e-9,
  learningStep: 0.05,
  maxUpdates: 100000,
});

const B1_JUDGMENT_THRESHOLDS = Object.freeze({
  expectedPairCount: 32,
  expectedSafetyCorrect17: 8,
  minimumStrategyCorrect17: 22,
  minimumLeaveOneStateOutStrategyRate17: 0.9,
  expectedLeaveOneStateOutSafetyRegressionCount17: 0,
  minimumStrategyGain: 4,
  reasonPolicy: {
    strategyCorrect17BelowMinimum: 'strategy-correct-17-below-22',
    leaveOneStateOutStrategyRate17BelowMinimum: 'loso-strategy-rate-17-below-0.90',
    strategyGainBelowMinimum: 'strategy-gain-below-4',
  },
});

function validateB1Pairs(pairs: readonly MaterializedPlacementPair[]): void {
  if (pairs.length !== 32) throw new Error('b1 placement pair corpus must contain 32 pairs');
  const ids = new Set<string>();
  const strategyStateIds = new Set<string>();
  let strategy = 0;
  let safety = 0;
  for (const pair of pairs) {
    if (ids.has(pair.descriptor.id)) throw new Error(`duplicate pair id: ${pair.descriptor.id}`);
    ids.add(pair.descriptor.id);
    if (pair.descriptor.category === 'strategy') {
      strategy++;
      if (strategyStateIds.has(pair.descriptor.stateId)) throw new Error('strategy state must appear exactly once');
      strategyStateIds.add(pair.descriptor.stateId);
    }
    if (pair.descriptor.category === 'safety') safety++;
  }
  if (strategy !== 24 || safety !== 8) throw new Error('pair corpus must contain 24 strategy and 8 safety pairs');
  if (strategyStateIds.size !== 24) throw new Error('pair corpus must contain 24 unique strategy states');
}

export function createB1RepresentationCorpusEvaluationInput(
  input: Partial<RepresentationGateEvaluationInput> = {},
): RepresentationCorpusEvaluationInput<MaterializedPlacementPair, B1PlacementPairCategory, B1PlacementFeatureInput> {
  const materialize = input.materializeAllPlacementPairs ?? materializeAllPlacementPairs;
  const extractOld = input.extractFeatures ?? extractFeatures;
  const extractNew = input.extractB1PlacementFeatures ?? extractB1PlacementFeatures;
  return {
    mode: 'feature-representation-gate',
    corpus: B1_PLACEMENT_PAIR_CORPUS_ID,
    materializePairs: materialize,
    canonicalizePair: (pair) => ({
      pairId: pair.descriptor.id,
      stateId: pair.descriptor.stateId,
      category: pair.descriptor.category,
      positive: pair.positive,
      negative: pair.negative,
    }),
    extractOld: (placement) => extractOld(placement.boardAfter, placement.linesCleared, placement.placedCells),
    extractNew,
    strategyCategory: 'strategy',
    safetyCategory: 'safety',
    solverOptions: SOLVER_OPTIONS,
    judgmentThresholds: B1_JUDGMENT_THRESHOLDS,
    validatePairs: validateB1Pairs,
  };
}

export { fitLinearMarginWitness };

export function judgeRepresentationGate(input: RepresentationGateJudgmentInput): RepresentationGateJudgment {
  return judgeRepresentationCorpus(input, B1_JUDGMENT_THRESHOLDS);
}

export function evaluateRepresentationGate(
  input: Partial<RepresentationGateEvaluationInput> = {},
): RepresentationGateResult {
  try {
    return evaluateRepresentationCorpus(createB1RepresentationCorpusEvaluationInput(input)) as RepresentationGateResult;
  } catch {
    return createSafeRepresentationCorpusEvaluationResult<B1PlacementPairCategory>(
      B1_PLACEMENT_PAIR_CORPUS_ID,
    ) as RepresentationGateResult;
  }
}

export function serializeRepresentationGateResult(result: RepresentationGateResult): string {
  return serializeRepresentationSummary(result);
}

export function runRepresentationGateCli(
  input: Partial<RepresentationGateEvaluationInput> = {},
): { exitCode: 0 | 1; output: RepresentationGateResult } {
  const output = evaluateRepresentationGate(input);
  return { exitCode: output.status === 'pass' ? 0 : 1, output };
}

export function emitRepresentationGateCli(
  input: Partial<RepresentationGateEvaluationInput> = {},
  write: (chunk: string) => void = (chunk) => { process.stdout.write(chunk); },
): { exitCode: 0 | 1; output: RepresentationGateResult } {
  const result = runRepresentationGateCli(input);
  write(`${serializeRepresentationGateResult(result.output)}\n`);
  return result;
}

function isMain(url: string): boolean {
  return process.argv[1] !== undefined && fileURLToPath(url) === resolve(process.argv[1]);
}

if (isMain(import.meta.url)) {
  const result = emitRepresentationGateCli();
  process.exitCode = result.exitCode;
}
