import { describe, it, expect, vi } from 'vitest';
import { mulberry32, hashSeed } from './rng';
import { generateBag } from '../engine/piece';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(Array.from({ length: 10 }, () => a())).not.toEqual(
      Array.from({ length: 10 }, () => b()),
    );
  });

  it('stays within [0, 1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('has roughly uniform mean', () => {
    const r = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 100000; i++) sum += r();
    expect(sum / 100000).toBeCloseTo(0.5, 2);
  });
});

describe('hashSeed', () => {
  it('is deterministic and order-sensitive', () => {
    expect(hashSeed(1, 2, 3)).toBe(hashSeed(1, 2, 3));
    expect(hashSeed(1, 2, 3)).not.toBe(hashSeed(3, 2, 1));
  });

  it('returns a uint32', () => {
    for (const v of [hashSeed(0), hashSeed(-1), hashSeed(2 ** 31, 5)]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('spreads nearby inputs apart', () => {
    const seen = new Set<number>();
    for (let gen = 0; gen < 200; gen++) {
      for (let j = 0; j < 5; j++) seen.add(hashSeed(42, gen, j));
    }
    expect(seen.size).toBe(1000);
  });
});

describe('generateBag', () => {
  it('always returns a permutation of the 7 piece types', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      expect([...generateBag(rng)].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('is deterministic for a given rng seed', () => {
    expect(generateBag(mulberry32(555))).toEqual(generateBag(mulberry32(555)));
  });

  it('defaults to Math.random so existing callers are unchanged', () => {
    const spy = vi.spyOn(Math, 'random');
    generateBag();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not touch Math.random when an rng is injected', () => {
    const spy = vi.spyOn(Math, 'random');
    generateBag(mulberry32(1));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
