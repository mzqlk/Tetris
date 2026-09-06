import { describe, expect, it } from 'vitest';
import {
  B1_PLACEMENT_PAIR_CORPUS_ID,
  B1_PLACEMENT_PAIR_DESCRIPTORS,
  materializeAllPlacementPairs,
  materializePlacementPair,
  validateB1PlacementPairDescriptors,
} from './featureRepresentationCorpus';

describe('b1-placement-pair-corpus-v1', () => {
  it('freezes 32 public placement pairs in the reviewed category order', () => {
    expect(B1_PLACEMENT_PAIR_CORPUS_ID).toBe('b1-placement-pair-corpus-v1');
    expect(B1_PLACEMENT_PAIR_DESCRIPTORS).toHaveLength(32);
    expect(B1_PLACEMENT_PAIR_DESCRIPTORS.filter((pair) => pair.category === 'strategy')).toHaveLength(24);
    expect(B1_PLACEMENT_PAIR_DESCRIPTORS.filter((pair) => pair.category === 'safety')).toHaveLength(8);
    expect(new Set(B1_PLACEMENT_PAIR_DESCRIPTORS.map((pair) => pair.id)).size).toBe(32);
  });

  it('rejects duplicate public state ids across strategy and safety pairs', () => {
    expect(validateB1PlacementPairDescriptors).toBeTypeOf('function');
    const duplicateStateId = B1_PLACEMENT_PAIR_DESCRIPTORS.map((pair, index) => (
      index === 24
        ? { ...pair, stateId: B1_PLACEMENT_PAIR_DESCRIPTORS[0]!.stateId }
        : pair
    ));

    expect(() => validateB1PlacementPairDescriptors(duplicateStateId)).toThrow(
      'duplicate opportunity corpus state id',
    );
  });

  it('keeps only public literal fields and no runtime seed data', () => {
    for (const pair of B1_PLACEMENT_PAIR_DESCRIPTORS) {
      expect(Object.keys(pair).sort()).toEqual([
        'category',
        'id',
        'negativeCellKey',
        'negativeClass',
        'positiveCellKey',
        'positiveClass',
        'stateId',
      ]);
      expect(Object.isFrozen(pair)).toBe(true);
      expect(pair).not.toHaveProperty('bag');
      expect(pair).not.toHaveProperty('seed');
      expect(pair).not.toHaveProperty('rng');
      expect(pair).not.toHaveProperty('hiddenBagMask');
    }

    expect(JSON.stringify(B1_PLACEMENT_PAIR_DESCRIPTORS)).not.toMatch(/seed|rng|bagIndex|hidden/i);
  });

  it('materializes all 32 pairs through the real engine', () => {
    const first = materializeAllPlacementPairs();
    const second = materializeAllPlacementPairs();

    expect(first).toHaveLength(32);
    expect(first).toEqual(second);
    expect(first.map((pair) => pair.descriptor.id)).toEqual(
      B1_PLACEMENT_PAIR_DESCRIPTORS.map((pair) => pair.id),
    );

    for (const pair of first) {
      expect(Object.keys(pair).sort()).toEqual(['descriptor', 'negative', 'positive', 'state']);
      expect(Object.keys(pair.positive).sort()).toEqual([
        'boardAfter',
        'boardBefore',
        'linesCleared',
        'pending',
        'placedCells',
      ]);
      expect(Object.keys(pair.negative).sort()).toEqual([
        'boardAfter',
        'boardBefore',
        'linesCleared',
        'pending',
        'placedCells',
      ]);
      expect(pair.state).toEqual(expect.objectContaining({
        board: expect.any(Array),
        current: expect.any(Object),
        next: expect.any(Number),
        holdAvailable: expect.any(Boolean),
        unseenBagMask: expect.any(Number),
      }));
      expect([null, 1, 2, 3, 4, 5, 6, 7]).toContain(pair.state.hold);
      expect(pair.positive.boardBefore).toBe(pair.state.board);
      expect(pair.negative.boardBefore).toBe(pair.state.board);
      expect(pair.descriptor).toEqual(expect.objectContaining({
        category: expect.any(String),
        id: expect.any(String),
        negativeCellKey: expect.any(String),
        negativeClass: expect.any(String),
        positiveCellKey: expect.any(String),
        positiveClass: expect.any(String),
        stateId: expect.any(String),
      }));
    }
  });

  it('materializes one reviewed pair deterministically', () => {
    const descriptor = B1_PLACEMENT_PAIR_DESCRIPTORS[0];
    expect(materializePlacementPair(descriptor)).toEqual(materializePlacementPair(descriptor));
  });
});
