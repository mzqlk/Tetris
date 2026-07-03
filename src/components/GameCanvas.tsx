import { useRef } from 'react';
import { useGameLoop } from '../hooks/useGameLoop';
import { BOARD_WIDTH, BOARD_HEIGHT, CELL_SIZE } from '../constants';

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useGameLoop(canvasRef);

  return (
    <canvas
      ref={canvasRef}
      width={BOARD_WIDTH * CELL_SIZE}
      height={BOARD_HEIGHT * CELL_SIZE}
      style={{ display: 'block' }}
    />
  );
}