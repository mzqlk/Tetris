import { Worker } from 'node:worker_threads';

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
  score: number;
  pieces: number;
  reason: string;
  failed: boolean;
  error?: string;
}

const WORKER_URL = new URL('./worker.ts', import.meta.url);

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
  private workers: Worker[] = [];

  constructor(size: number) {
    for (let i = 0; i < size; i++) this.workers.push(this.spawn(i));
  }

  private spawn(i: number): Worker {
    // `execArgv` registers tsx's ESM loader inside the worker thread itself.
    // Node's worker_threads only inherit loader hooks that were registered in
    // the *parent* process (e.g. via `npx tsx ...` or NODE_OPTIONS=--import=tsx
    // set before Node starts). When the pool runs under `vitest run`, the
    // parent process is plain Node with no tsx loader registered — Vite/vitest
    // transforms `.ts` files it imports through its own module graph, but a
    // real OS-level `new Worker(url)` bypasses that graph entirely and falls
    // back to Node's native TS type-stripping, which does not resolve
    // extension-less relative specifiers like `../src/ai/simulate`. Passing
    // `--import tsx` here makes each worker register its own loader on
    // startup, so worker.ts resolves correctly no matter how the parent was
    // launched.
    const worker = new Worker(WORKER_URL, { name: `sim-${i}`, execArgv: ['--import', 'tsx'] });
    worker.unref();
    return worker;
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
          lines: 0, score: 0, pieces: 0, reason: 'error',
          failed: true, error: reason,
        });
      };

      const attach = (worker: Worker, slot: number) => {
        worker.removeAllListeners('message');
        worker.removeAllListeners('error');

        worker.on('message', (result: SimTaskResult) => {
          const item = inFlight.get(worker);
          if (item === undefined) return;
          inFlight.delete(worker);

          if (result.failed) retryOrFail(item, `failed (${result.error ?? 'unknown'})`);
          else complete(item, result);

          feed(worker);
        });

        // A worker that emits 'error' has died; replace it and requeue its task.
        worker.on('error', (err) => {
          const item = inFlight.get(worker);
          inFlight.delete(worker);

          const replacement = this.spawn(slot);
          this.workers[slot] = replacement;
          attach(replacement, slot);

          if (item !== undefined) retryOrFail(item, `crashed the worker (${err.message})`);
          feed(replacement);
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
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
  }
}
