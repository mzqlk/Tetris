export type DiagnosticWeightId = 'published-baseline' | 'gen-6-best' | 'gen-10-fixed';

export interface DiagnosticWeightSet {
  id: DiagnosticWeightId;
  source:
    | 'checkpoint-publishedBaseline'
    | 'generation-6-bestWeights'
    | 'gen-10-reevaluation-candidate';
  weights: readonly number[];
}

const PUBLISHED_BASELINE = [
  -0.031367029399983, -0.495143825415516, 0.0793071621028899,
  -0.064800464568292, 0.148406805642361, -0.300289317086154,
  -0.554188438392129, -0.422380132844968, -0.270541828558403,
  0.269145014191284, 0, 0, 0,
] as const;

const GEN_6_BEST = [
  0.0218502033064118, -0.32193032364733, 0.240911730611772,
  0.185681209868789, -0.256836448069508, -0.446863105235042,
  -0.442665035753348, -0.432159844211585, -0.164324040989483,
  -0.184088692905663, 0.199873040803461, 0.230420019619894,
  -0.0326763798156333,
] as const;

const GEN_10_FIXED = [
  -0.513541023663498, -0.219476966334894, -0.290560391562285,
  0.267021389649145, -0.000960449936586498, -0.189080133190787,
  -0.164840923648044, -0.495240431756198, -0.211698868222967,
  0.275489296503775, 0.203033598813738, 0.22997937389389,
  -0.0967882329751097,
] as const;

const RAW_HORIZON_DIAGNOSTIC_WEIGHTS: readonly DiagnosticWeightSet[] = [
  {
    id: 'published-baseline',
    source: 'checkpoint-publishedBaseline',
    weights: PUBLISHED_BASELINE,
  },
  {
    id: 'gen-6-best',
    source: 'generation-6-bestWeights',
    weights: GEN_6_BEST,
  },
  {
    id: 'gen-10-fixed',
    source: 'gen-10-reevaluation-candidate',
    weights: GEN_10_FIXED,
  },
];

export const HORIZON_DIAGNOSTIC_WEIGHTS: readonly DiagnosticWeightSet[] = Object.freeze(
  RAW_HORIZON_DIAGNOSTIC_WEIGHTS.map((entry) => Object.freeze({
    ...entry,
    weights: Object.freeze([...entry.weights]),
  })),
);
