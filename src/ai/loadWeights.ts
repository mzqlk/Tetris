import { parseWeightsFile, type WeightsFile } from './weights';

export const RUNTIME_WEIGHTS_URL = '/ai/best-weights.json';

/**
 * Try to pick up a freshly trained weights file at runtime, so retraining takes
 * effect without a rebuild. Any failure is non-fatal: the caller keeps the
 * weights bundled into the build.
 */
export async function fetchRuntimeWeights(
  url: string = RUNTIME_WEIGHTS_URL,
): Promise<WeightsFile | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;

    const parsed = parseWeightsFile(await response.json());
    if (parsed === null) {
      console.warn(`[ai] ${url} failed validation — falling back to built-in weights`);
    }
    return parsed;
  } catch {
    // No trained weights published yet; that is the normal case before training.
    return null;
  }
}
