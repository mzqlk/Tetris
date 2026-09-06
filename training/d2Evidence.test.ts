import { describe, expect, it } from 'vitest';
import { D2_PROFILE } from './d2Protocol';
import { buildD2Stage1Manifest, canonicalJson, digestOf, stage1Digest } from './d2ShardManifest';
import {
  D2EvidenceIntegrityError,
  adjudicateRunLock,
  appendRunRecord,
  assertNoReceiptRegression,
  buildD2Receipt,
  evidenceDir,
  lastCompletedCount,
  lastFailure,
  readRunRecord,
  readValidReceipts,
  receiptPath,
  runRecordPath,
  unpairedEpisodeOrdinals,
  writeReceiptAtomic,
  type D2EpisodeEnd,
  type D2LockOwner,
  type D2Receipt,
  type D2RunRecordEntry,
} from './d2Evidence';
import { makeMemoryFs } from './d2TestUtils';

const stage1 = buildD2Stage1Manifest({ profile: D2_PROFILE });
const manifestDigest = stage1Digest(stage1);
const DIR = evidenceDir('d2-testrun');
const SHARD = 'capture/train/0/gen6-best';
const KNOWN = [SHARD, 'capture/train/0/gen10-mu', 'aggregate'];

const receipt = (payload: unknown = { pieces: 512 }, shardId = SHARD): D2Receipt =>
  buildD2Receipt({
    protocolId: stage1.protocolId,
    shardId,
    phase: 'capture',
    manifestDigest,
    stage2Digest: null,
    payload,
  });

const scan = (fs: ReturnType<typeof makeMemoryFs>) =>
  readValidReceipts({ fs, dir: DIR, stage1, manifestDigest, knownShardIds: KNOWN });

describe('atomic receipt write', () => {
  it('writes temp, fsyncs the file, then renames — in that order', () => {
    const fs = makeMemoryFs();
    writeReceiptAtomic(fs, DIR, receipt());
    expect(fs.calls.map((call) => call.op)).toEqual(['writeFileSync', 'fsyncFile', 'rename']);
  });

  it('leaves no receipt when the process dies before rename', () => {
    const fs = makeMemoryFs({ failOn: 'rename' });
    expect(() => writeReceiptAtomic(fs, DIR, receipt())).toThrow(/injected failure/);
    expect(fs.exists(receiptPath(DIR, SHARD))).toBe(false);
    expect(scan(fs).completed.size).toBe(0);
  });

  it('leaves no receipt when the process dies before fsync', () => {
    const fs = makeMemoryFs({ failOn: 'fsyncFile' });
    expect(() => writeReceiptAtomic(fs, DIR, receipt())).toThrow(/injected failure/);
    expect(scan(fs).completed.size).toBe(0);
  });

  it('never fsyncs a directory', () => {
    const fs = makeMemoryFs();
    writeReceiptAtomic(fs, DIR, receipt());
    for (const call of fs.calls) {
      if (call.op !== 'fsyncFile') continue;
      expect(call.path.endsWith('.json.tmp')).toBe(true);
    }
  });

  it('round-trips a written receipt', () => {
    const fs = makeMemoryFs();
    writeReceiptAtomic(fs, DIR, receipt());
    const result = scan(fs);
    expect([...result.completed]).toEqual([SHARD]);
    expect(result.receipts.get(SHARD)!.payload).toEqual({ pieces: 512 });
  });
});

describe('receipt validation', () => {
  const corrupt = (mutate: (value: Record<string, unknown>) => void) => {
    const fs = makeMemoryFs();
    const value = JSON.parse(canonicalJson(receipt())) as Record<string, unknown>;
    mutate(value);
    fs.writeFileSync(receiptPath(DIR, SHARD), JSON.stringify(value));
    return fs;
  };

  it('rejects a receipt whose payloadDigest does not match', () => {
    const fs = corrupt((value) => { value.payload = { pieces: 511 }; });
    expect(() => scan(fs)).toThrow(D2EvidenceIntegrityError);
  });

  it('rejects a receipt whose receiptDigest does not match', () => {
    const fs = corrupt((value) => { value.receiptDigest = digestOf('wrong'); });
    expect(() => scan(fs)).toThrow(/receipt-corrupt/);
  });

  it('rejects a receipt bound to a different manifestDigest', () => {
    const fs = corrupt((value) => { value.manifestDigest = digestOf('other-run'); });
    expect(() => scan(fs)).toThrow(/receipt-corrupt/);
  });

  it('rejects a shardId absent from the manifest', () => {
    const fs = makeMemoryFs();
    fs.writeFileSync(receiptPath(DIR, 'capture/train/99/gen6-best'),
      canonicalJson(receipt({ pieces: 512 }, 'capture/train/99/gen6-best')));
    expect(() => scan(fs)).toThrow(/receipt-corrupt/);
  });

  it('rejects malformed JSON', () => {
    const fs = makeMemoryFs();
    fs.writeFileSync(receiptPath(DIR, SHARD), '{not json');
    expect(() => scan(fs)).toThrow(/receipt-corrupt/);
  });

  it('never recomputes or rewrites a receipt that fails validation', () => {
    const fs = corrupt((value) => { value.payload = { pieces: 0 }; });
    const before = fs.calls.length;
    expect(() => scan(fs)).toThrow();
    const afterWrites = fs.calls.slice(before).filter((call) =>
      call.op === 'writeFileSync' || call.op === 'rename' || call.op === 'unlink');
    expect(afterWrites).toHaveLength(0);
  });

  it('ignores leftover temp files', () => {
    const fs = makeMemoryFs();
    fs.writeFileSync(`${receiptPath(DIR, SHARD)}.tmp`, 'partial');
    expect(scan(fs).completed.size).toBe(0);
  });
});

describe('run record', () => {
  const start = (episodeOrdinal: number, completedShards: number): D2RunRecordEntry => ({
    kind: 'episode-start',
    episodeOrdinal,
    startedAt: '2026-09-02T00:00:00.000Z',
    pid: 4242,
    ppid: 1,
    runtimeIdentity: stage1.runtimeIdentity,
    workerCount: 4,
    manifestDigest,
    completedShards,
  });
  const end = (over: Partial<D2EpisodeEnd> = {}): D2EpisodeEnd => ({
    kind: 'episode-end',
    episodeOrdinal: 1,
    endedAt: '2026-09-02T00:10:00.000Z',
    durationMs: 600_000,
    exitCode: 1,
    terminationCause: 'episode-incomplete',
    completedShards: 5,
    failedShardId: null,
    failureReason: null,
    failureDetail: null,
    ...over,
  });

  it('appends without rename and fsyncs each line', () => {
    const fs = makeMemoryFs();
    appendRunRecord(fs, DIR, start(1, 0));
    appendRunRecord(fs, DIR, end());
    expect(fs.calls.map((call) => call.op)).toEqual(['appendLine', 'appendLine']);
    expect(readRunRecord(fs, DIR)).toHaveLength(2);
  });

  it('discards a truncated trailing line and never rewrites the file', () => {
    const fs = makeMemoryFs({
      seed: { [runRecordPath(DIR)]: `${canonicalJson(start(1, 0))}\n{"kind":"heart` },
    });
    expect(readRunRecord(fs, DIR)).toHaveLength(1);
    expect(fs.calls.some((call) =>
      call.op === 'writeFileSync' && call.path === runRecordPath(DIR))).toBe(false);
  });

  it('never lets the baseline go backwards after a killed episode', () => {
    // Regression: a "last episode-end wins" rule would return 10 here, letting
    // every receipt episode 2 completed be deleted undetected — after exactly
    // the abrupt kill the baseline exists to detect.
    expect(lastCompletedCount([
      end({ episodeOrdinal: 1, completedShards: 10 }),
      start(2, 10),
      { kind: 'heartbeat', episodeOrdinal: 2, elapsedMs: 30_000, completedShards: 40 },
    ])).toBe(40);
  });

  it('reports the completed-count baseline as episode-end, else heartbeat, else 0', () => {
    expect(lastCompletedCount([])).toBe(0);
    expect(lastCompletedCount([
      start(1, 0),
      { kind: 'heartbeat', episodeOrdinal: 1, elapsedMs: 30_000, completedShards: 7 },
    ])).toBe(7);
    expect(lastCompletedCount([
      start(1, 0),
      { kind: 'heartbeat', episodeOrdinal: 1, elapsedMs: 30_000, completedShards: 7 },
      end({ completedShards: 9 }),
    ])).toBe(9);
  });

  it('carries failedShardId and failureReason on a failure-ended episode', () => {
    const fs = makeMemoryFs();
    appendRunRecord(fs, DIR, end({ failedShardId: 'replay/0', failureReason: 'replay-mismatch' }));
    const entries = readRunRecord(fs, DIR);
    expect(lastFailure(entries)).toEqual({ shardId: 'replay/0', reason: 'replay-mismatch' });
  });

  it('returns the most recent failure even when a clean episode intervened', () => {
    const entries: D2RunRecordEntry[] = [
      end({ episodeOrdinal: 1, failedShardId: 'replay/0', failureReason: 'replay-mismatch' }),
      end({ episodeOrdinal: 2, failedShardId: null, failureReason: null }),
    ];
    expect(lastFailure(entries)).toEqual({ shardId: 'replay/0', reason: 'replay-mismatch' });
  });

  it('tracks unpaired episode starts', () => {
    expect(unpairedEpisodeOrdinals([start(1, 0), end({ episodeOrdinal: 1 })])).toEqual([]);
    expect(unpairedEpisodeOrdinals([start(1, 0)])).toEqual([1]);
    expect(unpairedEpisodeOrdinals([
      start(1, 0), end({ episodeOrdinal: 1 }), start(2, 5),
    ])).toEqual([2]);
  });
});

describe('receipt regression', () => {
  it('fails closed when the completed count drops below the recorded baseline', () => {
    const entries: D2RunRecordEntry[] = [{
      kind: 'episode-end',
      episodeOrdinal: 1,
      endedAt: '2026-09-02T00:10:00.000Z',
      durationMs: 1,
      exitCode: 1,
      terminationCause: 'episode-incomplete',
      completedShards: 9,
      failedShardId: null,
      failureReason: null,
      failureDetail: null,
    }];
    expect(() => assertNoReceiptRegression(entries, 8)).toThrow(/receipt-regression/);
    expect(() => assertNoReceiptRegression(entries, 9)).not.toThrow();
    expect(() => assertNoReceiptRegression(entries, 10)).not.toThrow();
  });
});

describe('run lock adjudication', () => {
  const owner: D2LockOwner = {
    ownerNonce: 'nonce-b', pid: 999, startedAt: '2026-09-02T01:00:00.000Z', episodeOrdinal: 2,
  };
  const heldBy = (episodeOrdinal: number) => canonicalJson({
    ownerNonce: 'nonce-a', pid: 4242, startedAt: '2026-09-02T00:00:00.000Z', episodeOrdinal,
  });
  const unpairedEntries: readonly D2RunRecordEntry[] = [{
    kind: 'episode-start',
    episodeOrdinal: 1,
    startedAt: '2026-09-02T00:00:00.000Z',
    pid: 4242,
    ppid: 1,
    runtimeIdentity: stage1.runtimeIdentity,
    workerCount: 4,
    manifestDigest,
    completedShards: 0,
  }];

  const adjudicate = (over: {
    seedLock?: boolean; alive?: boolean; running?: boolean; entries?: readonly D2RunRecordEntry[];
  } = {}) => {
    const fs = makeMemoryFs(over.seedLock === false
      ? {}
      : { seed: { [`${DIR}/run.lock`]: heldBy(1) } });
    return {
      fs,
      outcome: adjudicateRunLock({
        fs,
        dir: DIR,
        entries: over.entries ?? unpairedEntries,
        owner,
        isProcessAlive: () => over.alive ?? false,
        anyD2ProcessRunning: () => over.running ?? false,
      }),
    };
  };

  it('acquires a free lock', () => {
    expect(adjudicate({ seedLock: false }).outcome).toBe('acquired');
  });

  it('takes over only when all three evidence items hold', () => {
    const { fs, outcome } = adjudicate();
    expect(outcome).toBe('took-over-dead-lock');
    expect(fs.readFile(`${DIR}/run.lock`)).toBe(canonicalJson(owner));
  });

  it('blocks when the pid is still alive', () => {
    const { fs, outcome } = adjudicate({ alive: true });
    expect(outcome).toBe('blocked');
    expect(fs.calls.some((call) => call.op === 'unlink')).toBe(false);
  });

  it('blocks when a D2 process is running', () => {
    expect(adjudicate({ running: true }).outcome).toBe('blocked');
  });

  it('blocks when the episode already has a paired episode-end', () => {
    const entries: readonly D2RunRecordEntry[] = [
      ...unpairedEntries,
      {
        kind: 'episode-end',
        episodeOrdinal: 1,
        endedAt: '2026-09-02T00:05:00.000Z',
        durationMs: 1,
        exitCode: 1,
        terminationCause: 'episode-incomplete',
        completedShards: 0,
        failedShardId: null,
        failureReason: null,
        failureDetail: null,
      },
    ];
    const { fs, outcome } = adjudicate({ entries });
    expect(outcome).toBe('blocked');
    expect(fs.calls.some((call) => call.op === 'unlink')).toBe(false);
  });
});
