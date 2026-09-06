import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SEARCH_METADATA } from './objective';
import {
  assertFreshRun,
  readCompatibleCheckpoint,
  readCompatibleRunArtifacts,
  resolveRunPaths,
  validateCompatibleRunArtifactSnapshot,
  type CompatibleRunArtifactSnapshot,
} from './runArtifacts';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tetris-score-rate-v5-'));
  dirs.push(dir);
  return dir;
};
const copy = <T>(value: T): T => structuredClone(value);
const errorMessage = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error('expected action to throw');
};

const EXPECTED_SEARCH_METADATA = {
  searchContract: 'bag-expectimax-hold-v2',
  searchDepth: 4,
  rootBeamWidth: 64,
  childBeamWidth: 32,
  maxWorkUnits: 3584,
  budgetCorpus: 'budget-corpus-v1',
  transpositionCacheEntries: 65_536,
  placementCacheEntries: 16_384,
} as const;
const EXPECTED_SEARCH_METADATA_KEYS = [
  'searchContract', 'searchDepth', 'rootBeamWidth', 'childBeamWidth',
  'maxWorkUnits', 'budgetCorpus', 'transpositionCacheEntries',
  'placementCacheEntries',
] as const;

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
const SEARCH = {
  searchCalls: 6_000,
  holdActions: 900,
  holdRate: 0.15,
  meanCompletedDepth: 3.9,
  minCompletedDepth: 3,
  completedDepthHistogram: [0, 0, 0, 600, 5_400] as [number, number, number, number, number],
  totalWorkUnitsUsed: 600_000,
  meanWorkUnitsUsed: 100,
  maxWorkUnitsUsed: 100,
  budgetExhaustedSearches: 1,
  budgetExhaustionRate: 1 / 6_000,
  placementEvaluationUnits: 300_000,
  chanceExpansionUnits: 200_000,
  cacheHitUnits: 100_000,
  expandedDecisionNodes: 12_000,
  expandedChanceNodes: 8_000,
  cacheHits: 2_000,
};
const CONFIG = {
  population: 100,
  eliteFrac: 0.1,
  gamesPerCandidate: 5,
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
  searchDiagnostics: SEARCH,
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
  searchDiagnostics: { ...SEARCH, holdActions: 950, holdRate: 950 / 6_000 },
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
  searchDiagnostics: { ...SEARCH, holdActions: 875, holdRate: 875 / 6_000 },
  gen: 4,
  evalGames: 30,
  evalMaxPieces: 5_000,
};

const CHECKPOINT = {
  version: 6,
  objective: 'score-rate-v5',
  gen: 2,
  mu: AXIS_0,
  sigma: SIGMA,
  baseSeed: 20_260_727,
  maxPieces: 1_200,
  config: CONFIG,
  publishedBaseline: BASELINE,
  bestQualifiedCandidate: CANDIDATE_2,
  ...EXPECTED_SEARCH_METADATA,
};

const GEN_0 = {
  objective: 'score-rate-v5',
  ...EXPECTED_SEARCH_METADATA,
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
  bestStrategyDiagnostics: { ...STRATEGY },
  medianStrategyDiagnostics: { ...STRATEGY },
  eliteStrategyDiagnostics: { ...STRATEGY },
  bestSearchDiagnostics: { searchCalls: 10, holdActions: 1, holdRate: 0.1, meanCompletedDepth: 4, minCompletedDepth: 4, completedDepthHistogram: [0, 0, 0, 0, 10], totalWorkUnitsUsed: 100, meanWorkUnitsUsed: 10, maxWorkUnitsUsed: 10, budgetExhaustedSearches: 0, budgetExhaustionRate: 0, placementEvaluationUnits: 50, chanceExpansionUnits: 25, cacheHitUnits: 25, expandedDecisionNodes: 10, expandedChanceNodes: 20, cacheHits: 3 },
  medianSearchDiagnostics: { searchCalls: 10, holdActions: 1, holdRate: 0.1, meanCompletedDepth: 4, minCompletedDepth: 4, completedDepthHistogram: [0, 0, 0, 0, 10], totalWorkUnitsUsed: 100, meanWorkUnitsUsed: 10, maxWorkUnitsUsed: 10, budgetExhaustedSearches: 0, budgetExhaustionRate: 0, placementEvaluationUnits: 50, chanceExpansionUnits: 25, cacheHitUnits: 25, expandedDecisionNodes: 10, expandedChanceNodes: 20, cacheHits: 3 },
  eliteSearchDiagnostics: { searchCalls: 10, holdActions: 1, holdRate: 0.1, meanCompletedDepth: 4, minCompletedDepth: 4, completedDepthHistogram: [0, 0, 0, 0, 10], totalWorkUnitsUsed: 100, meanWorkUnitsUsed: 10, maxWorkUnitsUsed: 10, budgetExhaustedSearches: 0, budgetExhaustionRate: 0, placementEvaluationUnits: 50, chanceExpansionUnits: 25, cacheHitUnits: 25, expandedDecisionNodes: 10, expandedChanceNodes: 20, cacheHits: 3 },
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
  objective: 'score-rate-v5',
  ...EXPECTED_SEARCH_METADATA,
  kind: 'reevaluation',
  gen: 2,
  ts: 2_002,
  schedule: {
    games: 30,
    maxPieces: 5_000,
    ...EXPECTED_SEARCH_METADATA,
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
  objective: 'score-rate-v5',
  ...EXPECTED_SEARCH_METADATA,
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
  version: 6,
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
  objective: 'score-rate-v5',
  meanScore: 30_000,
  evalMaxPieces: 5_000,
  meanLines: 1_950,
  meanHeight: 3.4,
  meanClearCounts: CLEAR_COUNTS,
  tetrisLineShare: 0.9435897435897436,
  strategyDiagnostics: CANDIDATE_2.strategyDiagnostics,
  survivalDiagnostics: SURVIVAL,
  searchDiagnostics: CANDIDATE_2.searchDiagnostics,
  evalGames: 30,
  gen: 2,
  ...EXPECTED_SEARCH_METADATA,
  trainedAt: '2026-08-11T00:00:00.000Z',
};

const bytes = (text: string): Uint8Array => Buffer.from(text, 'utf8');
const snapshot = (
  checkpoint: unknown,
  records: readonly unknown[],
  candidate: unknown | null,
): CompatibleRunArtifactSnapshot => ({
  checkpointBytes: bytes(JSON.stringify(checkpoint)),
  logBytes: bytes(`${records.map((record) => JSON.stringify(record)).join('\n')}\n`),
  candidateBytes: candidate === null ? null : bytes(JSON.stringify(candidate)),
});

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

const captureRunSnapshot = (
  paths: ReturnType<typeof resolveRunPaths>,
  candidatePresent: boolean,
): CompatibleRunArtifactSnapshot => ({
  checkpointBytes: readFileSync(paths.checkpoint),
  logBytes: readFileSync(paths.log),
  candidateBytes: candidatePresent ? readFileSync(paths.candidate) : null,
  labels: {
    checkpoint: paths.checkpoint,
    log: paths.log,
    candidate: paths.candidate,
  },
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolveRunPaths', () => {
  it('exports the exact frozen search metadata contract', () => {
    expect(SEARCH_METADATA).toEqual(EXPECTED_SEARCH_METADATA);
    expect(Object.keys(SEARCH_METADATA)).toEqual(EXPECTED_SEARCH_METADATA_KEYS);
  });
  it('returns isolated score-rate-v5 path strings', () => {
    const root = 'D:/repo';
    expect(resolveRunPaths(root, null)).toEqual({
      outputDir: resolve(root, 'public/ai/score-rate-v5'),
      checkpoint: resolve(root, 'public/ai/score-rate-v5/checkpoint.json'),
      log: resolve(root, 'public/ai/score-rate-v5/training-log.jsonl'),
      candidate: resolve(root, 'public/ai/score-rate-v5/candidate-weights.json'),
    });
  });

  it('does not create the default output directory', () => {
    const root = temp();
    resolveRunPaths(root, null);
    expect(readdirSync(root)).toEqual([]);
  });

});

describe('readCompatibleCheckpoint', () => {
  it('accepts the exact version-6 score-rate-v5 checkpoint schema', () => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(CHECKPOINT));
    expect(readCompatibleCheckpoint(path)).toMatchObject(CHECKPOINT);
  });

  it.each([
    [{ version: 1 }, /score-rate-v5|version 6/],
    [{ version: 2, objective: 'score-rate-v1' }, /score-rate-v5|version 6/],
    [{ ...CHECKPOINT, version: 3, objective: 'score-rate-v2' }, /score-rate-v5|version 6/],
    [{ ...CHECKPOINT, version: 4, objective: 'score-rate-v3' }, /score-rate-v5|version 6/],
    [{ ...CHECKPOINT, version: 5, objective: 'score-rate-v4' }, /score-rate-v5|version 6/],
  ])('rejects a legacy checkpoint: %j', (checkpoint, error) => {
    const path = join(temp(), 'checkpoint.json');
    writeFileSync(path, JSON.stringify(checkpoint));
    expect(() => readCompatibleCheckpoint(path)).toThrow(error);
  });

  it('rejects a schema-4 score-rate-v3 checkpoint without changing its output directory', () => {
    const legacy = { ...copy(CHECKPOINT), version: 4, objective: 'score-rate-v3' };
    const paths = writeRun(legacy, [GEN_0]);
    const snapshot = () => Object.fromEntries(
      readdirSync(paths.outputDir).map((name) => [name, readFileSync(join(paths.outputDir, name), 'utf8')]),
    );
    const before = snapshot();

    expect(() => readCompatibleRunArtifacts(paths)).toThrow(/score-rate-v5|version 6/i);
    expect(snapshot()).toEqual(before);
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

  it.each(EXPECTED_SEARCH_METADATA_KEYS)(
    'rejects a checkpoint missing %s',
    (field) => {
      const checkpoint = copy(CHECKPOINT) as Record<string, unknown>;
      delete checkpoint[field];
      const path = join(temp(), 'checkpoint.json');
      writeFileSync(path, JSON.stringify(checkpoint));
      expect(() => readCompatibleCheckpoint(path)).toThrow(/checkpoint.*schema/i);
    },
  );

  it.each(EXPECTED_SEARCH_METADATA_KEYS)(
    'rejects a checkpoint with wrong %s',
    (field) => {
      const checkpoint = copy(CHECKPOINT) as Record<string, unknown>;
      checkpoint[field] = field === 'budgetCorpus' ? 'wrong-corpus' : -1;
      const path = join(temp(), 'checkpoint.json');
      writeFileSync(path, JSON.stringify(checkpoint));
      expect(() => readCompatibleCheckpoint(path)).toThrow(/search metadata|score-rate-v5/i);
    },
  );

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

describe('validateCompatibleRunArtifactSnapshot snapshot validation', () => {
  const NO_CANDIDATE_CHECKPOINT = {
    ...copy(CHECKPOINT),
    gen: 1,
    maxPieces: 600,
    publishedBaseline: null,
    bestQualifiedCandidate: null,
  };

  it('accepts an absent-candidate snapshot with the same result as the path wrapper', () => {
    const expected = readCompatibleRunArtifacts(writeRun(NO_CANDIDATE_CHECKPOINT, [GEN_0]));

    expect(validateCompatibleRunArtifactSnapshot(
      snapshot(NO_CANDIDATE_CHECKPOINT, [GEN_0], null),
    )).toEqual(expected);
  });

  it('accepts a qualified-candidate snapshot with the same result as the path wrapper', () => {
    const expected = readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], CANDIDATE_FILE),
    );

    expect(validateCompatibleRunArtifactSnapshot(
      snapshot(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], CANDIDATE_FILE),
    )).toEqual(expected);
  });

  it('rejects a truncated snapshot log and names its literal diagnostic label', () => {
    const invalid = {
      ...snapshot(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], CANDIDATE_FILE),
      logBytes: bytes(
        [GEN_0, GEN_1, REEVALUATION_2].map((record) => JSON.stringify(record)).join('\n'),
      ),
      labels: {
        checkpoint: 'literal checkpoint snapshot',
        log: 'literal truncated log snapshot',
        candidate: 'literal candidate snapshot',
      },
    };

    expect(() => validateCompatibleRunArtifactSnapshot(invalid))
      .toThrow(/literal truncated log snapshot.*truncated/i);
  });

  it('rejects forbidden candidate bytes and names the candidate snapshot label', () => {
    const invalid = {
      ...snapshot(NO_CANDIDATE_CHECKPOINT, [GEN_0], CANDIDATE_FILE),
      labels: {
        checkpoint: 'literal checkpoint snapshot',
        log: 'literal log snapshot',
        candidate: 'literal forbidden candidate snapshot',
      },
    };

    expect(() => validateCompatibleRunArtifactSnapshot(invalid))
      .toThrow(/literal forbidden candidate snapshot.*forbidden/i);
  });

  it('rejects an absent required candidate and names the candidate snapshot label', () => {
    const invalid = {
      ...snapshot(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], null),
      labels: {
        checkpoint: 'literal checkpoint snapshot',
        log: 'literal log snapshot',
        candidate: 'literal required candidate snapshot',
      },
    };

    expect(() => validateCompatibleRunArtifactSnapshot(invalid))
      .toThrow(/literal required candidate snapshot.*required/i);
  });

  it('rejects mismatched candidate bytes and names the candidate snapshot label', () => {
    const invalidCandidate = { ...CANDIDATE_FILE, meanScore: 30_001 };
    const invalid = {
      ...snapshot(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], invalidCandidate),
      labels: {
        checkpoint: 'literal checkpoint snapshot',
        log: 'literal log snapshot',
        candidate: 'literal mismatched candidate snapshot',
      },
    };

    expect(() => validateCompatibleRunArtifactSnapshot(invalid))
      .toThrow(/literal mismatched candidate snapshot.*bestQualifiedCandidate/i);
  });

  it('owns a captured snapshot after every originating artifact path is replaced', () => {
    const paths = writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], CANDIDATE_FILE);
    const captured = captureRunSnapshot(paths, true);
    const expected = validateCompatibleRunArtifactSnapshot(captured);
    for (const path of [paths.checkpoint, paths.log, paths.candidate]) {
      renameSync(path, `${path}.original`);
      writeFileSync(path, 'replacement');
    }

    expect(validateCompatibleRunArtifactSnapshot(captured)).toEqual(expected);
  });

  it('does not write files while validating a pure snapshot', () => {
    const outputDir = temp();

    validateCompatibleRunArtifactSnapshot(
      snapshot(NO_CANDIDATE_CHECKPOINT, [GEN_0], null),
    );

    expect(readdirSync(outputDir)).toEqual([]);
  });

  it('preserves path-bearing empty-log rejection parity with the wrapper', () => {
    const paths = writeRun(NO_CANDIDATE_CHECKPOINT, [GEN_0]);
    writeFileSync(paths.log, '');
    const captured = captureRunSnapshot(paths, false);

    const wrapperMessage = errorMessage(() => readCompatibleRunArtifacts(paths));
    expect(errorMessage(() => validateCompatibleRunArtifactSnapshot(captured)))
      .toBe(wrapperMessage);
    expect(wrapperMessage).toContain(paths.log);
    expect(wrapperMessage).toMatch(/empty/i);
  });

  it('preserves path-bearing truncated-log rejection parity with the wrapper', () => {
    const paths = writeRun(
      CHECKPOINT,
      [GEN_0, GEN_1, REEVALUATION_2],
      CANDIDATE_FILE,
      false,
    );
    const captured = captureRunSnapshot(paths, true);

    const wrapperMessage = errorMessage(() => readCompatibleRunArtifacts(paths));
    expect(errorMessage(() => validateCompatibleRunArtifactSnapshot(captured)))
      .toBe(wrapperMessage);
    expect(wrapperMessage).toContain(paths.log);
    expect(wrapperMessage).toMatch(/truncated/i);
  });

  it('preserves path-bearing candidate-mismatch rejection parity with the wrapper', () => {
    const mismatch = { ...CANDIDATE_FILE, meanScore: 30_001 };
    const paths = writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], mismatch);
    const captured = captureRunSnapshot(paths, true);

    const wrapperMessage = errorMessage(() => readCompatibleRunArtifacts(paths));
    expect(errorMessage(() => validateCompatibleRunArtifactSnapshot(captured)))
      .toBe(wrapperMessage);
    expect(wrapperMessage).toContain(paths.candidate);
    expect(wrapperMessage).toMatch(/bestQualifiedCandidate/i);
  });

  it('preserves path-bearing required-candidate rejection parity with the wrapper', () => {
    const paths = writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2]);
    const captured = captureRunSnapshot(paths, false);

    const wrapperMessage = errorMessage(() => readCompatibleRunArtifacts(paths));
    expect(errorMessage(() => validateCompatibleRunArtifactSnapshot(captured)))
      .toBe(wrapperMessage);
    expect(wrapperMessage).toContain(paths.candidate);
    expect(wrapperMessage).toMatch(/required/i);
  });

  it('preserves path-bearing forbidden-candidate rejection parity with the wrapper', () => {
    const paths = writeRun(NO_CANDIDATE_CHECKPOINT, [GEN_0], CANDIDATE_FILE);
    const captured = captureRunSnapshot(paths, true);

    const wrapperMessage = errorMessage(() => readCompatibleRunArtifacts(paths));
    expect(errorMessage(() => validateCompatibleRunArtifactSnapshot(captured)))
      .toBe(wrapperMessage);
    expect(wrapperMessage).toContain(paths.candidate);
    expect(wrapperMessage).toMatch(/forbidden/i);
  });

  it('rejects UTF-8 BOM-prefixed checkpoint bytes with path-wrapper parity', () => {
    const paths = writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], CANDIDATE_FILE);
    writeFileSync(
      paths.checkpoint,
      bytes(`\uFEFF${JSON.stringify(CHECKPOINT)}`),
    );
    const captured = captureRunSnapshot(paths, true);

    const wrapperMessage = errorMessage(() => readCompatibleRunArtifacts(paths));
    expect(errorMessage(() => validateCompatibleRunArtifactSnapshot(captured)))
      .toBe(wrapperMessage);
    expect(wrapperMessage).toContain(paths.checkpoint);
    expect(wrapperMessage).toMatch(/invalid JSON/i);
  });

  it('rejects a UTF-8 BOM on the first log line with wrapper-message parity', () => {
    const paths = writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], CANDIDATE_FILE);
    const records = [GEN_0, GEN_1, REEVALUATION_2]
      .map((record) => JSON.stringify(record))
      .join('\n');
    writeFileSync(paths.log, bytes(`\uFEFF${records}\n`));
    const captured = captureRunSnapshot(paths, true);

    const wrapperMessage = errorMessage(() => readCompatibleRunArtifacts(paths));
    expect(errorMessage(() => validateCompatibleRunArtifactSnapshot(captured)))
      .toBe(wrapperMessage);
    expect(wrapperMessage).toMatch(/training log line 1.*invalid JSON/i);
  });

  it('rejects UTF-8 BOM-prefixed candidate bytes with path-wrapper parity', () => {
    const paths = writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], CANDIDATE_FILE);
    writeFileSync(
      paths.candidate,
      bytes(`\uFEFF${JSON.stringify(CANDIDATE_FILE)}`),
    );
    const captured = captureRunSnapshot(paths, true);

    const wrapperMessage = errorMessage(() => readCompatibleRunArtifacts(paths));
    expect(errorMessage(() => validateCompatibleRunArtifactSnapshot(captured)))
      .toBe(wrapperMessage);
    expect(wrapperMessage).toContain(paths.candidate);
    expect(wrapperMessage).toMatch(/invalid JSON/i);
  });
});

describe('readCompatibleRunArtifacts', () => {
  it('rejects a score-rate-v4 generation before accepting log append history', () => {
    const legacy = { ...GEN_0, objective: 'score-rate-v4' };
    expect(() => readCompatibleRunArtifacts(
      writeRun({ ...CHECKPOINT, gen: 1, maxPieces: 600, publishedBaseline: null,
        bestQualifiedCandidate: null }, [legacy]),
    )).toThrow(/score-rate-v4.*score-rate-v5/i);
  });

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

  it.each(EXPECTED_SEARCH_METADATA_KEYS)(
    'rejects a generation missing %s',
    (field) => {
      const bad = copy(GEN_0) as Record<string, unknown>;
      delete bad[field];
      expect(() => readCompatibleRunArtifacts(
        writeRun(CHECKPOINT, [bad, GEN_1, REEVALUATION_2]),
      )).toThrow(/generation.*schema/i);
    },
  );

  it.each(EXPECTED_SEARCH_METADATA_KEYS)('rejects a generation with wrong %s', (field) => {
    const bad = { ...GEN_0, [field]: field === 'budgetCorpus' ? 'wrong-corpus' : -1 };
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [bad, GEN_1, REEVALUATION_2]),
    )).toThrow(/generation.*search|generation.*contract/i);
  });

  describe.each([
    ['bestStrategyDiagnostics', 'best strategy diagnostics'],
    ['medianStrategyDiagnostics', 'median strategy diagnostics'],
    ['eliteStrategyDiagnostics', 'elite strategy diagnostics'],
  ] as const)('%s generation contract', (field, label) => {
    it('rejects a missing object', () => {
      const bad = copy(GEN_0) as Record<string, unknown>;
      delete bad[field];
      expect(() => readCompatibleRunArtifacts(
        writeRun(CHECKPOINT, [bad, GEN_1, REEVALUATION_2]),
      )).toThrow(/generation.*schema/i);
    });

    it('rejects a malformed object', () => {
      const bad = copy(GEN_0) as Record<string, unknown>;
      bad[field] = 'malformed';
      expect(() => readCompatibleRunArtifacts(
        writeRun(CHECKPOINT, [bad, GEN_1, REEVALUATION_2]),
      )).toThrow(new RegExp(label, 'i'));
    });

    it('rejects an extra nested key', () => {
      const bad = copy(GEN_0) as Record<string, unknown>;
      (bad[field] as Record<string, unknown>).extra = true;
      expect(() => readCompatibleRunArtifacts(
        writeRun(CHECKPOINT, [bad, GEN_1, REEVALUATION_2]),
      )).toThrow(new RegExp(label, 'i'));
    });
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

  it.each(EXPECTED_SEARCH_METADATA_KEYS)(
    'rejects a reevaluation missing top-level %s',
    (field) => {
      const event = copy(REEVALUATION_2) as unknown as Record<string, unknown>;
      delete event[field];
      expect(() => readCompatibleRunArtifacts(
        writeRun(CHECKPOINT, [GEN_0, GEN_1, event]),
      )).toThrow(/reevaluation record.*schema/i);
    },
  );

  it.each(EXPECTED_SEARCH_METADATA_KEYS)('rejects a reevaluation with wrong top-level %s', (field) => {
    const event = { ...copy(REEVALUATION_2), [field]: field === 'budgetCorpus' ? 'wrong-corpus' : -1 };
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, event]),
    )).toThrow(/reevaluation search metadata/i);
  });

  it.each(EXPECTED_SEARCH_METADATA_KEYS)(
    'rejects a reevaluation schedule missing %s',
    (field) => {
      const event = copy(REEVALUATION_2);
      delete (event.schedule as unknown as Record<string, unknown>)[field];
      expect(() => readCompatibleRunArtifacts(
        writeRun(CHECKPOINT, [GEN_0, GEN_1, event]),
      )).toThrow(/reevaluation schedule.*schema/i);
    },
  );

  it.each(EXPECTED_SEARCH_METADATA_KEYS)('rejects a reevaluation schedule with wrong %s', (field) => {
    const event = copy(REEVALUATION_2);
    (event.schedule as unknown as Record<string, unknown>)[field] =
      field === 'budgetCorpus' ? 'wrong-corpus' : -1;
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, event]),
    )).toThrow(/reevaluation schedule.*checkpoint|reevaluation schedule.*search/i);
  });

  it('rejects checkpoint fields that differ from final replay state', () => {
    const checkpoint = copy(CHECKPOINT);
    checkpoint.bestQualifiedCandidate.meanHeight = 3.3;
    expect(() => readCompatibleRunArtifacts(
      writeRun(checkpoint, [GEN_0, GEN_1, REEVALUATION_2]),
    )).toThrow(/bestQualifiedCandidate/i);
  });

  it('rejects checkpoint mu that differs from the final logged optimizer state', () => {
    const checkpoint = copy(CHECKPOINT);
    checkpoint.mu = AXIS_1;
    expect(() => readCompatibleRunArtifacts(
      writeRun(checkpoint, [GEN_0, GEN_1, REEVALUATION_2], CANDIDATE_FILE),
    )).toThrow(/checkpoint mu.*final logged optimizer state/i);
  });

  it('rejects checkpoint sigma that differs from the final logged optimizer state', () => {
    const checkpoint = copy(CHECKPOINT);
    checkpoint.sigma = SIGMA.map((value, index) => index === 0 ? value / 2 : value);
    expect(() => readCompatibleRunArtifacts(
      writeRun(checkpoint, [GEN_0, GEN_1, REEVALUATION_2], CANDIDATE_FILE),
    )).toThrow(/checkpoint sigma.*final logged optimizer state/i);
  });

  it('accepts a version-6 candidate file exactly matching bestQualifiedCandidate', () => {
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], CANDIDATE_FILE),
    )).not.toThrow();
  });

  it('rejects a candidate whose non-fitness search diagnostics differ from the checkpoint', () => {
    const candidate = {
      ...CANDIDATE_FILE,
      searchDiagnostics: { ...CANDIDATE_FILE.searchDiagnostics, cacheHits: 2_001 },
    };
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], candidate),
    )).toThrow(/candidate.*bestQualifiedCandidate/i);
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
    )).toThrow(/candidate.*version 6/i);
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

  it('rejects candidate searchDepth outside the exact version-6 schema', () => {
    const candidate = { ...CANDIDATE_FILE, searchDepth: 1 };
    expect(() => readCompatibleRunArtifacts(
      writeRun(CHECKPOINT, [GEN_0, GEN_1, REEVALUATION_2], candidate),
    )).toThrow(/candidate.*version 6 schema/i);
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
    try {
      expect(() => readCompatibleRunArtifacts(paths)).toThrow(/symbolic|reparse|regular/i);
    } finally {
      rmSync(paths.log);
    }
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
