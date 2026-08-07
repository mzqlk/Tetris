import { SCORE_RATE_OBJECTIVE } from './objective';
import type {
  ReevaluationDecision,
  ReevaluationDecisionReason,
  ReevaluationSummary,
} from './publication';

export interface LoggedReevaluation extends ReevaluationSummary {
  gen: number;
  weights: number[];
}

export interface ReevaluationLogEntry {
  objective: typeof SCORE_RATE_OBJECTIVE;
  kind: 'reevaluation';
  gen: number;
  ts: number;
  schedule: {
    games: number;
    maxPieces: number;
    depth: 1 | 2;
    baseSeed: number;
    seedStrategy: 'fixed-reevaluation-v1';
  };
  currentBest: LoggedReevaluation;
  candidate: LoggedReevaluation;
  comparison: {
    scoreDelta: number;
    scoreRateDelta: number;
    relativeScoreDelta: number;
    scoreTolerance: number;
    heightDelta: number;
    decision: 'publish' | 'keep-current';
    reason: ReevaluationDecisionReason;
  };
}

interface BuildReevaluationLogEntryArgs {
  gen: number;
  ts: number;
  schedule: Omit<ReevaluationLogEntry['schedule'], 'seedStrategy'>;
  currentBest: LoggedReevaluation;
  candidate: LoggedReevaluation;
  decision: ReevaluationDecision;
}

const snapshot = (evaluation: LoggedReevaluation): LoggedReevaluation => ({
  ...evaluation,
  weights: evaluation.weights.slice(),
  meanClearCounts: { ...evaluation.meanClearCounts },
});

export function buildReevaluationLogEntry(
  args: BuildReevaluationLogEntryArgs,
): ReevaluationLogEntry {
  const scoreDelta = args.candidate.meanScore - args.currentBest.meanScore;
  const scale = Math.max(
    Math.abs(args.candidate.meanScore),
    Math.abs(args.currentBest.meanScore),
  );

  return {
    objective: SCORE_RATE_OBJECTIVE,
    kind: 'reevaluation',
    gen: args.gen,
    ts: args.ts,
    schedule: {
      ...args.schedule,
      seedStrategy: 'fixed-reevaluation-v1',
    },
    currentBest: snapshot(args.currentBest),
    candidate: snapshot(args.candidate),
    comparison: {
      scoreDelta,
      scoreRateDelta: args.candidate.scoreRate - args.currentBest.scoreRate,
      relativeScoreDelta: scale === 0 ? 0 : scoreDelta / scale,
      scoreTolerance: args.decision.scoreTolerance,
      heightDelta: args.candidate.meanHeight - args.currentBest.meanHeight,
      decision: args.decision.shouldPublish ? 'publish' : 'keep-current',
      reason: args.decision.reason,
    },
  };
}
