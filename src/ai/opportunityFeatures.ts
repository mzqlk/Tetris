import type { Board, PieceType, Position } from '../types';
import { extractFeatures, FEATURE_NAMES } from './features';
import { enumerateBagOutcomes, type PendingPreviewState } from './publicState';
import { summarizeTetrisWell, summarizeTetrisWellAt } from './tetrisStrategy';

export interface B1PlacementFeatureInput {
  boardBefore: Board;
  boardAfter: Board;
  linesCleared: number;
  placedCells: Position[];
  pending: PendingPreviewState;
}

export const B1_CANDIDATE_FEATURE_NAMES = [
  ...FEATURE_NAMES,
  'targetLaneUsableDepthDelta',
  'targetLaneSetupProgressDelta',
  'targetLaneReadyRowsDelta',
  'futureIAccessProbability',
] as const;

export const B1_CANDIDATE_FEATURE_COUNT = B1_CANDIDATE_FEATURE_NAMES.length;

const clampUnit = (value: number): number => Math.max(-1, Math.min(1, value));

function laneDeltas(boardBefore: Board, boardAfter: Board): [number, number, number] {
  const before = summarizeTetrisWell(boardBefore);
  if (before.usableDepth === 0 && before.setupCells === 0 && before.readyRows === 0) {
    return [0, 0, 0];
  }

  const after = summarizeTetrisWellAt(boardAfter, before.column);
  return [
    clampUnit((after.usableDepth - before.usableDepth) / 4),
    clampUnit((after.setupCells - before.setupCells) / 36),
    clampUnit((after.readyRows - before.readyRows) / 4),
  ];
}

export function futureIAccessProbability(pending: PendingPreviewState): number {
  if (!pending.holdAvailable) {
    throw new Error('holdAvailable must be true for B1 future I access probability');
  }

  if (pending.current.type === 1 || pending.hold === 1) return 1;

  let probability = 0;
  for (const outcome of enumerateBagOutcomes(pending.unseenBagMask)) {
    const nextState = {
      ...pending,
      next: outcome.piece as PieceType,
      unseenBagMask: outcome.nextMask,
    };
    if (nextState.current.type === 1 || nextState.hold === 1 || nextState.next === 1) {
      probability += outcome.probability;
    }
  }
  return probability;
}

export function extractB1PlacementFeatures(input: B1PlacementFeatureInput): number[] {
  const base = extractFeatures(input.boardAfter, input.linesCleared, input.placedCells);
  const [usableDepthDelta, setupProgressDelta, readyRowsDelta] = laneDeltas(
    input.boardBefore,
    input.boardAfter,
  );
  return [
    ...base,
    usableDepthDelta,
    setupProgressDelta,
    readyRowsDelta,
    futureIAccessProbability(input.pending),
  ];
}
