import { describe, it, expect, expectTypeOf } from 'vitest';
import { DEFAULT_CONFIG, resolveWorkers, type TrainConfig } from './config';

describe('resolveWorkers', () => {
  it('leaves a core free for the rest of the machine by default', () => {
    expect(resolveWorkers(null, 8)).toBe(7);
  });

  it('caps the default well below a very large core count', () => {
    expect(resolveWorkers(null, 64)).toBe(31);
  });

  it('still yields one worker on a single-core machine', () => {
    expect(resolveWorkers(null, 1)).toBe(1);
  });

  it('honours an explicit request', () => {
    expect(resolveWorkers(4, 32)).toBe(4);
  });

  it('allows deliberate oversubscription', () => {
    // Not our call to forbid: a run that wants more workers than cores is
    // merely slower per worker, not wrong.
    expect(resolveWorkers(12, 8)).toBe(12);
  });

  it('rejects a count that would leave the pool with nothing to run on', () => {
    // WorkerPool(0) spawns no workers, so nothing is ever fed a task and
    // run() never settles — a multi-hour script that hangs in silence rather
    // than failing. It has to be caught at the argument, not discovered at 3am.
    expect(() => resolveWorkers(0, 8)).toThrow(/at least 1/);
    expect(() => resolveWorkers(-4, 8)).toThrow(/at least 1/);
  });

  it('rejects a fractional or non-finite count', () => {
    expect(() => resolveWorkers(2.5, 8)).toThrow(/whole number/);
    expect(() => resolveWorkers(NaN, 8)).toThrow(/whole number/);
    expect(() => resolveWorkers(Infinity, 8)).toThrow(/whole number/);
  });
});

describe('DEFAULT_CONFIG', () => {
  it('runs at least one worker on whatever machine this is', () => {
    expect(DEFAULT_CONFIG.workers).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(DEFAULT_CONFIG.workers)).toBe(true);
  });

  it('uses the fixed publication schedule required by the score objective', () => {
    expect(DEFAULT_CONFIG.reevalGames).toBe(30);
    expect(DEFAULT_CONFIG.reevalMaxPieces).toBe(5000);
  });

  it('serializes only evolution, schedule, and worker settings', () => {
    expect(Object.keys(DEFAULT_CONFIG).sort()).toEqual([
      'baseSeed', 'eliteFrac', 'gamesPerCandidate', 'initialMaxPieces',
      'initialNoise', 'maxPiecesCap', 'noiseDecay', 'noiseFloor', 'population',
      'reevalEvery', 'reevalGames', 'reevalMaxPieces', 'workers',
    ]);
  });

  it('excludes fixed search settings from the TrainConfig type boundary', () => {
    type SearchConfigKeys = Extract<
      keyof TrainConfig,
      'searchDepth' | 'rootBeamWidth' | 'childBeamWidth'
    >;
    expectTypeOf<SearchConfigKeys>().toEqualTypeOf<never>();
  });
});
