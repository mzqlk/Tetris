import { FEATURE_COUNT } from '../src/ai/features';
import {
  totalLinesFromCounts,
  tetrisLineShare as calculateTetrisLineShare,
  type LineClearCounts,
} from '../src/ai/lineClears';
import { parseSearchDiagnostics } from '../src/ai/weights';
import {
  SCORE_RATE_OBJECTIVE,
  SEARCH_CONTRACT,
  SEARCH_METADATA,
  SEARCH_METADATA_KEYS,
  hasSearchMetadata,
  type SearchMetadata,
} from './objective';
import {
  evaluateTetrisCandidate,
  type CandidateQualification,
  type ReevaluationSummary,
} from './publication';

export interface LoggedReevaluation extends ReevaluationSummary {
  gen: number;
  weights: number[];
}

export interface ReevaluationLogEntry extends SearchMetadata {
  objective: typeof SCORE_RATE_OBJECTIVE;
  kind: 'reevaluation';
  gen: number;
  ts: number;
  schedule: SearchMetadata & {
    games: number;
    maxPieces: number;
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
  maxWorkUnits: SearchMetadata['maxWorkUnits'];
  budgetCorpus: SearchMetadata['budgetCorpus'];
  transpositionCacheEntries: SearchMetadata['transpositionCacheEntries'];
  placementCacheEntries: SearchMetadata['placementCacheEntries'];
  schedule: Omit<ReevaluationLogEntry['schedule'], 'seedStrategy'>;
  publishedBaseline: LoggedReevaluation;
  currentQualified: LoggedReevaluation | null;
  candidate: LoggedReevaluation;
  qualification: CandidateQualification;
}

const LOG_ENTRY_KEYS = [
  'objective', ...SEARCH_METADATA_KEYS, 'kind', 'gen', 'ts', 'schedule',
  'publishedBaseline', 'currentQualified', 'candidate', 'qualification',
] as const;

const SCHEDULE_KEYS = [
  'games', 'maxPieces', ...SEARCH_METADATA_KEYS, 'baseSeed', 'seedStrategy',
] as const;

const EVALUATION_KEYS = [
  'gen', 'weights', 'meanScore', 'scoreRate', 'meanLines', 'meanHeight',
  'meanClearCounts', 'tetrisLineShare', 'strategyDiagnostics',
  'searchDiagnostics', 'survivalDiagnostics',
] as const;

const QUALIFICATION_KEYS = [
  'shouldSave', 'reason', 'scoreTolerance', 'scoreQualified',
  'tetrisQualified', 'survivalQualified', 'betterThanCurrent', 'scoreDelta',
  'scoreRateDelta', 'tetrisLineShareDelta', 'pieceCapGamesDelta', 'decision',
] as const;

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const nonNegative = (value: unknown): value is number => finite(value) && value >= 0;

const integerAtLeast = (value: unknown, minimum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;

const closeEnough = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected));

function parseLineClearCounts(value: unknown): LineClearCounts | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const keys = ['singles', 'doubles', 'triples', 'tetrises'] as const;
  if (!exactKeys(raw, keys)) return null;
  if (keys.some((key) => !nonNegative(raw[key]))) return null;
  return {
    singles: raw.singles as number,
    doubles: raw.doubles as number,
    triples: raw.triples as number,
    tetrises: raw.tetrises as number,
  };
}

function parseLoggedReevaluation(
  value: unknown,
  games: number,
  maxPieces: number,
): LoggedReevaluation | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!exactKeys(raw, EVALUATION_KEYS)) return null;
  if (!integerAtLeast(raw.gen, -1) || !Array.isArray(raw.weights)
    || raw.weights.length !== FEATURE_COUNT || raw.weights.some((weight) => !finite(weight))
    || !nonNegative(raw.meanScore) || !nonNegative(raw.scoreRate)
    || !nonNegative(raw.meanLines) || !nonNegative(raw.meanHeight)
    || !nonNegative(raw.tetrisLineShare)) return null;

  const meanClearCounts = parseLineClearCounts(raw.meanClearCounts);
  if (meanClearCounts === null) return null;
  let expectedLines: number;
  let expectedTetrisShare: number;
  try {
    expectedLines = totalLinesFromCounts(meanClearCounts);
    expectedTetrisShare = calculateTetrisLineShare(meanClearCounts);
  } catch {
    return null;
  }
  if (!closeEnough(raw.meanLines, expectedLines)
    || !closeEnough(raw.tetrisLineShare, expectedTetrisShare)
    || !closeEnough(raw.scoreRate, raw.meanScore / maxPieces)) return null;

  if (typeof raw.strategyDiagnostics !== 'object' || raw.strategyDiagnostics === null
    || Array.isArray(raw.strategyDiagnostics)) return null;
  const strategy = raw.strategyDiagnostics as Record<string, unknown>;
  const strategyKeys = [
    'meanCleanWellDepth', 'meanTetrisSetupProgress', 'meanTetrisReadyRows',
  ] as const;
  if (!exactKeys(strategy, strategyKeys)
    || strategyKeys.some((key) => !nonNegative(strategy[key]) || (strategy[key] as number) > 4)) {
    return null;
  }

  if (typeof raw.survivalDiagnostics !== 'object' || raw.survivalDiagnostics === null
    || Array.isArray(raw.survivalDiagnostics)) return null;
  const survival = raw.survivalDiagnostics as Record<string, unknown>;
  if (!exactKeys(survival, ['pieceCapGames', 'gameoverGames'])
    || !integerAtLeast(survival.pieceCapGames, 0)
    || !integerAtLeast(survival.gameoverGames, 0)
    || survival.pieceCapGames > games || survival.gameoverGames > games
    || survival.pieceCapGames + survival.gameoverGames > games) return null;

  const searchDiagnostics = parseSearchDiagnostics(
    raw.searchDiagnostics,
    SEARCH_METADATA.maxWorkUnits,
  );
  if (searchDiagnostics === null) return null;

  return {
    gen: raw.gen,
    weights: (raw.weights as number[]).slice(),
    meanScore: raw.meanScore,
    scoreRate: raw.scoreRate,
    meanLines: raw.meanLines,
    meanHeight: raw.meanHeight,
    meanClearCounts,
    tetrisLineShare: raw.tetrisLineShare,
    strategyDiagnostics: {
      meanCleanWellDepth: strategy.meanCleanWellDepth as number,
      meanTetrisSetupProgress: strategy.meanTetrisSetupProgress as number,
      meanTetrisReadyRows: strategy.meanTetrisReadyRows as number,
    },
    searchDiagnostics,
    survivalDiagnostics: {
      pieceCapGames: survival.pieceCapGames,
      gameoverGames: survival.gameoverGames,
    },
  };
}

export function parseReevaluationLogEntry(payload: unknown): ReevaluationLogEntry | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const raw = payload as Record<string, unknown>;
  if (!exactKeys(raw, LOG_ENTRY_KEYS) || raw.objective !== SCORE_RATE_OBJECTIVE
    || raw.kind !== 'reevaluation' || !integerAtLeast(raw.gen, 0)
    || !integerAtLeast(raw.ts, 0) || !hasSearchMetadata(raw)) return null;

  if (typeof raw.schedule !== 'object' || raw.schedule === null
    || Array.isArray(raw.schedule)) return null;
  const schedule = raw.schedule as Record<string, unknown>;
  if (!exactKeys(schedule, SCHEDULE_KEYS) || !hasSearchMetadata(schedule)
    || !integerAtLeast(schedule.games, 1) || !integerAtLeast(schedule.maxPieces, 1)
    || !Number.isSafeInteger(schedule.baseSeed)
    || schedule.seedStrategy !== 'fixed-reevaluation-v1') return null;

  const publishedBaseline = parseLoggedReevaluation(
    raw.publishedBaseline,
    schedule.games,
    schedule.maxPieces,
  );
  const currentQualified = raw.currentQualified === null
    ? null
    : parseLoggedReevaluation(raw.currentQualified, schedule.games, schedule.maxPieces);
  const candidate = parseLoggedReevaluation(raw.candidate, schedule.games, schedule.maxPieces);
  if (publishedBaseline === null || candidate === null
    || (raw.currentQualified !== null && currentQualified === null)) return null;

  if (typeof raw.qualification !== 'object' || raw.qualification === null
    || Array.isArray(raw.qualification)) return null;
  const qualification = raw.qualification as Record<string, unknown>;
  const expectedQualification = evaluateTetrisCandidate(
    candidate,
    publishedBaseline,
    currentQualified,
  );
  if (!exactKeys(qualification, QUALIFICATION_KEYS)
    || typeof qualification.shouldSave !== 'boolean'
    || typeof qualification.scoreQualified !== 'boolean'
    || typeof qualification.tetrisQualified !== 'boolean'
    || typeof qualification.survivalQualified !== 'boolean'
    || typeof qualification.betterThanCurrent !== 'boolean'
    || typeof qualification.reason !== 'string'
    || !nonNegative(qualification.scoreTolerance)
    || !finite(qualification.scoreDelta) || !finite(qualification.scoreRateDelta)
    || !finite(qualification.tetrisLineShareDelta)
    || !finite(qualification.pieceCapGamesDelta)
    || !closeEnough(qualification.scoreTolerance, expectedQualification.scoreTolerance)
    || qualification.scoreQualified !== expectedQualification.scoreQualified
    || qualification.tetrisQualified !== expectedQualification.tetrisQualified
    || qualification.survivalQualified !== expectedQualification.survivalQualified
    || qualification.betterThanCurrent !== expectedQualification.betterThanCurrent
    || qualification.reason !== expectedQualification.reason
    || qualification.shouldSave !== expectedQualification.shouldSave
    || qualification.decision !== (qualification.shouldSave ? 'save-candidate' : 'keep-current')
    || !closeEnough(qualification.scoreDelta, candidate.meanScore - publishedBaseline.meanScore)
    || !closeEnough(qualification.scoreRateDelta, candidate.scoreRate - publishedBaseline.scoreRate)
    || !closeEnough(
      qualification.tetrisLineShareDelta,
      candidate.tetrisLineShare - publishedBaseline.tetrisLineShare,
    )
    || qualification.pieceCapGamesDelta !== candidate.survivalDiagnostics.pieceCapGames
      - publishedBaseline.survivalDiagnostics.pieceCapGames) return null;

  return {
    objective: SCORE_RATE_OBJECTIVE,
    ...SEARCH_METADATA,
    kind: 'reevaluation',
    gen: raw.gen,
    ts: raw.ts,
    schedule: {
      games: schedule.games,
      maxPieces: schedule.maxPieces,
      ...SEARCH_METADATA,
      baseSeed: schedule.baseSeed as number,
      seedStrategy: 'fixed-reevaluation-v1',
    },
    publishedBaseline,
    currentQualified,
    candidate,
    qualification: { ...qualification } as unknown as ReevaluationLogEntry['qualification'],
  };
}

const snapshot = (evaluation: LoggedReevaluation): LoggedReevaluation => ({
  ...evaluation,
  weights: evaluation.weights.slice(),
  meanClearCounts: { ...evaluation.meanClearCounts },
  strategyDiagnostics: { ...evaluation.strategyDiagnostics },
  searchDiagnostics: evaluation.searchDiagnostics === undefined
    ? undefined
    : {
      ...evaluation.searchDiagnostics,
      completedDepthHistogram: [...evaluation.searchDiagnostics.completedDepthHistogram],
    },
  survivalDiagnostics: { ...evaluation.survivalDiagnostics },
});

export function buildReevaluationLogEntry(
  args: BuildReevaluationLogEntryArgs,
): ReevaluationLogEntry {
  const entry: ReevaluationLogEntry = {
    objective: SCORE_RATE_OBJECTIVE,
    ...SEARCH_METADATA,
    kind: 'reevaluation',
    gen: args.gen,
    ts: args.ts,
    schedule: {
      ...args.schedule,
      ...SEARCH_METADATA,
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
  const parsed = parseReevaluationLogEntry(entry);
  if (parsed === null) {
    throw new Error('reevaluation payload must match the exact score-rate-v5 schema');
  }
  return parsed;
}
