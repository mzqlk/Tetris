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

// Cache the block overlay gradient — same diagonal white-to-black pattern for every cell.
// Keyed by context so it works across different canvases.
const gradientCache = new WeakMap<CanvasRenderingContext2D, CanvasGradient>();

function getBlockGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  let gradient = gradientCache.get(ctx);
  if (!gradient) {
    gradient = ctx.createLinearGradient(0, 0, CELL_SIZE, CELL_SIZE);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
    gradientCache.set(ctx, gradient);
  }
  return gradient;
}

export function drawBoard(ctx: CanvasRenderingContext2D, board: Board): void {
  const canvasWidth = BOARD_WIDTH * CELL_SIZE;
  const canvasHeight = BOARD_HEIGHT * CELL_SIZE;

  // Clear and fill background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Draw grid lines — batched into a single path for one stroke call
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let col = 0; col <= BOARD_WIDTH; col++) {
    ctx.moveTo(col * CELL_SIZE, 0);
    ctx.lineTo(col * CELL_SIZE, canvasHeight);
  }
  for (let row = 0; row <= BOARD_HEIGHT; row++) {
    ctx.moveTo(0, row * CELL_SIZE);
    ctx.lineTo(canvasWidth, row * CELL_SIZE);
  }
  ctx.stroke();

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
  opacity: number = 1.0,
  offsetX: number = 0,
  offsetY: number = 0
): void {
  const x = col * CELL_SIZE + offsetX;
  const y = row * CELL_SIZE + offsetY;
  const size = CELL_SIZE;
  const inset = 2;

  ctx.globalAlpha = opacity;

  // Main fill
  ctx.fillStyle = color;
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);

  // Inner glow — bright top-left edge using cached gradient
  const gradient = getBlockGradient(ctx);
  ctx.save();
  ctx.translate(x + inset, y + inset);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size - inset * 2, size - inset * 2);
  ctx.restore();

  // Border
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = opacity * 0.8;
  ctx.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);

  ctx.globalAlpha = 1.0;
}