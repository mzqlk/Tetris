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
  it('does not execute the CLI when imported', () => {
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', "await import('./training/pairedBench.ts')"],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(output).toBe('');
  });
});
