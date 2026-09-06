import { resultPath, writeAtomic, type D2FileSystem } from './d2Evidence';
import type { D2ShardId } from './d2ShardManifest';

/**
 * Exit projections.
 *
 * The single most dangerous confusion in a resumable diagnostic is letting an
 * infrastructure hiccup read as a scientific verdict.  Seven mutually
 * exclusive classes keep them apart, and only three of them may write
 * `result.json`.
 */

export type D2ExitClass =
  | 'pre-veto'
  | 'episode-incomplete'
  | 'input-feasibility-veto'
  | 'evidence-integrity-veto'
  | 'terminal-runtime-fail'
  | 'aggregate-verdict'
  | 'last-resort';

export type D2CanonicalStatus =
  | 'invalid-input'
  | 'runtime-fail'
  | 'fail-joint-selection-not-shown'
  | 'fail-representation-gain-not-held-out'
  | 'pass-action-conditioned-listwise-supported';

const CLASS_BY_REASON: Readonly<Record<string, D2ExitClass>> = Object.freeze({
  // (0) pre-veto — checked before any runId is derived, so no directory exists
  'runtime-identity-mismatch': 'pre-veto',

  // (2) input-feasibility veto — determined by the frozen inputs, reproduces
  // identically on every resume, even though several are only detectable
  // during capture execution or stage-2 derivation
  'seed-schedule-mismatch': 'input-feasibility-veto',
  'source-hash-mismatch': 'input-feasibility-veto',
  'run-contract-mismatch': 'input-feasibility-veto',
  'vector-identity-mismatch': 'input-feasibility-veto',
  'capture-missing-or-invalid': 'input-feasibility-veto',
  'state-fingerprint-mismatch': 'input-feasibility-veto',
  'placement-manifest-mismatch': 'input-feasibility-veto',

  // (3) evidence-integrity veto — a property of the evidence directory, not of
  // the frozen inputs; only remedy is an operator-authorized discard
  'manifest-drift': 'evidence-integrity-veto',
  'receipt-corrupt': 'evidence-integrity-veto',
  'receipt-regression': 'evidence-integrity-veto',
  'run-record-corrupt': 'evidence-integrity-veto',

  // (4) terminal on first detection — hard invariant breaches, never retried
  'test-before-freeze': 'terminal-runtime-fail',
  'evidence-dir-out-of-bounds': 'terminal-runtime-fail',

  // (1) episode-incomplete — everything that leaves the run resumable
  'shard-timeout': 'episode-incomplete',
  'no-progress-timeout': 'episode-incomplete',
  'shard-nondeterminism': 'episode-incomplete',
  'resume-equivalence-violation': 'episode-incomplete',
  'replay-mismatch': 'episode-incomplete',
  'simulation-failure': 'episode-incomplete',
  'optimizer-failure': 'episode-incomplete',
  'worker-pool-failure': 'episode-incomplete',
  'evidence-io-failure': 'episode-incomplete',
  'unclassified-failure': 'episode-incomplete',
  abort: 'episode-incomplete',
  'run-locked': 'episode-incomplete',
  'trainer-lock-present': 'episode-incomplete',
  'trainer-lock-indeterminate': 'episode-incomplete',
  'resume-budget-exhausted': 'episode-incomplete',
  'barren-episode-budget-exhausted': 'episode-incomplete',
});

/**
 * An unrecognised reason maps to `episode-incomplete`, which is the safe
 * default: it keeps the run resumable rather than manufacturing a verdict out
 * of something the design never classified.
 */
export function classifyD2Exit(reason: string): D2ExitClass {
  return CLASS_BY_REASON[reason] ?? 'episode-incomplete';
}

export function writesResultJson(exitClass: D2ExitClass): boolean {
  return exitClass === 'input-feasibility-veto'
    || exitClass === 'evidence-integrity-veto'
    || exitClass === 'terminal-runtime-fail'
    || exitClass === 'aggregate-verdict';
}

/**
 * Derived from the canonical status, never stored, so a replayed verdict can
 * never disagree with the original run about its own exit code.
 */
export function exitCodeForStatus(status: D2CanonicalStatus): 0 | 1 {
  return status === 'pass-action-conditioned-listwise-supported' ? 0 : 1;
}

export type D2WriteResultOutcome = 'written' | 'already-exists';

/** `result.json` is write-once: a later episode can never overwrite a verdict. */
export function writeResultOnce(
  fs: D2FileSystem,
  dir: string,
  canonical: string,
): D2WriteResultOutcome {
  const path = resultPath(dir);
  if (fs.exists(path)) return 'already-exists';
  writeAtomic(fs, path, canonical);
  return 'written';
}

export interface D2ShardFailure {
  readonly shardId: D2ShardId;
  readonly reason: string;
}

/**
 * Two-strike promotion for the recoverable `runtime-fail` class.  Shard purity
 * means a second identical failure is already conclusive, so there is no
 * reason to burn the whole barren budget first.  `previous` must come from the
 * durable run record, since the two attempts necessarily span two processes.
 */
/**
 * The reasons two-strike promotion applies to — spec 5.4.5(b)'s list exactly,
 * as an allowlist rather than a denylist.
 *
 * The direction matters more than the contents. Promotion writes a terminal
 * `runtime-fail` to a write-once `result.json`, which consumes the one-shot
 * operational authorization and admits no remedy but a correctness gate. A
 * denylist makes every reason promotable until someone remembers to exempt it,
 * so a reason added later is terminal by default; that is the wrong default for
 * an irreversible action.
 *
 * What justifies promotion is shard *purity*: a pure shard that fails the same
 * way twice is deterministically broken, so a third attempt cannot help. That
 * argument covers a non-converging solver, a replay mismatch, a rebuild that
 * did not reproduce, and the wall-clock ceilings — spec 5.4.5(b)'s list, and
 * nothing else. It does not cover infrastructure: a worker that died, an
 * aborted signal, or a disk that refused a write say nothing about the shard,
 * and spec 5.4.1 names transient worker crashes as resumable non-verdicts.
 *
 * `simulation-failure` is deliberately absent even though it looks like a
 * shard-purity signal. It is also what an *unclassified* throw used to collapse
 * to, so promoting it would have made any error D2 cannot name terminal on its
 * second sighting — a worker's own `RangeError` under memory pressure, say,
 * which repeats by construction because a resume restarts at the same shard.
 * Unclassified failures now carry `unclassified-failure` instead, and a
 * deliberate `simulation-failure` stays resumable: nothing yet distinguishes a
 * simulator that is broken from one that was unlucky, and the irreversible
 * reading is the wrong default.
 */
const PROMOTABLE_REASONS: ReadonlySet<string> = new Set([
  'optimizer-failure',
  'replay-mismatch',
  'malformed-metrics',
  'shard-timeout',
  'no-progress-timeout',
  'shard-nondeterminism',
  'resume-equivalence-violation',
]);

export function shouldPromoteToRuntimeFail(
  previous: D2ShardFailure | null,
  current: D2ShardFailure,
): boolean {
  if (classifyD2Exit(current.reason) === 'terminal-runtime-fail') return true;
  if (!PROMOTABLE_REASONS.has(current.reason)) return false;
  if (previous === null) return false;
  return previous.shardId === current.shardId && previous.reason === current.reason;
}
