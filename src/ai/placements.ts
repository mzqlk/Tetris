import type { Board, Piece } from '../types';
import { BOARD_WIDTH, TOTAL_ROWS } from '../constants';
import { getPieceCells, isValidPosition } from '../engine/board';
import { movePiece, rotatePiece } from '../engine/piece';

export type AiMove = 'left' | 'right' | 'rotate' | 'down';

export interface Placement {
  /** The locked pose: valid, and one row further down is not. */
  piece: Piece;
  /** Shortest key sequence from the spawn pose to this pose. */
  moves: AiMove[];
}

// A 4x4 matrix can have up to 3 empty leading rows/columns, so piece.position
// ranges over x in [-3, BOARD_WIDTH) and y in [-3, TOTAL_ROWS). y really can go
// negative: an SRS kick may push a piece upward out of the spawn row. The
// offsets below give that range room on both sides.
const X_OFFSET = 4;
const Y_OFFSET = 4;
const X_SPAN = BOARD_WIDTH + X_OFFSET + 1;
const Y_SPAN = TOTAL_ROWS + Y_OFFSET + 1;

function stateKey(p: Piece): number {
  return (p.rotation * X_SPAN + (p.position.x + X_OFFSET)) * Y_SPAN + (p.position.y + Y_OFFSET);
}

/** Sorted flat indices of the cells a piece occupies — the deduplication key. */
export function cellKey(piece: Piece): string {
  return getPieceCells(piece)
    .map((c) => c.y * BOARD_WIDTH + c.x)
    .sort((a, b) => a - b)
    .join(',');
}

/**
 * Breadth-first search over (x, y, rotation) from the spawn pose. Any reachable
 * state that cannot move down is a legal lock.
 *
 * BFS rather than "rotation x column + hard drop" because the latter (1) misses
 * tucks — sliding sideways under an overhang after descending, a whole class of
 * placements that matters once the stack is high; (2) cannot tell whether a
 * placement is actually reachable from spawn, so it invents phantom placements
 * when the top is congested; and (3) yields no key sequence, leaving the browser
 * AI to teleport pieces instead of playing them.
 *
 * Results are deduplicated by final cell set: distinct states can lock into
 * identical cells (all four O rotations are the same shape; I rotations 0 and 2
 * are the same bar at different matrix rows), and leaving those in would double
 * to quadruple the branching factor of the 2-ply search for nothing. Visiting in
 * BFS order means the survivor is the one with the shortest key sequence.
 */
export function enumeratePlacements(board: Board, spawn: Piece): Placement[] {
  if (!isValidPosition(board, spawn)) return [];

  const visited = new Set<number>([stateKey(spawn)]);
  const seenCells = new Set<string>();
  const results: Placement[] = [];
  let frontier: Placement[] = [{ piece: spawn, moves: [] }];

  while (frontier.length > 0) {
    const nextFrontier: Placement[] = [];

    for (const node of frontier) {
      const down = movePiece(board, node.piece, 0, 1);

      if (down === null) {
        const key = cellKey(node.piece);
        if (!seenCells.has(key)) {
          seenCells.add(key);
          results.push(node);
        }
      }

      const rotated = rotatePiece(board, node.piece);
      const candidates: [Piece | null, AiMove][] = [
        [movePiece(board, node.piece, -1, 0), 'left'],
        [movePiece(board, node.piece, 1, 0), 'right'],
        [down, 'down'],
        // rotatePiece returns the same object when every kick fails
        [rotated === node.piece ? null : rotated, 'rotate'],
      ];

      for (const [piece, move] of candidates) {
        if (piece === null) continue;
        const key = stateKey(piece);
        if (visited.has(key)) continue;
        visited.add(key);
        nextFrontier.push({ piece, moves: [...node.moves, move] });
      }
    }

    frontier = nextFrontier;
  }

  return results;
}
