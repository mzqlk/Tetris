import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const reactHarness = vi.hoisted(() => ({
  cleanup: undefined as undefined | (() => void),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      reactHarness.cleanup = effect() ?? undefined;
    },
    useRef: (value: unknown) => ({ current: value }),
  };
});

import {
  advanceAiPlan,
  type AiPlan,
  expectedPose,
  isPlanValid,
  planAction,
  useAiPlayer,
  type AiPlayerOptions,
} from './useAiPlayer';
import { boardFrom } from '../ai/testUtils';
import { fromVector, toVector, HANDCRAFTED_WEIGHTS } from '../ai/weights';
import { samePiece } from '../ai/replay';
import { createEmptyBoard } from '../engine/board';
import { createPiece, movePiece } from '../engine/piece';
import { cellKey, projectHardDrop } from '../ai/placements';
import * as placements from '../ai/placements';
import * as search from '../ai/search';
import type { PublicSearchState } from '../ai/publicState';
import { useGameStore } from '../store/gameStore';
import type { Board, Piece, PieceType } from '../types';

const W = toVector(HANDCRAFTED_WEIGHTS);
const ZERO_MOVE_WEIGHTS = fromVector([
  0, 0, 0, -1, 0,
  0, 0, 0, 0, 0,
  0, 0, 0,
]);
const ORIGINAL_ACTIONS = (() => {
  const store = useGameStore.getState();
  return {
    moveLeft: store.moveLeft,
    moveRight: store.moveRight,
    softDrop: store.softDrop,
    hardDrop: store.hardDrop,
    rotate: store.rotate,
    hold: store.hold,
  };
})();

function resetStore(
  board: Board = createEmptyBoard(),
  currentPiece: Piece | null = createPiece(1),
  status: 'playing' | 'paused' | 'gameover' = 'playing',
): void {
  useGameStore.setState({
    board,
    currentPiece,
    nextPiece: createPiece(2),
    bag: [3, 4, 5, 6, 7, 1] as PieceType[],
    score: 0,
    level: 1,
    lines: 0,
    status,
    dropTimer: 0,
    flashRows: [],
    flashTimer: 0,
    hardDropTrail: null,
    trailTimer: 0,
    holdPiece: null,
    holdAvailable: true,
    unseenBagMask: 0b1111100,
    ...ORIGINAL_ACTIONS,
  });
}

function recordRealStoreActions(events: string[]): void {
  useGameStore.setState({
    moveLeft: () => {
      events.push('left');
      ORIGINAL_ACTIONS.moveLeft();
    },
    moveRight: () => {
      events.push('right');
      ORIGINAL_ACTIONS.moveRight();
    },
    softDrop: () => {
      events.push('down');
      ORIGINAL_ACTIONS.softDrop();
    },
    rotate: () => {
      events.push('rotate');
      ORIGINAL_ACTIONS.rotate();
    },
    hardDrop: () => {
      events.push(`hardDrop:timers=${vi.getTimerCount()}`);
      ORIGINAL_ACTIONS.hardDrop();
    },
  });
}

function options(
  speed: AiPlayerOptions['speed'],
  weights = HANDCRAFTED_WEIGHTS,
  enabled = true,
): AiPlayerOptions {
  return { enabled, speed, weights };
}

function planFor(
  board: Board,
  current: Piece,
  next: PieceType = 2,
): AiPlan {
  const result = planAction({
    board,
    current,
    next,
    hold: null,
    holdAvailable: true,
    unseenBagMask: 0b1111100,
  }, W, () => false);
  if (result === null || 'kind' in result) throw new Error('expected a placement plan');
  return result;
}

function runNextTimer(): void {
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  vi.advanceTimersToNextTimer();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  reactHarness.cleanup = undefined;
  resetStore();
  vi.spyOn(search, 'searchIterative').mockImplementation((state, weights) => {
    const decision = search.bestPlacement(
      state.board,
      state.current,
      createPiece(state.next),
      weights,
      1,
    );
    if (!decision) return null;
    return {
      action: { kind: 'place', placement: decision.placement },
      value: { survivalProbability: 1, expectedHeuristicValue: decision.score },
      diagnostics: {
        completedDepth: 1,
        expandedDecisionNodes: 1,
        expandedChanceNodes: 0,
        cacheHits: 0,
        placementCacheHits: 0,
        placementCacheEntries: 0,
        transpositionEntries: 0,
        equivalentPlacementsRemoved: 0,
        prunedChanceBranches: 0,
        aborted: false,
      },
    };
  });
});

afterEach(() => {
  reactHarness.cleanup?.();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('planAction', () => {
  it('returns a plan whose path matches its move list', () => {
    const board = createEmptyBoard();
    const plan = planFor(board, createPiece(3), 5);
    expect(plan).not.toBeNull();
    expect(plan.path).toHaveLength(plan.moves.length);
    expect(plan.cursor).toBe(0);
  });

  it('stores a locked target reached by hard-dropping the path endpoint', () => {
    const board = boardFrom(['..#.......', '##.#####.#']);
    const origin = createPiece(7);
    const plan = planFor(board, origin);
    const preDrop = plan.path.at(-1) ?? origin;

    expect(samePiece(projectHardDrop(board, preDrop), plan.target)).toBe(true);
    expect(movePiece(board, plan.target, 0, 1)).toBeNull();
  });

  it('rejects a cell-equivalent hard drop with a different final pose', () => {
    const board = boardFrom(['....######', '....######', '.....#####']);
    const weights = Array(W.length).fill(0);
    weights[0] = 1;
    const declaredTarget = { type: 1 as const, rotation: 2, position: { x: 1, y: 16 } };
    const wrongPose = { type: 1 as const, rotation: 0, position: { x: 1, y: 17 } };
    expect(cellKey(declaredTarget)).toBe(cellKey(wrongPose));
    expect(samePiece(declaredTarget, wrongPose)).toBe(false);
    vi.spyOn(placements, 'projectHardDrop').mockReturnValue(wrongPose);

    expect(planAction({
      board,
      current: createPiece(1),
      next: 2,
      hold: null,
      holdAvailable: true,
      unseenBagMask: 0b1111100,
    }, weights, () => false)).toBeNull();
  });

  it('returns null when the piece cannot be placed anywhere', () => {
    const full = boardFrom(Array(22).fill('##########'));
    expect(planAction({
      board: full,
      current: createPiece(1),
      next: 2,
      hold: null,
      holdAvailable: true,
      unseenBagMask: 0b1111100,
    }, W, () => false)).toBeNull();
  });
});

describe('advanceAiPlan', () => {
  it('hard-drops in the same call as the final positioning move', () => {
    const origin = createPiece(1);
    const plan: AiPlan = {
      moves: ['rotate'],
      path: [{ ...origin, rotation: 1 }],
      cursor: 0,
      origin,
      target: { ...origin, rotation: 1, position: { x: 3, y: 18 } },
    };
    const events: string[] = [];

    const placed = advanceAiPlan(
      plan,
      (move) => events.push(move),
      () => events.push('hardDrop'),
    );

    expect(placed).toBe(true);
    expect(events).toEqual(['rotate', 'hardDrop']);
    expect(plan.cursor).toBe(1);
  });

  it('hard-drops an empty positioning plan immediately', () => {
    const origin = createPiece(2);
    const plan: AiPlan = { moves: [], path: [], cursor: 0, origin, target: origin };
    const events: string[] = [];

    expect(advanceAiPlan(plan, () => events.push('move'), () => events.push('hardDrop')))
      .toBe(true);
    expect(events).toEqual(['hardDrop']);
  });

  it('waits after a non-final positioning move', () => {
    const origin = createPiece(2);
    const plan: AiPlan = {
      moves: ['left', 'left'],
      path: [origin, origin],
      cursor: 0,
      origin,
      target: origin,
    };
    const events: string[] = [];

    expect(advanceAiPlan(plan, (move) => events.push(move), () => events.push('hardDrop')))
      .toBe(false);
    expect(events).toEqual(['left']);
    expect(plan.cursor).toBe(1);
  });
});

describe('useAiPlayer timer and lifecycle integration', () => {
  it.each([
    ['instant', 100],
    ['normal', 200],
    ['slow', 200],
  ] as const)('injects the %s planning budget', (speed, milliseconds) => {
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });
    const observed: boolean[] = [];
    vi.spyOn(search, 'searchIterative').mockImplementation((_state, _weights, budget) => {
      observed.push(budget.shouldAbort());
      now = milliseconds;
      observed.push(budget.shouldAbort());
      expect(budget.maxLockedDepth).toBe(4);
      return null;
    });

    useAiPlayer(options(speed));
    runNextTimer();

    expect(observed).toEqual([false, true]);
  });

  it('executes Hold and replans only after the new preview is visible', () => {
    const states: PublicSearchState[] = [];
    const placement = placements.enumeratePlacements(createEmptyBoard(), createPiece(2))[0];
    vi.spyOn(search, 'searchIterative').mockImplementation((state) => {
      states.push(state);
      return states.length === 1
        ? {
            action: { kind: 'hold' },
            value: { survivalProbability: 1, expectedHeuristicValue: 0 },
            diagnostics: {
              completedDepth: 1,
              expandedDecisionNodes: 1,
              expandedChanceNodes: 0,
              cacheHits: 0,
              placementCacheHits: 0,
              placementCacheEntries: 0,
              transpositionEntries: 0,
              equivalentPlacementsRemoved: 0,
              prunedChanceBranches: 0,
              aborted: false,
            },
          }
        : {
            action: { kind: 'place', placement },
            value: { survivalProbability: 1, expectedHeuristicValue: 0 },
            diagnostics: {
              completedDepth: 1,
              expandedDecisionNodes: 1,
              expandedChanceNodes: 0,
              cacheHits: 0,
              placementCacheHits: 0,
              placementCacheEntries: 0,
              transpositionEntries: 0,
              equivalentPlacementsRemoved: 0,
              prunedChanceBranches: 0,
              aborted: false,
            },
          };
    });
    const events: string[] = [];
    useGameStore.setState({
      hold: () => {
        events.push('hold');
        ORIGINAL_ACTIONS.hold();
      },
      hardDrop: () => {
        events.push('hardDrop');
        ORIGINAL_ACTIONS.hardDrop();
      },
    });

    useAiPlayer(options('instant'));
    runNextTimer();
    expect(events).toEqual(['hold']);
    runNextTimer();

    expect(events).toEqual(['hold', 'hardDrop']);
    expect(states).toHaveLength(2);
    expect(states[1].holdAvailable).toBe(false);
    expect(states[1].current.type).toBe(2);
  });

  it.each(['normal', 'slow'] as const)(
    '%s runs at most one positioning action per timer and hard-drops with the last action',
    (speed) => {
      const events: string[] = [];
      recordRealStoreActions(events);

      useAiPlayer(options(speed));
      expect(vi.getTimerCount()).toBe(1);

      runNextTimer();
      expect(events).toEqual(['left']);
      expect(vi.getTimerCount()).toBe(1);

      runNextTimer();
      expect(events).toEqual(['left', 'left']);
      expect(vi.getTimerCount()).toBe(1);

      runNextTimer();
      expect(events).toEqual([
        'left',
        'left',
        'left',
        'hardDrop:timers=0',
      ]);
      expect(events.filter((event) => event.startsWith('hardDrop'))).toHaveLength(1);
      expect(useGameStore.getState().currentPiece?.type).toBe(2);
      expect(vi.getTimerCount()).toBe(1);
    },
  );

  it('hard-drops a zero-action plan immediately and exactly once', () => {
    const events: string[] = [];
    recordRealStoreActions(events);

    useAiPlayer(options('normal', ZERO_MOVE_WEIGHTS));
    runNextTimer();

    expect(events).toEqual(['hardDrop:timers=0']);
    expect(useGameStore.getState().currentPiece?.type).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('runs an instant plan to completion with one hard drop', () => {
    const events: string[] = [];
    recordRealStoreActions(events);

    useAiPlayer(options('instant'));
    runNextTimer();

    expect(events).toEqual([
      'left',
      'left',
      'left',
      'hardDrop:timers=0',
    ]);
    expect(events.filter((event) => event.startsWith('hardDrop'))).toHaveLength(1);
    expect(useGameStore.getState().currentPiece?.type).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('replans after gravity changes the pose instead of following the stale path', () => {
    const events: string[] = [];
    resetStore(boardFrom(['....######', '....######', '.....#####']));
    recordRealStoreActions(events);

    useAiPlayer(options('normal', ZERO_MOVE_WEIGHTS));
    runNextTimer();
    expect(events).toEqual(['left']);

    useGameStore.getState().tick(1_000);
    expect(useGameStore.getState().currentPiece).toMatchObject({
      rotation: 0,
      position: { x: 2, y: 1 },
    });

    runNextTimer();
    expect(events).toEqual(['left', 'down']);
    expect(events).not.toContain('hardDrop:timers=0');
    expect(useGameStore.getState().currentPiece).toMatchObject({
      rotation: 0,
      position: { x: 2, y: 2 },
    });
  });

  it.each([
    ['paused', 'paused', createPiece(1)],
    ['game over', 'gameover', createPiece(1)],
    ['null current piece', 'playing', null],
  ] as const)('does not act while %s', (_label, status, currentPiece) => {
    const events: string[] = [];
    resetStore(createEmptyBoard(), currentPiece, status);
    recordRealStoreActions(events);

    useAiPlayer(options('normal'));
    runNextTimer();

    expect(events).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('cleanup and disabling cancel an already scheduled continuation', () => {
    const events: string[] = [];
    recordRealStoreActions(events);

    useAiPlayer(options('normal'));
    runNextTimer();
    expect(events).toEqual(['left']);
    expect(vi.getTimerCount()).toBe(1);

    const cleanup = reactHarness.cleanup;
    cleanup?.();
    useAiPlayer(options('normal', HANDCRAFTED_WEIGHTS, false));
    vi.runAllTimers();

    expect(events).toEqual(['left']);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('plan validation', () => {
  it('expects the origin pose before the first move', () => {
    const board = createEmptyBoard();
    const plan = planFor(board, createPiece(6));
    expect(samePiece(expectedPose(plan), plan.origin)).toBe(true);
  });

  it('expects the previous path entry once execution has started', () => {
    const board = createEmptyBoard();
    const plan = planFor(board, createPiece(6));
    plan.cursor = 2;
    expect(samePiece(expectedPose(plan), plan.path[1])).toBe(true);
  });

  it('accepts a plan while the piece is where the plan expects it', () => {
    const board = createEmptyBoard();
    const plan = planFor(board, createPiece(6));
    expect(isPlanValid(plan, plan.origin)).toBe(true);
  });

  it('rejects a plan once gravity has pulled the piece down', () => {
    const board = createEmptyBoard();
    const origin = createPiece(6);
    const plan = planFor(board, origin);
    const pulled = movePiece(board, origin, 0, 1)!;
    expect(isPlanValid(plan, pulled)).toBe(false);
  });

  it('rejects a plan when the piece type changed underneath it', () => {
    const board = createEmptyBoard();
    const plan = planFor(board, createPiece(6));
    expect(isPlanValid(plan, createPiece(7))).toBe(false);
  });

  it('rejects a finished plan so the caller hard-drops instead of stepping past the end', () => {
    const board = createEmptyBoard();
    const plan = planFor(board, createPiece(6));
    plan.cursor = plan.moves.length + 1;
    expect(isPlanValid(plan, plan.origin)).toBe(false);
  });
});
