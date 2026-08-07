import { useEffect, useState } from 'react';
import { SCORE_RATE_OBJECTIVE } from '../../ai/trainingObjective';
import type { LogEntry } from './types';

export const LOG_URL = '/ai/score-rate-v2/training-log.jsonl';

/** Without these a line is meaningless, so it is dropped. */
const NUMBER_FIELDS = [
  'gen',
  'bestScoreRate',
  'meanScoreRate',
  'medianScoreRate',
  'worstScoreRate',
] as const;
const ARRAY_FIELDS = ['mu', 'sigma', 'bestWeights'] as const;

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * The trainer appends to this file while we read it, so a truncated final line
 * is routine rather than an error. Skip anything that does not parse.
 *
 * Fields beyond the required set are NORMALISED rather than required, because
 * the log schema grows over time — `elitePieces` was added partway through this
 * project, so a resumed run's file can legitimately contain older lines without
 * it. Rejecting those would blank the dashboard on any schema change, and
 * passing them through undefined crashes the render the moment the UI formats
 * one (`latest.maxPieces.toLocaleString()` throws on undefined). Defaulting is
 * the only option that degrades gracefully.
 */
export function parseLog(text: string): LogEntry[] {
  const entries: LogEntry[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;

    const e = value as Record<string, unknown>;
    if (NUMBER_FIELDS.some((f) => typeof e[f] !== 'number' || !Number.isFinite(e[f]))) continue;
    if (ARRAY_FIELDS.some((f) => !Array.isArray(e[f]))) continue;
    if (e.objective !== SCORE_RATE_OBJECTIVE) continue;

    entries.push({
      ...(value as LogEntry),
      objective: SCORE_RATE_OBJECTIVE,
      ts: num(e.ts, 0),
      scoreRateStd: num(e.scoreRateStd, 0),
      maxPieces: num(e.maxPieces, 0),
      medianPieces: num(e.medianPieces, 0),
      elitePieces: num(e.elitePieces, 0),
      medianScore: num(e.medianScore, 0),
      eliteScore: num(e.eliteScore, 0),
      medianLines: num(e.medianLines, 0),
      medianHeight: num(e.medianHeight, 0),
      eliteHeight: num(e.eliteHeight, 0),
      bestTetrisLineShare: num(e.bestTetrisLineShare, 0),
      medianTetrisLineShare: num(e.medianTetrisLineShare, 0),
      eliteTetrisLineShare: num(e.eliteTetrisLineShare, 0),
      gamesPerCandidate: num(e.gamesPerCandidate, 0),
      elapsedMs: num(e.elapsedMs, 0),
    });
  }

  return entries.sort((a, b) => a.gen - b.gen);
}

/**
 * Full re-fetch every poll. The log has one generation line per generation
 * plus sparse typed events such as fixed reevaluations; this parser
 * intentionally returns only generation records. Even a multi-day run is a
 * few hundred kilobytes, so an incremental protocol would be complexity with
 * nothing to buy.
 */
export function useTrainingLog(pollMs = 1000): { entries: LogEntry[]; error: string | null } {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(LOG_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = parseLog(await response.text());
        if (cancelled) return;
        setEntries(parsed);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    poll();
    const timer = window.setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollMs]);

  return { entries, error };
}
