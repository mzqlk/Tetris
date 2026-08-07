import {
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FEATURE_COUNT } from '../src/ai/features';
import { initCem, updateCem } from './cem';
import { DEFAULT_CONFIG } from './config';
import {
  assertFreshRun,
  readCompatibleCheckpoint,
  readCompatibleRunArtifacts,
  resolveRunPaths,
} from './runArtifacts';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tetris-score-rate-'));
  dirs.push(dir);
  return dir;
};

const axisVector = (axis = 0) => Array.from(
  { length: FEATURE_COUNT },
  (_, index) => Number(index === axis),
);
const unitVector = () => axisVector();

const meanClearCounts = {
  singles: 10,
  doubles: 20,
  triples: 20,
  tetrises: 460,
};

const validCheckpoint = () => ({
  version: 3,
  objective: 'score-rate-v2',
  gen: 2,
  mu: unitVector(),
  sigma: Array(FEATURE_COUNT).fill(1),
  baseSeed: DEFAULT_CONFIG.baseSeed,
  maxPieces: 1200,
  config: { ...DEFAULT_CONFIG },
  bestEver: {
    weights: unitVector(),
    meanScore: 25000,
    scoreRate: 5,
    meanLines: 1950,
    meanHeight: 3.5,
    meanClearCounts: { ...meanClearCounts },
    tetrisLineShare: (4 * 460) / 1950,
    gen: 1,
    evalGames: 30,
    evalMaxPieces: 5000,
  },
});

const validGeneration = (
  gen: number,
  maxPieces = DEFAULT_CONFIG.initialMaxPieces * (2 ** gen),
  elitePieces = maxPieces,
) => ({
  objective: 'score-rate-v2',
  gen,
  ts: 1_000 + gen,
  bestScoreRate: 5,
  meanScoreRate: 4,
  medianScoreRate: 4,
  worstScoreRate: 3,
  scoreRateStd: 1,
  mu: unitVector(),
  sigma: Array(FEATURE_COUNT).fill(1),
  bestWeights: unitVector(),
  maxPieces,
  medianPieces: Math.min(300, maxPieces),
  elitePieces,
  medianScore: 4 * maxPieces,
  eliteScore: 4.5 * maxPieces,
  medianLines: 10,
  medianHeight: 4,
  eliteHeight: 3,
  bestTetrisLineShare: 0.25,
  medianTetrisLineShare: 0.1,
  eliteTetrisLineShare: 0.2,
  gamesPerCandidate: DEFAULT_CONFIG.gamesPerCandidate,
  elapsedMs: 100,
});

const evaluated = (
  gen: number,
  meanScore: number,
  meanHeight: number,
  weights = unitVector(),
) => ({
  gen,
  weights,
  meanScore,
  scoreRate: meanScore / DEFAULT_CONFIG.reevalMaxPieces,
  meanLines: 1_950,
  meanHeight,
  meanClearCounts: { ...meanClearCounts },
  tetrisLineShare: (4 * meanClearCounts.tetrises) / 1_950,
});

type LoggedEvaluation = ReturnType<typeof evaluated>;

const reevaluationRecord = (
  gen: number,
  currentBest: LoggedEvaluation,
  candidate: LoggedEvaluation,
  decision: 'publish' | 'keep-current',
  reason: 'higher-score' | 'lower-score',
) => {
  const scoreDelta = candidate.meanScore - currentBest.meanScore;
  const scale = Math.max(Math.abs(candidate.meanScore), Math.abs(currentBest.meanScore));
  return {
    objective: 'score-rate-v2',
    kind: 'reevaluation',
    gen,
    ts: 2_000 + gen,
    schedule: {
      games: DEFAULT_CONFIG.reevalGames,
      maxPieces: DEFAULT_CONFIG.reevalMaxPieces,
      depth: DEFAULT_CONFIG.depth,
      baseSeed: DEFAULT_CONFIG.baseSeed,
      seedStrategy: 'fixed-reevaluation-v1',
    },
    currentBest,
    candidate,
    comparison: {
      scoreDelta,
      scoreRateDelta: candidate.scoreRate - currentBest.scoreRate,
      relativeScoreDelta: scale === 0 ? 0 : scoreDelta / scale,
      scoreTolerance: 0.001 * scale,
      heightDelta: candidate.meanHeight - currentBest.meanHeight,
      decision,
      reason,
    },
  };
};

const validReevaluation = (gen: number) => reevaluationRecord(
  gen,
  evaluated(-1, 25_000, 3.5),
  evaluated(gen, 25_050, 3.4, axisVector(1)),
  'publish',
  'higher-score',
);

const checkpointBestEver = (
  evaluation: LoggedEvaluation,
  checkpoint = validCheckpoint(),
) => ({
  ...evaluation,
  evalGames: checkpoint.config.reevalGames,
  evalMaxPieces: checkpoint.config.reevalMaxPieces,
});

const validPublishedRun = () => {
  const checkpoint = validCheckpoint();
  checkpoint.config.reevalEvery = 2;
  const reevaluation = validReevaluation(2);
  checkpoint.bestEver = checkpointBestEver(reevaluation.candidate, checkpoint);
  return {
    checkpoint,
    records: [validGeneration(0), validGeneration(1), reevaluation],
    reevaluation,
  };
};

const writeRun = (
  checkpoint: unknown,
  records: unknown[],
  finalNewline = true,
) => {
  const outputDir = temp();
  const paths = resolveRunPaths(outputDir, '.');
  writeFileSync(paths.checkpoint, JSON.stringify(checkpoint));
  const text = records.map((record) => JSON.stringify(record)).join('\n');
  writeFileSync(paths.log, `${text}${finalNewline ? '\n' : ''}`);
  return paths;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolveRunPaths', () => {
  it('defaults to the versioned score-rate directory', () => {
    const paths = resolveRunPaths('D:/repo', null);
    expect(paths.outputDir.replaceAll('\\', '/')).toBe('D:/repo/public/ai/score-rate-v2');
  });
});

describe('readCompatibleCheckpoint', () => {
  it('accepts the current checkpoint schema and objective', () => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(validCheckpoint()));
    expect(readCompatibleCheckpoint(path)).toMatchObject({
      version: 3,
      objective: 'score-rate-v2',
      gen: 2,
      config: { reevalGames: 30, reevalMaxPieces: 5000 },
      bestEver: { meanScore: 25000, scoreRate: 5 },
    });
  });

  it('rejects a checkpoint reached through a symbolic link', () => {
    const dir = temp();
    const target = join(dir, 'checkpoint-target.json');
    const path = join(dir, 'checkpoint.json');
    writeFileSync(target, JSON.stringify(validCheckpoint()));
    symlinkSync(target, path, 'file');

    expect(() => readCompatibleCheckpoint(path)).toThrow(/symbolic|reparse|regular file/i);
  });

  it('round-trips the non-unit arithmetic centroid produced by updateCem', () => {
    const first = unitVector();
    const second = [0, 1, ...Array(FEATURE_COUNT - 2).fill(0)];
    const state = updateCem(initCem(), [first, second], [1, 1], {
      eliteFrac: 1,
      noise: 0.01,
    });
    expect(Math.hypot(...state.mu)).toBeCloseTo(Math.SQRT1_2, 12);

    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify({
      ...validCheckpoint(),
      gen: state.gen,
      mu: state.mu,
      sigma: state.sigma,
    }));

    expect(readCompatibleCheckpoint(path)).toMatchObject({
      gen: state.gen,
      mu: state.mu,
      sigma: state.sigma,
    });
  });

  it.each([
    [{ version: 1 }, 'missing'],
    [{ version: 2, objective: 'lines-height-v1' }, 'lines-height-v1'],
  ])('rejects an incompatible checkpoint before resume: %j', (checkpoint, label) => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(new RegExp(`${label}.*score-rate-v2`));
  });

  it('preserves the current version mismatch error after the objective matches', () => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify({ ...validCheckpoint(), version: 2 }));
    expect(() => readCompatibleCheckpoint(path)).toThrow(
      /checkpoint schema 2 is incompatible with version 3/,
    );
  });

  it('rejects the old objective before reading the rest of the checkpoint', () => {
    const path = join(temp(), 'checkpoint.json');
    const checkpoint = validCheckpoint();
    checkpoint.version = 2 as 3;
    checkpoint.objective = 'score-rate-v1' as 'score-rate-v2';
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(/score-rate-v1.*score-rate-v2/);
  });

  it('rejects an inconsistent tetris share', () => {
    const path = join(temp(), 'checkpoint.json');
    const checkpoint = validCheckpoint();
    checkpoint.bestEver.tetrisLineShare = 0;
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(/tetrisLineShare/);
  });

  it('rejects mean lines inconsistent with clear counts', () => {
    const path = join(temp(), 'checkpoint.json');
    const checkpoint = validCheckpoint();
    checkpoint.bestEver.meanLines = 1949;
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(/meanLines/);
  });

  it.each([
    ['a missing clear-count key', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      delete (checkpoint.bestEver.meanClearCounts as Partial<typeof meanClearCounts>).triples;
    }],
    ['an extra clear-count key', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      (checkpoint.bestEver.meanClearCounts as typeof meanClearCounts & { extra: number }).extra = 0;
    }],
    ['a negative clear count', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.bestEver.meanClearCounts.singles = -1;
    }],
    ['a non-finite clear count', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.bestEver.meanClearCounts.doubles = Number.NaN;
    }],
  ])('rejects %s', (_label, mutate) => {
    const path = join(temp(), 'checkpoint.json');
    const checkpoint = validCheckpoint();
    mutate(checkpoint);
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(/meanClearCounts/);
  });

  it.each([
    ['mu length', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.mu = checkpoint.mu.slice(1);
    }],
    ['mu element', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.mu[2] = Number.NaN;
    }],
    ['sigma element', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.sigma[2] = null as unknown as number;
    }],
    ['zero sigma', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.sigma[2] = 0;
    }],
    ['generation', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.gen = -1;
    }],
    ['base seed', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.baseSeed = 1.5;
    }],
    ['scheduled maxPieces', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.maxPieces = 0;
    }],
    ['config field', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.config.population = 0;
    }],
    ['publication games', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.config.reevalGames = 29;
    }],
    ['bestEver weights', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.bestEver.weights = Array(FEATURE_COUNT).fill(1);
    }],
    ['bestEver score record', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.bestEver.meanScore = null as unknown as number;
    }],
    ['bestEver score rate', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.bestEver.scoreRate = 4;
    }],
    ['bestEver publication schedule', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      checkpoint.bestEver.evalMaxPieces = 4999;
    }],
  ])('rejects a correctly tagged v3 checkpoint with malformed %s', (_label, mutate) => {
    const path = join(temp(), 'checkpoint.json');
    const checkpoint = validCheckpoint();
    mutate(checkpoint);
    writeFileSync(path, JSON.stringify(checkpoint));

    expect(() => readCompatibleCheckpoint(path)).toThrow(/checkpoint/);
  });
});

describe('readCompatibleRunArtifacts', () => {
  it('accepts a complete generation history matching checkpoint.gen', () => {
    const checkpoint = { ...validCheckpoint(), bestEver: null };
    const paths = writeRun(checkpoint, [validGeneration(0), validGeneration(1)]);

    expect(readCompatibleRunArtifacts(paths)).toMatchObject({
      objective: 'score-rate-v2',
      gen: 2,
    });
  });

  it('rejects a training log reached through a symbolic link', () => {
    const { checkpoint, records } = validPublishedRun();
    const paths = writeRun(checkpoint, records);
    const target = join(paths.outputDir, 'training-log-target.jsonl');
    renameSync(paths.log, target);
    symlinkSync(target, paths.log, 'file');

    expect(() => readCompatibleRunArtifacts(paths)).toThrow(/symbolic|reparse|regular.*log/i);
  });

  it.each([
    ['a missing log', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      const outputDir = temp();
      const paths = resolveRunPaths(outputDir, '.');
      writeFileSync(paths.checkpoint, JSON.stringify(checkpoint));
      return paths;
    }],
    ['malformed JSON', (checkpoint: ReturnType<typeof validCheckpoint>) => {
      const paths = writeRun(checkpoint, [validGeneration(0), validGeneration(1)]);
      writeFileSync(paths.log, `${JSON.stringify(validGeneration(0))}\n{bad json}\n`);
      return paths;
    }],
    ['a truncated final line', (checkpoint: ReturnType<typeof validCheckpoint>) =>
      writeRun(checkpoint, [validGeneration(0), validGeneration(1)], false)],
    ['a v1 objective', (checkpoint: ReturnType<typeof validCheckpoint>) =>
      writeRun(checkpoint, [
        { ...validGeneration(0), objective: 'score-rate-v1' },
        { ...validGeneration(1), objective: 'score-rate-v1' },
      ])],
    ['mixed objectives', (checkpoint: ReturnType<typeof validCheckpoint>) =>
      writeRun(checkpoint, [
        validGeneration(0),
        { ...validGeneration(1), objective: 'score-rate-v1' },
      ])],
    ['missing generation history', (checkpoint: ReturnType<typeof validCheckpoint>) =>
      writeRun(checkpoint, [validGeneration(1)])],
    ['duplicate generation history', (checkpoint: ReturnType<typeof validCheckpoint>) =>
      writeRun(checkpoint, [validGeneration(0), validGeneration(0)])],
    ['out-of-order generation history', (checkpoint: ReturnType<typeof validCheckpoint>) =>
      writeRun(checkpoint, [validGeneration(1), validGeneration(0)])],
    ['a generation schema violation', (checkpoint: ReturnType<typeof validCheckpoint>) =>
      writeRun(checkpoint, [
        validGeneration(0),
        { ...validGeneration(1), bestWeights: Array(FEATURE_COUNT - 1).fill(0) },
      ])],
  ])('rejects %s', (_label, arrange) => {
    expect(() => readCompatibleRunArtifacts(arrange(validCheckpoint())))
      .toThrow(/training log|training-log|generation|objective|JSON|truncated/i);
  });

  it('rejects extra generations beyond checkpoint.gen', () => {
    const checkpoint = validCheckpoint();
    const paths = writeRun(checkpoint, [
      validGeneration(0), validGeneration(1), validGeneration(2),
    ]);

    expect(() => readCompatibleRunArtifacts(paths)).toThrow(/checkpoint.*gen|generation/i);
  });

  it('accepts the complete reevaluation schema at every configured interval', () => {
    const { checkpoint, records } = validPublishedRun();
    const paths = writeRun(checkpoint, records);

    expect(readCompatibleRunArtifacts(paths).gen).toBe(2);
  });

  it('accepts the published baseline generation sentinel on the first reevaluation', () => {
    const { checkpoint, records } = validPublishedRun();
    const paths = writeRun(checkpoint, records);

    expect(readCompatibleRunArtifacts(paths).gen).toBe(2);
  });

  it('accepts a negative integer base seed consistently recorded in reevaluation', () => {
    const { checkpoint, records, reevaluation } = validPublishedRun();
    checkpoint.baseSeed = -7;
    checkpoint.config.baseSeed = -7;
    reevaluation.schedule.baseSeed = -7;
    const paths = writeRun(checkpoint, records);

    expect(readCompatibleRunArtifacts(paths).baseSeed).toBe(-7);
  });

  it('rejects missing reevaluation history', () => {
    const checkpoint = validCheckpoint();
    checkpoint.config.reevalEvery = 2;
    const paths = writeRun(checkpoint, [validGeneration(0), validGeneration(1)]);

    expect(() => readCompatibleRunArtifacts(paths)).toThrow(/reevaluation.*2/i);
  });

  it.each([
    ['schedule', (entry: ReturnType<typeof validReevaluation>) => {
      entry.schedule.games--;
    }],
    ['mean lines', (entry: ReturnType<typeof validReevaluation>) => {
      entry.candidate.meanLines--;
    }],
    ['comparison', (entry: ReturnType<typeof validReevaluation>) => {
      entry.comparison.scoreDelta++;
    }],
    ['decision', (entry: ReturnType<typeof validReevaluation>) => {
      entry.comparison.decision = 'keep-current';
    }],
  ])('rejects a reevaluation with an inconsistent %s', (_label, mutate) => {
    const { checkpoint, records, reevaluation } = validPublishedRun();
    mutate(reevaluation);
    const paths = writeRun(checkpoint, records);

    expect(() => readCompatibleRunArtifacts(paths)).toThrow(/reevaluation/i);
  });

  it('rejects a first fixed reevaluation whose baseline generation is not -1', () => {
    const { checkpoint, records, reevaluation } = validPublishedRun();
    reevaluation.currentBest.gen = 1;

    expect(() => readCompatibleRunArtifacts(writeRun(checkpoint, records)))
      .toThrow(/baseline|currentBest|generation/i);
  });

  it('accepts a publish winner forwarded into a later keep-current reevaluation', () => {
    const checkpoint = validCheckpoint();
    checkpoint.gen = 4;
    checkpoint.maxPieces = 2_000;
    checkpoint.config.reevalEvery = 2;
    const baseline = evaluated(-1, 25_000, 3.5);
    const published = evaluated(2, 25_100, 3.4, axisVector(1));
    const first = reevaluationRecord(2, baseline, published, 'publish', 'higher-score');
    const laterCandidate = evaluated(4, 24_000, 3.3, axisVector(2));
    const second = reevaluationRecord(
      4, published, laterCandidate, 'keep-current', 'lower-score',
    );
    checkpoint.bestEver = checkpointBestEver(published, checkpoint);
    const records = [
      validGeneration(0, 300, 300),
      validGeneration(1, 600, 600),
      first,
      validGeneration(2, 1_200, 1_200),
      validGeneration(3, 2_000, 2_000),
      second,
    ];

    expect(readCompatibleRunArtifacts(writeRun(checkpoint, records)).bestEver)
      .toEqual(checkpoint.bestEver);
  });

  it('rejects a publish winner that is not forwarded to the next currentBest', () => {
    const checkpoint = validCheckpoint();
    checkpoint.gen = 4;
    checkpoint.maxPieces = 2_000;
    checkpoint.config.reevalEvery = 2;
    const baseline = evaluated(-1, 25_000, 3.5);
    const published = evaluated(2, 25_100, 3.4, axisVector(1));
    const first = reevaluationRecord(2, baseline, published, 'publish', 'higher-score');
    const laterCandidate = evaluated(4, 24_000, 3.3, axisVector(2));
    const forgedSecond = reevaluationRecord(
      4, baseline, laterCandidate, 'keep-current', 'lower-score',
    );
    checkpoint.bestEver = checkpointBestEver(published, checkpoint);
    const records = [
      validGeneration(0, 300, 300), validGeneration(1, 600, 600), first,
      validGeneration(2, 1_200, 1_200), validGeneration(3, 2_000, 2_000), forgedSecond,
    ];

    expect(() => readCompatibleRunArtifacts(writeRun(checkpoint, records)))
      .toThrow(/winner|currentBest|reevaluation/i);
  });

  it('rejects a keep-current loser forwarded as the next currentBest', () => {
    const checkpoint = validCheckpoint();
    checkpoint.gen = 4;
    checkpoint.maxPieces = 2_000;
    checkpoint.config.reevalEvery = 2;
    const baseline = evaluated(-1, 25_000, 3.5);
    const rejected = evaluated(2, 24_000, 3.4, axisVector(1));
    const first = reevaluationRecord(2, baseline, rejected, 'keep-current', 'lower-score');
    const laterCandidate = evaluated(4, 23_000, 3.3, axisVector(2));
    const forgedSecond = reevaluationRecord(
      4, rejected, laterCandidate, 'keep-current', 'lower-score',
    );
    checkpoint.bestEver = checkpointBestEver(baseline, checkpoint);
    const records = [
      validGeneration(0, 300, 300), validGeneration(1, 600, 600), first,
      validGeneration(2, 1_200, 1_200), validGeneration(3, 2_000, 2_000), forgedSecond,
    ];

    expect(() => readCompatibleRunArtifacts(writeRun(checkpoint, records)))
      .toThrow(/winner|currentBest|reevaluation/i);
  });

  it('rejects a checkpoint bestEver that differs from the replayed final winner', () => {
    const { checkpoint, records } = validPublishedRun();
    checkpoint.bestEver.weights = axisVector(2);

    expect(() => readCompatibleRunArtifacts(writeRun(checkpoint, records)))
      .toThrow(/bestEver|winner/i);
  });

  it('rejects null checkpoint bestEver after a fixed reevaluation', () => {
    const { checkpoint, records } = validPublishedRun();
    const staleCheckpoint = { ...checkpoint, bestEver: null };

    expect(() => readCompatibleRunArtifacts(writeRun(staleCheckpoint, records)))
      .toThrow(/bestEver|winner/i);
  });

  it('rejects non-null checkpoint bestEver when no fixed reevaluation was logged', () => {
    const checkpoint = validCheckpoint();
    const records = [validGeneration(0), validGeneration(1)];

    expect(() => readCompatibleRunArtifacts(writeRun(checkpoint, records)))
      .toThrow(/bestEver|reevaluation/i);
  });

  it('replays unchanged, doubled, and capped piece-cap transitions', () => {
    const checkpoint = {
      ...validCheckpoint(),
      gen: 4,
      maxPieces: 2_000,
      bestEver: null,
    };
    const records = [
      validGeneration(0, 300, 0),
      validGeneration(1, 300, 300),
      validGeneration(2, 600, 600),
      validGeneration(3, 1_200, 1_200),
    ];

    expect(readCompatibleRunArtifacts(writeRun(checkpoint, records)).maxPieces).toBe(2_000);
  });

  it('rejects a generation cap that disagrees with replayed scheduling', () => {
    const checkpoint = {
      ...validCheckpoint(),
      maxPieces: 600,
      bestEver: null,
    };
    const records = [
      validGeneration(0, 300, 0),
      validGeneration(1, 301, 300),
    ];

    expect(() => readCompatibleRunArtifacts(writeRun(checkpoint, records)))
      .toThrow(/maxPieces|piece cap|schedule/i);
  });

  it.each([
    ['median score rate', (entry: ReturnType<typeof validGeneration>) => {
      entry.medianScoreRate += 0.25;
    }, /medianScoreRate|median score rate/i],
    ['median pieces above the cap', (entry: ReturnType<typeof validGeneration>) => {
      entry.medianPieces = entry.maxPieces + 1;
    }, /medianPieces|piece cap|maxPieces/i],
    ['elite pieces above the cap', (entry: ReturnType<typeof validGeneration>) => {
      entry.elitePieces = entry.maxPieces + 1;
    }, /elitePieces|piece cap|maxPieces/i],
    ['best score rate below the mean', (entry: ReturnType<typeof validGeneration>) => {
      entry.meanScoreRate = entry.bestScoreRate + 0.5;
    }, /bestScoreRate|meanScoreRate|distribution/i],
    ['best score rate below the median', (entry: ReturnType<typeof validGeneration>) => {
      entry.medianScoreRate = entry.bestScoreRate + 0.5;
      entry.medianScore = entry.medianScoreRate * entry.maxPieces;
    }, /bestScoreRate|medianScoreRate|distribution/i],
    ['mean score rate below the worst', (entry: ReturnType<typeof validGeneration>) => {
      entry.meanScoreRate = entry.worstScoreRate - 0.5;
    }, /meanScoreRate|worstScoreRate|distribution/i],
    ['median score rate below the worst', (entry: ReturnType<typeof validGeneration>) => {
      entry.medianScoreRate = entry.worstScoreRate - 0.5;
      entry.medianScore = entry.medianScoreRate * entry.maxPieces;
    }, /medianScoreRate|worstScoreRate|distribution/i],
  ])('rejects impossible generation-derived data: %s', (_label, mutate, error) => {
    const checkpoint = {
      ...validCheckpoint(),
      gen: 1,
      maxPieces: 600,
      bestEver: null,
    };
    const entry = validGeneration(0);
    mutate(entry);

    expect(() => readCompatibleRunArtifacts(writeRun(checkpoint, [entry])))
      .toThrow(error);
  });

  it('rejects a checkpoint cap that disagrees with replayed scheduling', () => {
    const checkpoint = {
      ...validCheckpoint(),
      gen: 1,
      maxPieces: 301,
      bestEver: null,
    };
    const records = [validGeneration(0, 300, 0)];

    expect(() => readCompatibleRunArtifacts(writeRun(checkpoint, records)))
      .toThrow(/checkpoint.*maxPieces|piece cap|schedule/i);
  });

  it('rejects a gen-0 checkpoint paired with an empty training log', () => {
    const checkpoint = {
      ...validCheckpoint(),
      gen: 0,
      maxPieces: DEFAULT_CONFIG.initialMaxPieces,
      bestEver: null,
    };
    const outputDir = temp();
    const paths = resolveRunPaths(outputDir, '.');
    writeFileSync(paths.checkpoint, JSON.stringify(checkpoint));
    writeFileSync(paths.log, '');

    expect(() => readCompatibleRunArtifacts(paths)).toThrow(/empty|training log/i);
  });
});

describe('assertFreshRun', () => {
  it('allows a non-existent output-directory tail', () => {
    const paths = resolveRunPaths(temp(), 'nested/not-created');
    expect(() => assertFreshRun(paths)).not.toThrow();
  });

  it('allows an existing empty output directory', () => {
    const paths = resolveRunPaths(temp(), '.');
    expect(() => assertFreshRun(paths)).not.toThrow();
  });

  it('rejects an existing checkpoint', () => {
    const paths = resolveRunPaths(temp(), '.');
    writeFileSync(paths.checkpoint, '{}');
    expect(() => assertFreshRun(paths)).toThrow(/checkpoint/);
  });

  it('rejects a non-empty existing log', () => {
    const paths = resolveRunPaths(temp(), '.');
    writeFileSync(paths.log, '{"gen":0}\n');
    expect(() => assertFreshRun(paths)).toThrow(/training-log/);
  });

  it('rejects an empty existing log', () => {
    const paths = resolveRunPaths(temp(), '.');
    writeFileSync(paths.log, '');
    expect(() => assertFreshRun(paths)).toThrow(/output directory|training-log/);
  });

  it('rejects any other leftover file', () => {
    const paths = resolveRunPaths(temp(), '.');
    writeFileSync(join(paths.outputDir, 'leftover.txt'), 'sentinel');
    expect(() => assertFreshRun(paths)).toThrow(/output directory|leftover/);
  });
});
