import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSimState, applyAction, simulateGame, type SimAction } from './simulate';
import { mulberry32 } from './rng';
import { toVector, HANDCRAFTED_WEIGHTS } from './weights';
import { useGameStore } from '../store/gameStore';
import { FEATURE_COUNT } from './features';
import { enumeratePlacements } from './placements';
import { boardFrom } from './testUtils';
import { getPieceCells } from '../engine/board';
import { createPiece } from '../engine/piece';
import { BOARD_WIDTH } from '../constants';
import type { Board, PieceType } from '../types';

afterEach(() => {
  vi.restoreAllMocks();
});

const STORE_ACTION: Record<SimAction, keyof ReturnType<typeof useGameStore.getState>> = {
  left: 'moveLeft',
  right: 'moveRight',
  rotate: 'rotate',
  softDrop: 'softDrop',
  hardDrop: 'hardDrop',
};

/**
 * Emit an arbitrary but board-covering action sequence.
 *
 * A symmetric random walk from the spawn column does NOT work here: every piece
 * piles up around x=3, the stack tops out after roughly five locks, and no row
 * ever fills — measured over 50,000 seeds, zero line clears. That leaves the
 * clear / score / level-up paths, which are exactly where the simulator and the
 * store could diverge, completely unexercised.
 *
 * Steering each piece toward a random target column fills rows instead, while
 * still being an arbitrary sequence: the moves that fail are no-ops on both
 * sides, and neither side gets any hint of what the other is doing.
 *
 * The walk comes BEFORE the rotations on purpose. Rotating first would put
 * every rotation at the spawn column in the middle of the board, so SRS wall
 * kicks would hardly ever fire — the coverage counter would claim to exercise
 * kicks while sampling almost none. Rotating after the walk means rotations
 * happen at the edge columns too, where kicks actually occur.
 */
function* actionScript(rand: () => number): Generator<SimAction> {
  for (;;) {
    // Pieces spawn at x=3; walk toward a random column.
    const dx = Math.floor(rand() * BOARD_WIDTH) - 3;
    for (let i = 0; i < Math.abs(dx); i++) yield dx < 0 ? 'left' : 'right';

    const rotations = Math.floor(rand() * 4);
    for (let i = 0; i < rotations; i++) yield 'rotate';

    if (rand() < 0.3) yield 'softDrop';
    yield 'hardDrop';
  }
}

/**
 * Put the store and a fresh SimState into an identical, RNG-free starting
 * position. The bag is left non-empty so neither side calls generateBag, which
 * means any divergence observed afterwards is a real behavioural difference
 * rather than a seeding artifact.
 */
function seedBoth(board: Board): { sim: ReturnType<typeof createSimState> } {
  const current = createPiece(1); // I piece
  const next = createPiece(2);
  const bag: PieceType[] = [3, 4, 5, 6, 7];

  const snapshot = () => ({
    board: board.map((row) => [...row]),
    currentPiece: { ...current, position: { ...current.position } },
    nextPiece: { ...next, position: { ...next.position } },
    bag: [...bag],
    score: 0,
    level: 1,
    lines: 0,
    status: 'playing' as const,
  });

  useGameStore.setState(snapshot());
  const sim = createSimState(1);
  Object.assign(sim, snapshot());
  return { sim };
}

/** Drive both sides through the same action and keep them in lockstep. */
function driveBoth(sim: ReturnType<typeof createSimState>, actions: SimAction[]): void {
  for (const action of actions) {
    (useGameStore.getState()[STORE_ACTION[action]] as () => void)();
    applyAction(sim, action);
  }
}

describe('differential test against the real gameStore', () => {
  it('matches the store cell-for-cell over random action sequences', () => {
    let totalKicks = 0;
    let totalLocks = 0;

    for (let seed = 1; seed <= 20; seed++) {
      // Both sides consume the same mulberry32 stream in the same order.
      vi.spyOn(Math, 'random').mockImplementation(mulberry32(seed));
      useGameStore.getState().startGame();
      const sim = createSimState(seed);
      const pick = mulberry32(seed ^ 0x9e3779b9);

      const script = actionScript(pick);

      for (let step = 0; step < 400; step++) {
        if (useGameStore.getState().status !== 'playing') break;
        if (sim.status !== 'playing') break;

        const action = script.next().value as SimAction;

        const before = useGameStore.getState();
        const pieceBefore = before.currentPiece;

        (before[STORE_ACTION[action]] as () => void)();
        applyAction(sim, action);

        const after = useGameStore.getState();

        expect(sim.board).toEqual(after.board);
        expect(sim.currentPiece).toEqual(after.currentPiece);
        expect(sim.nextPiece).toEqual(after.nextPiece);
        expect(sim.score).toBe(after.score);
        expect(sim.lines).toBe(after.lines);
        expect(sim.level).toBe(after.level);
        expect(sim.status).toBe(after.status);

        // Coverage bookkeeping — a differential test that never kicks off a
        // wall proves much less than it appears to.
        if (action === 'hardDrop') totalLocks++;
        if (
          action === 'rotate' && pieceBefore && after.currentPiece &&
          after.currentPiece.rotation !== pieceBefore.rotation &&
          (after.currentPiece.position.x !== pieceBefore.position.x ||
           after.currentPiece.position.y !== pieceBefore.position.y)
        ) {
          totalKicks++;
        }
      }

      vi.restoreAllMocks();
    }

    // §13 flags coverage as the weak point of a randomised differential test,
    // so assert the corpus actually exercised the interesting paths.
    //
    // Line clears are deliberately NOT asserted here. Measured over this corpus
    // they occur zero-to-once in ~440 locks depending on the action script's
    // exact constants, so any threshold would be a coin flip that fails with no
    // pointer to a cause — and a future engineer would "fix" the flake by
    // lowering the bar rather than investigating. The clear / score / level-up
    // paths are covered exhaustively and deterministically by `line-clear
    // parity` below (single, double and tetris, full board/score/lines/level
    // parity), which is strictly stronger than one lucky random clear.
    //
    // `totalKicks` stays: it measured 5 once the action script was reordered to
    // walk before rotating, so it has real margin.
    expect(totalLocks).toBeGreaterThan(100);
    expect(totalKicks).toBeGreaterThan(0);
  });
});

describe('line-clear parity', () => {
  // Random play produces single clears but essentially never a double or a
  // tetris, so the multi-row scoring and level-up paths get pinned down here
  // instead. Both sides start from an identical board and an identical
  // non-empty bag, so neither consumes any RNG.
  const CASES: [string, string[], number][] = [
    ['single', ['.#########'], 1],
    ['double', ['.#########', '.#########'], 2],
    ['tetris', ['.#########', '.#########', '.#########', '.#########'], 4],
  ];

  for (const [name, rows, expectedLines] of CASES) {
    it(`matches the store on a ${name} clear`, () => {
      const board = boardFrom(rows);
      const { sim } = seedBoth(board);

      // The vertical I dropped into the column-0 shaft completes every seeded row.
      const placement = enumeratePlacements(board, createPiece(1)).find((p) =>
        getPieceCells(p.piece).every((c) => c.x === 0),
      );
      expect(placement).toBeDefined();

      driveBoth(sim, [
        ...placement!.moves.map((m) => (m === 'down' ? 'softDrop' : m) as SimAction),
        'hardDrop',
      ]);

      const after = useGameStore.getState();
      expect(after.lines).toBe(expectedLines);
      expect(sim.lines).toBe(expectedLines);
      expect(sim.board).toEqual(after.board);
      expect(sim.score).toBe(after.score);
      expect(sim.level).toBe(after.level);
      expect(sim.status).toBe(after.status);
    });
  }
});

describe('wall-kick parity', () => {
  it('matches the store when a rotation only succeeds via a wall kick', () => {
    // Rows 2-21 are full except column 0, leaving a one-wide shaft. Walk the I
    // piece flush against the left wall and rotate: SRS tries the (0,0) offset
    // first, which lands the piece in the filled columns and fails, then falls
    // through to (-2,0), which drops it into the shaft. Random play barely
    // samples real wall kicks, so this pins the behaviour down directly.
    const { sim } = seedBoth(boardFrom(Array(20).fill('.#########')));

    driveBoth(sim, ['left', 'left', 'left', 'rotate']);

    const after = useGameStore.getState();
    expect(after.currentPiece!.rotation).toBe(1);
    expect(after.currentPiece!.position.x).toBe(-2); // proof a kick fired
    expect(sim.currentPiece).toEqual(after.currentPiece);
    expect(sim.board).toEqual(after.board);
  });

  it('matches the store when rotating inside a one-wide shaft', () => {
    // A shaft away from the wall: some of these rotations find a kick and some
    // fail outright. This test deliberately does not assert which — the point is
    // that both sides must reach the same answer either way, including when
    // rotatePiece signals failure by returning its argument unchanged.
    const { sim } = seedBoth(boardFrom(Array(20).fill('##.#######')));
    driveBoth(sim, ['left', 'rotate', 'rotate', 'rotate']);

    const after = useGameStore.getState();
    expect(sim.currentPiece).toEqual(after.currentPiece);
    expect(sim.board).toEqual(after.board);
  });
});

describe('createSimState', () => {
  it('starts with a current piece and a preview', () => {
    const s = createSimState(42);
    expect(s.currentPiece).not.toBeNull();
    expect(s.nextPiece).not.toBeNull();
    expect(s.status).toBe('playing');
    expect(s.pieces).toBe(0);
  });

  it('promotes the previewed piece on lock, like the store', () => {
    const s = createSimState(42);
    for (let i = 0; i < 5; i++) {
      const previewed = s.nextPiece!.type;
      applyAction(s, 'hardDrop');
      expect(s.currentPiece!.type).toBe(previewed);
    }
  });
});

describe('simulateGame', () => {
  const weights = toVector(HANDCRAFTED_WEIGHTS);

  // depth-2 search runs ~115 pieces/sec/core, so a 200-piece game takes a couple
  // of seconds and these two-game tests blow past vitest's 5s default.
  const SLOW = 45_000;

  it('is fully deterministic for a given seed', () => {
    const a = simulateGame({ weights, seed: 7, maxPieces: 200, depth: 2 });
    const b = simulateGame({ weights, seed: 7, maxPieces: 200, depth: 2 });
    expect(a).toEqual(b);
  }, SLOW);

  it('produces different results for different seeds', () => {
    const a = simulateGame({ weights, seed: 1, maxPieces: 200, depth: 2 });
    const b = simulateGame({ weights, seed: 2, maxPieces: 200, depth: 2 });
    expect(a).not.toEqual(b);
  }, SLOW);

  it('stops at the piece cap without calling it a loss', () => {
    const r = simulateGame({ weights, seed: 3, maxPieces: 30, depth: 2 });
    expect(r.pieces).toBe(30);
    expect(r.reason).toBe('pieceCap');
  }, SLOW);

  it('plays better than a deliberately terrible weight vector', () => {
    const bad = Array(FEATURE_COUNT).fill(0);
    bad[1] = 1; // reward holes
    const good = simulateGame({ weights, seed: 11, maxPieces: 500, depth: 2 });
    const awful = simulateGame({ weights: bad, seed: 11, maxPieces: 500, depth: 2 });
    expect(good.lines).toBeGreaterThan(awful.lines);
  }, SLOW);

  it('rejects a weight vector of the wrong length', () => {
    expect(() => simulateGame({ weights: [1, 2, 3], seed: 1, maxPieces: 10, depth: 1 }))
      .toThrow(/9/);
  });
});
