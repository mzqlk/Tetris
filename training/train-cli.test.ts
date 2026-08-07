import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT } from '../src/ai/features';
import { DEFAULT_CONFIG } from './config';

const ROOT = resolve(import.meta.dirname, '..');

describe('train --resume objective gate', () => {
  it('rejects a score-rate-v1 checkpoint before workers or writes', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'tetris-old-checkpoint-'));
    const checkpointPath = join(outputDir, 'checkpoint.json');
    const logPath = join(outputDir, 'training-log.jsonl');
    try {
      writeFileSync(checkpointPath, JSON.stringify({
        version: 2,
        objective: 'score-rate-v1',
      }));
      writeFileSync(logPath, '{"sentinel":true}\n');
      const beforeEntries = readdirSync(outputDir).sort();
      const beforeCheckpoint = readFileSync(checkpointPath);
      const beforeLog = readFileSync(logPath);

      const result = spawnSync(process.execPath, [
        '--import', 'tsx',
        resolve(ROOT, 'training/train.ts'),
        '--resume',
        '--output-dir', outputDir,
      ], { cwd: ROOT, encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(
        /score-rate-v1.*score-rate-v2/,
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/training with .* workers/);
      expect(readdirSync(outputDir).sort()).toEqual(beforeEntries);
      expect(readFileSync(checkpointPath)).toEqual(beforeCheckpoint);
      expect(readFileSync(logPath)).toEqual(beforeLog);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('rejects a malformed tagged v2 checkpoint before workers or writes', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'tetris-malformed-checkpoint-'));
    const checkpointPath = join(outputDir, 'checkpoint.json');
    const logPath = join(outputDir, 'training-log.jsonl');
    try {
      writeFileSync(checkpointPath, JSON.stringify({
        version: 3,
        objective: 'score-rate-v2',
        gen: 0,
        mu: Array(FEATURE_COUNT - 1).fill(0),
        sigma: Array(FEATURE_COUNT).fill(1),
        baseSeed: DEFAULT_CONFIG.baseSeed,
        maxPieces: DEFAULT_CONFIG.initialMaxPieces,
        config: { ...DEFAULT_CONFIG },
        bestEver: null,
      }));
      writeFileSync(logPath, '{"sentinel":true}\n');
      const beforeEntries = readdirSync(outputDir).sort();
      const beforeCheckpoint = readFileSync(checkpointPath);
      const beforeLog = readFileSync(logPath);

      const result = spawnSync(process.execPath, [
        '--import', 'tsx',
        resolve(ROOT, 'training/train.ts'),
        '--resume',
        '--generations', '0',
        '--workers', '1',
        '--output-dir', outputDir,
      ], { cwd: ROOT, encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/training with .* workers/);
      expect(readdirSync(outputDir).sort()).toEqual(beforeEntries);
      expect(readFileSync(checkpointPath)).toEqual(beforeCheckpoint);
      expect(readFileSync(logPath)).toEqual(beforeLog);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
