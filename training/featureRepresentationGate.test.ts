import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  B1_PLACEMENT_PAIR_DESCRIPTORS,
  materializeAllPlacementPairs,
  materializePlacementPair,
} from './featureRepresentationCorpus';
import { extractFeatures } from '../src/ai/features';
import { extractB1PlacementFeatures } from '../src/ai/opportunityFeatures';
import {
  evaluateRepresentationGate,
  emitRepresentationGateCli,
  fitLinearMarginWitness,
  judgeRepresentationGate,
  serializeRepresentationGateResult,
  type RepresentationGateResult,
  type RepresentationGateEvaluationInput,
} from './featureRepresentationGate';

const LEGACY_B1_DIGEST = '3c7aefebeb28b7e52b6b5e0fbcf0e57447ef79bf1a8b8662b8ebc592383ad5e2';

const solverOptions = {
  margin: 0.01,
  normCap: 1,
  tolerance: 1e-9,
  learningStep: 0.05,
  maxUpdates: 100000,
} as const;

describe('fitLinearMarginWitness', () => {
  it('finds a deterministic witness for a separable synthetic delta set', () => {
    const first = fitLinearMarginWitness([[1, 0], [0, 1]], solverOptions);
    const second = fitLinearMarginWitness([[1, 0], [0, 1]], solverOptions);

    expect(first.found).toBe(true);
    expect(first.witness).toEqual(second.witness);
    expect(first.witness).toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number)]));
  });
});

describe('judgeRepresentationGate', () => {
  it('fails closed when safety regresses even if strategy accuracy is high', () => {
    expect(judgeRepresentationGate({
      pairCount: 32,
      strategyCorrect13: 18,
      strategyCorrect17: 24,
      safetyCorrect17: 7,
      leaveOneStateOutStrategyRate17: 1,
      leaveOneStateOutSafetyRegressionCount17: 1,
      repeatedRunDeterministic: true,
    }).status).toBe('fail');
  });

  it.each([
    ['strategy below threshold', { pairCount: 32, strategyCorrect13: 20, strategyCorrect17: 21, safetyCorrect17: 8, leaveOneStateOutStrategyRate17: 1, leaveOneStateOutSafetyRegressionCount17: 0, repeatedRunDeterministic: true }],
    ['loso below threshold', { pairCount: 32, strategyCorrect13: 18, strategyCorrect17: 24, safetyCorrect17: 8, leaveOneStateOutStrategyRate17: 0.89, leaveOneStateOutSafetyRegressionCount17: 0, repeatedRunDeterministic: true }],
    ['gain below threshold', { pairCount: 32, strategyCorrect13: 22, strategyCorrect17: 25, safetyCorrect17: 8, leaveOneStateOutStrategyRate17: 1, leaveOneStateOutSafetyRegressionCount17: 0, repeatedRunDeterministic: true }],
    ['nondeterministic order', { pairCount: 32, strategyCorrect13: 22, strategyCorrect17: 24, safetyCorrect17: 8, leaveOneStateOutStrategyRate17: 1, leaveOneStateOutSafetyRegressionCount17: 0, repeatedRunDeterministic: false }],
  ] as const)('fails closed for %s', (_label, input) => {
    expect(judgeRepresentationGate(input).status).toBe('fail');
  });
});

describe('evaluateRepresentationGate', () => {
  it('keeps the dispatch-time B1 digest instead of self-comparing through the protocol', () => {
    const gate = evaluateRepresentationGate();

    expect(gate.repeatedRunDigest).toBe(LEGACY_B1_DIGEST);
    expect(gate.identicalRunDigest).toBe(LEGACY_B1_DIGEST);
  });

  it('evaluates the reviewed corpus deterministically', () => {
    const first = evaluateRepresentationGate();
    const second = evaluateRepresentationGate();

    expect(first).toEqual(second);
    expect(first.pairCount).toBe(32);
    expect(first.corpus).toBe('b1-placement-pair-corpus-v1');
  });

  it('canonicalizes nondeterministic input order', () => {
    const normal = evaluateRepresentationGate();
    const reversed = evaluateRepresentationGate({
      materializeAllPlacementPairs: () => [...materializeAllPlacementPairs()].reverse(),
    });

    expect(reversed).toEqual(normal);
  });

  it('fails closed when a strategy state appears more than once', () => {
    const pairs = materializeAllPlacementPairs();
    const duplicate = pairs.map((pair, index) => index === 1
      ? { ...pair, descriptor: { ...pair.descriptor, stateId: pairs[0]!.descriptor.stateId } }
      : pair);
    const result = evaluateRepresentationGate({
      materializeAllPlacementPairs: () => duplicate,
    });

    expect(result.status).toBe('fail');
    expect(result.failureReasons).toEqual(['representation-gate-evaluation-error']);
  });

  it.each([
    ['missing pair', {
      materializeAllPlacementPairs: () => B1_PLACEMENT_PAIR_DESCRIPTORS.slice(0, 31).map((descriptor) => materializePlacementPair(descriptor)),
    }],
    ['illegal placement', {
      materializeAllPlacementPairs: () => { throw new Error('illegal placement'); },
    }],
    ['NaN feature', {
      extractFeatures: (board: Parameters<typeof extractFeatures>[0], linesCleared: number, placedCells: Parameters<typeof extractFeatures>[2]) =>
        [NaN, ...extractFeatures(board, linesCleared, placedCells).slice(1)],
    }],
    ['Infinity feature', {
      extractB1PlacementFeatures: (input: Parameters<typeof extractB1PlacementFeatures>[0]) =>
        [Infinity, ...extractB1PlacementFeatures(input).slice(1)],
    }],
  ] satisfies Array<[string, Partial<RepresentationGateEvaluationInput>]>)('fails closed for %s', (_label, overrides) => {
    const result = evaluateRepresentationGate(overrides);
    expect(result.status).toBe('fail');
    expect(result.failureReasons.length).toBeGreaterThan(0);
  });

  it('serializes stable key order', () => {
    const result = evaluateRepresentationGate();
    const shuffled: RepresentationGateResult = {
      failureReasons: result.failureReasons,
      repeatedRunDeterministic: result.repeatedRunDeterministic,
      repeatedRunDigest: result.repeatedRunDigest,
      identicalRunDigest: result.identicalRunDigest,
      status: result.status,
      corpus: result.corpus,
      pairCount: result.pairCount,
      mode: result.mode,
      pairIds: result.pairIds,
      old13: result.old13,
      new17: result.new17,
    };

    expect(serializeRepresentationGateResult(shuffled)).toBe(serializeRepresentationGateResult(result));
  });

  it('sanitizes caught exceptions without leaking raw text', () => {
    const result = evaluateRepresentationGate({
      materializeAllPlacementPairs: () => {
        throw new Error('C:/secret/board=hidden');
      },
    });

    const serialized = serializeRepresentationGateResult(result);
    expect(result.failureReasons).toEqual(['representation-gate-evaluation-error']);
    expect(result.repeatedRunDeterministic).toBe(false);
    expect(serialized).not.toContain('C:/secret');
    expect(serialized).not.toContain('board=hidden');
    expect(serialized).not.toContain('hidden');
  });

  it('sanitizes a throwing adapter-input getter before protocol construction', () => {
    const poisoned = Object.defineProperty({}, 'materializeAllPlacementPairs', {
      get: () => { throw new Error('C:/secret/getter=hidden'); },
    }) as Partial<RepresentationGateEvaluationInput>;

    expect(() => evaluateRepresentationGate(poisoned)).not.toThrow();
    const result = evaluateRepresentationGate(poisoned);
    const serialized = serializeRepresentationGateResult(result);
    expect(result.failureReasons).toEqual(['representation-gate-evaluation-error']);
    expect(serialized).not.toContain('C:/secret');
    expect(serialized).not.toContain('getter=hidden');
  });

  it('keeps import stdout-only and leaves no files behind', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'feature-representation-gate-'));
    const before = readdirSync(cwd);
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', [
        `process.chdir(${JSON.stringify(cwd)});`,
        `await import(${JSON.stringify(pathToFileURL(resolve('training/featureRepresentationGate.ts')).href)});`,
      ].join(' ')],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(output).toBe('');
    expect(readdirSync(cwd)).toEqual(before);
    rmSync(cwd, { recursive: true, force: true });
  });

  it('emits exactly one JSON line and creates no artifacts with an injected fixture', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'feature-representation-gate-cli-'));
    const before = readdirSync(cwd);
    const writes: string[] = [];
    const result = emitRepresentationGateCli(
      { materializeAllPlacementPairs: () => { throw new Error('C:/secret/board=hidden'); } },
      (chunk) => writes.push(chunk),
    );

    expect(result.output.status).toBe('fail');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(writes[0]!)).not.toThrow();
    expect(writes[0]).not.toContain('C:/secret');
    expect(writes[0]).not.toContain('board=hidden');
    expect(readdirSync(cwd)).toEqual(before);
    rmSync(cwd, { recursive: true, force: true });
  });
});
