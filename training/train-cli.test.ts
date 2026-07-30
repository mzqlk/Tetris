import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

describe('train --resume objective gate', () => {
  it('rejects a lines-height checkpoint before worker startup', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'tetris-old-checkpoint-'));
    try {
      writeFileSync(join(outputDir, 'checkpoint.json'), JSON.stringify({
        version: 1,
        objective: 'lines-height-v1',
      }));

      const result = spawnSync(process.execPath, [
        '--import', 'tsx',
        resolve(ROOT, 'training/train.ts'),
        '--resume',
        '--output-dir', outputDir,
      ], { cwd: ROOT, encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(
        /lines-height-v1.*score-rate-v1/,
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/training with .* workers/);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
