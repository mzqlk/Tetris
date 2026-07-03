import { LINES_PER_LEVEL, MAX_LEVEL } from '../constants';

const LINE_SCORES: Record<number, number> = {
  1: 100,
  2: 300,
  3: 500,
  4: 800,
};

export function calculateScore(linesCleared: number, level: number): number {
  if (linesCleared === 0) return 0;
  return (LINE_SCORES[linesCleared] ?? 0) * level;
}

export function calculateSoftDropScore(cellsDropped: number): number {
  return cellsDropped;
}

export function calculateHardDropScore(cellsDropped: number): number {
  return cellsDropped * 2;
}

export function calculateLevel(totalLines: number): number {
  const newLevel = Math.floor(totalLines / LINES_PER_LEVEL) + 1;
  return Math.min(newLevel, MAX_LEVEL);
}