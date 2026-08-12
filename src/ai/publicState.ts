import type { Board, Piece, PieceType } from '../types';

export type BagMask = number;
export const FULL_BAG_MASK: BagMask = 0b1111111;

export interface PublicSearchState {
  board: Board;
  current: Piece;
  next: PieceType;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: BagMask;
}

export interface PendingPreviewState {
  board: Board;
  current: Piece;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: BagMask;
}

export interface BagOutcome {
  piece: PieceType;
  probability: number;
  nextMask: BagMask;
}

const pieceBit = (piece: PieceType) => 1 << (piece - 1);

function isPieceType(value: unknown): value is PieceType {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7;
}

function assertPieceType(value: unknown, name: string): asserts value is PieceType {
  if (!isPieceType(value)) throw new Error(`${name} must be a piece type`);
}

function assertBagMask(mask: BagMask): void {
  if (!Number.isInteger(mask) || mask < 0 || mask > FULL_BAG_MASK) {
    throw new Error('unseen bag mask must be a seven-bit integer');
  }
}

export function revealPiece(mask: BagMask, piece: PieceType): BagMask {
  assertBagMask(mask);
  assertPieceType(piece, 'revealed piece');
  const available = mask === 0 ? FULL_BAG_MASK : mask;
  const bit = pieceBit(piece);
  if ((available & bit) === 0) throw new Error('revealed piece contradicts public bag');
  return available & ~bit;
}

export function initialUnseenBagMask(current: PieceType, next: PieceType): BagMask {
  return revealPiece(revealPiece(FULL_BAG_MASK, current), next);
}

export function enumerateBagOutcomes(mask: BagMask): BagOutcome[] {
  assertBagMask(mask);
  const available = mask === 0 ? FULL_BAG_MASK : mask;
  const pieces: PieceType[] = [];
  for (let piece = 1; piece <= 7; piece++) {
    if ((available & pieceBit(piece as PieceType)) !== 0) pieces.push(piece as PieceType);
  }
  return pieces.map((piece) => ({
    piece,
    probability: 1 / pieces.length,
    nextMask: revealPiece(available, piece),
  }));
}

export function assertPublicSearchState(state: PublicSearchState): void {
  assertBagMask(state.unseenBagMask);
  if (!Array.isArray(state.board) || state.board.some((row) =>
    !Array.isArray(row) || row.some((cell) => !Number.isFinite(cell)))) {
    throw new Error('board cells must be finite numbers');
  }
  assertPieceType(state.current?.type, 'current piece');
  assertPieceType(state.next, 'next piece');
  if (state.hold !== null) assertPieceType(state.hold, 'hold piece');
  if (typeof state.holdAvailable !== 'boolean') {
    throw new Error('hold availability must be boolean');
  }
}
