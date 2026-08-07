import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT } from '../src/ai/features';
import { DEFAULT_CONFIG } from './config';
import { acquireRunLock } from './runLock';

const ROOT = resolve(import.meta.dirname, '..');

const axisVector = (axis = 0) => Array.from(
  { length: FEATURE_COUNT },
  (_, index) => Number(index === axis),
);
const unitVector = () => axisVector();

const validCheckpoint = (gen = 1) => ({
  version: 3,
  objective: 'score-rate-v2',
  gen,
  mu: unitVector(),
  sigma: Array(FEATURE_COUNT).fill(1),
  baseSeed: DEFAULT_CONFIG.baseSeed,
  maxPieces: gen === 0
    ? DEFAULT_CONFIG.initialMaxPieces
    : Math.min(DEFAULT_CONFIG.initialMaxPieces * (2 ** gen), DEFAULT_CONFIG.maxPiecesCap),
  config: { ...DEFAULT_CONFIG },
  bestEver: null,
});

const validGeneration = (
  gen: number,
  maxPieces = Math.min(
    DEFAULT_CONFIG.initialMaxPieces * (2 ** gen),
    DEFAULT_CONFIG.maxPiecesCap,
  ),
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
  medianPieces: 300,
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
  weights = unitVector(),
) => ({
  gen,
  weights,
  meanScore,
  scoreRate: meanScore / DEFAULT_CONFIG.reevalMaxPieces,
  meanLines: 0,
  meanHeight: 3,
  meanClearCounts: { singles: 0, doubles: 0, triples: 0, tetrises: 0 },
  tetrisLineShare: 0,
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

const bestEverFrom = (evaluation: LoggedEvaluation) => ({
  ...evaluation,
  evalGames: DEFAULT_CONFIG.reevalGames,
  evalMaxPieces: DEFAULT_CONFIG.reevalMaxPieces,
});

const snapshotDirectory = (outputDir: string) => {
  const entries = readdirSync(outputDir).sort();
  return {
    entries,
    files: entries.map((entry) => [entry, readFileSync(join(outputDir, entry))] as const),
  };
};

const runTrain = (
  outputDir: string,
  resume: boolean,
  repositoryRoot = ROOT,
) => spawnSync(process.execPath, [
  '--import', 'tsx',
  resolve(repositoryRoot, 'training/train.ts'),
  ...(resume ? ['--resume'] : []),
  '--generations', '0',
  '--workers', '1',
  '--output-dir', outputDir,
], { cwd: ROOT, encoding: 'utf8' });

const expectRejectedBeforeWorkersOrWrites = (
  outputDir: string,
  before: ReturnType<typeof snapshotDirectory>,
  resume: boolean,
) => {
  const result = runTrain(outputDir, resume);
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/training with .* workers/);
  expect(snapshotDirectory(outputDir)).toEqual(before);
};

describe('train --resume objective gate', () => {
  it('rejects a score-rate-v1 checkpoint before workers or writes', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'tetris-old-checkpoint-'));
    const checkpointPath = join(outputDir, 'checkpoint.json');
    const logPath = join(outputDir, 'training-log.jsonl');
    try {
      writeFileSync(checkpointPath, JSON.stringify({
        version: 2,
        objective: 'score-rate-v1',
      }));
      writeFileSync(logPath, '{"sentinel":true}\n');
      const beforeEntries = readdirSync(outputDir).sort();
      const beforeCheckpoint = readFileSync(checkpointPath);
      const beforeLog = readFileSync(logPath);

      const result = spawnSync(process.execPath, [
        '--import', 'tsx',
        resolve(ROOT, 'training/train.ts'),
        '--resume',
        '--output-dir', outputDir,
      ], { cwd: ROOT, encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(
        /score-rate-v1.*score-rate-v2/,
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/training with .* workers/);
      expect(readdirSync(outputDir).sort()).toEqual(beforeEntries);
      expect(readFileSync(checkpointPath)).toEqual(beforeCheckpoint);
      expect(readFileSync(logPath)).toEqual(beforeLog);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('rejects a malformed tagged v2 checkpoint before workers or writes', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'tetris-malformed-checkpoint-'));
    const checkpointPath = join(outputDir, 'checkpoint.json');
    const logPath = join(outputDir, 'training-log.jsonl');
    try {
      writeFileSync(checkpointPath, JSON.stringify({
        version: 3,
        objective: 'score-rate-v2',
        gen: 0,
        mu: Array(FEATURE_COUNT - 1).fill(0),
        sigma: Array(FEATURE_COUNT).fill(1),
        baseSeed: DEFAULT_CONFIG.baseSeed,
        maxPieces: DEFAULT_CONFIG.initialMaxPieces,
        config: { ...DEFAULT_CONFIG },
        bestEver: null,
      }));
      writeFileSync(logPath, '{"sentinel":true}\n');
      const beforeEntries = readdirSync(outputDir).sort();
      const beforeCheckpoint = readFileSync(checkpointPath);
      const beforeLog = readFileSync(logPath);

      const result = spawnSync(process.execPath, [
        '--import', 'tsx',
        resolve(ROOT, 'training/train.ts'),
        '--resume',
        '--generations', '0',
        '--workers', '1',
        '--output-dir', outputDir,
      ], { cwd: ROOT, encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/training with .* workers/);
      expect(readdirSync(outputDir).sort()).toEqual(beforeEntries);
      expect(readFileSync(checkpointPath)).toEqual(beforeCheckpoint);
      expect(readFileSync(logPath)).toEqual(beforeLog);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['invalid JSON', () => ({ checkpoint: validCheckpoint(), log: '{bad json}\n' })],
    ['a truncated tail', () => ({
      checkpoint: validCheckpoint(),
      log: JSON.stringify(validGeneration(0)),
    })],
    ['a v1 log', () => ({
      checkpoint: validCheckpoint(),
      log: `${JSON.stringify({ ...validGeneration(0), objective: 'score-rate-v1' })}\n`,
    })],
    ['mixed objectives', () => ({
      checkpoint: validCheckpoint(2),
      log: [
        validGeneration(0),
        { ...validGeneration(1), objective: 'score-rate-v1' },
      ].map((record) => JSON.stringify(record)).join('\n') + '\n',
    })],
    ['missing generation history', () => ({ checkpoint: validCheckpoint(), log: '' })],
    ['a gen-0 checkpoint with an empty log', () => ({
      checkpoint: validCheckpoint(0),
      log: '',
    })],
    ['a malformed generation record', () => ({
      checkpoint: validCheckpoint(),
      log: `${JSON.stringify({ objective: 'score-rate-v2', gen: 0 })}\n`,
    })],
    ['missing reevaluation history', () => {
      const checkpoint = validCheckpoint();
      checkpoint.config.reevalEvery = 1;
      return { checkpoint, log: `${JSON.stringify(validGeneration(0))}\n` };
    }],
    ['a first reevaluation without the generation -1 baseline', () => {
      const currentBest = evaluated(0, 25_000);
      const candidate = evaluated(1, 25_100, axisVector(1));
      const checkpoint = {
        ...validCheckpoint(),
        config: { ...DEFAULT_CONFIG, reevalEvery: 1 },
        bestEver: bestEverFrom(candidate),
      };
      const log = [
        validGeneration(0),
        reevaluationRecord(1, currentBest, candidate, 'publish', 'higher-score'),
      ].map((record) => JSON.stringify(record)).join('\n') + '\n';
      return { checkpoint, log };
    }],
    ['a publish winner not forwarded to the next currentBest', () => {
      const baseline = evaluated(-1, 25_000);
      const published = evaluated(1, 25_100, axisVector(1));
      const laterCandidate = evaluated(2, 24_000, axisVector(2));
      const checkpoint = {
        ...validCheckpoint(2),
        config: { ...DEFAULT_CONFIG, reevalEvery: 1 },
        bestEver: bestEverFrom(published),
      };
      const log = [
        validGeneration(0),
        reevaluationRecord(1, baseline, published, 'publish', 'higher-score'),
        validGeneration(1),
        reevaluationRecord(2, baseline, laterCandidate, 'keep-current', 'lower-score'),
      ].map((record) => JSON.stringify(record)).join('\n') + '\n';
      return { checkpoint, log };
    }],
    ['a checkpoint bestEver that differs from the replayed winner', () => {
      const baseline = evaluated(-1, 25_000);
      const candidate = evaluated(1, 25_100, axisVector(1));
      const checkpoint = {
        ...validCheckpoint(),
        config: { ...DEFAULT_CONFIG, reevalEvery: 1 },
        bestEver: bestEverFrom({ ...candidate, weights: axisVector(2) }),
      };
      const log = [
        validGeneration(0),
        reevaluationRecord(1, baseline, candidate, 'publish', 'higher-score'),
      ].map((record) => JSON.stringify(record)).join('\n') + '\n';
      return { checkpoint, log };
    }],
    ['a generation cap that disagrees with replayed scheduling', () => ({
      checkpoint: { ...validCheckpoint(2), maxPieces: 600 },
      log: [
        validGeneration(0, 300, 0),
        validGeneration(1, 301, 300),
      ].map((record) => JSON.stringify(record)).join('\n') + '\n',
    })],
  ])('rejects %s before workers or writes', (_label, fixture) => {
    const outputDir = mkdtempSync(join(tmpdir(), 'tetris-invalid-log-'));
    try {
      const { checkpoint, log } = fixture();
      writeFileSync(join(outputDir, 'checkpoint.json'), JSON.stringify(checkpoint));
      writeFileSync(join(outputDir, 'training-log.jsonl'), log);
      writeFileSync(join(outputDir, 'sentinel.bin'), Buffer.from([0, 1, 2, 255]));
      const before = snapshotDirectory(outputDir);

      expectRejectedBeforeWorkersOrWrites(outputDir, before, true);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('train fresh-run output directory gate', () => {
  it.each([
    ['an empty training log', 'training-log.jsonl', ''],
    ['an unrelated leftover file', 'leftover.txt', 'sentinel'],
  ])('rejects %s before workers or writes', (_label, name, contents) => {
    const outputDir = mkdtempSync(join(tmpdir(), 'tetris-nonempty-output-'));
    try {
      writeFileSync(join(outputDir, name), contents);
      const before = snapshotDirectory(outputDir);

      expectRejectedBeforeWorkersOrWrites(outputDir, before, false);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('train --generations argument gate', () => {
  it.each([
    ['zero', '0', false],
    ['negative', '-1', false],
    ['fractional', '1.5', true],
  ])('rejects a fresh %s generation target before output writes', (_label, value, useFile) => {
    const parent = mkdtempSync(join(tmpdir(), 'tetris-generation-arg-'));
    const outputDir = join(parent, 'output');
    if (useFile) writeFileSync(outputDir, 'sentinel');
    try {
      const result = spawnSync(process.execPath, [
        '--import', 'tsx',
        resolve(ROOT, 'training/train.ts'),
        '--generations', value,
        '--workers', '1',
        '--output-dir', outputDir,
      ], { cwd: ROOT, encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(
        /--generations.*(?:safe integer|integer|greater than 0|positive)/i,
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/training with .* workers/);
      if (useFile) expect(readFileSync(outputDir, 'utf8')).toBe('sentinel');
      else expect(() => readdirSync(outputDir)).toThrow();
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('keeps a legal generation-zero resume probe read-only', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'tetris-read-only-resume-'));
    try {
      writeFileSync(join(outputDir, 'checkpoint.json'), JSON.stringify(validCheckpoint()));
      writeFileSync(
        join(outputDir, 'training-log.jsonl'),
        `${JSON.stringify(validGeneration(0))}\n`,
      );
      writeFileSync(join(outputDir, 'sentinel.bin'), Buffer.from([0, 1, 2, 255]));
      const before = snapshotDirectory(outputDir);

      const result = runTrain(outputDir, true);

      expect(result.status).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/training with .* workers/);
      expect(snapshotDirectory(outputDir)).toEqual(before);
      const nextOwner = acquireRunLock(ROOT);
      nextOwner.release();
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('train SIGINT lifecycle', () => {
  it.each([
    ['one', 1, 0],
    ['two', 2, 1],
  ])('handles %s real process SIGINT event(s) through destroy then release', (
    _label,
    signalCount,
    expectedStatus,
  ) => {
    const parent = mkdtempSync(join(tmpdir(), 'tetris-sigint-lifecycle-'));
    const outputDir = join(parent, 'output');
    const preloadPath = join(parent, 'signal-preload.mjs');
    const tracePath = join(parent, 'trace.log');
    writeFileSync(preloadPath, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Worker } from 'node:worker_threads';

const trace = (event) => fs.appendFileSync(process.env.TRACE_PATH, event + '\\n');
const originalUnlink = fs.unlinkSync;
fs.unlinkSync = function (path, ...args) {
  if (String(path).includes('tetris-trainer-')) trace('release');
  return originalUnlink.call(this, path, ...args);
};
syncBuiltinESMExports();

const originalTerminate = Worker.prototype.terminate;
Worker.prototype.terminate = function (...args) {
  trace('destroy');
  return originalTerminate.apply(this, args);
};

process.exit = function (code) {
  trace('process.exit:' + String(code ?? 0));
  process.exitCode = Number(code ?? 0);
};

const signalCount = Number(process.env.SIGNAL_COUNT);
const originalOn = process.on;
let emitted = false;
process.on = function (event, listener) {
  const result = originalOn.call(this, event, listener);
  if (event === 'SIGINT' && !emitted) {
    emitted = true;
    for (let i = 0; i < signalCount; i++) {
      trace('sigint');
      process.emit('SIGINT');
    }
  }
  return result;
};
`);
    try {
      // Resume at the already-completed target so the child exercises only
      // worker/signal/resource teardown, never a training generation.
      const checkpoint = validCheckpoint();
      mkdirSync(outputDir);
      writeFileSync(join(outputDir, 'checkpoint.json'), JSON.stringify(checkpoint));
      writeFileSync(
        join(outputDir, 'training-log.jsonl'),
        `${JSON.stringify(validGeneration(0))}\n`,
      );

      const result = spawnSync(process.execPath, [
        '--import', pathToFileURL(preloadPath).href,
        '--import', 'tsx',
        resolve(ROOT, 'training/train.ts'),
        '--resume',
        '--generations', '1',
        '--workers', '1',
        '--output-dir', outputDir,
      ], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          SIGNAL_COUNT: String(signalCount),
          TRACE_PATH: tracePath,
        },
      });

      const trace = readFileSync(tracePath, 'utf8').trim().split('\n');
      expect(result.status).toBe(expectedStatus);
      expect(trace.filter((event) => event === 'sigint')).toHaveLength(signalCount);
      expect(trace.some((event) => event.startsWith('process.exit:'))).toBe(false);
      expect(trace.indexOf('destroy')).toBeGreaterThan(-1);
      expect(trace.indexOf('release')).toBeGreaterThan(trace.indexOf('destroy'));
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('destroys workers before releasing the lock after a runtime failure', () => {
    const parent = mkdtempSync(join(tmpdir(), 'tetris-runtime-failure-lifecycle-'));
    const outputDir = join(parent, 'output');
    const preloadPath = join(parent, 'runtime-failure-preload.mjs');
    const tracePath = join(parent, 'trace.log');
    writeFileSync(preloadPath, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Worker } from 'node:worker_threads';

const trace = (event) => fs.appendFileSync(process.env.TRACE_PATH, event + '\\n');
const originalUnlink = fs.unlinkSync;
fs.unlinkSync = function (path, ...args) {
  if (String(path).includes('tetris-trainer-')) trace('release');
  return originalUnlink.call(this, path, ...args);
};

const originalTerminate = Worker.prototype.terminate;
Worker.prototype.terminate = function (...args) {
  trace('destroy');
  return originalTerminate.apply(this, args);
};
syncBuiltinESMExports();
`);
    const checkpointPath = join(outputDir, 'checkpoint.json');
    try {
      mkdirSync(outputDir);
      writeFileSync(checkpointPath, JSON.stringify(validCheckpoint()));
      writeFileSync(
        join(outputDir, 'training-log.jsonl'),
        `${JSON.stringify(validGeneration(0))}\n`,
      );
      const before = snapshotDirectory(outputDir);
      chmodSync(checkpointPath, 0o444);

      const result = spawnSync(process.execPath, [
        '--import', pathToFileURL(preloadPath).href,
        '--import', 'tsx',
        resolve(ROOT, 'training/train.ts'),
        '--resume',
        '--generations', '1',
        '--workers', '1',
        '--output-dir', outputDir,
      ], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 5_000,
        env: { ...process.env, TRACE_PATH: tracePath },
      });

      const trace = readFileSync(tracePath, 'utf8').trim().split('\n');
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/EPERM|permission|operation not permitted/i);
      expect(snapshotDirectory(outputDir)).toEqual(before);
      expect(trace.indexOf('destroy')).toBeGreaterThan(-1);
      expect(trace.indexOf('release')).toBeGreaterThan(trace.indexOf('destroy'));
      const nextOwner = acquireRunLock(ROOT);
      nextOwner.release();
    } finally {
      if (existsSync(checkpointPath)) chmodSync(checkpointPath, 0o666);
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('train output-directory lock', () => {
  it.each([
    ['the same output directory', false],
    ['a different output directory', true],
  ])('rejects a trainer for %s while the repository lock is held', (_label, separateOutput) => {
    const outputDir = mkdtempSync(join(tmpdir(), 'tetris-locked-output-'));
    const competingOutput = separateOutput
      ? mkdtempSync(join(tmpdir(), 'tetris-other-output-'))
      : outputDir;
    const lock = acquireRunLock(ROOT);
    try {
      writeFileSync(
        join(competingOutput, 'checkpoint.json'),
        JSON.stringify(validCheckpoint()),
      );
      writeFileSync(
        join(competingOutput, 'training-log.jsonl'),
        `${JSON.stringify(validGeneration(0))}\n`,
      );
      const before = snapshotDirectory(competingOutput);

      expectRejectedBeforeWorkersOrWrites(competingOutput, before, true);
    } finally {
      lock.release();
      rmSync(outputDir, { recursive: true, force: true });
      if (competingOutput !== outputDir) {
        rmSync(competingOutput, { recursive: true, force: true });
      }
    }
  });

  it.each([
    ['junction', 'junction' as const],
    ['symbolic link', 'dir' as const],
  ])('cannot bypass the repository lock through a %s CLI path', (_label, type) => {
    const aliasParent = mkdtempSync(join(tmpdir(), 'tetris-repository-alias-'));
    const repositoryAlias = join(aliasParent, 'repo');
    const outputDir = mkdtempSync(join(tmpdir(), 'tetris-aliased-cli-output-'));
    symlinkSync(ROOT, repositoryAlias, type);
    const lock = acquireRunLock(ROOT);
    try {
      writeFileSync(join(outputDir, 'checkpoint.json'), JSON.stringify(validCheckpoint()));
      writeFileSync(
        join(outputDir, 'training-log.jsonl'),
        `${JSON.stringify(validGeneration(0))}\n`,
      );
      const before = snapshotDirectory(outputDir);
      const result = runTrain(outputDir, true, repositoryAlias);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/locked|another trainer/i);
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/training with .* workers/);
      expect(snapshotDirectory(outputDir)).toEqual(before);
    } finally {
      lock.release();
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(aliasParent, { recursive: true, force: true });
    }
  });

  const optionalAliases = [
    ['UNC', 'TETRIS_TEST_REPOSITORY_UNC_ALIAS'],
    ['mapped-drive', 'TETRIS_TEST_REPOSITORY_MAPPED_ALIAS'],
  ] as const;
  for (const [label, variable] of optionalAliases) {
    const alias = process.env[variable];
    if (process.platform !== 'win32' || alias === undefined) {
      it.skip(
        `skips ${label} lock alias integration: set ${variable} to a real alias of the repository`,
        () => {},
      );
      continue;
    }

    it(`cannot bypass the repository lock through the configured ${label} alias`, () => {
      const canonical = (path: string) => realpathSync.native(path)
        .replaceAll('\\', '/')
        .toLowerCase();
      expect(canonical(alias)).toBe(canonical(ROOT));
      const outputDir = mkdtempSync(join(tmpdir(), `tetris-${label}-alias-output-`));
      const lock = acquireRunLock(ROOT);
      try {
        writeFileSync(join(outputDir, 'checkpoint.json'), JSON.stringify(validCheckpoint()));
        writeFileSync(
          join(outputDir, 'training-log.jsonl'),
          `${JSON.stringify(validGeneration(0))}\n`,
        );
        const before = snapshotDirectory(outputDir);
        const result = runTrain(outputDir, true, alias);

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toMatch(/locked|another trainer/i);
        expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/training with .* workers/);
        expect(snapshotDirectory(outputDir)).toEqual(before);
      } finally {
        lock.release();
        rmSync(outputDir, { recursive: true, force: true });
      }
    });
  }
});
