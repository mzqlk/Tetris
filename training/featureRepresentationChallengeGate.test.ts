import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { MaterializedChallengePlacementPair } from './featureRepresentationChallengeCorpus';
import {
  compareRepresentationPairIds,
  type RepresentationDimensionEvaluationResult,
  type RepresentationGateSummary,
} from './featureRepresentationProtocol';
import {
  evaluateChallengeRepresentationGate,
  judgeChallengeRepresentationGate,
  serializeChallengeRepresentationResult,
  type ChallengeRepresentationGateDependencies,
  type ChallengeRepresentationResult,
} from './featureRepresentationChallengeGate';

type Category = 'strategy' | 'safety';

function summary(
  dimensionCount: 13 | 17,
  strategyCorrect: number,
  safetyCorrect = 8,
  losoRate = 1,
  safetyRegressions = 0,
): RepresentationGateSummary<Category> {
  return {
    dimensionCount,
    selectedExclusionCount: 0,
    excludedStateIds: [],
    witness: [],
    pairResults: [],
    strategyCorrect,
    safetyCorrect,
    marginMinimum: 0.1,
    leaveOneStateOutStrategyRate: losoRate,
    leaveOneStateOutSafetyRegressionCount: safetyRegressions,
  };
}

function dimension(
  dimensionCount: 13 | 17,
  strategyCorrect: number,
  options: Partial<{
    pairCount: number;
    safetyCorrect: number;
    losoRate: number;
    safetyRegressions: number;
    deterministic: boolean;
    failureReasons: readonly string[];
    digest: string;
    identicalDigest: string;
    pairIds: readonly string[];
  }> = {},
): RepresentationDimensionEvaluationResult<Category> {
  const pairCount = options.pairCount ?? 32;
  const digest = options.digest ?? createHash('sha256')
    .update(`${dimensionCount}-${strategyCorrect}-${pairCount}`)
    .digest('hex');
  return {
    dimensionCount,
    pairIds: options.pairIds ?? Array.from({ length: pairCount }, (_, index) => `pair-${index}`)
      .sort(compareRepresentationPairIds),
    pairCount,
    summary: summary(
      dimensionCount,
      strategyCorrect,
      options.safetyCorrect,
      options.losoRate,
      options.safetyRegressions,
    ),
    repeatedRunDigest: digest,
    identicalRunDigest: options.identicalDigest ?? (options.deterministic === false ? `${digest}-different` : digest),
    repeatedRunDeterministic: options.deterministic ?? true,
    failureReasons: options.failureReasons ?? [],
  };
}

function syntheticPairs(count = 32, strategyCount = 24): readonly MaterializedChallengePlacementPair[] {
  const state: MaterializedChallengePlacementPair['state'] = {
    board: [],
    current: { type: 1, rotation: 0, position: { x: 0, y: 0 } },
    next: 2,
    hold: null,
    holdAvailable: true,
    unseenBagMask: 0,
  };
  const featureInput: MaterializedChallengePlacementPair['positive'] = {
    boardBefore: state.board,
    boardAfter: state.board,
    linesCleared: 0,
    placedCells: [],
    pending: {
      board: state.board,
      current: state.current,
      hold: state.hold,
      holdAvailable: state.holdAvailable,
      unseenBagMask: state.unseenBagMask,
    },
  };
  return Array.from({ length: count }, (_, index): MaterializedChallengePlacementPair => ({
    descriptor: {
      id: `pair-${index}`,
      stateId: `state-${index}`,
      group: index < strategyCount ? 'lane-preservation' : 'safety',
      category: index < strategyCount ? 'strategy' : 'safety',
      positiveCellKey: `positive-${index}`,
      negativeCellKey: `negative-${index}`,
      positiveClass: index < strategyCount ? 'preserve-well' : 'safety-only',
      negativeClass: index < strategyCount ? 'destroy-well' : 'risky-survival',
    },
    state,
    positive: featureInput,
    negative: featureInput,
  }));
}

function dependencies(
  old13: RepresentationDimensionEvaluationResult<Category>,
  new17: RepresentationDimensionEvaluationResult<Category> = dimension(17, 24),
  pairs: readonly MaterializedChallengePlacementPair[] = syntheticPairs(),
): ChallengeRepresentationGateDependencies {
  return {
    materializeAllChallengePlacementPairs: () => pairs,
    evaluateRepresentationDimension: (_input, dimensionCount) => dimensionCount === 13 ? old13 : new17,
  };
}

describe('feature-representation-challenge-gate', () => {
  it('marks an old13 score above the challenge floor inconclusive', () => {
    expect(judgeChallengeRepresentationGate({ old13StrategyCorrect: 21, strategyCorrect17: null })).toEqual({
      status: 'challenge-inconclusive',
      failureReasons: ['challenge-validity-old13-above-20'],
    });
  });

  it.each([21.5, -1, 25])('rejects invalid old13 correctness %s before challenge-validity judgment', (old13StrategyCorrect) => {
    expect(judgeChallengeRepresentationGate({
      old13StrategyCorrect,
      strategyCorrect17: null,
    })).toEqual({
      status: 'fail',
      failureReasons: ['strategy-correct-13-invalid'],
    });
  });

  it('passes exactly at the challenge thresholds', () => {
    expect(judgeChallengeRepresentationGate({
      old13StrategyCorrect: 17,
      strategyCorrect17: 22,
      safetyCorrect17: 8,
      losoRate17: 0.9,
      safetyRegressions17: 0,
      deterministic: true,
    })).toEqual({ status: 'pass', failureReasons: [] });
  });

  it('reports both independent strategy threshold failures', () => {
    expect(judgeChallengeRepresentationGate({
      old13StrategyCorrect: 20,
      strategyCorrect17: 21,
      safetyCorrect17: 8,
      losoRate17: 1,
      safetyRegressions17: 0,
      deterministic: true,
    })).toEqual({
      status: 'fail',
      failureReasons: ['strategy-correct-17-below-22', 'strategy-gain-not-above-4'],
    });
  });

  it.each([
    [18, 22],
    [20, 22],
  ])('fails when actual strategy gain is not strictly above four (%i to %i)', (old13StrategyCorrect, strategyCorrect17) => {
    expect(judgeChallengeRepresentationGate({
      old13StrategyCorrect,
      strategyCorrect17,
      safetyCorrect17: 8,
      losoRate17: 1,
      safetyRegressions17: 0,
      deterministic: true,
    })).toEqual({ status: 'fail', failureReasons: ['strategy-gain-not-above-4'] });
  });

  it('does not evaluate new17 when the old13 challenge validity floor is missed', () => {
    const calls: number[] = [];
    const result = evaluateChallengeRepresentationGate({
      ...dependencies(dimension(13, 21)),
      evaluateRepresentationDimension: (_input, dimensionCount) => {
        calls.push(dimensionCount);
        if (dimensionCount === 17) throw new Error('new17 must not be called');
        return dimension(13, 21);
      },
    });

    expect(calls).toEqual([13]);
    expect(result.status).toBe('challenge-inconclusive');
    expect(result.new17).toBeNull();
    expect(result.strategyGain).toBeNull();
  });

  it.each([
    ['nondeterministic flag', { deterministic: false }],
    ['unequal digests', { digest: 'a'.repeat(64), identicalDigest: 'b'.repeat(64) }],
    ['invalid digest', { digest: 'not-a-sha256', identicalDigest: 'not-a-sha256' }],
  ])('fails old13 %s before inconclusive and does not evaluate new17', (_label, options) => {
    const calls: number[] = [];
    const old13 = dimension(13, 21, options);
    const result = evaluateChallengeRepresentationGate({
      ...dependencies(old13),
      evaluateRepresentationDimension: (_input, dimensionCount) => {
        calls.push(dimensionCount);
        return dimensionCount === 13 ? old13 : dimension(17, 24);
      },
    });

    expect(calls).toEqual([13]);
    expect(result.status).toBe('fail');
    expect(result.failureReasons).toEqual(['old13-determinism-invalid']);
    expect(result.new17).toBeNull();
  });

  it('fails invalid old13 phase results without evaluating new17', () => {
    const calls: number[] = [];
    const invalid = dimension(13, 20, { pairCount: 31 });
    const result = evaluateChallengeRepresentationGate({
      ...dependencies(invalid),
      evaluateRepresentationDimension: (_input, dimensionCount) => {
        calls.push(dimensionCount);
        return dimensionCount === 13 ? invalid : dimension(17, 24);
      },
    });

    expect(calls).toEqual([13]);
    expect(result).toMatchObject({ status: 'fail', failureReasons: ['representation-gate-evaluation-error'] });
  });

  it('fails non-integer or non-finite old13 summaries before evaluating new17', () => {
    const invalid = dimension(13, 20);
    const calls: number[] = [];
    const result = evaluateChallengeRepresentationGate({
      ...dependencies(invalid),
      evaluateRepresentationDimension: (_input, dimensionCount) => {
        calls.push(dimensionCount);
        if (dimensionCount === 13) return {
          ...invalid,
          summary: { ...invalid.summary, strategyCorrect: 20.5, leaveOneStateOutStrategyRate: Number.NaN },
        };
        return dimension(17, 24);
      },
    });

    expect(calls).toEqual([13]);
    expect(result.failureReasons).toEqual(['representation-gate-evaluation-error']);
  });

  it('fails an invalid new17 phase result after old13 validation', () => {
    const new17 = dimension(17, 24);
    const result = evaluateChallengeRepresentationGate({
      ...dependencies(dimension(13, 17), new17),
      evaluateRepresentationDimension: (_input, dimensionCount) => dimensionCount === 13
        ? dimension(13, 17)
        : { ...new17, pairIds: [...new17.pairIds].reverse() },
    });

    expect(result).toMatchObject({ status: 'fail', failureReasons: ['representation-gate-evaluation-error'] });
  });

  it('uses the same materialized synthetic pairs for both dimension evaluations', () => {
    const pairs = syntheticPairs();
    const seen: unknown[] = [];
    const result = evaluateChallengeRepresentationGate({
      ...dependencies(dimension(13, 17), dimension(17, 24), pairs),
      evaluateRepresentationDimension: (input, dimensionCount) => {
        seen.push(input.materializePairs());
        return dimension(dimensionCount, dimensionCount === 13 ? 17 : 24);
      },
    });

    expect(result.status).toBe('pass');
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(pairs);
    expect(seen[1]).toBe(pairs);
  });

  it('compares dimension pair ids in canonical order when materialization order is noncanonical', () => {
    const pairs = [...syntheticPairs()].reverse();
    const canonicalPairIds = pairs.map((pair) => pair.descriptor.id).sort(compareRepresentationPairIds);
    const result = evaluateChallengeRepresentationGate({
      ...dependencies(dimension(13, 17), dimension(17, 23), pairs),
      evaluateRepresentationDimension: (_input, dimensionCount) => dimension(
        dimensionCount,
        dimensionCount === 13 ? 17 : 23,
        { pairIds: canonicalPairIds },
      ),
    });

    expect(result.status).toBe('pass');
    expect(result.failureReasons).toEqual([]);
  });

  it('fails closed for malformed counts and group composition before dimension evaluation', () => {
    let evaluated = false;
    const result = evaluateChallengeRepresentationGate({
      ...dependencies(dimension(13, 20), dimension(17, 24), syntheticPairs(31, 23)),
      evaluateRepresentationDimension: () => {
        evaluated = true;
        return dimension(13, 20);
      },
    });

    expect(evaluated).toBe(false);
    expect(result.status).toBe('fail');
    expect(result.failureReasons).toEqual(['representation-gate-evaluation-error']);
  });

  it('fails closed without exposing illegal-placement or non-finite diagnostic details', () => {
    const illegalPlacement = evaluateChallengeRepresentationGate({
      ...dependencies(dimension(13, 20)),
      materializeAllChallengePlacementPairs: () => { throw new Error('C:/secret/board=hidden illegal placement'); },
    });
    const nonFinite = evaluateChallengeRepresentationGate({
      ...dependencies(dimension(13, 20)),
      evaluateRepresentationDimension: () => { throw new Error('NaN feature on hidden board'); },
    });

    for (const result of [illegalPlacement, nonFinite]) {
      expect(result.status).toBe('fail');
      expect(serializeChallengeRepresentationResult(result)).not.toMatch(/secret|board|NaN|illegal/i);
      expect(result.failureReasons).toEqual(['representation-gate-evaluation-error']);
    }
  });

  it('fails safety, LOSO, and nondeterministic-digest regressions with safe reason codes', () => {
    const result = evaluateChallengeRepresentationGate(dependencies(
      dimension(13, 18),
      dimension(17, 24, { safetyCorrect: 7, losoRate: 0.89, safetyRegressions: 1, deterministic: false }),
    ));

    expect(result.status).toBe('fail');
    expect(result.failureReasons).toEqual([
      'safety-correct-17-mismatch',
      'loso-strategy-rate-17-below-0.90',
      'loso-safety-regressions-17-nonzero',
      'repeated-run-not-deterministic',
    ]);
  });

  it('uses a deterministic digest that changes when an executed dimension digest changes', () => {
    const first = evaluateChallengeRepresentationGate(dependencies(dimension(13, 20, { digest: 'a'.repeat(64) }), dimension(17, 24, { digest: 'c'.repeat(64) })));
    const second = evaluateChallengeRepresentationGate(dependencies(dimension(13, 20, { digest: 'b'.repeat(64) }), dimension(17, 24, { digest: 'c'.repeat(64) })));
    const repeated = evaluateChallengeRepresentationGate(dependencies(dimension(13, 20, { digest: 'a'.repeat(64) }), dimension(17, 24, { digest: 'c'.repeat(64) })));

    expect(first.repeatedRunDigest).not.toBe(second.repeatedRunDigest);
    expect(first.repeatedRunDigest).toBe(repeated.repeatedRunDigest);
    expect(first.repeatedRunDigest).toBe(first.identicalRunDigest);
  });

  it('serializes the exact frozen public challenge result without dimension wrappers', () => {
    const digest = 'a'.repeat(64);
    const expected: ChallengeRepresentationResult = {
      mode: 'feature-representation-challenge',
      status: 'challenge-inconclusive',
      corpus: 'b1-1-challenge-corpus-v1',
      pairCount: 32,
      strategyCount: 24,
      safetyCount: 8,
      challengeValidity: {
        old13StrategyCorrect: 21,
        old13StrategyMaximum: 20,
        status: 'inconclusive',
      },
      old13: summary(13, 21),
      new17: null,
      strategyGain: null,
      repeatedRunDeterministic: true,
      repeatedRunDigest: digest,
      identicalRunDigest: digest,
      failureReasons: ['challenge-validity-old13-above-20'],
    };

    expect(serializeChallengeRepresentationResult(expected)).toBe(JSON.stringify(expected));
  });

  it('emits one JSON line to injected stdout and creates no files', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'feature-representation-challenge-cli-'));
    const originalCwd = process.cwd();
    try {
      const before = readdirSync(cwd);
      const program = `
        import { emitChallengeRepresentationGateCli } from './training/featureRepresentationChallengeGate.ts';
        const targetCwd = ${JSON.stringify(cwd)};
        const originalCwd = process.cwd();
        const pairs = Array.from({ length: 32 }, (_, index) => ({ descriptor: {
          id: 'pair-' + index, stateId: 'state-' + index,
          group: index < 24 ? 'lane-preservation' : 'safety',
          category: index < 24 ? 'strategy' : 'safety',
          positiveCellKey: 'positive-' + index, negativeCellKey: 'negative-' + index,
          positiveClass: index < 24 ? 'preserve-well' : 'safety-only',
          negativeClass: index < 24 ? 'destroy-well' : 'risky-survival',
        }}));
        const old13 = { dimensionCount: 13, pairIds: pairs.map((pair) => pair.descriptor.id), pairCount: 32,
          summary: { dimensionCount: 13, selectedExclusionCount: 0, excludedStateIds: [], witness: [], pairResults: [], strategyCorrect: 21, safetyCorrect: 8, marginMinimum: 0.1, leaveOneStateOutStrategyRate: 1, leaveOneStateOutSafetyRegressionCount: 0 },
          repeatedRunDigest: 'a'.repeat(64), identicalRunDigest: 'a'.repeat(64), repeatedRunDeterministic: true, failureReasons: [] };
        try {
          process.chdir(targetCwd);
          const writes = [];
          const result = emitChallengeRepresentationGateCli({
            validateChallengeCorpus: () => undefined,
            materializeAllChallengePlacementPairs: () => pairs,
            evaluateRepresentationDimension: (_input, dimensionCount) => {
              if (dimensionCount === 17) throw new Error('new17 must not be called');
              return old13;
            },
          }, (chunk) => writes.push(chunk));
          process.stdout.write(JSON.stringify({ exitCode: result.exitCode, writes }));
        } finally {
          process.chdir(originalCwd);
        }
      `;
      const output = execFileSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '--eval', program],
        { cwd: originalCwd, encoding: 'utf8' },
      );

      const result = JSON.parse(output) as { exitCode: number; writes: string[] };
      expect(result.exitCode).toBe(1);
      expect(result.writes).toHaveLength(1);
      expect(result.writes[0]!.endsWith('\n')).toBe(true);
      expect(() => JSON.parse(result.writes[0]!)).not.toThrow();
      expect(readdirSync(cwd)).toEqual(before);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('preserves the baseline package bytes except for the challenge diagnostic script', () => {
    const baseline = readFileSync('.superpowers/sdd/2026-08-23-score-rate-v5-b1-1-challenge-corpus/task-3-baseline/package.json', 'utf8');
    const expected = baseline.replace(
      '    "diagnose:feature-representation": "tsx training/featureRepresentationGate.ts",\n',
      '    "diagnose:feature-representation": "tsx training/featureRepresentationGate.ts",\n    "diagnose:feature-representation-challenge": "tsx training/featureRepresentationChallengeGate.ts",\n',
    );

    expect(readFileSync('package.json', 'utf8')).toBe(expected);
  });
});
