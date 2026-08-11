import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSimState, applyAction, simulateGame, type SimAction } from './simulate';
import { mulberry32 } from './rng';
import {
  toVector, DEFAULT_WEIGHTS, DEFAULT_WEIGHTS_META, HANDCRAFTED_WEIGHTS,
} from './weights';
import { useGameStore } from '../store/gameStore';
import { FEATURE_COUNT, columnHeights } from './features';
import { totalLinesFromCounts } from './lineClears';
import { enumeratePlacements } from './placements';
import { boardFrom } from './testUtils';
import { getPieceCells } from '../engine/board';
import { createPiece } from '../engine/piece';
import { BOARD_WIDTH, TOTAL_ROWS } from '../constants';
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
  const EXPECTED_COUNTS = {
    single: { singles: 1, doubles: 0, triples: 0, tetrises: 0 },
    double: { singles: 0, doubles: 1, triples: 0, tetrises: 0 },
    triple: { singles: 0, doubles: 0, triples: 1, tetrises: 0 },
    tetris: { singles: 0, doubles: 0, triples: 0, tetrises: 1 },
  } as const;

  const CASES: [keyof typeof EXPECTED_COUNTS, string[], number][] = [
    ['single', ['.#########'], 1],
    ['double', ['.#########', '.#########'], 2],
    ['triple', ['.#########', '.#########', '.#########'], 3],
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
      expect(sim.clearCounts).toEqual(EXPECTED_COUNTS[name]);
      expect(sim.lines).toBe(totalLinesFromCounts(sim.clearCounts));
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

  // depth-2 search runs ~110 pieces/sec/core (vs. ~3000/sec at depth 1) because
  // it's a long *synchronous* compute loop that blocks this worker's event
  // loop — including the RPC heartbeat vitest uses to check the worker is
  // alive. Keep any depth-2 case here deliberately small: past a few seconds
  // of blocking, vitest's "onTaskUpdate" heartbeat times out and logs an
  // unhandled error, and under full-suite parallel load a large depth-2 case
  // can also blow past even a generous per-test timeout. Only the determinism
  // test below actually needs depth 2 (it's the training configuration); the
  // other properties (seed sensitivity, relative quality) don't depend on
  // search depth, so they run at depth 1 instead.
  const SLOW = 45_000;

  it('is fully deterministic for a given seed', () => {
    const a = simulateGame({ weights, seed: 7, maxPieces: 60, depth: 2 });
    const b = simulateGame({ weights, seed: 7, maxPieces: 60, depth: 2 });
    expect(a).toEqual(b);
  }, SLOW);

  it.each([
    [7, { lines: 22, score: 4200, pieces: 60, meanHeight: 4.166666666666667 }],
    [11, { lines: 23, score: 5100, pieces: 60, meanHeight: 3.933333333333333 }],
    [20260806, { lines: 22, score: 4300, pieces: 60, meanHeight: 3.8333333333333335 }],
  ])('keeps the bundled default model deterministic for seed %i', (seed, expected) => {
    expect(DEFAULT_WEIGHTS.cleanWellDepth).toBe(0);
    expect(DEFAULT_WEIGHTS.tetrisSetupProgress).toBe(0);
    expect(DEFAULT_WEIGHTS.tetrisReadyRows).toBe(0);
    expect(DEFAULT_WEIGHTS_META).toMatchObject({ version: 3, objective: 'score-rate-v2', gen: 40 });
    const result = simulateGame({
      weights: toVector(DEFAULT_WEIGHTS), seed, maxPieces: 60, depth: 2,
    });
    expect(result).toMatchObject({ ...expected, reason: 'pieceCap' });
    expect(result.lines).toBe(totalLinesFromCounts(result.clearCounts));
    Object.values(result.clearCounts).forEach((count) => expect(Number.isSafeInteger(count)).toBe(true));
  }, SLOW);

  it('produces different results for different seeds', () => {
    const a = simulateGame({ weights, seed: 1, maxPieces: 200, depth: 1 });
    const b = simulateGame({ weights, seed: 2, maxPieces: 200, depth: 1 });
    expect(a).not.toEqual(b);
  });

  it('stops at the piece cap without calling it a loss', () => {
    const r = simulateGame({ weights, seed: 3, maxPieces: 30, depth: 2 });
    expect(r.pieces).toBe(30);
    expect(r.reason).toBe('pieceCap');
  }, SLOW);

  it('plays better than a deliberately terrible weight vector', () => {
    const bad = Array(FEATURE_COUNT).fill(0);
    bad[1] = 1; // reward holes
    const good = simulateGame({ weights, seed: 11, maxPieces: 300, depth: 1 });
    const awful = simulateGame({ weights: bad, seed: 11, maxPieces: 300, depth: 1 });
    expect(good.lines).toBeGreaterThan(awful.lines);
  });

  it('rejects a weight vector of the wrong length', () => {
    expect(() => simulateGame({ weights: [1, 2, 3], seed: 1, maxPieces: 10, depth: 1 }))
      .toThrow(new RegExp(String(FEATURE_COUNT)));
  });
});

describe('board tidiness', () => {
  const weights = toVector(HANDCRAFTED_WEIGHTS);

  it('accumulates the post-lock stack height on every lock', () => {
    const sim = createSimState(9);
    expect(sim.heightSum).toBe(0);

    let expected = 0;
    for (let i = 0; i < 5; i++) {
      applyAction(sim, 'hardDrop');
      expected += Math.max(...columnHeights(sim.board));
      expect(sim.heightSum).toBe(expected);
    }
  });

  it('measures the height after the clear rather than before it', () => {
    // Four rows one cell short of full: the vertical I completes all of them,
    // so the board is empty the instant the piece locks. Sampling the height
    // before clearLines would record 4 here instead of 0 — and would credit the
    // tidiest possible move with the untidiest reading.
    const { sim } = seedBoth(boardFrom(Array(4).fill('.#########')));
    const placement = enumeratePlacements(sim.board, sim.currentPiece!).find((p) =>
      getPieceCells(p.piece).every((c) => c.x === 0),
    );
    expect(placement).toBeDefined();

    for (const move of placement!.moves) {
      applyAction(sim, (move === 'down' ? 'softDrop' : move) as SimAction);
    }
    applyAction(sim, 'hardDrop');

    expect(sim.lines).toBe(4);
    expect(sim.heightSum).toBe(0);
  });

  it('reports the mean height a game was played at', () => {
    const r = simulateGame({ weights, seed: 5, maxPieces: 60, depth: 1 });
    expect(r.meanHeight).toBeGreaterThan(0);
    expect(r.meanHeight).toBeLessThan(TOTAL_ROWS);
  });

  it('reports zero rather than NaN when no piece was ever locked', () => {
    const r = simulateGame({ weights, seed: 1, maxPieces: 0, depth: 1 });
    expect(r.pieces).toBe(0);
    expect(r.meanHeight).toBe(0);
  });

  it('separates two players that both survive the whole game', () => {
    // This is the property the whole metric exists for. Both vectors clear
    // lines and neither dies within the cap, so `lines` pins them to the same
    // 0.4 x maxPieces ceiling and cannot rank them; the one that is indifferent
    // to height still plays visibly higher up the board.
    const careless = toVector(HANDCRAFTED_WEIGHTS);
    careless[0] = 0; // aggregateHeight
    careless[3] = 0; // maxHeight

    const tidy = simulateGame({ weights, seed: 11, maxPieces: 200, depth: 1 });
    const sloppy = simulateGame({ weights: careless, seed: 11, maxPieces: 200, depth: 1 });

    expect(tidy.reason).toBe('pieceCap');
    expect(sloppy.reason).toBe('pieceCap');

    // Lines cannot tell them apart: both sit within a few percent of the same
    // 0.4 x maxPieces ceiling (measured 78 and 76 of a possible 80).
    const ceiling = 0.4 * 200;
    expect(tidy.lines).toBeGreaterThan(0.9 * ceiling);
    expect(sloppy.lines).toBeGreaterThan(0.9 * ceiling);
    expect(Math.abs(sloppy.lines - tidy.lines)).toBeLessThan(0.05 * ceiling);

    // Height can.
    expect(sloppy.meanHeight).toBeGreaterThan(tidy.meanHeight);
  });
});
