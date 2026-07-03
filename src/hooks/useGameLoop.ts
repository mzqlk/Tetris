import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { drawBoard } from '../renderer/drawBoard';
import { drawPiece, drawGhostPiece } from '../renderer/drawPiece';
import {
  initBackgroundParticles,
  updateAndDrawParticles,
  drawLineClearFlash,
  drawHardDropTrail,
} from '../renderer/effects';

export function useGameLoop(canvasRef: React.RefObject<HTMLCanvasElement | null>): void {
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const particlesInitRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!particlesInitRef.current) {
      initBackgroundParticles();
      particlesInitRef.current = true;
    }

    const gameLoop = (timestamp: number) => {
      const deltaTime = lastTimeRef.current === 0 ? 16 : timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      useGameStore.getState().tick(deltaTime);

      const state = useGameStore.getState();

      drawBoard(ctx, state.board);
      updateAndDrawParticles(ctx, deltaTime);

      if (state.currentPiece && state.status === 'playing') {
        drawGhostPiece(ctx, state.board, state.currentPiece);
        drawPiece(ctx, state.currentPiece);
      }

      drawLineClearFlash(ctx, state.flashRows, state.flashTimer);
      drawHardDropTrail(ctx, state.hardDropTrail, state.trailTimer, state.currentPiece?.type ?? 0);

      rafRef.current = requestAnimationFrame(gameLoop);
    };

    rafRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [canvasRef]);
}

export function useKeyboardControls(): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const store = useGameStore.getState();

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          store.moveLeft();
          break;
        case 'ArrowRight':
          e.preventDefault();
          store.moveRight();
          break;
        case 'ArrowDown':
          e.preventDefault();
          store.softDrop();
          break;
        case 'ArrowUp':
          e.preventDefault();
          store.rotate();
          break;
        case ' ':
          e.preventDefault();
          store.hardDrop();
          break;
        case 'p':
        case 'P':
          if (store.status === 'playing') {
            store.pauseGame();
          } else if (store.status === 'paused') {
            store.resumeGame();
          }
          break;
        case 'Enter':
          if (store.status === 'idle' || store.status === 'gameover') {
            store.startGame();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}