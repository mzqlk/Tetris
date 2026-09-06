import { describe, expect, it } from 'vitest';
import { HORIZON_DIAGNOSTIC_WEIGHTS } from './horizonDiagnosticWeights';

describe('horizon diagnostic postmortem vectors', () => {
  it('preserves the reviewed ids, sources, and exact 13-dimensional values', () => {
    expect(HORIZON_DIAGNOSTIC_WEIGHTS).toEqual([
      {
        id: 'published-baseline',
        source: 'checkpoint-publishedBaseline',
        weights: [
          -0.031367029399983, -0.495143825415516, 0.0793071621028899,
          -0.064800464568292, 0.148406805642361, -0.300289317086154,
          -0.554188438392129, -0.422380132844968, -0.270541828558403,
          0.269145014191284, 0, 0, 0,
        ],
      },
      {
        id: 'gen-6-best',
        source: 'generation-6-bestWeights',
        weights: [
          0.0218502033064118, -0.32193032364733, 0.240911730611772,
          0.185681209868789, -0.256836448069508, -0.446863105235042,
          -0.442665035753348, -0.432159844211585, -0.164324040989483,
          -0.184088692905663, 0.199873040803461, 0.230420019619894,
          -0.0326763798156333,
        ],
      },
      {
        id: 'gen-10-fixed',
        source: 'gen-10-reevaluation-candidate',
        weights: [
          -0.513541023663498, -0.219476966334894, -0.290560391562285,
          0.267021389649145, -0.000960449936586498, -0.189080133190787,
          -0.164840923648044, -0.495240431756198, -0.211698868222967,
          0.275489296503775, 0.203033598813738, 0.22997937389389,
          -0.0967882329751097,
        ],
      },
    ]);
  });

  it('deep-freezes three finite unit vectors', () => {
    expect(Object.isFrozen(HORIZON_DIAGNOSTIC_WEIGHTS)).toBe(true);
    expect(HORIZON_DIAGNOSTIC_WEIGHTS).toHaveLength(3);
    for (const entry of HORIZON_DIAGNOSTIC_WEIGHTS) {
      expect(entry.weights).toHaveLength(13);
      expect(entry.weights.every(Number.isFinite)).toBe(true);
      expect(Math.abs(Math.hypot(...entry.weights) - 1)).toBeLessThanOrEqual(1e-9);
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.weights)).toBe(true);
    }
  });
});
