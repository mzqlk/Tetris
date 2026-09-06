import { describe, expect, it } from 'vitest';
import { evidenceDir, resultPath } from './d2Evidence';
import {
  classifyD2Exit,
  exitCodeForStatus,
  shouldPromoteToRuntimeFail,
  writeResultOnce,
  writesResultJson,
  type D2CanonicalStatus,
  type D2ExitClass,
} from './d2Exit';
import { makeMemoryFs } from './d2TestUtils';

const DIR = evidenceDir('d2-testrun');

describe('exit classification', () => {
  it.each([
    ['runtime-identity-mismatch', 'pre-veto'],
    ['seed-schedule-mismatch', 'input-feasibility-veto'],
    ['source-hash-mismatch', 'input-feasibility-veto'],
    ['capture-missing-or-invalid', 'input-feasibility-veto'],
    ['state-fingerprint-mismatch', 'input-feasibility-veto'],
    ['placement-manifest-mismatch', 'input-feasibility-veto'],
    ['manifest-drift', 'evidence-integrity-veto'],
    ['receipt-corrupt', 'evidence-integrity-veto'],
    ['receipt-regression', 'evidence-integrity-veto'],
    ['test-before-freeze', 'terminal-runtime-fail'],
    ['evidence-dir-out-of-bounds', 'terminal-runtime-fail'],
    ['shard-timeout', 'episode-incomplete'],
    ['no-progress-timeout', 'episode-incomplete'],
    ['replay-mismatch', 'episode-incomplete'],
    ['optimizer-failure', 'episode-incomplete'],
    ['run-locked', 'episode-incomplete'],
    ['trainer-lock-present', 'episode-incomplete'],
    ['resume-budget-exhausted', 'episode-incomplete'],
    ['barren-episode-budget-exhausted', 'episode-incomplete'],
  ] as const)('puts %s in class %s', (reason, expected) => {
    expect(classifyD2Exit(reason)).toBe(expected);
  });

  it('defaults an unknown reason to the resumable class, never to a verdict', () => {
    expect(classifyD2Exit('something-nobody-classified')).toBe('episode-incomplete');
    expect(writesResultJson(classifyD2Exit('something-nobody-classified'))).toBe(false);
  });

  it('lets exactly the three veto classes and the aggregate write result.json', () => {
    const writers: D2ExitClass[] = [
      'input-feasibility-veto', 'evidence-integrity-veto', 'terminal-runtime-fail', 'aggregate-verdict',
    ];
    const nonWriters: D2ExitClass[] = ['pre-veto', 'episode-incomplete', 'last-resort'];
    for (const cls of writers) expect(writesResultJson(cls)).toBe(true);
    for (const cls of nonWriters) expect(writesResultJson(cls)).toBe(false);
  });

  it('keeps the pre-veto out of the result-writing set because no directory exists yet', () => {
    expect(classifyD2Exit('runtime-identity-mismatch')).toBe('pre-veto');
    expect(writesResultJson('pre-veto')).toBe(false);
  });
});

describe('exit code', () => {
  it('derives from canonical status, not from a stored field', () => {
    expect(exitCodeForStatus('pass-action-conditioned-listwise-supported')).toBe(0);
    const failing: D2CanonicalStatus[] = [
      'invalid-input', 'runtime-fail',
      'fail-joint-selection-not-shown', 'fail-representation-gain-not-held-out',
    ];
    for (const status of failing) expect(exitCodeForStatus(status)).toBe(1);
  });
});

describe('result.json is write-once', () => {
  it('writes when absent and refuses to overwrite', () => {
    const fs = makeMemoryFs();
    expect(writeResultOnce(fs, DIR, '{"a":1}')).toBe('written');
    expect(fs.readFile(resultPath(DIR))).toBe('{"a":1}');
    expect(writeResultOnce(fs, DIR, '{"a":2}')).toBe('already-exists');
    expect(fs.readFile(resultPath(DIR))).toBe('{"a":1}');
  });

  it('writes atomically', () => {
    const fs = makeMemoryFs();
    writeResultOnce(fs, DIR, '{"a":1}');
    const ops = fs.calls.filter((call) => call.op !== 'exists' && call.op !== 'readFile');
    expect(ops.map((call) => call.op)).toEqual(['writeFileSync', 'fsyncFile', 'rename']);
  });

  it('performs no write at all on the already-exists path', () => {
    const fs = makeMemoryFs({ seed: { [resultPath(DIR)]: '{"a":1}' } });
    writeResultOnce(fs, DIR, '{"a":2}');
    expect(fs.calls.some((call) =>
      call.op === 'writeFileSync' || call.op === 'rename' || call.op === 'unlink')).toBe(false);
  });
});

describe('runtime-fail promotion', () => {
  it('promotes only on the same shard with the same reason', () => {
    expect(shouldPromoteToRuntimeFail(
      { shardId: 'replay/0', reason: 'replay-mismatch' },
      { shardId: 'replay/0', reason: 'replay-mismatch' },
    )).toBe(true);
    expect(shouldPromoteToRuntimeFail(
      { shardId: 'replay/0', reason: 'replay-mismatch' },
      { shardId: 'replay/0', reason: 'optimizer-failure' },
    )).toBe(false);
    expect(shouldPromoteToRuntimeFail(
      { shardId: 'replay/1', reason: 'replay-mismatch' },
      { shardId: 'replay/0', reason: 'replay-mismatch' },
    )).toBe(false);
    expect(shouldPromoteToRuntimeFail(null, { shardId: 'replay/0', reason: 'replay-mismatch' }))
      .toBe(false);
  });

  it('promotes a hard-invariant breach on first detection, with no previous failure', () => {
    expect(shouldPromoteToRuntimeFail(null, { shardId: 'label-test/x', reason: 'test-before-freeze' }))
      .toBe(true);
    expect(shouldPromoteToRuntimeFail(null, { shardId: 'capture/train/0/gen6-best', reason: 'evidence-dir-out-of-bounds' }))
      .toBe(true);
  });
});
