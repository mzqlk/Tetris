import { describe, expect, it } from 'vitest';
import { boardFrom } from './testUtils';
import {
  classifyTargetWellTransition,
  selectHorizonPlacementBeam,
  type HorizonBeamLimits,
} from './horizonPolicy';

const limits = (overrides: Partial<HorizonBeamLimits> = {}): HorizonBeamLimits => ({
  rootScoreSlots: 2,
  rootStrategySlots: 2,
  childScoreSlots: 1,
  childStrategySlots: 1,
  ...overrides,
});

describe('selectHorizonPlacementBeam', () => {
  it('builds a stable union of score and strategy slots', () => {
    const boardBefore = boardFrom([]);
    const entries = [
      { value: 'score', enumerationIndex: 0, immediateHeuristic: 100,
        linesCleared: 0, boardAfter: boardFrom([]) },
      { value: 'both', enumerationIndex: 1, immediateHeuristic: 90,
        linesCleared: 0, boardAfter: boardFrom([
          '####.#####', '####.#####', '####.#####', '####.#####',
        ]) },
      { value: 'strategy', enumerationIndex: 3, immediateHeuristic: 0,
        linesCleared: 0, boardAfter: boardFrom([
          '#########.', '#########.', '#########.', '#########.',
        ]) },
    ];

    const selected = selectHorizonPlacementBeam(entries, boardBefore, true, null, limits());

    expect(selected.map(({ enumerationIndex, beamSource }) =>
      [enumerationIndex, beamSource])).toEqual([[0, 'score'], [1, 'both'], [3, 'strategy']]);
  });

  it('keeps score ties stable on enumeration order', () => {
    const boardBefore = boardFrom([]);
    const selected = selectHorizonPlacementBeam([
      { value: 'later', enumerationIndex: 4, immediateHeuristic: 10, linesCleared: 0, boardAfter: boardFrom([]) },
      { value: 'earlier', enumerationIndex: 2, immediateHeuristic: 10, linesCleared: 0, boardAfter: boardFrom([]) },
    ], boardBefore, true, null, limits({ rootScoreSlots: 1, rootStrategySlots: 1 }));

    expect(selected.map(({ enumerationIndex }) => enumerationIndex)).toEqual([2]);
  });

  it('establishes a target well from a null intent without changing heuristic values', () => {
    const boardBefore = boardFrom([]);
    const selected = selectHorizonPlacementBeam([
      { value: 'score', enumerationIndex: 0, immediateHeuristic: 20, linesCleared: 0, boardAfter: boardFrom([]) },
      { value: 'strategy', enumerationIndex: 4, immediateHeuristic: 0, linesCleared: 0, boardAfter: boardFrom([
        '#########.', '#########.', '#########.', '#########.',
      ]) },
    ], boardBefore, true, null, limits({ rootScoreSlots: 1, rootStrategySlots: 1 }));

    expect(selected).toHaveLength(2);
    expect(selected[1]).toMatchObject({
      enumerationIndex: 4,
      beamSource: 'strategy',
      targetWellColumn: 9,
      immediateHeuristic: 0,
    });
  });

  it('retains the current intent for a compatible score-only continuation', () => {
    const boardBefore = boardFrom([
      '####.#####', '####.#####', '####.#####', '####.#####',
    ]);
    const selected = selectHorizonPlacementBeam([
      { value: 'keep', enumerationIndex: 1, immediateHeuristic: 50, linesCleared: 0, boardAfter: boardFrom([
        '####.#####', '####.#####', '####.#####', '####.#####',
      ]) },
    ], boardBefore, true, 4, limits({ rootScoreSlots: 1, rootStrategySlots: 1 }));

    expect(selected[0]?.targetWellColumn).toBe(4);
  });

  it('retains currentIntent 9 when the same column does not degrade despite a smaller tied well', () => {
    const tiedBoard = boardFrom([
      '.########.', '.########.', '.########.', '.########.',
    ]);
    const selected = selectHorizonPlacementBeam([
      { value: 'keep-9', enumerationIndex: 1, immediateHeuristic: 50, linesCleared: 0, boardAfter: tiedBoard },
    ], tiedBoard, true, 9, limits({ rootScoreSlots: 1, rootStrategySlots: 1 }));

    expect(selected[0]?.targetWellColumn).toBe(9);
  });

  it('resets the intent when the same target column summary degrades', () => {
    const boardBefore = boardFrom([
      '#########.', '#########.', '#########.', '#########.',
    ]);
    const selected = selectHorizonPlacementBeam([
      { value: 'degrade', enumerationIndex: 1, immediateHeuristic: 50, linesCleared: 0, boardAfter: boardFrom([
        '.########.', '#########.', '#########.', '#########.',
      ]) },
      { value: 'strategy', enumerationIndex: 4, immediateHeuristic: 0, linesCleared: 0, boardAfter: boardFrom([
        '#########.', '#########.', '#########.', '#########.',
      ]) },
    ], boardBefore, true, 9, limits({ rootScoreSlots: 1, rootStrategySlots: 1 }));

    expect(selected[0]?.beamSource).toBe('score');
    expect(selected[0]?.targetWellColumn).toBeNull();
  });

  it('resets an established intent after a four-line clear', () => {
    const boardBefore = boardFrom([
      '####.#####', '####.#####', '####.#####', '####.#####',
    ]);
    const selected = selectHorizonPlacementBeam([
      { value: 'tetris', enumerationIndex: 2, immediateHeuristic: 5, linesCleared: 4, boardAfter: boardFrom([]) },
    ], boardBefore, true, 4, limits({ rootScoreSlots: 1, rootStrategySlots: 1 }));

    expect(selected[0]).toMatchObject({
      enumerationIndex: 2,
      beamSource: 'both',
      targetWellColumn: null,
    });
  });

  it('drops the intent when a score-only continuation destroys the band', () => {
    const boardBefore = boardFrom([
      '####.#####', '####.#####', '####.#####', '####.#####',
    ]);
    const selected = selectHorizonPlacementBeam([
      { value: 'break', enumerationIndex: 1, immediateHeuristic: 30, linesCleared: 0, boardAfter: boardFrom([
        '##########', '####.#####', '####.#####', '####.#####',
      ]) },
    ], boardBefore, true, 4, limits({ rootScoreSlots: 1, rootStrategySlots: 1 }));

    expect(selected[0]).toMatchObject({
      enumerationIndex: 1,
      beamSource: 'score',
      targetWellColumn: null,
    });
  });

  it('rejects invalid slot counts and target columns', () => {
    const boardBefore = boardFrom([]);
    const entry = [{ value: 'x', enumerationIndex: 0, immediateHeuristic: 1, linesCleared: 0, boardAfter: boardFrom([]) }];
    expect(() => selectHorizonPlacementBeam(entry, boardBefore, true, 12 as 0, limits())).toThrow(/column/i);
    expect(() => selectHorizonPlacementBeam(entry, boardBefore, true, null, limits({ rootScoreSlots: 0 }))).toThrow(/slots/i);
  });
});

describe('classifyTargetWellTransition', () => {
  const intactWell = boardFrom([
    '####.#####', '####.#####', '####.#####', '####.#####',
  ]);

  it('classifies preserving the same well', () => {
    expect(classifyTargetWellTransition({
      boardBefore: intactWell,
      boardAfter: intactWell,
      linesCleared: 0,
      targetWellColumn: 4,
    })).toBe('preserve-well');
  });

  it('classifies a four-line clear as completing the well', () => {
    expect(classifyTargetWellTransition({
      boardBefore: intactWell,
      boardAfter: boardFrom([]),
      linesCleared: 4,
      targetWellColumn: 4,
    })).toBe('complete-tetris');
  });

  it('classifies losing the band as destroying the well', () => {
    expect(classifyTargetWellTransition({
      boardBefore: intactWell,
      boardAfter: boardFrom([
        '##########', '####.#####', '####.#####', '####.#####',
      ]),
      linesCleared: 0,
      targetWellColumn: 4,
    })).toBe('destroy-well');
  });
});
