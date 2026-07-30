import { describe, expect, it } from 'vitest';
import { shouldPublishReevaluation } from './publication';

describe('shouldPublishReevaluation', () => {
  it('prefers the tidier candidate when both re-evaluations have saturated lines', () => {
    expect(shouldPublishReevaluation(
      { score: 1995.3, meanLines: 1998.4, meanHeight: 3.10 },
      { score: 1995.5, meanLines: 1998.7, meanHeight: 3.19 },
      2000,
    )).toBe(true);
  });

  it('treats exactly 99% of the line ceiling as saturated', () => {
    expect(shouldPublishReevaluation(
      { score: 1978.8, meanLines: 1980, meanHeight: 1.2 },
      { score: 1978.9, meanLines: 1980, meanHeight: 1.3 },
      2000,
    )).toBe(true);
  });

  it('keeps the combined score ordering before both candidates saturate', () => {
    expect(shouldPublishReevaluation(
      { score: 110, meanLines: 115, meanHeight: 5 },
      { score: 111, meanLines: 116, meanHeight: 5 },
      2000,
    )).toBe(false);
  });
});
