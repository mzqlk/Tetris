import { describe, expect, test } from 'vitest';
import {
  B1_2_ALIAS_PIECES,
  B1_2_ALIAS_WELL_PAIRS,
  B1_2_BASE_HEIGHTS,
  B1_2_PUBLIC_MASKS,
  B1_2_WELL_DROPS,
  buildB1_2Manifest,
} from './featureRepresentationStructuralChallengeBuilder';
import { projectB1_2Manifest } from './featureRepresentationStructuralChallengeCorpus';

describe('B1.2 structural challenge builder', () => {
  test('replays the frozen grammar into the literal first-N manifest', () => {
    expect(B1_2_ALIAS_WELL_PAIRS).toEqual([[1, 8], [2, 7], [3, 6], [4, 5]]);
    expect(B1_2_BASE_HEIGHTS).toEqual([4, 5, 6, 7, 8, 9]);
    expect(B1_2_WELL_DROPS).toEqual([2, 3, 4]);
    expect(B1_2_ALIAS_PIECES).toEqual([1, 2, 3]);
    expect(B1_2_PUBLIC_MASKS).toEqual([0, 1, 2, 4, 8, 16, 32, 64, 127]);

    expect(JSON.stringify(buildB1_2Manifest())).toBe(JSON.stringify(projectB1_2Manifest()));
  });
});
