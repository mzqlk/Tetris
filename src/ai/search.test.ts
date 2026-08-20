import { describe, expect, it } from 'vitest';
import { createEmptyBoard } from '../engine/board';
import { createPiece } from '../engine/piece';
import type { PieceType } from '../types';
import { FEATURE_COUNT, FEATURE_NAMES } from './features';
import { cellKey } from './placements';
import type { PublicSearchState } from './publicState';
import {
  compareSearchValues,
  searchBudgeted,
  searchFixed,
  selectPlacementBeam,
  type LegacyFixedSearchBudget,
  type SearchDecision,
} from './search';
import {
  DEPTH_ONE_REQUIRED_WORK_UNITS,
  DETERMINISTIC_SEARCH_LIMITS,
  type SearchLimits,
} from './searchBudget';
import { boardFrom } from './testUtils';

const zeros = () => Array(FEATURE_COUNT).fill(0);

function only(name: (typeof FEATURE_NAMES)[number], value = 1): number[] {
  const weights = zeros();
  weights[FEATURE_NAMES.indexOf(name)] = value;
  return weights;
}

function searchLimits(
  maxLockedDepth: 1 | 2 | 3 | 4,
): SearchLimits {
  return {
    maxRootPlacements: 64,
    maxChildPlacements: 32,
    maxLockedDepth,
    maxWorkUnits: Number.MAX_SAFE_INTEGER,
    transpositionCacheEntries: 65_536,
    placementCacheEntries: 16_384,
  };
}

function legacyFixedBudget(
  maxLockedDepth: 1 | 2 | 3 | 4,
  cacheEnabled: boolean,
): LegacyFixedSearchBudget {
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

function ordinarySurvivingState(): PublicSearchState {
  return {
    board: createEmptyBoard(),
    current: createPiece(2),
    next: 2,
    hold: null,
    holdAvailable: false,
    unseenBagMask: 0,
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

  it('treats mathematically equal survival values as a heuristic tie despite accumulation noise', () => {
    const exact = 1 / 7 + 1 / 7 + 1 / 7 + 1 / 7 + 1 / 7 + 1 / 7 + 1 / 7;
    const alternate = (1 / 7) * 7;
    expect(exact).not.toBe(alternate);
    expect(compareSearchValues(
      { survivalProbability: exact, expectedHeuristicValue: 3 },
      { survivalProbability: alternate, expectedHeuristicValue: 2 },
    )).toBeGreaterThan(0);
  });

  it('keeps the smallest genuine depth-four bag probability difference survival-first', () => {
    const smallestDepthFourDelta = 1 / (7 * 6 * 5 * 4);
    expect(compareSearchValues(
      { survivalProbability: 0.5 + smallestDepthFourDelta, expectedHeuristicValue: -1_000 },
      { survivalProbability: 0.5, expectedHeuristicValue: 1_000_000 },
    )).toBeGreaterThan(0);
  });
});

describe('budgeted expectimax search', () => {
  it('returns the last complete depth without budget-external fallback', () => {
    const result = searchBudgeted(ordinarySurvivingState(), zeros(), {
      ...DETERMINISTIC_SEARCH_LIMITS,
      maxWorkUnits: DEPTH_ONE_REQUIRED_WORK_UNITS,
    });

    expect(result).not.toBeNull();
    expect(result!.diagnostics.completedDepth).toBe(1);
    expect(result!.diagnostics.attemptedDepth).toBe(2);
    expect(result!.diagnostics.budgetExhausted).toBe(true);
    expect(result!.diagnostics.workUnitsUsed).toBe(DEPTH_ONE_REQUIRED_WORK_UNITS);
  });

  it('keeps work-unit accounting exact and deterministic', () => {
    const first = searchBudgeted(ordinarySurvivingState(), zeros());
    const second = searchBudgeted(ordinarySurvivingState(), zeros());

    expect(first).toEqual(second);
    expect(first).not.toBeNull();
    const diagnostics = first!.diagnostics;
    expect(
      diagnostics.placementEvaluationUnits
      + diagnostics.chanceExpansionUnits
      + diagnostics.cacheHitUnits,
    ).toBe(diagnostics.workUnitsUsed);
    expect(diagnostics.workUnitsUsed).toBeLessThanOrEqual(diagnostics.workUnitsLimit);
  });

  it('rejects a production budget below the global depth-one bound', () => {
    expect(() => searchBudgeted(state(), zeros(), {
      ...DETERMINISTIC_SEARCH_LIMITS,
      maxWorkUnits: DEPTH_ONE_REQUIRED_WORK_UNITS - 1,
    })).toThrow(/depth one/i);
  });

  it('does not report an exactly exhausted complete depth as budget exhausted', () => {
    const result = searchBudgeted(state({ unseenBagMask: 0 }), zeros(), {
      ...DETERMINISTIC_SEARCH_LIMITS,
      maxLockedDepth: 2,
      maxWorkUnits: 3010,
    });

    expect(result).not.toBeNull();
    expect(result!.diagnostics.completedDepth).toBe(2);
    expect(result!.diagnostics.attemptedDepth).toBe(2);
    expect(result!.diagnostics.workUnitsUsed).toBe(3010);
    expect(result!.diagnostics.budgetExhausted).toBe(false);
    expect(result!.diagnostics.aborted).toBe(false);
  });

  it('retains exactly the requested root and child beam prefixes with stable ties', () => {
    const entries = Array.from({ length: 65 }, (_, enumerationIndex) => ({
      enumerationIndex,
      immediateHeuristic: 0,
      value: enumerationIndex,
    }));
    expect(selectPlacementBeam(entries, true, searchLimits(1))).toHaveLength(64);
    expect(selectPlacementBeam(entries, true, searchLimits(1)).map((x) => x.enumerationIndex))
      .toEqual(Array.from({ length: 64 }, (_, i) => i));
    expect(selectPlacementBeam(entries, false, searchLimits(1)).map((x) => x.enumerationIndex))
      .toEqual(Array.from({ length: 32 }, (_, i) => i));
  });
  it('keeps Hold outside the placement beam', () => {
    const result = searchBudgeted(
      state({
        board: boardFrom(['.#########']),
        current: createPiece(2),
        next: 1,
        holdAvailable: true,
        unseenBagMask: 0b0000100,
      }),
      only('linesCleared'),
      { ...searchLimits(1), maxRootPlacements: 1, maxChildPlacements: 1 },
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
      ...legacyFixedBudget(4, true), maxRootPlacements: 1, maxChildPlacements: 1,
    });
    const off = searchFixed(corpus, weights, {
      ...legacyFixedBudget(4, false), maxRootPlacements: 1, maxChildPlacements: 1,
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

    const result = searchBudgeted(twoFuturePieces, zeros(), {
      ...searchLimits(3),
      maxRootPlacements: 1,
      maxChildPlacements: 1,
    });
    const oracle = searchFixed(twoFuturePieces, zeros(), {
      ...legacyFixedBudget(3, false),
      maxRootPlacements: 1,
      maxChildPlacements: 1,
    });

    expect(result).not.toBeNull();
    expect(stripDiagnostics(result)).toEqual(stripDiagnostics(oracle));
    expect(result!.value.survivalProbability).toBeGreaterThan(0);
    expect(result!.value.survivalProbability).toBeLessThan(1);
    expect(Number.isFinite(result!.value.expectedHeuristicValue)).toBe(true);
    expect(result!.diagnostics.prunedChanceBranches).toBeGreaterThan(0);
    expect(oracle!.diagnostics.prunedChanceBranches).toBe(0);
  });

  it('does not reveal a preview after the leaf placement', () => {
    const result = searchBudgeted(
      state({ unseenBagMask: 0 }),
      zeros(),
      searchLimits(1),
    );

    expect(result).not.toBeNull();
    expect(result!.value.survivalProbability).toBe(1);
    expect(result!.diagnostics.expandedChanceNodes).toBe(0);
  });

  it('returns a stable enumerated placement on deterministic reruns', () => {
    const searchState = state({ current: createPiece(7), next: 3 });
    const weights = only('bumpiness', -1);
    const first = searchBudgeted(searchState, weights, searchLimits(2));
    const second = searchBudgeted(searchState, weights, searchLimits(2));

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
    const result = searchBudgeted(
      state({
        board: boardFrom(['.#########']),
        current: createPiece(2),
        next: 1,
        hold: null,
        holdAvailable: true,
        unseenBagMask: 0,
      }),
      only('linesCleared'),
      searchLimits(1),
    );

    expect(result?.action.kind).toBe('hold');
    expect(result?.diagnostics.expandedChanceNodes).toBe(0);
  });

  it('returns null when neither a placement nor Hold is legal', () => {
    const fullBoard = boardFrom(Array(22).fill('##########'));
    expect(searchBudgeted(
      state({ board: fullBoard, holdAvailable: false }),
      zeros(),
      searchLimits(1),
    )).toBeNull();
  });

  it('accepts each piece type in a public-state fixture', () => {
    for (let piece = 1; piece <= 7; piece++) {
      const result = searchBudgeted(
        state({ current: createPiece(piece as PieceType) }),
        zeros(),
        searchLimits(1),
      );
      expect(result).not.toBeNull();
    }
  });
});
