import { parentPort } from 'node:worker_threads';
import {
  captureD1Trajectory,
  type D1CapturedState,
  type D1SourceVector,
  type D1Split,
} from './d1ActionConditionedHeldOutListwiseCore';
import {
  runD1Context,
  type D1ContextProjection,
  type D1ContextTask,
} from './d1ActionConditionedHeldOutListwiseLabels';

/**
 * D2 worker entry.
 *
 * The statistical work is identical to D1's — D2 changes the execution and
 * evidence layers, never the protocol — but the worker lives in a D2-owned
 * module so the worker URL resolves inside the D2 boundary.
 *
 * It handles two task kinds, and the second one is why this file matters more
 * than a URL boundary. Both `runD1Context` and `captureD1Trajectory` are fully
 * synchronous: running either on the orchestrator's thread would block the
 * event loop for the whole shard, and with it the heartbeat, the per-shard
 * watchdog and the signal handlers — the exact blindness the sharded design
 * exists to remove. Every long-running phase therefore executes here.
 */

if (parentPort === null) throw new Error('D2 worker requires a parent port');

parentPort.on('message', (task: D2WorkerTask) => {
  try {
    if (task.kind === 'capture') {
      const captures = captureD1Trajectory(task.capture);
      parentPort!.postMessage({
        kind: 'capture-result', shardId: task.shardId, captures,
      } satisfies D2WorkerMessage);
      return;
    }
    parentPort!.postMessage({
      kind: 'result', shardId: task.shardId, result: runD1Context(task.task),
    } satisfies D2WorkerMessage);
  } catch (error) {
    // A D1 invalid-input reason must survive the worker boundary: flattening
    // it to `simulation-failure` would reclassify a terminal input veto as a
    // resumable episode failure and send it down the wrong remediation branch.
    const reason = (error as { reason?: unknown } | null)?.reason;
    parentPort!.postMessage({
      kind: 'failure',
      shardId: task.shardId,
      taskId: task.kind === 'context' ? task.task?.taskId ?? null : null,
      // `unclassified-failure` rather than `simulation-failure`: a throw the
      // worker cannot name is not evidence that the simulator is broken, and
      // only the named one is allowed to carry a classification.
      reason: typeof reason === 'string' ? reason : 'unclassified-failure',
    } satisfies D2WorkerMessage);
  }
});

/** One behavior trajectory: the unit of work of a single capture shard. */
export interface D2CaptureRequest {
  readonly split: D1Split;
  readonly groupOrdinal: number;
  readonly behaviorSeed: number;
  readonly vector: D1SourceVector;
}

export type D2WorkerTask =
  | Readonly<{ kind: 'context'; shardId: string; task: D1ContextTask }>
  | Readonly<{ kind: 'capture'; shardId: string; capture: D2CaptureRequest }>;

export type D2WorkerMessage =
  | Readonly<{ kind: 'result'; shardId: string; result: D1ContextProjection }>
  | Readonly<{ kind: 'capture-result'; shardId: string; captures: readonly D1CapturedState[] }>
  | Readonly<{ kind: 'failure'; shardId: string; taskId: number | null; reason: string }>;
