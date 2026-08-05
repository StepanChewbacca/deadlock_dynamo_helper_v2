import type { RecommendationBehavioralV5PropensityRow } from './recommendation-behavioral-v5-training.service';
import {
  RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
  type RecommendationDatasetV6CandidateFeatures,
  type RecommendationDatasetV6Split,
  type RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';
import {
  RECOMMENDATION_VALUE_V8_HORIZONS,
  type RecommendationValueV8CandidateSetPrediction,
  type RecommendationValueV8Horizon,
  type RecommendationValueV8HorizonValues,
} from './recommendation-value-v8-diagnostic';

export const RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION = 1;
export const RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION =
  'RECOMMENDATION_VALUE_V8_FULL_EVALUATION_1' as const;
export const RECOMMENDATION_V6_SHORT_ONLY_BASELINE_VERSION =
  'RECOMMENDATION_V6_SHORT_ONLY_DATASET_V6_BASELINE_1' as const;
export const RECOMMENDATION_V6_PRODUCTION_BASELINE_COMMIT = '251660f' as const;

const HORIZON_WEIGHTS: Record<RecommendationValueV8Horizon, number> = {
  '3m': 0.2,
  '5m': 0.3,
  '10m': 0.5,
};

export interface RecommendationV6ShortOnlyBaselineCandidate {
  actionKey: string;
  rank: number;
  actionUtility: number;
  actionAdvantage: number;
}

export interface RecommendationV6ShortOnlyBaselineRow {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION;
  baselineVersion: typeof RECOMMENDATION_V6_SHORT_ONLY_BASELINE_VERSION;
  productionCommit: typeof RECOMMENDATION_V6_PRODUCTION_BASELINE_COMMIT;
  decisionId: string;
  matchId: string;
  split: Extract<RecommendationDatasetV6Split, 'TUNING' | 'FUTURE_TEST'>;
  observedActionKey: string;
  targetUtility: number;
  stateUtility: number;
  observedActionUtility: number;
  observedActionAdvantage: number;
  candidateRanking: RecommendationV6ShortOnlyBaselineCandidate[];
  sourceModelSha256: string;
  sourceDatasetSha256: string;
  splitDescriptorSha256: string;
}

export interface RecommendationV6ShortOnlyBaselineManifest {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION;
  baselineVersion: typeof RECOMMENDATION_V6_SHORT_ONLY_BASELINE_VERSION;
  productionCommit: typeof RECOMMENDATION_V6_PRODUCTION_BASELINE_COMMIT;
  generatedAt: string;
  sourceModel: {
    modelVersion: 'RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1';
    sha256: string;
    configuration: {
      shortOnly: true;
      finalOutcomeWeight: 0;
      statePriorStrength: 10;
      actionPriorStrength: 0.1;
      minimumObservations: 10;
    };
  };
  sourceDataset: {
    datasetVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION;
    sha256: string;
    splitDescriptorSha256: string;
  };
  artifact: {
    format: 'NDJSON';
    fileName: string;
    sha256: string;
    byteLength: number;
    rowCount: number;
  };
  auditPassed: true;
  frozen: true;
}

export interface RecommendationValueV8Configuration {
  actionScale: number;
  policyTemperature: number;
}

export interface RecommendationValueV8EvaluationOptions {
  configuration: RecommendationValueV8Configuration;
  maximumImportanceWeight: number;
  cohortMinimumDecisions: number;
  criticalCohortRmseTolerance: number;
}

export interface RecommendationValueV8PolicyCandidate {
  actionKey: string;
  itemId: number;
  actionUtility: number;
  actionAdvantage: number;
  probability: number;
  rank: number;
}

export interface RecommendationValueV8DecisionEvaluation {
  decisionId: string;
  matchId: string;
  split: Extract<RecommendationDatasetV6Split, 'TUNING' | 'FUTURE_TEST'>;
  targetUtility: number;
  observedActionKey: string;
  stateUtility: number;
  observedActionUtility: number;
  observedActionAdvantage: number;
  baselineStateUtility: number;
  baselineObservedActionUtility: number;
  baselineObservedActionAdvantage: number;
  candidateSeparation: number;
  candidateCoverage: boolean;
  behaviorSupported: boolean;
  behaviorProbability: number;
  targetPolicy: RecommendationValueV8PolicyCandidate[];
  baselineTopActionKey: string;
  importanceWeights: {
    targetRaw: number;
    targetClipped: number;
    targetClippedFlag: boolean;
    baselineRaw: number;
    baselineClipped: number;
    baselineClippedFlag: boolean;
  };
  ope: {
    targetIpsContribution: number;
    baselineIpsContribution: number;
    targetDrContribution: number;
    baselineDrContribution: number;
    drUpliftContribution: number;
  };
  cohorts: Array<{
    type: 'HERO' | 'TIME_BUCKET' | 'ITEM_TIER' | 'ECONOMY_BAND';
    value: string;
  }>;
}

interface ErrorAccumulator {
  squared: number;
  absolute: number;
}

interface CohortAccumulator {
  type: 'HERO' | 'TIME_BUCKET' | 'ITEM_TIER' | 'ECONOMY_BAND';
  value: string;
  decisionCount: number;
  state: ErrorAccumulator;
  v8: ErrorAccumulator;
  baseline: ErrorAccumulator;
  drUpliftSum: number;
}

export interface RecommendationValueV8EvaluationAccumulator {
  split: Extract<RecommendationDatasetV6Split, 'TUNING' | 'FUTURE_TEST'>;
  decisionCount: number;
  candidateCount: number;
  candidateCoveredDecisionCount: number;
  behaviorSupportedDecisionCount: number;
  state: ErrorAccumulator;
  v8: ErrorAccumulator;
  baseline: ErrorAccumulator;
  separationSum: number;
  zeroSeparationDecisionCount: number;
  targetWeightSum: number;
  targetWeightSquaredSum: number;
  targetRawWeightSum: number;
  targetIpsWeightedRewardSum: number;
  targetDrSum: number;
  baselineWeightSum: number;
  baselineWeightSquaredSum: number;
  baselineIpsWeightedRewardSum: number;
  baselineDrSum: number;
  targetClippedWeightCount: number;
  baselineClippedWeightCount: number;
  matchDrUplift: Map<string, { sum: number; count: number }>;
  cohorts: Map<string, CohortAccumulator>;
}

export interface RecommendationValueV8CohortMetrics {
  type: CohortAccumulator['type'];
  value: string;
  decisionCount: number;
  major: boolean;
  stateRmse: number;
  v8Rmse: number;
  baselineRmse: number;
  stateRmseImprovement: number;
  baselineRmseImprovement: number;
  meanDrUplift: number;
  criticallyNegative: boolean;
}

export interface RecommendationValueV8EvaluationMetrics {
  split: Extract<RecommendationDatasetV6Split, 'TUNING' | 'FUTURE_TEST'>;
  decisionCount: number;
  candidateCount: number;
  candidateCoverage: number;
  behaviorSupport: number;
  stateRmse: number;
  v8Rmse: number;
  baselineRmse: number;
  stateRmseImprovement: number;
  baselineRmseImprovement: number;
  stateMae: number;
  v8Mae: number;
  baselineMae: number;
  averageCandidateSeparation: number;
  zeroSeparationRate: number;
  ope: {
    targetIps: number;
    targetSnips: number;
    targetDr: number;
    baselineIps: number;
    baselineSnips: number;
    baselineDr: number;
    drUplift: number;
    drUpliftLower95: number;
    drUpliftMatchCount: number;
    targetEss: number;
    targetEssRatio: number;
    baselineEss: number;
    baselineEssRatio: number;
    targetClippedWeightRate: number;
    baselineClippedWeightRate: number;
  };
  cohorts: RecommendationValueV8CohortMetrics[];
  criticallyNegativeMajorCohortCount: number;
}

export interface RecommendationValueV8SelectionCandidate {
  configuration: RecommendationValueV8Configuration;
  metrics: RecommendationValueV8EvaluationMetrics;
  selectionLoss: number;
  eligible: boolean;
  reasons: string[];
}

export interface RecommendationValueV8Selection {
  selected: RecommendationValueV8SelectionCandidate;
  candidates: RecommendationValueV8SelectionCandidate[];
  selectedOn: 'TUNING_ONLY';
  futureTestUsed: false;
}

export interface RecommendationValueV8ReleaseThresholds {
  minimumCandidateCoverage: number;
  minimumBehaviorSupport: number;
  minimumEssRatio: number;
  maximumClippedWeightRate: number;
  minimumStateRmseImprovement: number;
  minimumBaselineRmseImprovement: number;
  minimumCandidateSeparation: number;
  minimumDrUpliftLower95: number;
  maximumCriticallyNegativeMajorCohorts: number;
}

export const DEFAULT_RECOMMENDATION_VALUE_V8_RELEASE_THRESHOLDS:
  RecommendationValueV8ReleaseThresholds = {
    minimumCandidateCoverage: 0.99,
    minimumBehaviorSupport: 0.9,
    minimumEssRatio: 0.5,
    maximumClippedWeightRate: 0.05,
    minimumStateRmseImprovement: 0,
    minimumBaselineRmseImprovement: 0,
    minimumCandidateSeparation: 0.001,
    minimumDrUpliftLower95: 0,
    maximumCriticallyNegativeMajorCohorts: 0,
  };

export interface RecommendationValueV8ReleaseGate {
  passed: boolean;
  diagnosticGatePassed: boolean;
  thresholds: RecommendationValueV8ReleaseThresholds;
  checks: {
    diagnosticGate: boolean;
    candidateCoverage: boolean;
    behaviorSupport: boolean;
    essRatio: boolean;
    clippedWeightRate: boolean;
    stateOnlyImprovement: boolean;
    v6ShortOnlyImprovement: boolean;
    candidateSeparation: boolean;
    drUpliftLower95: boolean;
    majorCohorts: boolean;
  };
  reasons: string[];
  passiveShadowAuthorized: boolean;
  randomizedCanaryAuthorized: false;
}

export function validateRecommendationV6ShortOnlyBaselineManifest(
  manifest: RecommendationV6ShortOnlyBaselineManifest,
  expectedDatasetSha256: string,
  expectedSplitDescriptorSha256: string,
): void {
  if (
    manifest.schemaVersion !==
      RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION ||
    manifest.baselineVersion !== RECOMMENDATION_V6_SHORT_ONLY_BASELINE_VERSION ||
    manifest.productionCommit !== RECOMMENDATION_V6_PRODUCTION_BASELINE_COMMIT ||
    manifest.sourceModel.modelVersion !==
      'RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1' ||
    manifest.sourceModel.configuration.shortOnly !== true ||
    manifest.sourceModel.configuration.finalOutcomeWeight !== 0 ||
    manifest.sourceModel.configuration.statePriorStrength !== 10 ||
    manifest.sourceModel.configuration.actionPriorStrength !== 0.1 ||
    manifest.sourceModel.configuration.minimumObservations !== 10 ||
    manifest.sourceDataset.datasetVersion !==
      RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION ||
    manifest.sourceDataset.sha256 !== expectedDatasetSha256 ||
    manifest.sourceDataset.splitDescriptorSha256 !==
      expectedSplitDescriptorSha256 ||
    manifest.auditPassed !== true ||
    manifest.frozen !== true
  ) {
    throw new Error('Frozen V6 short-only baseline manifest is incompatible.');
  }
  assertSha(manifest.sourceModel.sha256, 'V6 source model SHA-256');
  assertSha(manifest.artifact.sha256, 'V6 baseline artifact SHA-256');
}

export function validateRecommendationV6ShortOnlyBaselineRow(
  baseline: RecommendationV6ShortOnlyBaselineRow,
  row: RecommendationProDecisionDatasetV6Row,
  sourceModelSha256: string,
  sourceDatasetSha256: string,
  splitDescriptorSha256: string,
): void {
  if (
    baseline.schemaVersion !==
      RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION ||
    baseline.baselineVersion !== RECOMMENDATION_V6_SHORT_ONLY_BASELINE_VERSION ||
    baseline.productionCommit !== RECOMMENDATION_V6_PRODUCTION_BASELINE_COMMIT ||
    baseline.decisionId !== row.decisionId ||
    baseline.matchId !== row.matchId ||
    baseline.split !== row.split ||
    baseline.observedActionKey !== row.observedActionKey ||
    baseline.sourceModelSha256 !== sourceModelSha256 ||
    baseline.sourceDatasetSha256 !== sourceDatasetSha256 ||
    baseline.splitDescriptorSha256 !== splitDescriptorSha256
  ) {
    throw new Error(`Frozen V6 baseline row mismatch for ${row.decisionId}.`);
  }
  if (
    !Number.isFinite(baseline.targetUtility) ||
    !Number.isFinite(baseline.stateUtility) ||
    !Number.isFinite(baseline.observedActionUtility) ||
    !Number.isFinite(baseline.observedActionAdvantage) ||
    baseline.candidateRanking.length < 2
  ) {
    throw new Error(`Frozen V6 baseline values are invalid for ${row.decisionId}.`);
  }
  const datasetActions = [...row.candidates]
    .map((candidate) => candidate.actionKey)
    .sort();
  const baselineActions = [...baseline.candidateRanking]
    .map((candidate) => candidate.actionKey)
    .sort();
  if (JSON.stringify(datasetActions) !== JSON.stringify(baselineActions)) {
    throw new Error(`Frozen V6 candidate set mismatch for ${row.decisionId}.`);
  }
  if (
    !baseline.candidateRanking.some(
      (candidate) => candidate.actionKey === row.observedActionKey,
    )
  ) {
    throw new Error(`Frozen V6 baseline lost the observed action for ${row.decisionId}.`);
  }
}

export function aggregateRecommendationValueV8Target(
  row: RecommendationProDecisionDatasetV6Row,
): number {
  const values = availableHorizonEntries(row, {
    '3m': row.shortHorizonOutcomes.threeMinutes,
    '5m': row.shortHorizonOutcomes.fiveMinutes,
    '10m': row.shortHorizonOutcomes.tenMinutes,
  });
  if (values.length === 0) {
    throw new Error(`Value V8 row ${row.decisionId} has no short-horizon target.`);
  }
  return weightedMean(values);
}

export function aggregateRecommendationValueV8Prediction(
  row: RecommendationProDecisionDatasetV6Row,
  values: RecommendationValueV8HorizonValues,
): number {
  const entries = availableHorizonEntries(row, values);
  if (entries.length === 0) {
    throw new Error(`Value V8 prediction has no target-aligned horizon for ${row.decisionId}.`);
  }
  return weightedMean(entries);
}

export function buildRecommendationValueV8TargetPolicy(
  row: RecommendationProDecisionDatasetV6Row,
  statePredictions: RecommendationValueV8HorizonValues,
  candidatePrediction: RecommendationValueV8CandidateSetPrediction,
  configuration: RecommendationValueV8Configuration,
): RecommendationValueV8PolicyCandidate[] {
  validateConfiguration(configuration);
  const stateUtility = aggregateRecommendationValueV8Prediction(
    row,
    statePredictions,
  );
  const candidates = candidatePrediction.candidates.map((candidate) => {
    const advantage = aggregateRecommendationValueV8Prediction(
      row,
      candidate.advantages,
    );
    return {
      actionKey: candidate.actionKey,
      itemId: candidate.itemId,
      actionUtility: clamp(stateUtility + configuration.actionScale * advantage, -1, 1),
      actionAdvantage: configuration.actionScale * advantage,
      probability: 0,
      rank: 0,
    };
  });
  const probabilities = softmax(
    candidates.map(
      (candidate) =>
        candidate.actionAdvantage / configuration.policyTemperature,
    ),
  );
  return candidates
    .map((candidate, index) => ({
      ...candidate,
      probability: probabilities[index],
    }))
    .sort(
      (left, right) =>
        right.probability - left.probability ||
        right.actionAdvantage - left.actionAdvantage ||
        left.actionKey.localeCompare(right.actionKey),
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

export function evaluateRecommendationValueV8Decision(input: {
  row: RecommendationProDecisionDatasetV6Row;
  propensity: RecommendationBehavioralV5PropensityRow;
  baseline: RecommendationV6ShortOnlyBaselineRow;
  statePredictions: RecommendationValueV8HorizonValues;
  candidatePrediction: RecommendationValueV8CandidateSetPrediction;
  options: RecommendationValueV8EvaluationOptions;
  sourceModelSha256: string;
  sourceDatasetSha256: string;
  splitDescriptorSha256: string;
}): RecommendationValueV8DecisionEvaluation {
  const { row, propensity, baseline, options } = input;
  if (row.split !== 'TUNING' && row.split !== 'FUTURE_TEST') {
    throw new Error('Value V8 full evaluation accepts only TUNING or FUTURE_TEST rows.');
  }
  validateEvaluationOptions(options);
  validatePropensity(propensity, row);
  validateRecommendationV6ShortOnlyBaselineRow(
    baseline,
    row,
    input.sourceModelSha256,
    input.sourceDatasetSha256,
    input.splitDescriptorSha256,
  );
  const targetUtility = aggregateRecommendationValueV8Target(row);
  if (Math.abs(targetUtility - baseline.targetUtility) > 1e-9) {
    throw new Error(`V6 target mismatch for ${row.decisionId}.`);
  }
  const targetPolicy = buildRecommendationValueV8TargetPolicy(
    row,
    input.statePredictions,
    input.candidatePrediction,
    options.configuration,
  );
  const stateUtility = aggregateRecommendationValueV8Prediction(
    row,
    input.statePredictions,
  );
  const observedTarget = targetPolicy.find(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  const observedBaseline = baseline.candidateRanking.find(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  const baselineTop = [...baseline.candidateRanking].sort(
    (left, right) =>
      left.rank - right.rank ||
      right.actionUtility - left.actionUtility ||
      left.actionKey.localeCompare(right.actionKey),
  )[0];
  if (!observedTarget || !observedBaseline || !baselineTop) {
    throw new Error(`Value V8 evaluation lost a candidate for ${row.decisionId}.`);
  }
  const behaviorProbability = propensity.observedActionProbability;
  const targetRawWeight = observedTarget.probability / behaviorProbability;
  const targetClippedWeight = Math.min(
    targetRawWeight,
    options.maximumImportanceWeight,
  );
  const baselineObservedProbability =
    baselineTop.actionKey === row.observedActionKey ? 1 : 0;
  const baselineRawWeight = baselineObservedProbability / behaviorProbability;
  const baselineClippedWeight = Math.min(
    baselineRawWeight,
    options.maximumImportanceWeight,
  );
  const targetPolicyQ = targetPolicy.reduce(
    (sum, candidate) => sum + candidate.probability * candidate.actionUtility,
    0,
  );
  const targetDr =
    targetPolicyQ +
    targetClippedWeight * (targetUtility - observedTarget.actionUtility);
  const baselineDr =
    baselineTop.actionUtility +
    baselineClippedWeight *
      (targetUtility - observedBaseline.actionUtility);
  return {
    decisionId: row.decisionId,
    matchId: row.matchId,
    split: row.split,
    targetUtility,
    observedActionKey: row.observedActionKey,
    stateUtility,
    observedActionUtility: observedTarget.actionUtility,
    observedActionAdvantage: observedTarget.actionAdvantage,
    baselineStateUtility: baseline.stateUtility,
    baselineObservedActionUtility: baseline.observedActionUtility,
    baselineObservedActionAdvantage: baseline.observedActionAdvantage,
    candidateSeparation: input.candidatePrediction.candidateSeparation,
    candidateCoverage: row.observedActionInCandidateSet,
    behaviorSupported: propensity.supported,
    behaviorProbability,
    targetPolicy,
    baselineTopActionKey: baselineTop.actionKey,
    importanceWeights: {
      targetRaw: targetRawWeight,
      targetClipped: targetClippedWeight,
      targetClippedFlag: targetClippedWeight < targetRawWeight,
      baselineRaw: baselineRawWeight,
      baselineClipped: baselineClippedWeight,
      baselineClippedFlag: baselineClippedWeight < baselineRawWeight,
    },
    ope: {
      targetIpsContribution: targetClippedWeight * targetUtility,
      baselineIpsContribution: baselineClippedWeight * targetUtility,
      targetDrContribution: targetDr,
      baselineDrContribution: baselineDr,
      drUpliftContribution: targetDr - baselineDr,
    },
    cohorts: cohortKeys(row),
  };
}

export function createRecommendationValueV8EvaluationAccumulator(
  split: Extract<RecommendationDatasetV6Split, 'TUNING' | 'FUTURE_TEST'>,
): RecommendationValueV8EvaluationAccumulator {
  return {
    split,
    decisionCount: 0,
    candidateCount: 0,
    candidateCoveredDecisionCount: 0,
    behaviorSupportedDecisionCount: 0,
    state: emptyErrors(),
    v8: emptyErrors(),
    baseline: emptyErrors(),
    separationSum: 0,
    zeroSeparationDecisionCount: 0,
    targetWeightSum: 0,
    targetWeightSquaredSum: 0,
    targetRawWeightSum: 0,
    targetIpsWeightedRewardSum: 0,
    targetDrSum: 0,
    baselineWeightSum: 0,
    baselineWeightSquaredSum: 0,
    baselineIpsWeightedRewardSum: 0,
    baselineDrSum: 0,
    targetClippedWeightCount: 0,
    baselineClippedWeightCount: 0,
    matchDrUplift: new Map(),
    cohorts: new Map(),
  };
}

export function observeRecommendationValueV8Evaluation(
  accumulator: RecommendationValueV8EvaluationAccumulator,
  evaluation: RecommendationValueV8DecisionEvaluation,
): void {
  if (evaluation.split !== accumulator.split) {
    throw new Error('Value V8 evaluation split mismatch.');
  }
  accumulator.decisionCount += 1;
  accumulator.candidateCount += evaluation.targetPolicy.length;
  accumulator.candidateCoveredDecisionCount += evaluation.candidateCoverage ? 1 : 0;
  accumulator.behaviorSupportedDecisionCount += evaluation.behaviorSupported ? 1 : 0;
  observeError(accumulator.state, evaluation.stateUtility, evaluation.targetUtility);
  observeError(accumulator.v8, evaluation.observedActionUtility, evaluation.targetUtility);
  observeError(
    accumulator.baseline,
    evaluation.baselineObservedActionUtility,
    evaluation.targetUtility,
  );
  accumulator.separationSum += evaluation.candidateSeparation;
  accumulator.zeroSeparationDecisionCount +=
    evaluation.candidateSeparation <= 1e-12 ? 1 : 0;
  accumulator.targetWeightSum += evaluation.importanceWeights.targetClipped;
  accumulator.targetWeightSquaredSum +=
    evaluation.importanceWeights.targetClipped ** 2;
  accumulator.targetRawWeightSum += evaluation.importanceWeights.targetRaw;
  accumulator.targetIpsWeightedRewardSum +=
    evaluation.ope.targetIpsContribution;
  accumulator.targetDrSum += evaluation.ope.targetDrContribution;
  accumulator.baselineWeightSum += evaluation.importanceWeights.baselineClipped;
  accumulator.baselineWeightSquaredSum +=
    evaluation.importanceWeights.baselineClipped ** 2;
  accumulator.baselineIpsWeightedRewardSum +=
    evaluation.ope.baselineIpsContribution;
  accumulator.baselineDrSum += evaluation.ope.baselineDrContribution;
  accumulator.targetClippedWeightCount +=
    evaluation.importanceWeights.targetClippedFlag ? 1 : 0;
  accumulator.baselineClippedWeightCount +=
    evaluation.importanceWeights.baselineClippedFlag ? 1 : 0;
  const match = accumulator.matchDrUplift.get(evaluation.matchId) ?? {
    sum: 0,
    count: 0,
  };
  match.sum += evaluation.ope.drUpliftContribution;
  match.count += 1;
  accumulator.matchDrUplift.set(evaluation.matchId, match);
  for (const cohort of evaluation.cohorts) {
    const key = `${cohort.type}:${cohort.value}`;
    const state = accumulator.cohorts.get(key) ?? {
      type: cohort.type,
      value: cohort.value,
      decisionCount: 0,
      state: emptyErrors(),
      v8: emptyErrors(),
      baseline: emptyErrors(),
      drUpliftSum: 0,
    };
    state.decisionCount += 1;
    observeError(state.state, evaluation.stateUtility, evaluation.targetUtility);
    observeError(state.v8, evaluation.observedActionUtility, evaluation.targetUtility);
    observeError(
      state.baseline,
      evaluation.baselineObservedActionUtility,
      evaluation.targetUtility,
    );
    state.drUpliftSum += evaluation.ope.drUpliftContribution;
    accumulator.cohorts.set(key, state);
  }
}

export function finalizeRecommendationValueV8Evaluation(
  accumulator: RecommendationValueV8EvaluationAccumulator,
  options: Pick<
    RecommendationValueV8EvaluationOptions,
    'cohortMinimumDecisions' | 'criticalCohortRmseTolerance'
  >,
): RecommendationValueV8EvaluationMetrics {
  if (accumulator.decisionCount === 0) {
    throw new Error('Value V8 evaluation contains no decisions.');
  }
  const n = accumulator.decisionCount;
  const stateRmse = rmse(accumulator.state, n);
  const v8Rmse = rmse(accumulator.v8, n);
  const baselineRmse = rmse(accumulator.baseline, n);
  const matchUplifts = [...accumulator.matchDrUplift.values()].map(
    (value) => value.sum / value.count,
  );
  const drUplift = mean(matchUplifts);
  const drUpliftLower95 = lower95(matchUplifts);
  const cohorts = [...accumulator.cohorts.values()]
    .map((cohort) => finalizeCohort(cohort, options))
    .sort(
      (left, right) =>
        left.type.localeCompare(right.type) ||
        left.value.localeCompare(right.value),
    );
  return {
    split: accumulator.split,
    decisionCount: n,
    candidateCount: accumulator.candidateCount,
    candidateCoverage: accumulator.candidateCoveredDecisionCount / n,
    behaviorSupport: accumulator.behaviorSupportedDecisionCount / n,
    stateRmse,
    v8Rmse,
    baselineRmse,
    stateRmseImprovement: stateRmse - v8Rmse,
    baselineRmseImprovement: baselineRmse - v8Rmse,
    stateMae: accumulator.state.absolute / n,
    v8Mae: accumulator.v8.absolute / n,
    baselineMae: accumulator.baseline.absolute / n,
    averageCandidateSeparation: accumulator.separationSum / n,
    zeroSeparationRate: accumulator.zeroSeparationDecisionCount / n,
    ope: {
      targetIps: accumulator.targetIpsWeightedRewardSum / n,
      targetSnips: divide(
        accumulator.targetIpsWeightedRewardSum,
        accumulator.targetWeightSum,
      ),
      targetDr: accumulator.targetDrSum / n,
      baselineIps: accumulator.baselineIpsWeightedRewardSum / n,
      baselineSnips: divide(
        accumulator.baselineIpsWeightedRewardSum,
        accumulator.baselineWeightSum,
      ),
      baselineDr: accumulator.baselineDrSum / n,
      drUplift,
      drUpliftLower95,
      drUpliftMatchCount: matchUplifts.length,
      targetEss: effectiveSampleSize(
        accumulator.targetWeightSum,
        accumulator.targetWeightSquaredSum,
      ),
      targetEssRatio:
        effectiveSampleSize(
          accumulator.targetWeightSum,
          accumulator.targetWeightSquaredSum,
        ) / n,
      baselineEss: effectiveSampleSize(
        accumulator.baselineWeightSum,
        accumulator.baselineWeightSquaredSum,
      ),
      baselineEssRatio:
        effectiveSampleSize(
          accumulator.baselineWeightSum,
          accumulator.baselineWeightSquaredSum,
        ) / n,
      targetClippedWeightRate: accumulator.targetClippedWeightCount / n,
      baselineClippedWeightRate: accumulator.baselineClippedWeightCount / n,
    },
    cohorts,
    criticallyNegativeMajorCohortCount: cohorts.filter(
      (cohort) => cohort.criticallyNegative,
    ).length,
  };
}

export function selectRecommendationValueV8Configuration(
  candidates: readonly {
    configuration: RecommendationValueV8Configuration;
    metrics: RecommendationValueV8EvaluationMetrics;
  }[],
): RecommendationValueV8Selection {
  if (candidates.length === 0) {
    throw new Error('Value V8 selection requires configuration candidates.');
  }
  const normalized = candidates.map(({ configuration, metrics }) => {
    validateConfiguration(configuration);
    if (metrics.split !== 'TUNING') {
      throw new Error('Value V8 configuration selection must use TUNING metrics.');
    }
    const reasons: string[] = [];
    if (metrics.averageCandidateSeparation <= 1e-12) {
      reasons.push('Candidate scores are effectively identical.');
    }
    if (metrics.stateRmseImprovement <= 0) {
      reasons.push('Configuration does not improve over State-only.');
    }
    if (metrics.baselineRmseImprovement <= 0) {
      reasons.push('Configuration does not improve over V6 short-only.');
    }
    if (metrics.criticallyNegativeMajorCohortCount > 0) {
      reasons.push('Configuration has critically negative major cohorts.');
    }
    const selectionLoss =
      metrics.v8Rmse -
      0.05 * Math.max(0, metrics.averageCandidateSeparation) -
      0.02 * Math.max(0, metrics.ope.drUplift);
    return {
      configuration: clone(configuration),
      metrics: clone(metrics),
      selectionLoss,
      eligible: reasons.length === 0,
      reasons,
    };
  });
  const eligible = normalized.filter((candidate) => candidate.eligible);
  const pool = eligible.length > 0 ? eligible : normalized;
  pool.sort(
    (left, right) =>
      left.selectionLoss - right.selectionLoss ||
      left.configuration.actionScale - right.configuration.actionScale ||
      left.configuration.policyTemperature -
        right.configuration.policyTemperature,
  );
  return {
    selected: clone(pool[0]),
    candidates: normalized
      .sort(
        (left, right) =>
          left.selectionLoss - right.selectionLoss ||
          left.configuration.actionScale - right.configuration.actionScale ||
          left.configuration.policyTemperature -
            right.configuration.policyTemperature,
      )
      .map(clone),
    selectedOn: 'TUNING_ONLY',
    futureTestUsed: false,
  };
}

export function buildRecommendationValueV8ReleaseGate(
  futureTest: RecommendationValueV8EvaluationMetrics,
  diagnosticGatePassed: boolean,
  thresholds: RecommendationValueV8ReleaseThresholds =
    DEFAULT_RECOMMENDATION_VALUE_V8_RELEASE_THRESHOLDS,
): RecommendationValueV8ReleaseGate {
  if (futureTest.split !== 'FUTURE_TEST') {
    throw new Error('Value V8 release gate requires FUTURE_TEST metrics.');
  }
  validateReleaseThresholds(thresholds);
  const checks = {
    diagnosticGate: diagnosticGatePassed,
    candidateCoverage:
      futureTest.candidateCoverage >= thresholds.minimumCandidateCoverage,
    behaviorSupport:
      futureTest.behaviorSupport >= thresholds.minimumBehaviorSupport,
    essRatio: futureTest.ope.targetEssRatio >= thresholds.minimumEssRatio,
    clippedWeightRate:
      futureTest.ope.targetClippedWeightRate <=
      thresholds.maximumClippedWeightRate,
    stateOnlyImprovement:
      futureTest.stateRmseImprovement >
      thresholds.minimumStateRmseImprovement,
    v6ShortOnlyImprovement:
      futureTest.baselineRmseImprovement >
      thresholds.minimumBaselineRmseImprovement,
    candidateSeparation:
      futureTest.averageCandidateSeparation >=
      thresholds.minimumCandidateSeparation,
    drUpliftLower95:
      futureTest.ope.drUpliftLower95 > thresholds.minimumDrUpliftLower95,
    majorCohorts:
      futureTest.criticallyNegativeMajorCohortCount <=
      thresholds.maximumCriticallyNegativeMajorCohorts,
  };
  const reasons: string[] = [];
  if (!checks.diagnosticGate) {
    reasons.push('Real-data Value V8 diagnostic gate did not pass.');
  }
  if (!checks.candidateCoverage) {
    reasons.push('Candidate coverage is below the release threshold.');
  }
  if (!checks.behaviorSupport) {
    reasons.push('Behavior support is below the release threshold.');
  }
  if (!checks.essRatio) {
    reasons.push('Effective sample size ratio is below the release threshold.');
  }
  if (!checks.clippedWeightRate) {
    reasons.push('Clipped importance-weight rate exceeds the release threshold.');
  }
  if (!checks.stateOnlyImprovement) {
    reasons.push('Value V8 does not improve over State-only on future test.');
  }
  if (!checks.v6ShortOnlyImprovement) {
    reasons.push('Value V8 does not improve over frozen V6 short-only on future test.');
  }
  if (!checks.candidateSeparation) {
    reasons.push('Value V8 candidate separation is below the release threshold.');
  }
  if (!checks.drUpliftLower95) {
    reasons.push('DR uplift lower 95% bound is not positive.');
  }
  if (!checks.majorCohorts) {
    reasons.push('Value V8 has critically negative major cohorts.');
  }
  return {
    passed: reasons.length === 0,
    diagnosticGatePassed,
    thresholds: clone(thresholds),
    checks,
    reasons,
    passiveShadowAuthorized: reasons.length === 0,
    randomizedCanaryAuthorized: false,
  };
}

function availableHorizonEntries(
  row: RecommendationProDecisionDatasetV6Row,
  values: RecommendationValueV8HorizonValues,
): Array<{ value: number; weight: number }> {
  return RECOMMENDATION_VALUE_V8_HORIZONS.flatMap((horizon) => {
    const target = rowTarget(row, horizon);
    const value = values[horizon];
    if (target === undefined || value === undefined) {
      return [];
    }
    if (!Number.isFinite(value)) {
      throw new Error(`Value V8 ${horizon} prediction is invalid.`);
    }
    return [{ value, weight: HORIZON_WEIGHTS[horizon] }];
  });
}

function rowTarget(
  row: RecommendationProDecisionDatasetV6Row,
  horizon: RecommendationValueV8Horizon,
): number | undefined {
  if (horizon === '3m') {
    return row.shortHorizonOutcomes.threeMinutes;
  }
  if (horizon === '5m') {
    return row.shortHorizonOutcomes.fiveMinutes;
  }
  return row.shortHorizonOutcomes.tenMinutes;
}

function weightedMean(values: readonly { value: number; weight: number }[]): number {
  const weight = values.reduce((sum, entry) => sum + entry.weight, 0);
  return values.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weight;
}

function validateConfiguration(configuration: RecommendationValueV8Configuration): void {
  if (!Number.isFinite(configuration.actionScale) || configuration.actionScale < 0) {
    throw new Error('Value V8 actionScale must be finite and non-negative.');
  }
  if (
    !Number.isFinite(configuration.policyTemperature) ||
    configuration.policyTemperature <= 0
  ) {
    throw new Error('Value V8 policyTemperature must be positive.');
  }
}

function validateEvaluationOptions(
  options: RecommendationValueV8EvaluationOptions,
): void {
  validateConfiguration(options.configuration);
  if (
    !Number.isFinite(options.maximumImportanceWeight) ||
    options.maximumImportanceWeight < 1
  ) {
    throw new Error('Value V8 maximumImportanceWeight must be at least 1.');
  }
  if (
    !Number.isSafeInteger(options.cohortMinimumDecisions) ||
    options.cohortMinimumDecisions < 1
  ) {
    throw new Error('Value V8 cohortMinimumDecisions must be positive.');
  }
  if (
    !Number.isFinite(options.criticalCohortRmseTolerance) ||
    options.criticalCohortRmseTolerance < 0
  ) {
    throw new Error('Value V8 critical cohort tolerance must be non-negative.');
  }
}

function validatePropensity(
  propensity: RecommendationBehavioralV5PropensityRow,
  row: RecommendationProDecisionDatasetV6Row,
): void {
  if (
    propensity.decisionId !== row.decisionId ||
    propensity.matchId !== row.matchId ||
    propensity.split !== row.split ||
    propensity.observedActionKey !== row.observedActionKey ||
    propensity.trainingMatchExcluded !== true ||
    !Number.isFinite(propensity.observedActionProbability) ||
    propensity.observedActionProbability <= 0 ||
    propensity.observedActionProbability > 1
  ) {
    throw new Error(`Behavioral V5 propensity mismatch for ${row.decisionId}.`);
  }
  if (row.split === 'TUNING' || row.split === 'FUTURE_TEST') {
    if (propensity.predictionSource !== 'FULL_TRAIN_MODEL') {
      throw new Error(`Behavioral V5 non-TRAIN propensity is invalid for ${row.decisionId}.`);
    }
  }
}

function cohortKeys(
  row: RecommendationProDecisionDatasetV6Row,
): RecommendationValueV8DecisionEvaluation['cohorts'] {
  const observed = row.candidates.find(
    (candidate) => candidate.actionKey === row.observedActionKey,
  );
  return [
    { type: 'HERO', value: String(row.state.heroId) },
    { type: 'TIME_BUCKET', value: String(Math.floor(row.state.gameTimeS / 300)) },
    { type: 'ITEM_TIER', value: String(observed?.tier ?? 'UNKNOWN') },
    { type: 'ECONOMY_BAND', value: economyBand(row.state.netWorth) },
  ];
}

function economyBand(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'UNKNOWN';
  }
  if (value < 5_000) {
    return 'LOW';
  }
  if (value < 10_000) {
    return 'MEDIUM';
  }
  if (value < 20_000) {
    return 'HIGH';
  }
  return 'VERY_HIGH';
}

function finalizeCohort(
  cohort: CohortAccumulator,
  options: Pick<
    RecommendationValueV8EvaluationOptions,
    'cohortMinimumDecisions' | 'criticalCohortRmseTolerance'
  >,
): RecommendationValueV8CohortMetrics {
  const stateRmse = rmse(cohort.state, cohort.decisionCount);
  const v8Rmse = rmse(cohort.v8, cohort.decisionCount);
  const baselineRmse = rmse(cohort.baseline, cohort.decisionCount);
  const major = cohort.decisionCount >= options.cohortMinimumDecisions;
  const bestComparator = Math.min(stateRmse, baselineRmse);
  return {
    type: cohort.type,
    value: cohort.value,
    decisionCount: cohort.decisionCount,
    major,
    stateRmse,
    v8Rmse,
    baselineRmse,
    stateRmseImprovement: stateRmse - v8Rmse,
    baselineRmseImprovement: baselineRmse - v8Rmse,
    meanDrUplift: cohort.drUpliftSum / cohort.decisionCount,
    criticallyNegative:
      major &&
      v8Rmse - bestComparator > options.criticalCohortRmseTolerance,
  };
}

function validateReleaseThresholds(
  thresholds: RecommendationValueV8ReleaseThresholds,
): void {
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a finite non-negative number.`);
    }
  }
  if (
    thresholds.minimumCandidateCoverage > 1 ||
    thresholds.minimumBehaviorSupport > 1 ||
    thresholds.minimumEssRatio > 1 ||
    thresholds.maximumClippedWeightRate > 1
  ) {
    throw new Error('Value V8 fractional release thresholds must not exceed 1.');
  }
  if (!Number.isSafeInteger(thresholds.maximumCriticallyNegativeMajorCohorts)) {
    throw new Error('maximumCriticallyNegativeMajorCohorts must be an integer.');
  }
}

function assertSha(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function emptyErrors(): ErrorAccumulator {
  return { squared: 0, absolute: 0 };
}

function observeError(
  accumulator: ErrorAccumulator,
  prediction: number,
  target: number,
): void {
  const error = prediction - target;
  accumulator.squared += error * error;
  accumulator.absolute += Math.abs(error);
}

function rmse(accumulator: ErrorAccumulator, count: number): number {
  return Math.sqrt(accumulator.squared / Math.max(1, count));
}

function effectiveSampleSize(weightSum: number, squaredWeightSum: number): number {
  return squaredWeightSum <= 0 ? 0 : (weightSum * weightSum) / squaredWeightSum;
}

function lower95(values: readonly number[]): number {
  if (values.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  if (values.length === 1) {
    return values[0];
  }
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return average - 1.96 * Math.sqrt(variance / values.length);
}

function softmax(values: readonly number[]): number[] {
  if (values.length === 0) {
    throw new Error('Value V8 policy has no candidates.');
  }
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(clamp(value - maximum, -50, 50)));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function divide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
