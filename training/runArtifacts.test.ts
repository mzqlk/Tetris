import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
    writeFileSync(path, JSON.stringify({ version: 2, objective: 'score-rate-v1' }));
    expect(readCompatibleCheckpoint(path)).toMatchObject({
      version: 2,
      objective: 'score-rate-v1',
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
