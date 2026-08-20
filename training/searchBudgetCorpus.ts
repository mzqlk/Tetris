import { TOTAL_ROWS } from '../src/constants';
import type { Piece, PieceType } from '../src/types';
import { assertPublicSearchState, type PublicSearchState } from '../src/ai/publicState';

export type CorpusStratum = 'low' | 'medium' | 'high' | 'danger';

export interface SerializedBudgetState {
  id: string;
  stratum: CorpusStratum;
  rows: readonly number[];
  current: Piece;
  next: PieceType;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: number;
}

// Explicit, reviewable public snapshots. Do not regenerate these from a seed.
const RAW_BUDGET_CORPUS_V1: readonly SerializedBudgetState[] = [
  { id: 'low-00', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: null, holdAvailable: true, unseenBagMask: 0 },
  { id: 'low-01', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: false, unseenBagMask: 2 },
  { id: 'low-02', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: true, unseenBagMask: 4 },
  { id: 'low-03', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: null, holdAvailable: false, unseenBagMask: 8 },
  { id: 'low-04', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 1, hold: 3, holdAvailable: true, unseenBagMask: 16 },
  { id: 'low-05', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 4, holdAvailable: false, unseenBagMask: 32 },
  { id: 'low-06', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: null, holdAvailable: true, unseenBagMask: 64 },
  { id: 'low-07', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 6, holdAvailable: false, unseenBagMask: 1 },
  { id: 'low-08', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: true, unseenBagMask: 0 },
  { id: 'low-09', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: null, holdAvailable: false, unseenBagMask: 4 },
  { id: 'low-10', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 2, holdAvailable: true, unseenBagMask: 8 },
  { id: 'low-11', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 1, hold: 3, holdAvailable: false, unseenBagMask: 16 },
  { id: 'low-12', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: null, holdAvailable: true, unseenBagMask: 32 },
  { id: 'low-13', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 5, holdAvailable: false, unseenBagMask: 64 },
  { id: 'low-14', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 6, holdAvailable: true, unseenBagMask: 1 },
  { id: 'low-15', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: null, holdAvailable: false, unseenBagMask: 2 },
  { id: 'low-16', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: true, unseenBagMask: 0 },
  { id: 'low-17', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 2, holdAvailable: false, unseenBagMask: 8 },
  { id: 'low-18', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 1, hold: null, holdAvailable: true, unseenBagMask: 16 },
  { id: 'low-19', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 4, holdAvailable: false, unseenBagMask: 32 },
  { id: 'low-20', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 5, holdAvailable: true, unseenBagMask: 64 },
  { id: 'low-21', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: null, holdAvailable: false, unseenBagMask: 1 },
  { id: 'low-22', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: true, unseenBagMask: 2 },
  { id: 'low-23', stratum: 'low', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: false, unseenBagMask: 4 },
  { id: 'medium-00', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: null, holdAvailable: true, unseenBagMask: 0 },
  { id: 'medium-01', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: false, unseenBagMask: 2 },
  { id: 'medium-02', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: true, unseenBagMask: 4 },
  { id: 'medium-03', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: null, holdAvailable: false, unseenBagMask: 8 },
  { id: 'medium-04', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 1, hold: 3, holdAvailable: true, unseenBagMask: 16 },
  { id: 'medium-05', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 4, holdAvailable: false, unseenBagMask: 32 },
  { id: 'medium-06', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: null, holdAvailable: true, unseenBagMask: 64 },
  { id: 'medium-07', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 6, holdAvailable: false, unseenBagMask: 1 },
  { id: 'medium-08', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: true, unseenBagMask: 0 },
  { id: 'medium-09', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: null, holdAvailable: false, unseenBagMask: 4 },
  { id: 'medium-10', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 2, holdAvailable: true, unseenBagMask: 8 },
  { id: 'medium-11', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 1, hold: 3, holdAvailable: false, unseenBagMask: 16 },
  { id: 'medium-12', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: null, holdAvailable: true, unseenBagMask: 32 },
  { id: 'medium-13', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 5, holdAvailable: false, unseenBagMask: 64 },
  { id: 'medium-14', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 6, holdAvailable: true, unseenBagMask: 1 },
  { id: 'medium-15', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: null, holdAvailable: false, unseenBagMask: 2 },
  { id: 'medium-16', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: true, unseenBagMask: 0 },
  { id: 'medium-17', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 2, holdAvailable: false, unseenBagMask: 8 },
  { id: 'medium-18', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 1, hold: null, holdAvailable: true, unseenBagMask: 16 },
  { id: 'medium-19', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 4, holdAvailable: false, unseenBagMask: 32 },
  { id: 'medium-20', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 5, holdAvailable: true, unseenBagMask: 64 },
  { id: 'medium-21', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: null, holdAvailable: false, unseenBagMask: 1 },
  { id: 'medium-22', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: true, unseenBagMask: 2 },
  { id: 'medium-23', stratum: 'medium', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: false, unseenBagMask: 4 },
  { id: 'high-00', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: null, holdAvailable: true, unseenBagMask: 0 },
  { id: 'high-01', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: false, unseenBagMask: 2 },
  { id: 'high-02', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: true, unseenBagMask: 4 },
  { id: 'high-03', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: null, holdAvailable: false, unseenBagMask: 8 },
  { id: 'high-04', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 1, hold: 3, holdAvailable: true, unseenBagMask: 16 },
  { id: 'high-05', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 4, holdAvailable: false, unseenBagMask: 32 },
  { id: 'high-06', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: null, holdAvailable: true, unseenBagMask: 64 },
  { id: 'high-07', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 6, holdAvailable: false, unseenBagMask: 1 },
  { id: 'high-08', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: true, unseenBagMask: 0 },
  { id: 'high-09', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: null, holdAvailable: false, unseenBagMask: 4 },
  { id: 'high-10', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 2, holdAvailable: true, unseenBagMask: 8 },
  { id: 'high-11', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 1, hold: 3, holdAvailable: false, unseenBagMask: 16 },
  { id: 'high-12', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: null, holdAvailable: true, unseenBagMask: 32 },
  { id: 'high-13', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 5, holdAvailable: false, unseenBagMask: 64 },
  { id: 'high-14', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 6, holdAvailable: true, unseenBagMask: 1 },
  { id: 'high-15', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: null, holdAvailable: false, unseenBagMask: 2 },
  { id: 'high-16', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: true, unseenBagMask: 0 },
  { id: 'high-17', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 2, holdAvailable: false, unseenBagMask: 8 },
  { id: 'high-18', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 1, hold: null, holdAvailable: true, unseenBagMask: 16 },
  { id: 'high-19', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 4, holdAvailable: false, unseenBagMask: 32 },
  { id: 'high-20', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 5, holdAvailable: true, unseenBagMask: 64 },
  { id: 'high-21', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: null, holdAvailable: false, unseenBagMask: 1 },
  { id: 'high-22', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: true, unseenBagMask: 2 },
  { id: 'high-23', stratum: 'high', rows: [0, 0, 0, 0, 0, 0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: false, unseenBagMask: 4 },
  { id: 'danger-00', stratum: 'danger', rows: [0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521, 9, 265, 73, 137, 265], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: null, holdAvailable: true, unseenBagMask: 0 },
  { id: 'danger-01', stratum: 'danger', rows: [0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19, 18, 530, 146, 274, 530], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: false, unseenBagMask: 2 },
  { id: 'danger-02', stratum: 'danger', rows: [0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38, 36, 37, 292, 548, 37], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: true, unseenBagMask: 4 },
  { id: 'danger-03', stratum: 'danger', rows: [0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521, 9, 265, 73, 137, 265], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: null, holdAvailable: false, unseenBagMask: 8 },
  { id: 'danger-04', stratum: 'danger', rows: [0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19, 18, 530, 146, 274, 530], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 1, hold: 3, holdAvailable: true, unseenBagMask: 16 },
  { id: 'danger-05', stratum: 'danger', rows: [0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38, 36, 37, 292, 548, 37], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 4, holdAvailable: false, unseenBagMask: 32 },
  { id: 'danger-06', stratum: 'danger', rows: [0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521, 9, 265, 73, 137, 265], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: null, holdAvailable: true, unseenBagMask: 64 },
  { id: 'danger-07', stratum: 'danger', rows: [0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19, 18, 530, 146, 274, 530], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 6, holdAvailable: false, unseenBagMask: 1 },
  { id: 'danger-08', stratum: 'danger', rows: [0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38, 36, 37, 292, 548, 37], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: true, unseenBagMask: 0 },
  { id: 'danger-09', stratum: 'danger', rows: [0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521, 9, 265, 73, 137, 265], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: null, holdAvailable: false, unseenBagMask: 4 },
  { id: 'danger-10', stratum: 'danger', rows: [0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19, 18, 530, 146, 274, 530], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 2, holdAvailable: true, unseenBagMask: 8 },
  { id: 'danger-11', stratum: 'danger', rows: [0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38, 36, 37, 292, 548, 37], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 1, hold: 3, holdAvailable: false, unseenBagMask: 16 },
  { id: 'danger-12', stratum: 'danger', rows: [0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521, 9, 265, 73, 137, 265], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: null, holdAvailable: true, unseenBagMask: 32 },
  { id: 'danger-13', stratum: 'danger', rows: [0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19, 18, 530, 146, 274, 530], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 5, holdAvailable: false, unseenBagMask: 64 },
  { id: 'danger-14', stratum: 'danger', rows: [0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38, 36, 37, 292, 548, 37], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 6, holdAvailable: true, unseenBagMask: 1 },
  { id: 'danger-15', stratum: 'danger', rows: [0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521, 9, 265, 73, 137, 265], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: null, holdAvailable: false, unseenBagMask: 2 },
  { id: 'danger-16', stratum: 'danger', rows: [0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19, 18, 530, 146, 274, 530], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: true, unseenBagMask: 0 },
  { id: 'danger-17', stratum: 'danger', rows: [0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38, 36, 37, 292, 548, 37], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 2, holdAvailable: false, unseenBagMask: 8 },
  { id: 'danger-18', stratum: 'danger', rows: [0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521, 9, 265, 73, 137, 265], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 1, hold: null, holdAvailable: true, unseenBagMask: 16 },
  { id: 'danger-19', stratum: 'danger', rows: [0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19, 18, 530, 146, 274, 530], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 4, holdAvailable: false, unseenBagMask: 32 },
  { id: 'danger-20', stratum: 'danger', rows: [0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38, 36, 37, 292, 548, 37], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 5, holdAvailable: true, unseenBagMask: 64 },
  { id: 'danger-21', stratum: 'danger', rows: [0, 0, 1, 513, 769, 3, 897, 129, 641, 385, 257, 65, 545, 33, 529, 17, 521, 9, 265, 73, 137, 265], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: null, holdAvailable: false, unseenBagMask: 1 },
  { id: 'danger-22', stratum: 'danger', rows: [0, 0, 2, 3, 515, 6, 771, 258, 259, 770, 514, 130, 67, 66, 35, 34, 19, 18, 530, 146, 274, 530], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: true, unseenBagMask: 2 },
  { id: 'danger-23', stratum: 'danger', rows: [0, 0, 4, 6, 7, 12, 519, 516, 518, 517, 5, 260, 134, 132, 70, 68, 38, 36, 37, 292, 548, 37], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: false, unseenBagMask: 4 }
];

export const BUDGET_CORPUS_V1: readonly SerializedBudgetState[] = Object.freeze(
  RAW_BUDGET_CORPUS_V1.map((state) => Object.freeze({
    ...state,
    rows: Object.freeze([...state.rows]),
    current: Object.freeze({
      ...state.current,
      position: Object.freeze({ ...state.current.position }),
    }),
  })),
);

export function materializeBudgetState(value: SerializedBudgetState): PublicSearchState {
  if (!Number.isInteger(value.unseenBagMask) || value.unseenBagMask < 0 || value.unseenBagMask > 0x7f) {
    throw new Error('invalid corpus bag mask');
  }
  if (value.rows.length !== TOTAL_ROWS || value.rows.some((row) => !Number.isInteger(row) || row < 0 || row >= 1024)) {
    throw new Error('corpus rows must contain 22 unsigned 10-bit masks');
  }
  const board = value.rows.map((mask) => Array.from({ length: 10 }, (_, x) => (mask & (1 << x)) !== 0 ? 1 : 0));
  const state: PublicSearchState = {
    board,
    current: { ...value.current, position: { ...value.current.position } },
    next: value.next,
    hold: value.hold,
    holdAvailable: value.holdAvailable,
    unseenBagMask: value.unseenBagMask,
  };
  assertPublicSearchState(state);
  return state;
}
