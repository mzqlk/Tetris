import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CELL_SIZE } from '../constants';
import { createPiece } from '../engine/piece';
import { useGameStore } from '../store/gameStore';
import Game from '../components/Game';
import HoldPiece from '../components/HoldPiece';
import NextPiece from '../components/NextPiece';
import PiecePreview from '../components/PiecePreview';
import { handleGameKeyDown, type KeyboardGameActions } from './useGameLoop';

function actions(): KeyboardGameActions {
  return {
    status: 'playing',
    moveLeft: vi.fn(),
    moveRight: vi.fn(),
    softDrop: vi.fn(),
    hardDrop: vi.fn(),
    rotate: vi.fn(),
    hold: vi.fn(),
    pauseGame: vi.fn(),
    resumeGame: vi.fn(),
    startGame: vi.fn(),
  };
}

describe('handleGameKeyDown', () => {
  it.each(['c', 'C', 'Shift'])('maps %s to the shared Hold action', (key) => {
    const gameActions = actions();

    handleGameKeyDown({ key, preventDefault: vi.fn() } as unknown as KeyboardEvent, gameActions);

    expect(gameActions.hold).toHaveBeenCalledOnce();
  });
});

describe('browser Hold UI', () => {
  beforeEach(() => {
    useGameStore.setState({
      nextPiece: createPiece(3),
      holdPiece: 6,
      holdAvailable: false,
    });
  });

  it('renders next and Hold through the same sized preview canvas contract', () => {
    const next = renderToStaticMarkup(createElement(NextPiece));
    const hold = renderToStaticMarkup(createElement(HoldPiece));
    const size = 4 * CELL_SIZE;

    expect(next).toContain(`width="${size}"`);
    expect(next).toContain(`height="${size}"`);
    expect(next).toContain('aria-label="Next piece"');
    expect(hold).toContain(`width="${size}"`);
    expect(hold).toContain(`height="${size}"`);
    expect(hold).toContain('aria-label="Hold piece"');
  });

  it('keeps an empty Hold slot as a labelled preview canvas', () => {
    useGameStore.setState({ holdPiece: null });

    expect(renderToStaticMarkup(createElement(HoldPiece))).toContain('aria-label="Hold piece"');
  });

  it('lets the shared preview accept either a piece or an empty slot', () => {
    expect(renderToStaticMarkup(createElement(PiecePreview, {
      piece: createPiece(2),
      label: 'Test piece',
    }))).toContain('aria-label="Test piece"');
    expect(renderToStaticMarkup(createElement(PiecePreview, {
      piece: null,
      label: 'Empty piece',
    }))).toContain('aria-label="Empty piece"');
  });

  it('shows Hold alongside the fixed browser search description', () => {
    const markup = renderToStaticMarkup(createElement(Game));

    expect(markup).toContain('Hold');
    expect(markup).toContain('C / Shift');
    expect(markup).toContain('4-lock expectimax');
    expect(markup).not.toContain('1 ply');
    expect(markup).not.toContain('2 ply');
  });
});
