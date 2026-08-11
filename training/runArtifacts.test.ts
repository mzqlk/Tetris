import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertFreshRun,
  readCompatibleCheckpoint,
  readCompatibleRunArtifacts,
  resolveRunPaths,
} from './runArtifacts';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tetris-score-rate-v3-'));
  dirs.push(dir);
  return dir;
};
const copy = <T>(value: T): T => structuredClone(value);

const AXIS_0 = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const AXIS_1 = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const AXIS_2 = [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const SIGMA = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
const CLEAR_COUNTS = { singles: 10, doubles: 20, triples: 20, tetrises: 460 };
const STRATEGY = {
  meanCleanWellDepth: 3,
  meanTetrisSetupProgress: 2.5,
  meanTetrisReadyRows: 1,
};
const SURVIVAL = { pieceCapGames: 30, gameoverGames: 0 };
const CONFIG = {
  population: 100,
  eliteFrac: 0.1,
  gamesPerCandidate: 5,
  depth: 2 as const,
  initialMaxPieces: 300,
  maxPiecesCap: 2_000,
  initialNoise: 0.5,
  noiseDecay: 0.95,
  noiseFloor: 0.01,
  baseSeed: 20_260_727,
  workers: 4,
  reevalEvery: 2,
  reevalGames: 30,
  reevalMaxPieces: 5_000,
};

const BASELINE = {
  weights: AXIS_0,
  meanScore: 25_000,
  scoreRate: 5,
  meanLines: 1_950,
  meanHeight: 3.5,
  meanClearCounts: CLEAR_COUNTS,
  tetrisLineShare: 0.9435897435897436,
  strategyDiagnostics: STRATEGY,
  survivalDiagnostics: SURVIVAL,
  gen: -1,
  evalGames: 30,
  evalMaxPieces: 5_000,
};

const CANDIDATE_2 = {
  weights: AXIS_1,
  meanScore: 30_000,
  scoreRate: 6,
  meanLines: 1_950,
  meanHeight: 3.4,
  meanClearCounts: CLEAR_COUNTS,
  tetrisLineShare: 0.9435897435897436,
  strategyDiagnostics: {
    meanCleanWellDepth: 3.1,
    meanTetrisSetupProgress: 2.6,
    meanTetrisReadyRows: 1.1,
  },
  survivalDiagnostics: SURVIVAL,
  gen: 2,
  evalGames: 30,
  evalMaxPieces: 5_000,
};

const CANDIDATE_4_KEEP = {
  weights: AXIS_2,
  meanScore: 29_000,
  scoreRate: 5.8,
  meanLines: 1_950,
  meanHeight: 3.3,
  meanClearCounts: CLEAR_COUNTS,
  tetrisLineShare: 0.9435897435897436,
  strategyDiagnostics: {
    meanCleanWellDepth: 3.2,
    meanTetrisSetupProgress: 2.7,
    meanTetrisReadyRows: 1.2,
  },
  survivalDiagnostics: SURVIVAL,
  gen: 4,
  evalGames: 30,
  evalMaxPieces: 5_000,
};

const CHECKPOINT = {
  version: 4,
  objective: 'score-rate-v3',
  gen: 2,
  mu: AXIS_0,
  sigma: SIGMA,
  baseSeed: 20_260_727,
  maxPieces: 1_200,
  config: CONFIG,
  publishedBaseline: BASELINE,
  bestQualifiedCandidate: CANDIDATE_2,
};

const GEN_0 = {
  objective: 'score-rate-v3',
  gen: 0,
  ts: 1_000,
  bestScoreRate: 5,
  meanScoreRate: 4,
  medianScoreRate: 4,
  worstScoreRate: 3,
  scoreRateStd: 1,
  mu: AXIS_0,
  sigma: SIGMA,
  bestWeights: AXIS_0,
  maxPieces: 300,
  medianPieces: 300,
  elitePieces: 300,
  medianScore: 1_200,
  eliteScore: 1_350,
  medianLines: 10,
  medianHeight: 4,
  eliteHeight: 3,
  bestTetrisLineShare: 0.25,
  medianTetrisLineShare: 0.1,
  eliteTetrisLineShare: 0.2,
  gamesPerCandidate: 5,
  elapsedMs: 100,
};
const GEN_1 = {
  ...GEN_0,
  gen: 1,
  ts: 1_001,
  maxPieces: 600,
  elitePieces: 600,
  medianScore: 2_400,
};
const GEN_2 = {
  ...GEN_0,
  gen: 2,
  ts: 1_002,
  maxPieces: 1_200,
  elitePieces: 1_200,
  medianScore: 4_800,
};
const GEN_3 = {
  ...GEN_0,
  gen: 3,
  ts: 1_003,
  maxPieces: 2_000,
  elitePieces: 2_000,
  medianScore: 8_000,
};

const logged = <T extends typeof BASELINE>(evaluation: T) => {
  const { evalGames, evalMaxPieces, ...result } = copy(evaluation);
  void evalGames;
  void evalMaxPieces;
  return result;
};

const REEVALUATION_2 = {
  objective: 'score-rate-v3',
  kind: 'reevaluation',
  gen: 2,
  ts: 2_002,
  schedule: {
    games: 30,
    maxPieces: 5_000,
    depth: 2,
    baseSeed: 20_260_727,
    seedStrategy: 'fixed-reevaluation-v1',
  },
  publishedBaseline: logged(BASELINE),
  currentQualified: null,
  candidate: logged(CANDIDATE_2),
  qualification: {
    shouldSave: true,
    reason: 'qualified',
    scoreTolerance: 30,
    scoreQualified: true,
    tetrisQualified: true,
    survivalQualified: true,
    betterThanCurrent: true,
    scoreDelta: 5_000,
    scoreRateDelta: 1,
    tetrisLineShareDelta: 0,
    pieceCapGamesDelta: 0,
    decision: 'save-candidate',
  },
};

const REEVALUATION_4_KEEP = {
  objective: 'score-rate-v3',
  kind: 'reevaluation',
  gen: 4,
  ts: 2_004,
  schedule: copy(REEVALUATION_2.schedule),
  publishedBaseline: logged(BASELINE),
  currentQualified: logged(CANDIDATE_2),
  candidate: logged(CANDIDATE_4_KEEP),
  qualification: {
    shouldSave: false,
    reason: 'not-better-qualified-candidate',
    scoreTolerance: 29,
    scoreQualified: true,
    tetrisQualified: true,
    survivalQualified: true,
    betterThanCurrent: false,
    scoreDelta: 4_000,
    scoreRateDelta: 0.7999999999999998,
    tetrisLineShareDelta: 0,
    pieceCapGamesDelta: 0,
    decision: 'keep-current',
  },
};

const CANDIDATE_FILE = {
  version: 4,
  weights: {
    aggregateHeight: 0,
    holes: 1,
    bumpiness: 0,
    maxHeight: 0,
    linesCleared: 0,
    landingHeight: 0,
    rowTransitions: 0,
    colTransitions: 0,
    wellDepth: 0,
    lineClearValue: 0,
    cleanWellDepth: 0,
    tetrisSetupProgress: 0,
    tetrisReadyRows: 0,
  },
  objective: 'score-rate-v3',
  meanScore: 30_000,
  evalMaxPieces: 5_000,
  meanLines: 1_950,
  meanHeight: 3.4,
  meanClearCounts: CLEAR_COUNTS,
  tetrisLineShare: 0.9435897435897436,
  strategyDiagnostics: CANDIDATE_2.strategyDiagnostics,
  survivalDiagnostics: SURVIVAL,
  evalGames: 30,
  gen: 2,
  searchDepth: 2,
  trainedAt: '2026-08-11T00:00:00.000Z',
};

const writeRun = (
  checkpoint: unknown,
  records: unknown[],
  candidate: unknown | null = null,
  finalNewline = true,
) => {
  const outputDir = temp();
  const paths = resolveRunPaths(outputDir, '.');
  writeFileSync(paths.checkpoint, JSON.stringify(checkpoint));
  const text = records.map((record) => JSON.stringify(record)).join('\n');
  writeFileSync(paths.log, `${text}${finalNewline ? '\n' : ''}`);
  if (candidate !== null) writeFileSync(paths.candidate, JSON.stringify(candidate));
  return paths;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolveRunPaths', () => {
  it('uses an isolated score-rate-v3 directory and candidate path', () => {
    const root = 'D:/repo';
    expect(resolveRunPaths(root, null)).toEqual({
      outputDir: resolve(root, 'public/ai/score-rate-v3'),
      checkpoint: resolve(root, 'public/ai/score-rate-v3/checkpoint.json'),
      log: resolve(root, 'public/ai/score-rate-v3/training-log.jsonl'),
      candidate: resolve(root, 'public/ai/score-rate-v3/candidate-weights.json'),
    });
  });
});

describe('readCompatibleCheckpoint', () => {
  it('accepts the exact version-4 checkpoint schema', () => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(CHECKPOINT));
    expect(readCompatibleCheckpoint(path)).toEqual(CHECKPOINT);
  });

  it.each([
    [{ version: 1 }, /score-rate-v3/],
    [{ version: 2, objective: 'score-rate-v1' }, /score-rate-v3/],
    [{ ...CHECKPOINT, version: 3, objective: 'score-rate-v2' }, /score-rate-v3|version 4/],
    [{ ...CHECKPOINT, version: 3 }, /version 4/],
  ])('rejects a legacy checkpoint: %j', (checkpoint, error) => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(error);
  });

  it.each([
    ['extra checkpoint key', (checkpoint: Record<string, unknown>) => {
      checkpoint.extra = true;
    }],
    ['missing checkpoint key', (checkpoint: Record<string, unknown>) => {
      delete checkpoint.bestQualifiedCandidate;
    }],
    ['extra evaluation key', (checkpoint: Record<string, unknown>) => {
      (checkpoint.publishedBaseline as Record<string, unknown>).extra = true;
    }],
    ['extra config key', (checkpoint: Record<string, unknown>) => {
      (checkpoint.config as Record<string, unknown>).extra = true;
    }],
    ['extra strategy key', (checkpoint: Record<string, unknown>) => {
      const baseline = checkpoint.publishedBaseline as Record<string, unknown>;
      (baseline.strategyDiagnostics as Record<string, unknown>).extra = 0;
    }],
    ['extra survival key', (checkpoint: Record<string, unknown>) => {
      const baseline = checkpoint.publishedBaseline as Record<string, unknown>;
      (baseline.survivalDiagnostics as Record<string, unknown>).extra = 0;
    }],
    ['inconsistent score rate', (checkpoint: Record<string, unknown>) => {
      (checkpoint.publishedBaseline as Record<string, unknown>).scoreRate = 4;
    }],
    ['unnormalized weights', (checkpoint: Record<string, unknown>) => {
      (checkpoint.bestQualifiedCandidate as Record<string, unknown>).weights = SIGMA;
    }],
  ])('rejects %s', (_label, mutate) => {
    const checkpoint = copy(CHECKPOINT) as unknown as Record<string, unknown>;
    mutate(checkpoint);
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(/checkpoint/i);
  });

  it.each([
    ['published baseline generation', (checkpoint: typeof CHECKPOINT) => {
      checkpoint.publishedBaseline.gen = 0;
    }],
    ['qualified candidate generation', (checkpoint: typeof CHECKPOINT) => {
      checkpoint.bestQualifiedCandidate.gen = -1;
    }],
    ['candidate without a baseline', (checkpoint: typeof CHECKPOINT) => {
      checkpoint.publishedBaseline = null as unknown as typeof BASELINE;
    }],
  ])('rejects an inconsistent %s before log replay', (_label, mutate) => {
    const checkpoint = copy(CHECKPOINT);
    mutate(checkpoint);
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(/baseline|candidate|generation/i);
  });

  it('rejects a checkpoint reached through a symbolic link', () => {
    const dir = temp();
    const target = join(dir, 'target.json');
    const path = join(dir, 'checkpoint.json');
    writeFileSync(target, JSON.stringify(CHECKPOINT));
    symlinkSync(target, path, 'file');
    expect(() => readCompatibleCheckpoint(path)).toThrow(/symbolic|reparse|regular/i);
  });
});

describe('readCompatibleRunArtifacts', () => {
  it('replays continuous generations, the immutable baseline, and save-candidate', () => {
    const result = readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], CANDIDATE_FILE),
    );
    expect(result.publishedBaseline).toEqual(BASELINE);
    expect(result.bestQualifiedCandidate).toEqual(CANDIDATE_2);
  });

  it('replays keep-current without replacing the qualified candidate', () => {
    const checkpoint = {
      ...copy(CHECKPOINT),
      gen: 4,
      maxPieces: 2_000,
    };
    const records = [GEN_0, GEN_1, REEVALUATION_2, GEN_2, GEN_3, REEVALUATION_4_KEEP];
    expect(readCompatibleRunArtifacts(writeRun(checkpoint, records, CANDIDATE_FILE)).bestQualifiedCandidate)
      .toEqual(CANDIDATE_2);
  });

  it.each([
    ['missing generation', [GEN_1, REEVALUATION_2], /continuous|history/],
    ['duplicate generation', [GEN_0, GEN_0, REEVALUATION_2], /continuous|history/],
    ['missing reevaluation', [GEN_0, GEN_1], /reevaluation.*2/],
    ['duplicate reevaluation', [GEN_0, GEN_1, REEVALUATION_2, REEVALUATION_2], /duplicated/],
  ])('rejects %s', (_label, records, error) => {
    expect(() => readCompatibleRunArtifacts(writeRun(CHECKPOINT, records))).toThrow(error);
  });

  it('rejects a generation that breaks the replayed piece-cap schedule', () => {
    const bad = { ...GEN_1, maxPieces: 601, medianScore: 2_404 };
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, bad, REEVALUATION_2]),
    )).toThrow(/schedule|maxPieces/i);
  });

  it('rejects an extra generation record key', () => {
    const bad = { ...GEN_0, extra: true };
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [bad, GEN_1, REEVALUATION_2]),
    )).toThrow(/generation.*schema/i);
  });

  it('rejects a changed published baseline in a later event', () => {
    const checkpoint = { ...copy(CHECKPOINT), gen: 4, maxPieces: 2_000 };
    const later = copy(REEVALUATION_4_KEEP);
    later.publishedBaseline.meanHeight = 3.6;
    expect(() => readCompatibleRunArtifacts(writeRun(
      checkpoint,
      [GEN_0, GEN_1, REEVALUATION_2, GEN_2, GEN_3, later],
    ))).toThrow(/publishedBaseline.*changed|baseline/i);
  });

  it('rejects currentQualified that differs from replayed qualification state', () => {
    const checkpoint = { ...copy(CHECKPOINT), gen: 4, maxPieces: 2_000 };
    const later = copy(REEVALUATION_4_KEEP);
    later.currentQualified.meanHeight = 3.2;
    expect(() => readCompatibleRunArtifacts(writeRun(
      checkpoint,
      [GEN_0, GEN_1, REEVALUATION_2, GEN_2, GEN_3, later],
    ))).toThrow(/currentQualified/i);
  });

  it('rejects qualification fields or decisions that do not reproduce', () => {
    const event = copy(REEVALUATION_2);
    event.qualification.decision = 'keep-current';
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, event]),
    )).toThrow(/qualification.*decision/i);
  });

  it.each([
    ['reevaluation', (event: Record<string, unknown>) => { event.extra = true; }],
    ['schedule', (event: Record<string, unknown>) => {
      (event.schedule as Record<string, unknown>).extra = true;
    }],
    ['evaluation', (event: Record<string, unknown>) => {
      (event.candidate as Record<string, unknown>).extra = true;
    }],
    ['strategy', (event: Record<string, unknown>) => {
      const candidate = event.candidate as Record<string, unknown>;
      (candidate.strategyDiagnostics as Record<string, unknown>).extra = true;
    }],
    ['survival', (event: Record<string, unknown>) => {
      const candidate = event.candidate as Record<string, unknown>;
      (candidate.survivalDiagnostics as Record<string, unknown>).extra = true;
    }],
    ['qualification', (event: Record<string, unknown>) => {
      (event.qualification as Record<string, unknown>).extra = true;
    }],
  ])('rejects an extra %s key', (_label, mutate) => {
    const event = copy(REEVALUATION_2) as unknown as Record<string, unknown>;
    mutate(event);
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, event]),
    )).toThrow(/schema/i);
  });

  it('rejects checkpoint fields that differ from final replay state', () => {
    const checkpoint = copy(CHECKPOINT);
    checkpoint.bestQualifiedCandidate.meanHeight = 3.3;
    expect(() => readCompatibleRunArtifacts(
      writeRun(checkpoint, [GEN_0, GEN_1, REEVALUATION_2]),
    )).toThrow(/bestQualifiedCandidate/i);
  });

  it('accepts a version-4 candidate file exactly matching bestQualifiedCandidate', () => {
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], CANDIDATE_FILE),
    )).not.toThrow();
  });

  it('requires a candidate file when bestQualifiedCandidate exists', () => {
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2]),
    )).toThrow(/candidate.*required|missing.*candidate|qualified candidate/i);
  });

  it('rejects a legacy candidate file', () => {
    const legacy = { ...CANDIDATE_FILE, version: 3, objective: 'score-rate-v2' };
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], legacy),
    )).toThrow(/candidate.*version 4/i);
  });

  it('rejects a candidate file that differs from bestQualifiedCandidate', () => {
    const candidate = { ...CANDIDATE_FILE, meanScore: 30_001 };
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], candidate),
    )).toThrow(/candidate.*bestQualifiedCandidate/i);
  });

  it('rejects an extra candidate top-level key', () => {
    const candidate = { ...CANDIDATE_FILE, extra: true };
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], candidate),
    )).toThrow(/candidate.*schema|extra/i);
  });

  it('rejects candidate searchDepth that differs from checkpoint depth', () => {
    const candidate = { ...CANDIDATE_FILE, searchDepth: 1 };
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], candidate),
    )).toThrow(/candidate.*searchDepth.*checkpoint/i);
  });

  it('forbids a candidate file before any candidate qualifies', () => {
    const checkpoint = {
      ...copy(CHECKPOINT),
      gen: 1,
      maxPieces: 600,
      publishedBaseline: null,
      bestQualifiedCandidate: null,
    };
    expect(() => readCompatibleRunArtifacts(
      writeRun(checkpoint, [GEN_0], CANDIDATE_FILE),
    )).toThrow(/candidate.*forbidden|qualified candidate/i);
  });

  it('rejects a truncated training log before replay', () => {
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], null, false),
    )).toThrow(/truncated/i);
  });

  it('rejects a training log reached through a symbolic link', () => {
    const paths = writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2]);
    const target = join(paths.outputDir, 'target.jsonl');
    renameSync(paths.log, target);
    symlinkSync(target, paths.log, 'file');
    expect(() => readCompatibleRunArtifacts(paths)).toThrow(/symbolic|reparse|regular/i);
  });
});

describe('assertFreshRun', () => {
  it('allows a missing or empty output directory', () => {
    expect(() => assertFreshRun(resolveRunPaths(temp(), 'missing'))).not.toThrow();
    expect(() => assertFreshRun(resolveRunPaths(temp(), '.'))).not.toThrow();
  });

  it.each(['checkpoint', 'log', 'candidate'] as const)(
    'rejects an existing %s artifact',
    (key) => {
      const paths = resolveRunPaths(temp(), '.');
      writeFileSync(paths[key], '');
      expect(() => assertFreshRun(paths)).toThrow(/non-empty output directory|refusing/i);
    },
  );

  it('does not alter rejected artifacts', () => {
    const paths = resolveRunPaths(temp(), '.');
    writeFileSync(paths.candidate, 'sentinel');
    expect(() => assertFreshRun(paths)).toThrow();
    expect(readFileSync(paths.candidate, 'utf8')).toBe('sentinel');
  });
});
