import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';

export const RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION = 1;
export const RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION =
  'RECOMMENDATION_VALUE_V8_HASHED_STATE_1' as const;
export const RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION =
  'RECOMMENDATION_VALUE_V8_HASHED_ACTION_RESIDUAL_1' as const;
export const RECOMMENDATION_VALUE_V8_FEATURE_VERSION =
  'RECOMMENDATION_VALUE_V8_FEATURES_1' as const;
export const RECOMMENDATION_VALUE_V8_HORIZONS = ['3m', '5m', '10m'] as const;

export type RecommendationValueV8Horizon =
  (typeof RECOMMENDATION_VALUE_V8_HORIZONS)[number];

export type RecommendationValueV8HorizonValues = Partial<
  Record<RecommendationValueV8Horizon, number>
>;

export interface RecommendationValueV8StateModel {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION;
  modelVersion: typeof RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION;
  featureVersion: typeof RECOMMENDATION_VALUE_V8_FEATURE_VERSION;
  hashDimension: number;
  weights: Record<RecommendationValueV8Horizon, number[]>;
  trainedDecisionCount: number;
  trainedTargetCount: Record<RecommendationValueV8Horizon, number>;
  updateCount: number;
}

export interface RecommendationValueV8ActionModel {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION;
  modelVersion: typeof RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION;
  featureVersion: typeof RECOMMENDATION_VALUE_V8_FEATURE_VERSION;
  hashDimension: number;
  weights: Record<RecommendationValueV8Horizon, number[]>;
  trainedDecisionCount: number;
  trainedTargetCount: Record<RecommendationValueV8Horizon, number>;
  updateCount: number;
  totalImportanceWeight: number;
  clippedImportanceWeightCount: number;
}

export interface RecommendationValueV8StateTrainingOptions {
  learningRate: number;
  l2: number;
  maximumAbsolutePrediction: number;
}

export interface RecommendationValueV8ActionTrainingOptions {
  learningRate: number;
  l2: number;
  maximumAbsoluteResidual: number;
  propensityFloor: number;
  maximumImportanceWeight: number;
}

export interface RecommendationValueV8ActionTrainingResult {
  loss: number;
  targetCount: number;
  rawImportanceWeight: number;
  importanceWeight: number;
  clipped: boolean;
}

export interface RecommendationValueV8CandidatePrediction {
  actionKey: string;
  itemId: number;
  rawResiduals: RecommendationValueV8HorizonValues;
  advantages: RecommendationValueV8HorizonValues;
  aggregateAdvantage: number;
  rank: number;
}

export interface RecommendationValueV8CandidateSetPrediction {
  candidates: RecommendationValueV8CandidatePrediction[];
  meanRawResiduals: RecommendationValueV8HorizonValues;
  candidateSeparation: number;
  maximumAbsoluteCenteredMean: number;
}

export interface RecommendationValueV8DiagnosticMetricsAccumulator {
  decisionCount: number;
  targetCount: number;
  stateSquaredError: number;
  actionSquaredError: number;
  candidatePermutationSquaredError: number;
  metadataPermutationSquaredError: number;
  stateAbsoluteError: number;
  actionAbsoluteError: number;
  sensitiveDecisionCount: number;
  separationSum: number;
  maximumSeparation: number;
  centeredMeanAbsoluteSum: number;
  observedActionTop1Count: number;
}

export interface RecommendationValueV8DiagnosticMetrics {
  decisionCount: number;
  targetCount: number;
  stateRmse: number;
  actionRmse: number;
  stateRmseImprovement: number;
  candidatePermutationRmse: number;
  candidatePermutationRmseIncrease: number;
  metadataPermutationRmse: number;
  metadataPermutationRmseIncrease: number;
  stateMae: number;
  actionMae: number;
  candidateSensitiveDecisionRate: number;
  averageCandidateSeparation: number;
  maximumCandidateSeparation: number;
  averageAbsoluteCenteredMean: number;
  observedActionTop1Rate: number;
}

export interface RecommendationValueV8DiagnosticThresholds {
  minimumTuningDecisionCount: number;
  minimumStateRmseImprovement: number;
  minimumCandidateSensitiveDecisionRate: number;
  minimumAverageCandidateSeparation: number;
  minimumCandidatePermutationRmseIncrease: number;
  minimumMetadataPermutationRmseIncrease: number;
  maximumAbsoluteCenteredMean: number;
}

export const DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS:
  RecommendationValueV8DiagnosticThresholds = {
    minimumTuningDecisionCount: 100,
    minimumStateRmseImprovement: 0,
    minimumCandidateSensitiveDecisionRate: 0.5,
    minimumAverageCandidateSeparation: 0.001,
    minimumCandidatePermutationRmseIncrease: 0,
    minimumMetadataPermutationRmseIncrease: 0,
    maximumAbsoluteCenteredMean: 1e-9,
  };

export interface RecommendationValueV8DiagnosticGate {
  passed: boolean;
  thresholds: RecommendationValueV8DiagnosticThresholds;
  checks: {
    tuningDecisionCount: boolean;
    stateOnlyImprovement: boolean;
    candidateSensitivity: boolean;
    candidateSeparation: boolean;
    candidatePermutation: boolean;
    metadataPermutation: boolean;
    candidateCentering: boolean;
  };
  reasons: string[];
  fullTrainingRecommended: boolean;
}

interface SparseFeature {
  index: number;
  value: number;
}

export function createRecommendationValueV8StateModel(
  hashDimension: number,
): RecommendationValueV8StateModel {
  validateHashDimension(hashDimension);
  return {
    schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION,
    featureVersion: RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
    hashDimension,
    weights: createHorizonWeightTable(hashDimension),
    trainedDecisionCount: 0,
    trainedTargetCount: emptyHorizonCounts(),
    updateCount: 0,
  };
}

export function createRecommendationValueV8ActionModel(
  hashDimension: number,
): RecommendationValueV8ActionModel {
  validateHashDimension(hashDimension);
  return {
    schemaVersion: RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
    modelVersion: RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION,
    featureVersion: RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
    hashDimension,
    weights: createHorizonWeightTable(hashDimension),
    trainedDecisionCount: 0,
    trainedTargetCount: emptyHorizonCounts(),
    updateCount: 0,
    totalImportanceWeight: 0,
    clippedImportanceWeightCount: 0,
  };
}

export function validateRecommendationValueV8StateModel(
  model: RecommendationValueV8StateModel,
): void {
  if (
    model.schemaVersion !== RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION ||
    model.modelVersion !== RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION ||
    model.featureVersion !== RECOMMENDATION_VALUE_V8_FEATURE_VERSION
  ) {
    throw new Error('Unsupported Recommendation Value V8 state model.');
  }
  validateModelWeights(model.hashDimension, model.weights);
}

export function validateRecommendationValueV8ActionModel(
  model: RecommendationValueV8ActionModel,
): void {
  if (
    model.schemaVersion !== RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION ||
    model.modelVersion !== RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION ||
    model.featureVersion !== RECOMMENDATION_VALUE_V8_FEATURE_VERSION
  ) {
    throw new Error('Unsupported Recommendation Value V8 action model.');
  }
  validateModelWeights(model.hashDimension, model.weights);
}

export function recommendationValueV8Targets(
  row: RecommendationProDecisionDatasetV6Row,
): RecommendationValueV8HorizonValues {
  const result: RecommendationValueV8HorizonValues = {};
  addTarget(result, '3m', row.shortHorizonOutcomes.threeMinutes);
  addTarget(result, '5m', row.shortHorizonOutcomes.fiveMinutes);
  addTarget(result, '10m', row.shortHorizonOutcomes.tenMinutes);
  return result;
}

export function trainRecommendationValueV8StateDecision(
  model: RecommendationValueV8StateModel,
  row: RecommendationProDecisionDatasetV6Row,
  options: RecommendationValueV8StateTrainingOptions,
): number {
  validateRecommendationValueV8StateModel(model);
  validateStateTrainingOptions(options);
  if (!row.eligibility.stateModel) {
    throw new Error('Recommendation Value V8 row is not state-model eligible.');
  }
  const targets = recommendationValueV8Targets(row);
  const features = stateFeatures(row, model.hashDimension);
  let loss = 0;
  let targetCount = 0;
  for (const horizon of RECOMMENDATION_VALUE_V8_HORIZONS) {
    const target = targets[horizon];
    if (target === undefined) {
      continue;
    }
    const weights = model.weights[horizon];
    const rawPrediction = dot(weights, features);
    const prediction = clamp(
      rawPrediction,
      -options.maximumAbsolutePrediction,
      options.maximumAbsolutePrediction,
    );
    const error = prediction - target;
    const learningRate =
      options.learningRate / Math.sqrt(Math.max(1, model.updateCount + 1));
    for (const feature of features) {
      const weight = weights[feature.index];
      const gradient = 2 * error * feature.value + options.l2 * weight;
      weights[feature.index] = weight - learningRate * gradient;
    }
    loss += error * error;
    targetCount += 1;
    model.trainedTargetCount[horizon] += 1;
    model.updateCount += 1;
  }
  if (targetCount > 0) {
    model.trainedDecisionCount += 1;
  }
  return targetCount === 0 ? 0 : loss / targetCount;
}

export function predictRecommendationValueV8State(
  model: RecommendationValueV8StateModel,
  row: RecommendationProDecisionDatasetV6Row,
  maximumAbsolutePrediction = 1,
): RecommendationValueV8HorizonValues {
  validateRecommendationValueV8StateModel(model);
  if (!Number.isFinite(maximumAbsolutePrediction) || maximumAbsolutePrediction <= 0) {
    throw new Error('maximumAbsolutePrediction must be positive.');
  }
  const features = stateFeatures(row, model.hashDimension);
  return Object.fromEntries(
    RECOMMENDATION_VALUE_V8_HORIZONS.map((horizon) => [
      horizon,
      clamp(
        dot(model.weights[horizon], features),
        -maximumAbsolutePrediction,
        maximumAbsolutePrediction,
      ),
    ]),
  ) as Record<RecommendationValueV8Horizon, number>;
}

export function trainRecommendationValueV8ActionDecision(
  model: RecommendationValueV8ActionModel,
  row: RecommendationProDecisionDatasetV6Row,
  statePredictions: RecommendationValueV8HorizonValues,
  observedActionProbability: number,
  options: RecommendationValueV8ActionTrainingOptions,
): RecommendationValueV8ActionTrainingResult {
  validateRecommendationValueV8ActionModel(model);
  validateActionTrainingOptions(options);
  if (!row.eligibility.actionModel || !row.observedActionInCandidateSet) {
    throw new Error('Recommendation Value V8 row is not action-model eligible.');
  }
  const candidate = row.candidates.find(
    (value) => value.actionKey === row.observedActionKey,
  );
  if (!candidate) {
    throw new Error('Recommendation Value V8 observed action is missing.');
  }
  if (!Number.isFinite(observedActionProbability) || observedActionProbability <= 0) {
    throw new Error('Recommendation Value V8 propensity must be positive.');
  }
  const stabilizedPropensity = Math.max(
    observedActionProbability,
    options.propensityFloor,
  );
  const rawImportanceWeight = 1 / stabilizedPropensity;
  const importanceWeight = Math.min(
    rawImportanceWeight,
    options.maximumImportanceWeight,
  );
  const clipped = importanceWeight < rawImportanceWeight;
  const targets = recommendationValueV8Targets(row);
  const features = actionFeatures(row, candidate, model.hashDimension);
  let loss = 0;
  let targetCount = 0;
  for (const horizon of RECOMMENDATION_VALUE_V8_HORIZONS) {
    const target = targets[horizon];
    const statePrediction = statePredictions[horizon];
    if (target === undefined || statePrediction === undefined) {
      continue;
    }
    const residualTarget = clamp(
      target - statePrediction,
      -options.maximumAbsoluteResidual,
      options.maximumAbsoluteResidual,
    );
    const weights = model.weights[horizon];
    const rawPrediction = dot(weights, features);
    const prediction = clamp(
      rawPrediction,
      -options.maximumAbsoluteResidual,
      options.maximumAbsoluteResidual,
    );
    const error = prediction - residualTarget;
    const learningRate =
      options.learningRate / Math.sqrt(Math.max(1, model.updateCount + 1));
    for (const feature of features) {
      const weight = weights[feature.index];
      const gradient =
        2 * importanceWeight * error * feature.value + options.l2 * weight;
      weights[feature.index] = weight - learningRate * gradient;
    }
    loss += importanceWeight * error * error;
    targetCount += 1;
    model.trainedTargetCount[horizon] += 1;
    model.updateCount += 1;
  }
  if (targetCount > 0) {
    model.trainedDecisionCount += 1;
    model.totalImportanceWeight += importanceWeight;
    model.clippedImportanceWeightCount += clipped ? 1 : 0;
  }
  return {
    loss: targetCount === 0 ? 0 : loss / targetCount,
    targetCount,
    rawImportanceWeight,
    importanceWeight,
    clipped,
  };
}

export function predictRecommendationValueV8CandidateResidual(
  model: RecommendationValueV8ActionModel,
  row: RecommendationProDecisionDatasetV6Row,
  candidate: RecommendationDatasetV6CandidateFeatures,
  maximumAbsoluteResidual = 1,
): RecommendationValueV8HorizonValues {
  validateRecommendationValueV8ActionModel(model);
  if (!Number.isFinite(maximumAbsoluteResidual) || maximumAbsoluteResidual <= 0) {
    throw new Error('maximumAbsoluteResidual must be positive.');
  }
  const features = actionFeatures(row, candidate, model.hashDimension);
  return Object.fromEntries(
    RECOMMENDATION_VALUE_V8_HORIZONS.map((horizon) => [
      horizon,
      clamp(
        dot(model.weights[horizon], features),
        -maximumAbsoluteResidual,
        maximumAbsoluteResidual,
      ),
    ]),
  ) as Record<RecommendationValueV8Horizon, number>;
}

export function predictRecommendationValueV8CandidateSet(
  model: RecommendationValueV8ActionModel,
  row: RecommendationProDecisionDatasetV6Row,
  candidates: readonly RecommendationDatasetV6CandidateFeatures[] = row.candidates,
  maximumAbsoluteResidual = 1,
): RecommendationValueV8CandidateSetPrediction {
  if (candidates.length < 2) {
    throw new Error('Recommendation Value V8 candidate set requires at least two actions.');
  }
  const raw = candidates.map((candidate) => ({
    candidate,
    residuals: predictRecommendationValueV8CandidateResidual(
      model,
      row,
      candidate,
      maximumAbsoluteResidual,
    ),
  }));
  const meanRawResiduals: RecommendationValueV8HorizonValues = {};
  for (const horizon of RECOMMENDATION_VALUE_V8_HORIZONS) {
    meanRawResiduals[horizon] =
      raw.reduce((sum, value) => sum + (value.residuals[horizon] ?? 0), 0) /
      raw.length;
  }
  const predictions = raw.map(({ candidate, residuals }) => {
    const advantages = Object.fromEntries(
      RECOMMENDATION_VALUE_V8_HORIZONS.map((horizon) => [
        horizon,
        (residuals[horizon] ?? 0) - (meanRawResiduals[horizon] ?? 0),
      ]),
    ) as Record<RecommendationValueV8Horizon, number>;
    return {
      actionKey: candidate.actionKey,
      itemId: candidate.itemId,
      rawResiduals: residuals,
      advantages,
      aggregateAdvantage: mean(Object.values(advantages)),
      rank: 0,
    };
  });
  const ranked = predictions
    .sort(
      (left, right) =>
        right.aggregateAdvantage - left.aggregateAdvantage ||
        left.actionKey.localeCompare(right.actionKey),
    )
    .map((value, index) => ({ ...value, rank: index + 1 }));
  const aggregateValues = ranked.map((value) => value.aggregateAdvantage);
  const maximumAbsoluteCenteredMean = Math.max(
    ...RECOMMENDATION_VALUE_V8_HORIZONS.map((horizon) =>
      Math.abs(mean(ranked.map((value) => value.advantages[horizon] ?? 0))),
    ),
  );
  return {
    candidates: ranked,
    meanRawResiduals,
    candidateSeparation:
      Math.max(...aggregateValues) - Math.min(...aggregateValues),
    maximumAbsoluteCenteredMean,
  };
}

export function permuteRecommendationValueV8CandidatePayloads(
  candidates: readonly RecommendationDatasetV6CandidateFeatures[],
): RecommendationDatasetV6CandidateFeatures[] {
  if (candidates.length < 2) {
    return candidates.map((candidate) => clone(candidate));
  }
  return candidates.map((identity, index) => {
    const payload = candidates[(index + 1) % candidates.length];
    return {
      ...clone(payload),
      actionKey: identity.actionKey,
      actionType: identity.actionType,
      predictedStateKey: identity.predictedStateKey,
    };
  });
}

export function permuteRecommendationValueV8CandidateMetadata(
  candidates: readonly RecommendationDatasetV6CandidateFeatures[],
): RecommendationDatasetV6CandidateFeatures[] {
  if (candidates.length < 2) {
    return candidates.map((candidate) => clone(candidate));
  }
  return candidates.map((identity, index) => {
    const metadata = candidates[(index + 1) % candidates.length];
    return {
      ...clone(identity),
      catalogMetadataAvailable: metadata.catalogMetadataAvailable,
      cost: metadata.cost,
      tier: metadata.tier,
      slotType: metadata.slotType,
      itemType: metadata.itemType,
      isActiveItem: metadata.isActiveItem,
      activationType: metadata.activationType,
      tags: [...metadata.tags],
      componentItemIds: [...metadata.componentItemIds],
      requiredComponentCount: metadata.requiredComponentCount,
      ownedComponentCount: metadata.ownedComponentCount,
      missingComponentCount: metadata.missingComponentCount,
      hasAnyOwnedComponent: metadata.hasAnyOwnedComponent,
      hasCompleteRecipeComponents: metadata.hasCompleteRecipeComponents,
      alreadyOwnedCount: metadata.alreadyOwnedCount,
      sameSlotOwnedItemCount: metadata.sameSlotOwnedItemCount,
      inventoryTagOverlapCount: metadata.inventoryTagOverlapCount,
      previousActionCount: metadata.previousActionCount,
      currentNetWorth: metadata.currentNetWorth,
      costToNetWorthRatio: metadata.costToNetWorthRatio,
    };
  });
}

export function createRecommendationValueV8DiagnosticMetricsAccumulator(): RecommendationValueV8DiagnosticMetricsAccumulator {
  return {
    decisionCount: 0,
    targetCount: 0,
    stateSquaredError: 0,
    actionSquaredError: 0,
    candidatePermutationSquaredError: 0,
    metadataPermutationSquaredError: 0,
    stateAbsoluteError: 0,
    actionAbsoluteError: 0,
    sensitiveDecisionCount: 0,
    separationSum: 0,
    maximumSeparation: 0,
    centeredMeanAbsoluteSum: 0,
    observedActionTop1Count: 0,
  };
}

export function observeRecommendationValueV8DiagnosticDecision(input: {
  accumulator: RecommendationValueV8DiagnosticMetricsAccumulator;
  row: RecommendationProDecisionDatasetV6Row;
  statePredictions: RecommendationValueV8HorizonValues;
  candidatePrediction: RecommendationValueV8CandidateSetPrediction;
  candidatePermutationPrediction: RecommendationValueV8CandidateSetPrediction;
  metadataPermutationPrediction: RecommendationValueV8CandidateSetPrediction;
  sensitivityThreshold: number;
}): void {
  if (!Number.isFinite(input.sensitivityThreshold) || input.sensitivityThreshold < 0) {
    throw new Error('Recommendation Value V8 sensitivityThreshold is invalid.');
  }
  const observed = requiredCandidatePrediction(
    input.candidatePrediction,
    input.row.observedActionKey,
  );
  const candidatePermuted = requiredCandidatePrediction(
    input.candidatePermutationPrediction,
    input.row.observedActionKey,
  );
  const metadataPermuted = requiredCandidatePrediction(
    input.metadataPermutationPrediction,
    input.row.observedActionKey,
  );
  const targets = recommendationValueV8Targets(input.row);
  let observedTarget = false;
  for (const horizon of RECOMMENDATION_VALUE_V8_HORIZONS) {
    const target = targets[horizon];
    const state = input.statePredictions[horizon];
    if (target === undefined || state === undefined) {
      continue;
    }
    const action = clamp(state + (observed.advantages[horizon] ?? 0), -1, 1);
    const candidatePermutation = clamp(
      state + (candidatePermuted.advantages[horizon] ?? 0),
      -1,
      1,
    );
    const metadataPermutation = clamp(
      state + (metadataPermuted.advantages[horizon] ?? 0),
      -1,
      1,
    );
    input.accumulator.stateSquaredError += (state - target) ** 2;
    input.accumulator.actionSquaredError += (action - target) ** 2;
    input.accumulator.candidatePermutationSquaredError +=
      (candidatePermutation - target) ** 2;
    input.accumulator.metadataPermutationSquaredError +=
      (metadataPermutation - target) ** 2;
    input.accumulator.stateAbsoluteError += Math.abs(state - target);
    input.accumulator.actionAbsoluteError += Math.abs(action - target);
    input.accumulator.targetCount += 1;
    observedTarget = true;
  }
  if (!observedTarget) {
    return;
  }
  input.accumulator.decisionCount += 1;
  input.accumulator.sensitiveDecisionCount +=
    input.candidatePrediction.candidateSeparation >= input.sensitivityThreshold
      ? 1
      : 0;
  input.accumulator.separationSum +=
    input.candidatePrediction.candidateSeparation;
  input.accumulator.maximumSeparation = Math.max(
    input.accumulator.maximumSeparation,
    input.candidatePrediction.candidateSeparation,
  );
  input.accumulator.centeredMeanAbsoluteSum +=
    input.candidatePrediction.maximumAbsoluteCenteredMean;
  input.accumulator.observedActionTop1Count += observed.rank === 1 ? 1 : 0;
}

export function finalizeRecommendationValueV8DiagnosticMetrics(
  accumulator: RecommendationValueV8DiagnosticMetricsAccumulator,
): RecommendationValueV8DiagnosticMetrics {
  const targetCount = Math.max(1, accumulator.targetCount);
  const decisionCount = Math.max(1, accumulator.decisionCount);
  const stateRmse = Math.sqrt(accumulator.stateSquaredError / targetCount);
  const actionRmse = Math.sqrt(accumulator.actionSquaredError / targetCount);
  const candidatePermutationRmse = Math.sqrt(
    accumulator.candidatePermutationSquaredError / targetCount,
  );
  const metadataPermutationRmse = Math.sqrt(
    accumulator.metadataPermutationSquaredError / targetCount,
  );
  return {
    decisionCount: accumulator.decisionCount,
    targetCount: accumulator.targetCount,
    stateRmse,
    actionRmse,
    stateRmseImprovement: stateRmse - actionRmse,
    candidatePermutationRmse,
    candidatePermutationRmseIncrease: candidatePermutationRmse - actionRmse,
    metadataPermutationRmse,
    metadataPermutationRmseIncrease: metadataPermutationRmse - actionRmse,
    stateMae: accumulator.stateAbsoluteError / targetCount,
    actionMae: accumulator.actionAbsoluteError / targetCount,
    candidateSensitiveDecisionRate:
      accumulator.sensitiveDecisionCount / decisionCount,
    averageCandidateSeparation: accumulator.separationSum / decisionCount,
    maximumCandidateSeparation: accumulator.maximumSeparation,
    averageAbsoluteCenteredMean:
      accumulator.centeredMeanAbsoluteSum / decisionCount,
    observedActionTop1Rate:
      accumulator.observedActionTop1Count / decisionCount,
  };
}

export function buildRecommendationValueV8DiagnosticGate(
  metrics: RecommendationValueV8DiagnosticMetrics,
  thresholds: RecommendationValueV8DiagnosticThresholds =
    DEFAULT_RECOMMENDATION_VALUE_V8_DIAGNOSTIC_THRESHOLDS,
): RecommendationValueV8DiagnosticGate {
  validateDiagnosticThresholds(thresholds);
  const checks = {
    tuningDecisionCount:
      metrics.decisionCount >= thresholds.minimumTuningDecisionCount,
    stateOnlyImprovement:
      metrics.stateRmseImprovement > thresholds.minimumStateRmseImprovement,
    candidateSensitivity:
      metrics.candidateSensitiveDecisionRate >=
      thresholds.minimumCandidateSensitiveDecisionRate,
    candidateSeparation:
      metrics.averageCandidateSeparation >=
      thresholds.minimumAverageCandidateSeparation,
    candidatePermutation:
      metrics.candidatePermutationRmseIncrease >
      thresholds.minimumCandidatePermutationRmseIncrease,
    metadataPermutation:
      metrics.metadataPermutationRmseIncrease >
      thresholds.minimumMetadataPermutationRmseIncrease,
    candidateCentering:
      metrics.averageAbsoluteCenteredMean <=
      thresholds.maximumAbsoluteCenteredMean,
  };
  const reasons: string[] = [];
  if (!checks.tuningDecisionCount) {
    reasons.push('Tuning decision count is below the diagnostic minimum.');
  }
  if (!checks.stateOnlyImprovement) {
    reasons.push('State plus Action does not improve RMSE over State-only.');
  }
  if (!checks.candidateSensitivity) {
    reasons.push('Candidate sensitivity rate is below the diagnostic minimum.');
  }
  if (!checks.candidateSeparation) {
    reasons.push('Candidate score separation is below the diagnostic minimum.');
  }
  if (!checks.candidatePermutation) {
    reasons.push('Candidate permutation does not degrade tuning RMSE.');
  }
  if (!checks.metadataPermutation) {
    reasons.push('Candidate metadata permutation does not degrade tuning RMSE.');
  }
  if (!checks.candidateCentering) {
    reasons.push('Candidate advantages are not centered within decisions.');
  }
  return {
    passed: reasons.length === 0,
    thresholds: clone(thresholds),
    checks,
    reasons,
    fullTrainingRecommended: reasons.length === 0,
  };
}

export function recommendationValueV8FoldId(
  matchId: string,
  foldCount: number,
): number {
  if (!matchId.trim()) {
    throw new Error('Recommendation Value V8 matchId is required.');
  }
  if (!Number.isSafeInteger(foldCount) || foldCount < 2 || foldCount > 20) {
    throw new Error('Recommendation Value V8 foldCount must be between 2 and 20.');
  }
  return fnv1a(matchId) % foldCount;
}

function stateFeatures(
  row: RecommendationProDecisionDatasetV6Row,
  hashDimension: number,
): SparseFeature[] {
  const features = new Map<number, number>();
  const add = featureAdder(features, hashDimension);
  const state = row.state;
  const timeBucket = Math.floor(state.gameTimeS / 300);
  add('state:bias');
  add(`state:hero:${state.heroId}`);
  add(`state:team:${state.team}`);
  add(`state:phase:${state.phase}`);
  add(`state:time:${timeBucket}`);
  add(`state:hero-time:${state.heroId}:${timeBucket}`);
  for (const value of state.inventoryItemCounts) {
    add(`state:inventory-item:${value.itemId}`, bounded(value.count, 0, 4) / 4);
  }
  for (const [tag, count] of Object.entries(state.inventoryTagCounts)) {
    add(`state:inventory-tag:${tag}`, bounded(count, 0, 8) / 8);
  }
  for (const actionKey of state.previousActionKeys.slice(-5)) {
    add(`state:previous-action:${actionKey}`, 0.2);
  }
  for (const allyHeroId of state.alliedHeroIds) {
    add(`state:ally:${allyHeroId}`, 0.2);
  }
  for (const enemyHeroId of state.enemyHeroIds) {
    add(`state:enemy:${enemyHeroId}`, 0.2);
  }
  add('state:time-value', bounded(state.gameTimeS, 0, 3_600) / 3_600);
  add('state:networth', Math.log1p(Math.max(0, state.netWorth ?? 0)) / 12);
  add('state:kills', bounded(state.kills ?? 0, 0, 30) / 30);
  add('state:deaths', bounded(state.deaths ?? 0, 0, 30) / 30);
  add('state:assists', bounded(state.assists ?? 0, 0, 40) / 40);
  add('state:hero-damage', Math.log1p(Math.max(0, state.heroDamage ?? 0)) / 14);
  add('state:level', bounded(state.level ?? 0, 0, 30) / 30);
  add('state:health-ratio', healthRatio(row));
  add(
    'state:inventory-size',
    bounded(
      state.inventoryItemCounts.reduce((sum, value) => sum + value.count, 0),
      0,
      16,
    ) / 16,
  );
  return finalizeFeatures(features);
}

function actionFeatures(
  row: RecommendationProDecisionDatasetV6Row,
  candidate: RecommendationDatasetV6CandidateFeatures,
  hashDimension: number,
): SparseFeature[] {
  const features = new Map<number, number>();
  const add = featureAdder(features, hashDimension);
  const heroId = row.state.heroId;
  const timeBucket = Math.floor(row.state.gameTimeS / 300);
  const slot = candidate.slotType ?? 'UNKNOWN';
  const tier = candidate.tier ?? -1;
  add('action:bias');
  add(`action:type:${candidate.actionType}`);
  add(`action:hero-item:${heroId}:${candidate.itemId}`, 0.35);
  add(`action:phase-tier:${row.state.phase}:${tier}`);
  add(`action:time-tier:${timeBucket}:${tier}`);
  add(`action:slot:${slot}`);
  add(`action:hero-slot:${heroId}:${slot}`);
  add(`action:tier:${tier}`);
  add(`action:active:${candidate.isActiveItem === true ? 1 : 0}`);
  for (const tag of candidate.tags) {
    add(`action:tag:${tag}`);
    add(`action:hero-tag:${heroId}:${tag}`);
    add(`action:phase-tag:${row.state.phase}:${tag}`);
    add(
      `action:inventory-tag:${tag}`,
      bounded(row.state.inventoryTagCounts[tag] ?? 0, 0, 8) / 8,
    );
    for (const enemyHeroId of row.state.enemyHeroIds) {
      add(`action:enemy-tag:${enemyHeroId}:${tag}`, 0.15);
    }
  }
  add('action:generator-score', bounded(candidate.generatorScore, -10, 10) / 10);
  add(
    'action:historical-probability',
    bounded(candidate.historicalProbability, 0, 1),
  );
  add('action:confidence', bounded(candidate.confidence, 0, 1));
  add('action:inverse-rank', 1 / Math.max(1, candidate.rank));
  add('action:log-cost', Math.log1p(Math.max(0, candidate.cost ?? 0)) / 12);
  add('action:tier-value', bounded(candidate.tier ?? 0, 0, 4) / 4);
  add(
    'action:required-components',
    bounded(candidate.requiredComponentCount, 0, 8) / 8,
  );
  add(
    'action:owned-components',
    bounded(candidate.ownedComponentCount, 0, 8) / 8,
  );
  add(
    'action:missing-components',
    bounded(candidate.missingComponentCount, 0, 8) / 8,
  );
  add(
    'action:complete-recipe',
    candidate.hasCompleteRecipeComponents ? 1 : 0,
  );
  add('action:already-owned', bounded(candidate.alreadyOwnedCount, 0, 4) / 4);
  add(
    'action:same-slot-owned',
    bounded(candidate.sameSlotOwnedItemCount, 0, 8) / 8,
  );
  add(
    'action:inventory-tag-overlap',
    bounded(candidate.inventoryTagOverlapCount, 0, 16) / 16,
  );
  add(
    'action:previous-action-count',
    bounded(candidate.previousActionCount, 0, 4) / 4,
  );
  add(
    'action:cost-networth-ratio',
    bounded(candidate.costToNetWorthRatio ?? 0, 0, 2) / 2,
  );
  add(
    `action:hero-tier:${heroId}:${tier}`,
    Math.log1p(Math.max(0, row.state.netWorth ?? 0)) / 12,
  );
  return finalizeFeatures(features);
}

function requiredCandidatePrediction(
  prediction: RecommendationValueV8CandidateSetPrediction,
  actionKey: string,
): RecommendationValueV8CandidatePrediction {
  const value = prediction.candidates.find(
    (candidate) => candidate.actionKey === actionKey,
  );
  if (!value) {
    throw new Error(`Recommendation Value V8 prediction lost ${actionKey}.`);
  }
  return value;
}

function addTarget(
  result: RecommendationValueV8HorizonValues,
  horizon: RecommendationValueV8Horizon,
  value: number | undefined,
): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isFinite(value)) {
    throw new Error(`Recommendation Value V8 ${horizon} target is invalid.`);
  }
  result[horizon] = clamp(value, -1, 1);
}

function createHorizonWeightTable(
  hashDimension: number,
): Record<RecommendationValueV8Horizon, number[]> {
  return {
    '3m': Array.from({ length: hashDimension }, () => 0),
    '5m': Array.from({ length: hashDimension }, () => 0),
    '10m': Array.from({ length: hashDimension }, () => 0),
  };
}

function emptyHorizonCounts(): Record<RecommendationValueV8Horizon, number> {
  return { '3m': 0, '5m': 0, '10m': 0 };
}

function validateModelWeights(
  hashDimension: number,
  weights: Record<RecommendationValueV8Horizon, number[]>,
): void {
  validateHashDimension(hashDimension);
  for (const horizon of RECOMMENDATION_VALUE_V8_HORIZONS) {
    if (
      !Array.isArray(weights[horizon]) ||
      weights[horizon].length !== hashDimension ||
      weights[horizon].some((value) => !Number.isFinite(value))
    ) {
      throw new Error(`Recommendation Value V8 ${horizon} weights are invalid.`);
    }
  }
}

function validateHashDimension(hashDimension: number): void {
  if (!Number.isSafeInteger(hashDimension) || hashDimension < 256) {
    throw new Error('Recommendation Value V8 hashDimension must be at least 256.');
  }
}

function validateStateTrainingOptions(
  options: RecommendationValueV8StateTrainingOptions,
): void {
  positive(options.learningRate, 'state learningRate');
  nonNegative(options.l2, 'state l2');
  positive(options.maximumAbsolutePrediction, 'maximumAbsolutePrediction');
}

function validateActionTrainingOptions(
  options: RecommendationValueV8ActionTrainingOptions,
): void {
  positive(options.learningRate, 'action learningRate');
  nonNegative(options.l2, 'action l2');
  positive(options.maximumAbsoluteResidual, 'maximumAbsoluteResidual');
  if (
    !Number.isFinite(options.propensityFloor) ||
    options.propensityFloor <= 0 ||
    options.propensityFloor >= 1
  ) {
    throw new Error('Recommendation Value V8 propensityFloor must be in (0, 1).');
  }
  if (
    !Number.isFinite(options.maximumImportanceWeight) ||
    options.maximumImportanceWeight < 1
  ) {
    throw new Error('Recommendation Value V8 maximumImportanceWeight must be at least 1.');
  }
}

function validateDiagnosticThresholds(
  thresholds: RecommendationValueV8DiagnosticThresholds,
): void {
  if (
    !Number.isSafeInteger(thresholds.minimumTuningDecisionCount) ||
    thresholds.minimumTuningDecisionCount < 1
  ) {
    throw new Error('minimumTuningDecisionCount must be positive.');
  }
  for (const [name, value] of Object.entries(thresholds)) {
    if (name === 'minimumTuningDecisionCount') {
      continue;
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a finite non-negative number.`);
    }
  }
  if (thresholds.minimumCandidateSensitiveDecisionRate > 1) {
    throw new Error('minimumCandidateSensitiveDecisionRate must not exceed 1.');
  }
}

function featureAdder(
  features: Map<number, number>,
  hashDimension: number,
): (key: string, value?: number) => void {
  return (key: string, value = 1): void => {
    if (!Number.isFinite(value) || value === 0) {
      return;
    }
    const hash = fnv1a(key);
    const index = hash % hashDimension;
    const sign = (hash & 0x80000000) === 0 ? 1 : -1;
    features.set(index, (features.get(index) ?? 0) + sign * value);
  };
}

function finalizeFeatures(features: Map<number, number>): SparseFeature[] {
  return [...features.entries()]
    .map(([index, value]) => ({ index, value }))
    .filter((feature) => Number.isFinite(feature.value) && feature.value !== 0)
    .sort((left, right) => left.index - right.index);
}

function dot(weights: readonly number[], features: readonly SparseFeature[]): number {
  return features.reduce(
    (sum, feature) => sum + weights[feature.index] * feature.value,
    0,
  );
}

function healthRatio(row: RecommendationProDecisionDatasetV6Row): number {
  const health = row.state.health;
  const maximum = row.state.maxHealth;
  if (
    health === undefined ||
    maximum === undefined ||
    !Number.isFinite(health) ||
    !Number.isFinite(maximum) ||
    maximum <= 0
  ) {
    return 0;
  }
  return bounded(health / maximum, 0, 1);
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive.`);
  }
}

function nonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative.`);
  }
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
