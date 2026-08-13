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
    holdActions: 900,
    holdRate: 0.15,
    meanCompletedDepth: 3.9,
    minCompletedDepth: 3,
    expandedDecisionNodes: 12_000,
    expandedChanceNodes: 8_000,
    cacheHits: 2_000,
    abortedSearches: 1,
  },
  gen: 20,
  evalGames: 30,
  evalMaxPieces: 5_000,
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('buildCandidateWeights', () => {
  it('builds an exact version-5 candidate with search diagnostics and no publication paths', () => {
    expect(buildCandidateWeights(evaluation, 4, '2026-08-11T00:00:00.000Z')).toEqual({
      version: 5,
      weights: fromVector(evaluation.weights),
      objective: 'score-rate-v4',
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
        holdActions: 900,
        holdRate: 0.15,
        meanCompletedDepth: 3.9,
        minCompletedDepth: 3,
        expandedDecisionNodes: 12_000,
        expandedChanceNodes: 8_000,
        cacheHits: 2_000,
        abortedSearches: 1,
      },
      evalGames: 30,
      gen: 20,
      searchContract: 'bag-expectimax-hold-v1',
      searchDepth: 4,
      rootBeamWidth: 64,
      childBeamWidth: 32,
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

    expect(() => writeCandidateWeights(path, invalid)).toThrow(/version 5|candidate/i);
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

      expect(() => writeCandidateWeights(path, invalid)).toThrow(/version 5|candidate|schema/i);
      expect(existsSync(path)).toBe(false);
    },
  );
});
