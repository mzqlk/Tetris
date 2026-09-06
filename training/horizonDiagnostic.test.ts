import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HorizonSearchDecision, SearchDecision } from '../src/ai/search';
import { TETRIS_OPPORTUNITY_CORPUS_V1 } from './tetrisOpportunityCorpus';
import {
  D0_BEAMS, D0_BUDGETS, runHorizonDiagnosticCli, runHorizonDiagnosticWithSearch,
  selectD0Configuration, serializeHorizonDiagnostic,
  type D0Attempt, type D0Configuration, type D0DiagnosticErrorEvidence, type D0Output,
  type HorizonDiagnosticSearches,
} from './horizonDiagnostic';

const weights = ['published-baseline', 'gen-6-best', 'gen-10-fixed'] as const;

function configurations(): D0Configuration[] {
  return D0_BUDGETS.flatMap((maxWorkUnits) => D0_BEAMS.map((beam) => ({ maxWorkUnits, ...beam })));
}

function expectedRootStrategyTargetColumns(stateId: string): number[] {
  const state = TETRIS_OPPORTUNITY_CORPUS_V1.find((candidate) => candidate.id === stateId);
  if (state === undefined || state.stratum === 'safety') return [];
  return [state.targetWellColumn];
}

function trace(configuration: D0Configuration, rootStrategyTargetColumns: readonly number[] = []) {
  return {
    completedDepths: [1, 2, 3, 4].map((depth) => ({
      depth: depth as 1 | 2 | 3 | 4, actionKind: 'hold' as const, beamSource: 'hold' as const,
      targetWellColumn: null, value: { survivalProbability: 1, expectedHeuristicValue: 0 },
      work: { limit: configuration.maxWorkUnits, used: depth, placementEvaluationUnits: depth,
        chanceExpansionUnits: 0, cacheHitUnits: 0, exhausted: false },
    })),
    rootStrategyTargetColumns: [...rootStrategyTargetColumns],
    strategySlotsRetained: 1, strategySlotsDeduplicated: 0, strategySlotsPruned: 0,
    targetWellEstablished: 1, targetWellReset: 0, targetWellInvalidated: 0,
  };
}

function passingAttempt(configuration: D0Configuration): D0Attempt {
  const results = weights.flatMap((weightId) => TETRIS_OPPORTUNITY_CORPUS_V1.map((state) => ({
    weightId, stateId: state.id, stratum: state.stratum, v5ActionKey: 'hold', vNextActionKey: 'hold',
    v5ActionClass: state.stratum === 'safety' ? 'safety-only' as const : 'preserve-well' as const,
    vNextActionClass: state.stratum === 'safety' ? 'safety-only' as const : 'preserve-well' as const,
    v5SurvivalProbability: 1, vNextSurvivalProbability: 1,
    v5ExpectedHeuristicValue: 0, vNextExpectedHeuristicValue: 0, survivalDelta: 0,
    v5CompletedDepth: 4 as const, completedDepth: 4 as const,
    v5WorkUnits: { workUnitsUsed: 4, placementEvaluationUnits: 4, chanceExpansionUnits: 0, cacheHitUnits: 0 },
    workUnits: { workUnitsUsed: 4, placementEvaluationUnits: 4, chanceExpansionUnits: 0, cacheHitUnits: 0 },
    trace: trace(configuration, expectedRootStrategyTargetColumns(state.id)),
    gates: { depthOneComplete: true, strategyDepthThreeComplete: true, strategyDepthFourComplete: true,
      safetyPreserved: true, targetLaneRetained: true, improvedStrategy: true,
      noSurvivalRegression: true, deterministic: true }, deterministic: true,
  })));
  return {
    configuration, results, diagnosticErrors: [],
    weightGates: weights.map((weightId) => ({ weightId, depthOneComplete: true,
      strategyDepthThreeComplete: true, strategyDepthFourCount: 24, safetyPreserved: true,
      targetLaneRetained: true, improvedStrategyCount: 24, noSurvivalRegression: true })),
    overBudgetCount: 0, passed: true, failureReasons: [],
  };
}

function allPassingAttempts(): D0Attempt[] { return configurations().map(passingAttempt); }

function replaceFirstResult(attempt: D0Attempt, patch: Record<string, unknown>): D0Attempt {
  return { ...attempt, results: attempt.results.map((result, index) =>
    index === 0 ? { ...result, ...patch } : result) } as D0Attempt;
}

function ordinaryGateFailure(attempt: D0Attempt): D0Attempt {
  const failedWeights = new Set(weights);
  const results = attempt.results.map((result) => {
    if (result.stratum !== 'safety' || !result.stateId.endsWith('-00')) return result;
    const layers = result.trace.completedDepths.map((layer, index, all) => index === all.length - 1
      ? { ...layer, actionKind: 'place' as const, beamSource: 'score' as const }
      : layer);
    return {
      ...result,
      vNextActionKey: 'place:1,2,3,4',
      trace: { ...result.trace, completedDepths: layers },
      gates: { ...result.gates, safetyPreserved: false },
    };
  });
  return {
    ...attempt,
    results,
    weightGates: attempt.weightGates.map((gate) => ({ ...gate, safetyPreserved: false })),
    passed: false,
    failureReasons: [...failedWeights].map((weightId) => `weight-gates-failed:${weightId}`),
  };
}

function fakeDecision(configuration: D0Configuration): HorizonSearchDecision {
  return {
    action: { kind: 'hold' }, value: { survivalProbability: 1, expectedHeuristicValue: 0 },
    diagnostics: { completedDepth: 4, attemptedDepth: 4, workUnitsUsed: 4,
      workUnitsLimit: configuration.maxWorkUnits, placementEvaluationUnits: 4,
      chanceExpansionUnits: 0, cacheHitUnits: 0, budgetExhausted: false,
      expandedDecisionNodes: 0, expandedChanceNodes: 0, cacheHits: 0, placementCacheHits: 0,
      placementCacheEntries: 0, transpositionEntries: 0, equivalentPlacementsRemoved: 0,
      prunedChanceBranches: 0, aborted: false }, trace: trace(configuration),
  };
}

function fakeSearches(onV5?: () => void): HorizonDiagnosticSearches {
  return {
    v5(_state, _weights, configuration): SearchDecision {
      onV5?.();
      const { action, value, diagnostics } = fakeDecision(configuration);
      return { action, value, diagnostics };
    },
    horizon(_state, _weights, configuration): HorizonSearchDecision { return fakeDecision(configuration); },
  };
}

describe('D0 literals and selection', () => {
  it('keeps the approved budget and beam literals exact', () => {
    expect(D0_BUDGETS).toEqual([3584, 3840, 4096, 4352, 4608]);
    expect(D0_BEAMS).toEqual([
      { rootScoreSlots: 16, rootStrategySlots: 2, childScoreSlots: 8, childStrategySlots: 1 },
      { rootScoreSlots: 12, rootStrategySlots: 2, childScoreSlots: 6, childStrategySlots: 1 },
      { rootScoreSlots: 8, rootStrategySlots: 2, childScoreSlots: 4, childStrategySlots: 1 },
      { rootScoreSlots: 6, rootStrategySlots: 2, childScoreSlots: 3, childStrategySlots: 1 },
      { rootScoreSlots: 4, rootStrategySlots: 1, childScoreSlots: 2, childStrategySlots: 1 },
    ]);
  });

  it('selects only after validating all 25 canonical attempts', () => {
    const result = selectD0Configuration(allPassingAttempts().reverse());
    expect(result.status).toBe('pass');
    expect(result.selectedConfiguration).toEqual(configurations()[0]);
    expect(result.attempts).toHaveLength(25);
  });

  it.each([
    ['missing predecessor', (attempts: D0Attempt[]) => attempts.slice(1)],
    ['duplicate configuration', (attempts: D0Attempt[]) => [...attempts, attempts[0]!]],
    ['unknown configuration', (attempts: D0Attempt[]) => [
      { ...attempts[0]!, configuration: { ...attempts[0]!.configuration, maxWorkUnits: 9999 } }, ...attempts.slice(1),
    ]],
    ['malformed configuration', (attempts: D0Attempt[]) => [
      { ...attempts[0]!, configuration: null }, ...attempts.slice(1),
    ] as unknown as D0Attempt[]],
  ])('fails closed for %s in the exact canonical attempt set', (_label, mutate) => {
    expect(selectD0Configuration(mutate(allPassingAttempts()))).toMatchObject({ status: 'fail', selectedConfiguration: null });
  });

  it.each([
    ['an earlier structural error despite later valid attempts', (attempt: D0Attempt) => replaceFirstResult(attempt, { vNextActionKey: 'place:safety:0' })],
    ['a forged passed/status/reasons combination', (attempt: D0Attempt) => ({ ...attempt, failureReasons: ['forged-passing-reason'] })],
    ['a recomputed over-budget result', (attempt: D0Attempt) => replaceFirstResult(attempt, { workUnits: { workUnitsUsed: 3585, placementEvaluationUnits: 3585, chanceExpansionUnits: 0, cacheHitUnits: 0 } })],
    ['a trace budget mismatch', (attempt: D0Attempt) => replaceFirstResult(attempt, { trace: trace({ ...attempt.configuration, maxWorkUnits: attempt.configuration.maxWorkUnits + 1 }) })],
    ['negative work categories', (attempt: D0Attempt) => replaceFirstResult(attempt, { workUnits: { workUnitsUsed: -1, placementEvaluationUnits: -1, chanceExpansionUnits: 0, cacheHitUnits: 0 } })],
    ['an out-of-range probability', (attempt: D0Attempt) => replaceFirstResult(attempt, { vNextSurvivalProbability: 1.1, survivalDelta: 0.1 })],
  ])('does not permit %s to be skipped by later tuples', (_label, mutate) => {
    const attempts = allPassingAttempts(); attempts[0] = mutate(attempts[0]!);
    expect(selectD0Configuration(attempts)).toMatchObject({ status: 'fail', selectedConfiguration: null });
  });

  it.each([
    ['missing', (attempt: D0Attempt) => ({ ...attempt, weightGates: attempt.weightGates.slice(1) })],
    ['duplicate', (attempt: D0Attempt) => ({ ...attempt, weightGates: [...attempt.weightGates, attempt.weightGates[0]!] })],
    ['extra', (attempt: D0Attempt) => ({ ...attempt, weightGates: [...attempt.weightGates, { ...attempt.weightGates[0]!, weightId: 'extra' }] } as unknown as D0Attempt)],
  ])('fails closed for %s weight-gate evidence', (_label, mutate) => {
    const attempts = allPassingAttempts(); attempts[0] = mutate(attempts[0]!);
    expect(selectD0Configuration(attempts).status).toBe('fail');
  });

  it('treats explicit diagnostic-error evidence as global failure instead of an empty attempt', () => {
    const attempts = allPassingAttempts(); const first = attempts[0]!; const lost = first.results[0]!;
    const error: D0DiagnosticErrorEvidence = { kind: 'diagnostic-error', weightId: lost.weightId,
      stateId: lost.stateId, stratum: lost.stratum, phase: 'v5-first', reason: 'search-exception' };
    attempts[0] = { ...first, results: first.results.slice(1), diagnosticErrors: [error], weightGates: [],
      overBudgetCount: 0, passed: false, failureReasons: ['diagnostic-error-evidence'] };
    expect(selectD0Configuration(attempts)).toMatchObject({ status: 'fail', selectedConfiguration: null });
  });

  it.each([
    ['null result', (attempt: D0Attempt) => ({ ...attempt, results: [null, ...attempt.results.slice(1)] } as unknown as D0Attempt)],
    ['missing work units', (attempt: D0Attempt) => replaceFirstResult(attempt, { workUnits: undefined })],
    ['null trace layer', (attempt: D0Attempt) => replaceFirstResult(attempt, { trace: { ...attempt.results[0]!.trace, completedDepths: attempt.results[0]!.trace.completedDepths.map((layer, index) => index === 1 ? null : layer) } })],
    ['trace layer without value', (attempt: D0Attempt) => replaceFirstResult(attempt, { trace: { ...attempt.results[0]!.trace, completedDepths: attempt.results[0]!.trace.completedDepths.map((layer, index) => index === 1 ? { ...layer, value: undefined } : layer) } })],
    ['trace layer without work', (attempt: D0Attempt) => replaceFirstResult(attempt, { trace: { ...attempt.results[0]!.trace, completedDepths: attempt.results[0]!.trace.completedDepths.map((layer, index) => index === 1 ? { ...layer, work: undefined } : layer) } })],
  ])('fails closed without throwing for %s', (_label, mutate) => {
    const attempts = allPassingAttempts(); attempts[0] = mutate(attempts[0]!);
    expect(() => selectD0Configuration(attempts)).not.toThrow();
    expect(selectD0Configuration(attempts).status).toBe('fail');
  });

  it.each([
    ['extra config key', (attempt: D0Attempt) => ({ ...attempt, configuration: { ...attempt.configuration, seed: 1 } } as unknown as D0Attempt)],
    ['missing state', (attempt: D0Attempt) => ({ ...attempt, results: attempt.results.slice(1) })],
    ['duplicate state', (attempt: D0Attempt) => ({ ...attempt, results: attempt.results.map((result, index) => index === 1 ? { ...result, stateId: attempt.results[0]!.stateId } : result) })],
    ['unknown state', (attempt: D0Attempt) => replaceFirstResult(attempt, { stateId: 'unknown-00' })],
    ['extra state', (attempt: D0Attempt) => ({ ...attempt, results: [...attempt.results, attempt.results[0]!] })],
    ['stratum mismatch', (attempt: D0Attempt) => replaceFirstResult(attempt, { stratum: 'safety' })],
  ])('requires exact canonical coverage for %s', (_label, mutate) => {
    const attempts = allPassingAttempts(); attempts[0] = mutate(attempts[0]!);
    expect(selectD0Configuration(attempts).status).toBe('fail');
  });

  it.each([
    ['empty gates', (attempt: D0Attempt) => replaceFirstResult(attempt, { gates: {} })],
    ['partial gates', (attempt: D0Attempt) => replaceFirstResult(attempt, { gates: { deterministic: true } })],
    ['extra gate', (attempt: D0Attempt) => replaceFirstResult(attempt, { gates: { ...attempt.results[0]!.gates, extra: true } })],
    ['missing root strategy target columns', (attempt: D0Attempt) => replaceFirstResult(attempt, {
      trace: { ...trace(attempt.configuration), rootStrategyTargetColumns: undefined },
    })],
    ['duplicate root strategy target columns', (attempt: D0Attempt) => replaceFirstResult(attempt, { trace: trace(attempt.configuration, [4, 4]) })],
    ['unsorted root strategy target columns', (attempt: D0Attempt) => replaceFirstResult(attempt, { trace: trace(attempt.configuration, [4, 3]) })],
    ['out-of-range root strategy target columns', (attempt: D0Attempt) => replaceFirstResult(attempt, { trace: trace(attempt.configuration, [10]) })],
    ['hold intent is not null', (attempt: D0Attempt) => replaceFirstResult(attempt, { trace: { ...attempt.results[0]!.trace, completedDepths: attempt.results[0]!.trace.completedDepths.map((layer, index) => index === 1 ? { ...layer, targetWellColumn: 0 } : layer) } })],
    ['invalid action kind', (attempt: D0Attempt) => replaceFirstResult(attempt, { trace: { ...attempt.results[0]!.trace, completedDepths: attempt.results[0]!.trace.completedDepths.map((layer, index) => index === 3 ? { ...layer, actionKind: 'invalid' } : layer) } })],
    ['invalid beam source', (attempt: D0Attempt) => replaceFirstResult(attempt, { trace: { ...attempt.results[0]!.trace, completedDepths: attempt.results[0]!.trace.completedDepths.map((layer, index) => index === 3 ? { ...layer, beamSource: 'invalid' } : layer) } })],
    ['invalid target well', (attempt: D0Attempt) => replaceFirstResult(attempt, { trace: { ...attempt.results[0]!.trace, completedDepths: attempt.results[0]!.trace.completedDepths.map((layer, index) => index === 3 ? { ...layer, targetWellColumn: 10 } : layer) } })],
    ['final action mismatch', (attempt: D0Attempt) => replaceFirstResult(attempt, { trace: { ...attempt.results[0]!.trace, completedDepths: attempt.results[0]!.trace.completedDepths.map((layer, index) => index === 3 ? { ...layer, actionKind: 'place', beamSource: 'score' } : layer) } })],
  ])('rejects frozen gate and trace contract violations: %s', (_label, mutate) => {
    const attempts = allPassingAttempts(); attempts[0] = mutate(attempts[0]!);
    expect(selectD0Configuration(attempts).status).toBe('fail');
  });

  it.each([
    ['missing frozen field', (attempt: D0Attempt) => ({ ...attempt, weightGates: attempt.weightGates.map((gate, index) => index === 0 ? { weightId: gate.weightId } : gate) } as unknown as D0Attempt)],
    ['extra frozen field', (attempt: D0Attempt) => ({ ...attempt, weightGates: attempt.weightGates.map((gate, index) => index === 0 ? { ...gate, extra: true } : gate) } as unknown as D0Attempt)],
  ])('rejects weight-gate object with %s', (_label, mutate) => {
    const attempts = allPassingAttempts(); attempts[0] = mutate(attempts[0]!);
    expect(selectD0Configuration(attempts).status).toBe('fail');
  });

  it('returns null when all 25 ordinary gates fail', () => {
    const result = selectD0Configuration(allPassingAttempts().map(ordinaryGateFailure));
    expect(result).toMatchObject({ status: 'fail', selectedConfiguration: null, failureReasons: ['no-configuration-passed'] });
  });

  it('does not let a preserve-well final classification fake target-lane retention without root strategy evidence', () => {
    const attempts = allPassingAttempts();
    const first = attempts[0]!;
    const strategyIndex = first.results.findIndex((result) => result.stratum !== 'safety');
    attempts[0] = {
      ...first,
      results: first.results.map((result, index) => index !== strategyIndex ? result : {
        ...result,
        vNextActionClass: 'preserve-well',
        trace: trace(first.configuration, []),
        gates: { ...result.gates, targetLaneRetained: true },
      }),
    };

    expect(selectD0Configuration(attempts).status).toBe('fail');
  });

  it('selects the first 3840 tuple after five ordinary 3584 gate failures', () => {
    const attempts = allPassingAttempts();
    for (let index = 0; index < 5; index++) attempts[index] = ordinaryGateFailure(attempts[index]!);
    expect(selectD0Configuration(attempts).selectedConfiguration).toEqual(configurations()[5]);
  });

  it('retains the earlier passing tuple within the same budget', () => {
    const attempts = allPassingAttempts().map(ordinaryGateFailure);
    attempts[0] = passingAttempt(configurations()[0]!);
    attempts[4] = passingAttempt(configurations()[4]!);
    expect(selectD0Configuration(attempts).selectedConfiguration).toEqual(configurations()[0]);
  });
});

describe('bounded runner boundary', () => {
  it('records a search exception and completes the 25-tuple ladder with controlled searches', () => {
    let calls = 0;
    const output = runHorizonDiagnosticWithSearch(fakeSearches(() => { calls++; if (calls === 1) throw new Error('synthetic'); }));
    expect(output.status).toBe('fail'); expect(output.selectedConfiguration).toBeNull();
    expect(output.attempts).toHaveLength(25);
    expect(output.attempts[0]!.diagnosticErrors).toEqual([expect.objectContaining({ kind: 'diagnostic-error', phase: 'v5-first', reason: 'search-exception' })]);
    expect(calls).toBe(25 * 32 * 3 * 2 - 1);
  });

  it('maps an injected failed run to CLI exit 1 without invoking real D0', () => {
    const result = runHorizonDiagnosticCli(fakeSearches(() => { throw new Error('synthetic'); }));
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(serializeHorizonDiagnostic(result.output))).toMatchObject({ status: 'fail' });
  });

  it('calls both searches exactly twice for every normal state', () => {
    let v5Calls = 0; let horizonCalls = 0;
    const searches: HorizonDiagnosticSearches = {
      v5(_state, _weights, configuration) { v5Calls++; const { action, value, diagnostics } = fakeDecision(configuration); return { action, value, diagnostics }; },
      horizon(_state, _weights, configuration) { horizonCalls++; return fakeDecision(configuration); },
    };
    runHorizonDiagnosticWithSearch(searches);
    expect(v5Calls).toBe(25 * 32 * 3 * 2);
    expect(horizonCalls).toBe(25 * 32 * 3 * 2);
  });
});

describe('stdout-only serialization contract', () => {
  const output: D0Output = { mode: 'horizon-diagnostic', status: 'fail', corpus: 'tetris-opportunity-corpus-v1',
    weights, selectedConfiguration: null, attempts: [], failureReasons: ['no-configuration-passed'] };

  it('rebuilds frozen key order instead of retaining input insertion order', () => {
    const shuffled = { failureReasons: output.failureReasons, attempts: output.attempts,
      selectedConfiguration: output.selectedConfiguration, weights: output.weights, corpus: output.corpus,
      status: output.status, mode: output.mode } as D0Output;
    expect(serializeHorizonDiagnostic(shuffled)).toBe(JSON.stringify(output));
  });

  it('keeps a normal module import silent', () => {
    const importOutput = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module',
      '-e', "await import('./training/horizonDiagnostic.ts')"], { cwd: process.cwd(), encoding: 'utf8' });
    expect(importOutput).toBe('');
  });

  it('registers the exact script without running it', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(packageJson.scripts['diagnose:horizon']).toBe('tsx training/horizonDiagnostic.ts');
  });
});
