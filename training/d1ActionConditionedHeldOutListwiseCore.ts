import { createHash } from 'node:crypto';
import type { PublicSearchState } from '../src/ai/publicState';
import { assertPublicSearchState, enumerateBagOutcomes } from '../src/ai/publicState';
import { extractFeatures, FEATURE_NAMES } from '../src/ai/features';
import { cellKey, enumeratePlacements, projectHardDrop, type Placement } from '../src/ai/placements';
import { projectPath, samePiece } from '../src/ai/replay';
import {
  createSimState,
  simulateFromState,
  type SimResult,
  type SimulationDecisionObservation,
  type SimulationSearchDiagnostics,
} from '../src/ai/simulate';
import { DETERMINISTIC_SEARCH_LIMITS } from '../src/ai/searchBudget';
import { applyHold, lockPlacement, revealPreview } from '../src/ai/stateTransitions';
import { summarizeTetrisWell, summarizeTetrisWellAt } from '../src/ai/tetrisStrategy';
import { normalize } from '../src/ai/weights';
import type { Board, Position } from '../src/types';
import type { PendingPreviewState } from '../src/ai/publicState';
import { loadC0ValidatedRunSnapshot, type C0ValidatedRunSnapshot } from './archivedRepresentativeAudit';
import {
  D1_PROFILE,
  assertProfileSeedsDisjoint,
  deriveLabelSeeds,
  type ListwiseProtocolProfile,
} from './d2Protocol';
import { SEARCH_METADATA, type SearchMetadata } from './objective';
import type { ScoreRateCheckpoint } from './runArtifacts';

export const D1_PROTOCOL_ID = 'd1-action-conditioned-held-out-listwise-v2-variable-cardinality' as const;
export const D1_PLACEMENT_SUBSET_TAG = 'd1-placement-subset-v2-variable-cardinality' as const;
export const D1_SOURCE_HASHES = Object.freeze({
  checkpoint: '93B2A63FF221B7E6EE1BD5CBFF8AE8C75B5B96411AD5B2EE4AFFA3806B6C06BD',
  log: 'C86457320694A8C2D85C734D64D9CE6E58166D913974F945370D15FBC7C651BA',
});
export const D1_VECTOR_DIGESTS = Object.freeze({
  'gen6-best': '233cc500168fe7258305d87654a640ad9aef3f67092d5e0e016f910b9d660ca9',
  'gen10-mu': 'b669671a3cf0132db1e2948cc610aef98bf22a0284f182ac248a74fdf3234b1b',
});
export const D1_BEHAVIOR_SEEDS = Object.freeze({
  train: Object.freeze([3997649999,2652572990,1307495981,4257386268,2912309259,1567232250,222155241,3172045528,1826968519,481891510,3431781797,2086704788,741627779,3691518066,2346441057,1001364048,3951254335,2606177326,1261100317,4210990604]),
  validation: Object.freeze([2430987566,3776064575,4035800844,1085910557,1345646826,2690723835,2950460104,569817]),
  test: Object.freeze([864325133,3814215420,3554479151,2209402142,4073951689,2728874680,2469138411,1124061402,2988610949,1643533940,1383797671,38720662]),
});
export const D1_BEHAVIOR_SEED_DIGEST = '19da6a75ad75ccc71e8e7238ea01378583ab7f63cd16786ce70fa7228f981341';
export const D1_LABEL_SEED_DIGEST = 'a268a5e77c64e68faa4d8cad73727c0623df0531ba0390183742146dc365eb3f';

export type D1VectorId = keyof typeof D1_VECTOR_DIGESTS;
export type D1InvalidInputReason = 'source-hash-mismatch' | 'run-contract-mismatch' | 'vector-identity-mismatch' | 'seed-schedule-mismatch'
  | 'capture-missing-or-invalid' | 'state-fingerprint-mismatch' | 'placement-manifest-mismatch';
export class D1InvalidInputError extends Error {
  readonly name = 'D1InvalidInputError';
  constructor(readonly reason: D1InvalidInputReason) { super(`D1 invalid-input:${reason}`); }
}
export interface D1SourceVector { readonly id: D1VectorId; readonly weights: readonly number[]; readonly digest: string; }
export interface D1SourceMetadata {
  readonly version: 6;
  readonly objective: 'score-rate-v5';
  readonly gen: 10;
  readonly searchContract: SearchMetadata['searchContract'];
  readonly searchDepth: SearchMetadata['searchDepth'];
  readonly rootBeamWidth: SearchMetadata['rootBeamWidth'];
  readonly childBeamWidth: SearchMetadata['childBeamWidth'];
  readonly maxWorkUnits: SearchMetadata['maxWorkUnits'];
  readonly budgetCorpus: SearchMetadata['budgetCorpus'];
  readonly transpositionCacheEntries: SearchMetadata['transpositionCacheEntries'];
  readonly placementCacheEntries: SearchMetadata['placementCacheEntries'];
}
export interface D1Sources {
  readonly metadata: D1SourceMetadata;
  readonly sourceHashes: Readonly<{ checkpoint: string; log: string }>;
  readonly vectors: readonly D1SourceVector[];
}
export interface D1SeedManifest { behaviorSeeds: typeof D1_BEHAVIOR_SEEDS; behaviorSeedDigest: string; labelSeedDigest: string; }
export type D1Split = keyof typeof D1_BEHAVIOR_SEEDS;
export interface D1CapturedState {
  readonly split: D1Split;
  readonly groupOrdinal: number;
  readonly behaviorSeed: number;
  readonly behaviorVectorId: D1VectorId;
  readonly behaviorVectorDigest: string;
  readonly captureSlot: 128 | 512;
  readonly state: PublicSearchState;
  readonly score: number;
  readonly lines: number;
  readonly level: number;
  readonly scheduledPieceNumber: 128 | 512;
  readonly sourceDiagnostics: SimulationSearchDiagnostics;
  readonly stateFingerprint: string;
}
export interface D1BehaviorRunnerInput {
  readonly behaviorSeed: number;
  readonly weights: readonly number[];
  readonly onDecision: (observation: SimulationDecisionObservation) => void;
}
export type D1BehaviorRunner = (input: D1BehaviorRunnerInput) => Pick<SimResult, 'reason' | 'pieces'>;
export interface D1PlacementCandidate {
  readonly placementId: string;
  readonly placement: Placement;
  readonly boardAfter: Board;
  readonly linesCleared: number;
  readonly placedCells: readonly Position[];
  readonly pending: PendingPreviewState;
  readonly afterstate13: readonly number[];
  readonly action24: readonly number[];
}

export const D1_ACTION_FEATURE_NAMES = Object.freeze([
  ...FEATURE_NAMES,
  'targetLaneUsableDepthDelta', 'targetLaneSetupProgressDelta',
  'targetLaneReadyRowsDelta', 'targetLanePlacedCellFraction',
  'placedPieceIsI', 'verticalIInTargetLane', 'targetLaneRemainsUsable',
  'futureIAccessProbabilityAfterAction', 'readyRowsTimesFutureIAccess',
  'setupProgressTimesFutureIAccess', 'nextDecisionLegalActionProbability',
] as const);
export const D1_REPRESENTATIONS = Object.freeze(['afterstate13', 'action24'] as const);
export type D1RepresentationId = typeof D1_REPRESENTATIONS[number];
export interface D1FrozenSubset {
  readonly subsetId: string;
  readonly capture: D1CapturedState;
  readonly legalCount: number;
  readonly selectedCount: number;
  readonly legalPlacementIds: readonly string[];
  readonly legalUniverseDigest: string;
  readonly placements: readonly D1PlacementCandidate[];
  readonly manifestDigest: string;
}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const finiteVector = (value: unknown): value is number[] => Array.isArray(value) && value.length === 13 && value.every(Number.isFinite);
const assert: (
  condition: unknown,
  reason: D1InvalidInputReason,
) => asserts condition = (condition, reason) => {
  if (!condition) throw new D1InvalidInputError(reason);
};

function validateRunContract(checkpoint: ScoreRateCheckpoint): void {
  assert(checkpoint.version === 6 && checkpoint.objective === 'score-rate-v5' && checkpoint.gen === 10 &&
    Object.entries(SEARCH_METADATA).every(([key, value]) => checkpoint[key as keyof SearchMetadata] === value), 'run-contract-mismatch');
}

function projectD1Metadata(checkpoint: ScoreRateCheckpoint): D1SourceMetadata {
  return Object.freeze({
    version: checkpoint.version,
    objective: checkpoint.objective,
    gen: checkpoint.gen,
    searchContract: checkpoint.searchContract,
    searchDepth: checkpoint.searchDepth,
    rootBeamWidth: checkpoint.rootBeamWidth,
    childBeamWidth: checkpoint.childBeamWidth,
    maxWorkUnits: checkpoint.maxWorkUnits,
    budgetCorpus: checkpoint.budgetCorpus,
    transpositionCacheEntries: checkpoint.transpositionCacheEntries,
    placementCacheEntries: checkpoint.placementCacheEntries,
  }) as D1SourceMetadata;
}

export function loadD1Sources(snapshot: C0ValidatedRunSnapshot = loadC0ValidatedRunSnapshot()): D1Sources {
  assert(snapshot.sourceHashes.checkpoint === D1_SOURCE_HASHES.checkpoint && snapshot.sourceHashes.log === D1_SOURCE_HASHES.log,
    'source-hash-mismatch');
  validateRunContract(snapshot.checkpoint);
  const gen6 = snapshot.records[6]?.bestWeights;
  const gen10 = normalize(snapshot.checkpoint.mu);
  assert(finiteVector(gen6) && finiteVector(gen10) && digest(gen6) === D1_VECTOR_DIGESTS['gen6-best'] &&
    digest(gen10) === D1_VECTOR_DIGESTS['gen10-mu'], 'vector-identity-mismatch');
  return Object.freeze({
    metadata: projectD1Metadata(snapshot.checkpoint),
    sourceHashes: Object.freeze({ ...snapshot.sourceHashes }),
    vectors: Object.freeze([
      Object.freeze({ id: 'gen6-best' as const, weights: Object.freeze([...gen6]), digest: D1_VECTOR_DIGESTS['gen6-best'] }),
      Object.freeze({ id: 'gen10-mu' as const, weights: Object.freeze([...gen10]), digest: D1_VECTOR_DIGESTS['gen10-mu'] }),
    ]),
  });
}

const frozenBehaviorSeedCopy = (profile: ListwiseProtocolProfile): typeof D1_BEHAVIOR_SEEDS => Object.freeze({
  train: Object.freeze([...profile.behaviorSeeds.train]),
  validation: Object.freeze([...profile.behaviorSeeds.validation]),
  test: Object.freeze([...profile.behaviorSeeds.test]),
});

/**
 * The pinned D1 literals and the derived D1 profile must agree exactly. This
 * is the parity guard for the parameterization: any drift between the
 * historical constants and the profile-driven derivation fails closed instead
 * of silently changing D1's frozen inputs.
 */
function assertD1ProfileParity(profile: ListwiseProtocolProfile): void {
  if (profile.baseSeed !== D1_PROFILE.baseSeed) return;
  assert(JSON.stringify(profile.behaviorSeeds) === JSON.stringify(D1_BEHAVIOR_SEEDS)
    && profile.behaviorSeedDigest === D1_BEHAVIOR_SEED_DIGEST
    && profile.labelSeedDigest === D1_LABEL_SEED_DIGEST
    && profile.placementSubsetTag === D1_PLACEMENT_SUBSET_TAG
    && profile.protocolId === D1_PROTOCOL_ID,
  'seed-schedule-mismatch');
}

export function buildD1SeedManifest(profile: ListwiseProtocolProfile = D1_PROFILE): D1SeedManifest {
  assertD1ProfileParity(profile);
  try {
    assertProfileSeedsDisjoint(profile);
  } catch {
    throw new D1InvalidInputError('seed-schedule-mismatch');
  }
  return {
    behaviorSeeds: frozenBehaviorSeedCopy(profile),
    behaviorSeedDigest: profile.behaviorSeedDigest,
    labelSeedDigest: profile.labelSeedDigest,
  };
}

export function buildD1LabelSeeds(
  manifest: D1SeedManifest = buildD1SeedManifest(),
  profile: ListwiseProtocolProfile = D1_PROFILE,
): number[] {
  assertD1ProfileParity(profile);
  assert(manifest.behaviorSeedDigest === profile.behaviorSeedDigest && manifest.labelSeedDigest === profile.labelSeedDigest &&
    JSON.stringify(manifest.behaviorSeeds) === JSON.stringify(profile.behaviorSeeds), 'seed-schedule-mismatch');
  const seeds = [...deriveLabelSeeds(profile)];
  assert(digest(seeds) === profile.labelSeedDigest, 'seed-schedule-mismatch');
  return seeds;
}

const CAPTURE_SLOTS = [128, 512] as const;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

function clonePublicState(state: PublicSearchState): PublicSearchState {
  return {
    board: state.board.map((row) => [...row]),
    current: {
      type: state.current.type,
      rotation: state.current.rotation,
      position: { ...state.current.position },
    },
    next: state.next,
    hold: state.hold,
    holdAvailable: state.holdAvailable,
    unseenBagMask: state.unseenBagMask,
  };
}

function stateFingerprint(input: {
  state: PublicSearchState;
  score: number;
  lines: number;
  level: number;
  scheduledPieceNumber: number;
}): string {
  const { state } = input;
  return digest([
    state.board,
    state.current.type,
    state.current.rotation,
    state.current.position.x,
    state.current.position.y,
    state.next,
    state.hold,
    state.holdAvailable,
    state.unseenBagMask,
    input.score,
    input.lines,
    input.level,
    input.scheduledPieceNumber,
  ]);
}

function finiteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function completeFiniteRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => {
    if (typeof entry === 'number') return Number.isFinite(entry);
    if (typeof entry === 'boolean') return true;
    if (Array.isArray(entry)) return entry.every((item) => typeof item === 'number' && Number.isFinite(item));
    return false;
  });
}

const SEARCH_DIAGNOSTIC_KEYS = [
  'completedDepth', 'attemptedDepth', 'workUnitsUsed', 'workUnitsLimit',
  'placementEvaluationUnits', 'chanceExpansionUnits', 'cacheHitUnits',
  'budgetExhausted', 'expandedDecisionNodes', 'expandedChanceNodes', 'cacheHits',
  'placementCacheHits', 'placementCacheEntries', 'transpositionEntries',
  'equivalentPlacementsRemoved', 'prunedChanceBranches', 'aborted',
] as const;
const SIMULATION_DIAGNOSTIC_KEYS = [
  'searchCalls', 'holdActions', 'holdRate', 'meanCompletedDepth', 'minCompletedDepth',
  'completedDepthHistogram', 'totalWorkUnitsUsed', 'meanWorkUnitsUsed',
  'maxWorkUnitsUsed', 'budgetExhaustedSearches', 'budgetExhaustionRate',
  'placementEvaluationUnits', 'chanceExpansionUnits', 'cacheHitUnits',
  'expandedDecisionNodes', 'expandedChanceNodes', 'cacheHits',
] as const;
const hasKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

function validObservation(observation: unknown, slot: 128 | 512): observation is SimulationDecisionObservation {
  if (observation === null || typeof observation !== 'object') return false;
  const candidate = observation as SimulationDecisionObservation;
  try {
    assertPublicSearchState(candidate.publicState);
  } catch {
    return false;
  }
  return candidate.scheduledPieceNumber === slot
    && finiteNonNegativeInteger(candidate.score)
    && finiteNonNegativeInteger(candidate.lines)
    && finiteNonNegativeInteger(candidate.level)
    && candidate.decision !== null
    && typeof candidate.decision === 'object'
    && (candidate.decision.action?.kind === 'hold' || candidate.decision.action?.kind === 'place')
    && completeFiniteRecord(candidate.decision.value)
    && completeFiniteRecord(candidate.decision.diagnostics)
    && hasKeys(candidate.decision.diagnostics, SEARCH_DIAGNOSTIC_KEYS)
    && completeFiniteRecord(candidate.searchDiagnostics)
    && hasKeys(candidate.searchDiagnostics, SIMULATION_DIAGNOSTIC_KEYS)
    && Array.isArray(candidate.searchDiagnostics.completedDepthHistogram)
    && candidate.searchDiagnostics.completedDepthHistogram.length === 5;
}

const realBehaviorRunner: D1BehaviorRunner = ({ behaviorSeed, weights, onDecision }) => {
  const state = createSimState(behaviorSeed);
  return simulateFromState(state, {
    weights: [...weights],
    maxPieces: 512,
    limits: DETERMINISTIC_SEARCH_LIMITS,
    onDecision,
  });
};

/**
 * One behavior trajectory, yielding that trajectory's two frozen capture
 * slots in canonical slot order.
 *
 * Extracted from `captureD1States` unchanged so a sharded runner can execute a
 * single (split, group, vector) coordinate as its own unit of work. The
 * cross-trajectory fingerprint uniqueness check stays with the caller, because
 * it is a property of the whole 160-state set and no single trajectory can
 * decide it.
 */
export function captureD1Trajectory(input: {
  readonly split: D1Split;
  readonly groupOrdinal: number;
  readonly behaviorSeed: number;
  readonly vector: D1SourceVector;
  readonly runBehavior?: D1BehaviorRunner;
}): readonly D1CapturedState[] {
  const { split, groupOrdinal, behaviorSeed, vector } = input;
  const runBehavior = input.runBehavior ?? realBehaviorRunner;
  const captured = new Map<128 | 512, D1CapturedState>();
  const result = runBehavior({
    behaviorSeed,
    weights: vector.weights,
    onDecision: (observation) => {
      const slot = CAPTURE_SLOTS.find((candidate) => observation?.scheduledPieceNumber === candidate);
      if (slot === undefined || captured.has(slot)) return;
      assert(validObservation(observation, slot), 'capture-missing-or-invalid');
      const state = clonePublicState(observation.publicState);
      const fingerprint = stateFingerprint({
        state,
        score: observation.score,
        lines: observation.lines,
        level: observation.level,
        scheduledPieceNumber: slot,
      });
      const capture = deepFreeze({
        split,
        groupOrdinal,
        behaviorSeed,
        behaviorVectorId: vector.id,
        behaviorVectorDigest: vector.digest,
        captureSlot: slot,
        state,
        score: observation.score,
        lines: observation.lines,
        level: observation.level,
        scheduledPieceNumber: slot,
        sourceDiagnostics: structuredClone(observation.searchDiagnostics),
        stateFingerprint: fingerprint,
      });
      captured.set(slot, capture);
    },
  });
  assert(result.reason === 'pieceCap' && result.pieces >= 512 && CAPTURE_SLOTS.every((slot) => captured.has(slot)),
    'capture-missing-or-invalid');
  return CAPTURE_SLOTS.map((slot) => captured.get(slot)!);
}

export function captureD1States(input: {
  readonly sources?: D1Sources;
  readonly seedManifest?: D1SeedManifest;
  readonly runBehavior?: D1BehaviorRunner;
  readonly profile?: ListwiseProtocolProfile;
} = {}): readonly D1CapturedState[] {
  const profile = input.profile ?? D1_PROFILE;
  const sources = input.sources ?? loadD1Sources();
  const manifest = input.seedManifest ?? buildD1SeedManifest(profile);
  buildD1LabelSeeds(manifest, profile);
  const runBehavior = input.runBehavior ?? realBehaviorRunner;
  const captures: D1CapturedState[] = [];
  const fingerprints = new Set<string>();

  for (const split of ['train', 'validation', 'test'] as const) {
    for (const [groupOrdinal, behaviorSeed] of manifest.behaviorSeeds[split].entries()) {
      for (const vector of sources.vectors) {
        for (const capture of captureD1Trajectory({
          split, groupOrdinal, behaviorSeed, vector, runBehavior,
        })) {
          assert(!fingerprints.has(capture.stateFingerprint), 'state-fingerprint-mismatch');
          fingerprints.add(capture.stateFingerprint);
          captures.push(capture);
        }
      }
    }
  }

  assert(captures.length === 160 && fingerprints.size === 160, 'capture-missing-or-invalid');
  return deepFreeze(captures);
}

function replayMatches(state: PublicSearchState, placement: Placement): boolean {
  const path = projectPath(state.board, state.current, placement.moves);
  if (path.length !== placement.moves.length) return false;
  const pathEnd = path.at(-1) ?? state.current;
  return samePiece(projectHardDrop(state.board, pathEnd), placement.piece);
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

function branchHasImmediateIAccess(state: PublicSearchState): boolean {
  if (state.current.type === 1) return true;
  if (!state.holdAvailable) return false;
  if (state.hold === 1) return true;
  return state.hold === null && state.next === 1;
}

function branchHasLegalAction(state: PublicSearchState): boolean {
  if (enumeratePlacements(state.board, state.current).length > 0) return true;
  const held = applyHold(state);
  if (held.kind === 'unavailable') return false;
  if (held.kind === 'ready') {
    return enumeratePlacements(held.state.board, held.state.current).length > 0;
  }
  return enumerateBagOutcomes(held.state.unseenBagMask).some(({ piece }) => {
    const materialized = revealPreview(held.state, piece);
    return materialized !== null
      && enumeratePlacements(materialized.board, materialized.current).length > 0;
  });
}

export function extractD1Action24(
  state: PublicSearchState,
  placement: Placement,
): readonly number[] {
  assertPublicSearchState(state);
  const transition = lockPlacement(state, placement);
  const base = extractFeatures(
    transition.boardAfter,
    transition.linesCleared,
    transition.placedCells,
  );
  const before = summarizeTetrisWell(state.board);
  const hasTargetLane = before.usableDepth !== 0 || before.setupCells !== 0 || before.readyRows !== 0;
  const after = hasTargetLane ? summarizeTetrisWellAt(transition.boardAfter, before.column) : null;
  const targetLaneUsableDepthDelta = after === null ? 0
    : clamp((after.usableDepth - before.usableDepth) / 4, -1, 1);
  const targetLaneSetupProgressDelta = after === null ? 0
    : clamp((after.setupCells - before.setupCells) / 36, -1, 1);
  const targetLaneReadyRowsDelta = after === null ? 0
    : clamp((after.readyRows - before.readyRows) / 4, -1, 1);
  const targetLanePlacedCellFraction = after === null ? 0
    : transition.placedCells.filter(({ x }) => x === before.column).length / 4;
  const placedPieceIsI = placement.piece.type === 1 ? 1 : 0;
  const verticalIInTargetLane = after !== null && placedPieceIsI === 1
    && transition.placedCells.every(({ x }) => x === before.column) ? 1 : 0;
  const targetLaneRemainsUsable = after !== null && after.usableDepth > 0 ? 1 : 0;

  let futureIAccessProbabilityAfterAction = 0;
  let readyRowsTimesFutureIAccess = 0;
  let setupProgressTimesFutureIAccess = 0;
  let nextDecisionLegalActionProbability = 0;
  for (const outcome of enumerateBagOutcomes(transition.pending.unseenBagMask)) {
    const branch = revealPreview(transition.pending, outcome.piece);
    if (branch === null) continue;
    const futureIAccess = branchHasImmediateIAccess(branch) ? 1 : 0;
    futureIAccessProbabilityAfterAction += outcome.probability * futureIAccess;
    if (after !== null) {
      readyRowsTimesFutureIAccess += outcome.probability
        * clamp(after.readyRows / 4, 0, 1) * futureIAccess;
      setupProgressTimesFutureIAccess += outcome.probability
        * clamp(after.setupCells / 36, 0, 1) * futureIAccess;
    }
    if (branchHasLegalAction(branch)) {
      nextDecisionLegalActionProbability += outcome.probability;
    }
  }

  const additions = [
    targetLaneUsableDepthDelta,
    targetLaneSetupProgressDelta,
    targetLaneReadyRowsDelta,
    targetLanePlacedCellFraction,
    placedPieceIsI,
    verticalIInTargetLane,
    targetLaneRemainsUsable,
    futureIAccessProbabilityAfterAction,
    readyRowsTimesFutureIAccess,
    setupProgressTimesFutureIAccess,
    nextDecisionLegalActionProbability,
  ];
  assert(additions.every(Number.isFinite)
    && additions.slice(0, 3).every((value) => value >= -1 && value <= 1)
    && additions.slice(3).every((value) => value >= 0 && value <= 1),
  'placement-manifest-mismatch');
  return deepFreeze([...base, ...additions]);
}

export function freezeD1PlacementManifest(
  capture: D1CapturedState,
  profile: ListwiseProtocolProfile = D1_PROFILE,
): D1FrozenSubset {
  const placements = enumeratePlacements(capture.state.board, capture.state.current)
    .map((placement) => ({
      placement,
      placementId: `${placement.piece.type}:${cellKey(placement.piece)}`,
    }))
    .sort((left, right) => left.placementId.localeCompare(right.placementId));
  const legalPlacementIds = placements.map(({ placementId }) => placementId);
  assert(legalPlacementIds.length >= 2 && new Set(legalPlacementIds).size === legalPlacementIds.length,
    'placement-manifest-mismatch');
  assert(placements.every(({ placement }) => replayMatches(capture.state, placement)),
    'placement-manifest-mismatch');
  const selectedCount = Math.min(12, legalPlacementIds.length);

  const selected = placements
    .map((entry) => ({
      ...entry,
      selectionDigest: digest([
        capture.stateFingerprint,
        entry.placementId,
        profile.placementSubsetTag,
      ]),
    }))
    .sort((left, right) => left.selectionDigest.localeCompare(right.selectionDigest)
      || left.placementId.localeCompare(right.placementId))
    .slice(0, selectedCount)
    .sort((left, right) => left.placementId.localeCompare(right.placementId));

  const candidates = selected.map(({ placement, placementId }) => {
    const transition = lockPlacement(capture.state, placement);
    return deepFreeze({
      placementId,
      placement: structuredClone(placement),
      boardAfter: transition.boardAfter.map((row) => [...row]),
      linesCleared: transition.linesCleared,
      placedCells: transition.placedCells.map((cell) => ({ ...cell })),
      pending: {
        ...transition.pending,
        board: transition.pending.board.map((row) => [...row]),
        current: structuredClone(transition.pending.current),
      },
      afterstate13: extractFeatures(transition.boardAfter, transition.linesCleared, transition.placedCells),
      action24: extractD1Action24(capture.state, placement),
    });
  });

  const frozenCapture = deepFreeze({
    split: capture.split,
    groupOrdinal: capture.groupOrdinal,
    behaviorSeed: capture.behaviorSeed,
    behaviorVectorId: capture.behaviorVectorId,
    behaviorVectorDigest: capture.behaviorVectorDigest,
    captureSlot: capture.captureSlot,
    state: clonePublicState(capture.state),
    score: capture.score,
    lines: capture.lines,
    level: capture.level,
    scheduledPieceNumber: capture.scheduledPieceNumber,
    sourceDiagnostics: structuredClone(capture.sourceDiagnostics),
    stateFingerprint: capture.stateFingerprint,
  });
  const manifestCaptureProjection = {
    split: frozenCapture.split,
    groupOrdinal: frozenCapture.groupOrdinal,
    behaviorSeed: frozenCapture.behaviorSeed,
    behaviorVectorId: frozenCapture.behaviorVectorId,
    behaviorVectorDigest: frozenCapture.behaviorVectorDigest,
    captureSlot: frozenCapture.captureSlot,
    state: frozenCapture.state,
    lines: frozenCapture.lines,
    level: frozenCapture.level,
    scheduledPieceNumber: frozenCapture.scheduledPieceNumber,
    sourceDiagnostics: frozenCapture.sourceDiagnostics,
    stateFingerprint: frozenCapture.stateFingerprint,
  };
  const manifestProjection = {
    capture: manifestCaptureProjection,
    legalCount: legalPlacementIds.length,
    selectedCount,
    legalPlacementIds,
    legalUniverseDigest: digest(legalPlacementIds),
    placements: candidates.map((candidate) => ({
      placementId: candidate.placementId,
      placedCells: candidate.placedCells,
      boardAfter: candidate.boardAfter,
      linesCleared: candidate.linesCleared,
      pending: candidate.pending,
      afterstate13: candidate.afterstate13,
      action24: candidate.action24,
    })),
  };

  return deepFreeze({
    subsetId: capture.stateFingerprint,
    capture: frozenCapture,
    legalCount: legalPlacementIds.length,
    selectedCount,
    legalPlacementIds,
    legalUniverseDigest: digest(legalPlacementIds),
    placements: candidates,
    manifestDigest: digest(manifestProjection),
  });
}
