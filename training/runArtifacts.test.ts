import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FEATURE_COUNT } from '../src/ai/features';
import { initCem, updateCem } from './cem';
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

const meanClearCounts = {
  singles: 10,
  doubles: 20,
  triples: 20,
  tetrises: 460,
};

const validCheckpoint = () => ({
  version: 3,
  objective: 'score-rate-v2',
  gen: 2,
  mu: unitVector(),
  sigma: Array(FEATURE_COUNT).fill(1),
  baseSeed: DEFAULT_CONFIG.baseSeed,
  maxPieces: 1200,
  config: { ...DEFAULT_CONFIG },
  bestEver: {
    weights: unitVector(),
    meanScore: 25000,
    scoreRate: 5,
    meanLines: 1950,
    meanHeight: 3.5,
    meanClearCounts: { ...meanClearCounts },
    tetrisLineShare: (4 * 460) / 1950,
    gen: 1,
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
    expect(paths.outputDir.replaceAll('\\', '/')).toBe('D:/repo/public/ai/score-rate-v2');
  });
});

describe('readCompatibleCheckpoint', () => {
  it('accepts the current checkpoint schema and objective', () => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(validCheckpoint()));
    expect(readCompatibleCheckpoint(path)).toMatchObject({
      version: 3,
      objective: 'score-rate-v2',
      gen: 2,
      config: { reevalGames: 30, reevalMaxPieces: 5000 },
      bestEver: { meanScore: 25000, scoreRate: 5 },
    });
  });

  it('round-trips the non-unit arithmetic centroid produced by updateCem', () => {
    const first = unitVector();
    const second = [0, 1, ...Array(FEATURE_COUNT - 2).fill(0)];
    const state = updateCem(initCem(), [first, second], [1, 1], {
      eliteFrac: 1,
      noise: 0.01,
    });
    expect(Math.hypot(...state.mu)).toBeCloseTo(Math.SQRT1_2, 12);

    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify({
      ...validCheckpoint(),
      gen: state.gen,
      mu: state.mu,
      sigma: state.sigma,
    }));

    expect(readCompatibleCheckpoint(path)).toMatchObject({
      gen: state.gen,
      mu: state.mu,
      sigma: state.sigma,
    });
  });

  it.each([
    [{ version: 1 }, 'missing'],
    [{ version: 2, objective: 'lines-height-v1' }, 'lines-height-v1'],
  ])('rejects an incompatible checkpoint before resume: %j', (checkpoint, label) => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(new RegExp(`${label}.*score-rate-v2`));
  });

  it('preserves the current version mismatch error after the objective matches', () => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify({ ...validCheckpoint(), version: 2 }));
    expect(() => readCompatibleCheckpoint(path)).toThrow(
      /checkpoint schema 2 is incompatible with version 3/,
    );
  });

  it('rejects the old objective before reading the rest of the checkpoint', () => {
    const path = join(temp(), 'checkpoint.json');
    const checkpoint = validCheckpoint();
    checkpoint.version = 2 as 3;
    checkpoint.objective = 'score-rate-v1' as 'score-rate-v2';
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(/score-rate-v1.*score-rate-v2/);
  });

  it('rejects an inconsistent tetris share', () => {
    const path = join(temp(), 'checkpoint.json');
    const checkpoint = validCheckpoint();
    checkpoint.bestEver.tetrisLineShare = 0;
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(/tetrisLineShare/);
  });

  it('rejects mean lines inconsistent with clear counts', () => {
    const path = join(temp(), 'checkpoint.json');
    const checkpoint = validCheckpoint();
    checkpoint.bestEver.meanLines = 1949;
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(/meanLines/);
  });

  it.each([
    ['a missing clear-count key', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      delete (checkpoint.bestEver.meanClearCounts as Partial<typeof meanClearCounts>).triples;
    }],
    ['an extra clear-count key', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      (checkpoint.bestEver.meanClearCounts as typeof meanClearCounts & { extra: number }).extra = 0;
    }],
    ['a negative clear count', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.bestEver.meanClearCounts.singles = -1;
    }],
    ['a non-finite clear count', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.bestEver.meanClearCounts.doubles = Number.NaN;
    }],
  ])('rejects %s', (_label, mutate) => {
    const path = join(temp(), 'checkpoint.json');
    const checkpoint = validCheckpoint();
    mutate(checkpoint);
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(/meanClearCounts/);
  });

  it.each([
    ['mu length', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.mu = checkpoint.mu.slice(1);
    }],
    ['mu element', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.mu[2] = Number.NaN;
    }],
    ['sigma element', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.sigma[2] = null as unknown as number;
    }],
    ['zero sigma', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.sigma[2] = 0;
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
  ])('rejects a correctly tagged v3 checkpoint with malformed %s', (_label, mutate) => {
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
