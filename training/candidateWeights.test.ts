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
  gen: 20,
  evalGames: 30,
  evalMaxPieces: 5_000,
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('buildCandidateWeights', () => {
  it('builds an exact version-4 candidate without publication paths', () => {
    expect(buildCandidateWeights(evaluation, 2, '2026-08-11T00:00:00.000Z')).toEqual({
      version: 4,
      weights: fromVector(evaluation.weights),
      objective: 'score-rate-v3',
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
      evalGames: 30,
      gen: 20,
      searchDepth: 2,
      trainedAt: '2026-08-11T00:00:00.000Z',
    });
  });
});

describe('writeCandidateWeights', () => {
  it('writes only the resolved run-local candidate path', () => {
    const dir = temp();
    const candidatePath = join(dir, 'run-local-candidate.json');
    const sentinelPath = join(dir, 'published-sentinel.json');
    writeFileSync(sentinelPath, 'do-not-touch');
    const payload = buildCandidateWeights(evaluation, 2, '2026-08-11T00:00:00.000Z');

    writeCandidateWeights(candidatePath, payload);

    expect(JSON.parse(readFileSync(candidatePath, 'utf8'))).toEqual(payload);
    expect(readFileSync(sentinelPath, 'utf8')).toBe('do-not-touch');
  });

  it('rejects an invalid payload before creating a file', () => {
    const path = join(temp(), 'candidate.json');
    const invalid = {
      ...buildCandidateWeights(evaluation, 2, '2026-08-11T00:00:00.000Z'),
      version: 3,
    };

    expect(() => writeCandidateWeights(path, invalid)).toThrow(/version 4|candidate/i);
    expect(existsSync(path)).toBe(false);
  });

  it('rejects an extra top-level key before creating a file', () => {
    const path = join(temp(), 'candidate.json');
    const invalid = {
      ...buildCandidateWeights(evaluation, 2, '2026-08-11T00:00:00.000Z'),
      extra: true,
    };

    expect(() => writeCandidateWeights(path, invalid)).toThrow(/candidate.*schema|extra/i);
    expect(existsSync(path)).toBe(false);
  });
});
