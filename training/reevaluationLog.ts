import { SCORE_RATE_OBJECTIVE, SEARCH_CONTRACT } from './objective';
import type {
  CandidateQualification,
  ReevaluationSummary,
} from './publication';

export interface LoggedReevaluation extends ReevaluationSummary {
  gen: number;
  weights: number[];
}

export interface ReevaluationLogEntry {
  objective: typeof SCORE_RATE_OBJECTIVE;
  searchContract: typeof SEARCH_CONTRACT;
  searchDepth: 4;
  rootBeamWidth: 64;
  childBeamWidth: 32;
  kind: 'reevaluation';
  gen: number;
  ts: number;
  schedule: {
    games: number;
    maxPieces: number;
    searchContract: typeof SEARCH_CONTRACT;
    searchDepth: 4;
    rootBeamWidth: 64;
    childBeamWidth: 32;
    baseSeed: number;
    seedStrategy: 'fixed-reevaluation-v1';
  };
  publishedBaseline: LoggedReevaluation;
  currentQualified: LoggedReevaluation | null;
  candidate: LoggedReevaluation;
  qualification: CandidateQualification & {
    scoreDelta: number;
    scoreRateDelta: number;
    tetrisLineShareDelta: number;
    pieceCapGamesDelta: number;
    decision: 'save-candidate' | 'keep-current';
  };
}

interface BuildReevaluationLogEntryArgs {
  gen: number;
  ts: number;
  searchContract: typeof SEARCH_CONTRACT;
  searchDepth: 4;
  rootBeamWidth: 64;
  childBeamWidth: 32;
  schedule: Omit<ReevaluationLogEntry['schedule'], 'seedStrategy'>;
  publishedBaseline: LoggedReevaluation;
  currentQualified: LoggedReevaluation | null;
  candidate: LoggedReevaluation;
  qualification: CandidateQualification;
}

const snapshot = (evaluation: LoggedReevaluation): LoggedReevaluation => ({
  ...evaluation,
  weights: evaluation.weights.slice(),
  meanClearCounts: { ...evaluation.meanClearCounts },
  strategyDiagnostics: { ...evaluation.strategyDiagnostics },
  survivalDiagnostics: { ...evaluation.survivalDiagnostics },
});

export function buildReevaluationLogEntry(
  args: BuildReevaluationLogEntryArgs,
): ReevaluationLogEntry {
  return {
    objective: SCORE_RATE_OBJECTIVE,
    searchContract: args.searchContract,
    searchDepth: args.searchDepth,
    rootBeamWidth: args.rootBeamWidth,
    childBeamWidth: args.childBeamWidth,
    kind: 'reevaluation',
    gen: args.gen,
    ts: args.ts,
    schedule: {
      ...args.schedule,
      seedStrategy: 'fixed-reevaluation-v1',
    },
    publishedBaseline: snapshot(args.publishedBaseline),
    currentQualified: args.currentQualified === null
      ? null
      : snapshot(args.currentQualified),
    candidate: snapshot(args.candidate),
    qualification: {
      ...args.qualification,
      scoreDelta: args.candidate.meanScore - args.publishedBaseline.meanScore,
      scoreRateDelta: args.candidate.scoreRate - args.publishedBaseline.scoreRate,
      tetrisLineShareDelta:
        args.candidate.tetrisLineShare - args.publishedBaseline.tetrisLineShare,
      pieceCapGamesDelta:
        args.candidate.survivalDiagnostics.pieceCapGames -
        args.publishedBaseline.survivalDiagnostics.pieceCapGames,
      decision: args.qualification.shouldSave ? 'save-candidate' : 'keep-current',
    },
  };
}
