import { describe, it, expect, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { FAILED_RESULT, WorkerPool, type SimTask, type WorkerFactory } from './pool';
import { FIXED_SEARCH_LIMITS } from '../src/ai/search';
import { toVector, HANDCRAFTED_WEIGHTS } from '../src/ai/weights';
import { TOTAL_ROWS } from '../src/constants';
import { emptyStrategyDiagnostics } from '../src/ai/tetrisStrategy';
import type { FixedSearchConfig } from '../src/ai/simulate';

const W = toVector(HANDCRAFTED_WEIGHTS);
const TEST_SEARCH: FixedSearchConfig = {
  maxLockedDepth: 1,
  maxRootPlacements: 1,
  maxChildPlacements: 1,
};
const pool = await WorkerPool.create(3);

afterAll(async () => {
  await pool.destroy();
});

const task = (taskId: number, seed: number, weights = W): SimTask => ({
  taskId, weights, seed, maxPieces: 12, search: TEST_SEARCH,
});

const acceptsSimTask = (_task: SimTask): void => {};

// @ts-expect-error SimTask producers must provide an explicit fixed-search contract.
acceptsSimTask({ taskId: 0, weights: W, seed: 1, maxPieces: 12 });
acceptsSimTask({
  taskId: 0,
  weights: W,
  seed: 1,
  maxPieces: 12,
  search: FIXED_SEARCH_LIMITS,
  // @ts-expect-error Legacy depth metadata is not part of the SimTask contract.
  depth: 2,
});

describe('WorkerPool', () => {
  it('passes the required fixed search config to the worker without rewriting the task', async () => {
    const messages: SimTask[] = [];
    class RecordingWorker extends EventEmitter {
      postMessage(message: SimTask): void {
        messages.push(message);
        queueMicrotask(() => this.emit('message', {
          taskId: message.taskId,
          ...FAILED_RESULT,
          failed: false,
        }));
      }

      async terminate(): Promise<number> {
        return 0;
      }
    }

    const recordingPool = await WorkerPool.create(
      1,
      () => new RecordingWorker() as unknown as Worker,
    );
    const fixedTask: SimTask = {
      taskId: 17,
      weights: W,
      seed: 23,
      maxPieces: 12,
      search: FIXED_SEARCH_LIMITS,
    };

    try {
      await recordingPool.run([fixedTask]);
    } finally {
      await recordingPool.destroy();
    }

    expect(messages).toEqual([fixedTask]);
    expect(messages[0]).toBe(fixedTask);
    expect(messages[0].search).toEqual({
      maxLockedDepth: 4,
      maxRootPlacements: 64,
      maxChildPlacements: 32,
    });
  });

  it('terminates already-created workers when a later construction fails', async () => {
    const created: Worker[] = [];
    const exits: Promise<unknown>[] = [];
    const factory: WorkerFactory = (index) => {
      if (index === 2) throw new Error('worker construction failed at slot 2');
      const worker = new Worker('setInterval(() => {}, 1000)', { eval: true });
      created.push(worker);
      exits.push(new Promise((resolve) => worker.once('exit', resolve)));
      return worker;
    };

    try {
      await expect(WorkerPool.create(4, factory)).rejects.toThrow(
        /worker construction failed at slot 2/,
      );
      const allExited = await Promise.race([
        Promise.all(exits).then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
      expect(created).toHaveLength(2);
      expect(allExited).toBe(true);
    } finally {
      await Promise.all(created.map((worker) => worker.terminate()));
    }
  });

  it('rejects the run when replacement construction fails', async () => {
    const created: Worker[] = [];
    let constructions = 0;
    const factory: WorkerFactory = (index) => {
      if (constructions++ === 2) {
        throw new Error('replacement construction failed');
      }
      const worker = new Worker(new URL('./worker.ts', import.meta.url), {
        name: `replacement-failure-${index}`,
        execArgv: ['--import', 'tsx'],
      });
      created.push(worker);
      return worker;
    };
    const replacementPool = await WorkerPool.create(2, factory);

    try {
      const run = replacementPool.run(
        Array.from({ length: 20 }, (_, index) => task(index, 9_000 + index)),
      );
      const victim = created[0];

      expect(() => victim.emit('error', new Error('simulated worker crash'))).not.toThrow();
      await expect(run).rejects.toThrow(/replacement construction failed/);
    } finally {
      await replacementPool.destroy();
    }

    expect(created).toHaveLength(2);
    expect(created.every((worker) => worker.threadId === -1)).toBe(true);
  });

  it('returns one result per task, in task order', async () => {
    const tasks = Array.from({ length: 20 }, (_, i) => task(i, i + 1));
    const results = await pool.run(tasks);

    expect(results).toHaveLength(20);
    results.forEach((r, i) => {
      expect(r.taskId).toBe(i);
      expect(r.failed).toBe(false);
      expect(r.pieces).toBeGreaterThan(0);
    });
  }, 60000);

  it('produces the same numbers as an in-process simulation', async () => {
    const { simulateGame } = await import('../src/ai/simulate');
    const direct = simulateGame({
      weights: W, seed: 99, maxPieces: 12, search: TEST_SEARCH,
    });
    const [viaWorker] = await pool.run([task(0, 99)]);

    expect(viaWorker.lines).toBe(direct.lines);
    expect(viaWorker.score).toBe(direct.score);
    expect(viaWorker.pieces).toBe(direct.pieces);
    expect(viaWorker.meanHeight).toBe(direct.meanHeight);
    expect(viaWorker.clearCounts).toEqual(direct.clearCounts);
    expect(viaWorker.strategyDiagnostics).toEqual(direct.strategyDiagnostics);
    expect(viaWorker.searchDiagnostics).toEqual(direct.searchDiagnostics);
    expect(viaWorker.reason).toBe(direct.reason);
  }, 60000);

  it('records a failed task as zero score instead of hanging or throwing', async () => {
    // A short weight vector makes simulateGame throw inside the worker.
    const results = await pool.run([task(0, 1), task(1, 2, [1, 2, 3]), task(2, 3)]);

    expect(results).toHaveLength(3);
    expect(results[1].failed).toBe(true);
    expect(results[1].score).toBe(0);
    expect(results[1].lines).toBe(0);
    expect(results[1].clearCounts).toEqual({
      singles: 0, doubles: 0, triples: 0, tetrises: 0,
    });
    // Score is the primary target; height remains a diagnostic. The worst legal
    // height is the honest stand-in when no diagnostic result exists.
    expect(results[1].meanHeight).toBe(TOTAL_ROWS);
    expect(results[1].strategyDiagnostics).toEqual(emptyStrategyDiagnostics());
    expect(results[1].searchDiagnostics).toEqual({
      holdActions: 0,
      holdRate: 0,
      meanCompletedDepth: 0,
      minCompletedDepth: 0,
      expandedDecisionNodes: 0,
      expandedChanceNodes: 0,
      cacheHits: 0,
      abortedSearches: 0,
    });
    expect(results[1].reason).toBe('error');
    expect(results[0].failed).toBe(false);
    expect(results[2].failed).toBe(false);
  }, 60000);

  it('defines zero clear counts for a failed result', () => {
    expect(FAILED_RESULT.clearCounts).toEqual({
      singles: 0, doubles: 0, triples: 0, tetrises: 0,
    });
    expect(FAILED_RESULT.strategyDiagnostics).toEqual(emptyStrategyDiagnostics());
    expect(FAILED_RESULT.searchDiagnostics).toEqual({
      holdActions: 0,
      holdRate: 0,
      meanCompletedDepth: 0,
      minCompletedDepth: 0,
      expandedDecisionNodes: 0,
      expandedChanceNodes: 0,
      cacheHits: 0,
      abortedSearches: 0,
    });
    expect(FAILED_RESULT.reason).toBe('error');
  });

  it('gives each failed result its own clear-count object', async () => {
    const results = await pool.run([task(0, 1, [1]), task(1, 2, [1])]);

    expect(results[0].failed).toBe(true);
    expect(results[1].failed).toBe(true);
    expect(results[0].clearCounts).not.toBe(results[1].clearCounts);
    expect(results[0].strategyDiagnostics).not.toBe(results[1].strategyDiagnostics);
    expect(results[0].searchDiagnostics).not.toBe(results[1].searchDiagnostics);
  }, 60000);

  it('handles more tasks than workers without dropping any', async () => {
    const tasks = Array.from({ length: 50 }, (_, i) => task(i, 1000 + i));
    const results = await pool.run(tasks);
    expect(new Set(results.map((r) => r.taskId)).size).toBe(50);
  }, 120000);

  it('accepts an empty task list', async () => {
    expect(await pool.run([])).toEqual([]);
  });

  it('replaces a crashed worker and still completes every task', async () => {
    // The soft-failure path (the worker catching its own exception) is covered
    // above. This covers the hard one: the worker thread dying, which surfaces
    // as an 'error' event on the parent Worker object. It is the single path
    // most likely to strand a task and hang run() forever, so it gets a test
    // rather than an argument.
    const crashPool = await WorkerPool.create(2);
    const victim = (crashPool as unknown as { workers: Worker[] }).workers[0];

    try {
      const promise = crashPool.run(Array.from({ length: 8 }, (_, i) => task(i, 500 + i)));

      // Fire a genuine 'error' event while work is in flight.
      victim.emit('error', new Error('simulated worker crash'));

      const results = await promise;

      expect(results).toHaveLength(8);
      results.forEach((r, i) => {
        expect(r.taskId).toBe(i);
        expect(r.pieces).toBeGreaterThan(0);
      });
    } finally {
      // The synthetic 'error' leaves the original thread alive but orphaned —
      // the pool has already swapped it out, so destroy() will not reach it.
      await victim.terminate();
      await crashPool.destroy();
    }
  }, 120000);
});
