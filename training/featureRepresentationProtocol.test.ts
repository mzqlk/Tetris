import { describe, expect, it } from 'vitest';
import { extractFeatures } from '../src/ai/features';
import { extractB1PlacementFeatures } from '../src/ai/opportunityFeatures';
import {
  createB1RepresentationCorpusEvaluationInput,
  evaluateRepresentationGate,
  judgeRepresentationGate,
} from './featureRepresentationGate';
import {
  canonicalizeRepresentationPairs,
  evaluateRepresentationCorpus,
  judgeRepresentationCorpus,
  serializeRepresentationSummary,
} from './featureRepresentationProtocol';
import * as representationProtocol from './featureRepresentationProtocol';
import { materializeAllPlacementPairs } from './featureRepresentationCorpus';

const LEGACY_B1_GOLDEN = {
  pairIds: ['bag-hold-00', 'bag-hold-01', 'bag-hold-02', 'bag-hold-03', 'bag-hold-04', 'bag-hold-05', 'bag-hold-06', 'bag-hold-07', 'build-00', 'build-01', 'build-02', 'build-03', 'build-04', 'build-05', 'build-06', 'build-07', 'ready-00', 'ready-01', 'ready-02', 'ready-03', 'ready-04', 'ready-05', 'ready-06', 'ready-07', 'safety-00', 'safety-01', 'safety-02', 'safety-03', 'safety-04', 'safety-05', 'safety-06', 'safety-07'],
  old13: {
    strategyCorrect: 24, safetyCorrect: 8, leaveOneStateOutStrategyRate: 0.9583333333333334, leaveOneStateOutSafetyRegressionCount: 0, excludedStateIds: [],
    witness: [-0.010030170912141317, -0.005634129640325403, 0.0011816746902540852, -0.008886551664455216, 0.009061242629241533, -0.008886551664455216, -0.001795131442254406, -0.0066435221114284765, 0.0006738117542674781, 0.005035201376812599, 0.001616080755938756, 0.0011940571732424973, 0.0018608132604610306],
  },
  new17: {
    strategyCorrect: 24, safetyCorrect: 8, leaveOneStateOutStrategyRate: 1, leaveOneStateOutSafetyRegressionCount: 0, excludedStateIds: [],
    witness: [-0.008752460593283164, -0.004602344295751382, 0.0006324152402785592, -0.008072014959986459, 0.008016886149098507, -0.008072014959986459, -0.0017503239756273923, -0.006340054771627953, 0.00040468781834053025, 0.004513054987791909, 0.0010608269650298962, 0.0002908175855006937, 0.0008364515441137815, 0.004397450639078308, 0.0015045088521436554, 0.0007090682287309084, 0],
  },
  repeatedRunDigest: '3c7aefebeb28b7e52b6b5e0fbcf0e57447ef79bf1a8b8662b8ebc592383ad5e2',
  failureReasons: ['strategy-gain-below-4'],
} as const;

function b1ProtocolResult(): ReturnType<typeof evaluateRepresentationCorpus> {
  return evaluateRepresentationCorpus(createB1RepresentationCorpusEvaluationInput());
}

describe('feature representation protocol', () => {
  it('matches the dispatch-time B1 v1 golden strategy, safety, LOSO, exclusions, witnesses, failure, and digest', () => {
    const protocol = b1ProtocolResult();

    expect(protocol.pairIds).toEqual(LEGACY_B1_GOLDEN.pairIds);
    expect(protocol.old13).toEqual(expect.objectContaining(LEGACY_B1_GOLDEN.old13));
    expect(protocol.new17).toEqual(expect.objectContaining(LEGACY_B1_GOLDEN.new17));
    expect(protocol.repeatedRunDigest).toBe(LEGACY_B1_GOLDEN.repeatedRunDigest);
    expect(protocol.identicalRunDigest).toBe(LEGACY_B1_GOLDEN.repeatedRunDigest);
    expect(protocol.failureReasons).toEqual(LEGACY_B1_GOLDEN.failureReasons);
  });

  it('canonicalizes pairs before evaluation regardless of materialization order', () => {
    const input = createB1RepresentationCorpusEvaluationInput({
      materializeAllPlacementPairs: () => [...materializeAllPlacementPairs()].reverse(),
    });

    expect(canonicalizeRepresentationPairs(input).pairs.map((pair) => pair.pairId)).toEqual(
      materializeAllPlacementPairs().map((pair) => pair.descriptor.id).sort(),
    );
    expect(b1ProtocolResult()).toEqual(evaluateRepresentationCorpus(input));
  });

  it('fails closed for malformed extractor input without leaking the thrown message', () => {
    const result = evaluateRepresentationCorpus({
      ...createB1RepresentationCorpusEvaluationInput(),
      extractOld: () => {
        throw new Error('C:/secret/representation=hidden');
      },
    });

    const serialized = serializeRepresentationSummary(result);
    expect(result.failureReasons).toEqual(['representation-gate-evaluation-error']);
    expect(result.repeatedRunDeterministic).toBe(false);
    expect(serialized).not.toContain('C:/secret');
    expect(serialized).not.toContain('representation=hidden');
    expect(serialized).not.toContain('hidden');
  });

  it('keeps B1 judgment thresholds and failure ordering in the adapter', () => {
    const result = b1ProtocolResult();
    const judgment = judgeRepresentationGate({
      pairCount: result.pairCount,
      strategyCorrect13: result.old13.strategyCorrect,
      strategyCorrect17: result.new17.strategyCorrect,
      safetyCorrect17: result.new17.safetyCorrect,
      leaveOneStateOutStrategyRate17: result.new17.leaveOneStateOutStrategyRate,
      leaveOneStateOutSafetyRegressionCount17: result.new17.leaveOneStateOutSafetyRegressionCount,
      repeatedRunDeterministic: result.repeatedRunDeterministic,
    });

    expect(judgment.failureReasons).toEqual(evaluateRepresentationGate().failureReasons);
    expect(extractFeatures).toBeTypeOf('function');
    expect(extractB1PlacementFeatures).toBeTypeOf('function');
  });

  it('uses threshold-independent generic reasons outside the B1 adapter', () => {
    const judgment = judgeRepresentationCorpus({
      pairCount: 7,
      strategyCorrect13: 3,
      strategyCorrect17: 16,
      safetyCorrect17: 2,
      leaveOneStateOutStrategyRate17: 0.6,
      leaveOneStateOutSafetyRegressionCount17: 3,
      repeatedRunDeterministic: true,
    }, {
      expectedPairCount: 7,
      expectedSafetyCorrect17: 2,
      minimumStrategyCorrect17: 17,
      minimumLeaveOneStateOutStrategyRate17: 0.75,
      expectedLeaveOneStateOutSafetyRegressionCount17: 3,
      minimumStrategyGain: 14,
    });

    expect(judgment.failureReasons).toEqual([
      'strategy-correct-17-below-minimum',
      'loso-strategy-rate-17-below-minimum',
      'strategy-gain-below-minimum',
    ]);
  });

  it('projects nested summaries before serialization so key order and extras cannot alter output', () => {
    const result = b1ProtocolResult();
    const shuffled = {
      ...result,
      old13: {
        unexpected: 'ignored',
        safetyCorrect: result.old13.safetyCorrect,
        witness: result.old13.witness,
        selectedExclusionCount: result.old13.selectedExclusionCount,
        dimensionCount: result.old13.dimensionCount,
        excludedStateIds: result.old13.excludedStateIds,
        pairResults: result.old13.pairResults,
        strategyCorrect: result.old13.strategyCorrect,
        marginMinimum: result.old13.marginMinimum,
        leaveOneStateOutStrategyRate: result.old13.leaveOneStateOutStrategyRate,
        leaveOneStateOutSafetyRegressionCount: result.old13.leaveOneStateOutSafetyRegressionCount,
      },
      new17: {
        unexpected: 'ignored',
        ...result.new17,
      },
    };

    expect(serializeRepresentationSummary(shuffled)).toBe(serializeRepresentationSummary(result));
  });

  it('evaluates dimension 13 without reading the new extractor and preserves the old-only scale result', () => {
    let newCalls = 0;
    const result = representationProtocol.evaluateRepresentationDimension({
      ...createB1RepresentationCorpusEvaluationInput(),
      extractNew: () => {
        newCalls++;
        throw new Error('new extractor must not run for 13D');
      },
    }, 13);

    expect(newCalls).toBe(0);
    expect(result.dimensionCount).toBe(13);
    expect(result.summary).toEqual(expect.objectContaining(LEGACY_B1_GOLDEN.old13));
    expect(result.failureReasons).toEqual([]);
    const b1Canonical = canonicalizeRepresentationPairs(createB1RepresentationCorpusEvaluationInput());
    expect(b1Canonical.scales13).toEqual(b1Canonical.scales17.slice(0, 13));
  });

  it('derives 13D scales from old deltas rather than the 17D feature scale', () => {
    const synthetic = {
      mode: 'feature-representation-gate' as const,
      corpus: 'synthetic-scale-corpus',
      materializePairs: () => [1],
      canonicalizePair: () => ({ pairId: 'synthetic', stateId: 'synthetic', category: 'strategy' as const, positive: 2, negative: 1 }),
      extractOld: (value: number) => Array.from({ length: 13 }, () => value),
      extractNew: (value: number) => Array.from({ length: 17 }, () => value * 5),
      strategyCategory: 'strategy' as const,
      safetyCategory: 'safety' as const,
      solverOptions: { margin: 0.01, normCap: 1, tolerance: 1e-9, learningStep: 0.05, maxUpdates: 100000 },
      judgmentThresholds: { expectedPairCount: 1, expectedSafetyCorrect17: 0, minimumStrategyCorrect17: 0, minimumLeaveOneStateOutStrategyRate17: 0, expectedLeaveOneStateOutSafetyRegressionCount17: 0, minimumStrategyGain: 0 },
    };

    const canonical = canonicalizeRepresentationPairs(synthetic);
    expect(canonical.scales13).toEqual(Array.from({ length: 13 }, () => 1));
    expect(canonical.scales17).toEqual(Array.from({ length: 17 }, () => 5));
  });

  it('evaluates dimension 17 without reading the old extractor', () => {
    let oldCalls = 0;
    const result = representationProtocol.evaluateRepresentationDimension({
      ...createB1RepresentationCorpusEvaluationInput(),
      extractOld: () => {
        oldCalls++;
        throw new Error('old extractor must not run for 17D');
      },
    }, 17);

    expect(oldCalls).toBe(0);
    expect(result.dimensionCount).toBe(17);
    expect(result.summary).toEqual(expect.objectContaining(LEGACY_B1_GOLDEN.new17));
    expect(result.failureReasons).toEqual([]);
  });

  it('keeps dimension ordering and repeated digests deterministic and sanitizes a throwing accessor', () => {
    const normal = representationProtocol.evaluateRepresentationDimension(
      createB1RepresentationCorpusEvaluationInput(),
      13,
    );
    const reversed = representationProtocol.evaluateRepresentationDimension(createB1RepresentationCorpusEvaluationInput({
      materializeAllPlacementPairs: () => [...materializeAllPlacementPairs()].reverse(),
    }), 13);
    const poisoned = Object.defineProperty({}, 'materializePairs', {
      get: () => { throw new Error('C:/secret/dimension-accessor=hidden'); },
    }) as Parameters<typeof representationProtocol.evaluateRepresentationDimension>[0];
    const safe = representationProtocol.evaluateRepresentationDimension(poisoned, 13);

    expect(reversed).toEqual(normal);
    expect(normal.repeatedRunDeterministic).toBe(true);
    expect(normal.repeatedRunDigest).toBe(normal.identicalRunDigest);
    expect(safe.failureReasons).toEqual(['representation-gate-evaluation-error']);
    expect(JSON.stringify(safe)).not.toContain('C:/secret');
    expect(JSON.stringify(safe)).not.toContain('dimension-accessor=hidden');
  });

  it('keeps the full B1 literal golden unchanged after a dimension-only evaluation', () => {
    representationProtocol.evaluateRepresentationDimension(createB1RepresentationCorpusEvaluationInput(), 17);
    const full = evaluateRepresentationGate();

    expect(full.old13).toEqual(expect.objectContaining(LEGACY_B1_GOLDEN.old13));
    expect(full.new17).toEqual(expect.objectContaining(LEGACY_B1_GOLDEN.new17));
    expect(full.repeatedRunDigest).toBe(LEGACY_B1_GOLDEN.repeatedRunDigest);
    expect(full.failureReasons).toEqual(LEGACY_B1_GOLDEN.failureReasons);
  });
});
