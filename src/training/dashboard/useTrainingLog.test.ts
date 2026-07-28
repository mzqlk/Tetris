import { describe, it, expect } from 'vitest';
import { parseLog } from './useTrainingLog';

const line = (gen: number) => JSON.stringify({
  gen, ts: 1785000000000 + gen, best: 100 + gen, mean: 50, median: 40, worst: 1, std: 10,
  mu: Array(9).fill(0.1), sigma: Array(9).fill(0.5), bestWeights: Array(9).fill(0.2),
  maxPieces: 300, medianPieces: 120, elitePieces: 260, gamesPerCandidate: 5, elapsedMs: 1000,
});

describe('parseLog', () => {
  it('parses one entry per line', () => {
    const entries = parseLog(`${line(0)}\n${line(1)}\n`);
    expect(entries).toHaveLength(2);
    expect(entries[1].gen).toBe(1);
    expect(entries[0].mu).toHaveLength(9);
  });

  it('returns an empty array for empty input', () => {
    expect(parseLog('')).toEqual([]);
    expect(parseLog('\n\n')).toEqual([]);
  });

  it('skips a truncated trailing line instead of throwing', () => {
    // The trainer appends while the dashboard reads; a partial last line is normal.
    const entries = parseLog(`${line(0)}\n{"gen":1,"best":`);
    expect(entries).toHaveLength(1);
  });

  it('skips lines missing required fields', () => {
    expect(parseLog(`{"gen":0}\n${line(1)}`)).toHaveLength(1);
  });

  it('keeps older lines that predate a schema addition, with defaults', () => {
    // elitePieces was added to the log partway through the project, so a
    // resumed run's file legitimately mixes old and new lines. Dropping the old
    // ones would blank the dashboard; passing them through undefined crashes
    // the render, since App formats maxPieces with toLocaleString().
    const parsed = JSON.parse(line(0));
    delete parsed.elitePieces;
    delete parsed.maxPieces;

    const entries = parseLog(JSON.stringify(parsed));
    expect(entries).toHaveLength(1);
    expect(entries[0].elitePieces).toBe(0);
    expect(entries[0].maxPieces).toBe(0);
    expect(() => entries[0].maxPieces.toLocaleString()).not.toThrow();
  });

  it('never yields an undefined numeric field', () => {
    const entries = parseLog(`${line(0)}\n${line(1)}`);
    for (const e of entries) {
      for (const key of ['ts', 'std', 'maxPieces', 'medianPieces', 'elitePieces',
                         'gamesPerCandidate', 'elapsedMs'] as const) {
        expect(typeof e[key]).toBe('number');
      }
    }
  });

  it('rejects a line whose required field is present but not finite', () => {
    const parsed = JSON.parse(line(0));
    parsed.best = null;
    expect(parseLog(JSON.stringify(parsed))).toHaveLength(0);
  });

  it('sorts by generation', () => {
    const entries = parseLog(`${line(3)}\n${line(1)}\n${line(2)}`);
    expect(entries.map((e) => e.gen)).toEqual([1, 2, 3]);
  });
});
