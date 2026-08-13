import { useEffect, useRef } from 'react';
import { CELL_SIZE, PIECE_COLORS } from '../constants';
import { getPieceCells } from '../engine/board';
import { drawBlock } from '../renderer/drawBoard';
import type { Piece } from '../types';

interface PiecePreviewProps {
  piece: Piece | null;
  label: string;
}

export default function PiecePreview({ piece, label }: PiecePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!piece) return;

    const cells = getPieceCells(piece);
    const xs = cells.map((cell) => cell.x);
    const ys = cells.map((cell) => cell.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pieceWidth = (maxX - minX + 1) * CELL_SIZE;
    const pieceHeight = (maxY - minY + 1) * CELL_SIZE;
    const offsetX = (canvas.width - pieceWidth) / 2 - minX * CELL_SIZE;
    const offsetY = (canvas.height - pieceHeight) / 2 - minY * CELL_SIZE;

    for (const cell of cells) {
      drawBlock(ctx, cell.x, cell.y, PIECE_COLORS[piece.type], 1, offsetX, offsetY);
    }
  }, [piece]);

  return (
    <canvas
      ref={canvasRef}
      width={4 * CELL_SIZE}
      height={4 * CELL_SIZE}
      aria-label={label}
      style={{ display: 'block' }}
    />
  );
}
