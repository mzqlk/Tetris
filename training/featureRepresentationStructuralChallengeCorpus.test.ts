import { describe, expect, test } from 'vitest';
import { getPieceCells, isValidPosition } from '../src/engine/board';
import { createPiece } from '../src/engine/piece';
import { extractB1PlacementFeatures, futureIAccessProbability } from '../src/ai/opportunityFeatures';
import { enumeratePlacements } from '../src/ai/placements';
import {
  columnHeights,
  compareTetrisWellSummaries,
  summarizeTetrisWell,
  summarizeTetrisWellAt,
} from '../src/ai/tetrisStrategy';
import { B1_1_CHALLENGE_STATES } from './featureRepresentationChallengeCorpus';
import { B1_PLACEMENT_PAIR_DESCRIPTORS } from './featureRepresentationCorpus';
import { TETRIS_OPPORTUNITY_CORPUS_V1 } from './tetrisOpportunityCorpus';
import {
  pairFingerprint,
  stateFingerprint,
  structuralProvenanceFingerprint,
} from './featureRepresentationStructuralChallengeBuilder';
import {
  B1_2_CORPUS_ID,
  B1_2_PAIRS,
  B1_2_STATES,
  materializeAllB1_2Pairs,
  validateB1_2Corpus,
} from './featureRepresentationStructuralChallengeCorpus';

function mirrorCellKey(value: string): string {
  return value.split(',').map(Number).map((index) => {
    const row = Math.floor(index / 10);
    const column = index % 10;
    return row * 10 + (9 - column);
  }).sort((left, right) => left - right).join(',');
}

function hasVerticalIAccess(board: number[][], target: number): boolean {
  return enumeratePlacements(board, createPiece(1)).some((placement) => (
    getPieceCells(placement.piece).every((cell) => cell.x === target)
  ));
}

describe('B1.2 literal structural challenge corpus', () => {
  test('has the frozen identity, shape, groups, and one pair per state', () => {
    const groupCount = (group: (typeof B1_2_STATES)[number]['group']) => (
      B1_2_STATES.filter((state) => state.group === group).length
    );

    expect(B1_2_CORPUS_ID).toBe('b1-2-structural-challenge-corpus-v1');
    expect(B1_2_STATES).toHaveLength(32);
    expect(B1_2_PAIRS).toHaveLength(32);
    expect(groupCount('target-lane-alias')).toBe(8);
    expect(groupCount('lane-transfer-control')).toBe(8);
    expect(groupCount('public-i-context-control')).toBe(8);
    expect(groupCount('safety-control')).toBe(8);
    expect(new Set(B1_2_STATES.map((state) => state.id)).size).toBe(32);
    expect(new Set(B1_2_PAIRS.map((pair) => pair.id)).size).toBe(32);
    expect(new Set(B1_2_PAIRS.map((pair) => pair.stateId)).size).toBe(32);
    expect(() => validateB1_2Corpus()).not.toThrow();
  });

  test('has unique fingerprints and no full or structural reuse from any older corpus', () => {
    const oldStates = [...TETRIS_OPPORTUNITY_CORPUS_V1, ...B1_1_CHALLENGE_STATES];
    for (const descriptor of B1_PLACEMENT_PAIR_DESCRIPTORS) {
      const state = TETRIS_OPPORTUNITY_CORPUS_V1.find((candidate) => candidate.id === descriptor.stateId);
      if (state === undefined) throw new Error(`missing old B1 state ${descriptor.stateId}`);
      oldStates.push(state);
    }
    const oldFull = new Set(oldStates.map(stateFingerprint));
    const oldStructural = new Set(oldStates.map(structuralProvenanceFingerprint));
    const full = B1_2_STATES.map(stateFingerprint);
    const pair = B1_2_PAIRS.map((descriptor) => {
      const state = B1_2_STATES.find((candidate) => candidate.id === descriptor.stateId);
      if (state === undefined) throw new Error(`missing B1.2 state ${descriptor.stateId}`);
      return pairFingerprint(state, descriptor);
    });

    expect(new Set(full).size).toBe(32);
    expect(new Set(pair).size).toBe(32);
    for (const state of B1_2_STATES) {
      expect(oldFull.has(stateFingerprint(state))).toBe(false);
      expect(oldStructural.has(structuralProvenanceFingerprint(state))).toBe(false);
    }
  });

  test('materializes all 32 reviewed labels through legal SRS placements and preserves literals', () => {
    const literalSnapshot = JSON.stringify(B1_2_STATES);
    const materialized = materializeAllB1_2Pairs();
    expect(materialized).toHaveLength(32);
    for (const pair of materialized) {
      const before = summarizeTetrisWell(pair.state.board);
      const positiveAfter = summarizeTetrisWellAt(
        pair.positive.boardAfter, before.column,
      );
      const negativeAfter = summarizeTetrisWellAt(
        pair.negative.boardAfter, before.column,
      );
      const positiveMaxHeight = Math.max(...columnHeights(pair.positive.boardAfter));
      const negativeMaxHeight = Math.max(...columnHeights(pair.negative.boardAfter));
      const publicIAvailable = pair.state.current.type === 1
        || pair.state.next === 1
        || (pair.state.holdAvailable && pair.state.hold === 1)
        || (pair.state.unseenBagMask & 1) !== 0;

      expect(pair.descriptor.positiveCellKey).not.toBe(pair.descriptor.negativeCellKey);
      expect(before.column).toBe(B1_2_STATES.find(
        (state) => state.id === pair.descriptor.stateId,
      )?.targetWellColumn);
      expect([before.usableDepth, before.setupCells, before.readyRows]).not.toEqual([0, 0, 0]);
      expect(pair.positive.linesCleared).toBe(pair.negative.linesCleared);
      expect(isValidPosition(pair.positive.boardAfter, pair.positive.pending.current)).toBe(true);
      expect(isValidPosition(pair.negative.boardAfter, pair.negative.pending.current)).toBe(true);
      expect(positiveMaxHeight).toBeLessThanOrEqual(negativeMaxHeight);
      expect(compareTetrisWellSummaries(positiveAfter, before)).toBeGreaterThanOrEqual(0);
      expect(compareTetrisWellSummaries(negativeAfter, before)).toBeLessThan(0);
      if (publicIAvailable) {
        expect(hasVerticalIAccess(pair.positive.boardAfter, before.column)).toBe(true);
        expect(hasVerticalIAccess(pair.negative.boardAfter, before.column)).toBe(false);
      }
    }
    expect(JSON.stringify(B1_2_STATES)).toBe(literalSnapshot);
  });

  test('proves all eight aliases are exact old13 mirrors with nonzero lane-delta separation', () => {
    const aliases = materializeAllB1_2Pairs().filter(
      (pair) => pair.descriptor.group === 'target-lane-alias',
    );
    expect(aliases).toHaveLength(8);
    for (const pair of aliases) {
      const positive = extractB1PlacementFeatures(pair.positive);
      const negative = extractB1PlacementFeatures(pair.negative);
      expect(mirrorCellKey(pair.descriptor.positiveCellKey)).toBe(pair.descriptor.negativeCellKey);
      for (let index = 0; index < 13; index++) {
        expect(Object.is(positive[index], negative[index])).toBe(true);
        expect(positive[index] - negative[index]).toBe(0);
      }
      expect(positive.slice(13, 16).some(
        (value, index) => !Object.is(value, negative[index + 13]),
      )).toBe(true);
    }
    expect(24 - aliases.length).toBe(16);
  });

  test('discloses future I access as same-state-pair constant for every pair', () => {
    for (const pair of materializeAllB1_2Pairs()) {
      expect(futureIAccessProbability(pair.positive.pending)).toBe(
        futureIAccessProbability(pair.negative.pending),
      );
      expect(extractB1PlacementFeatures(pair.positive)[16]).toBe(
        extractB1PlacementFeatures(pair.negative)[16],
      );
    }
  });

  test('independent materializations deep-equal without sharing mutable board rows', () => {
    const first = materializeAllB1_2Pairs();
    const second = materializeAllB1_2Pairs();
    expect(first).toEqual(second);
    for (let pairIndex = 0; pairIndex < first.length; pairIndex++) {
      for (const boardName of ['boardBefore', 'boardAfter'] as const) {
        for (let row = 0; row < first[pairIndex].positive[boardName].length; row++) {
          expect(first[pairIndex].positive[boardName][row]).not.toBe(
            second[pairIndex].positive[boardName][row],
          );
          expect(first[pairIndex].negative[boardName][row]).not.toBe(
            second[pairIndex].negative[boardName][row],
          );
        }
      }
    }
  });
});
