import { describe, it, expect, afterAll } from 'vitest';
import type { Worker } from 'node:worker_threads';
import { WorkerPool, type SimTask } from './pool';
import { toVector, HANDCRAFTED_WEIGHTS } from '../src/ai/weights';
import { TOTAL_ROWS } from '../src/constants';

const W = toVector(HANDCRAFTED_WEIGHTS);
const pool = new WorkerPool(3);

afterAll(async () => {
  await pool.destroy();
});

const task = (taskId: number, seed: number, weights = W): SimTask => ({
  taskId, weights, seed, maxPieces: 60, depth: 1,
});

describe('WorkerPool', () => {
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
    const direct = simulateGame({ weights: W, seed: 99, maxPieces: 60, depth: 1 });
    const [viaWorker] = await pool.run([task(0, 99)]);

    expect(viaWorker.lines).toBe(direct.lines);
    expect(viaWorker.score).toBe(direct.score);
    expect(viaWorker.pieces).toBe(direct.pieces);
    expect(viaWorker.meanHeight).toBe(direct.meanHeight);
  }, 60000);

  it('records a failed task as zero score instead of hanging or throwing', async () => {
    // A short weight vector makes simulateGame throw inside the worker.
    const results = await pool.run([task(0, 1), task(1, 2, [1, 2, 3]), task(2, 3)]);

    expect(results).toHaveLength(3);
    expect(results[1].failed).toBe(true);
    expect(results[1].score).toBe(0);
    expect(results[1].lines).toBe(0);
    // Score is the primary target; height remains a diagnostic. The worst legal
    // height is the honest stand-in when no diagnostic result exists.
    expect(results[1].meanHeight).toBe(TOTAL_ROWS);
    expect(results[0].failed).toBe(false);
    expect(results[2].failed).toBe(false);
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
    const crashPool = new WorkerPool(2);
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
