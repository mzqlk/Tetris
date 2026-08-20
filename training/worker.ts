import { parentPort } from 'node:worker_threads';
import { simulateGame } from '../src/ai/simulate';
import { FAILED_RESULT, type SimTask } from './pool';

if (parentPort === null) throw new Error('worker.ts must be run as a worker thread');
const port = parentPort;

port.on('message', (task: SimTask) => {
  try {
    const result = simulateGame({
      weights: task.weights,
      seed: task.seed,
      maxPieces: task.maxPieces,
    });
    port.postMessage({ taskId: task.taskId, ...result, failed: false });
  } catch (err) {
    port.postMessage({
      taskId: task.taskId,
      ...FAILED_RESULT,
      failed: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
