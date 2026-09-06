import { parentPort } from 'node:worker_threads';
import { runD1Context, type D1ContextProjection, type D1ContextTask } from './d1ActionConditionedHeldOutListwiseLabels';

if (parentPort === null) throw new Error('D1 worker requires a parent port');

parentPort.on('message', (task: D1ContextTask) => {
  try {
    const result = runD1Context(task);
    parentPort!.postMessage({ kind: 'result', result });
  } catch {
    parentPort!.postMessage({ kind: 'failure', taskId: task?.taskId, reason: 'simulation-failure' });
  }
});

export type D1WorkerMessage =
  | Readonly<{ kind: 'result'; result: D1ContextProjection }>
  | Readonly<{ kind: 'failure'; taskId: number; reason: 'simulation-failure' }>;
