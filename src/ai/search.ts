import type { Board, Piece } from '../types';
import { getPieceCells, lockPiece, clearLines, isValidPosition } from '../engine/board';
import { createPiece } from '../engine/piece';
import { extractFeatures } from './features';
import { enumeratePlacements, type Placement } from './placements';

export interface EvalResult {
  score: number;
  boardAfter: Board;
  linesCleared: number;
}

export interface Decision {
  placement: Placement;
  score: number;
}

/** lock -> clear -> extract features -> dot with the weight vector. */
export function evalMove(board: Board, placement: Placement, w: number[]): EvalResult {
  const placedCells = getPieceCells(placement.piece);
  const locked = lockPiece(board, placement.piece);
  const { clearedRows, newBoard } = clearLines(locked);
  const features = extractFeatures(newBoard, clearedRows.length, placedCells);

  let score = 0;
  for (let i = 0; i < features.length; i++) score += features[i] * w[i];

  return { score, boardAfter: newBoard, linesCleared: clearedRows.length };
}

/**
 * depth 1: argmax over placements of the current piece.
 * depth 2: argmax over p1 of [score(p1) + max over p2 of score(p2)].
 *
 * A p1 that leaves the next piece unable to spawn scores -Infinity. If every
 * branch is a dead end we still return the first placement rather than null —
 * null means "nowhere to put this piece at all", which is the game-over signal.
 *
 * Search depth and weights are coupled: weights trained at depth 1 misbehave at
 * depth 2, because the two value behaviours like "keep a well open for an I"
 * differently. Train and play at the same depth.
 */
export function bestPlacement(
  board: Board,
  current: Piece,
  next: Piece | null,
  w: number[],
  depth: 1 | 2,
): Decision | null {
  const options = enumeratePlacements(board, current);
  if (options.length === 0) return null;

  const lookahead = depth === 2 && next !== null;
  let best: Decision | null = null;

  for (const placement of options) {
    const { score, boardAfter } = evalMove(board, placement, w);
    let total = score;

    if (lookahead) {
      const nextSpawn = createPiece(next!.type);
      if (!isValidPosition(boardAfter, nextSpawn)) {
        total = -Infinity;
      } else {
        const followUps = enumeratePlacements(boardAfter, nextSpawn);
        if (followUps.length === 0) {
          total = -Infinity;
        } else {
          let bestNext = -Infinity;
          for (const followUp of followUps) {
            const s = evalMove(boardAfter, followUp, w).score;
            if (s > bestNext) bestNext = s;
          }
          total = score + bestNext;
        }
      }
    }

    if (best === null || total > best.score) best = { placement, score: total };
  }

  return best;
}
