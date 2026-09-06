import type { Board } from '../types';
import {
  assertWellColumn,
  hasVerticalIBand,
  summarizeTetrisWell,
  summarizeTetrisWellAt,
  type WellColumn,
} from './tetrisStrategy';

export type TargetWellColumn = WellColumn | null;
export type BeamSource = 'score' | 'strategy' | 'both';

export interface HorizonBeamLimits {
  rootScoreSlots: number;
  rootStrategySlots: number;
  childScoreSlots: number;
  childStrategySlots: number;
}

export interface HorizonPlacementEntry<T> {
  value: T;
  enumerationIndex: number;
  immediateHeuristic: number;
  linesCleared: number;
  boardAfter: Board;
}

export interface SelectedHorizonPlacement<T> extends HorizonPlacementEntry<T> {
  beamSource: BeamSource;
  targetWellColumn: TargetWellColumn;
}

export type TargetWellActionClass = 'preserve-well' | 'complete-tetris' | 'destroy-well';

function assertTargetWellColumn(column: TargetWellColumn): void {
  if (column !== null) assertWellColumn(column);
}

function assertPositiveSlots(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} slots must be a positive safe integer`);
  }
}

function validateBeamLimits(limits: HorizonBeamLimits): void {
  assertPositiveSlots('rootScoreSlots', limits.rootScoreSlots);
  assertPositiveSlots('rootStrategySlots', limits.rootStrategySlots);
  assertPositiveSlots('childScoreSlots', limits.childScoreSlots);
  assertPositiveSlots('childStrategySlots', limits.childStrategySlots);
}

function scoreLimit(root: boolean, limits: HorizonBeamLimits): number {
  return root ? limits.rootScoreSlots : limits.childScoreSlots;
}

function strategyLimit(root: boolean, limits: HorizonBeamLimits): number {
  return root ? limits.rootStrategySlots : limits.childStrategySlots;
}

function compareScoreEntries<T>(
  left: HorizonPlacementEntry<T>,
  right: HorizonPlacementEntry<T>,
): number {
  return right.immediateHeuristic - left.immediateHeuristic
    || left.enumerationIndex - right.enumerationIndex;
}

interface StrategyCandidate<T> {
  entry: HorizonPlacementEntry<T>;
  targetWellColumn: TargetWellColumn;
  linesClearedTetris: 0 | 1;
  readyRows: number;
  setupCells: number;
  usableDepth: number;
}

function compareStrategyCandidates<T>(left: StrategyCandidate<T>, right: StrategyCandidate<T>): number {
  return right.linesClearedTetris - left.linesClearedTetris
    || right.readyRows - left.readyRows
    || right.setupCells - left.setupCells
    || right.usableDepth - left.usableDepth
    || left.entry.enumerationIndex - right.entry.enumerationIndex;
}

function compareSameColumnProgress(
  before: ReturnType<typeof summarizeTetrisWellAt>,
  after: ReturnType<typeof summarizeTetrisWellAt>,
): number {
  if (after.readyRows !== before.readyRows) return after.readyRows - before.readyRows;
  if (after.setupCells !== before.setupCells) return after.setupCells - before.setupCells;
  return after.usableDepth - before.usableDepth;
}

function selectContinuationIntent(
  boardBefore: Board,
  boardAfter: Board,
  currentIntent: WellColumn,
): TargetWellColumn {
  if (!hasVerticalIBand(boardAfter, currentIntent)) return null;
  const beforeSummary = summarizeTetrisWellAt(boardBefore, currentIntent);
  const afterSummary = summarizeTetrisWellAt(boardAfter, currentIntent);
  return compareSameColumnProgress(beforeSummary, afterSummary) >= 0 ? currentIntent : null;
}

function toStrategyCandidate<T>(
  entry: HorizonPlacementEntry<T>,
  currentIntent: TargetWellColumn,
): StrategyCandidate<T> | null {
  if (currentIntent === null) {
    if (entry.linesCleared === 4) return null;
    const summary = summarizeTetrisWell(entry.boardAfter);
    if (!hasVerticalIBand(entry.boardAfter, summary.column)) return null;
    return {
      entry,
      targetWellColumn: summary.column,
      linesClearedTetris: 0,
      readyRows: summary.readyRows,
      setupCells: summary.setupCells,
      usableDepth: summary.usableDepth,
    };
  }

  if (entry.linesCleared === 4) {
    return {
      entry,
      targetWellColumn: null,
      linesClearedTetris: 1,
      readyRows: 0,
      setupCells: 0,
      usableDepth: 0,
    };
  }

  if (!hasVerticalIBand(entry.boardAfter, currentIntent)) return null;
  const summary = summarizeTetrisWellAt(entry.boardAfter, currentIntent);
  return {
    entry,
    targetWellColumn: currentIntent,
    linesClearedTetris: 0,
    readyRows: summary.readyRows,
    setupCells: summary.setupCells,
    usableDepth: summary.usableDepth,
  };
}

export function selectHorizonPlacementBeam<T>(
  entries: readonly HorizonPlacementEntry<T>[],
  boardBefore: Board,
  root: boolean,
  currentIntent: TargetWellColumn,
  limits: HorizonBeamLimits,
): SelectedHorizonPlacement<T>[] {
  assertTargetWellColumn(currentIntent);
  validateBeamLimits(limits);

  const selectedByEnumeration = new Map<number, SelectedHorizonPlacement<T>>();

  for (const entry of [...entries].sort(compareScoreEntries).slice(0, scoreLimit(root, limits))) {
    selectedByEnumeration.set(entry.enumerationIndex, {
      ...entry,
      beamSource: 'score',
      targetWellColumn:
        currentIntent === null || entry.linesCleared === 4
          ? null
          : selectContinuationIntent(boardBefore, entry.boardAfter, currentIntent),
    });
  }

  const strategyEntries = [...entries]
    .map((entry) => toStrategyCandidate(entry, currentIntent))
    .filter((entry): entry is StrategyCandidate<T> => entry !== null)
    .sort(compareStrategyCandidates)
    .slice(0, strategyLimit(root, limits));

  for (const candidate of strategyEntries) {
    const existing = selectedByEnumeration.get(candidate.entry.enumerationIndex);
    if (existing === undefined) {
      selectedByEnumeration.set(candidate.entry.enumerationIndex, {
        ...candidate.entry,
        beamSource: 'strategy',
        targetWellColumn: candidate.targetWellColumn,
      });
      continue;
    }

    selectedByEnumeration.set(candidate.entry.enumerationIndex, {
      ...existing,
      beamSource: 'both',
      targetWellColumn:
        candidate.targetWellColumn !== null ? candidate.targetWellColumn : existing.targetWellColumn,
    });
  }

  return [...selectedByEnumeration.values()]
    .sort((left, right) => left.enumerationIndex - right.enumerationIndex);
}

export function classifyTargetWellTransition(args: {
  boardBefore: Board;
  boardAfter: Board;
  linesCleared: number;
  targetWellColumn: WellColumn;
}): TargetWellActionClass {
  const {
    boardBefore,
    boardAfter,
    linesCleared,
    targetWellColumn,
  } = args;
  assertWellColumn(targetWellColumn);

  if (linesCleared === 4) return 'complete-tetris';
  if (!hasVerticalIBand(boardBefore, targetWellColumn)) return 'destroy-well';
  if (!hasVerticalIBand(boardAfter, targetWellColumn)) return 'destroy-well';

  const beforeSummary = summarizeTetrisWellAt(boardBefore, targetWellColumn);
  const afterSummary = summarizeTetrisWellAt(boardAfter, targetWellColumn);
  return compareSameColumnProgress(beforeSummary, afterSummary) >= 0
    ? 'preserve-well'
    : 'destroy-well';
}
