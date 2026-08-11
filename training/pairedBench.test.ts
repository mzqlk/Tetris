import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parsePairedBenchArgs } from './pairedBench';

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
});

describe('pairedBench module', () => {
  it('does not execute the CLI when imported', () => {
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', "await import('./training/pairedBench.ts')"],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(output).toBe('');
  });
});
