import { BOARD_WIDTH, TOTAL_ROWS } from '../src/constants';
import { cellKey, enumeratePlacements, type Placement } from '../src/ai/placements';
import type { B1PlacementFeatureInput } from '../src/ai/opportunityFeatures';
import { assertPublicSearchState, type PublicSearchState } from '../src/ai/publicState';
import { lockPlacement } from '../src/ai/stateTransitions';
import type { PieceType } from '../src/types';
import {
  B1_2_CORPUS_ID_VALUE,
  pairFingerprint,
  stateFingerprint,
  structuralProvenanceFingerprint,
  type B1_2Manifest,
  type B1_2PairDescriptor,
  type B1_2State,
} from './featureRepresentationStructuralChallengeBuilder';

export const B1_2_CORPUS_ID = B1_2_CORPUS_ID_VALUE;

const RAW_B1_2_STATES: readonly B1_2State[] = [
  { id: 'alias-00', group: 'target-lane-alias', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 765, 765, 1023, 1023], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 1, next: 4, hold: 6, holdAvailable: true, unseenBagMask: 42 },
  { id: 'alias-01', group: 'target-lane-alias', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 717, 765, 1023, 1023], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 1, next: 7, hold: 2, holdAvailable: false, unseenBagMask: 0 },
  { id: 'alias-02', group: 'target-lane-alias', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 645, 765, 765, 1023, 1023], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 1, next: 2, hold: 4, holdAvailable: false, unseenBagMask: 42 },
  { id: 'alias-03', group: 'target-lane-alias', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 645, 717, 765, 1023, 1023], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 1, next: 5, hold: 7, holdAvailable: true, unseenBagMask: 0 },
  { id: 'alias-04', group: 'target-lane-alias', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 645, 645, 717, 765, 1023, 1023], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 1, next: 5, hold: 7, holdAvailable: false, unseenBagMask: 42 },
  { id: 'alias-05', group: 'target-lane-alias', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 717, 765, 765, 1023], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 1, next: 3, hold: 5, holdAvailable: true, unseenBagMask: 42 },
  { id: 'alias-06', group: 'target-lane-alias', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 645, 765, 765, 765, 1023], current: { type: 2, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 1, next: 6, hold: 1, holdAvailable: false, unseenBagMask: 0 },
  { id: 'alias-07', group: 'target-lane-alias', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 645, 645, 717, 765, 765, 1023], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 1, next: 2, hold: 4, holdAvailable: false, unseenBagMask: 0 },

  { id: 'lane-control-00', group: 'lane-transfer-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1023, 1023], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 4, hold: 6, holdAvailable: true, unseenBagMask: 42 },
  { id: 'lane-control-01', group: 'lane-transfer-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1023, 1023], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 7, hold: 2, holdAvailable: false, unseenBagMask: 0 },
  { id: 'lane-control-02', group: 'lane-transfer-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1022, 1022, 1023, 1023], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 7, hold: null, holdAvailable: true, unseenBagMask: 42 },
  { id: 'lane-control-03', group: 'lane-transfer-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 1022, 1022, 1023, 1023], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 7, hold: 2, holdAvailable: true, unseenBagMask: 0 },
  { id: 'lane-control-04', group: 'lane-transfer-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1022, 1023], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 4, hold: 6, holdAvailable: false, unseenBagMask: 0 },
  { id: 'lane-control-05', group: 'lane-transfer-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1022, 1022, 1022, 1023], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 7, hold: null, holdAvailable: false, unseenBagMask: 0 },
  { id: 'lane-control-06', group: 'lane-transfer-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 1022, 1022, 1022, 1023], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 7, hold: 2, holdAvailable: true, unseenBagMask: 42 },
  { id: 'lane-control-07', group: 'lane-transfer-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1022, 1023], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 7, hold: 2, holdAvailable: true, unseenBagMask: 0 },

  { id: 'i-context-00', group: 'public-i-context-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1023, 1023], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 2, hold: null, holdAvailable: true, unseenBagMask: 0 },
  { id: 'i-context-01', group: 'public-i-context-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1023, 1023], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 2, hold: null, holdAvailable: true, unseenBagMask: 2 },
  { id: 'i-context-02', group: 'public-i-context-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1023, 1023], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 2, hold: null, holdAvailable: true, unseenBagMask: 4 },
  { id: 'i-context-03', group: 'public-i-context-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1023, 1023], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 2, hold: null, holdAvailable: true, unseenBagMask: 8 },
  { id: 'i-context-04', group: 'public-i-context-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1023, 1023], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 2, hold: null, holdAvailable: true, unseenBagMask: 16 },
  { id: 'i-context-05', group: 'public-i-context-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1023, 1023], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 2, hold: null, holdAvailable: true, unseenBagMask: 32 },
  { id: 'i-context-06', group: 'public-i-context-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1023, 1023], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 2, hold: null, holdAvailable: true, unseenBagMask: 64 },
  { id: 'i-context-07', group: 'public-i-context-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1023, 1023], current: { type: 7, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 2, hold: 1, holdAvailable: false, unseenBagMask: 0 },

  { id: 'safety-control-00', group: 'safety-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1022, 1023, 1022, 1023, 1023, 1023, 1023, 1023, 1023, 1023], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 7, hold: 2, holdAvailable: true, unseenBagMask: 42 },
  { id: 'safety-control-01', group: 'safety-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1022, 1022, 1023, 1022, 1023, 1023, 1023, 1023, 1023, 1023], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 4, hold: 6, holdAvailable: false, unseenBagMask: 42 },
  { id: 'safety-control-02', group: 'safety-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1022, 1022, 1023, 1022, 1023, 1023, 1023, 1023, 1023, 1023], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 7, hold: 2, holdAvailable: true, unseenBagMask: 0 },
  { id: 'safety-control-03', group: 'safety-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1023, 1022, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 4, hold: null, holdAvailable: false, unseenBagMask: 0 },
  { id: 'safety-control-04', group: 'safety-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1022, 1022, 1023, 1022, 1023, 1023, 1023, 1023, 1023, 1023, 1023], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 7, hold: null, holdAvailable: true, unseenBagMask: 42 },
  { id: 'safety-control-05', group: 'safety-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 1022, 1023, 1022, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 4, hold: 6, holdAvailable: false, unseenBagMask: 42 },
  { id: 'safety-control-06', group: 'safety-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 1022, 1023, 1022, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023], current: { type: 6, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 7, hold: 2, holdAvailable: true, unseenBagMask: 0 },
  { id: 'safety-control-07', group: 'safety-control', rows: [0, 0, 0, 0, 0, 0, 0, 0, 1022, 1022, 1023, 1022, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1023], current: { type: 3, rotation: 0, position: { x: 3, y: 0 } }, targetWellColumn: 0, next: 4, hold: 6, holdAvailable: false, unseenBagMask: 0 },
];

const RAW_B1_2_PAIRS: readonly B1_2PairDescriptor[] = [
  { id: 'alias-00', stateId: 'alias-00', category: 'strategy', group: 'target-lane-alias', positiveCellKey: '159,168,169,179', negativeCellKey: '150,160,161,170', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'alias-01', stateId: 'alias-01', category: 'strategy', group: 'target-lane-alias', positiveCellKey: '159,168,169,179', negativeCellKey: '150,160,161,170', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'alias-02', stateId: 'alias-02', category: 'strategy', group: 'target-lane-alias', positiveCellKey: '158,159,168,169', negativeCellKey: '150,151,160,161', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'alias-03', stateId: 'alias-03', category: 'strategy', group: 'target-lane-alias', positiveCellKey: '158,159,168,169', negativeCellKey: '150,151,160,161', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'alias-04', stateId: 'alias-04', category: 'strategy', group: 'target-lane-alias', positiveCellKey: '139,148,149,159', negativeCellKey: '130,140,141,150', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'alias-05', stateId: 'alias-05', category: 'strategy', group: 'target-lane-alias', positiveCellKey: '168,169,178,179', negativeCellKey: '160,161,170,171', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'alias-06', stateId: 'alias-06', category: 'strategy', group: 'target-lane-alias', positiveCellKey: '158,159,168,169', negativeCellKey: '150,151,160,161', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'alias-07', stateId: 'alias-07', category: 'strategy', group: 'target-lane-alias', positiveCellKey: '139,148,149,159', negativeCellKey: '130,140,141,150', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },

  { id: 'lane-control-00', stateId: 'lane-control-00', category: 'strategy', group: 'lane-transfer-control', positiveCellKey: '161,162,163,172', negativeCellKey: '161,170,171,172', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'lane-control-01', stateId: 'lane-control-01', category: 'strategy', group: 'lane-transfer-control', positiveCellKey: '151,152,161,171', negativeCellKey: '151,161,170,171', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'lane-control-02', stateId: 'lane-control-02', category: 'strategy', group: 'lane-transfer-control', positiveCellKey: '141,142,151,161', negativeCellKey: '141,151,160,161', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'lane-control-03', stateId: 'lane-control-03', category: 'strategy', group: 'lane-transfer-control', positiveCellKey: '131,132,141,151', negativeCellKey: '131,141,150,151', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'lane-control-04', stateId: 'lane-control-04', category: 'strategy', group: 'lane-transfer-control', positiveCellKey: '161,162,163,172', negativeCellKey: '161,170,171,172', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'lane-control-05', stateId: 'lane-control-05', category: 'strategy', group: 'lane-transfer-control', positiveCellKey: '141,142,151,161', negativeCellKey: '141,151,160,161', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'lane-control-06', stateId: 'lane-control-06', category: 'strategy', group: 'lane-transfer-control', positiveCellKey: '131,132,141,151', negativeCellKey: '131,141,150,151', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'lane-control-07', stateId: 'lane-control-07', category: 'strategy', group: 'lane-transfer-control', positiveCellKey: '151,152,161,171', negativeCellKey: '151,161,170,171', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },

  { id: 'i-context-00', stateId: 'i-context-00', category: 'strategy', group: 'public-i-context-control', positiveCellKey: '161,162,163,171', negativeCellKey: '162,170,171,172', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'i-context-01', stateId: 'i-context-01', category: 'strategy', group: 'public-i-context-control', positiveCellKey: '161,162,163,171', negativeCellKey: '162,170,171,172', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'i-context-02', stateId: 'i-context-02', category: 'strategy', group: 'public-i-context-control', positiveCellKey: '161,162,163,171', negativeCellKey: '162,170,171,172', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'i-context-03', stateId: 'i-context-03', category: 'strategy', group: 'public-i-context-control', positiveCellKey: '161,162,163,171', negativeCellKey: '162,170,171,172', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'i-context-04', stateId: 'i-context-04', category: 'strategy', group: 'public-i-context-control', positiveCellKey: '161,162,163,171', negativeCellKey: '162,170,171,172', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'i-context-05', stateId: 'i-context-05', category: 'strategy', group: 'public-i-context-control', positiveCellKey: '161,162,163,171', negativeCellKey: '162,170,171,172', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'i-context-06', stateId: 'i-context-06', category: 'strategy', group: 'public-i-context-control', positiveCellKey: '161,162,163,171', negativeCellKey: '162,170,171,172', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },
  { id: 'i-context-07', stateId: 'i-context-07', category: 'strategy', group: 'public-i-context-control', positiveCellKey: '161,162,163,171', negativeCellKey: '162,170,171,172', positiveClass: 'preserve-target-lane', negativeClass: 'destroy-target-lane' },

  { id: 'safety-control-00', stateId: 'safety-control-00', category: 'safety', group: 'safety-control', positiveCellKey: '71,72,81,91', negativeCellKey: '71,81,90,91', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-control-01', stateId: 'safety-control-01', category: 'safety', group: 'safety-control', positiveCellKey: '81,82,83,92', negativeCellKey: '81,90,91,92', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-control-02', stateId: 'safety-control-02', category: 'safety', group: 'safety-control', positiveCellKey: '71,72,81,91', negativeCellKey: '71,81,90,91', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-control-03', stateId: 'safety-control-03', category: 'safety', group: 'safety-control', positiveCellKey: '71,72,73,82', negativeCellKey: '71,80,81,82', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-control-04', stateId: 'safety-control-04', category: 'safety', group: 'safety-control', positiveCellKey: '61,62,71,81', negativeCellKey: '61,71,80,81', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-control-05', stateId: 'safety-control-05', category: 'safety', group: 'safety-control', positiveCellKey: '61,62,63,72', negativeCellKey: '61,70,71,72', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-control-06', stateId: 'safety-control-06', category: 'safety', group: 'safety-control', positiveCellKey: '51,52,61,71', negativeCellKey: '51,61,70,71', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-control-07', stateId: 'safety-control-07', category: 'safety', group: 'safety-control', positiveCellKey: '61,62,63,72', negativeCellKey: '61,70,71,72', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
];

function freezeState(state: B1_2State): B1_2State {
  return Object.freeze({
    ...state,
    rows: Object.freeze([...state.rows]),
    current: Object.freeze({
      ...state.current,
      position: Object.freeze({ ...state.current.position }),
    }),
  });
}

export const B1_2_STATES: readonly B1_2State[] = Object.freeze(
  RAW_B1_2_STATES.map((state) => freezeState({ ...state })),
);

export const B1_2_PAIRS: readonly B1_2PairDescriptor[] = Object.freeze(
  RAW_B1_2_PAIRS.map((pair) => Object.freeze({ ...pair })),
);

function isPieceType(value: unknown): value is PieceType {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7;
}

export function validateB1_2Corpus(
  states: readonly B1_2State[] = B1_2_STATES,
  pairs: readonly B1_2PairDescriptor[] = B1_2_PAIRS,
): void {
  if (states.length !== 32 || pairs.length !== 32) {
    throw new Error('B1.2 corpus must contain exactly 32 states and 32 pairs');
  }

  const stateIds = new Set<string>();
  const stateFingerprints = new Set<string>();
  const structuralFingerprints = new Set<string>();
  const groupCounts = new Map<B1_2State['group'], number>();
  for (const state of states) {
    if (stateIds.has(state.id)) throw new Error(`duplicate B1.2 state id: ${state.id}`);
    stateIds.add(state.id);
    const full = stateFingerprint(state);
    if (stateFingerprints.has(full)) throw new Error(`duplicate B1.2 state fingerprint: ${state.id}`);
    stateFingerprints.add(full);
    structuralFingerprints.add(structuralProvenanceFingerprint(state));
    groupCounts.set(state.group, (groupCounts.get(state.group) ?? 0) + 1);
    if (state.rows.length !== TOTAL_ROWS
      || state.rows.some((row) => !Number.isInteger(row) || row < 0 || row >= (1 << BOARD_WIDTH))
      || !isPieceType(state.current.type)
      || !Number.isInteger(state.current.rotation)
      || !Number.isInteger(state.current.position.x)
      || !Number.isInteger(state.current.position.y)
      || !isPieceType(state.next)
      || (state.hold !== null && !isPieceType(state.hold))
      || typeof state.holdAvailable !== 'boolean'
      || !Number.isInteger(state.unseenBagMask)
      || state.unseenBagMask < 0
      || state.unseenBagMask > 127
      || !Number.isInteger(state.targetWellColumn)
      || state.targetWellColumn < 0
      || state.targetWellColumn >= BOARD_WIDTH) {
      throw new Error(`invalid B1.2 public state: ${state.id}`);
    }
  }

  for (const group of [
    'target-lane-alias',
    'lane-transfer-control',
    'public-i-context-control',
    'safety-control',
  ] as const) {
    if (groupCounts.get(group) !== 8) throw new Error(`B1.2 corpus must contain eight ${group} states`);
  }

  const pairIds = new Set<string>();
  const pairedStateIds = new Set<string>();
  const pairFingerprints = new Set<string>();
  for (const pair of pairs) {
    if (pairIds.has(pair.id)) throw new Error(`duplicate B1.2 pair id: ${pair.id}`);
    pairIds.add(pair.id);
    if (pairedStateIds.has(pair.stateId)) throw new Error(`duplicate B1.2 paired state: ${pair.stateId}`);
    pairedStateIds.add(pair.stateId);
    const state = states.find((candidate) => candidate.id === pair.stateId);
    if (state === undefined) throw new Error(`unknown B1.2 state: ${pair.stateId}`);
    if (pair.group !== state.group) throw new Error(`B1.2 pair ${pair.id} group mismatch`);
    if (pair.positiveCellKey === pair.negativeCellKey) throw new Error(`B1.2 pair ${pair.id} reuses one placement`);
    if (pair.category !== (pair.group === 'safety-control' ? 'safety' : 'strategy')) {
      throw new Error(`B1.2 pair ${pair.id} category mismatch`);
    }
    const fingerprint = pairFingerprint(state, pair);
    if (pairFingerprints.has(fingerprint)) throw new Error(`duplicate B1.2 pair fingerprint: ${pair.id}`);
    pairFingerprints.add(fingerprint);
  }
  if (pairedStateIds.size !== stateIds.size) throw new Error('every B1.2 state must have exactly one pair');
}

validateB1_2Corpus();

function materializeState(value: B1_2State): PublicSearchState {
  const state: PublicSearchState = {
    board: value.rows.map((mask) => Array.from(
      { length: BOARD_WIDTH },
      (_, column) => (mask & (1 << column)) === 0 ? 0 : 1,
    )),
    current: { ...value.current, position: { ...value.current.position } },
    next: value.next,
    hold: value.hold,
    holdAvailable: value.holdAvailable,
    unseenBagMask: value.unseenBagMask,
  };
  assertPublicSearchState(state);
  return state;
}

function resolvePlacement(
  placements: readonly Placement[],
  descriptor: B1_2PairDescriptor,
  key: string,
  label: 'positive' | 'negative',
): Placement {
  const placement = placements.find((candidate) => cellKey(candidate.piece) === key);
  if (placement === undefined) throw new Error(`${descriptor.id} ${label} placement ${key} is not legal`);
  return placement;
}

export interface MaterializedB1_2Pair {
  descriptor: B1_2PairDescriptor;
  state: PublicSearchState;
  positive: B1PlacementFeatureInput;
  negative: B1PlacementFeatureInput;
}

export function materializeB1_2Pair(descriptor: B1_2PairDescriptor): MaterializedB1_2Pair {
  const literalState = B1_2_STATES.find((candidate) => candidate.id === descriptor.stateId);
  if (literalState === undefined) throw new Error(`unknown B1.2 state: ${descriptor.stateId}`);
  const rowsSnapshot = [...literalState.rows];
  const state = materializeState(literalState);
  const placements = enumeratePlacements(state.board, state.current);
  const positive = resolvePlacement(placements, descriptor, descriptor.positiveCellKey, 'positive');
  const negative = resolvePlacement(placements, descriptor, descriptor.negativeCellKey, 'negative');
  const positiveTransition = lockPlacement(state, positive);
  const negativeTransition = lockPlacement(state, negative);
  if (literalState.rows.some((row, index) => row !== rowsSnapshot[index])) {
    throw new Error(`B1.2 state ${literalState.id} rows were mutated`);
  }
  return {
    descriptor,
    state,
    positive: { boardBefore: state.board, ...positiveTransition },
    negative: { boardBefore: state.board, ...negativeTransition },
  };
}

export function materializeAllB1_2Pairs(): readonly MaterializedB1_2Pair[] {
  return B1_2_PAIRS.map(materializeB1_2Pair);
}

export function projectB1_2Manifest(): B1_2Manifest {
  return {
    corpusId: B1_2_CORPUS_ID,
    states: B1_2_STATES.map((state) => ({
      ...state,
      rows: [...state.rows],
      current: { ...state.current, position: { ...state.current.position } },
    })),
    pairs: B1_2_PAIRS.map((pair) => ({ ...pair })),
  };
}
