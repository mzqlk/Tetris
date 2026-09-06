import type { SerializedOpportunityState } from './tetrisOpportunityCorpus';
import {
  TETRIS_OPPORTUNITY_CORPUS_V1,
  materializeOpportunityState,
} from './tetrisOpportunityCorpus';
import { cellKey, enumeratePlacements, type Placement } from '../src/ai/placements';
import {
  lockPlacement,
} from '../src/ai/stateTransitions';
import type { B1PlacementFeatureInput } from '../src/ai/opportunityFeatures';
import type { PublicSearchState } from '../src/ai/publicState';

export const B1_PLACEMENT_PAIR_CORPUS_ID = 'b1-placement-pair-corpus-v1' as const;

export type B1PlacementPairCategory = 'strategy' | 'safety';
export type B1PlacementPairPositiveClass = 'preserve-well' | 'complete-tetris' | 'safety-only';
export type B1PlacementPairNegativeClass = 'destroy-well' | 'lower-order' | 'risky-survival';

export interface PlacementPairDescriptor {
  id: string;
  category: B1PlacementPairCategory;
  stateId: string;
  positiveCellKey: string;
  negativeCellKey: string;
  positiveClass: B1PlacementPairPositiveClass;
  negativeClass: B1PlacementPairNegativeClass;
}

export interface MaterializedPlacementPair {
  descriptor: PlacementPairDescriptor;
  state: PublicSearchState;
  positive: B1PlacementFeatureInput;
  negative: B1PlacementFeatureInput;
}

const RAW_B1_PLACEMENT_PAIR_DESCRIPTORS: readonly PlacementPairDescriptor[] = [
  { id: 'build-00', category: 'strategy', stateId: 'build-00', positiveCellKey: '169,178,179,189', negativeCellKey: '167,168,169,178', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'build-01', category: 'strategy', stateId: 'build-01', positiveCellKey: '170,171,172,180', negativeCellKey: '150,160,170,171', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'build-02', category: 'strategy', stateId: 'build-02', positiveCellKey: '167,177,178,188', negativeCellKey: '168,169,177,178', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'build-03', category: 'strategy', stateId: 'build-03', positiveCellKey: '162,171,172,181', negativeCellKey: '160,161,171,172', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'build-04', category: 'strategy', stateId: 'build-04', positiveCellKey: '177,178,187,197', negativeCellKey: '157,167,176,177', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'build-05', category: 'strategy', stateId: 'build-05', positiveCellKey: '164,165,174,175', negativeCellKey: '161,162,171,172', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'build-06', category: 'strategy', stateId: 'build-06', positiveCellKey: '175,176,177,186', negativeCellKey: '166,175,176,177', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'build-07', category: 'strategy', stateId: 'build-07', positiveCellKey: '162,172,173,183', negativeCellKey: '163,164,172,173', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'ready-00', category: 'strategy', stateId: 'ready-00', positiveCellKey: '189,199,209,219', negativeCellKey: '176,177,178,179', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'ready-01', category: 'strategy', stateId: 'ready-01', positiveCellKey: '160,170,171,180', negativeCellKey: '160,161,162,171', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'ready-02', category: 'strategy', stateId: 'ready-02', positiveCellKey: '188,198,208,218', negativeCellKey: '176,177,178,179', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'ready-03', category: 'strategy', stateId: 'ready-03', positiveCellKey: '170,171,181,191', negativeCellKey: '151,161,171,172', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'ready-04', category: 'strategy', stateId: 'ready-04', positiveCellKey: '187,197,207,217', negativeCellKey: '176,177,178,179', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'ready-05', category: 'strategy', stateId: 'ready-05', positiveCellKey: '163,172,173,182', negativeCellKey: '161,162,172,173', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'ready-06', category: 'strategy', stateId: 'ready-06', positiveCellKey: '186,196,206,216', negativeCellKey: '176,177,178,179', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'ready-07', category: 'strategy', stateId: 'ready-07', positiveCellKey: '173,174,183,193', negativeCellKey: '153,163,172,173', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'bag-hold-00', category: 'strategy', stateId: 'bag-hold-00', positiveCellKey: '168,178,179,189', negativeCellKey: '168,169,177,178', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'bag-hold-01', category: 'strategy', stateId: 'bag-hold-01', positiveCellKey: '161,170,171,180', negativeCellKey: '160,161,171,172', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'bag-hold-02', category: 'strategy', stateId: 'bag-hold-02', positiveCellKey: '188,198,208,218', negativeCellKey: '176,177,178,179', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'bag-hold-03', category: 'strategy', stateId: 'bag-hold-03', positiveCellKey: '181,191,201,211', negativeCellKey: '170,171,172,173', positiveClass: 'complete-tetris', negativeClass: 'lower-order' },
  { id: 'bag-hold-04', category: 'strategy', stateId: 'bag-hold-04', positiveCellKey: '176,177,178,187', negativeCellKey: '167,176,177,178', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'bag-hold-05', category: 'strategy', stateId: 'bag-hold-05', positiveCellKey: '161,171,172,182', negativeCellKey: '162,163,171,172', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'bag-hold-06', category: 'strategy', stateId: 'bag-hold-06', positiveCellKey: '175,176,186,196', negativeCellKey: '156,166,176,177', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'bag-hold-07', category: 'strategy', stateId: 'bag-hold-07', positiveCellKey: '173,174,183,193', negativeCellKey: '153,163,172,173', positiveClass: 'preserve-well', negativeClass: 'destroy-well' },
  { id: 'safety-00', category: 'safety', stateId: 'safety-00', positiveCellKey: '147,148,158,159', negativeCellKey: '139,148,149,158', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-01', category: 'safety', stateId: 'safety-01', positiveCellKey: '141,142,150,151', negativeCellKey: '130,140,141,151', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-02', category: 'safety', stateId: 'safety-02', positiveCellKey: '77,78,79,88', negativeCellKey: '68,77,78,79', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-03', category: 'safety', stateId: 'safety-03', positiveCellKey: '71,72,73,81', negativeCellKey: '51,61,71,72', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-04', category: 'safety', stateId: 'safety-04', positiveCellKey: '64,65,74,75', negativeCellKey: '67,68,77,78', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-05', category: 'safety', stateId: 'safety-05', positiveCellKey: '70,71,72,82', negativeCellKey: '52,62,71,72', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-06', category: 'safety', stateId: 'safety-06', positiveCellKey: '65,75,76,86', negativeCellKey: '66,67,75,76', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
  { id: 'safety-07', category: 'safety', stateId: 'safety-07', positiveCellKey: '64,73,74,83', negativeCellKey: '62,63,73,74', positiveClass: 'safety-only', negativeClass: 'risky-survival' },
];

function freezeDescriptor(descriptor: PlacementPairDescriptor): PlacementPairDescriptor {
  return Object.freeze(descriptor);
}

export function validateB1PlacementPairDescriptors(
  descriptors: readonly PlacementPairDescriptor[],
): void {
  if (descriptors.length !== 32) {
    throw new Error('b1 placement pair corpus must contain 32 descriptors');
  }

  const ids = new Set<string>();
  const stateIds = new Set<string>();
  let strategyCount = 0;
  let safetyCount = 0;

  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(`duplicate b1 placement pair id: ${descriptor.id}`);
    }
    ids.add(descriptor.id);

    if (stateIds.has(descriptor.stateId)) {
      throw new Error(`duplicate opportunity corpus state id: ${descriptor.stateId}`);
    }
    stateIds.add(descriptor.stateId);

    if (descriptor.category === 'strategy') strategyCount++;
    if (descriptor.category === 'safety') safetyCount++;

    if (descriptor.positiveCellKey === descriptor.negativeCellKey) {
      throw new Error(`pair ${descriptor.id} reuses the same placement cell key`);
    }

    const state = TETRIS_OPPORTUNITY_CORPUS_V1.find((candidate) => candidate.id === descriptor.stateId);
    if (state === undefined) {
      throw new Error(`unknown opportunity corpus state: ${descriptor.stateId}`);
    }

    if (
      descriptor.category === 'strategy'
      && !['preserve-well', 'complete-tetris'].includes(descriptor.positiveClass)
    ) {
      throw new Error(`strategy pair ${descriptor.id} must use a strategy positive class`);
    }
    if (descriptor.category === 'strategy' && !['destroy-well', 'lower-order'].includes(descriptor.negativeClass)) {
      throw new Error(`strategy pair ${descriptor.id} must use a strategy negative class`);
    }
    if (descriptor.category === 'safety' && descriptor.positiveClass !== 'safety-only') {
      throw new Error(`safety pair ${descriptor.id} must use safety-only as the positive class`);
    }
    if (descriptor.category === 'safety' && descriptor.negativeClass !== 'risky-survival') {
      throw new Error(`safety pair ${descriptor.id} must use risky-survival as the negative class`);
    }
  }

  if (strategyCount !== 24 || safetyCount !== 8) {
    throw new Error('b1 placement pair corpus must contain 24 strategy and 8 safety descriptors');
  }
}

export const B1_PLACEMENT_PAIR_DESCRIPTORS: readonly PlacementPairDescriptor[] = Object.freeze(
  RAW_B1_PLACEMENT_PAIR_DESCRIPTORS.map((descriptor) => freezeDescriptor({ ...descriptor })),
);

validateB1PlacementPairDescriptors(B1_PLACEMENT_PAIR_DESCRIPTORS);

function resolvePlacement(
  placements: readonly Placement[],
  stateId: string,
  cellKeyValue: string,
  label: 'positive' | 'negative',
): Placement {
  const placement = placements.find((candidate) => cellKey(candidate.piece) === cellKeyValue);
  if (placement === undefined) {
    throw new Error(`${stateId} ${label} placement ${cellKeyValue} is not legal`);
  }

  return placement;
}

function findReviewedState(stateId: string): SerializedOpportunityState {
  const state = TETRIS_OPPORTUNITY_CORPUS_V1.find((candidate) => candidate.id === stateId);
  if (state === undefined) {
    throw new Error(`unknown opportunity corpus state: ${stateId}`);
  }

  return state;
}

export function materializePlacementPair(
  descriptor: PlacementPairDescriptor,
): MaterializedPlacementPair {
  const reviewedState = findReviewedState(descriptor.stateId);
  const rowsSnapshot = [...reviewedState.rows];
  const state = materializeOpportunityState(reviewedState);
  const placements = enumeratePlacements(state.board, state.current);
  const positive = resolvePlacement(placements, descriptor.stateId, descriptor.positiveCellKey, 'positive');
  const negative = resolvePlacement(placements, descriptor.stateId, descriptor.negativeCellKey, 'negative');

  if (descriptor.positiveCellKey === descriptor.negativeCellKey) {
    throw new Error(`pair ${descriptor.id} resolves to the same placement`);
  }

  const positiveTransition = lockPlacement(state, positive);
  const negativeTransition = lockPlacement(state, negative);

  if (reviewedState.rows.length !== rowsSnapshot.length || reviewedState.rows.some((row, index) => row !== rowsSnapshot[index])) {
    throw new Error(`opportunity corpus state ${reviewedState.id} rows were mutated`);
  }

  const positiveInput: B1PlacementFeatureInput = Object.freeze({
    boardBefore: state.board,
    ...positiveTransition,
  });
  const negativeInput: B1PlacementFeatureInput = Object.freeze({
    boardBefore: state.board,
    ...negativeTransition,
  });

  return {
    descriptor,
    state,
    positive: positiveInput,
    negative: negativeInput,
  };
}

export function materializeAllPlacementPairs(): readonly MaterializedPlacementPair[] {
  return B1_PLACEMENT_PAIR_DESCRIPTORS.map((descriptor) => materializePlacementPair(descriptor));
}
