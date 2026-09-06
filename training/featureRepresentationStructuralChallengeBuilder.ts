import { createHash } from 'node:crypto';
import { BOARD_WIDTH, TOTAL_ROWS } from '../src/constants';
import { getPieceCells, isValidPosition } from '../src/engine/board';
import { createPiece } from '../src/engine/piece';
import { extractFeatures } from '../src/ai/features';
import { cellKey, enumeratePlacements, type Placement } from '../src/ai/placements';
import { assertPublicSearchState, type PublicSearchState } from '../src/ai/publicState';
import { lockPlacement, type PlacementTransition } from '../src/ai/stateTransitions';
import {
  columnHeights,
  compareTetrisWellSummaries,
  summarizeTetrisWell,
  summarizeTetrisWellAt,
  type TetrisWellSummary,
  type WellColumn,
} from '../src/ai/tetrisStrategy';
import type { Board, Piece, PieceType } from '../src/types';
import {
  B1_1_CHALLENGE_STATES,
  type ChallengeState,
} from './featureRepresentationChallengeCorpus';
import { B1_PLACEMENT_PAIR_DESCRIPTORS } from './featureRepresentationCorpus';
import {
  TETRIS_OPPORTUNITY_CORPUS_V1,
  type SerializedOpportunityState,
} from './tetrisOpportunityCorpus';

export const B1_2_CORPUS_ID_VALUE = 'b1-2-structural-challenge-corpus-v1' as const;

export const B1_2_ALIAS_WELL_PAIRS = [[1, 8], [2, 7], [3, 6], [4, 5]] as const;
export const B1_2_BASE_HEIGHTS = [4, 5, 6, 7, 8, 9] as const;
export const B1_2_WELL_DROPS = [2, 3, 4] as const;
export const B1_2_ALIAS_PIECES = [1, 2, 3] as const;
export const B1_2_PUBLIC_MASKS = [0, 1, 2, 4, 8, 16, 32, 64, 127] as const;

const SHOULDER_LIFTS = [0, 1, 2] as const;
const CENTER_DIPS = [0, 1] as const;
const TARGET_COLUMNS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const SHOULDER_DELTAS = [0, 1, 2] as const;
const PIECES = [1, 2, 3, 4, 5, 6, 7] as const;
const PUBLIC_HOLDS = [null, 1, 2, 3, 4, 5, 6, 7] as const;
const PUBLIC_HOLD_AVAILABILITY = [false, true] as const;
const SAFETY_BASE_HEIGHTS = [12, 13, 14, 15, 16, 17, 18] as const;
const SAFETY_WELL_DROPS = [1, 2, 3, 4] as const;
const SAFETY_NOTCH_OFFSETS = [-3, -2, -1, 0] as const;
const DEFAULT_MASKS = [0, 21, 42, 85, 127] as const;

export type B1_2Group =
  | 'target-lane-alias'
  | 'lane-transfer-control'
  | 'public-i-context-control'
  | 'safety-control';

export type B1_2Category = 'strategy' | 'safety';
export type B1_2PositiveClass = 'preserve-target-lane' | 'safety-only';
export type B1_2NegativeClass = 'destroy-target-lane' | 'risky-survival';

export interface B1_2State {
  id: string;
  group: B1_2Group;
  rows: readonly number[];
  current: Piece;
  next: PieceType;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: number;
  targetWellColumn: WellColumn;
}

export interface B1_2PairDescriptor {
  id: string;
  category: B1_2Category;
  stateId: string;
  group: B1_2Group;
  positiveCellKey: string;
  negativeCellKey: string;
  positiveClass: B1_2PositiveClass;
  negativeClass: B1_2NegativeClass;
}

export interface B1_2Manifest {
  corpusId: typeof B1_2_CORPUS_ID_VALUE;
  states: readonly B1_2State[];
  pairs: readonly B1_2PairDescriptor[];
}

interface Candidate {
  state: Omit<B1_2State, 'id'>;
  pair: Omit<B1_2PairDescriptor, 'id' | 'stateId'>;
}

interface EvaluatedPlacement {
  placement: Placement;
  key: string;
  transition: PlacementTransition;
  targetAfter: TetrisWellSummary;
  targetDelta: readonly [number, number, number];
  maxHeight: number;
  survives: boolean;
  verticalIAccess: boolean;
}

export class B1_2CorpusInsufficiencyError extends Error {
  readonly group: B1_2Group;
  readonly required: number;
  readonly actual: number;

  constructor(group: B1_2Group, required: number, actual: number) {
    super(`B1.2 frozen grammar admitted ${actual}/${required} ${group} candidates`);
    this.name = 'B1_2CorpusInsufficiencyError';
    this.group = group;
    this.required = required;
    this.actual = actual;
  }
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function rowsOf(value: Pick<B1_2State, 'rows'> | SerializedOpportunityState | ChallengeState): readonly number[] {
  return value.rows;
}

export function stateFingerprint(state: Omit<B1_2State, 'id' | 'group'> | B1_2State): string {
  return sha256([
    state.rows,
    state.current.type,
    state.current.rotation,
    state.current.position,
    state.next,
    state.hold,
    state.holdAvailable,
    state.unseenBagMask,
    state.targetWellColumn,
  ]);
}

export function structuralProvenanceFingerprint(
  state: Pick<B1_2State, 'rows' | 'current'> | SerializedOpportunityState | ChallengeState,
): string {
  return sha256([
    rowsOf(state),
    state.current.type,
    state.current.rotation,
    state.current.position,
  ]);
}

export function pairFingerprint(
  stateOrFingerprint: Pick<B1_2State, 'rows' | 'current' | 'next' | 'hold' | 'holdAvailable' | 'unseenBagMask' | 'targetWellColumn'> | string,
  pair: Pick<B1_2PairDescriptor, 'positiveCellKey' | 'negativeCellKey' | 'positiveClass' | 'negativeClass'>,
): string {
  const fingerprint = typeof stateOrFingerprint === 'string'
    ? stateOrFingerprint
    : stateFingerprint(stateOrFingerprint);
  return sha256([
    fingerprint,
    pair.positiveCellKey,
    pair.negativeCellKey,
    pair.positiveClass,
    pair.negativeClass,
  ]);
}

function boardFromHeights(heights: readonly number[]): Board {
  return Array.from({ length: TOTAL_ROWS }, (_, row) => Array.from(
    { length: BOARD_WIDTH },
    (_, column) => row >= TOTAL_ROWS - heights[column] ? 1 : 0,
  ));
}

function rowsFromBoard(board: Board): number[] {
  return board.map((row) => row.reduce(
    (mask, value, column) => value === 0 ? mask : mask | (1 << column),
    0,
  ));
}

function publicFields(templateIndex: number): Pick<
  B1_2State,
  'next' | 'hold' | 'holdAvailable' | 'unseenBagMask'
> {
  return {
    next: (((templateIndex + 1) % 7) + 1) as PieceType,
    hold: templateIndex % 3 === 0 ? null : (((templateIndex + 3) % 7) + 1) as PieceType,
    holdAvailable: templateIndex % 2 === 0,
    unseenBagMask: DEFAULT_MASKS[templateIndex % DEFAULT_MASKS.length],
  };
}

function makeState(
  group: B1_2Group,
  board: Board,
  currentType: PieceType,
  targetWellColumn: WellColumn,
  fields: Pick<B1_2State, 'next' | 'hold' | 'holdAvailable' | 'unseenBagMask'>,
): Omit<B1_2State, 'id'> {
  return {
    group,
    rows: rowsFromBoard(board),
    current: createPiece(currentType),
    targetWellColumn,
    ...fields,
  };
}

function materializeState(state: Omit<B1_2State, 'id'>): PublicSearchState {
  const materialized: PublicSearchState = {
    board: state.rows.map((mask) => Array.from(
      { length: BOARD_WIDTH },
      (_, column) => (mask & (1 << column)) === 0 ? 0 : 1,
    )),
    current: { ...state.current, position: { ...state.current.position } },
    next: state.next,
    hold: state.hold,
    holdAvailable: state.holdAvailable,
    unseenBagMask: state.unseenBagMask,
  };
  assertPublicSearchState(materialized);
  return materialized;
}

function publicIAvailable(state: Omit<B1_2State, 'id'>): boolean {
  return state.current.type === 1
    || state.next === 1
    || (state.holdAvailable && state.hold === 1)
    || (state.unseenBagMask & 1) !== 0;
}

function hasVerticalIAccess(board: Board, target: WellColumn): boolean {
  return enumeratePlacements(board, createPiece(1)).some((placement) => (
    getPieceCells(placement.piece).every((cell) => cell.x === target)
  ));
}

function evaluatePlacement(
  state: PublicSearchState,
  target: WellColumn,
  before: TetrisWellSummary,
  placement: Placement,
  needsVerticalIAccess: boolean,
): EvaluatedPlacement {
  const transition = lockPlacement(state, placement);
  const targetAfter = summarizeTetrisWellAt(transition.boardAfter, target);
  const heights = columnHeights(transition.boardAfter);
  return {
    placement,
    key: cellKey(placement.piece),
    transition,
    targetAfter,
    targetDelta: [
      targetAfter.usableDepth - before.usableDepth,
      (targetAfter.setupCells - before.setupCells) / 9,
      targetAfter.readyRows - before.readyRows,
    ],
    maxHeight: Math.max(...heights),
    survives: isValidPosition(transition.boardAfter, transition.pending.current),
    verticalIAccess: needsVerticalIAccess && hasVerticalIAccess(transition.boardAfter, target),
  };
}

function domainPair(
  stateValue: Omit<B1_2State, 'id'>,
  positive: EvaluatedPlacement,
  negative: EvaluatedPlacement,
): boolean {
  if (positive.transition.linesCleared !== negative.transition.linesCleared) return false;
  if (!positive.survives || !negative.survives) return false;
  if (positive.maxHeight > negative.maxHeight) return false;

  const beforeState = materializeState(stateValue);
  const before = summarizeTetrisWell(beforeState.board);
  if (before.column !== stateValue.targetWellColumn) return false;
  if (before.usableDepth === 0 && before.setupCells === 0 && before.readyRows === 0) return false;
  if (compareTetrisWellSummaries(positive.targetAfter, before) < 0) return false;
  if (compareTetrisWellSummaries(negative.targetAfter, before) >= 0) return false;
  if (publicIAvailable(stateValue) && (!positive.verticalIAccess || negative.verticalIAccess)) return false;
  return true;
}

function oldAliasAdmission(positive: EvaluatedPlacement, negative: EvaluatedPlacement): boolean {
  const oldPositive = extractFeatures(
    positive.transition.boardAfter,
    positive.transition.linesCleared,
    positive.transition.placedCells,
  );
  const oldNegative = extractFeatures(
    negative.transition.boardAfter,
    negative.transition.linesCleared,
    negative.transition.placedCells,
  );
  const exactOldAlias = oldPositive.every((value, index) => Object.is(value, oldNegative[index]));
  const newPositive = [...oldPositive, ...positive.targetDelta];
  const newNegative = [...oldNegative, ...negative.targetDelta];
  const laneDeltaDiffers = newPositive.slice(13, 16)
    .some((value, index) => !Object.is(value, newNegative[13 + index]));
  return exactOldAlias && laneDeltaDiffers;
}

function mirrorCellKey(value: string): string {
  return value.split(',').map(Number).map((index) => {
    const row = Math.floor(index / BOARD_WIDTH);
    const column = index % BOARD_WIDTH;
    return row * BOARD_WIDTH + (BOARD_WIDTH - 1 - column);
  }).sort((left, right) => left - right).join(',');
}

function candidatePair(
  stateValue: Omit<B1_2State, 'id'>,
  requireAlias: boolean,
): Candidate | null {
  const rowsSnapshot = [...stateValue.rows];
  const state = materializeState(stateValue);
  const before = summarizeTetrisWell(state.board);
  if (before.column !== stateValue.targetWellColumn) return null;
  if (before.usableDepth === 0 && before.setupCells === 0 && before.readyRows === 0) return null;

  const needsVerticalIAccess = publicIAvailable(stateValue);
  const evaluated = enumeratePlacements(state.board, state.current)
    .map((placement) => evaluatePlacement(
      state, stateValue.targetWellColumn, before, placement, needsVerticalIAccess,
    ))
    .sort((left, right) => left.key.localeCompare(right.key));

  if (stateValue.rows.some((row, index) => row !== rowsSnapshot[index])) {
    throw new Error('B1.2 grammar state rows were mutated during placement enumeration');
  }

  if (requireAlias) {
    const byKey = new Map(evaluated.map((placement) => [placement.key, placement]));
    for (const placement of evaluated) {
      const mirror = byKey.get(mirrorCellKey(placement.key));
      if (mirror === undefined || placement.key === mirror.key) continue;
      for (const [positive, negative] of [[placement, mirror], [mirror, placement]] as const) {
        if (!domainPair(stateValue, positive, negative)) continue;
        if (!oldAliasAdmission(positive, negative)) continue;
        return toCandidate(stateValue, positive, negative);
      }
    }
    return null;
  }

  for (let positiveIndex = 0; positiveIndex < evaluated.length; positiveIndex++) {
    for (let negativeIndex = positiveIndex + 1; negativeIndex < evaluated.length; negativeIndex++) {
      const positive = evaluated[positiveIndex];
      const negative = evaluated[negativeIndex];
      if (!domainPair(stateValue, positive, negative)) continue;
      return toCandidate(stateValue, positive, negative);
    }
  }
  return null;
}

function toCandidate(
  state: Omit<B1_2State, 'id'>,
  positive: EvaluatedPlacement,
  negative: EvaluatedPlacement,
): Candidate {
  const safety = state.group === 'safety-control';
  return {
    state,
    pair: {
      category: safety ? 'safety' : 'strategy',
      group: state.group,
      positiveCellKey: positive.key,
      negativeCellKey: negative.key,
      positiveClass: safety ? 'safety-only' : 'preserve-target-lane',
      negativeClass: safety ? 'risky-survival' : 'destroy-target-lane',
    },
  };
}

function aliasBoard(
  leftWell: number,
  rightWell: number,
  baseHeight: number,
  wellDrop: number,
  shoulderLift: number,
  centerDip: number,
): Board {
  const heights = new Array<number>(BOARD_WIDTH).fill(baseHeight);
  heights[leftWell] -= wellDrop;
  heights[rightWell] -= wellDrop;
  for (const column of [leftWell - 1, leftWell + 1, rightWell - 1, rightWell + 1]) {
    if (column >= 0 && column < BOARD_WIDTH && column !== leftWell && column !== rightWell) {
      heights[column] += shoulderLift;
    }
  }
  heights[4] -= centerDip;
  heights[5] -= centerDip;
  return boardFromHeights(heights);
}

function laneBoard(
  target: WellColumn,
  baseHeight: number,
  wellDrop: number,
  leftShoulderDelta: number,
  rightShoulderDelta: number,
): Board {
  const heights = new Array<number>(BOARD_WIDTH).fill(baseHeight);
  heights[target] -= wellDrop;
  if (target > 0) heights[target - 1] += leftShoulderDelta;
  if (target < BOARD_WIDTH - 1) heights[target + 1] += rightShoulderDelta;
  return boardFromHeights(heights);
}

function safetyBoard(
  target: WellColumn,
  baseHeight: number,
  wellDrop: number,
  notchOffset: number,
): Board | null {
  const heights = new Array<number>(BOARD_WIDTH).fill(baseHeight);
  heights[target] -= wellDrop;
  const board = boardFromHeights(heights);
  const notchColumn = target + notchOffset;
  if (notchColumn < 0 || notchColumn >= BOARD_WIDTH) return null;
  const notchRow = TOTAL_ROWS - heights[notchColumn] + 1;
  if (notchRow < 4 || notchRow >= TOTAL_ROWS || board[notchRow][notchColumn] === 0) return null;
  board[notchRow] = [...board[notchRow]];
  board[notchRow][notchColumn] = 0;
  if (board.slice(0, 4).some((row) => row.some((cell) => cell !== 0))) return null;
  return board;
}

function oldFingerprintSets(): { full: Set<string>; structural: Set<string> } {
  const full = new Set<string>();
  const structural = new Set<string>();
  const add = (state: SerializedOpportunityState | ChallengeState): void => {
    full.add(stateFingerprint(state));
    structural.add(structuralProvenanceFingerprint(state));
  };
  for (const state of TETRIS_OPPORTUNITY_CORPUS_V1) add(state);
  for (const descriptor of B1_PLACEMENT_PAIR_DESCRIPTORS) {
    const state = TETRIS_OPPORTUNITY_CORPUS_V1.find((candidate) => candidate.id === descriptor.stateId);
    if (state === undefined) throw new Error(`missing B1 state ${descriptor.stateId}`);
    add(state);
  }
  for (const state of B1_1_CHALLENGE_STATES) add(state);
  return { full, structural };
}

function admitCandidate(
  candidates: Candidate[],
  candidate: Candidate | null,
  old: ReturnType<typeof oldFingerprintSets>,
  selectedFull: Set<string>,
  selectedStructural: Set<string>,
): boolean {
  if (candidate === null) return false;
  const fullFingerprint = stateFingerprint(candidate.state);
  const structuralFingerprint = structuralProvenanceFingerprint(candidate.state);
  if (old.full.has(fullFingerprint) || old.structural.has(structuralFingerprint)) return false;
  if (selectedFull.has(fullFingerprint)) return false;
  selectedFull.add(fullFingerprint);
  selectedStructural.add(structuralFingerprint);
  candidates.push(candidate);
  return true;
}

function candidateForNewStructure(
  state: Omit<B1_2State, 'id'>,
  requireAlias: boolean,
  old: ReturnType<typeof oldFingerprintSets>,
  selectedStructural: Set<string>,
): Candidate | null {
  const structuralFingerprint = structuralProvenanceFingerprint(state);
  if (old.structural.has(structuralFingerprint) || selectedStructural.has(structuralFingerprint)) {
    return null;
  }
  return candidatePair(state, requireAlias);
}

function buildAliasCandidates(
  old: ReturnType<typeof oldFingerprintSets>,
  selectedFull: Set<string>,
  selectedStructural: Set<string>,
): Candidate[] {
  const candidates: Candidate[] = [];
  let templateIndex = 0;
  outer: for (const [leftWell, rightWell] of B1_2_ALIAS_WELL_PAIRS) {
    for (const baseHeight of B1_2_BASE_HEIGHTS) {
      for (const wellDrop of B1_2_WELL_DROPS) {
        for (const shoulderLift of SHOULDER_LIFTS) {
          for (const centerDip of CENTER_DIPS) {
            for (const piece of B1_2_ALIAS_PIECES) {
              const board = aliasBoard(leftWell, rightWell, baseHeight, wellDrop, shoulderLift, centerDip);
              const state = makeState(
                'target-lane-alias', board, piece, leftWell, publicFields(templateIndex),
              );
              templateIndex++;
              admitCandidate(
                candidates,
                candidateForNewStructure(state, true, old, selectedStructural),
                old,
                selectedFull,
                selectedStructural,
              );
              if (candidates.length === 8) break outer;
            }
          }
        }
      }
    }
  }
  return candidates;
}

function buildLaneCandidates(
  group: 'lane-transfer-control' | 'public-i-context-control',
  old: ReturnType<typeof oldFingerprintSets>,
  selectedFull: Set<string>,
  selectedStructural: Set<string>,
  blockedStructural: Set<string> = selectedStructural,
): Candidate[] {
  const candidates: Candidate[] = [];
  const publicPairCache = new Map<string, Candidate['pair'] | null>();
  let templateIndex = 0;
  outer: for (const target of TARGET_COLUMNS) {
    for (const baseHeight of B1_2_BASE_HEIGHTS) {
      for (const wellDrop of B1_2_WELL_DROPS) {
        for (const leftShoulderDelta of SHOULDER_DELTAS) {
          for (const rightShoulderDelta of SHOULDER_DELTAS) {
            for (const piece of PIECES) {
              const board = laneBoard(target, baseHeight, wellDrop, leftShoulderDelta, rightShoulderDelta);
              if (group === 'lane-transfer-control') {
                const state = makeState(group, board, piece, target, publicFields(templateIndex));
                templateIndex++;
                admitCandidate(
                  candidates,
                  candidateForNewStructure(state, false, old, blockedStructural),
                  old,
                  selectedFull,
                  selectedStructural,
                );
                if (candidates.length === 8) break outer;
                continue;
              }

              for (const next of PIECES) {
                for (const hold of PUBLIC_HOLDS) {
                  for (const holdAvailable of PUBLIC_HOLD_AVAILABILITY) {
                    if (!holdAvailable && hold === null) continue;
                    for (const unseenBagMask of B1_2_PUBLIC_MASKS) {
                      const state = makeState(group, board, piece, target, {
                        next, hold, holdAvailable, unseenBagMask,
                      });
                      templateIndex++;
                      const cacheKey = `${structuralProvenanceFingerprint(state)}:${next}:${publicIAvailable(state)}`;
                      let candidate: Candidate | null;
                      if (publicPairCache.has(cacheKey)) {
                        const pair = publicPairCache.get(cacheKey);
                        candidate = pair === null || pair === undefined ? null : { state, pair };
                      } else {
                        candidate = candidateForNewStructure(state, false, old, blockedStructural);
                        publicPairCache.set(cacheKey, candidate?.pair ?? null);
                      }
                      if (admitCandidate(
                        candidates,
                        candidate,
                        old,
                        selectedFull,
                        selectedStructural,
                      ) && candidates.length === 8) break outer;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return candidates;
}

function buildSafetyCandidates(
  old: ReturnType<typeof oldFingerprintSets>,
  selectedFull: Set<string>,
  selectedStructural: Set<string>,
): Candidate[] {
  const candidates: Candidate[] = [];
  let templateIndex = 0;
  outer: for (const target of TARGET_COLUMNS) {
    for (const baseHeight of SAFETY_BASE_HEIGHTS) {
      for (const wellDrop of SAFETY_WELL_DROPS) {
        for (const notchOffset of SAFETY_NOTCH_OFFSETS) {
          for (const piece of PIECES) {
            const board = safetyBoard(target, baseHeight, wellDrop, notchOffset);
            if (board !== null) {
              const state = makeState(groupForSafety(), board, piece, target, publicFields(templateIndex));
              admitCandidate(
                candidates,
                candidateForNewStructure(state, false, old, selectedStructural),
                old,
                selectedFull,
                selectedStructural,
              );
            }
            templateIndex++;
            if (candidates.length === 8) break outer;
          }
        }
      }
    }
  }
  return candidates;
}

function groupForSafety(): 'safety-control' {
  return 'safety-control';
}

function requireEight(group: B1_2Group, candidates: Candidate[]): Candidate[] {
  if (candidates.length < 8) throw new B1_2CorpusInsufficiencyError(group, 8, candidates.length);
  return candidates.slice(0, 8);
}

export function buildB1_2Manifest(): B1_2Manifest {
  const old = oldFingerprintSets();
  const selectedFull = new Set<string>();
  const selectedStructural = new Set<string>();
  const alias = requireEight(
    'target-lane-alias', buildAliasCandidates(old, selectedFull, selectedStructural),
  );
  const lane = requireEight('lane-transfer-control', buildLaneCandidates(
    'lane-transfer-control', old, selectedFull, selectedStructural,
  ));
  const publicI = requireEight('public-i-context-control', buildLaneCandidates(
    'public-i-context-control', old, selectedFull, selectedStructural, new Set(selectedStructural),
  ));
  const safety = requireEight(
    'safety-control', buildSafetyCandidates(old, selectedFull, selectedStructural),
  );
  const groups: readonly [B1_2Group, Candidate[]][] = [
    ['target-lane-alias', alias],
    ['lane-transfer-control', lane],
    ['public-i-context-control', publicI],
    ['safety-control', safety],
  ];

  const states: B1_2State[] = [];
  const pairs: B1_2PairDescriptor[] = [];
  for (const [group, candidates] of groups) {
    candidates.forEach((candidate, index) => {
      const id = group === 'target-lane-alias'
        ? `alias-${String(index).padStart(2, '0')}`
        : group === 'lane-transfer-control'
          ? `lane-control-${String(index).padStart(2, '0')}`
          : group === 'public-i-context-control'
            ? `i-context-${String(index).padStart(2, '0')}`
            : `safety-control-${String(index).padStart(2, '0')}`;
      states.push({ id, ...candidate.state });
      pairs.push({ id, stateId: id, ...candidate.pair });
    });
  }
  return { corpusId: B1_2_CORPUS_ID_VALUE, states, pairs };
}
