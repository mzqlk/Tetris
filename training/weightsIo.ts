import { FEATURE_NAMES } from '../src/ai/features';

export { normalize } from '../src/ai/weights';

/** Plain object keyed by feature name — the on-disk weights format. */
export function fromVector(v: number[]): Record<string, number> {
  if (v.length !== FEATURE_NAMES.length) {
    throw new Error(`expected ${FEATURE_NAMES.length} weights, got ${v.length}`);
  }
  return Object.fromEntries(FEATURE_NAMES.map((name, i) => [name, v[i]]));
}
