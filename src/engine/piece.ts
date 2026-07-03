import type { Piece, PieceType, Board } from '../types';
import {
  WALL_KICK_JLSTZ,
  WALL_KICK_I,
  BOARD_WIDTH,
} from '../constants';
import { isValidPosition } from './board';

export function createPiece(type: PieceType): Piece {
  const spawnX = Math.floor((BOARD_WIDTH - 4) / 2);
  return {
    type,
    rotation: 0,
    position: { x: spawnX, y: 0 },
  };
}

export function rotatePiece(board: Board, piece: Piece, clockwise: boolean = true): Piece {
  const newRotation = clockwise
    ? (piece.rotation + 1) % 4
    : (piece.rotation + 3) % 4;

  const key = `${piece.rotation}>${newRotation}`;
  const kickData = piece.type === 1 ? WALL_KICK_I : WALL_KICK_JLSTZ;
  const kicks = kickData[key];

  if (!kicks) {
    return piece; // O piece or no kick data — return original
  }

  for (const [dx, dy] of kicks) {
    const candidate: Piece = {
      ...piece,
      rotation: newRotation,
      position: {
        x: piece.position.x + dx,
        y: piece.position.y - dy, // SRS uses y-up, board uses y-down
      },
    };
    if (isValidPosition(board, candidate)) {
      return candidate;
    }
  }

  return piece; // No valid position found — rotation fails
}

export function generateBag(): PieceType[] {
  const bag: PieceType[] = [1, 2, 3, 4, 5, 6, 7];
  // Fisher-Yates shuffle
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export function movePiece(board: Board, piece: Piece, dx: number, dy: number): Piece | null {
  const candidate: Piece = {
    ...piece,
    position: {
      x: piece.position.x + dx,
      y: piece.position.y + dy,
    },
  };
  return isValidPosition(board, candidate) ? candidate : null;
}