import { BOARD_WIDTH, PIECE_MATRICES, TOTAL_ROWS } from '../constants';
import type { PieceType } from '../types';
import {
  MAX_PLACEMENT_CACHE_ENTRIES,
  MAX_TRANSPOSITION_ENTRIES,
} from './searchCache';

export type WorkUnitKind = 'placementEvaluation' | 'chanceExpansion' | 'cacheHit';

export interface WorkBudgetSnapshot {
  limit: number;
  used: number;
  placementEvaluationUnits: number;
  chanceExpansionUnits: number;
  cacheHitUnits: number;
  exhausted: boolean;
}

export class WorkBudgetLedger {
  private used = 0;
  private placementEvaluationUnits = 0;
  private chanceExpansionUnits = 0;
  private cacheHitUnits = 0;

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('work-unit limit must be a positive safe integer');
    }
  }

  tryConsume(kind: WorkUnitKind): boolean {
    if (this.used === this.limit) return false;

    this.used++;
    if (kind === 'placementEvaluation') this.placementEvaluationUnits++;
    else if (kind === 'chanceExpansion') this.chanceExpansionUnits++;
    else this.cacheHitUnits++;
    return true;
  }

  snapshot(): WorkBudgetSnapshot {
    return Object.freeze({
      limit: this.limit,
      used: this.used,
      placementEvaluationUnits: this.placementEvaluationUnits,
      chanceExpansionUnits: this.chanceExpansionUnits,
      cacheHitUnits: this.cacheHitUnits,
      exhausted: this.used === this.limit,
    });
  }
}

export interface SearchLimits {
  maxRootPlacements: number;
  maxChildPlacements: number;
  maxLockedDepth: 1 | 2 | 3 | 4;
  maxWorkUnits: number;
  transpositionCacheEntries: number;
  placementCacheEntries: number;
}

export const MAX_LEGAL_PLACEMENT_POSES = 756;

export function legalPlacementPoseUpperBound(): number {
  return Math.max(...([1, 2, 3, 4, 5, 6, 7] as PieceType[]).map((type) =>
    PIECE_MATRICES[type].reduce((sum, matrix) => {
      const cells = matrix.flatMap((row, y) =>
        row.flatMap((value, x) => value === 0 ? [] : [{ x, y }]),
      );
      const width = Math.max(...cells.map((cell) => cell.x))
        - Math.min(...cells.map((cell) => cell.x)) + 1;
      const height = Math.max(...cells.map((cell) => cell.y))
        - Math.min(...cells.map((cell) => cell.y)) + 1;
      return sum + (BOARD_WIDTH - width + 1) * (TOTAL_ROWS - height + 1);
    }, 0),
  ));
}

if (legalPlacementPoseUpperBound() !== MAX_LEGAL_PLACEMENT_POSES) {
  throw new Error('legal placement pose upper bound must remain 756');
}

export const DEPTH_ONE_REQUIRED_WORK_UNITS = MAX_LEGAL_PLACEMENT_POSES * 2;
export const SEARCH_BUDGET_CORPUS_ID = 'budget-corpus-v1' as const;

export const DETERMINISTIC_SEARCH_LIMITS: Readonly<SearchLimits> = Object.freeze({
  maxRootPlacements: 64,
  maxChildPlacements: 32,
  maxLockedDepth: 4,
  maxWorkUnits: DEPTH_ONE_REQUIRED_WORK_UNITS,
  transpositionCacheEntries: MAX_TRANSPOSITION_ENTRIES,
  placementCacheEntries: MAX_PLACEMENT_CACHE_ENTRIES,
});
