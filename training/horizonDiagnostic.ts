import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cellKey } from '../src/ai/placements';
import {
  searchBudgeted, searchHorizonBudgeted,
  type HorizonSearchDecision, type HorizonSearchTrace, type SearchDecision,
} from '../src/ai/search';
import { DETERMINISTIC_SEARCH_LIMITS } from '../src/ai/searchBudget';
import { classifyTargetWellTransition, type HorizonBeamLimits } from '../src/ai/horizonPolicy';
import { lockPlacement } from '../src/ai/stateTransitions';
import type { PublicSearchState } from '../src/ai/publicState';
import { HORIZON_DIAGNOSTIC_WEIGHTS, type DiagnosticWeightId } from './horizonDiagnosticWeights';
import {
  TETRIS_OPPORTUNITY_CORPUS_V1, TETRIS_OPPORTUNITY_CORPUS_ID, materializeOpportunityState,
  type OpportunityActionClass, type OpportunityStratum, type SerializedOpportunityState,
} from './tetrisOpportunityCorpus';

export const D0_BUDGETS = [3584, 3840, 4096, 4352, 4608] as const;
export const D0_BEAMS = [
  { rootScoreSlots: 16, rootStrategySlots: 2, childScoreSlots: 8, childStrategySlots: 1 },
  { rootScoreSlots: 12, rootStrategySlots: 2, childScoreSlots: 6, childStrategySlots: 1 },
  { rootScoreSlots: 8, rootStrategySlots: 2, childScoreSlots: 4, childStrategySlots: 1 },
  { rootScoreSlots: 6, rootStrategySlots: 2, childScoreSlots: 3, childStrategySlots: 1 },
  { rootScoreSlots: 4, rootStrategySlots: 1, childScoreSlots: 2, childStrategySlots: 1 },
] as const;

export interface D0Configuration extends HorizonBeamLimits { maxWorkUnits: number }
export interface D0WorkUnits {
  workUnitsUsed: number;
  placementEvaluationUnits: number;
  chanceExpansionUnits: number;
  cacheHitUnits: number;
}
export interface D0StateGates {
  depthOneComplete: boolean;
  strategyDepthThreeComplete: boolean;
  strategyDepthFourComplete: boolean;
  safetyPreserved: boolean;
  targetLaneRetained: boolean;
  improvedStrategy: boolean;
  noSurvivalRegression: boolean;
  deterministic: boolean;
}
export interface D0StateResult {
  weightId: DiagnosticWeightId;
  stateId: string;
  stratum: OpportunityStratum;
  v5ActionKey: string;
  vNextActionKey: string;
  v5ActionClass: OpportunityActionClass;
  vNextActionClass: OpportunityActionClass;
  v5SurvivalProbability: number;
  vNextSurvivalProbability: number;
  v5ExpectedHeuristicValue: number;
  vNextExpectedHeuristicValue: number;
  survivalDelta: number;
  v5CompletedDepth: 0 | 1 | 2 | 3 | 4;
  completedDepth: 0 | 1 | 2 | 3 | 4;
  v5WorkUnits: D0WorkUnits;
  workUnits: D0WorkUnits;
  trace: HorizonSearchTrace;
  gates: D0StateGates;
  deterministic: boolean;
}
export interface D0DiagnosticErrorEvidence {
  kind: 'diagnostic-error';
  weightId: DiagnosticWeightId;
  stateId: string;
  stratum: OpportunityStratum;
  phase: 'v5-first' | 'v5-second' | 'horizon-first' | 'horizon-second' | 'classification';
  reason: 'search-exception' | 'no-committed-action';
}
export interface D0WeightGates {
  weightId: DiagnosticWeightId;
  depthOneComplete: boolean;
  strategyDepthThreeComplete: boolean;
  strategyDepthFourCount: number;
  safetyPreserved: boolean;
  targetLaneRetained: boolean;
  improvedStrategyCount: number;
  noSurvivalRegression: boolean;
}
export interface D0Attempt {
  configuration: D0Configuration;
  results: readonly D0StateResult[];
  diagnosticErrors: readonly D0DiagnosticErrorEvidence[];
  weightGates: readonly D0WeightGates[];
  overBudgetCount: number;
  passed: boolean;
  failureReasons: readonly string[];
}
export interface D0Output {
  mode: 'horizon-diagnostic';
  status: 'pass' | 'fail';
  corpus: 'tetris-opportunity-corpus-v1';
  weights: readonly DiagnosticWeightId[];
  selectedConfiguration: D0Configuration | null;
  attempts: readonly D0Attempt[];
  failureReasons: readonly string[];
}
export interface HorizonDiagnosticSearches {
  v5(state: PublicSearchState, weights: number[], configuration: D0Configuration): SearchDecision | null;
  horizon(state: PublicSearchState, weights: number[], configuration: D0Configuration): HorizonSearchDecision | null;
}
export interface HorizonDiagnosticCliResult { exitCode: 0 | 1; output: D0Output }

const WEIGHT_IDS = HORIZON_DIAGNOSTIC_WEIGHTS.map(({ id }) => id) as readonly DiagnosticWeightId[];
const STRATEGY_STRATA: readonly OpportunityStratum[] = ['build', 'ready', 'bag-hold'];
const ERROR_PHASES = ['v5-first', 'v5-second', 'horizon-first', 'horizon-second', 'classification'] as const;
const CONFIGURATION_KEYS = [
  'maxWorkUnits', 'rootScoreSlots', 'rootStrategySlots', 'childScoreSlots', 'childStrategySlots',
] as const;
const STATE_GATE_KEYS = [
  'depthOneComplete', 'strategyDepthThreeComplete', 'strategyDepthFourComplete', 'safetyPreserved',
  'targetLaneRetained', 'improvedStrategy', 'noSurvivalRegression', 'deterministic',
] as const;
const WEIGHT_GATE_KEYS = [
  'weightId', 'depthOneComplete', 'strategyDepthThreeComplete', 'strategyDepthFourCount',
  'safetyPreserved', 'targetLaneRetained', 'improvedStrategyCount', 'noSurvivalRegression',
] as const;
const DEFAULT_SEARCHES: HorizonDiagnosticSearches = {
  v5: (state, weights) => searchBudgeted(state, weights, DETERMINISTIC_SEARCH_LIMITS),
  horizon: (state, weights, configuration) => searchHorizonBudgeted(
    state, weights, { ...DETERMINISTIC_SEARCH_LIMITS, ...configuration },
  ),
};

function orderedConfigurations(): readonly D0Configuration[] {
  return D0_BUDGETS.flatMap((maxWorkUnits) => D0_BEAMS.map((beam) => ({ maxWorkUnits, ...beam })));
}
function sameConfiguration(left: D0Configuration, right: unknown): right is D0Configuration {
  if (right === null || typeof right !== 'object') return false;
  const candidate = right as D0Configuration;
  const keys = Object.keys(candidate).sort();
  if (keys.length !== CONFIGURATION_KEYS.length
    || keys.some((key, index) => key !== [...CONFIGURATION_KEYS].sort()[index])) return false;
  return left.maxWorkUnits === candidate.maxWorkUnits && left.rootScoreSlots === candidate.rootScoreSlots
    && left.rootStrategySlots === candidate.rootStrategySlots && left.childScoreSlots === candidate.childScoreSlots
    && left.childStrategySlots === candidate.childStrategySlots;
}
function configurationRank(configuration: unknown): number {
  return orderedConfigurations().findIndex((candidate) => sameConfiguration(candidate, configuration));
}
function actionKey(decision: SearchDecision): string {
  return decision.action.kind === 'hold' ? 'hold' : `place:${cellKey(decision.action.placement.piece)}`;
}
function actionClass(state: SerializedOpportunityState, decision: SearchDecision): OpportunityActionClass {
  if (state.stratum === 'safety') return 'safety-only';
  const publicState = materializeOpportunityState(state);
  const transition = decision.action.kind === 'hold'
    ? { boardAfter: publicState.board, linesCleared: 0 }
    : lockPlacement(publicState, decision.action.placement);
  return classifyTargetWellTransition({ boardBefore: publicState.board, boardAfter: transition.boardAfter,
    linesCleared: transition.linesCleared, targetWellColumn: state.targetWellColumn });
}
function workUnits(decision: SearchDecision): D0WorkUnits {
  return { workUnitsUsed: decision.diagnostics.workUnitsUsed,
    placementEvaluationUnits: decision.diagnostics.placementEvaluationUnits,
    chanceExpansionUnits: decision.diagnostics.chanceExpansionUnits,
    cacheHitUnits: decision.diagnostics.cacheHitUnits };
}
function decisionSignature(decision: SearchDecision | HorizonSearchDecision | null): string {
  if (decision === null) return 'null';
  return JSON.stringify({ action: decision.action, value: decision.value, diagnostics: decision.diagnostics,
    trace: 'trace' in decision ? decision.trace : null });
}
function errorEvidence(state: SerializedOpportunityState, weightId: DiagnosticWeightId,
  phase: D0DiagnosticErrorEvidence['phase'], reason: D0DiagnosticErrorEvidence['reason']): D0DiagnosticErrorEvidence {
  return { kind: 'diagnostic-error', weightId, stateId: state.id, stratum: state.stratum, phase, reason };
}

function stateEvidence(state: SerializedOpportunityState, weightId: DiagnosticWeightId, weights: readonly number[],
  configuration: D0Configuration, searches: HorizonDiagnosticSearches): D0StateResult | D0DiagnosticErrorEvidence {
  let v5First: SearchDecision | null;
  try { v5First = searches.v5(materializeOpportunityState(state), [...weights], configuration); }
  catch { return errorEvidence(state, weightId, 'v5-first', 'search-exception'); }
  if (v5First === null) return errorEvidence(state, weightId, 'v5-first', 'no-committed-action');
  let v5Second: SearchDecision | null;
  try { v5Second = searches.v5(materializeOpportunityState(state), [...weights], configuration); }
  catch { return errorEvidence(state, weightId, 'v5-second', 'search-exception'); }
  if (v5Second === null) return errorEvidence(state, weightId, 'v5-second', 'no-committed-action');
  let vNextFirst: HorizonSearchDecision | null;
  try { vNextFirst = searches.horizon(materializeOpportunityState(state), [...weights], configuration); }
  catch { return errorEvidence(state, weightId, 'horizon-first', 'search-exception'); }
  if (vNextFirst === null) return errorEvidence(state, weightId, 'horizon-first', 'no-committed-action');
  let vNextSecond: HorizonSearchDecision | null;
  try { vNextSecond = searches.horizon(materializeOpportunityState(state), [...weights], configuration); }
  catch { return errorEvidence(state, weightId, 'horizon-second', 'search-exception'); }
  if (vNextSecond === null) return errorEvidence(state, weightId, 'horizon-second', 'no-committed-action');
  try {
    const v5ActionKey = actionKey(v5First); const vNextActionKey = actionKey(vNextFirst);
    const v5ActionClass = actionClass(state, v5First);
    const vNextActionClass = actionClass(state, vNextFirst);
    const v5SurvivalProbability = v5First.value.survivalProbability;
    const vNextSurvivalProbability = vNextFirst.value.survivalProbability;
    const deterministic = decisionSignature(v5First) === decisionSignature(v5Second)
      && decisionSignature(vNextFirst) === decisionSignature(vNextSecond);
    const partial = { stateId: state.id, stratum: state.stratum, v5ActionKey, vNextActionKey, v5SurvivalProbability,
      vNextSurvivalProbability, completedDepth: vNextFirst.diagnostics.completedDepth, trace: vNextFirst.trace, deterministic };
    return { weightId, stateId: state.id, stratum: state.stratum, v5ActionKey, vNextActionKey,
      v5ActionClass, vNextActionClass,
      v5SurvivalProbability, vNextSurvivalProbability,
      v5ExpectedHeuristicValue: v5First.value.expectedHeuristicValue,
      vNextExpectedHeuristicValue: vNextFirst.value.expectedHeuristicValue,
      survivalDelta: vNextSurvivalProbability - v5SurvivalProbability,
      v5CompletedDepth: v5First.diagnostics.completedDepth, completedDepth: vNextFirst.diagnostics.completedDepth,
      v5WorkUnits: workUnits(v5First), workUnits: workUnits(vNextFirst), trace: vNextFirst.trace,
      gates: deriveStateGates({ ...partial, vNextActionClass }), deterministic };
  } catch { return errorEvidence(state, weightId, 'classification', 'search-exception'); }
}

function deriveStateGates(result: Pick<D0StateResult, 'stratum' | 'v5ActionKey' | 'vNextActionKey'
  | 'vNextActionClass' | 'v5SurvivalProbability' | 'vNextSurvivalProbability' | 'completedDepth'
  | 'deterministic' | 'stateId' | 'trace'>): D0StateGates {
  const strategy = STRATEGY_STRATA.includes(result.stratum);
  const canonicalState = TETRIS_OPPORTUNITY_CORPUS_V1.find((state) => state.id === result.stateId);
  const delta = result.vNextSurvivalProbability - result.v5SurvivalProbability;
  const noSurvivalRegression = delta >= 0;
  return { depthOneComplete: result.completedDepth >= 1,
    strategyDepthThreeComplete: !strategy || result.completedDepth >= 3,
    strategyDepthFourComplete: !strategy || result.completedDepth >= 4,
    safetyPreserved: result.stratum !== 'safety' || result.v5ActionKey === result.vNextActionKey || delta > 0,
    targetLaneRetained: !strategy || (canonicalState !== undefined
      && result.trace.rootStrategyTargetColumns.includes(canonicalState.targetWellColumn)),
    improvedStrategy: !strategy || ((result.vNextActionClass === 'preserve-well'
      || result.vNextActionClass === 'complete-tetris') && noSurvivalRegression),
    noSurvivalRegression, deterministic: result.deterministic };
}
function sameGates(left: D0StateGates, right: D0StateGates): boolean {
  if (left === null || typeof left !== 'object' || right === null || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left).sort();
  const expectedKeys = [...STATE_GATE_KEYS].sort();
  return leftKeys.length === expectedKeys.length
    && leftKeys.every((key, index) => key === expectedKeys[index]
      && typeof left[key as keyof D0StateGates] === 'boolean'
      && left[key as keyof D0StateGates] === right[key as keyof D0StateGates]);
}
function weightGate(weightId: DiagnosticWeightId, results: readonly D0StateResult[]): D0WeightGates {
  const strategy = results.filter((result) => STRATEGY_STRATA.includes(result.stratum));
  const safety = results.filter((result) => result.stratum === 'safety');
  return { weightId,
    depthOneComplete: results.length === 32 && results.every((result) => deriveStateGates(result).depthOneComplete),
    strategyDepthThreeComplete: strategy.length === 24 && strategy.every((result) => deriveStateGates(result).strategyDepthThreeComplete),
    strategyDepthFourCount: strategy.filter((result) => deriveStateGates(result).strategyDepthFourComplete).length,
    safetyPreserved: safety.length === 8 && safety.every((result) => deriveStateGates(result).safetyPreserved),
    targetLaneRetained: strategy.length === 24 && strategy.every((result) => deriveStateGates(result).targetLaneRetained),
    improvedStrategyCount: strategy.filter((result) => deriveStateGates(result).improvedStrategy).length,
    noSurvivalRegression: results.length === 32 && results.every((result) => deriveStateGates(result).noSurvivalRegression) };
}
function gatesPass(gate: D0WeightGates): boolean {
  return gate.depthOneComplete && gate.strategyDepthThreeComplete && gate.strategyDepthFourCount >= 18
    && gate.safetyPreserved && gate.targetLaneRetained && gate.improvedStrategyCount >= 18
    && gate.noSurvivalRegression;
}
function validUnits(value: unknown, limit: number): value is D0WorkUnits {
  if (value === null || typeof value !== 'object') return false;
  const units = value as D0WorkUnits;
  return [units.workUnitsUsed, units.placementEvaluationUnits, units.chanceExpansionUnits, units.cacheHitUnits]
    .every((unit) => Number.isSafeInteger(unit) && unit >= 0 && unit <= limit)
    && units.workUnitsUsed === units.placementEvaluationUnits + units.chanceExpansionUnits + units.cacheHitUnits;
}
function validActionKey(key: unknown): boolean {
  if (key === 'hold') return true;
  if (typeof key !== 'string' || !/^place:\d+(?:,\d+){3}$/.test(key)) return false;
  const cells = key.slice(6).split(',').map(Number);
  return cells.every((cell, index) => Number.isSafeInteger(cell) && cell >= 0 && cell < 220
    && (index === 0 || cells[index - 1]! < cell));
}
function validTrace(trace: unknown, result: D0StateResult, configuration: D0Configuration): boolean {
  if (trace === null || typeof trace !== 'object') return false;
  const candidate = trace as HorizonSearchTrace;
  if (!Array.isArray(candidate.rootStrategyTargetColumns)
    || candidate.rootStrategyTargetColumns.some((column) =>
      !Number.isSafeInteger(column) || column < 0 || column > 9)
    || candidate.rootStrategyTargetColumns.some((column, index, all) =>
      index > 0 && all[index - 1]! >= column)) return false;
  if (!Array.isArray(candidate.completedDepths) || candidate.completedDepths.length !== result.completedDepth) return false;
  const layers = candidate.completedDepths;
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index];
    if (layer === null || typeof layer !== 'object' || layer.depth !== index + 1
      || (layer.actionKind !== 'place' && layer.actionKind !== 'hold')
      || (layer.beamSource !== 'score' && layer.beamSource !== 'strategy'
        && layer.beamSource !== 'both' && layer.beamSource !== 'hold')
      || (layer.actionKind === 'hold') !== (layer.beamSource === 'hold')
      || (layer.actionKind === 'hold' && layer.targetWellColumn !== null)
      || (layer.targetWellColumn !== null
        && (!Number.isSafeInteger(layer.targetWellColumn) || layer.targetWellColumn < 0 || layer.targetWellColumn > 9))
      || layer.value === null || typeof layer.value !== 'object'
      || !Number.isFinite(layer.value.survivalProbability) || layer.value.survivalProbability < 0
      || layer.value.survivalProbability > 1 || !Number.isFinite(layer.value.expectedHeuristicValue)
      || layer.work === null || typeof layer.work !== 'object' || !Number.isSafeInteger(layer.work.limit)
      || layer.work.limit !== configuration.maxWorkUnits || !Number.isSafeInteger(layer.work.used)
      || layer.work.used < 0 || layer.work.used > layer.work.limit
      || typeof layer.work.exhausted !== 'boolean' || layer.work.exhausted !== (layer.work.used === layer.work.limit)
      || !validUnits({ workUnitsUsed: layer.work.used, placementEvaluationUnits: layer.work.placementEvaluationUnits,
        chanceExpansionUnits: layer.work.chanceExpansionUnits, cacheHitUnits: layer.work.cacheHitUnits }, layer.work.limit)) return false;
  }
  const last = layers.at(-1);
  return last === undefined || ((last.actionKind === 'hold') === (result.vNextActionKey === 'hold')
    && last.value.survivalProbability === result.vNextSurvivalProbability
    && last.value.expectedHeuristicValue === result.vNextExpectedHeuristicValue
    && last.work.used === result.workUnits.workUnitsUsed
    && last.work.placementEvaluationUnits === result.workUnits.placementEvaluationUnits
    && last.work.chanceExpansionUnits === result.workUnits.chanceExpansionUnits
    && last.work.cacheHitUnits === result.workUnits.cacheHitUnits);
}
function validStateResult(value: unknown, configuration: D0Configuration): value is D0StateResult {
  if (value === null || typeof value !== 'object') return false;
  const result = value as D0StateResult;
  const validClass = (actionClass: unknown): actionClass is OpportunityActionClass => actionClass === 'preserve-well'
    || actionClass === 'complete-tetris' || actionClass === 'destroy-well' || actionClass === 'safety-only';
  const validDepth = (depth: unknown): depth is 0 | 1 | 2 | 3 | 4 => typeof depth === 'number'
    && Number.isSafeInteger(depth) && depth >= 0 && depth <= 4;
  if (!WEIGHT_IDS.includes(result.weightId) || typeof result.stateId !== 'string'
    || !STRATEGY_STRATA.includes(result.stratum) && result.stratum !== 'safety'
    || !validActionKey(result.v5ActionKey) || !validActionKey(result.vNextActionKey)
    || !validClass(result.v5ActionClass) || !validClass(result.vNextActionClass)
    || ![result.v5SurvivalProbability, result.vNextSurvivalProbability].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    || !Number.isFinite(result.v5ExpectedHeuristicValue) || !Number.isFinite(result.vNextExpectedHeuristicValue)
    || result.survivalDelta !== result.vNextSurvivalProbability - result.v5SurvivalProbability
    || !validDepth(result.v5CompletedDepth) || !validDepth(result.completedDepth)
    || !validUnits(result.v5WorkUnits, DETERMINISTIC_SEARCH_LIMITS.maxWorkUnits)
    || !validUnits(result.workUnits, configuration.maxWorkUnits) || typeof result.deterministic !== 'boolean'
    || result.gates === null || typeof result.gates !== 'object' || !validTrace(result.trace, result, configuration)) return false;
  if (result.stratum === 'safety'
    ? result.v5ActionClass !== 'safety-only' || result.vNextActionClass !== 'safety-only'
    : result.v5ActionClass === 'safety-only' || result.vNextActionClass === 'safety-only') return false;
  return sameGates(result.gates, deriveStateGates(result));
}
function validDiagnosticError(value: unknown): value is D0DiagnosticErrorEvidence {
  if (value === null || typeof value !== 'object') return false;
  const error = value as D0DiagnosticErrorEvidence;
  const state = TETRIS_OPPORTUNITY_CORPUS_V1.find((candidate) => candidate.id === error.stateId);
  return error.kind === 'diagnostic-error' && WEIGHT_IDS.includes(error.weightId) && state !== undefined
    && state.stratum === error.stratum && ERROR_PHASES.includes(error.phase)
    && (error.reason === 'search-exception' || error.reason === 'no-committed-action');
}
function validWeightGate(value: unknown): value is D0WeightGates {
  if (value === null || typeof value !== 'object') return false;
  const gate = value as D0WeightGates;
  const keys = Object.keys(gate).sort();
  const expectedKeys = [...WEIGHT_GATE_KEYS].sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
    && typeof gate.weightId === 'string' && typeof gate.depthOneComplete === 'boolean'
    && typeof gate.strategyDepthThreeComplete === 'boolean'
    && Number.isSafeInteger(gate.strategyDepthFourCount) && gate.strategyDepthFourCount >= 0
    && typeof gate.safetyPreserved === 'boolean' && typeof gate.targetLaneRetained === 'boolean'
    && Number.isSafeInteger(gate.improvedStrategyCount) && gate.improvedStrategyCount >= 0
    && typeof gate.noSurvivalRegression === 'boolean';
}
function sameWeightGate(left: D0WeightGates, right: D0WeightGates): boolean {
  return left.weightId === right.weightId && left.depthOneComplete === right.depthOneComplete
    && left.strategyDepthThreeComplete === right.strategyDepthThreeComplete
    && left.strategyDepthFourCount === right.strategyDepthFourCount && left.safetyPreserved === right.safetyPreserved
    && left.targetLaneRetained === right.targetLaneRetained && left.improvedStrategyCount === right.improvedStrategyCount
    && left.noSurvivalRegression === right.noSurvivalRegression;
}

interface AttemptAnalysis { structural: string[]; normal: string[]; passed: boolean; reasons: string[] }
function analyzeAttempt(attempt: D0Attempt): AttemptAnalysis {
  const structural: string[] = []; const normal: string[] = [];
  if (configurationRank(attempt.configuration) < 0) structural.push('unknown-configuration');
  if (attempt.configuration === null || typeof attempt.configuration !== 'object') {
    return { structural: [...structural, 'malformed-configuration'], normal, passed: false,
      reasons: ['structural-evidence-invalid'] };
  }
  if (!Array.isArray(attempt.results) || !Array.isArray(attempt.diagnosticErrors) || !Array.isArray(attempt.weightGates)) {
    structural.push('invalid-attempt-arrays');
    return { structural, normal, passed: false, reasons: ['structural-evidence-invalid'] };
  }
  const covered = new Set<string>();
  const validatedResults: D0StateResult[] = [];
  for (const result of attempt.results) {
    if (!validStateResult(result, attempt.configuration)) { structural.push('malformed-state-evidence'); continue; }
    const canonicalState = TETRIS_OPPORTUNITY_CORPUS_V1.find((state) => state.id === result.stateId);
    if (canonicalState === undefined || canonicalState.stratum !== result.stratum) {
      structural.push('noncanonical-state-evidence');
      continue;
    }
    const key = `${result.weightId}:${result.stateId}`;
    if (covered.has(key)) structural.push('duplicate-state-evidence');
    else { covered.add(key); validatedResults.push(result); }
  }
  const validatedErrors: D0DiagnosticErrorEvidence[] = [];
  for (const error of attempt.diagnosticErrors) {
    if (!validDiagnosticError(error)) { structural.push('malformed-diagnostic-error-evidence'); continue; }
    const key = `${error.weightId}:${error.stateId}`;
    if (covered.has(key)) structural.push('duplicate-state-evidence');
    else { covered.add(key); validatedErrors.push(error); }
  }
  for (const weightId of WEIGHT_IDS) for (const state of TETRIS_OPPORTUNITY_CORPUS_V1) {
    if (!covered.has(`${weightId}:${state.id}`)) structural.push('missing-state-evidence');
  }
  if (validatedErrors.length > 0) normal.push('diagnostic-error-evidence');
  const derivedOverBudget = validatedResults.filter((result) =>
    result.workUnits.workUnitsUsed > attempt.configuration.maxWorkUnits).length;
  if (!Number.isSafeInteger(attempt.overBudgetCount) || attempt.overBudgetCount !== derivedOverBudget) {
    structural.push('over-budget-count-mismatch');
  }
  if (derivedOverBudget !== 0) normal.push('over-budget-work');
  const gateIds = attempt.weightGates.map((gate) => validWeightGate(gate) ? gate.weightId : null);
  if (gateIds.length !== WEIGHT_IDS.length || new Set(gateIds).size !== WEIGHT_IDS.length
    || WEIGHT_IDS.some((weightId) => !gateIds.includes(weightId))) structural.push('invalid-weight-gates');
  for (const weightId of WEIGHT_IDS) {
    const results = validatedResults.filter((result) => result.weightId === weightId);
    const expected = weightGate(weightId, results);
    const supplied = attempt.weightGates.find((gate) => validWeightGate(gate) && gate.weightId === weightId);
    if (supplied === undefined || !sameWeightGate(supplied, expected)) structural.push('weight-gate-evidence-mismatch');
    if (!gatesPass(expected)) normal.push(`weight-gates-failed:${weightId}`);
  }
  const baseReasons = [...new Set([...normal, ...(structural.length > 0 ? ['structural-evidence-invalid'] : [])])];
  const passed = baseReasons.length === 0;
  if (typeof attempt.passed !== 'boolean' || attempt.passed !== passed) structural.push('attempt-status-mismatch');
  if (!Array.isArray(attempt.failureReasons) || attempt.failureReasons.some((reason) => typeof reason !== 'string')
    || JSON.stringify(attempt.failureReasons) !== JSON.stringify(baseReasons)) structural.push('attempt-reasons-mismatch');
  return { structural, normal, passed: structural.length === 0 && passed,
    reasons: structural.length === 0 ? baseReasons : [...new Set([...normal, 'structural-evidence-invalid'])] };
}

function orderedAttempts(attempts: readonly D0Attempt[]): D0Attempt[] {
  return [...attempts].sort((left, right) => {
    const leftRank = configurationRank(left.configuration); const rightRank = configurationRank(right.configuration);
    return (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank) - (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank);
  });
}
function canonicalSetIssues(attempts: readonly D0Attempt[]): string[] {
  const expected = orderedConfigurations();
  if (attempts.length !== expected.length) return ['canonical-attempt-count-mismatch'];
  const seen = new Set<number>();
  for (const attempt of attempts) {
    const rank = configurationRank(attempt.configuration);
    if (rank < 0) return ['unknown-configuration'];
    if (seen.has(rank)) return ['duplicate-configuration'];
    seen.add(rank);
  }
  return seen.size === expected.length ? [] : ['missing-canonical-configuration'];
}
export function selectD0Configuration(attempts: readonly D0Attempt[]): D0Output {
  const ordered = orderedAttempts(attempts); const structural = canonicalSetIssues(attempts);
  const analyses = ordered.map(analyzeAttempt);
  if (structural.length > 0 || analyses.some((analysis) => analysis.structural.length > 0)
    || analyses.some((analysis) => analysis.normal.includes('diagnostic-error-evidence'))) {
    return { mode: 'horizon-diagnostic', status: 'fail', corpus: TETRIS_OPPORTUNITY_CORPUS_ID,
      weights: WEIGHT_IDS, selectedConfiguration: null, attempts: ordered,
      failureReasons: ['structural-or-diagnostic-evidence-failed'] };
  }
  const selected = ordered.find((_, index) => analyses[index]!.passed);
  return selected === undefined
    ? { mode: 'horizon-diagnostic', status: 'fail', corpus: TETRIS_OPPORTUNITY_CORPUS_ID,
      weights: WEIGHT_IDS, selectedConfiguration: null, attempts: ordered, failureReasons: ['no-configuration-passed'] }
    : { mode: 'horizon-diagnostic', status: 'pass', corpus: TETRIS_OPPORTUNITY_CORPUS_ID,
      weights: WEIGHT_IDS, selectedConfiguration: selected.configuration, attempts: ordered, failureReasons: [] };
}

function measureAttempt(configuration: D0Configuration, searches: HorizonDiagnosticSearches): D0Attempt {
  const results: D0StateResult[] = []; const diagnosticErrors: D0DiagnosticErrorEvidence[] = [];
  for (const weight of HORIZON_DIAGNOSTIC_WEIGHTS) for (const state of TETRIS_OPPORTUNITY_CORPUS_V1) {
    const evidence = stateEvidence(state, weight.id, weight.weights, configuration, searches);
    if ('kind' in evidence) diagnosticErrors.push(evidence); else results.push(evidence);
  }
  const weightGates = WEIGHT_IDS.map((weightId) => weightGate(weightId, results.filter((result) => result.weightId === weightId)));
  const overBudgetCount = results.filter((result) => result.workUnits.workUnitsUsed > configuration.maxWorkUnits).length;
  const normal = [
    ...(diagnosticErrors.length > 0 ? ['diagnostic-error-evidence'] : []),
    ...(overBudgetCount > 0 ? ['over-budget-work'] : []),
    ...weightGates.filter((gate) => !gatesPass(gate)).map((gate) => `weight-gates-failed:${gate.weightId}`),
  ];
  return { configuration, results, diagnosticErrors, weightGates, overBudgetCount,
    passed: normal.length === 0, failureReasons: normal };
}
export function runHorizonDiagnosticWithSearch(searches: HorizonDiagnosticSearches): D0Output {
  return selectD0Configuration(orderedConfigurations().map((configuration) => measureAttempt(configuration, searches)));
}
export function runHorizonDiagnostic(): D0Output { return runHorizonDiagnosticWithSearch(DEFAULT_SEARCHES); }
export function runHorizonDiagnosticCli(searches: HorizonDiagnosticSearches = DEFAULT_SEARCHES): HorizonDiagnosticCliResult {
  const output = runHorizonDiagnosticWithSearch(searches);
  return { exitCode: output.status === 'pass' ? 0 : 1, output };
}
export function serializeHorizonDiagnostic(output: D0Output): string {
  return JSON.stringify({ mode: output.mode, status: output.status, corpus: output.corpus, weights: output.weights,
    selectedConfiguration: output.selectedConfiguration, attempts: output.attempts, failureReasons: output.failureReasons });
}
function isMain(url: string): boolean { return process.argv[1] !== undefined && fileURLToPath(url) === resolve(process.argv[1]); }
if (isMain(import.meta.url)) {
  const result = runHorizonDiagnosticCli();
  process.stdout.write(`${serializeHorizonDiagnostic(result.output)}\n`);
  process.exitCode = result.exitCode;
}
