import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FEATURE_COUNT } from '../src/ai/features';
import { DEFAULT_CONFIG } from './config';
import {
  assertFreshRun,
  readCompatibleCheckpoint,
  resolveRunPaths,
} from './runArtifacts';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tetris-score-rate-'));
  dirs.push(dir);
  return dir;
};

const unitVector = () => [1, ...Array(FEATURE_COUNT - 1).fill(0)];

const validCheckpoint = () => ({
  version: 2,
  objective: 'score-rate-v1',
  gen: 4,
  mu: Array(FEATURE_COUNT).fill(0),
  sigma: Array(FEATURE_COUNT).fill(1),
  baseSeed: DEFAULT_CONFIG.baseSeed,
  maxPieces: 1200,
  config: { ...DEFAULT_CONFIG },
  bestEver: {
    weights: unitVector(),
    meanScore: 25000,
    scoreRate: 5,
    meanLines: 1998,
    meanHeight: 3.5,
    gen: 3,
    evalGames: 30,
    evalMaxPieces: 5000,
  },
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolveRunPaths', () => {
  it('defaults to the versioned score-rate directory', () => {
    const paths = resolveRunPaths('D:/repo', null);
    expect(paths.outputDir.replaceAll('\\', '/')).toBe('D:/repo/public/ai/score-rate-v1');
  });
});

describe('readCompatibleCheckpoint', () => {
  it('accepts the current checkpoint schema and objective', () => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(validCheckpoint()));
    expect(readCompatibleCheckpoint(path)).toMatchObject({
      version: 2,
      objective: 'score-rate-v1',
      gen: 4,
      config: { reevalGames: 30, reevalMaxPieces: 5000 },
      bestEver: { meanScore: 25000, scoreRate: 5 },
    });
  });

  it.each([
    [{ version: 1 }, 'missing'],
    [{ version: 2, objective: 'lines-height-v1' }, 'lines-height-v1'],
  ])('rejects an incompatible checkpoint before resume: %j', (checkpoint, label) => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(new RegExp(`${label}.*score-rate-v1`));
  });

  it('preserves the current version mismatch error after the objective matches', () => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify({ ...validCheckpoint(), version: 1 }));
    expect(() => readCompatibleCheckpoint(path)).toThrow(
      /checkpoint schema 1 is incompatible with version 2/,
    );
  });

  it.each([
    ['mu length', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.mu = checkpoint.mu.slice(1);
    }],
    ['sigma element', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.sigma[2] = null as unknown as number;
    }],
    ['generation', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.gen = -1;
    }],
    ['base seed', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.baseSeed = 1.5;
    }],
    ['scheduled maxPieces', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.maxPieces = 0;
    }],
    ['config field', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.config.population = 0;
    }],
    ['publication games', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.config.reevalGames = 29;
    }],
    ['bestEver weights', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.bestEver.weights = Array(FEATURE_COUNT).fill(1);
    }],
    ['bestEver score record', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.bestEver.meanScore = null as unknown as number;
    }],
    ['bestEver score rate', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.bestEver.scoreRate = 4;
    }],
    ['bestEver publication schedule', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.bestEver.evalMaxPieces = 4999;
    }],
  ])('rejects a correctly tagged v2 checkpoint with malformed %s', (_label, mutate) => {
    const path = join(temp(), 'checkpoint.json');
    const checkpoint = validCheckpoint();
    mutate(checkpoint);
    writeFileSync(path, JSON.stringify(checkpoint));

    expect(() => readCompatibleCheckpoint(path)).toThrow(/checkpoint/);
  });
});

describe('assertFreshRun', () => {
  it('rejects an existing checkpoint', () => {
    const paths = resolveRunPaths(temp(), '.');
    writeFileSync(paths.checkpoint, '{}');
    expect(() => assertFreshRun(paths)).toThrow(/checkpoint/);
  });

  it('rejects a non-empty existing log', () => {
    const paths = resolveRunPaths(temp(), '.');
    writeFileSync(paths.log, '{"gen":0}\n');
    expect(() => assertFreshRun(paths)).toThrow(/training-log/);
  });
});
