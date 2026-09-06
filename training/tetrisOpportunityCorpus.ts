import { BOARD_WIDTH, TOTAL_ROWS } from '../src/constants';
import { assertPublicSearchState, type PublicSearchState } from '../src/ai/publicState';
import type { Piece, PieceType } from '../src/types';

export const TETRIS_OPPORTUNITY_CORPUS_ID = 'tetris-opportunity-corpus-v1' as const;

export type OpportunityStratum = 'build' | 'ready' | 'bag-hold' | 'safety';
export type OpportunityActionClass =
  | 'preserve-well'
  | 'complete-tetris'
  | 'destroy-well'
  | 'safety-only';

export interface SerializedOpportunityState {
  id: string;
  stratum: OpportunityStratum;
  rows: readonly number[];
  current: Piece;
  next: PieceType;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: number;
  targetWellColumn: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  expectedActionClass: Exclude<OpportunityActionClass, 'destroy-well'>;
}

// Explicit public snapshots for data review. A dot is empty, # is occupied,
// and each diagram is ordered from row 00 at the top to row 21 at the bottom.
// These literals must never be regenerated from a seed, RNG, or simulator.
const RAW_TETRIS_OPPORTUNITY_CORPUS_V1: readonly SerializedOpportunityState[] = [
  // build-00: 00-17 .......... | 18 #########. | 19 #########. | 20 ####.####. | 21 #########.
  { id: 'build-00', stratum: 'build', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 511, 511, 495, 511], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 7, holdAvailable: true, unseenBagMask: 40, targetWellColumn: 9, expectedActionClass: 'preserve-well' },
  // build-01: 00-17 .......... | 18 .######### | 19 .######### | 20 .####.#### | 21 .#########
  { id: 'build-01', stratum: 'build', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 990, 1022], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 2, holdAvailable: false, unseenBagMask: 20, targetWellColumn: 0, expectedActionClass: 'preserve-well' },
  // build-02: 00-17 .......... | 18 ########.# | 19 ########.# | 20 ####.###.# | 21 ########.#
  { id: 'build-02', stratum: 'build', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 767, 767, 751, 767], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: null, holdAvailable: true, unseenBagMask: 18, targetWellColumn: 8, expectedActionClass: 'preserve-well' },
  // build-03: 00-17 .......... | 18 #.######## | 19 #.######## | 20 #.####.### | 21 #.########
  { id: 'build-03', stratum: 'build', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1021, 1021, 957, 1021], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 6, holdAvailable: true, unseenBagMask: 66, targetWellColumn: 1, expectedActionClass: 'preserve-well' },
  // build-04: 00-17 .......... | 18 #######.## | 19 #######.## | 20 ###.###.## | 21 #######.##
  { id: 'build-04', stratum: 'build', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 895, 895, 887, 895], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 3, holdAvailable: false, unseenBagMask: 10, targetWellColumn: 7, expectedActionClass: 'preserve-well' },
  // build-05: 00-17 .......... | 18 ##.####### | 19 ##.####### | 20 ##.#####.# | 21 ##.#######
  { id: 'build-05', stratum: 'build', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1019, 1019, 763, 1019], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 4, holdAvailable: true, unseenBagMask: 41, targetWellColumn: 2, expectedActionClass: 'preserve-well' },
  // build-06: 00-17 .......... | 18 ######.### | 19 ######.### | 20 #.####.### | 21 ######.###
  { id: 'build-06', stratum: 'build', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 959, 959, 957, 959], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: null, holdAvailable: false, unseenBagMask: 98, targetWellColumn: 6, expectedActionClass: 'preserve-well' },
  // build-07: 00-17 .......... | 18 ###.###### | 19 ###.###### | 20 ###.###.## | 21 ###.######
  { id: 'build-07', stratum: 'build', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1015, 1015, 887, 1015], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 5, holdAvailable: true, unseenBagMask: 96, targetWellColumn: 3, expectedActionClass: 'preserve-well' },

  // ready-00: 00-17 .......... | 18 #########. | 19 #########. | 20 #########. | 21 #########.
  { id: 'ready-00', stratum: 'ready', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 511, 511, 511, 511], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 6, holdAvailable: true, unseenBagMask: 92, targetWellColumn: 9, expectedActionClass: 'complete-tetris' },
  // ready-01: 00-17 .......... | 18 .######### | 19 .######### | 20 .######### | 21 .#########
  { id: 'ready-01', stratum: 'ready', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1022, 1022], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 1, holdAvailable: true, unseenBagMask: 50, targetWellColumn: 0, expectedActionClass: 'complete-tetris' },
  // ready-02: 00-17 .......... | 18 ########.# | 19 ########.# | 20 ########.# | 21 ########.#
  { id: 'ready-02', stratum: 'ready', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 767, 767, 767, 767], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: null, holdAvailable: true, unseenBagMask: 108, targetWellColumn: 8, expectedActionClass: 'complete-tetris' },
  // ready-03: 00-17 .......... | 18 #.######## | 19 #.######## | 20 #.######## | 21 #.########
  { id: 'ready-03', stratum: 'ready', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1021, 1021, 1021, 1021], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 1, holdAvailable: true, unseenBagMask: 44, targetWellColumn: 1, expectedActionClass: 'complete-tetris' },
  // ready-04: 00-17 .......... | 18 #######.## | 19 #######.## | 20 #######.## | 21 #######.##
  { id: 'ready-04', stratum: 'ready', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 895, 895, 895, 895], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 2, holdAvailable: false, unseenBagMask: 112, targetWellColumn: 7, expectedActionClass: 'complete-tetris' },
  // ready-05: 00-17 .......... | 18 ##.####### | 19 ##.####### | 20 ##.####### | 21 ##.#######
  { id: 'ready-05', stratum: 'ready', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1019, 1019, 1019, 1019], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: true, unseenBagMask: 14, targetWellColumn: 2, expectedActionClass: 'complete-tetris' },
  // ready-06: 00-17 .......... | 18 ######.### | 19 ######.### | 20 ######.### | 21 ######.###
  { id: 'ready-06', stratum: 'ready', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 959, 959, 959, 959], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 7, holdAvailable: true, unseenBagMask: 58, targetWellColumn: 6, expectedActionClass: 'complete-tetris' },
  // ready-07: 00-17 .......... | 18 ###.###### | 19 ###.###### | 20 ###.###### | 21 ###.######
  { id: 'ready-07', stratum: 'ready', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1015, 1015, 1015, 1015], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 1, holdAvailable: true, unseenBagMask: 82, targetWellColumn: 3, expectedActionClass: 'complete-tetris' },

  // bag-hold-00: 00-17 .......... | 18 #########. | 19 #########. | 20 #########. | 21 #########.
  { id: 'bag-hold-00', stratum: 'bag-hold', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 511, 511, 511, 511], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 1, holdAvailable: true, unseenBagMask: 98, targetWellColumn: 9, expectedActionClass: 'complete-tetris' },
  // bag-hold-01: 00-17 .......... | 18 .######### | 19 .######### | 20 .######### | 21 .#########
  { id: 'bag-hold-01', stratum: 'bag-hold', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1022, 1022], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 1, holdAvailable: true, unseenBagMask: 76, targetWellColumn: 0, expectedActionClass: 'complete-tetris' },
  // bag-hold-02: 00-17 .......... | 18 ########.# | 19 ########.# | 20 ########.# | 21 ########.#
  { id: 'bag-hold-02', stratum: 'bag-hold', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 767, 767, 767, 767], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: null, holdAvailable: true, unseenBagMask: 92, targetWellColumn: 8, expectedActionClass: 'complete-tetris' },
  // bag-hold-03: 00-17 .......... | 18 #.######## | 19 #.######## | 20 #.######## | 21 #.########
  { id: 'bag-hold-03', stratum: 'bag-hold', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1021, 1021, 1021, 1021], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: null, holdAvailable: false, unseenBagMask: 30, targetWellColumn: 1, expectedActionClass: 'complete-tetris' },
  // bag-hold-04: 00-17 .......... | 18 #######.## | 19 #######.## | 20 ###.###.## | 21 #######.##
  { id: 'bag-hold-04', stratum: 'bag-hold', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 895, 895, 887, 895], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 7, holdAvailable: true, unseenBagMask: 67, targetWellColumn: 7, expectedActionClass: 'preserve-well' },
  // bag-hold-05: 00-17 .......... | 18 ##.####### | 19 ##.####### | 20 ##.#####.# | 21 ##.#######
  { id: 'bag-hold-05', stratum: 'bag-hold', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1019, 1019, 763, 1019], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 6, holdAvailable: true, unseenBagMask: 81, targetWellColumn: 2, expectedActionClass: 'preserve-well' },
  // bag-hold-06: 00-17 .......... | 18 ######.### | 19 ######.### | 20 #.####.### | 21 ######.###
  { id: 'bag-hold-06', stratum: 'bag-hold', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 959, 959, 957, 959], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 2, holdAvailable: true, unseenBagMask: 0, targetWellColumn: 6, expectedActionClass: 'preserve-well' },
  // bag-hold-07: 00-17 .......... | 18 ###.###### | 19 ###.###### | 20 ###.###.## | 21 ###.######
  { id: 'bag-hold-07', stratum: 'bag-hold', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1015, 1015, 887, 1015], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 4, holdAvailable: false, unseenBagMask: 0, targetWellColumn: 3, expectedActionClass: 'preserve-well' },

  // safety-00: 00-07 .......... | 08 #......... | 09 ##........ | 10 ###....... | 11 ####...... | 12 #####..... | 13 ######.... | 14 #######... | 15 ########.. | 16 #########. | 17 #####.###. | 18 #########. | 19 ###.#####. | 20 #########. | 21 #######.#.
  { id: 'safety-00', stratum: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 479, 511, 503, 511, 383], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 6, holdAvailable: true, unseenBagMask: 76, targetWellColumn: 9, expectedActionClass: 'safety-only' },
  // safety-01: 00-07 .......... | 08 .........# | 09 ........## | 10 .......### | 11 ......#### | 12 .....##### | 13 ....###### | 14 ...####### | 15 ..######## | 16 .######### | 17 .###.##### | 18 .######### | 19 .#####.### | 20 .######### | 21 .#.#######
  { id: 'safety-01', stratum: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 512, 768, 896, 960, 992, 1008, 1016, 1020, 1022, 1006, 1022, 958, 1022, 1018], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 3, holdAvailable: false, unseenBagMask: 35, targetWellColumn: 0, expectedActionClass: 'safety-only' },
  // safety-02: 00-07 .......... | 08 ########.# | 09 ####.###.# | 10 ########.# | 11 #####.##.# | 12 ########.# | 13 #######..# | 14 ########.# | 15 ####.###.# | 16 ########.# | 17 #####.##.# | 18 ########.# | 19 #######..# | 20 ########.# | 21 ####.###.#
  { id: 'safety-02', stratum: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 767, 751, 767, 735, 767, 639, 767, 751, 767, 735, 767, 639, 767, 751], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 2, holdAvailable: true, unseenBagMask: 89, targetWellColumn: 8, expectedActionClass: 'safety-only' },
  // safety-03: 00-07 .......... | 08 #.######## | 09 #.###.#### | 10 #.######## | 11 #.#####.## | 12 #.######## | 13 #.#.###### | 14 #.######## | 15 #.###.#### | 16 #.######## | 17 #.#####.## | 18 #.######## | 19 #.#.###### | 20 #.######## | 21 #.###.####
  { id: 'safety-03', stratum: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 1021, 989, 1021, 893, 1021, 1013, 1021, 989, 1021, 893, 1021, 1013, 1021, 989], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 4, holdAvailable: true, unseenBagMask: 38, targetWellColumn: 1, expectedActionClass: 'safety-only' },
  // safety-04: 00-07 .......... | 08 #######.## | 09 ##.####.## | 10 #######.## | 11 ####.##.## | 12 #######.## | 13 #.#####.## | 14 #######.## | 15 ##.####.## | 16 #######.## | 17 ####.##.## | 18 #######.## | 19 #.#####.## | 20 #######.## | 21 ##.####.##
  { id: 'safety-04', stratum: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 895, 891, 895, 879, 895, 893, 895, 891, 895, 879, 895, 893, 895, 891], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 5, holdAvailable: false, unseenBagMask: 97, targetWellColumn: 7, expectedActionClass: 'safety-only' },
  // safety-05: 00-07 .......... | 08 ##.####### | 09 ##.###.### | 10 ##.####### | 11 ##.#####.# | 12 ##.####### | 13 ##.#.##### | 14 ##.####### | 15 ##.###.### | 16 ##.####### | 17 ##.#####.# | 18 ##.####### | 19 ##.#.##### | 20 ##.####### | 21 ##.###.###
  { id: 'safety-05', stratum: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 1019, 955, 1019, 763, 1019, 1003, 1019, 955, 1019, 763, 1019, 1003, 1019, 955], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: null, holdAvailable: true, unseenBagMask: 81, targetWellColumn: 2, expectedActionClass: 'safety-only' },
  // safety-06: 00-07 .......... | 08 ######.### | 09 ######.##. | 10 ######.### | 11 #.####.### | 12 ######.### | 13 ###.##.### | 14 ######.### | 15 ######.##. | 16 ######.### | 17 #.####.### | 18 ######.### | 19 ###.##.### | 20 ######.### | 21 ######.##.
  { id: 'safety-06', stratum: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 959, 447, 959, 957, 959, 951, 959, 447, 959, 957, 959, 951, 959, 447], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 7, holdAvailable: false, unseenBagMask: 53, targetWellColumn: 6, expectedActionClass: 'safety-only' },
  // safety-07: 00-07 .......... | 08 ###.###### | 09 .##.###### | 10 ###.###### | 11 ###.###.## | 12 ###.###### | 13 ###.#####. | 14 ###.###### | 15 .##.###### | 16 ###.###### | 17 ###.###.## | 18 ###.###### | 19 ###.#####. | 20 ###.###### | 21 .##.######
  { id: 'safety-07', stratum: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 1015, 1014, 1015, 887, 1015, 503, 1015, 1014, 1015, 887, 1015, 503, 1015, 1014], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 3, holdAvailable: true, unseenBagMask: 75, targetWellColumn: 3, expectedActionClass: 'safety-only' },
];

export const TETRIS_OPPORTUNITY_CORPUS_V1: readonly SerializedOpportunityState[] = Object.freeze(
  RAW_TETRIS_OPPORTUNITY_CORPUS_V1.map((entry) => Object.freeze({
    ...entry,
    rows: Object.freeze([...entry.rows]),
    current: Object.freeze({
      ...entry.current,
      position: Object.freeze({ ...entry.current.position }),
    }),
  })),
);

export function materializeOpportunityState(
  value: SerializedOpportunityState,
): PublicSearchState {
  if (
    value.rows.length !== TOTAL_ROWS
    || value.rows.some((row) => !Number.isInteger(row) || row < 0 || row >= (1 << BOARD_WIDTH))
  ) {
    throw new Error('opportunity corpus rows must contain 22 unsigned 10-bit masks');
  }

  const state: PublicSearchState = {
    board: value.rows.map((mask) => Array.from(
      { length: BOARD_WIDTH },
      (_, column) => (mask & (1 << column)) === 0 ? 0 : 1,
    )),
    current: {
      ...value.current,
      position: { ...value.current.position },
    },
    next: value.next,
    hold: value.hold,
    holdAvailable: value.holdAvailable,
    unseenBagMask: value.unseenBagMask,
  };
  assertPublicSearchState(state);
  return state;
}
