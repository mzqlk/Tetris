/**
 * mulberry32 — a PRNG with a single u32 of state. Chosen because training only
 * needs speed, reproducibility, and a state small enough to drop into a
 * checkpoint; its statistical quality is more than adequate here.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a over the little-endian bytes of each value. Used to derive a game seed
 * from (baseSeed, generation, gameIndex) so every candidate in a generation
 * faces the identical set of piece sequences.
 */
export function hashSeed(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    let x = value >>> 0;
    for (let byte = 0; byte < 4; byte++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      x >>>= 8;
    }
  }
  return h >>> 0;
}
