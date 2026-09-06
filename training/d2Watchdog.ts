import { shardScheduledPieces, type D2ShardId, type D2Stage2Manifest } from './d2ShardManifest';

/**
 * Hang detection.
 *
 * Signal handlers, heartbeats and `episode-abandoned` reconstruct a crash or a
 * kill.  A hang produces none of those: the process stays alive, heartbeats
 * keep reporting, and without a ceiling the same deterministic hang would
 * recur every episode until the budget ran out — retiring the research line on
 * zero scientific evidence.  These two ceilings close that gap.
 *
 * Neither introduces nondeterminism: a ceiling can only *prevent* a shard from
 * completing, never alter a receipt a shard already produced.
 */

/** Measured anchor: D1 v1's whole-command wall clock over 40,960 pieces. */
export const ANCHOR_MS_PER_PIECE = 150;
export const PER_SHARD_CEILING_MULTIPLIER = 20;
export const PER_SHARD_CEILING_FLOOR_MS = 300_000;
export const NO_PROGRESS_CEILING_MS = 1_800_000;

export function perShardCeilingMs(
  shardId: D2ShardId,
  stage2: D2Stage2Manifest | null,
): number {
  const pieces = shardScheduledPieces(shardId, stage2);
  return Math.max(
    PER_SHARD_CEILING_FLOOR_MS,
    PER_SHARD_CEILING_MULTIPLIER * pieces * ANCHOR_MS_PER_PIECE,
  );
}

export interface D2WatchdogState {
  /** shardId -> monotonic dispatch time, in the same clock as `nowMs`. */
  readonly inFlight: ReadonlyMap<D2ShardId, number>;
  readonly lastCompletionMs: number;
}

export type D2WatchdogVerdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'shard-timeout'; readonly shardId: D2ShardId }
  | { readonly kind: 'no-progress-timeout' };

/**
 * A specific overdue shard is reported in preference to the run-level ceiling,
 * because naming the shard is strictly more useful and because the run-level
 * ceiling's second condition would be satisfied by the same shard anyway.
 *
 * The run-level ceiling therefore fires only when no in-flight shard has any
 * remaining legitimate reason to be running — in practice, when the in-flight
 * set is empty and the dispatcher itself is stuck.  A long but healthy shard,
 * still inside its own ceiling, can never trip it.
 */
export function watchdogVerdict(
  state: D2WatchdogState,
  nowMs: number,
  stage2: D2Stage2Manifest | null,
): D2WatchdogVerdict {
  let overdue: { shardId: D2ShardId; dispatchedAt: number } | null = null;
  for (const [shardId, dispatchedAt] of state.inFlight) {
    if (nowMs - dispatchedAt < perShardCeilingMs(shardId, stage2)) continue;
    if (overdue === null || dispatchedAt < overdue.dispatchedAt
      || (dispatchedAt === overdue.dispatchedAt && shardId < overdue.shardId)) {
      overdue = { shardId, dispatchedAt };
    }
  }
  if (overdue !== null) return { kind: 'shard-timeout', shardId: overdue.shardId };

  const stalled = nowMs - state.lastCompletionMs >= NO_PROGRESS_CEILING_MS;
  // Vacuously true for an empty in-flight set — exactly the dispatcher-hang
  // case this ceiling exists to catch.
  const nothingLegitimatelyRunning = [...state.inFlight].every(([shardId, dispatchedAt]) =>
    nowMs - dispatchedAt >= perShardCeilingMs(shardId, stage2));
  if (stalled && nothingLegitimatelyRunning) return { kind: 'no-progress-timeout' };
  return { kind: 'ok' };
}
