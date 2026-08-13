import { describe, it, expect } from 'vitest';
import { useGameStore } from './gameStore';
import { createEmptyBoard } from '../engine/board';
import { createPiece } from '../engine/piece';
import type { PieceType } from '../types';
import { initialUnseenBagMask, revealPiece } from '../ai/publicState';

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

  it('initializes the public seven-bag state', () => {
    useGameStore.getState().startGame();
    const initial = useGameStore.getState();

    expect(initial.holdPiece).toBeNull();
    expect(initial.holdAvailable).toBe(true);
    expect(initial.unseenBagMask).toBe(
      initialUnseenBagMask(initial.currentPiece!.type, initial.nextPiece!.type),
    );
  });

  it('allows one empty Hold, reveals one preview, and restores Hold after lock', () => {
    useGameStore.getState().startGame();
    const before = useGameStore.getState();
    const oldCurrent = before.currentPiece!.type;
    const oldNext = before.nextPiece!.type;
    const oldMask = before.unseenBagMask;

    before.hold();

    const afterHold = useGameStore.getState();
    expect(afterHold).toMatchObject({
      holdPiece: oldCurrent,
      currentPiece: createPiece(oldNext),
      holdAvailable: false,
    });
    expect(afterHold.unseenBagMask).toBe(revealPiece(oldMask, afterHold.nextPiece!.type));

    const previewAfterFirstHold = afterHold.nextPiece!.type;
    afterHold.hold();
    expect(useGameStore.getState().nextPiece!.type).toBe(previewAfterFirstHold);
    expect(useGameStore.getState().holdPiece).toBe(oldCurrent);

    useGameStore.setState({ board: createEmptyBoard() });
    useGameStore.getState().hardDrop();
    expect(useGameStore.getState().holdAvailable).toBe(true);
  });

  it('swaps with an occupied Hold without revealing or scoring', () => {
    useGameStore.getState().startGame();
    useGameStore.getState().hold();
    useGameStore.setState({ board: createEmptyBoard() });
    useGameStore.getState().hardDrop();
    const before = useGameStore.getState();
    const held = before.holdPiece!;
    const current = before.currentPiece!.type;

    before.hold();

    expect(useGameStore.getState()).toMatchObject({
      currentPiece: createPiece(held),
      holdPiece: current,
      holdAvailable: false,
      nextPiece: before.nextPiece,
      unseenBagMask: before.unseenBagMask,
      score: before.score,
    });
  });

  it('resynchronizes the public mask when a deterministic store fixture replaces the bag', () => {
    useGameStore.getState().startGame();
    useGameStore.setState({
      board: createEmptyBoard(),
      currentPiece: createPiece(1),
      nextPiece: createPiece(2),
      bag: [3, 4, 5, 6, 7],
      unseenBagMask: 0b0000001,
      status: 'playing',
    });

    useGameStore.getState().hardDrop();

    expect(useGameStore.getState().nextPiece).toEqual(createPiece(3));
    expect(useGameStore.getState().unseenBagMask).toBe(0b1111000);
  });
});
