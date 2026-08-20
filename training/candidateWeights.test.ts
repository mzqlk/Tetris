import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fromVector } from '../src/ai/weights';
import type { ScoreRateEvaluation } from './runArtifacts';
import { buildCandidateWeights, writeCandidateWeights } from './candidateWeights';

const dirs: string[] = [];

const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tetris-candidate-'));
  dirs.push(dir);
  return dir;
};

const evaluation: ScoreRateEvaluation = {
  weights: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  meanScore: 3_100_000,
  scoreRate: 620,
  meanLines: 1_950,
  meanHeight: 3.5,
  meanClearCounts: { singles: 10, doubles: 20, triples: 20, tetrises: 460 },
  tetrisLineShare: 1_840 / 1_950,
  strategyDiagnostics: {
    meanCleanWellDepth: 3,
    meanTetrisSetupProgress: 2.5,
    meanTetrisReadyRows: 1,
  },
  survivalDiagnostics: { pieceCapGames: 30, gameoverGames: 0 },
  searchDiagnostics: {
    searchCalls: 10,
    holdActions: 4,
    holdRate: 0.4,
    meanCompletedDepth: 3.3,
    minCompletedDepth: 2,
    completedDepthHistogram: [0, 0, 2, 3, 5],
    totalWorkUnitsUsed: 30_000,
    meanWorkUnitsUsed: 3_000,
    maxWorkUnitsUsed: 3_584,
    budgetExhaustedSearches: 2,
    budgetExhaustionRate: 0.2,
    placementEvaluationUnits: 20_000,
    chanceExpansionUnits: 8_000,
    cacheHitUnits: 2_000,
    expandedDecisionNodes: 12_000,
    expandedChanceNodes: 8_000,
    cacheHits: 2_000,
  },
  gen: 20,
  evalGames: 30,
  evalMaxPieces: 5_000,
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('buildCandidateWeights', () => {
  it('builds an exact version-6 candidate with frozen search metadata and no publication paths', () => {
    expect(buildCandidateWeights(evaluation, 4, '2026-08-11T00:00:00.000Z')).toEqual({
      version: 6,
      weights: fromVector(evaluation.weights),
      objective: 'score-rate-v5',
      meanScore: 3_100_000,
      evalMaxPieces: 5_000,
      meanLines: 1_950,
      meanHeight: 3.5,
      meanClearCounts: { singles: 10, doubles: 20, triples: 20, tetrises: 460 },
      tetrisLineShare: 1_840 / 1_950,
      strategyDiagnostics: {
        meanCleanWellDepth: 3,
        meanTetrisSetupProgress: 2.5,
        meanTetrisReadyRows: 1,
      },
      survivalDiagnostics: { pieceCapGames: 30, gameoverGames: 0 },
      searchDiagnostics: {
        searchCalls: 10,
        holdActions: 4,
        holdRate: 0.4,
        meanCompletedDepth: 3.3,
        minCompletedDepth: 2,
        completedDepthHistogram: [0, 0, 2, 3, 5],
        totalWorkUnitsUsed: 30_000,
        meanWorkUnitsUsed: 3_000,
        maxWorkUnitsUsed: 3_584,
        budgetExhaustedSearches: 2,
        budgetExhaustionRate: 0.2,
        placementEvaluationUnits: 20_000,
        chanceExpansionUnits: 8_000,
        cacheHitUnits: 2_000,
        expandedDecisionNodes: 12_000,
        expandedChanceNodes: 8_000,
        cacheHits: 2_000,
      },
      evalGames: 30,
      gen: 20,
      searchContract: 'bag-expectimax-hold-v2',
      searchDepth: 4,
      rootBeamWidth: 64,
      childBeamWidth: 32,
      maxWorkUnits: 3_584,
      budgetCorpus: 'budget-corpus-v1',
      transpositionCacheEntries: 65_536,
      placementCacheEntries: 16_384,
      trainedAt: '2026-08-11T00:00:00.000Z',
    });
  });

  it('fails closed when the evaluation has no search diagnostics', () => {
    const missingDiagnostics = { ...evaluation } as Partial<ScoreRateEvaluation>;
    delete missingDiagnostics.searchDiagnostics;

    expect(() => buildCandidateWeights(
      missingDiagnostics as ScoreRateEvaluation,
      4,
      '2026-08-11T00:00:00.000Z',
    )).toThrow(/search diagnostics/i);
  });

  it.each([1, 2])('rejects legacy depth %s instead of silently stamping depth four', (depth) => {
    expect(() => buildCandidateWeights(
      evaluation,
      depth as unknown as 4,
      '2026-08-11T00:00:00.000Z',
    )).toThrow(/depth.*4|fixed search/i);
  });
});

describe('writeCandidateWeights', () => {
  it('writes only the resolved run-local candidate path', () => {
    const dir = temp();
    const candidatePath = join(dir, 'run-local-candidate.json');
    const sentinelPath = join(dir, 'published-sentinel.json');
    writeFileSync(sentinelPath, 'do-not-touch');
    const payload = buildCandidateWeights(evaluation, 4, '2026-08-11T00:00:00.000Z');

    writeCandidateWeights(candidatePath, payload);

    expect(JSON.parse(readFileSync(candidatePath, 'utf8'))).toEqual(payload);
    expect(readFileSync(sentinelPath, 'utf8')).toBe('do-not-touch');
  });

  it('rejects an invalid payload before creating a file', () => {
    const path = join(temp(), 'candidate.json');
    const invalid = {
      ...buildCandidateWeights(evaluation, 4, '2026-08-11T00:00:00.000Z'),
      version: 4,
    };

    expect(() => writeCandidateWeights(path, invalid)).toThrow(/version 6|candidate/i);
    expect(existsSync(path)).toBe(false);
  });

  it('rejects an extra top-level key before creating a file', () => {
    const path = join(temp(), 'candidate.json');
    const invalid = {
      ...buildCandidateWeights(evaluation, 4, '2026-08-11T00:00:00.000Z'),
      extra: true,
    };

    expect(() => writeCandidateWeights(path, invalid)).toThrow(/candidate.*schema|extra/i);
    expect(existsSync(path)).toBe(false);
  });

  it.each(['searchContract', 'searchDepth', 'rootBeamWidth', 'childBeamWidth', 'searchDiagnostics'])(
    'rejects a payload missing %s before creating a file',
    (field) => {
      const path = join(temp(), 'candidate.json');
      const invalid = buildCandidateWeights(evaluation, 4, '2026-08-11T00:00:00.000Z') as unknown as Record<string, unknown>;
      Reflect.deleteProperty(invalid, field);

      expect(() => writeCandidateWeights(path, invalid)).toThrow(/version 6|candidate|schema/i);
      expect(existsSync(path)).toBe(false);
    },
  );

  const metadataMutations = [
    ['maxWorkUnits', 3_583],
    ['budgetCorpus', 'budget-corpus-v0'],
    ['transpositionCacheEntries', 65_535],
    ['placementCacheEntries', 16_383],
  ] as const;

  it.each(metadataMutations)('rejects a payload missing %s', (field) => {
    const path = join(temp(), 'candidate.json');
    const invalid = buildCandidateWeights(evaluation, 4, '2026-08-11T00:00:00.000Z') as unknown as Record<string, unknown>;
    Reflect.deleteProperty(invalid, field);
    expect(() => writeCandidateWeights(path, invalid)).toThrow(/version 6|candidate|schema/i);
    expect(existsSync(path)).toBe(false);
  });

  it.each(metadataMutations)('rejects a payload with wrong %s', (field, wrong) => {
    const path = join(temp(), 'candidate.json');
    const invalid = {
      ...buildCandidateWeights(evaluation, 4, '2026-08-11T00:00:00.000Z'),
      [field]: wrong,
    };
    expect(() => writeCandidateWeights(path, invalid)).toThrow(/version 6|candidate|schema/i);
    expect(existsSync(path)).toBe(false);
  });

  it.each(metadataMutations)('rejects an extra key adjacent to %s', (field) => {
    const path = join(temp(), 'candidate.json');
    const invalid = {
      ...buildCandidateWeights(evaluation, 4, '2026-08-11T00:00:00.000Z'),
      [`${field}Extra`]: 1,
    };
    expect(() => writeCandidateWeights(path, invalid)).toThrow(/candidate|schema/i);
    expect(existsSync(path)).toBe(false);
  });

  it.each([
    ['histogram/count mismatch', { completedDepthHistogram: [0, 0, 2, 3, 4] }],
    ['unit category mismatch', { cacheHitUnits: 1_999 }],
    ['work mean mismatch', { meanWorkUnitsUsed: 2_999 }],
    ['hold rate mismatch', { holdRate: 0.3 }],
    ['exhaustion rate mismatch', { budgetExhaustionRate: 0.1 }],
    ['maximum below mean', { maxWorkUnitsUsed: 2_999 }],
    ['maximum above budget', { maxWorkUnitsUsed: 3_585 }],
  ])('rejects inconsistent candidate diagnostics: %s', (_label, mutation) => {
    const path = join(temp(), 'candidate.json');
    const valid = buildCandidateWeights(evaluation, 4, '2026-08-11T00:00:00.000Z');
    const invalid = { ...valid, searchDiagnostics: { ...valid.searchDiagnostics, ...mutation } };
    expect(() => writeCandidateWeights(path, invalid)).toThrow(/candidate|schema/i);
    expect(existsSync(path)).toBe(false);
  });

  it('rejects legacy schema-5 candidate payloads', () => {
    const path = join(temp(), 'candidate.json');
    const invalid = {
      ...buildCandidateWeights(evaluation, 4, '2026-08-11T00:00:00.000Z'),
      version: 5,
    };
    expect(() => writeCandidateWeights(path, invalid)).toThrow(/version 6|candidate/i);
    expect(existsSync(path)).toBe(false);
  });
});
