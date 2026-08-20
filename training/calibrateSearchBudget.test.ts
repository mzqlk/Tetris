import { describe, expect, it } from 'vitest';
import {
  BUDGET_CANDIDATE_STEP,
  MAX_SELECTION_CANDIDATES,
  runCalibrationCli,
  SELECTION_P95_LIMIT_MS,
  serializeCalibrationOutput,
  selectBudgetFromLadder,
  VERIFICATION_BLOCKS,
  VERIFICATION_P95_LIMIT_MS,
  verifyFrozenBudget,
  type CalibrationEnvironment,
  type CalibrationRound,
  type CandidateMeasurement,
} from './calibrateSearchBudget';

const environment: CalibrationEnvironment = {
  nodeVersion: 'test-node',
  platform: 'test-platform',
  release: 'test-release',
  arch: 'test-arch',
  cpuModel: 'test-cpu',
  selectionP95LimitMs: SELECTION_P95_LIMIT_MS,
  verificationP95LimitMs: VERIFICATION_P95_LIMIT_MS,
  candidateStep: BUDGET_CANDIDATE_STEP,
  maxSelectionCandidates: MAX_SELECTION_CANDIDATES,
  verificationBlocks: VERIFICATION_BLOCKS,
  roundsPerMeasurement: 5,
  corpusSize: 96,
};

function rounds(p95Ms: number): readonly [
  CalibrationRound,
  CalibrationRound,
  CalibrationRound,
  CalibrationRound,
  CalibrationRound,
] {
  const makeRound = (): CalibrationRound => ({
    p50Ms: Math.max(0, p95Ms - 2),
    p95Ms,
    maxMs: p95Ms + 1,
  });
  return [makeRound(), makeRound(), makeRound(), makeRound(), makeRound()];
}

function fakeMeasurement(options: Partial<CandidateMeasurement> & { budget: number }): CandidateMeasurement {
  const workUnitsUsed = options.workUnitsUsed ?? Array(480).fill(3);
  const worstP95Ms = options.worstP95Ms ?? 100;
  return {
    budget: options.budget,
    rounds: options.rounds ?? rounds(worstP95Ms),
    worstP95Ms,
    depthHistogram: options.depthHistogram ?? [0, 480, 0, 0, 0],
    workUnitsUsed,
    placementEvaluationUnits: options.placementEvaluationUnits
      ?? workUnitsUsed.reduce((sum, value) => sum + value, 0),
    chanceExpansionUnits: options.chanceExpansionUnits ?? 0,
    cacheHitUnits: options.cacheHitUnits ?? 0,
    allDepthOneComplete: options.allDepthOneComplete ?? true,
    allDepthFourComplete: options.allDepthFourComplete ?? false,
    overBudgetCount: options.overBudgetCount ?? 0,
    deterministic: options.deterministic ?? true,
    reasons: options.reasons ?? ['measurement-complete'],
  };
}

describe('search budget selection ladder', () => {
  it('selects the largest scanned 256-unit candidate below the 140 ms line', () => {
    const result = selectBudgetFromLadder((budget) => fakeMeasurement({
      budget,
      worstP95Ms: budget <= 3584 ? 139 : 161,
    }));

    expect(result.status).toBe('pass');
    expect(result.proposedBudget).toBe(3584);
    expect(result.stopReason).toBe('two-consecutive-above-verification-limit');
    expect(result.candidates.map((candidate) => candidate.budget)).toEqual([
      1536, 1792, 2048, 2304, 2560, 2816, 3072, 3328, 3584, 3840, 4096,
    ]);
  });

  it('rounds both the static floor and caller minimum up to the next staircase value', () => {
    expect(selectBudgetFromLadder((budget) => fakeMeasurement({
      budget,
      allDepthFourComplete: true,
      depthHistogram: [0, 0, 0, 0, 480],
    })).candidates[0].budget).toBe(1536);

    expect(selectBudgetFromLadder((budget) => fakeMeasurement({
      budget,
      allDepthFourComplete: true,
      depthHistogram: [0, 0, 0, 0, 480],
    }), 1800).candidates[0].budget).toBe(2048);
  });

  it('stops as soon as all corpus states complete depth four', () => {
    const result = selectBudgetFromLadder((budget) => fakeMeasurement({
      budget,
      allDepthFourComplete: budget === 2048,
      depthHistogram: budget === 2048 ? [0, 0, 0, 0, 480] : [0, 480, 0, 0, 0],
    }));

    expect(result.status).toBe('pass');
    expect(result.proposedBudget).toBe(2048);
    expect(result.stopReason).toBe('all-depth-four-complete');
    expect(result.candidates.map((candidate) => candidate.budget)).toEqual([1536, 1792, 2048]);
  });

  it('fails closed at 32 candidates without a normal stop condition', () => {
    const result = selectBudgetFromLadder((budget) => fakeMeasurement({
      budget,
      worstP95Ms: 150,
    }));

    expect(result.status).toBe('fail');
    expect(result.proposedBudget).toBeNull();
    expect(result.stopReason).toBeNull();
    expect(result.candidates).toHaveLength(32);
    expect(result.failureReasons).toContain('maximum-selection-candidates-reached-without-normal-stop');
  });

  it('fails when no scanned candidate passes the selection line', () => {
    const result = selectBudgetFromLadder((budget) => fakeMeasurement({
      budget,
      worstP95Ms: 141,
      allDepthFourComplete: true,
      depthHistogram: [0, 0, 0, 0, 480],
    }));

    expect(result.status).toBe('fail');
    expect(result.proposedBudget).toBeNull();
    expect(result.failureReasons).toContain('no-candidate-at-or-below-selection-limit');
  });

  it.each([
    ['incomplete depth one', { allDepthOneComplete: false, depthHistogram: [1, 479, 0, 0, 0] }],
    ['over-budget work', { overBudgetCount: 1 }],
    ['nondeterminism', { deterministic: false }],
    ['non-five-round measurement', { rounds: rounds(100).slice(0, 4) }],
    ['wrong work-unit distribution', { workUnitsUsed: Array(479).fill(3) }],
    ['category-unit sum mismatch', { placementEvaluationUnits: 1 }],
  ])('fails on %s and retains the rejected trace', (_label, overrides) => {
    const result = selectBudgetFromLadder((budget) => fakeMeasurement({
      budget,
      ...(overrides as Partial<CandidateMeasurement>),
    }));

    expect(result.status).toBe('fail');
    expect(result.proposedBudget).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].reasons.some((reason) => reason.startsWith('invalid:'))).toBe(true);
  });

  it('does not require proposedBudget plus one to fail or discard earlier traces', () => {
    const seen: number[] = [];
    const result = selectBudgetFromLadder((budget) => {
      seen.push(budget);
      return fakeMeasurement({
        budget,
        allDepthFourComplete: budget === 1792,
        depthHistogram: budget === 1792 ? [0, 0, 0, 0, 480] : [0, 480, 0, 0, 0],
        reasons: [`trace-${budget}`],
      });
    });

    expect(result.proposedBudget).toBe(1792);
    expect(seen).toEqual([1536, 1792]);
    expect(result.candidates.map((candidate) => candidate.reasons)).toEqual([
      ['trace-1536', 'structural-invariants-pass', 'selection-p95-at-or-below-limit'],
      ['trace-1792', 'structural-invariants-pass', 'selection-p95-at-or-below-limit'],
    ]);
  });
});

describe('frozen budget verification', () => {
  it('requires three isolated frozen-budget blocks below 160 ms', () => {
    let block = 0;
    const result = verifyFrozenBudget(3584, (budget) => fakeMeasurement({
      budget,
      worstP95Ms: [151, 159, 160][block++],
    }));

    expect(result.status).toBe('pass');
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks.map((measurement) => measurement.worstP95Ms)).toEqual([151, 159, 160]);
  });

  it('fails when any block exceeds the verification line', () => {
    let block = 0;
    const result = verifyFrozenBudget(3584, (budget) => fakeMeasurement({
      budget,
      worstP95Ms: [151, 161, 152][block++],
    }));

    expect(result.status).toBe('fail');
    expect(result.blocks).toHaveLength(3);
    expect(result.failureReasons).toContain('block-2-above-verification-limit');
  });

  it.each([
    ['incomplete depth one', { allDepthOneComplete: false, depthHistogram: [1, 479, 0, 0, 0] }],
    ['over-budget work', { overBudgetCount: 1 }],
    ['nondeterminism', { deterministic: false }],
    ['non-five-round measurement', { rounds: rounds(100).slice(0, 4) }],
    ['wrong work-unit distribution', { workUnitsUsed: Array(479).fill(3) }],
    ['category-unit sum mismatch', { chanceExpansionUnits: 1 }],
  ])('fails each block on %s', (_label, overrides) => {
    const result = verifyFrozenBudget(3584, (budget) => fakeMeasurement({
      budget,
      ...(overrides as Partial<CandidateMeasurement>),
    }));

    expect(result.status).toBe('fail');
    expect(result.blocks).toHaveLength(3);
    expect(result.failureReasons.some((reason) => reason.includes('structural-invariants'))).toBe(true);
  });
});

describe('calibration JSON contract', () => {
  it('serializes complete successful and failed selection traces', () => {
    const success = {
      ...selectBudgetFromLadder((budget) => fakeMeasurement({
        budget,
        allDepthFourComplete: true,
        depthHistogram: [0, 0, 0, 0, 480],
      })),
      environment,
    };
    const failure = {
      ...selectBudgetFromLadder((budget) => fakeMeasurement({
        budget,
        deterministic: false,
      })),
      environment,
    };

    for (const output of [success, failure]) {
      const parsed = JSON.parse(serializeCalibrationOutput(output));
      expect(parsed.mode).toBe('select');
      expect(parsed.corpus).toBe('budget-corpus-v1');
      expect(parsed.candidates[0].rounds).toHaveLength(5);
      expect(parsed.candidates[0].workUnitsUsed).toHaveLength(480);
      expect(parsed.candidates[0]).toMatchObject({
        placementEvaluationUnits: 1440,
        chanceExpansionUnits: 0,
        cacheHitUnits: 0,
        depthHistogram: expect.any(Array),
        reasons: expect.any(Array),
      });
      expect(parsed.environment).toEqual(environment);
    }
  });

  it('serializes complete successful and failed verification blocks', () => {
    for (const p95Ms of [160, 161]) {
      const output = {
        ...verifyFrozenBudget(3584, (budget) => fakeMeasurement({ budget, worstP95Ms: p95Ms })),
        environment,
      };
      const parsed = JSON.parse(serializeCalibrationOutput(output));
      expect(parsed.mode).toBe('verify-frozen');
      expect(parsed.blocks).toHaveLength(3);
      expect(parsed.blocks.every((block: CandidateMeasurement) => block.rounds.length === 5)).toBe(true);
      expect(parsed.blocks.every((block: CandidateMeasurement) => block.workUnitsUsed.length === 480)).toBe(true);
      expect(parsed.environment.verificationP95LimitMs).toBe(160);
    }
  });

  it.each([
    [[]],
    [['--select', '--verify-frozen']],
    [['--unknown']],
  ])('fails invalid mode flags with one structured JSON result: %j', (args) => {
    const result = runCalibrationCli(
      args,
      (budget) => fakeMeasurement({ budget }),
      environment,
      3584,
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(serializeCalibrationOutput(result.output))).toMatchObject({
      mode: 'invalid',
      status: 'fail',
      corpus: 'budget-corpus-v1',
      failureReasons: ['exactly-one-calibration-mode-required'],
      environment,
    });
  });

  it('runs only the explicit selected mode and maps status to the exit code', () => {
    const selection = runCalibrationCli(
      ['--select'],
      (budget) => fakeMeasurement({
        budget,
        allDepthFourComplete: true,
        depthHistogram: [0, 0, 0, 0, 480],
      }),
      environment,
      3584,
    );
    const verification = runCalibrationCli(
      ['--verify-frozen'],
      (budget) => fakeMeasurement({ budget, worstP95Ms: 161 }),
      environment,
      3584,
    );

    expect(selection.exitCode).toBe(0);
    expect(selection.output).toMatchObject({ mode: 'select', status: 'pass' });
    expect(verification.exitCode).toBe(1);
    expect(verification.output).toMatchObject({ mode: 'verify-frozen', status: 'fail' });
  });
});
