import { BOARD_WIDTH, TOTAL_ROWS } from '../src/constants';
import { cellKey, enumeratePlacements, type Placement } from '../src/ai/placements';
import type { B1PlacementFeatureInput } from '../src/ai/opportunityFeatures';
import type { PublicSearchState } from '../src/ai/publicState';
import { assertPublicSearchState } from '../src/ai/publicState';
import { lockPlacement } from '../src/ai/stateTransitions';
import type { Piece, PieceType } from '../src/types';

export const B1_1_CHALLENGE_CORPUS_ID = 'b1-1-challenge-corpus-v1' as const;

export type ChallengeGroup =
  | 'lane-preservation'
  | 'completion-versus-lower-order'
  | 'public-i-access'
  | 'safety';

export type ChallengeCategory = 'strategy' | 'safety';
export type ChallengePositiveClass = 'preserve-well' | 'complete-tetris' | 'safety-only';
export type ChallengeNegativeClass = 'destroy-well' | 'lower-order' | 'risky-survival';

export interface ChallengeState {
  id: string;
  group: ChallengeGroup;
  rows: readonly number[];
  current: Piece;
  next: PieceType;
  hold: PieceType | null;
  holdAvailable: boolean;
  unseenBagMask: number;
  targetWellColumn: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

export interface ChallengePlacementPairDescriptor {
  id: string;
  category: ChallengeCategory;
  stateId: string;
  group: ChallengeGroup;
  positiveCellKey: string;
  negativeCellKey: string;
  positiveClass: ChallengePositiveClass;
  negativeClass: ChallengeNegativeClass;
}

export interface MaterializedChallengePlacementPair {
  descriptor: ChallengePlacementPairDescriptor;
  state: PublicSearchState;
  positive: B1PlacementFeatureInput;
  negative: B1PlacementFeatureInput;
}

// Literal public snapshots, top row first. These data intentionally contain no
// seed, random state, bag position, or non-public preview information.
const RAW_CHALLENGE_STATES: readonly ChallengeState[] = [
  { id: 'lane-00', group: 'lane-preservation', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 511, 511, 495, 511], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 7, holdAvailable: true, unseenBagMask: 40, targetWellColumn: 9 },
  { id: 'lane-01', group: 'lane-preservation', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 990, 1022], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 2, holdAvailable: false, unseenBagMask: 20, targetWellColumn: 0 },
  { id: 'lane-02', group: 'lane-preservation', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 767, 767, 751, 767], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: null, holdAvailable: true, unseenBagMask: 18, targetWellColumn: 8 },
  { id: 'lane-03', group: 'lane-preservation', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1021, 1021, 957, 1021], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 6, holdAvailable: true, unseenBagMask: 66, targetWellColumn: 1 },
  { id: 'lane-04', group: 'lane-preservation', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 895, 895, 887, 895], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 3, holdAvailable: false, unseenBagMask: 10, targetWellColumn: 7 },
  { id: 'lane-05', group: 'lane-preservation', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1019, 1019, 763, 1019], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 4, holdAvailable: true, unseenBagMask: 41, targetWellColumn: 2 },
  { id: 'lane-06', group: 'lane-preservation', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 959, 959, 957, 959], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 5, holdAvailable: false, unseenBagMask: 98, targetWellColumn: 6 },
  { id: 'lane-07', group: 'lane-preservation', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1015, 1015, 887, 1015], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 5, holdAvailable: true, unseenBagMask: 96, targetWellColumn: 3 },

  { id: 'completion-00', group: 'completion-versus-lower-order', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 511, 511, 511, 511], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 6, holdAvailable: true, unseenBagMask: 92, targetWellColumn: 9 },
  { id: 'completion-01', group: 'completion-versus-lower-order', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1022, 1022], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 3, holdAvailable: true, unseenBagMask: 50, targetWellColumn: 0 },
  { id: 'completion-02', group: 'completion-versus-lower-order', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 767, 767, 767, 767], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: null, holdAvailable: true, unseenBagMask: 108, targetWellColumn: 8 },
  { id: 'completion-03', group: 'completion-versus-lower-order', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1021, 1021, 1021, 1021], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 7, holdAvailable: true, unseenBagMask: 44, targetWellColumn: 1 },
  { id: 'completion-04', group: 'completion-versus-lower-order', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 895, 895, 895, 895], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 2, holdAvailable: false, unseenBagMask: 112, targetWellColumn: 7 },
  { id: 'completion-05', group: 'completion-versus-lower-order', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1019, 1019, 1019, 1019], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 5, holdAvailable: true, unseenBagMask: 14, targetWellColumn: 2 },
  { id: 'completion-06', group: 'completion-versus-lower-order', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 959, 959, 959, 959], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 7, holdAvailable: true, unseenBagMask: 58, targetWellColumn: 6 },
  { id: 'completion-07', group: 'completion-versus-lower-order', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1015, 1015, 1015, 1015], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 6, holdAvailable: true, unseenBagMask: 82, targetWellColumn: 3 },

  { id: 'i-access-00', group: 'public-i-access', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 511, 511, 511, 511], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 1, holdAvailable: true, unseenBagMask: 98, targetWellColumn: 9 },
  { id: 'i-access-01', group: 'public-i-access', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1022, 1022], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 1, holdAvailable: true, unseenBagMask: 76, targetWellColumn: 0 },
  { id: 'i-access-02', group: 'public-i-access', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 767, 767, 767, 767], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 1, holdAvailable: true, unseenBagMask: 92, targetWellColumn: 8 },
  { id: 'i-access-03', group: 'public-i-access', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1021, 1021, 1021, 1021], current: { type: 1, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 1, holdAvailable: true, unseenBagMask: 30, targetWellColumn: 1 },
  { id: 'i-access-04', group: 'public-i-access', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 895, 895, 887, 895], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 1, holdAvailable: true, unseenBagMask: 67, targetWellColumn: 7 },
  { id: 'i-access-05', group: 'public-i-access', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1019, 1019, 763, 1019], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 1, holdAvailable: true, unseenBagMask: 81, targetWellColumn: 2 },
  { id: 'i-access-06', group: 'public-i-access', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 959, 959, 957, 959], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: 1, holdAvailable: true, unseenBagMask: 0, targetWellColumn: 6 },
  { id: 'i-access-07', group: 'public-i-access', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1015, 1015, 887, 1015], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 1, holdAvailable: true, unseenBagMask: 0, targetWellColumn: 3 },

  { id: 'safety-00', group: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 479, 511, 503, 511, 383], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 6, holdAvailable: true, unseenBagMask: 76, targetWellColumn: 9 },
  { id: 'safety-01', group: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 512, 768, 896, 960, 992, 1008, 1016, 1020, 1022, 1006, 1022, 958, 1022, 1018], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 7, hold: 3, holdAvailable: false, unseenBagMask: 35, targetWellColumn: 0 },
  { id: 'safety-02', group: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 767, 751, 767, 735, 767, 639, 767, 751, 767, 735, 767, 639, 767, 751], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 2, holdAvailable: true, unseenBagMask: 89, targetWellColumn: 8 },
  { id: 'safety-03', group: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 1021, 989, 1021, 893, 1021, 1013, 1021, 989, 1021, 893, 1021, 1013, 1021, 989], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, next: 5, hold: 4, holdAvailable: true, unseenBagMask: 38, targetWellColumn: 1 },
  { id: 'safety-04', group: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 895, 891, 895, 879, 895, 893, 895, 891, 895, 879, 895, 893, 895, 891], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, next: 4, hold: 5, holdAvailable: false, unseenBagMask: 97, targetWellColumn: 7 },
  { id: 'safety-05', group: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 1019, 955, 1019, 763, 1019, 1003, 1019, 955, 1019, 763, 1019, 1003, 1019, 955], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, next: 3, hold: null, holdAvailable: true, unseenBagMask: 81, targetWellColumn: 2 },
  { id: 'safety-06', group: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 959, 447, 959, 957, 959, 951, 959, 447, 959, 957, 959, 951, 959, 447], current: { type: 4, rotation: 0, position: { x: 3, y: 0 } }, next: 2, hold: 7, holdAvailable: false, unseenBagMask: 53, targetWellColumn: 6 },
  { id: 'safety-07', group: 'safety', rows: [0, 0, 0, 0, 0, 0, 0, 0, 1015, 1014, 1015, 887, 1015, 503, 1015, 1014, 1015, 887, 1015, 503, 1015, 1014], current: { type: 5, rotation: 0, position: { x: 3, y: 0 } }, next: 6, hold: 3, holdAvailable: true, unseenBagMask: 75, targetWellColumn: 3 },
];

const RAW_CHALLENGE_PAIR_DESCRIPTORS: readonly ChallengePlacementPairDescriptor[] = [
  { id: 'lane-00', category: 'strategy', stateId: 'lane-00', group: 'lane-preservation', positiveCellKey: '164,173,174,175', negativeCellKey: '169,178,179,189', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'lane-01', category: 'strategy', stateId: 'lane-01', group: 'lane-preservation', positiveCellKey: '165,173,174,175', negativeCellKey: '170,171,172,180', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'lane-02', category: 'strategy', stateId: 'lane-02', group: 'lane-preservation', positiveCellKey: '164,165,173,174', negativeCellKey: '167,177,178,188', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'lane-03', category: 'strategy', stateId: 'lane-03', group: 'lane-preservation', positiveCellKey: '163,164,174,175', negativeCellKey: '162,171,172,181', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'lane-04', category: 'strategy', stateId: 'lane-04', group: 'lane-preservation', positiveCellKey: '163,173,174,175', negativeCellKey: '177,178,187,197', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'lane-05', category: 'strategy', stateId: 'lane-05', group: 'lane-preservation', positiveCellKey: '164,165,174,175', negativeCellKey: '161,162,171,172', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'lane-06', category: 'strategy', stateId: 'lane-06', group: 'lane-preservation', positiveCellKey: '164,173,174,175', negativeCellKey: '175,176,177,186', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'lane-07', category: 'strategy', stateId: 'lane-07', group: 'lane-preservation', positiveCellKey: '154,164,165,175', negativeCellKey: '162,172,173,183', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'completion-00', category: 'strategy', stateId: 'completion-00', group: 'completion-versus-lower-order', positiveCellKey: '189,199,209,219', negativeCellKey: '176,177,178,179', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'completion-01', category: 'strategy', stateId: 'completion-01', group: 'completion-versus-lower-order', positiveCellKey: '180,190,200,210', negativeCellKey: '170,171,172,173', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'completion-02', category: 'strategy', stateId: 'completion-02', group: 'completion-versus-lower-order', positiveCellKey: '188,198,208,218', negativeCellKey: '176,177,178,179', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'completion-03', category: 'strategy', stateId: 'completion-03', group: 'completion-versus-lower-order', positiveCellKey: '181,191,201,211', negativeCellKey: '170,171,172,173', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'completion-04', category: 'strategy', stateId: 'completion-04', group: 'completion-versus-lower-order', positiveCellKey: '187,197,207,217', negativeCellKey: '176,177,178,179', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'completion-05', category: 'strategy', stateId: 'completion-05', group: 'completion-versus-lower-order', positiveCellKey: '182,192,202,212', negativeCellKey: '170,171,172,173', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'completion-06', category: 'strategy', stateId: 'completion-06', group: 'completion-versus-lower-order', positiveCellKey: '186,196,206,216', negativeCellKey: '176,177,178,179', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'completion-07', category: 'strategy', stateId: 'completion-07', group: 'completion-versus-lower-order', positiveCellKey: '183,193,203,213', negativeCellKey: '170,171,172,173', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'i-access-00', category: 'strategy', stateId: 'i-access-00', group: 'public-i-access', positiveCellKey: '164,165,173,174', negativeCellKey: '168,178,179,189', positiveClass: 'preserve-well', negativeClass: 'lower-order' },
  { id: 'i-access-01', category: 'strategy', stateId: 'i-access-01', group: 'public-i-access', positiveCellKey: '163,164,174,175', negativeCellKey: '161,170,171,180', positiveClass: 'preserve-well', negativeClass: 'lower-order' },
  { id: 'i-access-02', category: 'strategy', stateId: 'i-access-02', group: 'public-i-access', positiveCellKey: '188,198,208,218', negativeCellKey: '176,177,178,179', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'i-access-03', category: 'strategy', stateId: 'i-access-03', group: 'public-i-access', positiveCellKey: '181,191,201,211', negativeCellKey: '170,171,172,173', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'i-access-04', category: 'strategy', stateId: 'i-access-04', group: 'public-i-access', positiveCellKey: '164,173,174,175', negativeCellKey: '176,177,178,187', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'i-access-05', category: 'strategy', stateId: 'i-access-05', group: 'public-i-access', positiveCellKey: '154,164,165,175', negativeCellKey: '161,171,172,182', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'i-access-06', category: 'strategy', stateId: 'i-access-06', group: 'public-i-access', positiveCellKey: '165,173,174,175', negativeCellKey: '175,176,186,196', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'i-access-07', category: 'strategy', stateId: 'i-access-07', group: 'public-i-access', positiveCellKey: '154,155,164,174', negativeCellKey: '173,174,183,193', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'safety-00', category: 'safety', stateId: 'safety-00', group: 'safety', positiveCellKey: '147,148,158,159', negativeCellKey: '139,148,149,158', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-01', category: 'safety', stateId: 'safety-01', group: 'safety', positiveCellKey: '141,142,150,151', negativeCellKey: '130,140,141,151', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-02', category: 'safety', stateId: 'safety-02', group: 'safety', positiveCellKey: '77,78,79,88', negativeCellKey: '68,77,78,79', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-03', category: 'safety', stateId: 'safety-03', group: 'safety', positiveCellKey: '71,72,73,81', negativeCellKey: '51,61,71,72', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-04', category: 'safety', stateId: 'safety-04', group: 'safety', positiveCellKey: '64,65,74,75', negativeCellKey: '67,68,77,78', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-05', category: 'safety', stateId: 'safety-05', group: 'safety', positiveCellKey: '70,71,72,82', negativeCellKey: '52,62,71,72', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-06', category: 'safety', stateId: 'safety-06', group: 'safety', positiveCellKey: '65,75,76,86', negativeCellKey: '66,67,75,76', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-07', category: 'safety', stateId: 'safety-07', group: 'safety', positiveCellKey: '64,73,74,83', negativeCellKey: '62,63,73,74', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
];

function freezeState(state: ChallengeState): ChallengeState {
  return Object.freeze({
    ...state,
    rows: Object.freeze([...state.rows]),
    current: Object.freeze({ ...state.current, position: Object.freeze({ ...state.current.position }) }),
  });
}

function freezeDescriptor(descriptor: ChallengePlacementPairDescriptor): ChallengePlacementPairDescriptor {
  return Object.freeze({ ...descriptor });
}

export const B1_1_CHALLENGE_STATES: readonly ChallengeState[] = Object.freeze(
  RAW_CHALLENGE_STATES.map(freezeState),
);

export const B1_1_CHALLENGE_PAIR_DESCRIPTORS: readonly ChallengePlacementPairDescriptor[] = Object.freeze(
  RAW_CHALLENGE_PAIR_DESCRIPTORS.map(freezeDescriptor),
);

function isPieceType(value: unknown): value is PieceType {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7;
}

function validateChallengeCorpusData(
  states: readonly ChallengeState[],
  descriptors: readonly ChallengePlacementPairDescriptor[],
): void {
  if (states.length !== 32 || descriptors.length !== 32) {
    throw new Error('challenge corpus must contain exactly 32 states and 32 descriptors');
  }

  const stateIds = new Set<string>();
  const groupCounts = new Map<ChallengeGroup, number>();
  for (const state of states) {
    if (stateIds.has(state.id)) throw new Error(`duplicate challenge state id: ${state.id}`);
    stateIds.add(state.id);
    groupCounts.set(state.group, (groupCounts.get(state.group) ?? 0) + 1);
    if (
      state.rows.length !== TOTAL_ROWS
      || state.rows.some((row) => !Number.isInteger(row) || row < 0 || row >= (1 << BOARD_WIDTH))
    ) throw new Error(`challenge state ${state.id} must contain 22 unsigned 10-bit row masks`);
    if (!isPieceType(state.current?.type) || !Number.isInteger(state.current.rotation)
      || !Number.isInteger(state.current.position?.x) || !Number.isInteger(state.current.position?.y)
      || !isPieceType(state.next) || (state.hold !== null && !isPieceType(state.hold))
      || typeof state.holdAvailable !== 'boolean'
      || (!state.holdAvailable && state.hold === null)
      || !Number.isInteger(state.unseenBagMask) || state.unseenBagMask < 0 || state.unseenBagMask > 0b1111111
      || !Number.isInteger(state.targetWellColumn) || state.targetWellColumn < 0 || state.targetWellColumn >= BOARD_WIDTH
    ) throw new Error(`challenge state ${state.id} has invalid public fields`);
  }

  for (const group of ['lane-preservation', 'completion-versus-lower-order', 'public-i-access', 'safety'] as const) {
    if (groupCounts.get(group) !== 8) throw new Error(`challenge corpus must contain eight ${group} states`);
  }

  const descriptorIds = new Set<string>();
  const descriptorStateIds = new Set<string>();
  for (const descriptor of descriptors) {
    if (descriptorIds.has(descriptor.id)) throw new Error(`duplicate challenge pair id: ${descriptor.id}`);
    descriptorIds.add(descriptor.id);
    if (descriptorStateIds.has(descriptor.stateId)) throw new Error(`duplicate challenge pair state id: ${descriptor.stateId}`);
    descriptorStateIds.add(descriptor.stateId);
    const state = states.find((candidate) => candidate.id === descriptor.stateId);
    if (state === undefined) throw new Error(`unknown challenge state: ${descriptor.stateId}`);
    if (descriptor.group !== state.group) throw new Error(`challenge pair ${descriptor.id} group does not match its state`);
    if (descriptor.positiveCellKey === descriptor.negativeCellKey) {
      throw new Error(`challenge pair ${descriptor.id} reuses the same placement cell key`);
    }
    const expected = state.group === 'lane-preservation'
      ? ['strategy', 'preserve-well', 'destroy-well']
      : state.group === 'completion-versus-lower-order'
        ? ['strategy', 'complete-tetris', 'lower-order']
        : state.group === 'public-i-access'
          ? ['strategy', undefined, undefined]
          : ['safety', 'safety-only', 'risky-survival'];
    if (descriptor.category !== expected[0]
      || (expected[1] !== undefined && descriptor.positiveClass !== expected[1])
      || (expected[2] !== undefined && descriptor.negativeClass !== expected[2])
      || (state.group === 'public-i-access'
        && (!['preserve-well', 'complete-tetris'].includes(descriptor.positiveClass)
          || !['destroy-well', 'lower-order'].includes(descriptor.negativeClass)))) {
      throw new Error(`challenge pair ${descriptor.id} has incompatible group classes`);
    }
  }
  if (descriptorStateIds.size !== stateIds.size) throw new Error('every challenge state must have one descriptor');
}

export function validateChallengeCorpus(
  states: readonly ChallengeState[] = B1_1_CHALLENGE_STATES,
  descriptors: readonly ChallengePlacementPairDescriptor[] = B1_1_CHALLENGE_PAIR_DESCRIPTORS,
): void {
  validateChallengeCorpusData(states, descriptors);
}

validateChallengeCorpus();

function materializeChallengeState(value: ChallengeState): PublicSearchState {
  const state: PublicSearchState = {
    board: value.rows.map((mask) => Array.from({ length: BOARD_WIDTH }, (_, column) => (mask & (1 << column)) === 0 ? 0 : 1)),
    current: { ...value.current, position: { ...value.current.position } },
    next: value.next,
    hold: value.hold,
    holdAvailable: value.holdAvailable,
    unseenBagMask: value.unseenBagMask,
  };
  assertPublicSearchState(state);
  return state;
}

function findState(stateId: string): ChallengeState {
  const state = B1_1_CHALLENGE_STATES.find((candidate) => candidate.id === stateId);
  if (state === undefined) throw new Error(`unknown challenge state: ${stateId}`);
  return state;
}

function resolvePlacement(
  placements: readonly Placement[], stateId: string, cellKeyValue: string, label: 'positive' | 'negative',
): Placement {
  const placement = placements.find((candidate) => cellKey(candidate.piece) === cellKeyValue);
  if (placement === undefined) throw new Error(`${stateId} ${label} placement ${cellKeyValue} is not legal`);
  return placement;
}

export function materializeChallengePlacementPair(
  descriptor: ChallengePlacementPairDescriptor,
): MaterializedChallengePlacementPair {
  const reviewedState = findState(descriptor.stateId);
  const rowsSnapshot = [...reviewedState.rows];
  const state = materializeChallengeState(reviewedState);
  const placements = enumeratePlacements(state.board, state.current);
  const positive = resolvePlacement(placements, reviewedState.id, descriptor.positiveCellKey, 'positive');
  const negative = resolvePlacement(placements, reviewedState.id, descriptor.negativeCellKey, 'negative');
  if (descriptor.positiveCellKey === descriptor.negativeCellKey) {
    throw new Error(`challenge pair ${descriptor.id} resolves to the same placement`);
  }
  const positiveTransition = lockPlacement(state, positive);
  const negativeTransition = lockPlacement(state, negative);
  if (reviewedState.rows.length !== rowsSnapshot.length || reviewedState.rows.some((row, index) => row !== rowsSnapshot[index])) {
    throw new Error(`challenge state ${reviewedState.id} rows were mutated`);
  }
  return {
    descriptor,
    state,
    positive: Object.freeze({ boardBefore: state.board, ...positiveTransition }),
    negative: Object.freeze({ boardBefore: state.board, ...negativeTransition }),
  };
}

export function materializeAllChallengePlacementPairs(): readonly MaterializedChallengePlacementPair[] {
  return B1_1_CHALLENGE_PAIR_DESCRIPTORS.map(materializeChallengePlacementPair);
}
