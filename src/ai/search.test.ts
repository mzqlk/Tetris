import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../engine/board';
import { createPiece } from '../engine/piece';
import type { PieceType } from '../types';
import { FEATURE_COUNT, FEATURE_NAMES } from './features';
import { cellKey } from './placements';
import type { PublicSearchState } from './publicState';
import {
  compareSearchValues,
  searchFixed,
  type SearchBudget,
  type SearchDecision,
} from './search';
import { boardFrom } from './testUtils';

const zeros = () => Array(FEATURE_COUNT).fill(0);

function only(name: (typeof FEATURE_NAMES)[number], value = 1): number[] {
  const weights = zeros();
  weights[FEATURE_NAMES.indexOf(name)] = value;
  return weights;
}

function fixedBudget(
  maxLockedDepth: 1 | 2 | 3 | 4,
  cacheEnabled = true,
): SearchBudget {
  return {
    maxRootPlacements: 64,
    maxChildPlacements: 32,
    maxLockedDepth,
    shouldAbort: () => false,
    cacheEnabled,
  };
}

function state(overrides: Partial<PublicSearchState> = {}): PublicSearchState {
  return {
    board: createEmptyBoard(),
    current: createPiece(1),
    next: 2,
    hold: null,
    holdAvailable: false,
    unseenBagMask: 0b0000100,
    ...overrides,
  };
}

function stripDiagnostics(decision: SearchDecision | null) {
  if (decision === null) return null;
  return { action: decision.action, value: decision.value };
}

describe('search value contract', () => {
  it('compares survival before heuristic value', () => {
    expect(compareSearchValues(
      { survivalProbability: 1, expectedHeuristicValue: -100 },
      { survivalProbability: 0.5, expectedHeuristicValue: 10_000 },
    )).toBeGreaterThan(0);
  });

  it('uses heuristic value only when survival is equal', () => {
    expect(compareSearchValues(
      { survivalProbability: 1, expectedHeuristicValue: 2 },
      { survivalProbability: 1, expectedHeuristicValue: 3 },
    )).toBeLessThan(0);
  });
});

describe('fixed expectimax search', () => {
  it('keeps Hold outside the placement beam', () => {
    const result = searchFixed(
      state({
        board: boardFrom(['.#########']),
        current: createPiece(2),
        next: 1,
        holdAvailable: true,
        unseenBagMask: 0b0000100,
      }),
      only('linesCleared'),
      { ...fixedBudget(1), maxRootPlacements: 1, maxChildPlacements: 1 },
    );

    expect(result?.action.kind).toBe('hold');
    expect(result?.value).toEqual({
      survivalProbability: 1,
      expectedHeuristicValue: 1,
    });
  });

  it('returns the same action and value with cache enabled or disabled', () => {
    const corpus = state({
      board: boardFrom([
        '#.....#..#',
        '.#.#.#....',
        '........##',
        '#.....#.#.',
        '....##.#..',
        '...#....#.',
        '..###..###',
        '.##....#.#',
        '.....#..#.',
        '#.....####',
        '...#.....#',
        '.....##...',
        '##.......#',
        '#...####..',
        '.##....##.',
        '.#.....##.',
      ]),
      current: createPiece(1),
      next: 4,
      hold: 1,
      holdAvailable: true,
      unseenBagMask: 0b0001001,
    });
    const weights = only('aggregateHeight', -1);

    const on = searchFixed(corpus, weights, {
      ...fixedBudget(4, true), maxRootPlacements: 1, maxChildPlacements: 1,
    });
    const off = searchFixed(corpus, weights, {
      ...fixedBudget(4, false), maxRootPlacements: 1, maxChildPlacements: 1,
    });

    expect(stripDiagnostics(on)).toEqual(stripDiagnostics(off));
    expect(on!.diagnostics.cacheHits).toBeGreaterThan(0);
    expect(off!.diagnostics.cacheHits).toBe(0);
  });

  it('averages every possible preview instead of turning a partial top-out into -Infinity', () => {
    const twoFuturePieces = state({
      board: boardFrom([
        '#.....#..#',
        '.#.#.#....',
        '........##',
        '#.....#.#.',
        '....##.#..',
        '...#....#.',
        '..###..###',
        '.##....#.#',
        '.....#..#.',
        '#.....####',
        '...#.....#',
        '.....##...',
        '##.......#',
        '#...####..',
        '.##....##.',
        '.#.....##.',
      ]),
      current: createPiece(1),
      next: 4,
      unseenBagMask: (1 << (1 - 1)) | (1 << (4 - 1)),
    });

    const result = searchFixed(twoFuturePieces, zeros(), {
      ...fixedBudget(3),
      maxRootPlacements: 1,
      maxChildPlacements: 1,
    });

    expect(result).not.toBeNull();
    expect(result!.value.survivalProbability).toBeGreaterThan(0);
    expect(result!.value.survivalProbability).toBeLessThan(1);
    expect(Number.isFinite(result!.value.expectedHeuristicValue)).toBe(true);
  });

  it('does not reveal a preview after the leaf placement', () => {
    const result = searchFixed(
      state({ unseenBagMask: 0 }),
      zeros(),
      fixedBudget(1),
    );

    expect(result).not.toBeNull();
    expect(result!.value.survivalProbability).toBe(1);
    expect(result!.diagnostics.expandedChanceNodes).toBe(0);
  });

  it('returns a stable enumerated placement on deterministic reruns', () => {
    const searchState = state({ current: createPiece(7), next: 3 });
    const weights = only('bumpiness', -1);
    const first = searchFixed(searchState, weights, fixedBudget(2));
    const second = searchFixed(searchState, weights, fixedBudget(2));

    expect(first?.action.kind).toBe('place');
    expect(second?.action.kind).toBe('place');
    if (first?.action.kind !== 'place' || second?.action.kind !== 'place') return;
    expect(cellKey(first.action.placement.piece)).toBe(
      cellKey(second.action.placement.piece),
    );
    expect(first.value).toEqual(second.value);
    expect(first.diagnostics).toEqual(second.diagnostics);
  });

  it('evaluates empty Hold at depth one without inventing an unknown preview', () => {
    const result = searchFixed(
      state({
        board: boardFrom(['.#########']),
        current: createPiece(2),
        next: 1,
        hold: null,
        holdAvailable: true,
        unseenBagMask: 0,
      }),
      only('linesCleared'),
      fixedBudget(1),
    );

    expect(result?.action.kind).toBe('hold');
    expect(result?.diagnostics.expandedChanceNodes).toBe(0);
  });

  it('returns null when neither a placement nor Hold is legal', () => {
    const fullBoard = boardFrom(Array(22).fill('##########'));
    expect(searchFixed(
      state({ board: fullBoard, holdAvailable: false }),
      zeros(),
      fixedBudget(1),
    )).toBeNull();
  });

  it('accepts each piece type in a public-state fixture', () => {
    for (let piece = 1; piece <= 7; piece++) {
      const result = searchFixed(
        state({ current: createPiece(piece as PieceType) }),
        zeros(),
        fixedBudget(1),
      );
      expect(result).not.toBeNull();
    }
  });
});
