import { useRef, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { PIECE_COLORS, CELL_SIZE } from '../constants';
import { getPieceCells } from '../engine/board';

export default function NextPiece() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nextPiece = useGameStore(s => s.nextPiece);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !nextPiece) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cells = getPieceCells(nextPiece);
    const color = PIECE_COLORS[nextPiece.type];

    // Center the piece in the preview canvas
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of cells) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
    const pieceW = (maxX - minX + 1) * CELL_SIZE;
    const pieceH = (maxY - minY + 1) * CELL_SIZE;
    const offsetX = (canvas.width - pieceW) / 2 - minX * CELL_SIZE;
    const offsetY = (canvas.height - pieceH) / 2 - minY * CELL_SIZE;

    for (const cell of cells) {
      const x = cell.x * CELL_SIZE + offsetX;
      const y = cell.y * CELL_SIZE + offsetY;
      const inset = 2;
      ctx.fillStyle = color;
      ctx.fillRect(x + inset, y + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2);

      const gradient = ctx.createLinearGradient(x, y, x + CELL_SIZE, y + CELL_SIZE);
      gradient.addColorStop(0, 'rgba(255,255,255,0.3)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x + inset, y + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.8;
      ctx.strokeRect(x + inset, y + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2);
      ctx.globalAlpha = 1.0;
    }
  }, [nextPiece]);

  return (
    <canvas
      ref={canvasRef}
      width={4 * CELL_SIZE}
      height={4 * CELL_SIZE}
      style={{ display: 'block' }}
    />
  );
}