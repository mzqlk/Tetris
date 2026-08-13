import { describe, it, expect } from 'vitest';
import { FEATURE_COUNT } from '../../ai/features';
import { LOG_URL, parseLog } from './useTrainingLog';

const line = (gen: number) => JSON.stringify({
  objective: 'score-rate-v4',
  searchContract: 'bag-expectimax-hold-v1',
  searchDepth: 4,
  rootBeamWidth: 64,
  childBeamWidth: 32,
  gen,
  ts: 1785000000000 + gen,
  bestScoreRate: 125.5 + gen,
  meanScoreRate: 80,
  medianScoreRate: 75,
  worstScoreRate: 0,
  scoreRateStd: 10,
  mu: Array(FEATURE_COUNT).fill(0.1),
  sigma: Array(FEATURE_COUNT).fill(0.5),
  bestWeights: Array(FEATURE_COUNT).fill(0.2),
  maxPieces: 300,
  medianPieces: 120,
  elitePieces: 260,
  medianScore: 22500,
  eliteScore: 37650,
  medianLines: 45,
  medianHeight: 7.5,
  eliteHeight: 4.2,
  bestTetrisLineShare: 0.25,
  medianTetrisLineShare: 0.1,
  eliteTetrisLineShare: 0.2,
  bestStrategyDiagnostics: {
    meanCleanWellDepth: 4,
    meanTetrisSetupProgress: 3,
    meanTetrisReadyRows: 2,
  },
  medianStrategyDiagnostics: {
    meanCleanWellDepth: 3,
    meanTetrisSetupProgress: 2,
    meanTetrisReadyRows: 1,
  },
  eliteStrategyDiagnostics: {
    meanCleanWellDepth: 5,
    meanTetrisSetupProgress: 4,
    meanTetrisReadyRows: 3,
  },
  bestSearchDiagnostics: { holdActions: 1, holdRate: 0.1, meanCompletedDepth: 4, minCompletedDepth: 4, expandedDecisionNodes: 10, expandedChanceNodes: 20, cacheHits: 3, abortedSearches: 0 },
  medianSearchDiagnostics: { holdActions: 1, holdRate: 0.1, meanCompletedDepth: 4, minCompletedDepth: 4, expandedDecisionNodes: 10, expandedChanceNodes: 20, cacheHits: 3, abortedSearches: 0 },
  eliteSearchDiagnostics: { holdActions: 1, holdRate: 0.1, meanCompletedDepth: 4, minCompletedDepth: 4, expandedDecisionNodes: 10, expandedChanceNodes: 20, cacheHits: 3, abortedSearches: 0 },
  gamesPerCandidate: 5,
  elapsedMs: 1000,
});

describe('parseLog', () => {
  it('uses the score-rate-v4 log URL', () => {
    expect(LOG_URL).toBe('/ai/score-rate-v4/training-log.jsonl');
  });

  it('parses one entry per line', () => {
    const entries = parseLog(`${line(0)}\n${line(1)}\n`);
    expect(entries).toHaveLength(2);
    expect(entries[1].gen).toBe(1);
    expect(entries[0].mu).toHaveLength(FEATURE_COUNT);
  });

  it('parses score-rate fields used by the dashboard', () => {
    const [entry] = parseLog(line(0));
    expect(entry).toMatchObject({
      objective: 'score-rate-v4',
      bestScoreRate: 125.5,
      medianScoreRate: 75,
      medianScore: 22500,
      eliteScore: 37650,
      eliteHeight: 4.2,
      bestTetrisLineShare: 0.25,
      medianTetrisLineShare: 0.1,
      eliteTetrisLineShare: 0.2,
      bestStrategyDiagnostics: {
        meanCleanWellDepth: 4,
        meanTetrisSetupProgress: 3,
        meanTetrisReadyRows: 2,
      },
      medianStrategyDiagnostics: {
        meanCleanWellDepth: 3,
        meanTetrisSetupProgress: 2,
        meanTetrisReadyRows: 1,
      },
      eliteStrategyDiagnostics: {
        meanCleanWellDepth: 5,
        meanTetrisSetupProgress: 4,
        meanTetrisReadyRows: 3,
      },
    });
  });

  it('ignores a score-rate-v2 generation line', () => {
    const legacy = JSON.parse(line(0));
    legacy.objective = 'score-rate-v3';
    expect(parseLog(`${JSON.stringify(legacy)}\n${line(1)}`)).toHaveLength(1);
    expect(parseLog(`${JSON.stringify(legacy)}\n${line(1)}`)[0].gen).toBe(1);
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

  it('ignores reevaluation events between generation records', () => {
    const reevaluation = JSON.stringify({
      objective: 'score-rate-v3',
      kind: 'reevaluation',
      gen: 10,
      ts: 1785000000010,
      schedule: {},
      currentBest: {},
      candidate: {},
      comparison: {},
    });

    const entries = parseLog(`${line(9)}\n${reevaluation}\n${line(10)}\n`);
    expect(entries.map((entry) => entry.gen)).toEqual([9, 10]);
  });

  it('defaults optional diagnostics added after the first score-rate generation', () => {
    // elitePieces was added to the log partway through the project, so a
    // resumed run's file legitimately mixes old and new lines. Dropping the old
    // ones would blank the dashboard; passing them through undefined crashes
    // the render, since App formats maxPieces with toLocaleString().
    const parsed = JSON.parse(line(0));
    delete parsed.elitePieces;
    delete parsed.maxPieces;
    delete parsed.medianScore;
    delete parsed.eliteScore;
    delete parsed.medianLines;
    delete parsed.medianHeight;
    delete parsed.eliteHeight;
    delete parsed.bestTetrisLineShare;
    delete parsed.medianTetrisLineShare;
    delete parsed.eliteTetrisLineShare;
    delete parsed.bestStrategyDiagnostics;
    delete parsed.medianStrategyDiagnostics;
    delete parsed.eliteStrategyDiagnostics;

    const entries = parseLog(JSON.stringify(parsed));
    expect(entries).toHaveLength(1);
    expect(entries[0].elitePieces).toBe(0);
    expect(entries[0].maxPieces).toBe(0);
    expect(entries[0].medianScore).toBe(0);
    expect(entries[0].eliteScore).toBe(0);
    expect(entries[0].medianLines).toBe(0);
    expect(entries[0].medianHeight).toBe(0);
    expect(entries[0].eliteHeight).toBe(0);
    expect(entries[0].bestTetrisLineShare).toBe(0);
    expect(entries[0].medianTetrisLineShare).toBe(0);
    expect(entries[0].eliteTetrisLineShare).toBe(0);
    expect(entries[0].bestStrategyDiagnostics).toEqual({
      meanCleanWellDepth: 0,
      meanTetrisSetupProgress: 0,
      meanTetrisReadyRows: 0,
    });
    expect(entries[0].medianStrategyDiagnostics).toEqual({
      meanCleanWellDepth: 0,
      meanTetrisSetupProgress: 0,
      meanTetrisReadyRows: 0,
    });
    expect(entries[0].eliteStrategyDiagnostics).toEqual({
      meanCleanWellDepth: 0,
      meanTetrisSetupProgress: 0,
      meanTetrisReadyRows: 0,
    });
    expect(() => entries[0].maxPieces.toLocaleString()).not.toThrow();
  });

  it('never yields an undefined numeric field', () => {
    const entries = parseLog(`${line(0)}\n${line(1)}`);
    for (const e of entries) {
      for (const key of ['ts', 'scoreRateStd', 'maxPieces', 'medianPieces', 'elitePieces',
                         'medianScore', 'eliteScore', 'medianLines', 'medianHeight', 'eliteHeight',
                         'bestTetrisLineShare', 'medianTetrisLineShare', 'eliteTetrisLineShare',
                         'gamesPerCandidate', 'elapsedMs'] as const) {
        expect(typeof e[key]).toBe('number');
      }
    }
  });

  it('rejects a line whose required field is present but not finite', () => {
    const parsed = JSON.parse(line(0));
    parsed.bestScoreRate = null;
    expect(parseLog(JSON.stringify(parsed))).toHaveLength(0);
  });

  it.each(['mu', 'sigma', 'bestWeights'] as const)(
    'rejects a %s vector with the wrong feature count',
    (field) => {
      const parsed = JSON.parse(line(0));
      parsed[field] = parsed[field].slice(1);
      expect(parseLog(JSON.stringify(parsed))).toHaveLength(0);
    },
  );

  it.each(['mu', 'sigma', 'bestWeights'] as const)(
    'rejects a %s vector containing a non-number',
    (field) => {
      const parsed = JSON.parse(line(0));
      parsed[field][0] = 'not-a-number';
      expect(parseLog(JSON.stringify(parsed))).toHaveLength(0);
    },
  );

  it.each(['mu', 'sigma', 'bestWeights'] as const)(
    'rejects a %s vector containing a non-finite number',
    (field) => {
      const parsed = JSON.parse(line(0));
      parsed[field][0] = '__NON_FINITE__';
      const encoded = JSON.stringify(parsed).replace('"__NON_FINITE__"', '1e400');
      expect(parseLog(encoded)).toHaveLength(0);
    },
  );

  it('sorts by generation', () => {
    const entries = parseLog(`${line(3)}\n${line(1)}\n${line(2)}`);
    expect(entries.map((e) => e.gen)).toEqual([1, 2, 3]);
  });
});
