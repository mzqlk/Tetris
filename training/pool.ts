import { Worker } from 'node:worker_threads';

import { TOTAL_ROWS } from '../src/constants';
import { emptyLineClearCounts, type LineClearCounts } from '../src/ai/lineClears';
import { emptyStrategyDiagnostics, type StrategyDiagnostics } from '../src/ai/tetrisStrategy';

/**
 * A game that never ran earns zero score, so fixed-schedule score rate ranks it
 * below any scoring game. TOTAL_ROWS remains the honest diagnostic height for
 * a failed result; height does not enter primary fitness.
 */
export const FAILED_RESULT = {
  lines: 0,
  clearCounts: emptyLineClearCounts(),
  score: 0,
  pieces: 0,
  meanHeight: TOTAL_ROWS,
  strategyDiagnostics: emptyStrategyDiagnostics(),
  reason: 'error',
} as const;

export interface SimTask {
  taskId: number;
  weights: number[];
  seed: number;
  maxPieces: number;
  depth: 1 | 2;
}

export interface SimTaskResult {
  taskId: number;
  lines: number;
  clearCounts: LineClearCounts;
  score: number;
  pieces: number;
  meanHeight: number;
  strategyDiagnostics: StrategyDiagnostics;
  reason: 'gameover' | 'pieceCap' | 'error';
  failed: boolean;
  error?: string;
}

const WORKER_URL = new URL('./worker.ts', import.meta.url);

export type WorkerFactory = (index: number) => Worker;

// `execArgv` registers tsx's ESM loader inside the worker thread itself. A .ts
// worker otherwise inherits plain Node under Vitest and cannot resolve the
// extensionless shared-AI imports. Workers remain referenced; destroy() owns
// their lifetime and callers must await it.
const defaultWorkerFactory: WorkerFactory = (index) => new Worker(WORKER_URL, {
  name: `sim-${index}`,
  execArgv: ['--import', 'tsx'],
});

interface QueueItem {
  task: SimTask;
  index: number;
  attempts: number;
}

/**
 * Work-stealing pool over worker_threads.
 *
 * The unit of work is ONE GAME, not one candidate. A strong candidate can take
 * two orders of magnitude longer per game than a weak one, so handing each
 * worker a whole candidate would leave almost every core idle during the tail
 * of a generation.
 */
export class WorkerPool {
  private workers: Worker[];
  // Set only by destroy(). An 'exit' event fired by terminate() during teardown
  // is expected shutdown, not a crash — without this flag the exit listener
  // below would spawn a fresh replacement worker moments after `this.workers`
  // has been cleared, leaking a thread destroy() never gets to terminate.
  private destroyed = false;

  private constructor(
    workers: Worker[],
    private readonly workerFactory: WorkerFactory,
  ) {
    this.workers = workers;
  }

  static async create(
    size: number,
    workerFactory: WorkerFactory = defaultWorkerFactory,
  ): Promise<WorkerPool> {
    const workers: Worker[] = [];
    try {
      for (let i = 0; i < size; i++) workers.push(workerFactory(i));
    } catch (error) {
      await Promise.allSettled(workers.map((worker) => worker.terminate()));
      throw error;
    }
    return new WorkerPool(workers, workerFactory);
  }

  private spawn(i: number): Worker {
    return this.workerFactory(i);
  }

  run(tasks: SimTask[]): Promise<SimTaskResult[]> {
    if (tasks.length === 0) return Promise.resolve([]);

    return new Promise((resolveAll, rejectAll) => {
      const results = new Array<SimTaskResult>(tasks.length);
      const queue: QueueItem[] = tasks.map((task, index) => ({ task, index, attempts: 0 }));
      const inFlight = new Map<Worker, QueueItem>();
      let completed = 0;
      let cursor = 0;
      let settled = false;

      const complete = (item: QueueItem, result: SimTaskResult) => {
        results[item.index] = result;
        if (++completed === tasks.length && !settled) {
          settled = true;
          resolveAll(results);
        }
      };

      const feed = (worker: Worker) => {
        if (settled || cursor >= queue.length) return;
        const item = queue[cursor++];
        inFlight.set(worker, item);
        item.attempts++;
        worker.postMessage(item.task);
      };

      const retryOrFail = (item: QueueItem, reason: string) => {
        if (item.attempts < 2) {
          console.warn(`[pool] task ${item.task.taskId} ${reason}; retrying`);
          queue.push(item);
          return;
        }
        console.warn(`[pool] task ${item.task.taskId} ${reason} twice; scoring it 0`);
        complete(item, {
          taskId: item.task.taskId,
          ...FAILED_RESULT,
          clearCounts: emptyLineClearCounts(),
          strategyDiagnostics: emptyStrategyDiagnostics(),
          failed: true, error: reason,
        });
      };

      const attach = (worker: Worker, slot: number) => {
        worker.removeAllListeners('message');
        worker.removeAllListeners('error');
        worker.removeAllListeners('exit');

        // A worker that has died — whether it emitted 'error' first or not —
        // gets replaced and its in-flight task (if any) requeued exactly once.
        // `handled` is scoped to this attach() call, i.e. to this one worker
        // instance, so a worker that emits BOTH 'error' and 'exit' (the usual
        // Node sequence for a crash) only runs this the first time; the second
        // event is a no-op rather than a double replace/requeue.
        let handled = false;
        const handleDeath = (reason: string) => {
          if (handled || settled) return;
          handled = true;

          const item = inFlight.get(worker);
          inFlight.delete(worker);

          let replacement: Worker;
          try {
            replacement = this.spawn(slot);
            this.workers[slot] = replacement;
            attach(replacement, slot);
          } catch (error) {
            settled = true;
            rejectAll(error);
            return;
          }

          if (item !== undefined) retryOrFail(item, reason);
          feed(replacement);
        };

        worker.on('message', (result: SimTaskResult) => {
          const item = inFlight.get(worker);
          if (item === undefined) return;
          inFlight.delete(worker);

          if (result.failed) retryOrFail(item, `failed (${result.error ?? 'unknown'})`);
          else complete(item, result);

          feed(worker);
        });

        worker.on('error', (err) => handleDeath(`crashed the worker (${err.message})`));

        // A clean thread exit or external termination leaves no 'error' event at
        // all, which — without this listener — would strand the task in
        // `inFlight` forever and hang run() on a multi-hour run. Skip it during
        // destroy(): that termination is intentional teardown, not a crash, and
        // by then nothing is waiting on a replacement worker.
        worker.on('exit', (code) => {
          if (this.destroyed) return;
          handleDeath(`exited unexpectedly (code ${code})`);
        });
      };

      try {
        this.workers.forEach(attach);
        for (const worker of this.workers) feed(worker);
      } catch (err) {
        settled = true;
        rejectAll(err);
      }
    });
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
  }
}
