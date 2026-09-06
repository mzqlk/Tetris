import {
  digestOf,
  canonicalJson,
  type D2Phase,
  type D2ShardId,
  type D2Stage1Manifest,
} from './d2ShardManifest';

/**
 * Durable evidence store for the D2 diagnostic.
 *
 * Two guarantees, and no more than two.  A receipt is written atomically, so
 * *process death* can never leave a partially written one.  Power loss and
 * filesystem tearing are explicitly out of scope; there is no parent-directory
 * fsync because the frozen `win32-x64` runtime cannot open a directory handle
 * for one, and encoding an unimplementable step would only manufacture a false
 * guarantee.
 */

export interface D2FileSystem {
  readFile(path: string): string | null;
  writeFileSync(path: string, data: string): void;
  fsyncFile(path: string): void;
  rename(from: string, to: string): void;
  /** Append one line with a trailing newline, then fsync the file. */
  appendLine(path: string, line: string): void;
  readdir(path: string): readonly string[];
  mkdirp(path: string): void;
  exists(path: string): boolean;
  /** Create with `wx`; returns false when the path already exists. */
  openExclusive(path: string, data: string): boolean;
  unlink(path: string): void;
}

export type D2EvidenceIntegrityReason =
  | 'manifest-drift' | 'receipt-corrupt' | 'receipt-regression' | 'run-record-corrupt';

export class D2EvidenceIntegrityError extends Error {
  readonly name = 'D2EvidenceIntegrityError';
  constructor(readonly reason: D2EvidenceIntegrityReason) {
    super(`D2 evidence:${reason}`);
  }
}

export const D2_EVIDENCE_ROOT = 'diagnostics';

export function evidenceDir(runId: string): string {
  return `${D2_EVIDENCE_ROOT}/${runId}`;
}

export function receiptPath(dir: string, shardId: D2ShardId): string {
  return `${dir}/receipts/${shardId.replaceAll('/', '__')}.json`;
}

export const runRecordPath = (dir: string): string => `${dir}/run-record.jsonl`;
export const resultPath = (dir: string): string => `${dir}/result.json`;
export const lockPath = (dir: string): string => `${dir}/run.lock`;
export const stage1Path = (dir: string): string => `${dir}/run-manifest.json`;
export const stage2Path = (dir: string): string => `${dir}/run-manifest-stage2.json`;

export interface D2Receipt {
  readonly protocolId: string;
  readonly schemaVersion: 1;
  readonly shardId: D2ShardId;
  readonly phase: D2Phase;
  readonly manifestDigest: string;
  readonly stage2Digest: string | null;
  readonly payload: unknown;
  readonly payloadDigest: string;
  readonly receiptDigest: string;
}

export function buildD2Receipt(input: {
  readonly protocolId: string;
  readonly shardId: D2ShardId;
  readonly phase: D2Phase;
  readonly manifestDigest: string;
  readonly stage2Digest: string | null;
  readonly payload: unknown;
}): D2Receipt {
  const payloadDigest = digestOf(input.payload);
  const withoutSelfDigest = {
    protocolId: input.protocolId,
    schemaVersion: 1 as const,
    shardId: input.shardId,
    phase: input.phase,
    manifestDigest: input.manifestDigest,
    stage2Digest: input.stage2Digest,
    payload: input.payload,
    payloadDigest,
  };
  return Object.freeze({ ...withoutSelfDigest, receiptDigest: digestOf(withoutSelfDigest) });
}

/**
 * Write temp, fsync the file, rename into place.  Nothing else — in
 * particular no parent-directory fsync.
 */
export function writeAtomic(fs: D2FileSystem, path: string, data: string): void {
  const temp = `${path}.tmp`;
  fs.writeFileSync(temp, data);
  fs.fsyncFile(temp);
  fs.rename(temp, path);
}

export function writeReceiptAtomic(fs: D2FileSystem, dir: string, receipt: D2Receipt): void {
  writeAtomic(fs, receiptPath(dir, receipt.shardId), canonicalJson(receipt));
}

function isValidReceipt(value: unknown, stage1: D2Stage1Manifest, manifestDigest: string,
  knownShardIds: ReadonlySet<D2ShardId> | null): value is D2Receipt {
  if (value === null || typeof value !== 'object') return false;
  const receipt = value as Partial<D2Receipt>;
  if (receipt.schemaVersion !== 1) return false;
  if (receipt.protocolId !== stage1.protocolId) return false;
  if (typeof receipt.shardId !== 'string') return false;
  if (knownShardIds !== null && !knownShardIds.has(receipt.shardId)) return false;
  // The phase is derivable from the shard id, so a receipt claiming a
  // different one is inconsistent even though its own digest is self-valid.
  if (receipt.phase !== receipt.shardId.split('/')[0]) return false;
  if (receipt.manifestDigest !== manifestDigest) return false;
  if (typeof receipt.payloadDigest !== 'string' || receipt.payloadDigest !== digestOf(receipt.payload)) return false;
  const { receiptDigest, ...rest } = receipt as D2Receipt;
  return receiptDigest === digestOf(rest);
}

export interface D2ReceiptScan {
  readonly completed: ReadonlySet<D2ShardId>;
  readonly receipts: ReadonlyMap<D2ShardId, D2Receipt>;
}

/**
 * Enumerate and validate receipts.  A receipt that fails validation fails the
 * whole run: atomic writes make partial receipts impossible under process
 * death, so a validation failure means real corruption or tampering, and
 * recomputing it would be indistinguishable from selectively recomputing a
 * result someone did not like.
 */
export function readValidReceipts(input: {
  readonly fs: D2FileSystem;
  readonly dir: string;
  readonly stage1: D2Stage1Manifest;
  readonly manifestDigest: string;
  /**
   * Membership in the manifest can only be checked once the shard id set is
   * complete, i.e. after stage-2 freezes.  Before that, pass `null`: the
   * digest and binding checks still apply, and membership is enforced by the
   * first full scan.  Failing membership early would reject receipts written
   * by an earlier episode that had already progressed past capture.
   */
  readonly knownShardIds: readonly D2ShardId[] | null;
}): D2ReceiptScan {
  const known = input.knownShardIds === null ? null : new Set(input.knownShardIds);
  const receipts = new Map<D2ShardId, D2Receipt>();
  for (const entry of input.fs.readdir(`${input.dir}/receipts`)) {
    if (!entry.endsWith('.json')) continue;
    const raw = input.fs.readFile(`${input.dir}/receipts/${entry}`);
    if (raw === null) continue;
    const expectedFilename = entry.slice(0, -'.json'.length);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new D2EvidenceIntegrityError('receipt-corrupt');
    }
    if (!isValidReceipt(parsed, input.stage1, input.manifestDigest, known)) {
      throw new D2EvidenceIntegrityError('receipt-corrupt');
    }
    // A receipt filed under a name that does not match its own shard id would
    // let one shard's evidence masquerade as another's.
    if (parsed.shardId.replaceAll('/', '__') !== expectedFilename) {
      throw new D2EvidenceIntegrityError('receipt-corrupt');
    }
    if (receipts.has(parsed.shardId)) throw new D2EvidenceIntegrityError('receipt-corrupt');
    receipts.set(parsed.shardId, parsed);
  }
  return { completed: new Set(receipts.keys()), receipts };
}

export type D2TerminationCause =
  | 'completed' | 'episode-incomplete' | 'shard-timeout' | 'no-progress-timeout'
  | 'signal:SIGINT' | 'signal:SIGTERM' | 'uncaught-exception' | 'unhandled-rejection'
  | 'invalid-input' | 'runtime-fail' | 'resume-budget-exhausted'
  | 'barren-episode-budget-exhausted';

export interface D2EpisodeStart {
  readonly kind: 'episode-start';
  readonly episodeOrdinal: number;
  readonly startedAt: string;
  readonly pid: number;
  readonly ppid: number;
  readonly runtimeIdentity: D2Stage1Manifest['runtimeIdentity'];
  readonly workerCount: number;
  readonly manifestDigest: string;
  readonly completedShards: number;
}

export interface D2Heartbeat {
  readonly kind: 'heartbeat';
  readonly episodeOrdinal: number;
  readonly elapsedMs: number;
  readonly completedShards: number;
}

export interface D2EpisodeEnd {
  readonly kind: 'episode-end';
  readonly episodeOrdinal: number;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly terminationCause: D2TerminationCause;
  readonly completedShards: number;
  /** Sole durable carrier of the two-strike promotion rule (spec 5.4.5(b)). */
  readonly failedShardId: D2ShardId | null;
  readonly failureReason: string | null;
  /**
   * The failure's own words, when it had any. `failureReason` is a canonical
   * token chosen from a closed set, so on its own it cannot say *why* — a real
   * run ended `unclassified-failure` at `fit/action24` and the message
   * "optimizer did not converge after 200 updates" survived nowhere at all,
   * leaving the forensic record unable to answer the question 1.2 says it
   * exists for. Excluded from `resultDigest`: only `runProvenance` reads the
   * run record, and only for episode counts and causes.
   */
  readonly failureDetail: string | null;
}

export interface D2EpisodeAbandoned {
  readonly kind: 'episode-abandoned';
  readonly episodeOrdinal: number;
  readonly lastHeartbeatElapsedMs: number | null;
  readonly completedShards: number;
}

export type D2RunRecordEntry = D2EpisodeStart | D2Heartbeat | D2EpisodeEnd | D2EpisodeAbandoned;

export function appendRunRecord(fs: D2FileSystem, dir: string, entry: D2RunRecordEntry): void {
  fs.appendLine(runRecordPath(dir), canonicalJson(entry));
}

/**
 * Parse the append-only run record.  A trailing line that is not valid JSON
 * means the process died mid-write; it is discarded and the file is never
 * rewritten.
 */
export function readRunRecord(fs: D2FileSystem, dir: string): readonly D2RunRecordEntry[] {
  const raw = fs.readFile(runRecordPath(dir));
  if (raw === null) return [];
  const lines = raw.split('\n').filter((line) => line.length > 0);
  const entries: D2RunRecordEntry[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      entries.push(JSON.parse(line) as D2RunRecordEntry);
    } catch {
      // Only a truncated *final* line is a normal consequence of process
      // death. A corrupt line mid-file is real damage, and it is not a receipt,
      // so it gets its own reason rather than a misleading one.
      if (index === lines.length - 1) break;
      throw new D2EvidenceIntegrityError('run-record-corrupt');
    }
  }
  return entries;
}

/**
 * Baseline for the regression check: the highest completed count any durable
 * record has ever reported.
 *
 * Taking the *maximum* rather than the most recent entry is load-bearing.  A
 * clean `episode-end` from episode 1 can appear later in the file than the
 * heartbeats of a SIGKILLed episode 2, so a "last episode-end wins" rule would
 * let the baseline go backwards after exactly the abrupt kill it exists to
 * detect — and every receipt episode 2 completed could then be deleted and
 * recomputed unnoticed.  Completion is monotone, so the maximum is the only
 * baseline consistent with that.
 *
 * The honest limit remains: receipts completed after the final heartbeat of a
 * killed episode were never recorded anywhere, so their deletion is outside
 * any baseline.  That window is bounded by the heartbeat interval.
 */
export function lastCompletedCount(entries: readonly D2RunRecordEntry[]): number {
  let highest = 0;
  for (const entry of entries) {
    if (entry.kind !== 'episode-end' && entry.kind !== 'heartbeat') continue;
    if (entry.completedShards > highest) highest = entry.completedShards;
  }
  return highest;
}

export function lastFailure(
  entries: readonly D2RunRecordEntry[],
): { readonly shardId: D2ShardId; readonly reason: string } | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.kind !== 'episode-end') continue;
    if (entry.failedShardId === null || entry.failureReason === null) continue;
    return { shardId: entry.failedShardId, reason: entry.failureReason };
  }
  return null;
}

export function assertNoReceiptRegression(
  entries: readonly D2RunRecordEntry[],
  observedCompleted: number,
): void {
  if (observedCompleted < lastCompletedCount(entries)) {
    throw new D2EvidenceIntegrityError('receipt-regression');
  }
}

export function unpairedEpisodeOrdinals(entries: readonly D2RunRecordEntry[]): readonly number[] {
  const started = new Set<number>();
  for (const entry of entries) {
    if (entry.kind === 'episode-start') started.add(entry.episodeOrdinal);
    if (entry.kind === 'episode-end' || entry.kind === 'episode-abandoned') {
      started.delete(entry.episodeOrdinal);
    }
  }
  return [...started].sort((left, right) => left - right);
}

export interface D2LockOwner {
  readonly ownerNonce: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly episodeOrdinal: number;
}

export type D2LockOutcome = 'acquired' | 'took-over-dead-lock' | 'blocked';

/**
 * A SIGKILLed episode always leaves the lock behind, so this is the ordinary
 * resume path rather than an exceptional one.  Take-over requires all three
 * pre-registered evidence items; any one missing blocks and defers to an
 * operator.
 */
export function adjudicateRunLock(input: {
  readonly fs: D2FileSystem;
  readonly dir: string;
  readonly entries: readonly D2RunRecordEntry[];
  readonly owner: D2LockOwner;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly anyD2ProcessRunning: () => boolean;
}): D2LockOutcome {
  const path = lockPath(input.dir);
  if (input.fs.openExclusive(path, canonicalJson(input.owner))) return 'acquired';

  const raw = input.fs.readFile(path);
  if (raw === null) return 'blocked';
  let existing: D2LockOwner;
  try {
    existing = JSON.parse(raw) as D2LockOwner;
  } catch {
    return 'blocked';
  }
  const pidDead = !input.isProcessAlive(existing.pid);
  const noD2Process = !input.anyD2ProcessRunning();
  const unpaired = unpairedEpisodeOrdinals(input.entries).includes(existing.episodeOrdinal);
  if (!(pidDead && noD2Process && unpaired)) return 'blocked';

  input.fs.unlink(path);
  if (!input.fs.openExclusive(path, canonicalJson(input.owner))) return 'blocked';
  return 'took-over-dead-lock';
}
