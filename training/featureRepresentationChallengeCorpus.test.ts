import { describe, expect, test } from 'vitest';
import {
  B1_1_CHALLENGE_CORPUS_ID,
  B1_1_CHALLENGE_PAIR_DESCRIPTORS,
  B1_1_CHALLENGE_STATES,
  materializeAllChallengePlacementPairs,
  materializeChallengePlacementPair,
  validateChallengeCorpus,
} from './featureRepresentationChallengeCorpus';

function projectPlacementPair(pair: ReturnType<typeof materializeAllChallengePlacementPairs>[number]) {
  const projectFeatureInput = (input: typeof pair.positive) => ({
    boardBefore: input.boardBefore.map((row) => [...row]),
    boardAfter: input.boardAfter.map((row) => [...row]),
    placedCells: input.placedCells.map((cell) => ({ x: cell.x, y: cell.y })),
    linesCleared: input.linesCleared,
    pending: {
      board: input.pending.board.map((row) => [...row]),
      current: {
        type: input.pending.current.type,
        rotation: input.pending.current.rotation,
        position: { ...input.pending.current.position },
      },
      hold: input.pending.hold,
      holdAvailable: input.pending.holdAvailable,
      unseenBagMask: input.pending.unseenBagMask,
    },
  });
  return {
    descriptor: {
      id: pair.descriptor.id,
      stateId: pair.descriptor.stateId,
      group: pair.descriptor.group,
      category: pair.descriptor.category,
      positiveCellKey: pair.descriptor.positiveCellKey,
      negativeCellKey: pair.descriptor.negativeCellKey,
      positiveClass: pair.descriptor.positiveClass,
      negativeClass: pair.descriptor.negativeClass,
    },
    state: {
      board: pair.state.board.map((row) => [...row]),
      current: {
        type: pair.state.current.type,
        rotation: pair.state.current.rotation,
        position: { ...pair.state.current.position },
      },
      next: pair.state.next,
      hold: pair.state.hold,
      holdAvailable: pair.state.holdAvailable,
      unseenBagMask: pair.state.unseenBagMask,
    },
    positive: projectFeatureInput(pair.positive),
    negative: projectFeatureInput(pair.negative),
  };
}

describe('B1.1 challenge corpus', () => {
  test('freezes the public-only shape and structural groups', () => {
    expect(B1_1_CHALLENGE_CORPUS_ID).toBe('b1-1-challenge-corpus-v1');
    expect(B1_1_CHALLENGE_STATES).toHaveLength(32);
    expect(B1_1_CHALLENGE_STATES.filter((state) => state.group === 'lane-preservation')).toHaveLength(8);
    expect(B1_1_CHALLENGE_STATES.filter((state) => state.group === 'completion-versus-lower-order')).toHaveLength(8);
    expect(B1_1_CHALLENGE_STATES.filter((state) => state.group === 'public-i-access')).toHaveLength(8);
    expect(B1_1_CHALLENGE_STATES.filter((state) => state.group === 'safety')).toHaveLength(8);
    expect(new Set(B1_1_CHALLENGE_STATES.map((state) => state.id)).size).toBe(32);
    expect(new Set(B1_1_CHALLENGE_PAIR_DESCRIPTORS.map((descriptor) => descriptor.id)).size).toBe(32);
    expect(new Set(B1_1_CHALLENGE_PAIR_DESCRIPTORS.map((descriptor) => descriptor.stateId)).size).toBe(32);
    expect(JSON.stringify(B1_1_CHALLENGE_STATES)).not.toMatch(/seed|rng|bagIndex|hidden/i);
    expect(JSON.stringify(B1_1_CHALLENGE_PAIR_DESCRIPTORS)).not.toMatch(/seed|rng|bagIndex|hidden/i);
    const statesById = new Map(B1_1_CHALLENGE_STATES.map((state) => [state.id, state]));
    for (const descriptor of B1_1_CHALLENGE_PAIR_DESCRIPTORS) {
      expect(Object.keys(descriptor).sort()).toEqual([
        'category', 'group', 'id', 'negativeCellKey', 'negativeClass', 'positiveCellKey', 'positiveClass', 'stateId',
      ]);
      expect(descriptor.group).toBe(statesById.get(descriptor.stateId)?.group);
    }
  });

  test('contains only literal 22-row public states with one reviewed descriptor each', () => {
    for (const state of B1_1_CHALLENGE_STATES) {
      expect(state.rows).toHaveLength(22);
      expect(state.rows.every((row) => Number.isInteger(row) && row >= 0 && row < (1 << 10))).toBe(true);
      expect(Object.keys(state).sort()).toEqual([
        'current', 'group', 'hold', 'holdAvailable', 'id', 'next', 'rows', 'targetWellColumn', 'unseenBagMask',
      ]);
      expect(B1_1_CHALLENGE_PAIR_DESCRIPTORS.filter((descriptor) => descriptor.stateId === state.id)).toHaveLength(1);
    }
  });

  test('deeply reproduces every reviewed SRS pair after mutation without changing literal rows', () => {
    const rowsBefore = B1_1_CHALLENGE_STATES.map((state) => [...state.rows]);
    const first = materializeAllChallengePlacementPairs();
    const firstCanonical = first.map(projectPlacementPair);

    expect(first).toHaveLength(32);
    for (const pair of first) {
      expect(pair.positive.placedCells).toHaveLength(4);
      expect(pair.negative.placedCells).toHaveLength(4);
      expect(pair.positive.boardAfter).not.toBe(pair.negative.boardAfter);
    }
    first[0]!.positive.boardAfter[0]![0] = 99;
    const secondCanonical = materializeAllChallengePlacementPairs().map(projectPlacementPair);

    expect(secondCanonical).toEqual(firstCanonical);
    expect(secondCanonical.every((pair) => typeof pair.descriptor.group === 'string')).toBe(true);
    expect(B1_1_CHALLENGE_STATES.map((state) => state.rows)).toEqual(rowsBefore);
  });

  test('exports a validating helper and rejects malformed corpus data', () => {
    expect(() => validateChallengeCorpus()).not.toThrow();
    const state = B1_1_CHALLENGE_STATES[0];
    const descriptor = B1_1_CHALLENGE_PAIR_DESCRIPTORS[0];
    expect(() => materializeChallengePlacementPair({ ...descriptor, positiveCellKey: descriptor.negativeCellKey })).toThrow();
    expect(() => materializeChallengePlacementPair({ ...descriptor, stateId: 'unknown' })).toThrow();
    expect(state.id).toBe(descriptor.stateId);
  });

  test('reviewed strategy positives preserve their target lane or complete a Tetris', () => {
    const states = new Map(B1_1_CHALLENGE_STATES.map((state) => [state.id, state]));
    for (const pair of materializeAllChallengePlacementPairs()) {
      const state = states.get(pair.descriptor.stateId);
      if (state === undefined) throw new Error('missing reviewed state');
      if (state.group === 'lane-preservation' || state.group === 'public-i-access') {
        expect(pair.positive.boardAfter.every((row) => row[state.targetWellColumn] === 0)).toBe(true);
      }
      if (state.group === 'completion-versus-lower-order') {
        expect(pair.positive.linesCleared).toBe(4);
      }
    }
  });

  test('validates injected malformed corpus definitions and Hold reachability', () => {
    const states = B1_1_CHALLENGE_STATES.map((state) => ({ ...state, rows: [...state.rows] }));
    const pairs = B1_1_CHALLENGE_PAIR_DESCRIPTORS.map((pair) => ({ ...pair }));
    expect(() => validateChallengeCorpus(states.slice(1), pairs)).toThrow();
    expect(() => validateChallengeCorpus([...states, states[0]], pairs)).toThrow();
    expect(() => validateChallengeCorpus(states, [...pairs, pairs[0]])).toThrow();
    expect(() => validateChallengeCorpus(states, [{ ...pairs[0], stateId: pairs[1].stateId }, ...pairs.slice(1)])).toThrow();
    expect(() => validateChallengeCorpus([{ ...states[0], rows: [1024, ...states[0].rows.slice(1)] }, ...states.slice(1)], pairs)).toThrow();
    const invalidPieceType = 8 as unknown as typeof states[number]['current']['type'];
    expect(() => validateChallengeCorpus([{ ...states[0], current: { ...states[0].current, type: invalidPieceType } }, ...states.slice(1)], pairs)).toThrow();
    expect(() => validateChallengeCorpus([{ ...states[0], hold: null, holdAvailable: false }, ...states.slice(1)], pairs)).toThrow();
    expect(() => validateChallengeCorpus(states, [{ ...pairs[0], positiveCellKey: pairs[0].negativeCellKey }, ...pairs.slice(1)])).toThrow();
    expect(() => validateChallengeCorpus(states, [{ ...pairs[0], stateId: 'missing' }, ...pairs.slice(1)])).toThrow();
    expect(() => validateChallengeCorpus(
      states,
      [{ ...pairs[0], group: 'safety' }, ...pairs.slice(1)],
    )).toThrow();
    expect(() => validateChallengeCorpus(states, [{ ...pairs[0], positiveClass: 'complete-tetris' }, ...pairs.slice(1)])).toThrow();
  });

  test('strategy class matches its materialized consequence', () => {
    const states = new Map(B1_1_CHALLENGE_STATES.map((state) => [state.id, state]));
    for (const pair of materializeAllChallengePlacementPairs()) {
      const state = states.get(pair.descriptor.stateId);
      if (state === undefined || state.group === 'safety') continue;
      if (pair.descriptor.positiveClass === 'complete-tetris') {
        expect(pair.positive.linesCleared).toBe(4);
      }
      if (pair.descriptor.positiveClass === 'preserve-well') {
        expect(pair.positive.boardAfter.every((row) => row[state.targetWellColumn] === 0)).toBe(true);
      }
    }
  });
});
