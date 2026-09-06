import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../engine/board';
import { createPiece } from '../engine/piece';
import { boardFrom } from './testUtils';
import { FEATURE_NAMES, extractFeatures } from './features';
import {
  B1_CANDIDATE_FEATURE_COUNT,
  B1_CANDIDATE_FEATURE_NAMES,
  futureIAccessProbability,
  extractB1PlacementFeatures,
  type B1PlacementFeatureInput,
} from './opportunityFeatures';
import type { Board } from '../types';

const placedCells = [
  { x: 0, y: 18 }, { x: 0, y: 19 }, { x: 0, y: 20 }, { x: 0, y: 21 },
];

const input = (boardBefore: Board, boardAfter: Board): B1PlacementFeatureInput => ({
  boardBefore,
  boardAfter,
  linesCleared: 0,
  placedCells,
  pending: {
    board: boardAfter,
    current: createPiece(2),
    hold: null,
    holdAvailable: true,
    unseenBagMask: 0b1111111,
  },
});

const cloneBoard = (board: Board): Board => board.map((row) => row.slice());

describe('B1 candidate feature contract', () => {
  it('keeps the v5 thirteen names first and appends the four B1 names', () => {
    expect(B1_CANDIDATE_FEATURE_NAMES.slice(0, FEATURE_NAMES.length)).toEqual(FEATURE_NAMES);
    expect(B1_CANDIDATE_FEATURE_NAMES.slice(-4)).toEqual([
      'targetLaneUsableDepthDelta',
      'targetLaneSetupProgressDelta',
      'targetLaneReadyRowsDelta',
      'futureIAccessProbability',
    ]);
    expect(B1_CANDIDATE_FEATURE_COUNT).toBe(17);
  });

  it('returns zero lane deltas when the canonical pre-lane has no opportunity', () => {
    const empty = createEmptyBoard();
    const result = extractB1PlacementFeatures(input(empty, empty));
    expect(result.slice(13, 16)).toEqual([0, 0, 0]);
  });

  it('compares the same pre-lane column after a placement', () => {
    const before = boardFrom(['#########.', '#########.', '#########.', '#########.']);
    const after = boardFrom(['.#########', '.#########', '.#########', '.#########']);
    const result = extractB1PlacementFeatures(input(before, after));
    expect(result.slice(13, 16)).toEqual([-1, -1, -1]);
  });

  it('normalizes lane deltas across the window', () => {
    const beforeUsable = boardFrom(['#########.', '#########.', '#########.', '#########.']);
    const afterUsable = createEmptyBoard();
    const usable = extractB1PlacementFeatures(input(beforeUsable, afterUsable));
    expect(usable[13]).toBe(-1);

    const beforeReady = boardFrom([
      '.#########',
      '##########',
      '##########',
      '##########',
      '##########',
      '##########',
      '##########',
      '##########',
    ]);
    const afterReady = boardFrom([
      '.#########',
      '.#########',
      '.#########',
      '.#########',
      '.#########',
      '.#########',
      '.#########',
      '.#########',
    ]);
    const ready = extractB1PlacementFeatures(input(beforeReady, afterReady));
    expect(ready[15]).toBe(0.75);
  });

  it('prefixes the unchanged active features for a line-clear afterstate', () => {
    const boardBefore = boardFrom(['#########.', '#########.', '#########.', '#########.']);
    const boardAfter = createEmptyBoard();
    const result = extractB1PlacementFeatures({
      ...input(boardBefore, boardAfter),
      linesCleared: 4,
    });
    expect(result.slice(0, 13)).toEqual(extractFeatures(boardAfter, 4, placedCells));
  });

  it('does not mutate the input boards', () => {
    const boardBefore = boardFrom(['#########.', '#########.', '#########.', '#########.']);
    const boardAfter = createEmptyBoard();
    const beforeSnapshot = cloneBoard(boardBefore);
    const afterSnapshot = cloneBoard(boardAfter);

    extractB1PlacementFeatures({
      ...input(boardBefore, boardAfter),
      linesCleared: 1,
    });

    expect(boardBefore).toEqual(beforeSnapshot);
    expect(boardAfter).toEqual(afterSnapshot);
  });
});

describe('futureIAccessProbability', () => {
  it('returns 1 when the current piece is I', () => {
    expect(futureIAccessProbability({
      board: createEmptyBoard(),
      current: createPiece(1),
      hold: null,
      holdAvailable: true,
      unseenBagMask: 0b1111111,
    })).toBe(1);
  });

  it('returns 1 when the hold piece is I', () => {
    expect(futureIAccessProbability({
      board: createEmptyBoard(),
      current: createPiece(2),
      hold: 1,
      holdAvailable: true,
      unseenBagMask: 0b1111111,
    })).toBe(1);
  });

  it('returns the exact preview probability when I appears in the unseen bag', () => {
    expect(futureIAccessProbability({
      board: createEmptyBoard(),
      current: createPiece(2),
      hold: null,
      holdAvailable: true,
      unseenBagMask: 0b1111111,
    })).toBe(1 / 7);
  });

  it('returns zero when the unseen bag excludes I', () => {
    expect(futureIAccessProbability({
      board: createEmptyBoard(),
      current: createPiece(2),
      hold: null,
      holdAvailable: true,
      unseenBagMask: 0b1111110,
    })).toBe(0);
  });

  it('treats an empty mask as the full seven-bag outcome set', () => {
    expect(futureIAccessProbability({
      board: createEmptyBoard(),
      current: createPiece(2),
      hold: null,
      holdAvailable: true,
      unseenBagMask: 0,
    })).toBe(1 / 7);
  });

  it('rejects invalid pending states where hold is unavailable', () => {
    expect(() => futureIAccessProbability({
      board: createEmptyBoard(),
      current: createPiece(2),
      hold: null,
      holdAvailable: false,
      unseenBagMask: 0b1111111,
    })).toThrow('holdAvailable');
  });
});
