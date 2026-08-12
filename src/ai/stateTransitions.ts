import type { Board, PieceType, Position } from '../types';
import { clearLines, getPieceCells, isValidPosition, lockPiece } from '../engine/board';
import { createPiece } from '../engine/piece';
import { extractFeatures } from './features';
import type { Placement } from './placements';
import {
  revealPiece,
  type PendingPreviewState,
  type PublicSearchState,
} from './publicState';

export type HoldTransition =
  | { kind: 'unavailable' }
  | { kind: 'ready'; state: PublicSearchState }
  | { kind: 'pending-preview'; state: PendingPreviewState };

export interface PlacementTransition {
  boardAfter: Board;
  linesCleared: number;
  placedCells: Position[];
  pending: PendingPreviewState;
}

export function applyHold(state: PublicSearchState): HoldTransition {
  if (!state.holdAvailable) return { kind: 'unavailable' };

  if (state.hold === null) {
    return {
      kind: 'pending-preview',
      state: {
        board: state.board,
        current: createPiece(state.next),
        hold: state.current.type,
        holdAvailable: false,
        unseenBagMask: state.unseenBagMask,
      },
    };
  }

  return {
    kind: 'ready',
    state: {
      ...state,
      current: createPiece(state.hold),
      hold: state.current.type,
      holdAvailable: false,
    },
  };
}

export function lockPlacement(
  state: PublicSearchState,
  placement: Placement,
): PlacementTransition {
  if (!isValidPosition(state.board, placement.piece)) {
    throw new Error('cannot lock an invalid placement');
  }

  const placedCells = getPieceCells(placement.piece);
  const locked = lockPiece(state.board, placement.piece);
  const { clearedRows, newBoard } = clearLines(locked);
  const pending: PendingPreviewState = {
    board: newBoard,
    current: createPiece(state.next),
    hold: state.hold,
    holdAvailable: true,
    unseenBagMask: state.unseenBagMask,
  };

  return {
    boardAfter: newBoard,
    linesCleared: clearedRows.length,
    placedCells,
    pending,
  };
}

export function revealPreview(
  pending: PendingPreviewState,
  preview: PieceType,
): PublicSearchState | null {
  const unseenBagMask = revealPiece(pending.unseenBagMask, preview);
  if (!isValidPosition(pending.board, pending.current)) return null;

  return { ...pending, next: preview, unseenBagMask };
}

export function evaluatePlacement(
  state: PublicSearchState,
  placement: Placement,
  weights: number[],
): PlacementTransition & { heuristic: number } {
  const transition = lockPlacement(state, placement);
  const features = extractFeatures(
    transition.boardAfter,
    transition.linesCleared,
    transition.placedCells,
  );
  let heuristic = 0;
  for (let i = 0; i < features.length; i++) heuristic += features[i] * weights[i];

  return { ...transition, heuristic };
}
