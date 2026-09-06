import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyBoard } from '../src/engine/board';
import { createPiece } from '../src/engine/piece';
import { cellKey, enumeratePlacements, projectHardDrop, type Placement } from '../src/ai/placements';
import * as placementApi from '../src/ai/placements';
import { extractFeatures, FEATURE_NAMES } from '../src/ai/features';
import { enumerateBagOutcomes } from '../src/ai/publicState';
import { projectPath, samePiece } from '../src/ai/replay';
import { lockPlacement, revealPreview } from '../src/ai/stateTransitions';
import type { SimulationDecisionObservation } from '../src/ai/simulate';
import { boardFrom } from '../src/ai/testUtils';
import type { C0ValidatedRunSnapshot } from './archivedRepresentativeAudit';
import {
  D1_ACTION_FEATURE_NAMES,
  D1_BEHAVIOR_SEEDS,
  D1_BEHAVIOR_SEED_DIGEST,
  D1_LABEL_SEED_DIGEST,
  D1_PLACEMENT_SUBSET_TAG,
  D1_PROTOCOL_ID,
  D1_REPRESENTATIONS,
  buildD1LabelSeeds,
  buildD1SeedManifest,
  captureD1States,
  freezeD1PlacementManifest,
  extractD1Action24,
  loadD1Sources,
} from './d1ActionConditionedHeldOutListwiseCore';

describe('D1 representation contract', () => {
  it('exports the frozen representation order consumed by fitting', () => {
    expect(D1_REPRESENTATIONS).toEqual(['afterstate13', 'action24']);
    expect(Object.isFrozen(D1_REPRESENTATIONS)).toBe(true);
  });
});

const GEN6_BEST = [
  0.02185020330641181, -0.32193032364733, 0.24091173061177176,
  0.18568120986878886, -0.2568364480695082, -0.4468631052350419,
  -0.442665035753348, -0.4321598442115847, -0.16432404098948294,
  -0.18408869290566268, 0.19987304080346108, 0.23042001961989378,
  -0.03267637981563334,
];
const RAW_GEN10_MU = [
  -0.32308188574661295, -0.1380786127962525, -0.1827990265695491,
  0.1679900341497466, -0.0006042437943203343, -0.11895518210542955,
  -0.10370567102993666, -0.31156851199214525, -0.13318521092623947,
  0.17331741246784807, 0.12773366674138667, 0.14468594791202222,
  -0.06089197043033354,
];

type MutableLogRecord = Record<string, unknown> & {
  gen: number;
  bestWeights?: number[];
  kind?: string;
};

type MutableCheckpoint = {
  -readonly [K in keyof C0ValidatedRunSnapshot['checkpoint']]:
    C0ValidatedRunSnapshot['checkpoint'][K];
};

interface MutableValidatedSnapshotFixture {
  checkpoint: MutableCheckpoint;
  records: MutableLogRecord[];
  sourceHashes: C0ValidatedRunSnapshot['sourceHashes'];
}

function validSnapshot(): MutableValidatedSnapshotFixture {
  const records: MutableLogRecord[] = Array.from({ length: 10 }, (_, gen) => ({
    gen,
    bestWeights: GEN6_BEST,
  }));
  records.push({ gen: 10, kind: 'reevaluation', bestWeights: GEN6_BEST });
  const checkpoint: C0ValidatedRunSnapshot['checkpoint'] = {
    version: 6,
    objective: 'score-rate-v5',
    gen: 10,
    mu: RAW_GEN10_MU,
    sigma: Array(13).fill(1),
    baseSeed: 20260727,
    maxPieces: 2000,
    config: {
      population: 100,
      eliteFrac: 0.1,
      gamesPerCandidate: 5,
      initialMaxPieces: 300,
      maxPiecesCap: 2000,
      initialNoise: 0.5,
      noiseDecay: 0.95,
      noiseFloor: 0.01,
      baseSeed: 20260727,
      workers: 4,
      reevalEvery: 10,
      reevalGames: 30,
      reevalMaxPieces: 5000,
    },
    publishedBaseline: null,
    bestQualifiedCandidate: null,
    searchContract: 'bag-expectimax-hold-v2',
    searchDepth: 4,
    rootBeamWidth: 64,
    childBeamWidth: 32,
    maxWorkUnits: 3584,
    budgetCorpus: 'budget-corpus-v1',
    transpositionCacheEntries: 65536,
    placementCacheEntries: 16384,
  };
  return {
    checkpoint,
    records,
    sourceHashes: { checkpoint: '93B2A63FF221B7E6EE1BD5CBFF8AE8C75B5B96411AD5B2EE4AFFA3806B6C06BD',
      log: 'C86457320694A8C2D85C734D64D9CE6E58166D913974F945370D15FBC7C651BA' },
  };
}

const completeSearchDiagnostics = () => ({
  completedDepth: 4 as const,
  attemptedDepth: 4 as const,
  workUnitsUsed: 3584,
  workUnitsLimit: 3584,
  placementEvaluationUnits: 1000,
  chanceExpansionUnits: 2000,
  cacheHitUnits: 584,
  budgetExhausted: true,
  expandedDecisionNodes: 20,
  expandedChanceNodes: 30,
  cacheHits: 40,
  placementCacheHits: 10,
  placementCacheEntries: 100,
  transpositionEntries: 200,
  equivalentPlacementsRemoved: 3,
  prunedChanceBranches: 4,
  aborted: false,
});

const completeSimulationDiagnostics = () => ({
  searchCalls: 1,
  holdActions: 0,
  holdRate: 0,
  meanCompletedDepth: 4,
  minCompletedDepth: 4,
  completedDepthHistogram: [0, 0, 0, 0, 1] as [number, number, number, number, number],
  totalWorkUnitsUsed: 3584,
  meanWorkUnitsUsed: 3584,
  maxWorkUnitsUsed: 3584,
  budgetExhaustedSearches: 1,
  budgetExhaustionRate: 1,
  placementEvaluationUnits: 1000,
  chanceExpansionUnits: 2000,
  cacheHitUnits: 584,
  expandedDecisionNodes: 20,
  expandedChanceNodes: 30,
  cacheHits: 40,
});

function captureRunner(
  alter?: (observation: SimulationDecisionObservation, slot: 128 | 512) => void,
  result: { reason: 'pieceCap' | 'gameover'; pieces: number } = { reason: 'pieceCap', pieces: 512 },
) {
  return ({ behaviorSeed, weights, onDecision }: {
    behaviorSeed: number;
    weights: readonly number[];
    onDecision: (observation: SimulationDecisionObservation) => void;
  }) => {
    const vectorMarker = weights[0] === GEN6_BEST[0] ? 1 : 2;
    for (const slot of [128, 512] as const) {
      const board = createEmptyBoard();
      const current = createPiece(1);
      const placement = enumeratePlacements(board, current)[0]!;
      const observation: SimulationDecisionObservation = {
        publicState: {
          board,
          current,
          next: 2,
          hold: 3,
          holdAvailable: true,
          unseenBagMask: 120,
        },
        decision: {
          action: { kind: 'place', placement },
          value: { survivalProbability: 1, expectedHeuristicValue: 0 },
          diagnostics: completeSearchDiagnostics(),
        },
        scheduledPieceNumber: slot,
        score: behaviorSeed * 10 + vectorMarker * 2 + slot,
        lines: 0,
        level: 1,
        searchDiagnostics: completeSimulationDiagnostics(),
      };
      alter?.(observation, slot);
      onDecision(observation);
      if (slot === 128) onDecision(structuredClone(observation));
      observation.publicState.board[0]![0] = 7;
      observation.searchDiagnostics.searchCalls = 999;
    }
    return result;
  };
}

function placementCapture(overrides: Record<string, unknown> = {}) {
  return {
    split: 'train' as const,
    groupOrdinal: 0,
    behaviorSeed: D1_BEHAVIOR_SEEDS.train[0],
    behaviorVectorId: 'gen6-best' as const,
    behaviorVectorDigest: '233cc500168fe7258305d87654a640ad9aef3f67092d5e0e016f910b9d660ca9',
    captureSlot: 128 as const,
    state: {
      board: createEmptyBoard(),
      current: createPiece(1),
      next: 2 as const,
      hold: 3 as const,
      holdAvailable: true,
      unseenBagMask: 120,
    },
    score: 0,
    lines: 0,
    level: 1,
    scheduledPieceNumber: 128 as const,
    sourceDiagnostics: completeSimulationDiagnostics(),
    stateFingerprint: 'd8aa1e61f6e6a8303c450e0999f42d14e5e39c917713dd09ebab52e85b3beb6c',
    ...overrides,
  };
}

interface LegalUniverseFixture {
  readonly name: string;
  readonly pieceType: 1 | 2;
  readonly rowMasks: readonly (readonly [row: number, mask: number])[];
  readonly legalPlacementIds: readonly string[];
  readonly legalUniverseDigest: string;
  readonly selectedPlacementIds: readonly string[];
}

const LEGAL_UNIVERSE_FIXTURES: readonly LegalUniverseFixture[] = [
  {
    name: 'zero', pieceType: 1, rowMasks: [[1, 0b0000001000]],
    legalPlacementIds: [],
    legalUniverseDigest: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    selectedPlacementIds: [],
  },
  {
    name: 'one', pieceType: 1, rowMasks: [[1, 0b0010000100], [2, 0b0001101000]],
    legalPlacementIds: ['1:13,14,15,16'],
    legalUniverseDigest: 'a122a11b2bca87f6ee387225c91128e80f5e33f73afcfe469edbc112f48e92d9',
    selectedPlacementIds: ['1:13,14,15,16'],
  },
  {
    name: 'two', pieceType: 1, rowMasks: [[1, 0b0010000010], [2, 0b0001111100]],
    legalPlacementIds: ['1:12,13,14,15', '1:13,14,15,16'],
    legalUniverseDigest: '83f67eaaf654f92ffd47d9dfe7f18ae05257e45206fe2a7a8535cfe198074d0e',
    selectedPlacementIds: ['1:12,13,14,15', '1:13,14,15,16'],
  },
  {
    name: 'nine', pieceType: 2, rowMasks: [],
    legalPlacementIds: [
      '2:200,201,210,211', '2:201,202,211,212', '2:202,203,212,213',
      '2:203,204,213,214', '2:204,205,214,215', '2:205,206,215,216',
      '2:206,207,216,217', '2:207,208,217,218', '2:208,209,218,219',
    ],
    legalUniverseDigest: '30873d148d931eec2027a83c1aac8a35b7265190834eff2ad598591fc6eb71c3',
    selectedPlacementIds: [
      '2:200,201,210,211', '2:201,202,211,212', '2:202,203,212,213',
      '2:203,204,213,214', '2:204,205,214,215', '2:205,206,215,216',
      '2:206,207,216,217', '2:207,208,217,218', '2:208,209,218,219',
    ],
  },
  {
    name: 'twelve', pieceType: 2, rowMasks: [[2, 0b0000000101]],
    legalPlacementIds: [
      '2:0,1,10,11', '2:1,2,11,12', '2:2,3,12,13',
      '2:200,201,210,211', '2:201,202,211,212', '2:202,203,212,213',
      '2:203,204,213,214', '2:204,205,214,215', '2:205,206,215,216',
      '2:206,207,216,217', '2:207,208,217,218', '2:208,209,218,219',
    ],
    legalUniverseDigest: '394018906a7883f8f95b83409c6d92ec4efacaf9fd7c8a37bae464855c01e321',
    selectedPlacementIds: [
      '2:0,1,10,11', '2:1,2,11,12', '2:2,3,12,13',
      '2:200,201,210,211', '2:201,202,211,212', '2:202,203,212,213',
      '2:203,204,213,214', '2:204,205,214,215', '2:205,206,215,216',
      '2:206,207,216,217', '2:207,208,217,218', '2:208,209,218,219',
    ],
  },
  {
    name: 'thirteen', pieceType: 2, rowMasks: [[2, 0b0000001010]],
    legalPlacementIds: [
      '2:0,1,10,11', '2:1,2,11,12', '2:2,3,12,13',
      '2:200,201,210,211', '2:201,202,211,212', '2:202,203,212,213',
      '2:203,204,213,214', '2:204,205,214,215', '2:205,206,215,216',
      '2:206,207,216,217', '2:207,208,217,218', '2:208,209,218,219',
      '2:3,4,13,14',
    ],
    legalUniverseDigest: '6d439f4d4966109028192df40d9a9597c5475409008f4fa12c335e918872958d',
    selectedPlacementIds: [
      '2:1,2,11,12', '2:2,3,12,13',
      '2:200,201,210,211', '2:201,202,211,212', '2:202,203,212,213',
      '2:203,204,213,214', '2:204,205,214,215', '2:205,206,215,216',
      '2:206,207,216,217', '2:207,208,217,218', '2:208,209,218,219',
      '2:3,4,13,14',
    ],
  },
  {
    name: 'seventeen', pieceType: 1, rowMasks: [],
    legalPlacementIds: [
      '1:180,190,200,210', '1:181,191,201,211', '1:182,192,202,212',
      '1:183,193,203,213', '1:184,194,204,214', '1:185,195,205,215',
      '1:186,196,206,216', '1:187,197,207,217', '1:188,198,208,218',
      '1:189,199,209,219', '1:210,211,212,213', '1:211,212,213,214',
      '1:212,213,214,215', '1:213,214,215,216', '1:214,215,216,217',
      '1:215,216,217,218', '1:216,217,218,219',
    ],
    legalUniverseDigest: 'b097c1ce45aeb46057d019dd649899fa20cf94d5efb0c9889c135e71f4b2fa2f',
    selectedPlacementIds: [
      '1:181,191,201,211', '1:183,193,203,213', '1:185,195,205,215',
      '1:186,196,206,216', '1:188,198,208,218', '1:189,199,209,219',
      '1:210,211,212,213', '1:211,212,213,214', '1:212,213,214,215',
      '1:213,214,215,216', '1:214,215,216,217', '1:215,216,217,218',
    ],
  },
] as const;

function captureForLegalUniverse(
  fixture: LegalUniverseFixture,
  overrides: Record<string, unknown> = {},
) {
  const board = createEmptyBoard();
  for (const [row, mask] of fixture.rowMasks) {
    for (let column = 0; column < 10; column += 1) {
      if ((mask & (1 << column)) !== 0) board[row]![column] = 7;
    }
  }
  const base = placementCapture();
  const capture = placementCapture({
    ...overrides,
    state: { ...base.state, board, current: createPiece(fixture.pieceType) },
  });
  return {
    ...capture,
    stateFingerprint: testSha256([
      capture.state.board,
      capture.state.current.type,
      capture.state.current.rotation,
      capture.state.current.position.x,
      capture.state.current.position.y,
      capture.state.next,
      capture.state.hold,
      capture.state.holdAvailable,
      capture.state.unseenBagMask,
      capture.score,
      capture.lines,
      capture.level,
      capture.scheduledPieceNumber,
    ]),
  };
}

function testSha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function expectRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectRecursivelyFrozen(child);
}

function testManifestProjection(subset: ReturnType<typeof freezeD1PlacementManifest>) {
  const capture = Object.fromEntries(
    Object.entries(subset.capture).filter(([key]) => key !== 'score'),
  );
  return {
    capture,
    legalCount: subset.legalCount,
    selectedCount: subset.selectedCount,
    legalPlacementIds: subset.legalPlacementIds,
    legalUniverseDigest: subset.legalUniverseDigest,
    placements: subset.placements.map((candidate) => ({
      placementId: candidate.placementId,
      placedCells: candidate.placedCells,
      boardAfter: candidate.boardAfter,
      linesCleared: candidate.linesCleared,
      pending: candidate.pending,
      afterstate13: candidate.afterstate13,
      action24: candidate.action24,
    })),
  };
}

describe('D1 frozen provenance', () => {
  it('does not let a caller alter the frozen behavior schedule', () => {
    const original = D1_BEHAVIOR_SEEDS.train[0];
    let mutation: unknown;
    try {
      (D1_BEHAVIOR_SEEDS.train as number[])[0] = 0;
    } catch (error) {
      mutation = error;
    } finally {
      if (mutation === undefined) (D1_BEHAVIOR_SEEDS.train as number[])[0] = original;
    }

    expect(mutation).toBeInstanceOf(TypeError);
    expect(buildD1SeedManifest().behaviorSeeds.train[0]).toBe(original);
  });

  it('derives the pre-registered behavior and label seed schedules without overlap', () => {
    const manifest = buildD1SeedManifest();
    const labelSeeds = buildD1LabelSeeds(manifest);

    expect(manifest.behaviorSeeds).toEqual(D1_BEHAVIOR_SEEDS);
    expect(manifest.behaviorSeedDigest).toBe(D1_BEHAVIOR_SEED_DIGEST);
    expect(labelSeeds).toHaveLength(320);
    expect(manifest.labelSeedDigest).toBe(D1_LABEL_SEED_DIGEST);
    expect(new Set([...manifest.behaviorSeeds.train, ...manifest.behaviorSeeds.validation,
      ...manifest.behaviorSeeds.test, ...labelSeeds]).size).toBe(360);
  });

  it('exposes only the two D1 vectors from the validated snapshot', () => {
    expect(loadD1Sources(validSnapshot()).vectors.map(({ id }) => id)).toEqual(['gen6-best', 'gen10-mu']);
  });

  it('returns only immutable D1 metadata and vector ownership', () => {
    const sources = loadD1Sources(validSnapshot());
    const originalWeight = sources.vectors[0]!.weights[0];
    let mutation: unknown;
    try {
      (sources.vectors[0]!.weights as number[])[0] = 0;
    } catch (error) {
      mutation = error;
    }

    expect(sources).not.toHaveProperty('checkpoint');
    expect(sources).not.toHaveProperty('publishedBaseline');
    expect(sources.metadata).toMatchObject({ version: 6, objective: 'score-rate-v5', gen: 10, maxWorkUnits: 3584 });
    expect(mutation).toBeInstanceOf(TypeError);
    expect(loadD1Sources(validSnapshot()).vectors[0]!.weights[0]).toBe(originalWeight);
  });

  it('does not touch a controlled gen-9 record or published checkpoint field', () => {
    const snapshot = validSnapshot();
    snapshot.records = new Proxy(snapshot.records, {
      get(target, property, receiver) {
        if (property === '9') throw new Error('gen-9 must remain unread');
        return Reflect.get(target, property, receiver);
      },
    });
    Object.defineProperty(snapshot.checkpoint, 'publishedBaseline', {
      get: () => { throw new Error('published baseline must remain unread'); },
      enumerable: true,
    });

    expect(loadD1Sources(snapshot).vectors.map(({ id }) => id)).toEqual(['gen6-best', 'gen10-mu']);
  });

  it.each([
    ['source hash', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.sourceHashes.log = '0'.repeat(64); }],
    ['active search metadata', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.checkpoint.maxWorkUnits = 1; }],
    ['gen6 vector bytes', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.records[6]!.bestWeights![0] += 1; }],
  ])('rejects altered %s before exposing D1 vectors', (_label, alter) => {
    const snapshot = structuredClone(validSnapshot());
    alter(snapshot);
    expect(() => loadD1Sources(snapshot)).toThrow('D1 invalid-input');
  });

  it('rejects a caller-provided seed manifest that collides with the frozen behavior schedule', () => {
    const manifest = structuredClone(buildD1SeedManifest()) as {
      behaviorSeeds: { train: number[]; validation: number[]; test: number[] };
      behaviorSeedDigest: string;
      labelSeedDigest: string;
    };
    manifest.behaviorSeeds.train[0] = manifest.behaviorSeeds.train[1]!;

    expect(() => buildD1LabelSeeds(manifest)).toThrow('D1 invalid-input:seed-schedule-mismatch');
    expect(buildD1SeedManifest().behaviorSeeds.train[0]).toBe(D1_BEHAVIOR_SEEDS.train[0]);
  });
});

describe('D1 grouped source-state capture', () => {
  it('captures four ordered subsets per indivisible seed group without substituting decisions', () => {
    const captures = captureD1States({
      sources: loadD1Sources(validSnapshot()),
      seedManifest: buildD1SeedManifest(),
      runBehavior: captureRunner(),
    });

    expect(captures.slice(0, 4).map((capture) => [
      capture.split,
      capture.groupOrdinal,
      capture.behaviorVectorId,
      capture.captureSlot,
    ])).toEqual([
      ['train', 0, 'gen6-best', 128],
      ['train', 0, 'gen6-best', 512],
      ['train', 0, 'gen10-mu', 128],
      ['train', 0, 'gen10-mu', 512],
    ]);
    expect(captures).toHaveLength(160);
    expect(Object.fromEntries(['train', 'validation', 'test'].map((split) => [
      split, captures.filter((capture) => capture.split === split).length,
    ]))).toEqual({ train: 80, validation: 32, test: 48 });
    expect(new Set(captures.map(({ split, groupOrdinal, behaviorSeed }) =>
      `${split}:${groupOrdinal}:${behaviorSeed}`)).size).toBe(40);
    expect(new Set(captures.map(({ stateFingerprint }) => stateFingerprint)).size).toBe(160);
    expect(captures[0]).toMatchObject({
      scheduledPieceNumber: 128,
      captureSlot: 128,
      sourceDiagnostics: { searchCalls: 1 },
      state: { board: expect.arrayContaining([expect.any(Array)]) },
    });
    expect(captures[0]!.state.board[0]![0]).toBe(0);
    expect(Object.isFrozen(captures[0]!.state.board[0])).toBe(true);
    expect(Object.isFrozen(captures[0]!.sourceDiagnostics)).toBe(true);
  });

  it('keeps every seed group indivisible in the exact vector and slot order', () => {
    const captures = captureD1States({
      sources: loadD1Sources(validSnapshot()),
      seedManifest: buildD1SeedManifest(),
      runBehavior: captureRunner(),
    });
    const groups = new Map<string, Array<[string, number]>>();
    for (const capture of captures) {
      const key = `${capture.split}:${capture.groupOrdinal}:${capture.behaviorSeed}`;
      const entries = groups.get(key) ?? [];
      entries.push([capture.behaviorVectorId, capture.captureSlot]);
      groups.set(key, entries);
    }

    expect(groups.size).toBe(40);
    for (const entries of groups.values()) {
      expect(entries).toEqual([
        ['gen6-best', 128],
        ['gen6-best', 512],
        ['gen10-mu', 128],
        ['gen10-mu', 512],
      ]);
    }
  });

  it('accepts a committed decision whose search exhausted the frozen budget', () => {
    expect(() => captureD1States({
      sources: loadD1Sources(validSnapshot()),
      seedManifest: buildD1SeedManifest(),
      runBehavior: captureRunner(),
    })).not.toThrow();
  });

  it.each([
    ['gameover before the required slot', captureRunner(undefined, { reason: 'gameover', pieces: 127 })],
    ['null decision observation', captureRunner((observation, slot) => {
      if (slot === 128) Object.assign(observation, { decision: null });
    })],
    ['non-finite decision diagnostics', captureRunner((observation, slot) => {
      if (slot === 128) observation.decision.diagnostics.workUnitsUsed = Number.NaN;
    })],
    ['incomplete decision diagnostics', captureRunner((observation, slot) => {
      if (slot === 128) delete (observation.decision.diagnostics as Partial<typeof observation.decision.diagnostics>).cacheHits;
    })],
    ['malformed aggregate diagnostics', captureRunner((observation, slot) => {
      if (slot === 128) observation.searchDiagnostics.completedDepthHistogram = [1] as never;
    })],
    ['missing capture slot', ({ behaviorSeed, weights, onDecision }: Parameters<ReturnType<typeof captureRunner>>[0]) =>
      captureRunner(undefined, { reason: 'pieceCap', pieces: 511 })({
        behaviorSeed,
        weights,
        onDecision: (observation) => {
          if (observation.scheduledPieceNumber === 128) onDecision(observation);
        },
      })],
    ['duplicate global fingerprint', captureRunner((observation) => {
      observation.score = 0;
    })],
  ])('rejects %s instead of substituting another state', (_label, runBehavior) => {
    expect(() => captureD1States({
      sources: loadD1Sources(validSnapshot()),
      seedManifest: buildD1SeedManifest(),
      runBehavior,
    })).toThrow('D1 invalid-input');
  });
});

describe('D1 label-blind placement subsets', () => {
  it('exports the v2 variable-cardinality protocol identity', () => {
    expect(D1_PROTOCOL_ID).toBe('d1-action-conditioned-held-out-listwise-v2-variable-cardinality');
    expect(D1_PLACEMENT_SUBSET_TAG).toBe('d1-placement-subset-v2-variable-cardinality');
  });

  it.each(LEGAL_UNIVERSE_FIXTURES)(
    'freezes the test-owned $name-placement legal universe and digest-first subset',
    (fixture) => {
      const capture = captureForLegalUniverse(fixture);
      const boardBefore = structuredClone(capture.state.board);
      const actualLegalIds = enumeratePlacements(capture.state.board, capture.state.current)
        .map((placement) => `${placement.piece.type}:${cellKey(placement.piece)}`)
        .sort((left, right) => left.localeCompare(right));

      expect(actualLegalIds).toEqual(fixture.legalPlacementIds);
      expect(testSha256(fixture.legalPlacementIds)).toBe(fixture.legalUniverseDigest);

      if (fixture.legalPlacementIds.length < 2) {
        expect(() => freezeD1PlacementManifest(capture))
          .toThrow('D1 invalid-input:placement-manifest-mismatch');
        return;
      }

      const subset = freezeD1PlacementManifest(capture);
      expect(subset.legalCount).toBe(fixture.legalPlacementIds.length);
      expect(subset.selectedCount).toBe(fixture.selectedPlacementIds.length);
      expect(subset.legalPlacementIds).toEqual(fixture.legalPlacementIds);
      expect(subset.legalUniverseDigest).toBe(fixture.legalUniverseDigest);
      expect(subset.placements.map(({ placementId }) => placementId))
        .toEqual(fixture.selectedPlacementIds);
      expect(subset.placements).toHaveLength(fixture.selectedPlacementIds.length);
      expect(subset.placements.every(({ placementId, placement }) =>
        placementId === `${placement.piece.type}:${cellKey(placement.piece)}`)).toBe(true);

      for (const candidate of subset.placements) {
        const path = projectPath(capture.state.board, capture.state.current, candidate.placement.moves);
        const pathEnd = path.at(-1) ?? capture.state.current;
        expect(path).toHaveLength(candidate.placement.moves.length);
        expect(samePiece(
          projectHardDrop(capture.state.board, pathEnd),
          candidate.placement.piece,
        )).toBe(true);
      }

      expect(subset.manifestDigest).toBe(testSha256(testManifestProjection(subset)));
      expect(JSON.stringify(freezeD1PlacementManifest(capture))).toBe(JSON.stringify(subset));
      expectRecursivelyFrozen(subset);
      expect(capture.state.board).toEqual(boardBefore);
    },
  );

  it('selects all legal placements when the legal universe has twelve or fewer entries', () => {
    for (const fixture of LEGAL_UNIVERSE_FIXTURES.filter(({ legalPlacementIds }) =>
      legalPlacementIds.length >= 2 && legalPlacementIds.length <= 12)) {
      const subset = freezeD1PlacementManifest(captureForLegalUniverse(fixture));
      expect(subset.placements.map(({ placementId }) => placementId))
        .toEqual(fixture.legalPlacementIds);
    }
  });

  it('rejects an invalid replay placement in the unselected legal universe', () => {
    const fixture = LEGAL_UNIVERSE_FIXTURES.at(-1)!;
    const capture = captureForLegalUniverse(fixture);
    const placements = enumeratePlacements(capture.state.board, capture.state.current);
    const invalidPlacementId = '1:180,190,200,210';
    const invalidIndex = placements.findIndex((placement) =>
      `${placement.piece.type}:${cellKey(placement.piece)}` === invalidPlacementId);
    const canonical = placements[invalidIndex]!;
    const invalidReplayPlacement = {
      ...canonical,
      moves: ['left'] as Placement['moves'],
    };
    const path = projectPath(
      capture.state.board,
      capture.state.current,
      invalidReplayPlacement.moves,
    );
    const pathEnd = path.at(-1) ?? capture.state.current;

    expect(invalidIndex).toBeGreaterThanOrEqual(0);
    expect(fixture.selectedPlacementIds).not.toContain(invalidPlacementId);
    expect(path).toHaveLength(invalidReplayPlacement.moves.length);
    expect(samePiece(
      projectHardDrop(capture.state.board, pathEnd),
      invalidReplayPlacement.piece,
    )).toBe(false);

    const injectedUniverse = placements.map((placement, index) =>
      index === invalidIndex ? invalidReplayPlacement : placement);
    const enumeration = vi.spyOn(placementApi, 'enumeratePlacements')
      .mockReturnValueOnce(injectedUniverse);
    try {
      expect(() => freezeD1PlacementManifest(capture))
        .toThrow('D1 invalid-input:placement-manifest-mismatch');
    } finally {
      enumeration.mockRestore();
    }
  });

  it('is blind to source action, labels, and score when selecting from the legal universe', () => {
    const fixture = LEGAL_UNIVERSE_FIXTURES.at(-1)!;
    const selection = (capture: ReturnType<typeof placementCapture>) => {
      const subset = freezeD1PlacementManifest(capture);
      return {
        legalPlacementIds: subset.legalPlacementIds,
        legalUniverseDigest: subset.legalUniverseDigest,
        selectedPlacementIds: subset.placements.map(({ placementId }) => placementId),
      };
    };
    const baseline = selection(captureForLegalUniverse(fixture));
    const variants = [
      captureForLegalUniverse(fixture, { sourceBehaviorAction: { kind: 'hold' } }),
      captureForLegalUniverse(fixture, { labels: [{ survival: 0 }] }),
      Object.assign(captureForLegalUniverse(fixture), { score: 999_999 }),
    ];

    for (const variant of variants) expect(selection(variant)).toEqual(baseline);
  });

  it('keeps manifest digest and projected bytes blind to score, action, labels, and survival', () => {
    const fixture = LEGAL_UNIVERSE_FIXTURES.at(-1)!;
    const baseline = freezeD1PlacementManifest(captureForLegalUniverse(fixture));
    const variants = [
      { capture: captureForLegalUniverse(fixture, { sourceBehaviorAction: { kind: 'hold' } }), score: 0 },
      { capture: captureForLegalUniverse(fixture, { labels: [{ survival: 0 }] }), score: 0 },
      { capture: captureForLegalUniverse(fixture, { survival: 0 }), score: 0 },
      { capture: Object.assign(captureForLegalUniverse(fixture), { score: 999_999 }), score: 999_999 },
    ];
    const baselineProjectionBytes = JSON.stringify(testManifestProjection(baseline));

    for (const variant of variants) {
      const subset = freezeD1PlacementManifest(variant.capture);
      expect(JSON.stringify(testManifestProjection(subset))).toBe(baselineProjectionBytes);
      expect(subset.manifestDigest).toBe(baseline.manifestDigest);
      expect(subset.capture.score).toBe(variant.score);
    }
  });

  it('does not read source action, labels, or weights while freezing the manifest', () => {
    const fixture = LEGAL_UNIVERSE_FIXTURES.at(-1)!;
    const capture = captureForLegalUniverse(fixture);
    Object.defineProperties(capture, {
      sourceBehaviorAction: { enumerable: true, get: () => { throw new Error('action must remain unread'); } },
      labels: { enumerable: true, get: () => { throw new Error('labels must remain unread'); } },
      weights: { enumerable: true, get: () => { throw new Error('weights must remain unread'); } },
    });

    const subset = freezeD1PlacementManifest(capture);
    expect(subset.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(subset.legalUniverseDigest).toBe(fixture.legalUniverseDigest);
  });
});

describe('D1 action24 diagnostic representation', () => {
  it('appends the exact eleven diagnostic names without changing afterstate13', () => {
    expect(FEATURE_NAMES).toHaveLength(13);
    expect(D1_ACTION_FEATURE_NAMES).toEqual([
      ...FEATURE_NAMES,
      'targetLaneUsableDepthDelta', 'targetLaneSetupProgressDelta',
      'targetLaneReadyRowsDelta', 'targetLanePlacedCellFraction',
      'placedPieceIsI', 'verticalIInTargetLane', 'targetLaneRemainsUsable',
      'futureIAccessProbabilityAfterAction', 'readyRowsTimesFutureIAccess',
      'setupProgressTimesFutureIAccess', 'nextDecisionLegalActionProbability',
    ]);
  });

  it('materializes afterstate13 and the action24 prefix from shared extractFeatures', () => {
    const capture = placementCapture();
    const candidate = freezeD1PlacementManifest(capture).placements[0]!;
    const transition = lockPlacement(capture.state, candidate.placement);
    const expected = extractFeatures(
      transition.boardAfter,
      transition.linesCleared,
      transition.placedCells,
    );

    expect.soft(candidate.afterstate13).toEqual(expected);
    expect.soft(candidate.action24.slice(0, 13)).toEqual(expected);
  });

  it('zeros only lane-dependent additions when the pre-state has no target lane', () => {
    const state = {
      board: createEmptyBoard(), current: createPiece(1), next: 3 as const,
      hold: null, holdAvailable: true, unseenBagMask: 0b0000101,
    };
    const placement = enumeratePlacements(state.board, state.current)[0]!;

    expect(extractD1Action24(state, placement).slice(13)).toEqual([
      0, 0, 0, 0, 1, 0, 0, 0.5, 0, 0, 1,
    ]);
  });

  it('uses one frozen lane for exact deltas, vertical I, and empty-Hold chance', () => {
    const board = boardFrom([
      '####.#####', '####.#####', '####.#####', '####.#####',
    ]);
    const state = {
      board, current: createPiece(1), next: 2 as const,
      hold: null, holdAvailable: true, unseenBagMask: 0b0000101,
    };
    const placement = enumeratePlacements(board, state.current)
      .find((entry) => cellKey(entry.piece) === '184,194,204,214')!;
    const before = structuredClone(board);
    const values = extractD1Action24(state, placement);

    expect(values.slice(13)).toEqual([-1, -1, -1, 1, 1, 1, 0, 0.5, 0, 0, 1]);
    expect(values).toHaveLength(24);
    expect(values.every(Number.isFinite)).toBe(true);
    expect(values.slice(13, 16).every((value) => value >= -1 && value <= 1)).toBe(true);
    expect(values.slice(16).every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(board).toEqual(before);
  });

  it('counts a non-empty held I once across every preview branch', () => {
    const board = boardFrom([
      '####.#####', '####.#####', '####.#####', '####.#####',
    ]);
    const state = {
      board, current: createPiece(1), next: 2 as const,
      hold: 1 as const, holdAvailable: true, unseenBagMask: 0b0000100,
    };
    const placement = enumeratePlacements(board, state.current)
      .find((entry) => cellKey(entry.piece) === '184,194,204,214')!;

    expect(extractD1Action24(state, placement)[20]).toBe(1);
  });

  it('gives a blocked promoted current zero legal probability without synthesizing a Hold rescue', () => {
    const board = boardFrom([
      '####.#####', '####.#####', '####.#####', '####.#####',
    ]);
    board[1]![3] = 7;
    const state = {
      board, current: createPiece(2), next: 1 as const,
      hold: 2 as const, holdAvailable: true, unseenBagMask: 0b0000100,
    };
    const placement = enumeratePlacements(board, state.current)[0]!;
    const transition = lockPlacement(state, placement);
    const outcome = enumerateBagOutcomes(transition.pending.unseenBagMask)[0]!;
    const branch = revealPreview(transition.pending, outcome.piece);
    expect(branch).toBeNull();
    expect(extractD1Action24(state, placement)[23]).toBe(0);
  });
});
