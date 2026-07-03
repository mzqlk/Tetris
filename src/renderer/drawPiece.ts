import type { Board, Piece } from '../types';
import { BOARD_BUFFER, CELL_SIZE, PIECE_COLORS } from '../constants';
import { getPieceCells, getGhostPosition } from '../engine/board';
import { drawBlock } from './drawBoard';

export function drawPiece(ctx: CanvasRenderingContext2D, piece: Piece): void {
  const cells = getPieceCells(piece);
  const color = PIECE_COLORS[piece.type];

  for (const cell of cells) {
    const displayRow = cell.y - BOARD_BUFFER;
    if (displayRow >= 0) {
      drawBlock(ctx, cell.x, displayRow, color);
    }
  }
}

export function drawGhostPiece(ctx: CanvasRenderingContext2D, board: Board, piece: Piece): void {
  const ghostPos = getGhostPosition(board, piece);
  const ghostPiece: Piece = { ...piece, position: ghostPos };
  const cells = getPieceCells(ghostPiece);
  const color = PIECE_COLORS[piece.type];

  for (const cell of cells) {
    const displayRow = cell.y - BOARD_BUFFER;
    if (displayRow >= 0) {
      const x = cell.x * CELL_SIZE;
      const y = displayRow * CELL_SIZE;
      const size = CELL_SIZE;
      const inset = 2;

      // Low opacity fill
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = color;
      ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);

      // Dashed border
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
      ctx.setLineDash([]);

      ctx.globalAlpha = 1.0;
    }
  }
}