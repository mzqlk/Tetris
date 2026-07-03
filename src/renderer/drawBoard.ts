import type { Board } from '../types';
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  BOARD_BUFFER,
  CELL_SIZE,
  PIECE_COLORS,
} from '../constants';

const BG_COLOR = '#0a0e1a';
const GRID_COLOR = '#1a1e3a';

export function drawBoard(ctx: CanvasRenderingContext2D, board: Board): void {
  const canvasWidth = BOARD_WIDTH * CELL_SIZE;
  const canvasHeight = BOARD_HEIGHT * CELL_SIZE;

  // Clear and fill background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Draw grid lines
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  for (let col = 0; col <= BOARD_WIDTH; col++) {
    ctx.beginPath();
    ctx.moveTo(col * CELL_SIZE, 0);
    ctx.lineTo(col * CELL_SIZE, canvasHeight);
    ctx.stroke();
  }
  for (let row = 0; row <= BOARD_HEIGHT; row++) {
    ctx.beginPath();
    ctx.moveTo(0, row * CELL_SIZE);
    ctx.lineTo(canvasWidth, row * CELL_SIZE);
    ctx.stroke();
  }

  // Draw locked blocks
  for (let row = BOARD_BUFFER; row < BOARD_BUFFER + BOARD_HEIGHT; row++) {
    for (let col = 0; col < BOARD_WIDTH; col++) {
      const cellValue = board[row][col];
      if (cellValue !== 0) {
        const color = PIECE_COLORS[cellValue as keyof typeof PIECE_COLORS];
        drawBlock(ctx, col, row - BOARD_BUFFER, color);
      }
    }
  }
}

export function drawBlock(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  color: string,
  opacity: number = 1.0
): void {
  const x = col * CELL_SIZE;
  const y = row * CELL_SIZE;
  const size = CELL_SIZE;
  const inset = 2;

  ctx.globalAlpha = opacity;

  // Main fill
  ctx.fillStyle = color;
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);

  // Inner glow — bright top-left edge
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);

  // Border
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = opacity * 0.8;
  ctx.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);

  ctx.globalAlpha = 1.0;
}