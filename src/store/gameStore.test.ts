import { describe, it, expect } from 'vitest';
import { useGameStore } from './gameStore';
import { createEmptyBoard } from '../engine/board';
import type { PieceType } from '../types';

describe('gameStore piece queue', () => {
  it('promotes the previewed piece to current on lock', () => {
    useGameStore.getState().startGame();

    for (let i = 0; i < 5; i++) {
      expect(useGameStore.getState().status).toBe('playing');
      const previewed = useGameStore.getState().nextPiece!.type;
      useGameStore.getState().hardDrop();
      expect(useGameStore.getState().currentPiece!.type).toBe(previewed);
    }
  });

  it('plays each of the 7 piece types exactly once per bag', () => {
    useGameStore.getState().startGame();
    const played: PieceType[] = [useGameStore.getState().currentPiece!.type];

    for (let i = 0; i < 6; i++) {
      // Reset the board each lock so the stack never reaches the spawn area.
      useGameStore.setState({ board: createEmptyBoard() });
      useGameStore.getState().hardDrop();
      played.push(useGameStore.getState().currentPiece!.type);
    }

    expect([...played].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('spawns the current piece at the spawn position, not the previewed position', () => {
    useGameStore.getState().startGame();
    useGameStore.getState().hardDrop();
    const p = useGameStore.getState().currentPiece!;
    expect(p.rotation).toBe(0);
    expect(p.position).toEqual({ x: 3, y: 0 });
  });
});
