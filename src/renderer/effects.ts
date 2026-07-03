import { BOARD_WIDTH, BOARD_HEIGHT, BOARD_BUFFER, CELL_SIZE, PIECE_COLORS } from '../constants';
import type { Position } from '../types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
}

let particles: Particle[] = [];

export function initBackgroundParticles(): void {
  particles = [];
  const canvasWidth = BOARD_WIDTH * CELL_SIZE;
  const canvasHeight = BOARD_HEIGHT * CELL_SIZE;
  for (let i = 0; i < 30; i++) {
    particles.push({
      x: Math.random() * canvasWidth,
      y: Math.random() * canvasHeight,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -Math.random() * 0.3 - 0.1,
      size: Math.random() * 2 + 0.5,
      alpha: Math.random() * 0.5 + 0.1,
      life: Math.random() * 200 + 100,
    });
  }
}

export function updateAndDrawParticles(ctx: CanvasRenderingContext2D, deltaTime: number): void {
  const canvasWidth = BOARD_WIDTH * CELL_SIZE;
  const canvasHeight = BOARD_HEIGHT * CELL_SIZE;

  for (const p of particles) {
    p.x += p.vx * deltaTime * 0.06;
    p.y += p.vy * deltaTime * 0.06;
    p.life -= deltaTime * 0.01;

    // Wrap around
    if (p.y < 0) p.y = canvasHeight;
    if (p.x < 0) p.x = canvasWidth;
    if (p.x > canvasWidth) p.x = 0;

    // Fade when life is low
    const drawAlpha = p.life < 30 ? p.alpha * (p.life / 30) : p.alpha;

    ctx.globalAlpha = drawAlpha;
    ctx.fillStyle = '#4488ff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1.0;

  // Respawn dead particles
  particles = particles.filter(p => p.life > 0);
  while (particles.length < 30) {
    particles.push({
      x: Math.random() * canvasWidth,
      y: canvasHeight,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -Math.random() * 0.3 - 0.1,
      size: Math.random() * 2 + 0.5,
      alpha: Math.random() * 0.5 + 0.1,
      life: Math.random() * 200 + 100,
    });
  }
}

export function drawLineClearFlash(
  ctx: CanvasRenderingContext2D,
  flashRows: number[],
  flashTimer: number
): void {
  if (flashRows.length === 0) return;

  const alpha = Math.min(flashTimer / 150, 1.0) * 0.8;

  for (const row of flashRows) {
    const displayRow = row - BOARD_BUFFER;
    if (displayRow >= 0) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, displayRow * CELL_SIZE, BOARD_WIDTH * CELL_SIZE, CELL_SIZE);
    }
  }

  ctx.globalAlpha = 1.0;
}

export function drawHardDropTrail(
  ctx: CanvasRenderingContext2D,
  trail: Position[],
  trailTimer: number,
  pieceType: number
): void {
  if (trail.length === 0) return;

  const color = PIECE_COLORS[pieceType as keyof typeof PIECE_COLORS];
  const alpha = Math.min(trailTimer / 100, 1.0) * 0.4;

  for (const pos of trail) {
    const displayRow = pos.y - BOARD_BUFFER;
    if (displayRow >= 0) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.fillRect(pos.x * CELL_SIZE, displayRow * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1.0;
}