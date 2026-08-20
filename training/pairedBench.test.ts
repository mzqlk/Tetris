import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { HANDCRAFTED_WEIGHTS, type WeightsFile } from '../src/ai/weights';
import { SEARCH_METADATA } from './objective';
import { buildPairedPlan, parsePairedBenchArgs } from './pairedBench';

const EXPECTED_SEARCH_METADATA = {
  searchContract: 'bag-expectimax-hold-v2',
  searchDepth: 4,
  rootBeamWidth: 64,
  childBeamWidth: 32,
  maxWorkUnits: 3584,
  budgetCorpus: 'budget-corpus-v1',
  transpositionCacheEntries: 65_536,
  placementCacheEntries: 16_384,
} as const;
const EXPECTED_SEARCH_METADATA_KEYS = [
  'searchContract', 'searchDepth', 'rootBeamWidth', 'childBeamWidth',
  'maxWorkUnits', 'budgetCorpus', 'transpositionCacheEntries',
  'placementCacheEntries',
] as const;

function validBaseline(): WeightsFile {
  return {
    version: 3,
    weights: { ...HANDCRAFTED_WEIGHTS },
    objective: 'score-rate-v2',
    meanScore: 3_289_243.33,
    evalMaxPieces: 5000,
    meanLines: 1900,
    meanHeight: 4.08,
    meanClearCounts: { singles: 1000, doubles: 300, triples: 60, tetrises: 30 },
    tetrisLineShare: 120 / 1900,
    evalGames: 30,
    gen: 40,
    searchDepth: 2,
    trainedAt: '2026-08-11T00:00:00.000Z',
    strategyDiagnostics: null,
    survivalDiagnostics: null,
  };
}

function validCandidate(): WeightsFile {
  return {
    version: 6,
    weights: { ...HANDCRAFTED_WEIGHTS },
    objective: 'score-rate-v5',
    meanScore: 3_500_000,
    evalMaxPieces: 5000,
    meanLines: 2360,
    meanHeight: 3,
    meanClearCounts: { singles: 800, doubles: 300, triples: 40, tetrises: 210 },
    tetrisLineShare: 840 / 2360,
    evalGames: 30,
    gen: 10,
    ...EXPECTED_SEARCH_METADATA,
    searchDiagnostics: {
      searchCalls: 1500,
      holdActions: 100,
      holdRate: 1 / 15,
      meanCompletedDepth: 4,
      minCompletedDepth: 4,
      completedDepthHistogram: [0, 0, 0, 0, 1500],
      totalWorkUnitsUsed: 150_000,
      meanWorkUnitsUsed: 100,
      maxWorkUnitsUsed: 100,
      budgetExhaustedSearches: 0,
      budgetExhaustionRate: 0,
      placementEvaluationUnits: 75_000,
      chanceExpansionUnits: 50_000,
      cacheHitUnits: 25_000,
      expandedDecisionNodes: 1000,
      expandedChanceNodes: 500,
      cacheHits: 50,
    },
    trainedAt: '2026-08-12T00:00:00.000Z',
    strategyDiagnostics: {
      meanCleanWellDepth: 3,
      meanTetrisSetupProgress: 2,
      meanTetrisReadyRows: 1,
    },
    survivalDiagnostics: { pieceCapGames: 30, gameoverGames: 0 },
  };
}

describe('parsePairedBenchArgs', () => {
  it('parses the required baseline, candidate, and seed arguments', () => {
    expect(parsePairedBenchArgs([
      '--baseline', 'baseline.json',
      '--candidate', 'candidate.json',
      '--seed', '20260811',
    ])).toEqual({
      baseline: 'baseline.json',
      candidate: 'candidate.json',
      seed: 20260811,
    });
  });

  it('rejects a missing candidate', () => {
    expect(() => parsePairedBenchArgs(['--baseline', 'a.json'])).toThrow(/candidate/);
  });

  it('rejects unknown flags instead of accepting a variable schedule', () => {
    expect(() => parsePairedBenchArgs([
      '--baseline', 'a.json', '--candidate', 'b.json', '--games', '5',
    ])).toThrow(/unknown flag/);
  });

  it.each([
    ['baseline', ['--baseline', 'a.json', '--baseline', 'b.json', '--candidate', 'c.json', '--seed', '1']],
    ['candidate', ['--baseline', 'a.json', '--candidate', 'b.json', '--candidate', 'c.json', '--seed', '1']],
    ['seed', ['--baseline', 'a.json', '--candidate', 'b.json', '--seed', '1', '--seed', '2']],
  ])('rejects a duplicate %s flag', (_flag, argv) => {
    expect(() => parsePairedBenchArgs(argv)).toThrow(/duplicate/);
  });

  it('rejects a flag token where a baseline path is required', () => {
    expect(() => parsePairedBenchArgs([
      '--baseline', '--candidate', 'candidate.json', '--seed', '1',
    ])).toThrow(/missing value for --baseline/);
  });

  it.each(['', '   '])('rejects an empty seed value %j', (seed) => {
    expect(() => parsePairedBenchArgs([
      '--baseline', 'baseline.json', '--candidate', 'candidate.json', '--seed', seed,
    ])).toThrow(/missing value for --seed/);
  });

  it('rejects a seed that is not integer text', () => {
    expect(() => parsePairedBenchArgs([
      '--baseline', 'baseline.json', '--candidate', 'candidate.json', '--seed', '1e3',
    ])).toThrow(/integer/);
  });

  it('rejects an unsafe integer seed', () => {
    expect(() => parsePairedBenchArgs([
      '--baseline', 'baseline.json', '--candidate', 'candidate.json', '--seed', '9007199254740992',
    ])).toThrow(/safe integer/);
  });
});

describe('pairedBench module', () => {
  it('uses one implicit shared search contract for both paired sides', () => {
    const plan = buildPairedPlan(validBaseline(), validCandidate(), 20260812);

    expect(plan).toMatchObject({ maxPieces: 5000 });
    expect(plan.seeds).toHaveLength(30);
    expect(new Set(plan.seeds)).toHaveLength(30);
    expect(SEARCH_METADATA).toEqual(EXPECTED_SEARCH_METADATA);
    expect(Object.keys(SEARCH_METADATA)).toEqual(EXPECTED_SEARCH_METADATA_KEYS);
    expect(plan.searchMetadata).toEqual(EXPECTED_SEARCH_METADATA);
    expect(plan.baseline).not.toHaveProperty('search');
    expect(plan.candidate).not.toHaveProperty('search');
  });

  it('rejects a candidate with mismatched search metadata', () => {
    expect(() => buildPairedPlan(validBaseline(), {
      ...validCandidate(),
      childBeamWidth: 16,
    } as unknown as WeightsFile, 20260812)).toThrow(/search metadata|version 6/i);
  });

  it('rejects baseline metadata other than the historical v3 gen-40 model', () => {
    expect(() => buildPairedPlan({
      ...validBaseline(),
      gen: 20,
    }, validCandidate(), 20260812)).toThrow(/baseline.*gen 40/i);
  });

  it('does not execute the CLI when imported', () => {
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', "await import('./training/pairedBench.ts')"],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(output).toBe('');
  });
});
