import { calculateScore } from '../engine/scorer';

export interface LineClearCounts {
  singles: number;
  doubles: number;
  triples: number;
  tetrises: number;
}

export function emptyLineClearCounts(): LineClearCounts {
  return { singles: 0, doubles: 0, triples: 0, tetrises: 0 };
}

function assertClearCount(linesCleared: number): void {
  if (!Number.isInteger(linesCleared) || linesCleared < 0 || linesCleared > 4) {
    throw new Error(`linesCleared must be an integer from 0 to 4, got ${linesCleared}`);
  }
}

export function assertLineClearCounts(
  counts: LineClearCounts,
  requireIntegers: boolean,
): void {
  const names = ['singles', 'doubles', 'triples', 'tetrises'] as const;
  for (const name of names) {
    const value = counts[name];
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
    if (value < 0) throw new Error(`${name} must be non-negative`);
    if (requireIntegers && !Number.isSafeInteger(value)) {
      throw new Error(`${name} must be an integer`);
    }
  }
}

export function lineClearValue(linesCleared: number): number {
  assertClearCount(linesCleared);
  return calculateScore(linesCleared, 1) / 100;
}

export function recordLineClear(
  counts: LineClearCounts,
  linesCleared: number,
): LineClearCounts {
  assertClearCount(linesCleared);
  assertLineClearCounts(counts, true);
  if (linesCleared === 0) return { ...counts };
  const keys = ['singles', 'doubles', 'triples', 'tetrises'] as const;
  const key = keys[linesCleared - 1];
  const result = { ...counts, [key]: counts[key] + 1 };
  assertLineClearCounts(result, true);
  return result;
}

export function addLineClearCounts(
  left: LineClearCounts,
  right: LineClearCounts,
): LineClearCounts {
  assertLineClearCounts(left, false);
  assertLineClearCounts(right, false);
  const result = {
    singles: left.singles + right.singles,
    doubles: left.doubles + right.doubles,
    triples: left.triples + right.triples,
    tetrises: left.tetrises + right.tetrises,
  };
  assertLineClearCounts(result, false);
  return result;
}

export function divideLineClearCounts(
  counts: LineClearCounts,
  divisor: number,
): LineClearCounts {
  assertLineClearCounts(counts, false);
  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw new Error(`divisor must be positive, got ${divisor}`);
  }
  const result = {
    singles: counts.singles / divisor,
    doubles: counts.doubles / divisor,
    triples: counts.triples / divisor,
    tetrises: counts.tetrises / divisor,
  };
  assertLineClearCounts(result, false);
  return result;
}

export function totalLinesFromCounts(counts: LineClearCounts): number {
  assertLineClearCounts(counts, false);
  const total = counts.singles + 2 * counts.doubles + 3 * counts.triples + 4 * counts.tetrises;
  if (!Number.isFinite(total)) throw new Error('total cleared lines must be finite');
  return total;
}

export function tetrisLineShare(counts: LineClearCounts): number {
  const lines = totalLinesFromCounts(counts);
  return lines === 0 ? 0 : (4 * counts.tetrises) / lines;
}
