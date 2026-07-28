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
  // Set only by destroy(). An 'exit' event fired by terminate() during teardown
  // is expected shutdown, not a crash — without this flag the exit listener
  // below would spawn a fresh replacement worker moments after `this.workers`
  // has been cleared, leaking a thread destroy() never gets to terminate.
  private destroyed = false;

  constructor(size: number) {
    for (let i = 0; i < size; i++) this.workers.push(this.spawn(i));
  }

  private spawn(i: number): Worker {
    // `execArgv` registers tsx's ESM loader inside the worker thread itself, and
    // it is required rather than optional. Spawning a .ts worker only works when
    // the PARENT process was started under tsx; `vitest run` starts plain Node,
    // so a worker spawned from a test inherits no loader, falls back to Node's
    // native type-stripping, and cannot resolve extensionless relative imports
    // like '../src/ai/simulate'. Every game then fails with "Cannot find module"
    // — loudly, via the pool's retry path, but uselessly. This flag makes the
    // worker self-sufficient no matter how the parent was launched.
    // No unref() here. It looks like it would let an idle worker stop holding
    // the process open, but attaching a 'message' listener re-refs the
    // underlying MessagePort, and attach() always adds one — so unref() is
    // inert and only misleads. Shutting the pool down is destroy()'s job, and
    // callers must call it.
    return new Worker(WORKER_URL, {
      name: `sim-${i}`,
      execArgv: ['--import', 'tsx'],
    });
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
        worker.removeAllListeners('exit');

        // A worker that has died — whether it emitted 'error' first or not —
        // gets replaced and its in-flight task (if any) requeued exactly once.
        // `handled` is scoped to this attach() call, i.e. to this one worker
        // instance, so a worker that emits BOTH 'error' and 'exit' (the usual
        // Node sequence for a crash) only runs this the first time; the second
        // event is a no-op rather than a double replace/requeue.
        let handled = false;
        const handleDeath = (reason: string) => {
          if (handled) return;
          handled = true;

          const item = inFlight.get(worker);
          inFlight.delete(worker);

          const replacement = this.spawn(slot);
          this.workers[slot] = replacement;
          attach(replacement, slot);

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
