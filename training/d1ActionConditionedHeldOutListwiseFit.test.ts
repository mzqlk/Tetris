import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { D1FitSubset } from './d1ActionConditionedHeldOutListwiseLabels';
import {
  D1_LAMBDAS,
  assertD1FinalModelBundle as assertD1FinalModelBundleAuthenticated,
  assertD1StructuralFinalModelBundle,
  consumeD1FinalBundleForTest,
  evaluateD1HeldOutStructural as evaluateD1HeldOut,
  freezeD1FinalModels as freezeD1FinalModelsAuthenticated,
  freezeD1FinalModelsStructural as freezeD1FinalModels,
  fitD1Representation,
  normalizeD1Rows,
  selectD1LambdaStructural as selectD1Lambda,
  serializeD1FitDigest,
  type D1EvaluationSubset,
  type D1FitResult,
  type D1FinalModelBundle,
  type D1HeldOutSubset,
} from './d1ActionConditionedHeldOutListwiseFit';
import {
  runD1NewtonController,
  solveD1NewtonDirection,
} from './d1ActionConditionedHeldOutListwiseFitInternals';

type FreezeParameters = Parameters<typeof freezeD1FinalModelsAuthenticated>;
type ExactParameterCount = FreezeParameters['length'] extends 1
  ? 1 extends FreezeParameters['length'] ? true : false
  : false;
type ProductionInputKeys = keyof FreezeParameters[0];
type ExpectedInputKeys = 'selections' | 'train' | 'validation';
type ExactInputKeys = [ProductionInputKeys] extends [ExpectedInputKeys]
  ? [ExpectedInputKeys] extends [ProductionInputKeys] ? true : false
  : false;
const exactParameterCount: ExactParameterCount = true;
const exactInputKeys: ExactInputKeys = true;
void assertD1FinalModelBundleAuthenticated;
void exactParameterCount;
void exactInputKeys;

function normalizationSubset(subsetId: string, start: number, placementCount: number): D1FitSubset {
  return {
    subsetId,
    placementIds: Array.from({ length: placementCount }, (_, index) => `p${index.toString().padStart(2, '0')}`),
    features: Array.from({ length: placementCount }, (_, index) => {
      const value = start + index;
      return [value, value < 7 ? 0 : 2, 5];
    }),
    q: Array.from({ length: placementCount }, (_, index) => index === 0 ? 1 : 0),
  };
}

describe('D1 fit normalization', () => {
  it('uses all N=14 mixed-K rows in canonical train then validation order', () => {
    const train = normalizationSubset('train-00', 0, 2);
    const validation = normalizationSubset('validation-00', 2, 12);

    const trainOnly = normalizeD1Rows([train]);
    const trainAndValidation = normalizeD1Rows([train, validation]);

    expect(trainOnly.rows).toHaveLength(2);
    expect(trainOnly.stats.mean).toEqual([0.5, 0, 5]);
    expect(trainOnly.stats.std).toEqual([0.5, 0, 0]);
    expect(trainOnly.rows).toEqual([[-1, 0, 0], [1, 0, 0]]);

    // Independent oracle over canonical rows 0..13:
    // mean = [91/14, 14/14, 70/14], population variance = [65/4, 1, 0].
    expect(trainAndValidation.rows).toHaveLength(14);
    expect(trainAndValidation.stats.mean).toEqual([6.5, 1, 5]);
    expect(trainAndValidation.stats.std).toEqual([4.031128874149275, 1, 0]);
    expect(trainAndValidation.rows[0]).toEqual([-1.61245154965971, -1, 0]);
    expect(trainAndValidation.rows[1]).toEqual([-1.3643820804812932, -1, 0]);
    expect(trainAndValidation.rows[2]).toEqual([-1.116312611302876, -1, 0]);
    expect(trainAndValidation.rows[13]).toEqual([1.61245154965971, 1, 0]);
    expect(Object.is(trainAndValidation.stats.std[2], 0)).toBe(true);
    expect(Object.is(trainAndValidation.rows[0]![2], 0)).toBe(true);
    expect(trainAndValidation.digest).toBe('7b185bd89ce863f943d3c25a5455515c8e3d44c11e3040a879cd186b3dd9f468');
  });

  it('keeps ordinary ordered addition in both binary64 passes', () => {
    const features = [
      [1e16], [1], [-1e16], [0], [0], [0], [0], [0], [0], [0], [0], [0],
    ];
    const normalized = normalizeD1Rows([{
      subsetId: 'ordered-addition',
      placementIds: ['p00', 'p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09', 'p10', 'p11'],
      features,
      q: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    }]);

    expect(normalized.stats.mean).toEqual([0]);
    expect(normalized.stats.std).toEqual([4082482904638630]);
    expect(normalized.rows.slice(0, 3)).toEqual([
      [2.4494897427831783],
      [2.449489742783178e-16],
      [-2.4494897427831783],
    ]);
  });

  it('rejects non-finite rows and a held-out test payload instead of normalizing it', () => {
    const train = normalizationSubset('train-00', 0, 2);
    expect(() => normalizeD1Rows([{ ...train, features: [[Number.NaN], ...train.features.slice(1)] }]))
      .toThrow(/^runtime-fail:/);
    expect(() => normalizeD1Rows([{ ...train, split: 'test' } as D1FitSubset]))
      .toThrow(/^runtime-fail:/);
  });

  it('requires q and feature row counts to equal the same K from 2 through 12', () => {
    const valid = normalizationSubset('train-00', 0, 2);
    expect(() => normalizeD1Rows([{ ...valid, q: [1] }])).toThrow(/^runtime-fail:/);
    expect(() => normalizeD1Rows([{ ...valid, features: valid.features.slice(0, 1) }])).toThrow(/^runtime-fail:/);
    expect(() => normalizeD1Rows([normalizationSubset('too-small', 0, 1)])).toThrow(/^runtime-fail:/);
    expect(() => normalizeD1Rows([normalizationSubset('too-large', 0, 13)])).toThrow(/^runtime-fail:/);
  });

  it('serializes the canonical fit record and rejects non-finite model values', () => {
    const input = {
      representationId: 'afterstate13' as const,
      lambda: 0.1 as const,
      normalization: { mean: [0, -0], std: [1, 2] },
      weights: [-0, 3],
      gradientNorm: 1e-10,
      iterationCount: 5,
    };
    expect(serializeD1FitDigest(input)).toBe('c71a6a1a7919ef251852d1ad53bac47092e98e43b0ed76c4675d6bad056bf3cd');
    expect(() => serializeD1FitDigest({ ...input, weights: [Number.NaN, 3] }))
      .toThrow(/^runtime-fail:/);
  });
});

function zeroSubset(): D1FitSubset {
  return {
    subsetId: 'uniform-zero',
    placementIds: Array.from({ length: 12 }, (_, index) => `p${index.toString().padStart(2, '0')}`),
    features: Array.from({ length: 12 }, () => Array(13).fill(0)),
    q: Array(12).fill(1 / 12),
  };
}

function afterstate13Row(values: readonly number[]): number[] {
  return [...values, ...Array(13 - values.length).fill(0)];
}

function opposingMixedCardinalitySubsets(): D1FitSubset[] {
  return [
    {
      subsetId: 'loss-k02',
      placementIds: ['p00', 'p01'],
      features: [afterstate13Row([0]), afterstate13Row([1])],
      q: [1, 0],
    },
    {
      subsetId: 'loss-k12',
      placementIds: Array.from({ length: 12 }, (_, index) => `p${index.toString().padStart(2, '0')}`),
      features: Array.from({ length: 12 }, (_, index) => afterstate13Row([index < 6 ? 0 : 1])),
      q: Array.from({ length: 12 }, (_, index) => index === 6 ? 1 : 0),
    },
  ];
}

function handDerivedTwoDimensionalSubset(): D1FitSubset {
  return {
    subsetId: 'two-dimensional-hand-fixture',
    placementIds: Array.from({ length: 12 }, (_, index) => `p${index.toString().padStart(2, '0')}`),
    features: [
      afterstate13Row([1, 0]),
      afterstate13Row([0, 1]),
      afterstate13Row([-1, -1]),
      ...Array.from({ length: 9 }, () => afterstate13Row([0, 0])),
    ],
    q: [0.2, 0.3, 0.1, ...Array(9).fill(0.4 / 9)],
  };
}

function fullHessianTwoDimensionalSubset(): D1FitSubset {
  return {
    subsetId: 'full-hessian-hand-fixture',
    placementIds: Array.from({ length: 12 }, (_, index) => `p${index.toString().padStart(2, '0')}`),
    features: [
      [-0.0060163387330248955, 1.6675599385052918e-9],
      [890.2670643292367, 1.7909059906378389e-10],
      [4026.8538100644946, -0.03563710632734001],
      [56.71790181659162, -65378.05660627782],
      [3013.242888264358, 8645832096.226513],
      [47778326.040133834, 36562.137538567185],
      [-0.000009217573748901488, -3046.1914418265224],
      [4.2054551979526877e-13, 0.000006428483338095248],
      [3190.519097261131, 0.09088223208673299],
      [-5165154580.026865, 811113352421.6711],
      [-0.018394716549664736, 0.02573223081417382],
      [0.22982985666021705, 1644685.7247501612],
    ].map(afterstate13Row),
    q: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
  };
}

describe('D1 deterministic damped Newton fit', () => {
  it('exports the exact frozen regularization grid', () => {
    expect(D1_LAMBDAS).toEqual([0.0001, 0.001, 0.01, 0.1, 1]);
    expect(Object.isFrozen(D1_LAMBDAS)).toBe(true);
  });

  it('rejects representation-dimension drift at the exported fit boundary', () => {
    expect(() => fitD1Representation({
      representationId: 'afterstate13',
      lambda: 1,
      subsets: [{
        subsetId: 'wrong-afterstate-dimensions',
        placementIds: ['p00', 'p01'],
        features: [[0], [1]],
        q: [1, 0],
      }],
    })).toThrow(/^runtime-fail:/);
  });

  it('returns the exact zero optimum and frozen zero-weight digest for the 13-dimensional representation', () => {
    const fit = fitD1Representation({
      representationId: 'afterstate13',
      lambda: 1,
      subsets: [zeroSubset()],
    });

    expect(fit.weights).toEqual(Array(13).fill(0));
    expect(fit.gradientNorm).toBe(0);
    expect(fit.iterationCount).toBe(0);
    expect(fit.weightDigest).toBe('39f37f8d1931b3bdf767e7510dd69509fbf23af1f7654933d0a4d291cbdd4418');
    expect(fit.normalizationDigest).toBe('46f531b7ea0428fbf2c3ca2b60e8dc33d6bbfa000e0fd1b489c5e39140a47006');
  });

  it('averages the K=2 and K=12 subset losses equally instead of weighting their rows', () => {
    // With seven 0 rows and seven 1 rows, normalization maps them to -1/+1.
    // At w=0 the two subset gradients are independently +1 and -1: their
    // arithmetic mean is exactly zero, while row weighting gives -10/14.
    const fit = fitD1Representation({
      representationId: 'afterstate13',
      lambda: 1,
      subsets: opposingMixedCardinalitySubsets(),
    });

    expect(fit.weights).toEqual(Array(13).fill(0));
    expect(fit.gradientNorm).toBeLessThan(1e-12);
    expect(fit.iterationCount).toBe(0);
  });

  it('matches independently hand-derived ordered D=2 full-Hessian Newton literals bit-for-bit', () => {
    const input = { representationId: 'afterstate13' as const, lambda: 0.1 as typeof D1_LAMBDAS[number], subsets: [handDerivedTwoDimensionalSubset()] };
    const first = fitD1Representation(input);
    const second = fitD1Representation(input);

    expect(first.weights.slice(0, 2)).toEqual([0.165673473658595, 0.40754323573974033]);
    expect(first.weights.slice(2)).toEqual(Array(11).fill(0));
    expect(first.normalization.mean).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(first.normalization.std).toEqual([
      0.408248290463863, 0.408248290463863, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(first.gradientNorm).toBe(1.5612511283791264e-16);
    expect(first.iterationCount).toBe(5);
    expect(first.normalizationDigest).toBe('c549ea15d21ad5187eb6b42148b44680801dab817bd5b455a1e28e9bf1fc4112');
    expect(first.weightDigest).toBe('5b8c25f37c719437d473bd84f7074201be915e251225d3a6a2c882337e61061c');
    expect(second.weights).toEqual(first.weights);
    expect(second.gradientNorm).toBe(first.gradientNorm);
    expect(second.iterationCount).toBe(first.iterationCount);
    expect(second.normalizationDigest).toBe(first.normalizationDigest);
    expect(second.weightDigest).toBe(first.weightDigest);
  });

  it('requires canonical placement-ID order before resolving exact logit ties', () => {
    const subset = zeroSubset();
    const placementIds = [...subset.placementIds];
    [placementIds[0], placementIds[1]] = [placementIds[1]!, placementIds[0]!];

    expect(() => fitD1Representation({
      representationId: 'afterstate13', lambda: 1, subsets: [{ ...subset, placementIds }],
    })).toThrow(/^runtime-fail:/);
  });

  it('computes both full Hessian off-diagonals instead of mirroring one recurrence', () => {
    const fit = fitD1Representation({
      representationId: 'afterstate13',
      lambda: 0.0001,
      subsets: [fullHessianTwoDimensionalSubset()],
    });

    expect(fit.normalization.mean).toEqual([
      -426447089.68171334, 68313399778.46607, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(fit.normalization.std).toEqual([
      1428834582.228699, 223975254180.11368, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(fit.weights.slice(0, 2)).toEqual([95.4678690476324, -8.244368593795]);
    expect(fit.weights.slice(2)).toEqual(Array(11).fill(0));
    expect(fit.gradientNorm).toBe(4.2372789305078484e-15);
    expect(fit.iterationCount).toBe(9);
    expect(fit.normalizationDigest).toBe('9b1e0d2ee4cd8d5eb8b751c46f5624a11cfc6d9c3e778d928efdf571d0da38fa');
    expect(fit.weightDigest).toBe('83992e504baf678cb9aeed64b00e1d4885c74abd453efb44148d5b35c9acdee8');
  });

});

describe('D1 private Newton production guards', () => {
  it('rejects malformed or non-finite Hessians before a converged return', () => {
    const invalidHessians = [
      [[Number.NaN]],
      [[]],
    ];
    for (const hessian of invalidHessians) {
      expect(() => runD1NewtonController({
        initialWeights: [0],
        evaluateSystem: () => ({ objective: 0, gradient: [0], hessian }),
        evaluateObjective: () => 0,
        solveDirection: solveD1NewtonDirection,
      })).toThrow(/^runtime-fail:/);
    }
  });

  it('rejects a singular pivot in the real Gaussian direction solver', () => {
    expect(() => solveD1NewtonDirection(
      [[1, 2], [2, 4]],
      [1, 1],
    )).toThrow(/^runtime-fail:/);
    expect(() => solveD1NewtonDirection([[1e-15]], [1])).toThrow(/^runtime-fail:/);
  });

  it('rejects a finite non-descent direction before evaluating line search', () => {
    let candidateEvaluations = 0;
    expect(() => runD1NewtonController({
      initialWeights: [0],
      evaluateSystem: () => ({ objective: 0, gradient: [1], hessian: [[1]] }),
      evaluateObjective: () => {
        candidateEvaluations += 1;
        return 0;
      },
      solveDirection: () => [1],
    })).toThrow(/^runtime-fail:/);
    expect(candidateEvaluations).toBe(0);
  });

  it('accepts exactly 200 updates before failing closed on non-convergence', () => {
    let systemEvaluations = 0;
    let acceptedCandidateEvaluations = 0;
    expect(() => runD1NewtonController({
      initialWeights: [0],
      evaluateSystem: (weights) => {
        systemEvaluations += 1;
        return { objective: -weights[0]!, gradient: [-1], hessian: [[1]] };
      },
      evaluateObjective: (weights) => {
        acceptedCandidateEvaluations += 1;
        return -weights[0]!;
      },
      solveDirection: () => [1],
    })).toThrow(/^runtime-fail:/);
    expect(acceptedCandidateEvaluations).toBe(200);
    expect(systemEvaluations).toBe(201);
  });

  it('keeps the minimum row on an exact pivot tie', () => {
    expect(solveD1NewtonDirection(
      [[1, 1e-300], [1, 1]],
      [1e-300, 1e-200],
    )).toEqual([-1e-300, -1e-200]);
  });

  it('uses the non-normalized pivot row and descending back substitution', () => {
    expect(solveD1NewtonDirection(
      [[1e-300, 1e-300], [1e-8, 1e300]],
      [1e-300, 1e-300],
    )).toEqual([-1, 1e-308]);
  });

  it('halves an Armijo step once before accepting the independently derived candidate', () => {
    const candidates: number[] = [];
    const fit = runD1NewtonController({
      initialWeights: [0],
      evaluateSystem: (weights) => weights[0] === 0
        ? { objective: 0, gradient: [-1], hessian: [[1]] }
        : { objective: -1, gradient: [0], hessian: [[1]] },
      evaluateObjective: (weights) => {
        candidates.push(weights[0]!);
        return (weights[0]! - 1) * (weights[0]! - 1) - 1;
      },
      solveDirection: () => [2],
    });

    expect(candidates).toEqual([2, 1]);
    expect(fit).toEqual({ weights: [1], gradientNorm: 0, iterationCount: 1 });
  });

  it('fails closed after exactly 64 rejected Armijo candidates', () => {
    let candidateEvaluations = 0;
    expect(() => runD1NewtonController({
      initialWeights: [0],
      evaluateSystem: () => ({ objective: 0, gradient: [-1], hessian: [[1]] }),
      evaluateObjective: () => {
        candidateEvaluations += 1;
        return 1;
      },
      solveDirection: () => [1],
    })).toThrow(/^runtime-fail:/);
    expect(candidateEvaluations).toBe(64);
  });
});

function validationOutcome(placementId: string, front: boolean) {
  return {
    placementId,
    pieceCapContexts: front ? 4 : 3,
    minPieces: front ? 128 : 127,
    sumPieces: front ? 512 : 511,
    sumScore: front ? 100 : 99,
    scoreRate: front ? 100 / 512 : 99 / 512,
    totalTetrises: 1,
    totalLines: 4,
    tetrisNumerator: 4,
    tetrisDenominator: 4,
    tetrisShare: 1,
    clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 1 },
  };
}

function evaluationSubsets(dimensions: 13 | 24 = 24, count = 32): D1EvaluationSubset[] {
  return Array.from({ length: count }, (_, subsetIndex) => {
    const placementCount = 2 + subsetIndex % 11;
    const placementIds = Array.from({ length: placementCount }, (_, index) => `p${index.toString().padStart(2, '0')}`);
    return {
      subsetId: `validation-${subsetIndex.toString().padStart(2, '0')}`,
      groupOrdinal: Math.floor(subsetIndex / 4),
      placementIds,
      features: placementIds.map(() => Array(dimensions).fill(0)),
      outcomes: placementIds.map((placementId, placementIndex) => validationOutcome(placementId, placementIndex === 0)),
      survivalOracle: [4, 128, 512] as const,
      jointFrontPlacementIds: ['p00'],
    };
  });
}

function fitRecord(
  representationId: 'afterstate13' | 'action24',
  lambda: typeof D1_LAMBDAS[number],
  weights: readonly number[],
  weightDigest: string,
): D1FitResult {
  const normalizationDigest = representationId === 'afterstate13'
    ? 'e6d1c222e63ef1dfb3f693dce462fe88e63805ebcf02f5855e2d15087432ef0c'
    : '7423d231fc89348e41a427d09ee87b1c610b29bbd7553cb924e682ed8ace5778';
  return {
    representationId, lambda, normalizationDigest, weightDigest,
    gradientNorm: 0, iterationCount: 0,
    weights, normalization: { mean: Array(weights.length).fill(0), std: Array(weights.length).fill(1) },
  };
}

function freezeFitSubsets(prefix: string, count: number, dimensions: 13 | 24): D1FitSubset[] {
  return Array.from({ length: count }, (_, subsetIndex) => {
    const placementCount = 2 + subsetIndex % 11;
    return {
      subsetId: `${prefix}-${subsetIndex.toString().padStart(2, '0')}`,
      placementIds: Array.from({ length: placementCount }, (_, index) => `p${index.toString().padStart(2, '0')}`),
      features: Array.from({ length: placementCount }, (_, index) => [index, ...Array(dimensions - 1).fill(0)]),
      q: Array(placementCount).fill(1 / placementCount),
    };
  });
}

describe('D1 validation selection and final-model capabilities', () => {
  it('fits lambda candidates with train-only N=sum(K)=548 normalization', () => {
    const fit = fitD1Representation({
      representationId: 'afterstate13',
      lambda: 1,
      subsets: freezeFitSubsets('train-only', 80, 13),
    });

    // Independent 80-subset oracle: seven complete K=2..12 cycles plus K=2,3,4.
    // N=548, ordered sum(x)=2012, ordered sum((x-mean)^2)=4644.8759124087765.
    expect(fit.normalization.mean).toEqual([3.6715328467153285, ...Array(12).fill(0)]);
    expect(fit.normalization.std).toEqual([2.9113658195171066, ...Array(12).fill(0)]);
    expect(fit.iterationCount).toBe(0);
  });

  it('uses dynamic K and the ascending canonical weight digest only after the first four validation criteria', () => {
    const lowerDigest = '0f6010f81d7ed85b68fe50659704b17609aff5e3d384c831822dae313ec4643c';
    const higherDigest = 'a0cb0fb419972831c051b3514e7bf240a3fc2664ce92b63dd228f2631ca10b7d';
    const fits = [
      fitRecord('action24', 0.0001, Array(24).fill(0), '5d89f056865052bcb89c910d2d62872e029fb273c3db03f8968a52a41593c1b5'),
      fitRecord('action24', 0.001, Array(24).fill(0), '5d89f056865052bcb89c910d2d62872e029fb273c3db03f8968a52a41593c1b5'),
      fitRecord('action24', 0.01, Array(24).fill(0), '5d89f056865052bcb89c910d2d62872e029fb273c3db03f8968a52a41593c1b5'),
      fitRecord('action24', 0.1, Array(24).fill(0), '5d89f056865052bcb89c910d2d62872e029fb273c3db03f8968a52a41593c1b5'),
      fitRecord('action24', 1, [5, ...Array(23).fill(0)], higherDigest),
      fitRecord('action24', 1, [2807, ...Array(23).fill(0)], lowerDigest),
    ];

    const selected = selectD1Lambda({ representationId: 'action24', fits, validation: evaluationSubsets() });

    expect(selected.lambda).toBe(1);
    expect(selected.weightDigest).toBe(lowerDigest);
    expect(selected.validationSurvivalBelowSubsetOracle).toBe(0);
    expect(selected.validationSubsetJointFrontHits).toBe(32);
    expect(selected.validationSelectionDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(Object.isFrozen(selected.weights)).toBe(true);
    expect(Object.isFrozen(selected.normalization.mean)).toBe(true);
    expect(() => { (selected as { lambda: number }).lambda = 0.1; }).toThrow();
  });

  it('requires both exact registered selections and registers only the complete refit bundle', () => {
    const fitsFor = (representationId: 'afterstate13' | 'action24') => {
      const dimensions = representationId === 'afterstate13' ? 13 : 24;
      const weightDigest = representationId === 'afterstate13'
        ? '39f37f8d1931b3bdf767e7510dd69509fbf23af1f7654933d0a4d291cbdd4418'
        : '5d89f056865052bcb89c910d2d62872e029fb273c3db03f8968a52a41593c1b5';
      return D1_LAMBDAS.map((lambda) => fitRecord(representationId, lambda, Array(dimensions).fill(0), weightDigest));
    };
    const afterstate13Selection = selectD1Lambda({
      representationId: 'afterstate13', fits: fitsFor('afterstate13'), validation: evaluationSubsets(13),
    });
    const action24Selection = selectD1Lambda({
      representationId: 'action24', fits: fitsFor('action24'), validation: evaluationSubsets(),
    });
    const input = {
      selections: { afterstate13: afterstate13Selection, action24: action24Selection },
      train: { afterstate13: freezeFitSubsets('train', 80, 13), action24: freezeFitSubsets('train', 80, 24) },
      validation: { afterstate13: freezeFitSubsets('validation', 32, 13), action24: freezeFitSubsets('validation', 32, 24) },
    };

    expect(() => freezeD1FinalModels({
      ...input, selections: { afterstate13: afterstate13Selection },
    } as never)).toThrow('both selected representations are required');
    expect(() => freezeD1FinalModels({
      ...input, selections: { ...input.selections, action24: { ...action24Selection } },
    })).toThrow('unrecognized validation selection capability');
    expect(() => freezeD1FinalModels({
      ...input, selections: { ...input.selections, extra: action24Selection },
    } as never)).toThrow('exact representation identities are required');

    const fitRepresentation = vi.fn((fitInput: Parameters<typeof fitD1Representation>[0]) => fitD1Representation(fitInput));
    const freezes = freezeD1FinalModels({ ...input, fitRepresentation });
    expect(fitRepresentation).toHaveBeenCalledTimes(2);
    expect(Object.isFrozen(freezes)).toBe(true);
    expect(Object.isFrozen(freezes.models.action24.weights)).toBe(true);
    expect(Object.isFrozen(freezes.models.action24.normalization.mean)).toBe(true);
    expect(() => assertD1StructuralFinalModelBundle({ models: freezes.models }))
      .toThrow('unrecognized model freeze capability');
    expect(() => evaluateD1HeldOut({
      models: { models: freezes.models } as D1FinalModelBundle,
      subsets: zeroLineHeldOutMatrix({ actionTetrisCount: 0, actionScore: 101 }),
    })).toThrow('unrecognized model freeze capability');
    expect(() => assertD1StructuralFinalModelBundle(freezes)).not.toThrow();
    expect(() => assertD1FinalModelBundleAuthenticated(freezes))
      .toThrow('unrecognized authenticated model freeze capability');
    expect(() => consumeD1FinalBundleForTest(
      freezes,
      Object.freeze({ kind: 'd1-run-identity' }),
    )).toThrow('unrecognized authenticated model freeze capability');
    expect(freezes.models.afterstate13.lambda).toBe(afterstate13Selection.lambda);
    expect(freezes.models.action24.lambda).toBe(action24Selection.lambda);
    expect(freezes.models.afterstate13.iterationCount).toBe(0);
    expect(freezes.models.action24.iterationCount).toBe(0);
    // Independent train+validation oracle: K=2..4 occurs 11 times,
    // K=5..11 occurs 10 times, and K=12 occurs 9 times. N=767,
    // ordered sum(x)=2804 and ordered sum((x-mean)^2)=6423.131681877426.
    expect(freezes.models.afterstate13.normalization.mean).toEqual([
      3.655801825293351, ...Array(12).fill(0),
    ]);
    expect(freezes.models.afterstate13.normalization.std).toEqual([
      2.893848099196328, ...Array(12).fill(0),
    ]);
    expect(freezes.models.action24.normalization.mean).toEqual([
      3.655801825293351, ...Array(23).fill(0),
    ]);
    expect(freezes.models.action24.normalization.std).toEqual([
      2.893848099196328, ...Array(23).fill(0),
    ]);

    const taggedAfterstateTrain = [...input.train.afterstate13];
    taggedAfterstateTrain[0] = { ...taggedAfterstateTrain[0]!, split: 'test' } as D1FitSubset;
    expect(() => freezeD1FinalModels({
      ...input,
      train: { ...input.train, afterstate13: taggedAfterstateTrain },
    })).toThrow('split-tagged subset');
  });

  it('fails the whole validation gate when one regularization lambda has no successful fit', () => {
    const fits = D1_LAMBDAS.slice(0, 4).map((lambda) => fitRecord(
      'action24', lambda, Array(24).fill(0),
      '5d89f056865052bcb89c910d2d62872e029fb273c3db03f8968a52a41593c1b5',
    ));
    expect(() => selectD1Lambda({ representationId: 'action24', fits, validation: evaluationSubsets(24) }))
      .toThrow('all five lambdas are required');
  });

  it.each([
    ['a lowered survival oracle', (subset: D1EvaluationSubset) => ({ ...subset, survivalOracle: [3, 127, 511] as const })],
    ['an omitted nondominated placement', (subset: D1EvaluationSubset) => {
      const outcomes = [...subset.outcomes];
      outcomes[1] = {
        ...outcomes[1]!,
        pieceCapContexts: 4,
        minPieces: 128,
        sumPieces: 512,
        sumScore: 101,
        scoreRate: 101 / 512,
        totalTetrises: 0,
        totalLines: 4,
        tetrisNumerator: 0,
        tetrisDenominator: 4,
        tetrisShare: 0,
        clearCounts: { singles: 4, doubles: 0, triples: 0, tetrises: 0 },
      };
      return { ...subset, outcomes, jointFrontPlacementIds: ['p00'] };
    }],
    ['an added dominated placement', (subset: D1EvaluationSubset) => ({
      ...subset,
      jointFrontPlacementIds: ['p00', 'p01'],
    })],
  ] as const)('rejects validation evidence with %s before lambda selection', (_name, mutate) => {
    const validation = evaluationSubsets();
    validation[0] = mutate(validation[0]!);
    const fits = D1_LAMBDAS.map((lambda) => fitRecord(
      'action24',
      lambda,
      Array(24).fill(0),
      '5d89f056865052bcb89c910d2d62872e029fb273c3db03f8968a52a41593c1b5',
    ));

    expect(() => selectD1Lambda({ representationId: 'action24', fits, validation }))
      .toThrow(/^runtime-fail:/);
  });
});

function directedFitSubsets(
  prefix: string,
  count: number,
  dimensions: 13 | 24,
  target: 'first' | 'last',
): D1FitSubset[] {
  return Array.from({ length: count }, (_, subsetIndex) => {
    const placementCount = 2 + subsetIndex % 11;
    const targetIndex = target === 'first' ? 0 : placementCount - 1;
    return {
      subsetId: `${prefix}-${subsetIndex.toString().padStart(2, '0')}`,
      placementIds: Array.from({ length: placementCount }, (_, index) => `p${index.toString().padStart(2, '0')}`),
      features: Array.from({ length: placementCount }, (_, index) => [index, ...Array(dimensions - 1).fill(0)]),
      q: Array.from({ length: placementCount }, (_, index) => index === targetIndex ? 0.8 : 0.2 / (placementCount - 1)),
    };
  });
}

function heldOutPlacementCount(subsetIndex: number): number {
  if (subsetIndex === 11) return 3;
  if (subsetIndex === 12) return 2;
  return 2 + subsetIndex % 11;
}

function heldOutPlacementIds(subsetIndex: number): string[] {
  return Array.from(
    { length: heldOutPlacementCount(subsetIndex) },
    (_, index) => `p${index.toString().padStart(2, '0')}`,
  );
}

const HELD_OUT_MUTATION_SUBSET_INDEX = 10;

function heldOutcome(placementId: string, input: {
  survival: readonly [number, number, number]; score: number; tetrisNumerator: number;
}) {
  const totalLines = 400;
  const tetrises = input.tetrisNumerator / 4;
  const singles = totalLines - input.tetrisNumerator;
  return {
    placementId,
    pieceCapContexts: input.survival[0], minPieces: input.survival[1], sumPieces: input.survival[2],
    sumScore: input.score, scoreRate: input.score / 512,
    totalTetrises: tetrises, totalLines,
    tetrisNumerator: input.tetrisNumerator, tetrisDenominator: totalLines,
    tetrisShare: input.tetrisNumerator / totalLines,
    clearCounts: { singles, doubles: 0, triples: 0, tetrises },
  };
}

function heldOutMatrix(input: {
  nonLower: 47 | 48;
  actionHits: 35 | 36 | 48;
  gain: 7 | 8 | 20;
  positiveGroups: 5 | 6 | 12;
  negativeGroups?: 0 | 1;
  score: 'lower' | 'equal' | 'higher';
  tetris: 'lower' | 'equal' | 'higher';
}): D1HeldOutSubset[] {
  const actionCounts = input.actionHits === 48 ? Array(12).fill(4)
    : input.actionHits === 36 ? Array(12).fill(3)
      : [...Array(11).fill(3), 2];
  const deltas = input.negativeGroups === 1
    ? [-1, 3, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0]
    : input.gain === 20
    ? [2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1]
    : input.positiveGroups === 12
      ? Array(12).fill(1)
    : input.positiveGroups === 5
      ? [2, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0]
      : input.gain === 7
        ? [2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0]
        : [2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0];
  const membership: Array<{ afterstateHit: boolean; actionHit: boolean }> = [];
  const subsets = Array.from({ length: 48 }, (_, subsetIndex) => {
    const placementIds = heldOutPlacementIds(subsetIndex);
    const actionPlacementId = placementIds.at(-1)!;
    const groupOrdinal = Math.floor(subsetIndex / 4);
    const withinGroup = subsetIndex % 4;
    let actionHit = withinGroup < actionCounts[groupOrdinal]!;
    const oldCount = actionCounts[groupOrdinal]! - deltas[groupOrdinal]!;
    let afterstateHit = withinGroup < oldCount;
    if (input.nonLower === 47 && subsetIndex === 0) {
      afterstateHit = true;
      actionHit = false;
    }
    membership.push({ afterstateHit, actionHit });
    const oldSurvival = afterstateHit || actionHit && afterstateHit ? [4, 128, 512] as const : [3, 127, 511] as const;
    const actionSurvival = input.nonLower === 47 && subsetIndex === 0
      ? [3, 127, 511] as const
      : [4, 128, 512] as const;
    const oldScore = afterstateHit && !actionHit ? 101 : 100;
    const actionScore = afterstateHit && actionHit ? 101 : afterstateHit ? 100 : 100;
    const oldTetrisNumerator = afterstateHit ? 204 : 200;
    const actionTetrisNumerator = afterstateHit ? 200 : 200;
    const decoyIsFront = !afterstateHit && !actionHit;
    const old = heldOutcome('p00', { survival: oldSurvival, score: oldScore, tetrisNumerator: oldTetrisNumerator });
    const action = heldOutcome(actionPlacementId, { survival: actionSurvival, score: actionScore, tetrisNumerator: actionTetrisNumerator });
    if (!afterstateHit && !actionHit && placementIds.length < 3) throw new Error('mixed-K fixture requires a decoy');
    const decoyPlacementId = placementIds[1]!;
    const decoy = heldOutcome(decoyPlacementId, {
      survival: decoyIsFront ? [4, 128, 512] : [2, 120, 500],
      score: decoyIsFront ? 1000 : 0,
      tetrisNumerator: decoyIsFront ? 400 : 0,
    });
    return {
      subsetId: `test-${subsetIndex.toString().padStart(2, '0')}`, groupOrdinal, placementIds,
      afterstate13: placementIds.map((_, index) => [index, ...Array(12).fill(0)]),
      action24: placementIds.map((_, index) => [index, ...Array(23).fill(0)]),
      outcomes: placementIds.map((placementId) => placementId === 'p00'
        ? old
        : placementId === actionPlacementId
          ? action
          : placementId === decoyPlacementId
            ? decoy
            : heldOutcome(placementId, { survival: [1, 100, 428], score: 0, tetrisNumerator: 0 })),
      survivalOracle: [4, 128, 512] as const,
      jointFrontPlacementIds: [
        ...(afterstateHit ? ['p00'] : []),
        ...(actionHit ? [actionPlacementId] : []),
        ...(!afterstateHit && !actionHit ? [decoyPlacementId] : []),
      ],
    };
  });
  const tuningIndex = membership.findIndex(({ afterstateHit, actionHit }) => actionHit && !afterstateHit);
  if (tuningIndex < 0) throw new Error('test fixture requires one action-only subset');
  const replaceSelected = (index: number, placementId: string, outcome: ReturnType<typeof heldOutcome>) => {
    const outcomes = [...subsets[index]!.outcomes];
    const placementIndex = subsets[index]!.placementIds.indexOf(placementId);
    if (placementIndex < 0) throw new Error('missing selected placement');
    outcomes[placementIndex] = outcome;
    subsets[index] = { ...subsets[index]!, outcomes };
  };
  const tunerOld = heldOutcome('p00', { survival: [3, 127, 511], score: 10_000, tetrisNumerator: 200 });
  replaceSelected(tuningIndex, 'p00', tunerOld);
  const withoutTunerActionScore = subsets.reduce((sum, subset, index) =>
    sum + (index === tuningIndex ? 0 : subset.outcomes.at(-1)!.sumScore), 0);
  const oldScoreTotal = subsets.reduce((sum, subset) => sum + subset.outcomes[0]!.sumScore, 0);
  const scoreDelta = input.score === 'lower' ? -1 : input.score === 'equal' ? 0 : 1;
  const tunedActionScore = oldScoreTotal + scoreDelta - withoutTunerActionScore;
  const withoutTunerActionTetris = subsets.reduce((sum, subset, index) =>
    sum + (index === tuningIndex ? 0 : subset.outcomes.at(-1)!.tetrisNumerator), 0);
  const oldTetrisTotal = subsets.reduce((sum, subset) => sum + subset.outcomes[0]!.tetrisNumerator, 0);
  const tetrisDelta = input.tetris === 'lower' ? -4 : input.tetris === 'equal' ? 0 : 4;
  const tunedActionTetris = oldTetrisTotal + tetrisDelta - withoutTunerActionTetris;
  if (tunedActionScore < 0 || tunedActionTetris < 0 || tunedActionTetris > 400 || tunedActionTetris % 4 !== 0) {
    throw new Error('invalid held-out test tuning');
  }
  const tunerActionPlacementId = subsets[tuningIndex]!.placementIds.at(-1)!;
  replaceSelected(tuningIndex, tunerActionPlacementId, heldOutcome(tunerActionPlacementId, {
    survival: [4, 128, 512],
    score: tunedActionScore,
    tetrisNumerator: tunedActionTetris,
  }));
  return subsets;
}

function zeroLineHeldOutMatrix(input: {
  actionTetrisCount: 0 | 2;
  actionScore: 100 | 101;
  placementCount?: number;
}): D1HeldOutSubset[] {
  const exactOutcome = (
    placementId: string,
    score: number,
    hasTetris: boolean,
    survival: readonly [number, number, number],
  ) => ({
    placementId,
    pieceCapContexts: survival[0],
    minPieces: survival[1],
    sumPieces: survival[2],
    sumScore: score,
    scoreRate: score / 512,
    totalTetrises: hasTetris ? 1 : 0,
    totalLines: hasTetris ? 4 : 0,
    tetrisNumerator: hasTetris ? 4 : 0,
    tetrisDenominator: hasTetris ? 4 : 0,
    tetrisShare: hasTetris ? 1 : 0,
    clearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: hasTetris ? 1 : 0 },
  });
  return Array.from({ length: 48 }, (_, subsetIndex) => {
    const placementIds = input.placementCount === undefined
      ? heldOutPlacementIds(subsetIndex)
      : Array.from({ length: input.placementCount }, (_, index) => `p${index.toString().padStart(2, '0')}`);
    const actionPlacementId = placementIds.at(-1)!;
    const oldHasTetris = input.actionTetrisCount === 2 && subsetIndex === 0;
    const actionHasTetris = subsetIndex < input.actionTetrisCount;
    const old = exactOutcome('p00', 100, oldHasTetris, [4, 128, 512]);
    const action = exactOutcome(actionPlacementId, input.actionScore, actionHasTetris, [4, 128, 512]);
    const front = input.actionScore > 100 || actionHasTetris && !oldHasTetris
      ? [actionPlacementId]
      : ['p00', actionPlacementId];
    return {
      subsetId: `zero-lines-${subsetIndex.toString().padStart(2, '0')}`,
      groupOrdinal: Math.floor(subsetIndex / 4),
      placementIds,
      afterstate13: placementIds.map((_, index) => [index, ...Array(12).fill(0)]),
      action24: placementIds.map((_, index) => [index, ...Array(23).fill(0)]),
      outcomes: placementIds.map((placementId) => placementId === 'p00'
        ? old
        : placementId === actionPlacementId
          ? action
          : exactOutcome(placementId, 0, false, [3, 127, 511])),
      survivalOracle: [4, 128, 512] as const,
      jointFrontPlacementIds: front,
    };
  });
}

describe('D1 held-out verdict matrix', () => {
  let bundle: D1FinalModelBundle;

  beforeAll(() => {
    const fitsFor = (representationId: 'afterstate13' | 'action24') => {
      const dimensions = representationId === 'afterstate13' ? 13 : 24;
      const weightDigest = representationId === 'afterstate13'
        ? '39f37f8d1931b3bdf767e7510dd69509fbf23af1f7654933d0a4d291cbdd4418'
        : '5d89f056865052bcb89c910d2d62872e029fb273c3db03f8968a52a41593c1b5';
      return D1_LAMBDAS.map((lambda) => fitRecord(representationId, lambda, Array(dimensions).fill(0), weightDigest));
    };
    const selections = {
      afterstate13: selectD1Lambda({ representationId: 'afterstate13', fits: fitsFor('afterstate13'), validation: evaluationSubsets(13) }),
      action24: selectD1Lambda({ representationId: 'action24', fits: fitsFor('action24'), validation: evaluationSubsets(24) }),
    };
    bundle = freezeD1FinalModels({
      selections,
      train: {
        afterstate13: directedFitSubsets('verdict-train', 80, 13, 'first'),
        action24: directedFitSubsets('verdict-train', 80, 24, 'last'),
      },
      validation: {
        afterstate13: directedFitSubsets('verdict-validation', 32, 13, 'first'),
        action24: directedFitSubsets('verdict-validation', 32, 24, 'last'),
      },
    });
  });

  it('sums true mixed zero and nonzero denominators without manufacturing strict Tetris improvement', () => {
    const result = evaluateD1HeldOut({
      models: bundle,
      subsets: zeroLineHeldOutMatrix({ actionTetrisCount: 2, actionScore: 100 }),
    });

    expect(result.cardinalityMetrics).toEqual([
      ...[5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4].map((subsetCount, index) => ({
        selectedCount: index + 2,
        subsetCount,
        afterstate13FrontHits: index === 1 ? 4 : subsetCount,
        action24FrontHits: subsetCount,
        action24NonLowerSurvival: subsetCount,
        frontDelta: index === 1 ? 1 : 0,
      })),
    ]);
    expect(result.metrics.afterstate13.scheduledPieces).toBe(48 * 4 * 128);
    expect(result.metrics.action24.scheduledPieces).toBe(48 * 4 * 128);
    expect(result.metrics.afterstate13.sumScore).toBe(4_800);
    expect(result.metrics.afterstate13.scoreRate).toBe(4_800 / 24_576);
    expect(result.metrics.action24.sumScore).toBe(4_800);
    expect(result.metrics.action24.scoreRate).toBe(4_800 / 24_576);
    expect(result.metrics.afterstate13).toMatchObject({
      tetrisNumerator: 4,
      tetrisDenominator: 4,
      tetrisShare: 1,
    });
    expect(result.metrics.action24).toMatchObject({
      tetrisNumerator: 8,
      tetrisDenominator: 8,
      tetrisShare: 1,
    });
    expect(result.gates.tetrisNonLower).toBe(true);
    expect(result.gates.jointStrictImprovement).toBe(false);
    expect(result.status).toBe('fail-joint-selection-not-shown');
    expect(result.failureReasons).toEqual(['joint-score-and-tetris-not-strictly-higher']);
  });

  it('uses one global selected Tetris fraction when subset denominators differ', () => {
    const subsets = zeroLineHeldOutMatrix({ actionTetrisCount: 0, actionScore: 101 });
    const replaceFraction = (subsetIndex: number, placementId: string, numerator: number, denominator: number) => {
      const subset = subsets[subsetIndex]!;
      const placementIndex = subset.placementIds.indexOf(placementId);
      const outcomes = [...subset.outcomes];
      const previous = outcomes[placementIndex]!;
      const tetrises = numerator / 4;
      outcomes[placementIndex] = {
        ...previous,
        totalTetrises: tetrises,
        totalLines: denominator,
        tetrisNumerator: numerator,
        tetrisDenominator: denominator,
        tetrisShare: numerator / denominator,
        clearCounts: { singles: denominator - numerator, doubles: 0, triples: 0, tetrises },
      };
      subsets[subsetIndex] = { ...subset, outcomes };
    };

    replaceFraction(0, 'p00', 4, 4);
    replaceFraction(1, 'p00', 0, 400);
    replaceFraction(0, subsets[0]!.placementIds.at(-1)!, 100, 400);
    replaceFraction(1, subsets[1]!.placementIds.at(-1)!, 4, 16);
    subsets[0] = {
      ...subsets[0]!,
      jointFrontPlacementIds: ['p00', subsets[0]!.placementIds.at(-1)!],
    };

    const result = evaluateD1HeldOut({ models: bundle, subsets });

    // Equal per-subset shares reverse this ordering: 1/48 > (1/4 + 1/4)/48.
    expect(result.metrics.afterstate13).toMatchObject({
      tetrisNumerator: 4,
      tetrisDenominator: 404,
      tetrisShare: 4 / 404,
    });
    expect(result.metrics.action24).toMatchObject({
      tetrisNumerator: 104,
      tetrisDenominator: 416,
      tetrisShare: 104 / 416,
    });
    expect(result.gates.tetrisNonLower).toBe(true);
    expect(result.gates.jointStrictImprovement).toBe(true);
    expect(result.status).toBe('pass-action-conditioned-listwise-supported');
  });

  it('accepts all-zero selected denominators as zero shares and lets score provide the strict improvement', () => {
    const result = evaluateD1HeldOut({
      models: bundle,
      subsets: zeroLineHeldOutMatrix({ actionTetrisCount: 0, actionScore: 101 }),
    });

    expect(result.metrics.afterstate13).toMatchObject({
      tetrisNumerator: 0,
      tetrisDenominator: 0,
      tetrisShare: 0,
    });
    expect(result.metrics.action24).toMatchObject({
      tetrisNumerator: 0,
      tetrisDenominator: 0,
      tetrisShare: 0,
    });
    expect(result.gates.tetrisNonLower).toBe(true);
    expect(result.gates.jointStrictImprovement).toBe(true);
    expect(result.status).toBe('pass-action-conditioned-listwise-supported');
  });

  it('reports all six exact cardinality fields and retains zero-count K=2 through K=12 strata', () => {
    const result = evaluateD1HeldOut({
      models: bundle,
      subsets: zeroLineHeldOutMatrix({ actionTetrisCount: 0, actionScore: 101, placementCount: 2 }),
    });

    expect(result.cardinalityMetrics).toEqual([
      { selectedCount: 2, subsetCount: 48, afterstate13FrontHits: 0, action24FrontHits: 48,
        action24NonLowerSurvival: 48, frontDelta: 48 },
      ...Array.from({ length: 10 }, (_, index) => ({
        selectedCount: index + 3,
        subsetCount: 0,
        afterstate13FrontHits: 0,
        action24FrontHits: 0,
        action24NonLowerSurvival: 0,
        frontDelta: 0,
      })),
    ]);
    expect(result.cardinalityMetrics.every((metric) => !Object.prototype.hasOwnProperty.call(metric, 'placementCount'))).toBe(true);
  });

  it('requires held-out outcomes and both feature representations to equal K', () => {
    const base = zeroLineHeldOutMatrix({ actionTetrisCount: 0, actionScore: 101 });
    for (const key of ['outcomes', 'afterstate13', 'action24'] as const) {
      const subsets = [...base];
      subsets[0] = { ...subsets[0]!, [key]: subsets[0]![key].slice(0, 1) };
      const result = evaluateD1HeldOut({ models: bundle, subsets });
      expect(result.status).toBe('runtime-fail');
      expect(result.failureReasons).toEqual(['malformed-metrics']);
    }
  });

  it.each([
    ['a lowered survival oracle', () => {
      const subsets = zeroLineHeldOutMatrix({ actionTetrisCount: 0, actionScore: 101 });
      subsets[0] = { ...subsets[0]!, survivalOracle: [3, 127, 511] };
      return subsets;
    }],
    ['an omitted nondominated placement', () => {
      const subsets = zeroLineHeldOutMatrix({ actionTetrisCount: 2, actionScore: 100 });
      subsets[0] = { ...subsets[0]!, jointFrontPlacementIds: ['p00'] };
      return subsets;
    }],
    ['an added dominated placement', () => {
      const subsets = zeroLineHeldOutMatrix({ actionTetrisCount: 0, actionScore: 101 });
      subsets[0] = { ...subsets[0]!, jointFrontPlacementIds: ['p00', 'p11'] };
      return subsets;
    }],
  ] as const)('rejects held-out evidence with %s before it can affect gates', (_name, buildSubsets) => {
    const result = evaluateD1HeldOut({ models: bundle, subsets: buildSubsets() });
    expect(result.status).toBe('runtime-fail');
    expect(result.failureReasons).toEqual(['malformed-metrics']);
  });

  it.each([
    [{ nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'equal', tetris: 'equal' }, 'fail-joint-selection-not-shown'],
    [{ nonLower: 47, actionHits: 48, gain: 20, positiveGroups: 12, score: 'higher', tetris: 'higher' }, 'fail-joint-selection-not-shown'],
    [{ nonLower: 48, actionHits: 35, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal' }, 'fail-representation-gain-not-held-out'],
    [{ nonLower: 48, actionHits: 36, gain: 7, positiveGroups: 6, score: 'higher', tetris: 'equal' }, 'fail-representation-gain-not-held-out'],
    [{ nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 5, score: 'higher', tetris: 'equal' }, 'fail-representation-gain-not-held-out'],
    [{ nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal' }, 'pass-action-conditioned-listwise-supported'],
  ] as const)('applies the frozen precedence to %j', (matrixInput, expectedStatus) => {
    const result = evaluateD1HeldOut({ models: bundle, subsets: heldOutMatrix(matrixInput) });
    expect(result.status).toBe(expectedStatus);
    expect(result.selectedPlacementDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.metricProjectionDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['lower', 'lower', 'fail-joint-selection-not-shown', false, false, false],
    ['lower', 'equal', 'fail-joint-selection-not-shown', false, true, false],
    ['lower', 'higher', 'fail-joint-selection-not-shown', false, true, false],
    ['equal', 'lower', 'fail-joint-selection-not-shown', true, false, false],
    ['equal', 'equal', 'fail-joint-selection-not-shown', true, true, false],
    ['equal', 'higher', 'pass-action-conditioned-listwise-supported', true, true, true],
    ['higher', 'lower', 'fail-joint-selection-not-shown', true, false, false],
    ['higher', 'equal', 'pass-action-conditioned-listwise-supported', true, true, true],
    ['higher', 'higher', 'pass-action-conditioned-listwise-supported', true, true, true],
  ] as const)(
    'keeps the global score=%s and Tetris=%s fraction boundary',
    (score, tetris, status, scoreNonLower, tetrisNonLower, jointStrictImprovement) => {
      const result = evaluateD1HeldOut({
        models: bundle,
        subsets: heldOutMatrix({
          nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score, tetris,
        }),
      });

      expect(result.status).toBe(status);
      expect(result.gates).toMatchObject({ scoreNonLower, tetrisNonLower, jointStrictImprovement });
      expect(Number.isSafeInteger(result.metrics.afterstate13.tetrisNumerator)).toBe(true);
      expect(Number.isSafeInteger(result.metrics.afterstate13.tetrisDenominator)).toBe(true);
      expect(Number.isSafeInteger(result.metrics.action24.tetrisNumerator)).toBe(true);
      expect(Number.isSafeInteger(result.metrics.action24.tetrisDenominator)).toBe(true);
    },
  );

  it.each([
    [
      { nonLower: 48, actionHits: 35, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal' },
      { survivalBelow: 0, nonLower: true, frontHits: 35, frontFloor: false, frontGain: true,
        nonnegativeGroups: 12, allNonNegative: true, positiveGroups: 6 },
    ],
    [
      { nonLower: 48, actionHits: 36, gain: 7, positiveGroups: 6, score: 'higher', tetris: 'equal' },
      { survivalBelow: 0, nonLower: true, frontHits: 36, frontFloor: true, frontGain: false,
        nonnegativeGroups: 12, allNonNegative: true, positiveGroups: 6 },
    ],
    [
      { nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, negativeGroups: 1, score: 'higher', tetris: 'equal' },
      { survivalBelow: 0, nonLower: true, frontHits: 36, frontFloor: true, frontGain: true,
        nonnegativeGroups: 11, allNonNegative: false, positiveGroups: 6 },
    ],
    [
      { nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 5, score: 'higher', tetris: 'equal' },
      { survivalBelow: 0, nonLower: true, frontHits: 36, frontFloor: true, frontGain: true,
        nonnegativeGroups: 12, allNonNegative: true, positiveGroups: 5 },
    ],
    [
      { nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal' },
      { survivalBelow: 0, nonLower: true, frontHits: 36, frontFloor: true, frontGain: true,
        nonnegativeGroups: 12, allNonNegative: true, positiveGroups: 6 },
    ],
  ] as const)('preserves every v1 representation boundary for %j', (matrixInput, expected) => {
    const result = evaluateD1HeldOut({ models: bundle, subsets: heldOutMatrix(matrixInput) });
    expect(result.metrics.action24.survivalBelowSubsetOracle).toBe(expected.survivalBelow);
    expect(result.gates.action24NonLowerSurvival).toBe(expected.nonLower);
    expect(result.metrics.action24.subsetJointFrontHits).toBe(expected.frontHits);
    expect(result.gates.action24FrontHitFloor).toBe(expected.frontFloor);
    expect(result.gates.action24FrontHitGain).toBe(expected.frontGain);
    expect(result.seedGroups.filter((group) => group.groupFrontDelta >= 0)).toHaveLength(expected.nonnegativeGroups);
    expect(result.gates.allSeedGroupsNonNegative).toBe(expected.allNonNegative);
    expect(result.gates.positiveSeedGroupCount).toBe(expected.positiveGroups);
  });

  it('preserves oracle 0 and all 48 non-lower subset comparisons at the passing edge', () => {
    const result = evaluateD1HeldOut({
      models: bundle,
      subsets: heldOutMatrix({
        nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal',
      }),
    });
    expect(result.metrics.action24.survivalBelowSubsetOracle).toBe(0);
    expect(result.metrics.action24.selectedSurvivalTuples).toHaveLength(48);
    expect(result.gates.action24NonLowerSurvival).toBe(true);
    expect(result.seedGroups.map((group) => group.groupFrontDelta)).toEqual([
      2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('gives joint statistical failure precedence over simultaneous representation failures', () => {
    const result = evaluateD1HeldOut({
      models: bundle,
      subsets: heldOutMatrix({
        nonLower: 48, actionHits: 35, gain: 7, positiveGroups: 5, negativeGroups: 1,
        score: 'lower', tetris: 'lower',
      }),
    });
    expect(result.status).toBe('fail-joint-selection-not-shown');
    expect(result.failureReasons).toEqual([
      'action24-score-lower-than-afterstate13',
      'action24-tetris-share-lower-than-afterstate13',
      'joint-score-and-tetris-not-strictly-higher',
    ]);
  });

  it.each([
    [{ nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, negativeGroups: 1, score: 'higher', tetris: 'equal' },
      'seed-group-nonnegative-floor-not-met'],
    [{ nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'lower', tetris: 'equal' },
      'action24-score-lower-than-afterstate13'],
    [{ nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'lower' },
      'action24-tetris-share-lower-than-afterstate13'],
  ] as const)('fails the exact lower boundary %j', (matrixInput, expectedReason) => {
    const result = evaluateD1HeldOut({ models: bundle, subsets: heldOutMatrix(matrixInput) });
    expect(result.status).not.toBe('pass-action-conditioned-listwise-supported');
    expect(result.failureReasons).toContain(expectedReason);
  });

  it('returns only the applicable runtime reason for malformed held-out counts', () => {
    const malformed = heldOutMatrix({
      nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal',
    }).slice(0, 47);
    const result = evaluateD1HeldOut({ models: bundle, subsets: malformed });
    expect(result.status).toBe('runtime-fail');
    expect(result.failureReasons).toEqual(['malformed-metrics']);
  });

  it('rejects reordered seed groups even when all twelve group counts remain complete', () => {
    const subsets = heldOutMatrix({
      nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal',
    });
    [subsets[0], subsets[4]] = [subsets[4]!, subsets[0]!];
    const result = evaluateD1HeldOut({ models: bundle, subsets });
    expect(result.status).toBe('runtime-fail');
    expect(result.failureReasons).toEqual(['malformed-metrics']);
  });

  it('rejects a contradictory unselected outcome instead of allowing partial metric validation', () => {
    const subsets = heldOutMatrix({
      nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal',
    });
    const outcome = subsets[HELD_OUT_MUTATION_SUBSET_INDEX]!.outcomes[5]!;
    const outcomes = [...subsets[HELD_OUT_MUTATION_SUBSET_INDEX]!.outcomes];
    outcomes[5] = { ...outcome, totalLines: outcome.totalLines + 1 };
    subsets[HELD_OUT_MUTATION_SUBSET_INDEX] = {
      ...subsets[HELD_OUT_MUTATION_SUBSET_INDEX]!, outcomes,
    };

    const result = evaluateD1HeldOut({ models: bundle, subsets });

    expect(result.status).toBe('runtime-fail');
    expect(result.failureReasons).toEqual(['malformed-metrics']);
  });

  it.each([
    ['negative-zero oracle component', (subset: D1HeldOutSubset) => ({ ...subset, survivalOracle: [-0, 128, 512] as const })],
    ['negative oracle component', (subset: D1HeldOutSubset) => ({ ...subset, survivalOracle: [-1, 128, 512] as const })],
    ['non-safe-integer oracle component', (subset: D1HeldOutSubset) => ({ ...subset, survivalOracle: [4, 128, Number.MAX_SAFE_INTEGER + 1] as const })],
    ['non-maximal oracle tuple', (subset: D1HeldOutSubset) => ({ ...subset, survivalOracle: [3, 127, 511] as const })],
    ['duplicate front placement', (subset: D1HeldOutSubset) => ({ ...subset, jointFrontPlacementIds: ['p00', 'p00'] })],
    ['non-canonical front order', (subset: D1HeldOutSubset) => ({ ...subset, jointFrontPlacementIds: ['p11', 'p00'] })],
    ['non-member front placement', (subset: D1HeldOutSubset) => ({ ...subset, jointFrontPlacementIds: ['pxx'] })],
  ] as const)('fails closed for %s', (_name, mutate) => {
    const subsets = heldOutMatrix({
      nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal',
    });
    subsets[0] = mutate(subsets[0]!);
    const result = evaluateD1HeldOut({ models: bundle, subsets });
    expect(result.status).toBe('runtime-fail');
    expect(result.failureReasons).toEqual(['malformed-metrics']);
  });

  it('rejects a four-cap outcome whose min and sum pieces contradict all four contexts reaching 128', () => {
    const subsets = heldOutMatrix({
      nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal',
    });
    const outcomes = [...subsets[HELD_OUT_MUTATION_SUBSET_INDEX]!.outcomes];
    outcomes[5] = { ...outcomes[5]!, pieceCapContexts: 4, minPieces: 127, sumPieces: 511 };
    subsets[HELD_OUT_MUTATION_SUBSET_INDEX] = {
      ...subsets[HELD_OUT_MUTATION_SUBSET_INDEX]!, outcomes,
    };
    const result = evaluateD1HeldOut({ models: bundle, subsets });
    expect(result.status).toBe('runtime-fail');
    expect(result.failureReasons).toEqual(['malformed-metrics']);
  });

  function resultForSurvivalTuple(tuple: readonly [number, number, number]) {
    const subsets = heldOutMatrix({
      nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal',
    });
    const outcomes = [...subsets[HELD_OUT_MUTATION_SUBSET_INDEX]!.outcomes];
    outcomes[5] = {
      ...outcomes[5]!, pieceCapContexts: tuple[0], minPieces: tuple[1], sumPieces: tuple[2],
    };
    subsets[HELD_OUT_MUTATION_SUBSET_INDEX] = {
      ...subsets[HELD_OUT_MUTATION_SUBSET_INDEX]!, outcomes,
    };
    return evaluateD1HeldOut({ models: bundle, subsets });
  }

  it('rejects zero capped contexts with minimum 127 and impossible sum 511', () => {
    const result = resultForSurvivalTuple([0, 127, 511]);
    expect(result.status).toBe('runtime-fail');
    expect(result.failureReasons).toEqual(['malformed-metrics']);
  });

  it.each([
    [0, 100, 400, 481],
    [1, 100, 428, 482],
    [2, 100, 456, 483],
    [3, 100, 484, 484],
  ] as const)('enforces independently derived feasible sums for %i capped contexts', (caps, min, lower, upper) => {
    expect(resultForSurvivalTuple([caps, min, lower]).status).not.toBe('runtime-fail');
    expect(resultForSurvivalTuple([caps, min, upper]).status).not.toBe('runtime-fail');
    expect(resultForSurvivalTuple([caps, min, lower - 1]).failureReasons).toEqual(['malformed-metrics']);
    expect(resultForSurvivalTuple([caps, min, upper + 1]).failureReasons).toEqual(['malformed-metrics']);
  });

  it('rejects negative zero in every non-negative held-out outcome count field', () => {
    const numericKeys = [
      'pieceCapContexts', 'minPieces', 'sumPieces', 'sumScore',
      'totalTetrises', 'totalLines', 'tetrisNumerator', 'tetrisDenominator',
    ] as const;
    const clearKeys = ['singles', 'doubles', 'triples', 'tetrises'] as const;
    for (const key of numericKeys) {
      const subsets = heldOutMatrix({
        nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal',
      });
      const outcomes = [...subsets[HELD_OUT_MUTATION_SUBSET_INDEX]!.outcomes];
      outcomes[5] = { ...outcomes[5]!, [key]: -0 };
      subsets[HELD_OUT_MUTATION_SUBSET_INDEX] = {
        ...subsets[HELD_OUT_MUTATION_SUBSET_INDEX]!, outcomes,
      };
      expect(evaluateD1HeldOut({ models: bundle, subsets }).failureReasons).toEqual(['malformed-metrics']);
    }
    for (const key of clearKeys) {
      const subsets = heldOutMatrix({
        nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal',
      });
      const outcomes = [...subsets[HELD_OUT_MUTATION_SUBSET_INDEX]!.outcomes];
      outcomes[5] = { ...outcomes[5]!, clearCounts: { ...outcomes[5]!.clearCounts, [key]: -0 } };
      subsets[HELD_OUT_MUTATION_SUBSET_INDEX] = {
        ...subsets[HELD_OUT_MUTATION_SUBSET_INDEX]!, outcomes,
      };
      expect(evaluateD1HeldOut({ models: bundle, subsets }).failureReasons).toEqual(['malformed-metrics']);
    }
  });

  it('returns bit-identical metric projections on a deterministic replay', () => {
    const subsets = heldOutMatrix({
      nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal',
    });
    const first = evaluateD1HeldOut({ models: bundle, subsets });
    const second = evaluateD1HeldOut({ models: bundle, subsets });
    expect(second.metricProjectionDigest).toBe(first.metricProjectionDigest);
    expect(second.selectedPlacementDigest).toBe(first.selectedPlacementDigest);
  });

  it('fails closed when caller evidence stays stable for both early projections then drifts on a later read', () => {
    const subsets = heldOutMatrix({
      nonLower: 48, actionHits: 36, gain: 8, positiveGroups: 6, score: 'higher', tetris: 'equal',
    });
    const stable = subsets[0]!.action24;
    const drifted = stable.map((row) => [-row[0]! - 1, ...row.slice(1)]);
    let reads = 0;
    Object.defineProperty(subsets[0], 'action24', {
      configurable: true,
      get: () => (++reads <= 2 ? stable : drifted),
    });

    const result = evaluateD1HeldOut({ models: bundle, subsets });

    expect(result.status).toBe('runtime-fail');
    expect(result.failureReasons).toEqual(['nondeterministic-replay']);
  });
});

describe('a fit stalled at its floating-point gradient floor', () => {
  /**
   * The absolute `gradientNorm <= 1e-9` tolerance is not scale invariant, so a
   * converged fit whose attainable floor sits above it can never satisfy it.
   * `action24 @ lambda=0.1` does exactly that on real capture data: quadratic
   * convergence through iteration 4, then a bit-identical 1.832e-9 for the
   * remaining 195 iterations. It halted a 7-hour D2 run 68 shards short of its
   * verdict.
   */
  const stalling = (plateauAfter: number, floor: number) => {
    let calls = 0;
    return {
      initialWeights: [0],
      evaluateSystem: () => {
        calls += 1;
        return {
          objective: 1,
          gradient: [calls <= plateauAfter ? 1e-3 * 0.5 ** calls : floor],
          hessian: [[1]],
        };
      },
      evaluateObjective: () => 1,
      solveDirection: (_hessian: readonly (readonly number[])[], gradient: readonly number[]) =>
        [-gradient[0]!],
    };
  };

  it('returns it as converged instead of throwing at the cap', () => {
    const fit = runD1NewtonController(stalling(10, 2e-9));
    expect(fit.iterationCount).toBe(200);
    expect(fit.gradientNorm).toBe(2e-9);
  });

  it('still fails closed while the gradient is genuinely still descending', () => {
    // Never plateaus, and never reaches 1e-9 either: this is a slow fit, not a
    // stalled one, and the distinction is the whole point of the check.
    let calls = 0;
    expect(() => runD1NewtonController({
      initialWeights: [0],
      evaluateSystem: () => {
        calls += 1;
        return { objective: 1, gradient: [1e-3 * 0.999 ** calls], hessian: [[1]] };
      },
      evaluateObjective: () => 1,
      solveDirection: (_hessian, gradient) => [-gradient[0]!],
    })).toThrow(/optimizer did not converge/);
  });

  it('does not accept a plateau shorter than the stagnation window', () => {
    // Improves until 20 iterations before the cap. Twenty is under the window,
    // so this must still throw -- otherwise the window is decoration.
    let calls = 0;
    expect(() => runD1NewtonController({
      initialWeights: [0],
      evaluateSystem: () => {
        calls += 1;
        const magnitude = 1e-3 * 0.999 ** Math.min(calls, 181);
        return { objective: 1, gradient: [magnitude], hessian: [[1]] };
      },
      evaluateObjective: () => 1,
      solveDirection: (_hessian, gradient) => [-gradient[0]!],
    })).toThrow(/optimizer did not converge/);
  });

  it('still fails closed on a divergence whose gradient norm never moves', () => {
    // The shape that broke the first version of this check, and the reason the
    // objective is tested as well as the gradient: the objective falls without
    // bound while the gradient norm sits constant at 1, so "the gradient has
    // not improved in 32 iterations" is true of a divergence too. Only the
    // objective separates it from a genuine floor. `D1 private Newton
    // production guards > accepts exactly 200 updates` covers the same shape
    // from the production side; this states it as a property of the fix.
    expect(() => runD1NewtonController({
      initialWeights: [0],
      evaluateSystem: (weights) => ({
        objective: -weights[0]!, gradient: [-1], hessian: [[1]],
      }),
      evaluateObjective: (weights) => -weights[0]!,
      solveDirection: () => [1],
    })).toThrow(/optimizer did not converge/);
  });

  it('leaves a fit that converges normally untouched', () => {
    // The guarantee that protects the D1 baseline: the stagnation branch lives
    // at the cap, which a converging fit never reaches.
    const fit = runD1NewtonController(stalling(10, 1e-12));
    expect(fit.iterationCount).toBe(10);
    expect(fit.gradientNorm).toBe(1e-12);
  });
});
