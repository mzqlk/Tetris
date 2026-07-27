import type { Board, Piece } from '../types';
import { movePiece, rotatePiece } from '../engine/piece';
import type { AiMove } from './placements';

export function samePiece(a: Piece | null, b: Piece | null): boolean {
  return (
    a !== null && b !== null &&
    a.type === b.type &&
    a.rotation === b.rotation &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y
  );
}

/**
 * Replay `moves` from `start` against `board` and return the state after each
 * move. Stops early if a move turns out to be illegal, so the caller can detect
 * a diverged plan by comparing `path.length` with `moves.length`.
 */
export function projectPath(board: Board, start: Piece, moves: AiMove[]): Piece[] {
  const path: Piece[] = [];
  let cur = start;
  for (const move of moves) {
    const next =
      move === 'left' ? movePiece(board, cur, -1, 0)
      : move === 'right' ? movePiece(board, cur, 1, 0)
      : move === 'down' ? movePiece(board, cur, 0, 1)
      : rotatePiece(board, cur);
    // rotatePiece returns the same object when the rotation fails
    if (next === null || next === cur) return path;
    cur = next;
    path.push(cur);
  }
  return path;
}
