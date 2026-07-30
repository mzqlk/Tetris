import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCORE_RATE_OBJECTIVE } from './objective';

export interface RunPaths {
  outputDir: string;
  checkpoint: string;
  log: string;
}

export function resolveRunPaths(root: string, requested: string | null): RunPaths {
  const outputDir = resolve(root, requested ?? 'public/ai/score-rate-v1');
  return {
    outputDir,
    checkpoint: resolve(outputDir, 'checkpoint.json'),
    log: resolve(outputDir, 'training-log.jsonl'),
  };
}

export function assertFreshRun(paths: RunPaths): void {
  if (existsSync(paths.checkpoint)) {
    throw new Error(`refusing to overwrite existing checkpoint at ${paths.checkpoint}; use --resume or another --output-dir`);
  }
  if (existsSync(paths.log) && statSync(paths.log).size > 0) {
    throw new Error(`refusing to append to existing training-log at ${paths.log}; use --resume or another --output-dir`);
  }
}

export function readCompatibleCheckpoint(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof value !== 'object' || value === null) {
    throw new Error(`checkpoint at ${path} is not an object`);
  }
  const checkpoint = value as Record<string, unknown>;
  const objective = typeof checkpoint.objective === 'string'
    ? checkpoint.objective
    : 'missing';
  if (objective !== SCORE_RATE_OBJECTIVE) {
    throw new Error(`checkpoint objective ${objective} is incompatible with ${SCORE_RATE_OBJECTIVE}`);
  }
  if (checkpoint.version !== 2) {
    throw new Error(`checkpoint schema ${String(checkpoint.version)} is incompatible with version 2`);
  }
  return checkpoint;
}
