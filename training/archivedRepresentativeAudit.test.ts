import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashSeed } from '../src/ai/rng';
import { fixedReevaluationSeeds } from './publication';
import type { SimTask, SimTaskResult } from './pool';
import type { ScoreRateCheckpoint } from './runArtifacts';
import {
  C0_BASE_SEED,
  C0InvalidInputError,
  C0_GAMES,
  C0_MAX_PIECES,
  C0_SEED_DIGEST,
  C0_SOURCE_HASHES,
  C0_VECTOR_ORDER,
  C0_VECTOR_DIGESTS,
  assertC0SeedSeparation,
  buildC0PrimaryTasks,
  buildC0Schedule,
  evaluateC0Audit,
  failureC0Audit,
  loadC0ValidatedRunSnapshot,
  loadC0Sources,
  projectC0PrimaryResults,
  runC0Audit,
  runC0AuditCli,
  serializeC0Audit,
  type C0AuditDependencies,
  type C0Pool,
  type C0GameRecord,
  type C0SourceBundle,
  type C0SourceDependencies,
  type C0ValidatedRunSnapshot,
  type C0VectorId,
} from './archivedRepresentativeAudit';

type SourceMutation =
  | 'missing-gen6' | 'duplicate-gen6' | 'renormalized-gen6'
  | 'wrong-gen9-digest' | 'wrong-raw-mu-digest'
  | 'wrong-normalized-mu-digest' | 'qualified-candidate-present'
  | 'generation-count-not-ten' | 'reevaluation-not-final'
  | 'wrong-version' | 'wrong-objective';

type MutableLogRecord = Record<string, unknown> & {
  gen: number;
  bestWeights?: number[];
  kind?: string;
};

const PUBLISHED_BASELINE = [
  -0.03136702939998303, -0.49514382541551616, 0.07930716210288993,
  -0.06480046456829196, 0.14840680564236144, -0.300289317086154,
  -0.5541884383921293, -0.4223801328449683, -0.27054182855840314,
  0.2691450141912839, 0, 0, 0,
];
const GEN6_BEST = [
  0.02185020330641181, -0.32193032364733, 0.24091173061177176,
  0.18568120986878886, -0.2568364480695082, -0.4468631052350419,
  -0.442665035753348, -0.4321598442115847, -0.16432404098948294,
  -0.18408869290566268, 0.19987304080346108, 0.23042001961989378,
  -0.03267637981563334,
];
const GEN9_BEST = [
  -0.0698417594905203, 0.11051937184989932, -0.5469450555794332,
  0.2210366964381046, -0.030384760638833136, -0.03348790118386401,
  -0.18389285544100184, -0.39460398483620973, -0.2648930743038742,
  0.05229314998960565, 0.3524255406240832, 0.45374312965477115,
  -0.20084426305820857,
];
const RAW_GEN10_MU = [
  -0.32308188574661295, -0.1380786127962525, -0.1827990265695491,
  0.1679900341497466, -0.0006042437943203343, -0.11895518210542955,
  -0.10370567102993666, -0.31156851199214525, -0.13318521092623947,
  0.17331741246784807, 0.12773366674138667, 0.14468594791202222,
  -0.06089197043033354,
];

const deep = <T>(value: T): T => structuredClone(value);

function validCheckpoint(): ScoreRateCheckpoint {
  return deep({
    version: 6, objective: 'score-rate-v5', gen: 10, mu: RAW_GEN10_MU,
    sigma: Array(13).fill(1), baseSeed: 20260727, maxPieces: 2000,
    config: {
      population: 100, eliteFrac: 0.1, gamesPerCandidate: 5, initialMaxPieces: 300,
      maxPiecesCap: 2000, initialNoise: 0.5, noiseDecay: 0.95, noiseFloor: 0.01,
      baseSeed: 20260727, workers: 4, reevalEvery: 10, reevalGames: 30,
      reevalMaxPieces: 5000,
    },
    publishedBaseline: { weights: PUBLISHED_BASELINE, gen: -1 } as ScoreRateCheckpoint['publishedBaseline'],
    bestQualifiedCandidate: null,
    searchContract: 'bag-expectimax-hold-v2', searchDepth: 4, rootBeamWidth: 64,
    childBeamWidth: 32, maxWorkUnits: 3584, budgetCorpus: 'budget-corpus-v1',
    transpositionCacheEntries: 65536, placementCacheEntries: 16384,
  });
}

function validSourceDependencies(overrides?: {
  hashes?: Partial<C0SourceBundle['sourceHashes']>;
}): C0SourceDependencies {
  const records: MutableLogRecord[] = Array.from({ length: 10 }, (_, gen) => ({
    gen, bestWeights: gen === 6 ? GEN6_BEST : gen === 9 ? GEN9_BEST : PUBLISHED_BASELINE,
  }));
  records.push({ kind: 'reevaluation', gen: 10 });
  const hashes = { ...C0_SOURCE_HASHES, ...overrides?.hashes };
  const dependencies: C0SourceDependencies = {
    root: '/fixture',
    hashRegularFile: (path) => path.endsWith('checkpoint.json') ? hashes.checkpoint
      : path.endsWith('training-log.jsonl') ? hashes.log
      : path.replaceAll('\\', '/').endsWith('src/ai/trained-weights.json') ? hashes.bundledWeights
      : hashes.runtimeWeights,
    readPublishedVector: () => deep(PUBLISHED_BASELINE),
    loadValidatedRunSnapshot: () => ({
      checkpoint: validCheckpoint(), records: deep(records),
      sourceHashes: { checkpoint: hashes.checkpoint, log: hashes.log },
    }),
  };
  return dependencies;
}

function mutatedSourceDependencies(mutation: SourceMutation): C0SourceDependencies {
  const dependencies = validSourceDependencies();
  const checkpoint = validCheckpoint();
  const records: MutableLogRecord[] = Array.from({ length: 10 }, (_, gen) => ({
    gen, bestWeights: gen === 6 ? [...GEN6_BEST] : gen === 9 ? [...GEN9_BEST] : [...PUBLISHED_BASELINE],
  }));
  records.push({ kind: 'reevaluation', gen: 10 });
  if (mutation === 'missing-gen6') records.splice(6, 1);
  if (mutation === 'duplicate-gen6') records.splice(7, 0, deep(records[6]));
  if (mutation === 'renormalized-gen6') (records[6].bestWeights as number[])[0] *= 2;
  if (mutation === 'wrong-gen9-digest') (records[9].bestWeights as number[])[0] += 1;
  if (mutation === 'wrong-raw-mu-digest') checkpoint.mu[0] += 1;
  if (mutation === 'wrong-normalized-mu-digest') checkpoint.mu[0] *= 2;
  if (mutation === 'qualified-candidate-present') checkpoint.bestQualifiedCandidate = {} as ScoreRateCheckpoint['bestQualifiedCandidate'];
  if (mutation === 'generation-count-not-ten') records.pop();
  if (mutation === 'reevaluation-not-final') records[10] = { kind: 'reevaluation', gen: 9 };
  if (mutation === 'wrong-version') (checkpoint as { version: number }).version = 5;
  if (mutation === 'wrong-objective') (checkpoint as { objective: string }).objective = 'score-rate-v4';
  return { ...dependencies, loadValidatedRunSnapshot: () => ({
    checkpoint: deep(checkpoint), records: deep(records),
    sourceHashes: { checkpoint: C0_SOURCE_HASHES.checkpoint, log: C0_SOURCE_HASHES.log },
  }) };
}

function trainingSeeds(checkpoint: ScoreRateCheckpoint): number[] {
  return Array.from({ length: 10 }, (_, gen) =>
    Array.from({ length: checkpoint.config.gamesPerCandidate }, (_, gameIndex) =>
      hashSeed(checkpoint.baseSeed, gen, gameIndex))).flat();
}

function historicalPairedSeeds(): number[] {
  return Array.from({ length: 30 }, (_, gameIndex) => hashSeed(20260803, gameIndex));
}

const PUBLISHED_WEIGHT_NAMES = [
  'aggregateHeight', 'holes', 'bumpiness', 'maxHeight', 'linesCleared',
  'landingHeight', 'rowTransitions', 'colTransitions', 'wellDepth', 'lineClearValue',
] as const;

interface VirtualArtifactVersion {
  bytes: Buffer;
  signatureVersion: bigint;
}

interface VirtualArtifact {
  ino: bigint;
  versions: readonly [VirtualArtifactVersion, VirtualArtifactVersion?];
  driftOnRead?: number;
  absentLstatCalls?: number;
  failOpenOnRead?: number;
  lstatCalls: number;
  completedReads: number;
  activeVersion: number | null;
}

interface DefaultAdapterHarness {
  checkpointBuffer: Buffer;
  logBuffer: Buffer;
  candidateBuffer: Buffer | null;
  logToString: { mock: { calls: Parameters<Buffer['toString']>[] } };
  pathValidator: ReturnType<typeof vi.fn>;
  snapshotValidator: ReturnType<typeof vi.fn>;
  capturedSnapshots: Array<{
    checkpointBytes: Uint8Array;
    logBytes: Uint8Array;
    candidateBytes: Uint8Array | null;
  }>;
  logToStringCallsAtValidation: number[];
}

function publishedWeightsBytes(): Buffer {
  const weights = Object.fromEntries(PUBLISHED_WEIGHT_NAMES.map((name, index) => [
    name, PUBLISHED_BASELINE[index],
  ]));
  return Buffer.from(JSON.stringify({
    version: 3,
    objective: 'score-rate-v2',
    weights,
    meanScore: 0,
    evalMaxPieces: 5000,
    meanLines: 5,
    meanHeight: 4,
    meanClearCounts: { singles: 3, doubles: 1, triples: 0, tetrises: 0 },
    tetrisLineShare: 0,
    evalGames: 30,
    gen: 40,
    searchDepth: 2,
    trainedAt: '2026-08-10T12:21:46.191Z',
  }), 'utf8');
}

async function withDefaultAdapterHarness<T>(
  options: {
    candidatePresent?: boolean;
    candidateAppearsAfterAbsence?: boolean;
    driftLogOnRead?: number;
    failLogOpenOnRead?: number;
    failBundledOpenOnRead?: number;
  },
  action: (
    audit: typeof import('./archivedRepresentativeAudit'),
    harness: DefaultAdapterHarness,
  ) => T | Promise<T>,
): Promise<T> {
  const checkpointBuffer = Buffer.from(JSON.stringify(validCheckpoint()), 'utf8');
  const logRecords: MutableLogRecord[] = Array.from({ length: 10 }, (_, gen) => ({
    gen, bestWeights: gen === 6 ? GEN6_BEST : gen === 9 ? GEN9_BEST : PUBLISHED_BASELINE,
  }));
  logRecords.push({ kind: 'reevaluation', gen: 10 });
  const logBuffer = Buffer.from(`${logRecords.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  const candidateBuffer = options.candidatePresent || options.candidateAppearsAfterAbsence
    ? Buffer.from('{"unexpected":"archived-candidate"}', 'utf8')
    : null;
  const publishedBuffer = publishedWeightsBytes();
  const sourceHashes = new Map<string, string>([
    [checkpointBuffer.toString('base64'), C0_SOURCE_HASHES.checkpoint],
    [logBuffer.toString('base64'), C0_SOURCE_HASHES.log],
    [publishedBuffer.toString('base64'), C0_SOURCE_HASHES.bundledWeights],
  ]);
  const logToString = vi.spyOn(logBuffer, 'toString');
  const artifacts = new Map<string, VirtualArtifact>();
  const artifact = (
    key: string,
    ino: bigint,
    bytes: Buffer,
    driftOnRead?: number,
    absentLstatCalls?: number,
  ): void => {
    const drifted = Buffer.from(bytes);
    if (driftOnRead !== undefined) drifted[0] = drifted[0] === 0x7b ? 0x5b : 0x7b;
    artifacts.set(key, {
      ino,
      versions: [
        { bytes, signatureVersion: 1n },
        { bytes: drifted, signatureVersion: 2n },
      ],
      driftOnRead,
      absentLstatCalls,
      lstatCalls: 0,
      completedReads: 0,
      activeVersion: null,
    });
  };
  artifact('/checkpoint.json', 11n, checkpointBuffer);
  artifact('/training-log.jsonl', 12n, logBuffer, options.driftLogOnRead);
  artifacts.get('/training-log.jsonl')!.failOpenOnRead = options.failLogOpenOnRead;
  artifact('/src/ai/trained-weights.json', 13n, publishedBuffer);
  artifacts.get('/src/ai/trained-weights.json')!.failOpenOnRead = options.failBundledOpenOnRead;
  artifact('/public/ai/best-weights.json', 14n, Buffer.from(publishedBuffer));
  if (candidateBuffer !== null) {
    artifact(
      '/candidate-weights.json',
      15n,
      candidateBuffer,
      undefined,
      options.candidateAppearsAfterAbsence ? 1 : undefined,
    );
  }

  const normalizedPath = (value: unknown): string => String(value).replaceAll('\\', '/').toLowerCase();
  const findArtifact = (value: unknown): VirtualArtifact | undefined => {
    const normalized = normalizedPath(value);
    const keys = [...artifacts.keys()].sort((left, right) => right.length - left.length);
    const key = keys.find((suffix) => normalized.endsWith(suffix));
    return key === undefined ? undefined : artifacts.get(key);
  };
  const versionFor = (entry: VirtualArtifact): number => entry.activeVersion ?? (
    entry.driftOnRead !== undefined && entry.completedReads + 1 >= entry.driftOnRead ? 1 : 0
  );
  const statsFor = (entry: VirtualArtifact, versionIndex = versionFor(entry)) => {
    const version = entry.versions[versionIndex]!;
    return {
      dev: 1n,
      ino: entry.ino,
      size: BigInt(version.bytes.length),
      mtimeNs: version.signatureVersion,
      ctimeNs: version.signatureVersion,
      birthtimeNs: 1n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
  };
  const missing = (path: unknown): NodeJS.ErrnoException => {
    const error = new Error(`ENOENT: no such file or directory, lstat '${String(path)}'`) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    return error;
  };
  const syscallFailure = (operation: string, path: unknown): NodeJS.ErrnoException => {
    const error = new Error(`EIO: virtual ${operation} failure '${String(path)}'`) as NodeJS.ErrnoException;
    error.code = 'EIO';
    return error;
  };

  let nextDescriptor = 100;
  const descriptors = new Map<number, { entry: VirtualArtifact; version: number }>();
  const capturedSnapshots: DefaultAdapterHarness['capturedSnapshots'] = [];
  const logToStringCallsAtValidation: number[] = [];
  const pathValidator = vi.fn(() => {
    throw new Error('ABA sentinel: path-based run validator reopened checkpoint/log');
  });
  const snapshotValidator = vi.fn((snapshot: DefaultAdapterHarness['capturedSnapshots'][number]) => {
    capturedSnapshots.push(snapshot);
    logToStringCallsAtValidation.push(logToString.mock.calls.length);
    if (snapshot.candidateBytes !== null) {
      throw new Error('candidate weights are forbidden without a qualified candidate');
    }
    return JSON.parse(Buffer.from(snapshot.checkpointBytes).toString('utf8')) as ScoreRateCheckpoint;
  });
  const harness: DefaultAdapterHarness = {
    checkpointBuffer,
    logBuffer,
    candidateBuffer,
    logToString,
    pathValidator,
    snapshotValidator,
    capturedSnapshots,
    logToStringCallsAtValidation,
  };

  vi.resetModules();
  vi.doMock('node:fs', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    return {
      ...actual,
      lstatSync: (path: unknown) => {
        const entry = findArtifact(path);
        if (entry === undefined) throw missing(path);
        entry.lstatCalls += 1;
        if (entry.absentLstatCalls !== undefined && entry.lstatCalls <= entry.absentLstatCalls) {
          throw missing(path);
        }
        return statsFor(entry);
      },
      openSync: (path: unknown) => {
        const entry = findArtifact(path);
        if (entry === undefined) throw missing(path);
        if (entry.failOpenOnRead === entry.completedReads + 1) {
          throw syscallFailure('open', path);
        }
        const descriptor = nextDescriptor++;
        const version = versionFor(entry);
        entry.activeVersion = version;
        descriptors.set(descriptor, { entry, version });
        return descriptor;
      },
      fstatSync: (descriptor: number) => {
        const opened = descriptors.get(descriptor);
        if (opened === undefined) throw new Error(`unknown virtual descriptor ${descriptor}`);
        return statsFor(opened.entry, opened.version);
      },
      readFileSync: (descriptor: unknown, readOptions?: unknown) => {
        if (typeof descriptor !== 'number') {
          return actual.readFileSync(descriptor as never, readOptions as never);
        }
        const opened = descriptors.get(descriptor);
        if (opened === undefined) throw new Error(`unknown virtual descriptor ${descriptor}`);
        const bytes = opened.entry.versions[opened.version]!.bytes;
        return opened.entry.completedReads === 0 ? bytes : Buffer.from(bytes);
      },
      closeSync: (descriptor: number) => {
        const opened = descriptors.get(descriptor);
        if (opened === undefined) throw new Error(`unknown virtual descriptor ${descriptor}`);
        opened.entry.completedReads += 1;
        opened.entry.activeVersion = null;
        descriptors.delete(descriptor);
      },
    };
  });
  vi.doMock('node:crypto', async () => {
    const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
    return {
      ...actual,
      createHash: (algorithm: string) => {
        const hash = actual.createHash(algorithm);
        let frozenSourceHash: string | undefined;
        const facade = {
          update(data: string | NodeJS.ArrayBufferView, inputEncoding?: BufferEncoding) {
            const bytes = typeof data === 'string'
              ? Buffer.from(data, inputEncoding)
              : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
            frozenSourceHash = sourceHashes.get(bytes.toString('base64')) ?? frozenSourceHash;
            if (typeof data === 'string') {
              if (inputEncoding === undefined) {
                hash.update(data);
              } else {
                hash.update(data, inputEncoding);
              }
            } else {
              hash.update(data);
            }
            return facade;
          },
          digest(encoding?: 'hex') {
            if (frozenSourceHash !== undefined) {
              return encoding === 'hex'
                ? frozenSourceHash.toLowerCase()
                : Buffer.from(frozenSourceHash, 'hex');
            }
            return encoding === undefined ? hash.digest() : hash.digest(encoding);
          },
        };
        return facade;
      },
    };
  });
  vi.doMock('./runArtifacts', async () => {
    const actual = await vi.importActual<typeof import('./runArtifacts')>('./runArtifacts');
    return {
      ...actual,
      readCompatibleRunArtifacts: pathValidator,
      validateCompatibleRunArtifactSnapshot: snapshotValidator,
    };
  });

  try {
    const audit = await import('./archivedRepresentativeAudit');
    return await action(audit, harness);
  } finally {
    vi.doUnmock('./runArtifacts');
    vi.doUnmock('node:crypto');
    vi.doUnmock('node:fs');
    vi.resetModules();
    vi.restoreAllMocks();
  }
}

function overlap(left: readonly number[], right: readonly number[]): number[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

describe('archived representative source closure', () => {
  it('uses one injected validated snapshot instead of reopening a separate validation or log-read seam', () => {
    const source = validSourceDependencies();
    const records: MutableLogRecord[] = Array.from({ length: 10 }, (_, gen) => ({
      gen,
      bestWeights: gen === 6 ? GEN6_BEST : PUBLISHED_BASELINE,
    }));
    records.push({ kind: 'reevaluation', gen: 10 });
    const snapshot: C0ValidatedRunSnapshot = {
      checkpoint: validCheckpoint(),
      records,
      sourceHashes: { checkpoint: C0_SOURCE_HASHES.checkpoint, log: C0_SOURCE_HASHES.log },
    };
    const loadValidatedRunSnapshot = vi.fn(() => snapshot);
    const dependencies = {
      ...source,
      loadValidatedRunSnapshot,
      hashRegularFile: () => { throw new Error('snapshot operation must own hashes'); },
    } as C0SourceDependencies;

    const result = loadC0ValidatedRunSnapshot(dependencies);
    records[6] = { gen: 6, bestWeights: [] };

    expect(loadValidatedRunSnapshot).toHaveBeenCalledOnce();
    expect(result.records[6]).toMatchObject({ gen: 6, bestWeights: GEN6_BEST });
  });

  it('binds candidate absence to the same pinned snapshot instead of reopening an ABA path', async () => {
    await withDefaultAdapterHarness({}, ({ loadC0Sources: loadDefaultSources }, harness) => {
      let sources: C0SourceBundle | undefined;
      let failure: unknown;
      try {
        sources = loadDefaultSources();
      } catch (error) {
        failure = error;
      }

      expect(harness.pathValidator).not.toHaveBeenCalled();
      expect(failure).toBeUndefined();
      expect(harness.snapshotValidator).toHaveBeenCalledOnce();
      expect(harness.capturedSnapshots[0]).toMatchObject({ candidateBytes: null });
      expect(harness.capturedSnapshots[0]!.checkpointBytes).toBe(harness.checkpointBuffer);
      expect(harness.capturedSnapshots[0]!.logBytes).toBe(harness.logBuffer);
      expect(harness.logToStringCallsAtValidation).toEqual([1]);
      expect(harness.logToString).toHaveBeenCalledTimes(2);
      expect(sources?.vectors.map(({ id }) => id)).toEqual(C0_VECTOR_ORDER);
    });
  });

  it('passes descriptor-stable candidate present bytes to the pinned snapshot validator and fails closed', async () => {
    await withDefaultAdapterHarness({ candidatePresent: true }, ({ loadC0Sources: loadDefaultSources }, harness) => {
      let failure: unknown;
      try {
        loadDefaultSources();
      } catch (error) {
        failure = error;
      }

      expect(harness.pathValidator).not.toHaveBeenCalled();
      expect(harness.snapshotValidator).toHaveBeenCalledOnce();
      expect(harness.capturedSnapshots[0]!.candidateBytes).toBe(harness.candidateBuffer);
      expect(Buffer.from(harness.capturedSnapshots[0]!.candidateBytes!)).toEqual(harness.candidateBuffer);
      expect(failure).toMatchObject({
        name: 'C0InvalidInputError',
        message: 'C0 invalid-input:run-contract-mismatch',
      });
    });
  });

  it('rejects candidate absence becoming present during pinned snapshot validation', async () => {
    await withDefaultAdapterHarness(
      { candidateAppearsAfterAbsence: true },
      ({ loadC0Sources: loadDefaultSources }, harness) => {
        let failure: unknown;
        try {
          loadDefaultSources();
        } catch (error) {
          failure = error;
        }

        expect(harness.snapshotValidator).toHaveBeenCalledOnce();
        expect(harness.capturedSnapshots[0]!.candidateBytes).toBeNull();
        expect(failure).toMatchObject({
          name: 'C0InvalidInputError',
          message: 'C0 invalid-input:source-identity-drift',
        });
      },
    );
  });

  it('maps a later pinned snapshot read drift to source identity drift', async () => {
    await withDefaultAdapterHarness({ driftLogOnRead: 2 }, ({ loadC0Sources: loadDefaultSources }, harness) => {
      let failure: unknown;
      try {
        loadDefaultSources();
      } catch (error) {
        failure = error;
      }

      expect(harness.pathValidator).not.toHaveBeenCalled();
      expect(harness.snapshotValidator).toHaveBeenCalledOnce();
      expect(failure).toMatchObject({
        name: 'C0InvalidInputError',
        message: 'C0 invalid-input:source-identity-drift',
      });
    });
  });

  it('maps a post-initial stable read open syscall failure to source identity drift', async () => {
    await withDefaultAdapterHarness(
      { failLogOpenOnRead: 2 },
      ({ loadC0Sources: loadDefaultSources }, harness) => {
        let failure: unknown;
        try {
          loadDefaultSources();
        } catch (error) {
          failure = error;
        }

        expect(harness.snapshotValidator).toHaveBeenCalledOnce();
        expect(failure).toMatchObject({
          name: 'C0InvalidInputError',
          message: 'C0 invalid-input:source-identity-drift',
        });
      },
    );
  });

  it('preserves published-vector stable read syscall drift as source identity drift', async () => {
    await withDefaultAdapterHarness(
      { failBundledOpenOnRead: 2 },
      ({ loadC0Sources: loadDefaultSources }) => {
        let failure: unknown;
        try {
          loadDefaultSources();
        } catch (error) {
          failure = error;
        }

        expect(failure).toMatchObject({
          name: 'C0InvalidInputError',
          message: 'C0 invalid-input:source-identity-drift',
        });
      },
    );
  });

  it('extracts only the four frozen vectors after strict schema-6 run validation', () => {
    const sources = loadC0Sources(validSourceDependencies());
    expect(sources.vectors.map(({ id, digest }) => ({ id, digest }))).toEqual([
      { id: 'published-baseline', digest: C0_VECTOR_DIGESTS['published-baseline'] },
      { id: 'gen6-best', digest: C0_VECTOR_DIGESTS['gen6-best'] },
      { id: 'gen9-best', digest: C0_VECTOR_DIGESTS['gen9-best'] },
      { id: 'gen10-mu', digest: C0_VECTOR_DIGESTS['gen10-mu'] },
    ]);
    expect(Math.hypot(...sources.vectors[0].weights)).toBeCloseTo(1.0000000000000002, 15);
    expect(Math.hypot(...sources.vectors[1].weights)).toBeCloseTo(0.9999999999999999, 15);
    expect(Math.hypot(...sources.vectors[2].weights)).toBeCloseTo(1, 15);
    expect(Math.hypot(...sources.vectors[3].weights)).toBeCloseTo(1.0000000000000002, 15);
  });

  it.each([
    ['checkpoint hash', { checkpoint: '0'.repeat(64) }],
    ['training log hash', { log: '0'.repeat(64) }],
    ['bundled weights hash', { bundledWeights: '0'.repeat(64) }],
    ['runtime weights hash', { runtimeWeights: '0'.repeat(64) }],
  ])('rejects a mismatched %s before any simulation dependency exists', (_label, hashes) => {
    expect(() => loadC0Sources(validSourceDependencies({ hashes })))
      .toThrowError(/invalid-input:source-hash-mismatch/);
  });

  it.each([
    'missing-gen6', 'duplicate-gen6', 'renormalized-gen6', 'wrong-gen9-digest',
    'wrong-raw-mu-digest', 'wrong-normalized-mu-digest', 'qualified-candidate-present',
    'generation-count-not-ten', 'reevaluation-not-final', 'wrong-version', 'wrong-objective',
  ] as const)('fails closed for %s', (mutation) => {
    expect(() => loadC0Sources(mutatedSourceDependencies(mutation)))
      .toThrowError(/^C0 invalid-input:/);
  });

  it.each([
    ['stale vector digest', (sources: C0SourceBundle) => { sources.vectors[0]!.weights[0] += 1; }],
    ['wrong source label', (sources: C0SourceBundle) => {
      (sources.vectors[0] as C0SourceBundle['vectors'][number] & { source: string }).source = 'gen=6.bestWeights';
    }],
    ['wrong authoritative source hash', (sources: C0SourceBundle) => {
      sources.sourceHashes.checkpoint = '0'.repeat(64);
    }],
  ])('rejects %s at the task boundary', (_label, mutate) => {
    const sources = validSources();
    mutate(sources);
    expect(() => buildC0PrimaryTasks(sources)).toThrowError('C0 runtime-fail:game-result-mismatch');
  });
});

describe('C0 seed isolation', () => {
  it('freezes thirty unique C0 seeds with zero historical overlap', () => {
    const checkpoint = validCheckpoint();
    const schedule = buildC0Schedule(checkpoint);
    expect(schedule.seeds).toHaveLength(30);
    expect(new Set(schedule.seeds).size).toBe(30);
    expect(schedule.seedDigest).toBe(C0_SEED_DIGEST);
    expect(schedule.taskOrder).toBe('seed-major');
    expect(overlap(schedule.seeds, trainingSeeds(checkpoint))).toEqual([]);
    expect(overlap(schedule.seeds, fixedReevaluationSeeds(20260727, 30))).toEqual([]);
    expect(overlap(schedule.seeds, historicalPairedSeeds())).toEqual([]);
  });

  it('rejects a duplicated or historically overlapping schedule', () => {
    expect(() => assertC0SeedSeparation(
      Array(30).fill(hashSeed(C0_BASE_SEED, 0)), validCheckpoint(),
    )).toThrowError(/invalid-input:seed-schedule-mismatch/);
  });
});

type GameMutation = 'failed' | 'error-reason' | 'non-finite-score' | 'bad-search' | 'bad-lines';
interface VerdictFixture { primary: C0GameRecord[]; replay: C0GameRecord[]; }

const hashProjection = (value: unknown): string => createHash('sha256')
  .update(JSON.stringify(value), 'utf8').digest('hex');

function validSources(): C0SourceBundle {
  return loadC0Sources(validSourceDependencies());
}

function vectorIdForWeights(weights: readonly number[]): C0VectorId {
  const source = validSources().vectors.find((vector) =>
    vector.weights.length === weights.length && vector.weights.every((value, index) => value === weights[index]));
  if (source === undefined) throw new Error('fixture weight vector is not frozen');
  return source.id;
}

function validResult(task: SimTask): SimTaskResult {
  return {
    taskId: task.taskId, score: 1000, lines: 5, pieces: C0_MAX_PIECES, meanHeight: 4,
    clearCounts: { singles: 1, doubles: 0, triples: 0, tetrises: 1 },
    strategyDiagnostics: { meanCleanWellDepth: 1, meanTetrisSetupProgress: 1, meanTetrisReadyRows: 1 },
    searchDiagnostics: {
      searchCalls: 10, holdActions: 2, holdRate: 0.2, meanCompletedDepth: 2,
      minCompletedDepth: 1, completedDepthHistogram: [0, 1, 8, 1, 0],
      totalWorkUnitsUsed: 100, meanWorkUnitsUsed: 10, maxWorkUnitsUsed: 10,
      budgetExhaustedSearches: 0, budgetExhaustionRate: 0,
      placementEvaluationUnits: 40, chanceExpansionUnits: 30, cacheHitUnits: 30,
      expandedDecisionNodes: 4, expandedChanceNodes: 3, cacheHits: 3,
    },
    reason: 'pieceCap', failed: false,
  };
}

function mutatedResults(mutation: GameMutation): SimTaskResult[] {
  const results = buildC0PrimaryTasks(validSources()).map(validResult);
  const result = results[0];
  if (mutation === 'failed') result.failed = true;
  if (mutation === 'error-reason') result.reason = 'error';
  if (mutation === 'non-finite-score') result.score = Number.NaN;
  if (mutation === 'bad-search') result.searchDiagnostics.completedDepthHistogram = [0, 1, 8, 1, Number.NaN];
  if (mutation === 'bad-lines') result.lines = 4;
  return results;
}

function record(
  vectorId: C0VectorId,
  gameIndex: number,
  score: number,
  counts: { singles: number; doubles: number; triples: number; tetrises: number },
  reason: 'pieceCap' | 'gameover' = 'pieceCap',
): C0GameRecord {
  const projection = {
    vectorId, gameIndex, seed: hashSeed(C0_BASE_SEED, gameIndex), score,
    scoreRate: score / C0_MAX_PIECES,
    pieces: reason === 'pieceCap' ? C0_MAX_PIECES : C0_MAX_PIECES - 1,
    reason, clearCounts: counts,
    tetrisLineShare: counts.tetrises === 0 ? 0 : 4 * counts.tetrises /
      (counts.singles + 2 * counts.doubles + 3 * counts.triples + 4 * counts.tetrises),
    meanHeight: 4,
    strategyDiagnostics: { meanCleanWellDepth: 1, meanTetrisSetupProgress: 1, meanTetrisReadyRows: 1 },
    searchDiagnostics: {
      searchCalls: 10, holdActions: 2, holdRate: 0.2, meanCompletedDepth: 2,
      minCompletedDepth: 1, completedDepthHistogram: [0, 1, 8, 1, 0] as [number, number, number, number, number],
      totalWorkUnitsUsed: 100, meanWorkUnitsUsed: 10, maxWorkUnitsUsed: 10,
      budgetExhaustedSearches: 0, budgetExhaustionRate: 0,
      placementEvaluationUnits: 40, chanceExpansionUnits: 30, cacheHitUnits: 30,
      expandedDecisionNodes: 4, expandedChanceNodes: 3, cacheHits: 3,
    },
  };
  return { taskId: gameIndex * 4 + C0_VECTOR_ORDER.indexOf(vectorId), projection, projectionDigest: hashProjection(projection) };
}

function recordsWithDistinctVectorScores(scores: readonly [number, number, number, number]): C0GameRecord[] {
  return Array.from({ length: C0_GAMES }, (_, gameIndex) => C0_VECTOR_ORDER.map((vectorId, vectorIndex) =>
    record(vectorId, gameIndex, scores[vectorIndex], { singles: 1, doubles: 0, triples: 0, tetrises: 1 }))).flat();
}

function validReplay(primary: readonly C0GameRecord[]): C0GameRecord[] {
  return [0, 29].flatMap((gameIndex) => C0_VECTOR_ORDER.map((vectorId) => {
    const source = primary.find((entry) => entry.projection.gameIndex === gameIndex && entry.projection.vectorId === vectorId);
    if (source === undefined) throw new Error('fixture primary record missing');
    return structuredClone(source);
  }));
}

function recordsFor(
  scores: readonly [number, number, number, number],
  counts: Readonly<Record<C0VectorId, { singles: number; doubles: number; triples: number; tetrises: number }>>,
  gen6Gameover = false,
): C0GameRecord[] {
  return Array.from({ length: C0_GAMES }, (_, gameIndex) => C0_VECTOR_ORDER.map((vectorId, vectorIndex) =>
    record(vectorId, gameIndex, scores[vectorIndex], counts[vectorId],
      vectorId === 'gen6-best' && gen6Gameover && gameIndex === 0 ? 'gameover' : 'pieceCap'))).flat();
}

function passingRecords(): C0GameRecord[] {
  return recordsFor(
    [1000, 2000, 9000, 1000],
    {
      'published-baseline': { singles: 3, doubles: 0, triples: 0, tetrises: 0 },
      'gen6-best': { singles: 1, doubles: 0, triples: 0, tetrises: 2 },
      'gen9-best': { singles: 1, doubles: 0, triples: 0, tetrises: 4 },
      'gen10-mu': { singles: 3, doubles: 0, triples: 0, tetrises: 0 },
    },
  );
}

function passingReplay(): C0GameRecord[] { return validReplay(passingRecords()); }
function passFixture(): VerdictFixture { const primary = passingRecords(); return { primary, replay: validReplay(primary) }; }
function tetrisAggregateLow(): VerdictFixture {
  const primary = recordsFor([1000, 2000, 9000, 1000], Object.fromEntries(C0_VECTOR_ORDER.map((id) =>
    [id, { singles: 3, doubles: 0, triples: 0, tetrises: 0 }])) as Record<C0VectorId, { singles: number; doubles: number; triples: number; tetrises: number }>);
  return { primary, replay: validReplay(primary) };
}
function tetrisLowerZero(): VerdictFixture {
  const primary = recordsFor([1000, 2000, 9000, 1000], {
    'published-baseline': { singles: 3, doubles: 0, triples: 0, tetrises: 0 },
    'gen6-best': { singles: 1, doubles: 0, triples: 0, tetrises: 2 },
    'gen9-best': { singles: 1, doubles: 0, triples: 0, tetrises: 4 },
    'gen10-mu': { singles: 1, doubles: 0, triples: 0, tetrises: 2 },
  });
  return { primary, replay: validReplay(primary) };
}
function scoreLowerZero(): VerdictFixture {
  const primary = recordsFor([1000, 1000, 9000, 1000], {
    'published-baseline': { singles: 3, doubles: 0, triples: 0, tetrises: 0 },
    'gen6-best': { singles: 1, doubles: 0, triples: 0, tetrises: 2 },
    'gen9-best': { singles: 1, doubles: 0, triples: 0, tetrises: 4 },
    'gen10-mu': { singles: 3, doubles: 0, triples: 0, tetrises: 0 },
  });
  return { primary, replay: validReplay(primary) };
}
function survivalLower(): VerdictFixture {
  const primary = recordsFor([1000, 2000, 9000, 1000], {
    'published-baseline': { singles: 3, doubles: 0, triples: 0, tetrises: 0 },
    'gen6-best': { singles: 1, doubles: 0, triples: 0, tetrises: 2 },
    'gen9-best': { singles: 1, doubles: 0, triples: 0, tetrises: 4 },
    'gen10-mu': { singles: 3, doubles: 0, triples: 0, tetrises: 0 },
  }, true);
  return { primary, replay: validReplay(primary) };
}

describe('C0 task and game projection', () => {
  it('maps seed-major task results without transposing vector ownership', () => {
    const tasks = buildC0PrimaryTasks(validSources());
    expect(tasks).toHaveLength(120);
    expect(tasks.slice(0, 8).map(({ taskId, seed, weights }) => ({ taskId, seed, vectorId: vectorIdForWeights(weights) }))).toEqual([
      { taskId: 0, seed: hashSeed(C0_BASE_SEED, 0), vectorId: 'published-baseline' },
      { taskId: 1, seed: hashSeed(C0_BASE_SEED, 0), vectorId: 'gen6-best' },
      { taskId: 2, seed: hashSeed(C0_BASE_SEED, 0), vectorId: 'gen9-best' },
      { taskId: 3, seed: hashSeed(C0_BASE_SEED, 0), vectorId: 'gen10-mu' },
      { taskId: 4, seed: hashSeed(C0_BASE_SEED, 1), vectorId: 'published-baseline' },
      { taskId: 5, seed: hashSeed(C0_BASE_SEED, 1), vectorId: 'gen6-best' },
      { taskId: 6, seed: hashSeed(C0_BASE_SEED, 1), vectorId: 'gen9-best' },
      { taskId: 7, seed: hashSeed(C0_BASE_SEED, 1), vectorId: 'gen10-mu' },
    ]);
  });

  it.each(['failed', 'error-reason', 'non-finite-score', 'bad-search', 'bad-lines'] as const)(
    'returns runtime-fail for malformed game result %s',
    (mutation) => {
      const sources = validSources();
      expect(() => projectC0PrimaryResults(sources, buildC0PrimaryTasks(sources), mutatedResults(mutation)))
        .toThrowError(/^C0 runtime-fail:/);
    },
  );

  it('rejects a task manifest mismatch, malformed count, and out-of-range piece count', () => {
    const sources = validSources();
    const tasks = buildC0PrimaryTasks(sources);
    const mismatched = tasks.map(validResult);
    mismatched[0].taskId = 1;
    expect(() => projectC0PrimaryResults(sources, tasks, mismatched)).toThrowError(/^C0 runtime-fail:/);
    const badCounts = tasks.map(validResult);
    badCounts[0].clearCounts.singles = -1;
    expect(() => projectC0PrimaryResults(sources, tasks, badCounts)).toThrowError(/^C0 runtime-fail:/);
    const badPieces = tasks.map(validResult);
    badPieces[0].pieces = C0_MAX_PIECES + 1;
    expect(() => projectC0PrimaryResults(sources, tasks, badPieces)).toThrowError(/^C0 runtime-fail:/);
  });

  it('rejects an incomplete result array and task weights that do not match the frozen vector', () => {
    const sources = validSources();
    const tasks = buildC0PrimaryTasks(sources);
    expect(() => projectC0PrimaryResults(sources, tasks, tasks.map(validResult).slice(1)))
      .toThrowError('C0 runtime-fail:game-result-mismatch');
    tasks[0].weights[0] += 1;
    expect(() => projectC0PrimaryResults(sources, tasks, tasks.map(validResult)))
      .toThrowError('C0 runtime-fail:game-result-mismatch');
  });

  it.each([
    ['missing strategy diagnostics', (result: SimTaskResult) => { (result as unknown as { strategyDiagnostics?: unknown }).strategyDiagnostics = undefined; }],
    ['null search diagnostics', (result: SimTaskResult) => { (result as unknown as { searchDiagnostics?: unknown }).searchDiagnostics = null; }],
  ])('classifies %s as C0 runtime failure rather than a raw TypeError', (_label, mutate) => {
    const sources = validSources();
    const tasks = buildC0PrimaryTasks(sources);
    const results = tasks.map(validResult);
    mutate(results[0]);
    expect(() => projectC0PrimaryResults(sources, tasks, results)).toThrowError('C0 runtime-fail:game-result-mismatch');
  });

  it.each([
    ['total work exceeds the frozen per-call budget', (result: SimTaskResult) => {
      result.searchDiagnostics.totalWorkUnitsUsed = 35_841;
      result.searchDiagnostics.placementEvaluationUnits = 35_781;
      result.searchDiagnostics.chanceExpansionUnits = 30;
      result.searchDiagnostics.cacheHitUnits = 30;
    }],
    ['maximum work lower than mean work', (result: SimTaskResult) => { result.searchDiagnostics.maxWorkUnitsUsed = 9; }],
    ['zero-call diagnostics with residual graph counters', (result: SimTaskResult) => {
      result.searchDiagnostics = {
        ...result.searchDiagnostics, searchCalls: 0, holdActions: 0, holdRate: 0,
        meanCompletedDepth: 0, minCompletedDepth: 0, completedDepthHistogram: [0, 0, 0, 0, 0],
        totalWorkUnitsUsed: 0, meanWorkUnitsUsed: 0, maxWorkUnitsUsed: 0,
        budgetExhaustedSearches: 0, budgetExhaustionRate: 0,
        placementEvaluationUnits: 0, chanceExpansionUnits: 0, cacheHitUnits: 0,
        expandedDecisionNodes: 1, expandedChanceNodes: 0, cacheHits: 0,
      };
    }],
  ])('rejects shared-parser-inconsistent search diagnostics: %s', (_label, mutate) => {
    const sources = validSources();
    const tasks = buildC0PrimaryTasks(sources);
    const results = tasks.map(validResult);
    mutate(results[0]);
    expect(() => projectC0PrimaryResults(sources, tasks, results)).toThrowError('C0 runtime-fail:game-result-mismatch');
  });

  it.each([
    ['vector identity order', (sources: C0SourceBundle) => { (sources.vectors as C0SourceBundle['vectors'] as C0SourceBundle['vectors'] & { 0: { id: C0VectorId } })[0].id = 'gen6-best'; }],
    ['schedule vector order', (sources: C0SourceBundle) => { (sources.schedule.vectorOrder as C0VectorId[])[0] = 'gen6-best'; }],
    ['schedule seed digest', (sources: C0SourceBundle) => { (sources.schedule as { seedDigest: string }).seedDigest = '0'.repeat(64); }],
    ['schedule seed sequence', (sources: C0SourceBundle) => { sources.schedule.seeds[0] += 1; }],
  ])('fails closed when the supplied source bundle mutates %s', (_label, mutate) => {
    const sources = structuredClone(validSources());
    mutate(sources);
    expect(() => buildC0PrimaryTasks(sources)).toThrowError('C0 runtime-fail:game-result-mismatch');
  });

  it('projects only canonical diagnostic fields without source-only extras', () => {
    const sources = validSources();
    const tasks = buildC0PrimaryTasks(sources);
    const results = tasks.map(validResult);
    Object.assign(results[0].strategyDiagnostics as object, { extraStrategy: 'ignore' });
    Object.assign(results[0].searchDiagnostics as object, { extraSearch: 'ignore' });
    const [record] = projectC0PrimaryResults(sources, tasks, results);
    expect(record.projection.strategyDiagnostics).not.toHaveProperty('extraStrategy');
    expect(record.projection.searchDiagnostics).not.toHaveProperty('extraSearch');
  });
});

describe('C0 primary analysis', () => {
  it('reorders seed-major records before calling aggregateFitness', () => {
    const records = recordsWithDistinctVectorScores([100, 200, 300, 400]);
    const output = evaluateC0Audit(validSources(), records, validReplay(records));
    expect(output.vectors.map(({ id, scoreRate }) => ({ id, scoreRate }))).toEqual([
      { id: 'published-baseline', scoreRate: 100 / C0_MAX_PIECES },
      { id: 'gen6-best', scoreRate: 200 / C0_MAX_PIECES },
      { id: 'gen9-best', scoreRate: 300 / C0_MAX_PIECES },
      { id: 'gen10-mu', scoreRate: 400 / C0_MAX_PIECES },
    ]);
  });

  it('emits only the pre-registered comparisons in fixed order', () => {
    expect(evaluateC0Audit(validSources(), passingRecords(), passingReplay()).comparisons
      .map(({ left, right }) => `${left}-${right}`)).toEqual([
      'gen6-best-gen10-mu', 'gen9-best-gen10-mu',
      'gen6-best-published-baseline', 'gen9-best-published-baseline',
    ]);
  });

  it.each([
    ['pass', passFixture(), 'pass-retention-loss-supported'],
    ['tetris aggregate below one percent', tetrisAggregateLow(), 'fail-signal-not-reproduced'],
    ['tetris lower bound equals zero', tetrisLowerZero(), 'fail-signal-not-reproduced'],
    ['score lower bound equals zero', scoreLowerZero(), 'fail-joint-improvement-not-shown'],
    ['gen6 survival lower than mu', survivalLower(), 'fail-joint-improvement-not-shown'],
  ])('%s -> %s', (_label, fixture, expected) => {
    expect(evaluateC0Audit(validSources(), fixture.primary, fixture.replay).status).toBe(expected);
  });

  it('does not let a stronger gen9 replace gen6 in the primary verdict', () => {
    const fixture = tetrisAggregateLow();
    expect(evaluateC0Audit(validSources(), fixture.primary, fixture.replay).status).toBe('fail-signal-not-reproduced');
  });

  it('rejects a replay whose digest matches itself but not its primary projection', () => {
    const fixture = passFixture();
    fixture.replay[0].projection.score += 1;
    fixture.replay[0].projectionDigest = hashProjection(fixture.replay[0].projection);
    expect(() => evaluateC0Audit(validSources(), fixture.primary, fixture.replay))
      .toThrowError('C0 runtime-fail:nondeterministic-replay');
  });

  it('serializes the canonical seed-free projection with its digest appended last', () => {
    const fixture = passFixture();
    const output = evaluateC0Audit(validSources(), fixture.primary, fixture.replay);
    const { resultDigest, ...projection } = output;
    expect(resultDigest).toBe(hashProjection(projection));
    expect(Object.keys(output).at(-1)).toBe('resultDigest');
    expect(output.schedule).not.toHaveProperty('seeds');
    expect(serializeC0Audit(output)).toBe(JSON.stringify(output));
  });

  it('rejects non-exact derived score and tetris shares even when the projection digest is recomputed', () => {
    const fixture = passFixture();
    fixture.primary[0].projection.scoreRate += Number.EPSILON;
    fixture.primary[0].projectionDigest = hashProjection(fixture.primary[0].projection);
    expect(() => evaluateC0Audit(validSources(), fixture.primary, fixture.replay))
      .toThrowError('C0 runtime-fail:game-result-mismatch');
    const next = passFixture();
    next.primary[0].projection.tetrisLineShare += Number.EPSILON;
    next.primary[0].projectionDigest = hashProjection(next.primary[0].projection);
    expect(() => evaluateC0Audit(validSources(), next.primary, next.replay))
      .toThrowError('C0 runtime-fail:game-result-mismatch');
  });

  it('rejects replay order and an isolated replay digest mismatch', () => {
    const fixture = passFixture();
    [fixture.replay[0], fixture.replay[1]] = [fixture.replay[1], fixture.replay[0]];
    expect(() => evaluateC0Audit(validSources(), fixture.primary, fixture.replay))
      .toThrowError('C0 runtime-fail:nondeterministic-replay');
    const next = passFixture();
    next.replay[0].projectionDigest = '0'.repeat(64);
    expect(() => evaluateC0Audit(validSources(), next.primary, next.replay))
      .toThrowError('C0 runtime-fail:nondeterministic-replay');
  });

  it('accepts the inclusive aggregate Tetris threshold at exactly 0.01', () => {
    const primary = recordsFor([1000, 2000, 9000, 1000], {
      'published-baseline': { singles: 3, doubles: 0, triples: 0, tetrises: 0 },
      'gen6-best': { singles: 396, doubles: 0, triples: 0, tetrises: 1 },
      'gen9-best': { singles: 1, doubles: 0, triples: 0, tetrises: 4 },
      'gen10-mu': { singles: 3, doubles: 0, triples: 0, tetrises: 0 },
    });
    const output = evaluateC0Audit(validSources(), primary, validReplay(primary));
    expect(output.gates.gen6AggregateTetrisAtLeastOnePercent).toBe(true);
  });

  it('binds failure output status to its matching reason family', () => {
    expect(() => (failureC0Audit as unknown as (status: 'invalid-input', reason: 'game-result-mismatch') => unknown)(
      'invalid-input', 'game-result-mismatch')).toThrowError('C0 runtime-fail:game-result-mismatch');
  });
});

interface RecordingC0Pool extends C0Pool {
  runs: SimTask[][];
  destroyCalls: number;
  destroySettled: boolean;
}

function successfulPool(): RecordingC0Pool {
  const pool: RecordingC0Pool = {
    runs: [], destroyCalls: 0, destroySettled: false,
    async run(tasks) {
      pool.runs.push(tasks.map((task) => ({ ...task, weights: [...task.weights] })));
      return tasks.map(validResult);
    },
    async destroy() { pool.destroyCalls++; pool.destroySettled = true; },
  };
  return pool;
}

function blockingPool(): RecordingC0Pool {
  const pool: RecordingC0Pool = {
    runs: [], destroyCalls: 0, destroySettled: false,
    run(tasks, options) {
      pool.runs.push(tasks.map((task) => ({ ...task, weights: [...task.weights] })));
      return new Promise<SimTaskResult[]>((_, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
    async destroy() { pool.destroyCalls++; pool.destroySettled = true; },
  };
  return pool;
}

function dependenciesWithPool(pool: RecordingC0Pool): C0AuditDependencies {
  return { loadSources: validSources, createPool: async () => pool, logicalCpuCount: () => 8 };
}

function invalidSourceDependencies(): C0AuditDependencies & { createPool: ReturnType<typeof vi.fn> } {
  return {
    loadSources: () => { throw new C0InvalidInputError('source-hash-mismatch'); },
    createPool: vi.fn(), logicalCpuCount: () => 8,
  };
}

function successfulDependencies(): C0AuditDependencies {
  return dependenciesWithPool(successfulPool());
}

function recoveryPool(): RecordingC0Pool {
  const pool = successfulPool();
  pool.run = async (tasks) => {
    pool.runs.push(tasks.map((task) => ({ ...task, weights: [...task.weights] })));
    console.warn('worker recovered');
    return tasks.map(validResult);
  };
  return pool;
}

function destroyRejectingPool(): RecordingC0Pool {
  const pool = successfulPool();
  pool.destroy = async () => {
    pool.destroyCalls++;
    pool.destroySettled = true;
    throw new Error('destroy failed');
  };
  return pool;
}

function slowDestroyingPool(): RecordingC0Pool & {
  destroyStarted: Promise<void>;
  releaseDestroy(): void;
} {
  const pool = successfulPool() as RecordingC0Pool & {
    destroyStarted: Promise<void>;
    releaseDestroy(): void;
  };
  let release!: () => void;
  let started!: () => void;
  const destroyStarted = new Promise<void>((resolve) => { started = resolve; });
  pool.destroy = () => {
    pool.destroyCalls++;
    started();
    return new Promise<void>((resolve) => {
      release = () => { pool.destroySettled = true; resolve(); };
    });
  };
  pool.destroyStarted = destroyStarted;
  pool.releaseDestroy = () => release();
  return pool;
}

function slowRejectingDestroyingPool(): RecordingC0Pool & {
  destroyStarted: Promise<void>;
  rejectDestroy(): void;
} {
  const pool = successfulPool() as RecordingC0Pool & {
    destroyStarted: Promise<void>;
    rejectDestroy(): void;
  };
  let reject!: (reason?: unknown) => void;
  let started!: () => void;
  pool.destroyStarted = new Promise<void>((resolve) => { started = resolve; });
  pool.destroy = () => {
    pool.destroyCalls++;
    started();
    return new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; });
  };
  pool.rejectDestroy = () => reject(new Error('pool destroy failed'));
  return pool;
}

function executionAndDestroyFailingPool(): RecordingC0Pool {
  const pool = successfulPool();
  pool.run = async (tasks) => {
    pool.runs.push(tasks.map((task) => ({ ...task, weights: [...task.weights] })));
    throw new Error('pool execution failed');
  };
  pool.destroy = async () => {
    pool.destroyCalls++;
    pool.destroySettled = true;
    throw new Error('pool destroy failed');
  };
  return pool;
}

describe('C0 audit orchestration and CLI', () => {
  it('snapshots source ownership before async pool creation can mutate the injected bundle', async () => {
    const sources = validSources();
    const baseline = [...sources.vectors[0]!.weights];
    const pool = successfulPool();
    const dependencies: C0AuditDependencies = {
      loadSources: () => sources,
      createPool: async () => {
        sources.vectors[0]!.weights[0] += 1;
        return pool;
      },
      logicalCpuCount: () => 8,
    };
    await runC0Audit(dependencies);
    expect(pool.runs[0]![0]!.weights).toEqual(baseline);
  });

  it('runs all primary games before the exact replay set and always destroys the pool', async () => {
    const fake = successfulPool();
    await runC0Audit(dependenciesWithPool(fake));
    expect(fake.runs.map((tasks) => tasks.map((task) => task.taskId))).toEqual([
      Array.from({ length: 120 }, (_, index) => index),
      Array.from({ length: 8 }, (_, index) => 120 + index),
    ]);
    expect(fake.destroyCalls).toBe(1);
    expect(fake.destroySettled).toBe(true);
  });

  it('does not create a pool when source validation fails', async () => {
    const dependencies = invalidSourceDependencies();
    await expect(runC0Audit(dependencies)).rejects.toThrow(/^C0 invalid-input:/);
    expect(dependencies.createPool).not.toHaveBeenCalled();
  });

  it('aborts the in-flight pool, emits no partial verdict, and awaits destroy', async () => {
    const controller = new AbortController();
    const fake = blockingPool();
    const resultPromise = runC0AuditCli(dependenciesWithPool(fake), controller.signal);
    await vi.waitFor(() => expect(fake.runs).toHaveLength(1));
    controller.abort();
    await expect(resultPromise).resolves.toEqual({ exitCode: 130, stdout: '', stderr: '' });
    expect(fake.destroySettled).toBe(true);
  });

  it('maps an already-aborted signal without creating a pool', async () => {
    const controller = new AbortController();
    controller.abort();
    const dependencies = successfulDependencies();
    await expect(runC0AuditCli(dependencies, controller.signal))
      .resolves.toEqual({ exitCode: 130, stdout: '', stderr: '' });
  });

  it('fails closed when the pool announces recovery and restores global warnings', async () => {
    const fake = recoveryPool();
    const originalWarn = console.warn;
    const result = await runC0AuditCli(dependenciesWithPool(fake));
    expect(result).toMatchObject({ exitCode: 1, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'runtime-fail', failureReasons: ['worker-pool-recovery'],
    });
    expect(console.warn).toBe(originalWarn);
    expect(fake.destroySettled).toBe(true);
  });

  it('returns a redacted destroy failure without leaking a rejected cleanup promise', async () => {
    const fake = destroyRejectingPool();
    const result = await runC0AuditCli(dependenciesWithPool(fake));
    expect(result).toMatchObject({ exitCode: 1, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'runtime-fail', failureReasons: ['worker-pool-destroy-failure'],
    });
    expect(fake.destroySettled).toBe(true);
  });

  it('lets abort win when completed evaluation is waiting for successful pool cleanup', async () => {
    const controller = new AbortController();
    const fake = slowDestroyingPool();
    const resultPromise = runC0AuditCli(dependenciesWithPool(fake), controller.signal);
    await fake.destroyStarted;
    controller.abort();
    fake.releaseDestroy();
    await expect(resultPromise).resolves.toEqual({ exitCode: 130, stdout: '', stderr: '' });
    expect(fake.destroySettled).toBe(true);
  });

  it('lets abort win over a rejecting destroy after completed evaluation', async () => {
    const controller = new AbortController();
    const fake = slowRejectingDestroyingPool();
    const resultPromise = runC0AuditCli(dependenciesWithPool(fake), controller.signal);
    await fake.destroyStarted;
    controller.abort();
    fake.rejectDestroy();
    await expect(resultPromise).resolves.toEqual({ exitCode: 130, stdout: '', stderr: '' });
  });

  it('lets abort win over saved execution and destroy failures during cleanup', async () => {
    const controller = new AbortController();
    const fake = slowRejectingDestroyingPool();
    fake.run = async (tasks) => {
      fake.runs.push(tasks.map((task) => ({ ...task, weights: [...task.weights] })));
      throw new Error('pool execution failed');
    };
    const resultPromise = runC0AuditCli(dependenciesWithPool(fake), controller.signal);
    await fake.destroyStarted;
    controller.abort();
    fake.rejectDestroy();
    await expect(resultPromise).resolves.toEqual({ exitCode: 130, stdout: '', stderr: '' });
  });

  it('removes each parent abort listener after a successful two-stage audit', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await runC0Audit(dependenciesWithPool(successfulPool()), controller.signal);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('removes the parent abort listener after a pool failure', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pool = executionAndDestroyFailingPool();
    await expect(runC0Audit(dependenciesWithPool(pool), controller.signal))
      .rejects.toThrow('C0 runtime-fail:worker-pool-failure');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('keeps the stable execution failure when destroy also rejects without an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const result = await runC0AuditCli(dependenciesWithPool(executionAndDestroyFailingPool()));
      expect(result).toMatchObject({ exitCode: 1, stderr: '' });
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: 'runtime-fail', failureReasons: ['worker-pool-failure'],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('emits one canonical JSON line and writes no files', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'c0-audit-'));
    try {
      const before = readdirSync(cwd);
      const moduleUrl = new URL('./archivedRepresentativeAudit.ts', import.meta.url).href;
      const encodedSources = Buffer.from(JSON.stringify(validSources()), 'utf8').toString('base64');
      const childScript = `
        import { readdirSync } from 'node:fs';
        import { runC0AuditCli } from ${JSON.stringify(moduleUrl)};
        const targetCwd = ${JSON.stringify(cwd)};
        const sources = JSON.parse(Buffer.from(${JSON.stringify(encodedSources)}, 'base64').toString('utf8'));
        const validResult = (task) => ({
          taskId: task.taskId, score: 1000, lines: 5, pieces: 5000, meanHeight: 4,
          clearCounts: { singles: 3, doubles: 1, triples: 0, tetrises: 0 },
          strategyDiagnostics: { meanCleanWellDepth: 1, meanTetrisSetupProgress: 1, meanTetrisReadyRows: 1 },
          searchDiagnostics: {
            searchCalls: 10, holdActions: 2, holdRate: 0.2, meanCompletedDepth: 2, minCompletedDepth: 1,
            completedDepthHistogram: [0, 1, 8, 1, 0], totalWorkUnitsUsed: 100, meanWorkUnitsUsed: 10,
            maxWorkUnitsUsed: 10, budgetExhaustedSearches: 0, budgetExhaustionRate: 0,
            placementEvaluationUnits: 40, chanceExpansionUnits: 30, cacheHitUnits: 30,
            expandedDecisionNodes: 4, expandedChanceNodes: 3, cacheHits: 3,
          },
          reason: 'pieceCap', failed: false,
        });
        const dependencies = {
          loadSources: () => sources,
          createPool: async () => ({ run: async (tasks) => tasks.map(validResult), destroy: async () => {} }),
          logicalCpuCount: () => 8,
        };
        const previousCwd = process.cwd();
        let executionCwd;
        let restoredCwd;
        let first;
        let second;
        let before;
        let after;
        try {
          process.chdir(targetCwd);
          executionCwd = process.cwd();
          before = readdirSync('.');
          first = await runC0AuditCli(dependencies);
          second = await runC0AuditCli(dependencies);
          after = readdirSync('.');
        } finally {
          process.chdir(previousCwd);
          restoredCwd = process.cwd();
        }
        process.stdout.write(JSON.stringify({ executionCwd, restoredCwd, previousCwd, first, second, before, after }));
      `;
      const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', childScript], {
        cwd: process.cwd(), encoding: 'utf8', windowsHide: true,
      });
      expect(child.status, child.stderr).toBe(0);
      const { executionCwd, restoredCwd, previousCwd, first, second, before: childBefore, after } =
        JSON.parse(child.stdout) as {
          executionCwd: string; restoredCwd: string; previousCwd: string;
          first: Awaited<ReturnType<typeof runC0AuditCli>>; second: Awaited<ReturnType<typeof runC0AuditCli>>;
          before: string[]; after: string[];
        };
      expect(first).toEqual(second);
      expect(first.exitCode).toBe(1);
      expect(first.stdout.split('\n')).toHaveLength(2);
      expect(first.stdout.endsWith('\n')).toBe(true);
      expect(first.stderr).toBe('');
      expect(executionCwd).toBe(cwd);
      expect(restoredCwd).toBe(previousCwd);
      expect(after).toEqual(childBefore);
      expect(readdirSync(cwd)).toEqual(before);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
