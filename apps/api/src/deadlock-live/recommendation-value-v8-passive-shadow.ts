import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationDatasetV6StateFeatures,
} from './recommendation-pro-decision-dataset-v6';
import {
  RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION,
  RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
  RECOMMENDATION_VALUE_V8_HORIZONS,
  RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION,
  validateRecommendationValueV8ActionModel,
  validateRecommendationValueV8StateModel,
  type RecommendationValueV8ActionModel,
  type RecommendationValueV8Horizon,
  type RecommendationValueV8HorizonValues,
  type RecommendationValueV8StateModel,
} from './recommendation-value-v8-diagnostic';
import {
  RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
  RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION,
  type RecommendationValueV8Configuration,
} from './recommendation-value-v8-full-evaluation';

export const RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_SCHEMA_VERSION = 1;
export const RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_VERSION =
  'RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_1' as const;

const HORIZON_WEIGHTS: Record<RecommendationValueV8Horizon, number> = {
  '3m': 0.2,
  '5m': 0.3,
  '10m': 0.5,
};

interface SparseFeature {
  index: number;
  value: number;
}

export interface RecommendationValueV8RuntimeRow {
  state: RecommendationDatasetV6StateFeatures;
  candidates: RecommendationDatasetV6CandidateFeatures[];
}

export interface RecommendationValueV8RuntimeCandidateScore {
  actionKey: string;
  itemId: number;
  score: number;
  stateUtility: number;
  actionAdvantage: number;
  rank: number;
  supported: boolean;
  horizonAdvantages: RecommendationValueV8HorizonValues;
}

export interface RecommendationValueV8RuntimePrediction {
  statePredictions: RecommendationValueV8HorizonValues;
  stateUtility: number;
  candidateScores: RecommendationValueV8RuntimeCandidateScore[];
  candidateSeparation: number;
  maximumAbsoluteCenteredMean: number;
}

export interface RecommendationValueV8RuntimeModelArtifact {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION;
  evaluationVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION;
  generatedAt: string;
  stateModelVersion: typeof RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION;
  actionModelVersion: typeof RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION;
  featureVersion: typeof RECOMMENDATION_VALUE_V8_FEATURE_VERSION;
  selectedConfiguration: RecommendationValueV8Configuration;
  selectedOn: 'TUNING_ONLY';
  options: {
    state: { maximumAbsolutePrediction: number };
    action: { maximumAbsoluteResidual: number };
  };
  finalStateModel: RecommendationValueV8StateModel;
  actionModel: RecommendationValueV8ActionModel;
}

export interface RecommendationValueV8PassiveShadowAuthorizationManifest {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION;
  evaluationVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION;
  releaseGatePassed: boolean;
  passiveShadowAuthorized: boolean;
  randomizedCanaryAuthorized: false;
  selectedConfiguration: RecommendationValueV8Configuration;
  artifacts: {
    model: {
      sha256: string;
    };
  };
}

export interface RecommendationValueV8PassiveShadowAuthorizationAudit {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION;
  evaluationVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION;
  passed: boolean;
  releaseGatePassed: boolean;
  passiveShadowAuthorized: boolean;
  randomizedCanaryAuthorized: false;
  artifacts: {
    modelSha256: string;
  };
}

export interface RecommendationValueV8PassiveShadowThresholds {
  minimumMatchCount: number;
  minimumDecisionCount: number;
  minimumCandidateCoverage: number;
  maximumFallbackRate: number;
  maximumCriticalErrorCount: number;
  maximumZeroSeparationRate: number;
  maximumP95LatencyMs: number;
}

export const DEFAULT_RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_THRESHOLDS:
  RecommendationValueV8PassiveShadowThresholds = {
    minimumMatchCount: 1_000,
    minimumDecisionCount: 100_000,
    minimumCandidateCoverage: 0.99,
    maximumFallbackRate: 0.005,
    maximumCriticalErrorCount: 0,
    maximumZeroSeparationRate: 0.05,
    maximumP95LatencyMs: 100,
  };

export interface RecommendationValueV8PassiveShadowObservation {
  decisionId: string;
  matchId: string;
  expectedCandidateCount: number;
  scoredCandidateCount: number;
  missingFeature: boolean;
  fallback: boolean;
  criticalError: boolean;
  latencyMs: number;
  heapUsedBytes: number;
  candidateSeparation: number;
  changedTop1: boolean;
  catalogVersion: string;
  modelSha256: string;
}

export interface RecommendationValueV8PassiveShadowAccumulator {
  decisionIds: Set<string>;
  matchIds: Set<string>;
  decisionCount: number;
  duplicateDecisionCount: number;
  expectedCandidateCount: number;
  scoredCandidateCount: number;
  missingFeatureDecisionCount: number;
  fallbackCount: number;
  criticalErrorCount: number;
  zeroSeparationCount: number;
  changedTop1Count: number;
  latencySumMs: number;
  latencySamplesMs: number[];
  maximumLatencyMs: number;
  maximumHeapUsedBytes: number;
  separationSum: number;
  catalogVersionDistribution: Record<string, number>;
  modelVersionDistribution: Record<string, number>;
}

export interface RecommendationValueV8PassiveShadowMetrics {
  matchCount: number;
  decisionCount: number;
  duplicateDecisionCount: number;
  expectedCandidateCount: number;
  scoredCandidateCount: number;
  candidateCoverage: number;
  missingFeatureRate: number;
  fallbackRate: number;
  criticalErrorCount: number;
  zeroSeparationRate: number;
  top1DisagreementRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  maximumLatencyMs: number;
  maximumHeapUsedBytes: number;
  averageCandidateSeparation: number;
  catalogVersionDistribution: Record<string, number>;
  modelVersionDistribution: Record<string, number>;
}

export interface RecommendationValueV8PassiveShadowGate {
  passed: boolean;
  thresholds: RecommendationValueV8PassiveShadowThresholds;
  checks: {
    matchCount: boolean;
    decisionCount: boolean;
    candidateCoverage: boolean;
    fallbackRate: boolean;
    criticalErrors: boolean;
    scoreSeparation: boolean;
    latency: boolean;
    duplicateDecisions: boolean;
  };
  reasons: string[];
  randomizedCanaryAuthorized: false;
}

export function validateRecommendationValueV8PassiveShadowAuthorization(input: {
  manifest: RecommendationValueV8PassiveShadowAuthorizationManifest;
  audit: RecommendationValueV8PassiveShadowAuthorizationAudit;
  model: RecommendationValueV8RuntimeModelArtifact;
  modelSha256: string;
}): void {
  const { manifest, audit, model, modelSha256 } = input;
  if (
    manifest.schemaVersion !==
      RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION ||
    audit.schemaVersion !==
      RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION ||
    model.schemaVersion !==
      RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION ||
    manifest.evaluationVersion !==
      RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION ||
    audit.evaluationVersion !== RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION ||
    model.evaluationVersion !== RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION
  ) {
    throw new Error('Value V8 passive shadow artifact version is unsupported.');
  }
  if (
    manifest.releaseGatePassed !== true ||
    manifest.passiveShadowAuthorized !== true ||
    audit.passed !== true ||
    audit.releaseGatePassed !== true ||
    audit.passiveShadowAuthorized !== true ||
    manifest.randomizedCanaryAuthorized !== false ||
    audit.randomizedCanaryAuthorized !== false
  ) {
    throw new Error('Value V8 offline release artifacts did not authorize passive shadow.');
  }
  if (
    !isSha256(modelSha256) ||
    manifest.artifacts.model.sha256 !== modelSha256 ||
    audit.artifacts.modelSha256 !== modelSha256
  ) {
    throw new Error('Value V8 passive shadow model SHA-256 is inconsistent.');
  }
  if (
    model.stateModelVersion !== RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION ||
    model.actionModelVersion !== RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION ||
    model.featureVersion !== RECOMMENDATION_VALUE_V8_FEATURE_VERSION ||
    model.selectedOn !== 'TUNING_ONLY' ||
    !sameConfiguration(model.selectedConfiguration, manifest.selectedConfiguration)
  ) {
    throw new Error('Value V8 passive shadow model contract is incompatible.');
  }
  validateRecommendationValueV8StateModel(model.finalStateModel);
  validateRecommendationValueV8ActionModel(model.actionModel);
  positive(model.options.state.maximumAbsolutePrediction, 'maximumAbsolutePrediction');
  positive(model.options.action.maximumAbsoluteResidual, 'maximumAbsoluteResidual');
}

export function predictRecommendationValueV8Runtime(input: {
  row: RecommendationValueV8RuntimeRow;
  model: RecommendationValueV8RuntimeModelArtifact;
}): RecommendationValueV8RuntimePrediction {
  const { row, model } = input;
  validateRecommendationValueV8StateModel(model.finalStateModel);
  validateRecommendationValueV8ActionModel(model.actionModel);
  if (row.candidates.length < 2) {
    throw new Error('Value V8 passive shadow requires at least two candidates.');
  }
  const stateFeaturesValue = stateFeatures(
    row.state,
    model.finalStateModel.hashDimension,
  );
  const statePredictions = Object.fromEntries(
    RECOMMENDATION_VALUE_V8_HORIZONS.map((horizon) => [
      horizon,
      clamp(
        dot(model.finalStateModel.weights[horizon], stateFeaturesValue),
        -model.options.state.maximumAbsolutePrediction,
        model.options.state.maximumAbsolutePrediction,
      ),
    ]),
  ) as Record<RecommendationValueV8Horizon, number>;
  const rawResiduals = row.candidates.map((candidate) => ({
    candidate,
    values: Object.fromEntries(
      RECOMMENDATION_VALUE_V8_HORIZONS.map((horizon) => [
        horizon,
        clamp(
          dot(
            model.actionModel.weights[horizon],
            actionFeatures(row.state, candidate, model.actionModel.hashDimension),
          ),
          -model.options.action.maximumAbsoluteResidual,
          model.options.action.maximumAbsoluteResidual,
        ),
      ]),
    ) as Record<RecommendationValueV8Horizon, number>,
  }));
  const means = Object.fromEntries(
    RECOMMENDATION_VALUE_V8_HORIZONS.map((horizon) => [
      horizon,
      mean(rawResiduals.map((value) => value.values[horizon])),
    ]),
  ) as Record<RecommendationValueV8Horizon, number>;
  const stateUtility = aggregateHorizonValues(statePredictions);
  const scores = rawResiduals.map(({ candidate, values }) => {
    const horizonAdvantages = Object.fromEntries(
      RECOMMENDATION_VALUE_V8_HORIZONS.map((horizon) => [
        horizon,
        values[horizon] - means[horizon],
      ]),
    ) as Record<RecommendationValueV8Horizon, number>;
    const actionAdvantage = aggregateHorizonValues(horizonAdvantages);
    return {
      actionKey: candidate.actionKey,
      itemId: candidate.itemId,
      score: clamp(
        stateUtility + model.selectedConfiguration.actionScale * actionAdvantage,
        -1,
        1,
      ),
      stateUtility,
      actionAdvantage,
      rank: 0,
      supported: candidate.catalogMetadataAvailable,
      horizonAdvantages,
    };
  });
  const candidateScores = scores
    .sort(
      (left, right) =>
        right.score - left.score || left.actionKey.localeCompare(right.actionKey),
    )
    .map((value, index) => ({ ...value, rank: index + 1 }));
  const scoreValues = candidateScores.map((value) => value.score);
  const maximumAbsoluteCenteredMean = Math.max(
    ...RECOMMENDATION_VALUE_V8_HORIZONS.map((horizon) =>
      Math.abs(
        mean(
          candidateScores.map(
            (candidate) => candidate.horizonAdvantages[horizon] ?? 0,
          ),
        ),
      ),
    ),
  );
  return {
    statePredictions,
    stateUtility,
    candidateScores,
    candidateSeparation: Math.max(...scoreValues) - Math.min(...scoreValues),
    maximumAbsoluteCenteredMean,
  };
}

export function createRecommendationValueV8PassiveShadowAccumulator(): RecommendationValueV8PassiveShadowAccumulator {
  return {
    decisionIds: new Set(),
    matchIds: new Set(),
    decisionCount: 0,
    duplicateDecisionCount: 0,
    expectedCandidateCount: 0,
    scoredCandidateCount: 0,
    missingFeatureDecisionCount: 0,
    fallbackCount: 0,
    criticalErrorCount: 0,
    zeroSeparationCount: 0,
    changedTop1Count: 0,
    latencySumMs: 0,
    latencySamplesMs: [],
    maximumLatencyMs: 0,
    maximumHeapUsedBytes: 0,
    separationSum: 0,
    catalogVersionDistribution: {},
    modelVersionDistribution: {},
  };
}

export function observeRecommendationValueV8PassiveShadow(
  accumulator: RecommendationValueV8PassiveShadowAccumulator,
  observation: RecommendationValueV8PassiveShadowObservation,
): void {
  validateObservation(observation);
  if (accumulator.decisionIds.has(observation.decisionId)) {
    accumulator.duplicateDecisionCount += 1;
    return;
  }
  accumulator.decisionIds.add(observation.decisionId);
  accumulator.matchIds.add(observation.matchId);
  accumulator.decisionCount += 1;
  accumulator.expectedCandidateCount += observation.expectedCandidateCount;
  accumulator.scoredCandidateCount += observation.scoredCandidateCount;
  accumulator.missingFeatureDecisionCount += observation.missingFeature ? 1 : 0;
  accumulator.fallbackCount += observation.fallback ? 1 : 0;
  accumulator.criticalErrorCount += observation.criticalError ? 1 : 0;
  accumulator.zeroSeparationCount += observation.candidateSeparation <= 1e-9 ? 1 : 0;
  accumulator.changedTop1Count += observation.changedTop1 ? 1 : 0;
  accumulator.latencySumMs += observation.latencyMs;
  accumulator.maximumLatencyMs = Math.max(
    accumulator.maximumLatencyMs,
    observation.latencyMs,
  );
  accumulator.maximumHeapUsedBytes = Math.max(
    accumulator.maximumHeapUsedBytes,
    observation.heapUsedBytes,
  );
  accumulator.separationSum += observation.candidateSeparation;
  if (accumulator.latencySamplesMs.length < 200_000) {
    accumulator.latencySamplesMs.push(observation.latencyMs);
  }
  increment(accumulator.catalogVersionDistribution, observation.catalogVersion);
  increment(accumulator.modelVersionDistribution, observation.modelSha256);
}

export function finalizeRecommendationValueV8PassiveShadowMetrics(
  accumulator: RecommendationValueV8PassiveShadowAccumulator,
): RecommendationValueV8PassiveShadowMetrics {
  const decisions = Math.max(1, accumulator.decisionCount);
  const sortedLatency = [...accumulator.latencySamplesMs].sort(
    (left, right) => left - right,
  );
  return {
    matchCount: accumulator.matchIds.size,
    decisionCount: accumulator.decisionCount,
    duplicateDecisionCount: accumulator.duplicateDecisionCount,
    expectedCandidateCount: accumulator.expectedCandidateCount,
    scoredCandidateCount: accumulator.scoredCandidateCount,
    candidateCoverage: ratio(
      accumulator.scoredCandidateCount,
      accumulator.expectedCandidateCount,
    ),
    missingFeatureRate: accumulator.missingFeatureDecisionCount / decisions,
    fallbackRate: accumulator.fallbackCount / decisions,
    criticalErrorCount: accumulator.criticalErrorCount,
    zeroSeparationRate: accumulator.zeroSeparationCount / decisions,
    top1DisagreementRate: accumulator.changedTop1Count / decisions,
    averageLatencyMs: accumulator.latencySumMs / decisions,
    p95LatencyMs: percentile(sortedLatency, 0.95),
    maximumLatencyMs: accumulator.maximumLatencyMs,
    maximumHeapUsedBytes: accumulator.maximumHeapUsedBytes,
    averageCandidateSeparation: accumulator.separationSum / decisions,
    catalogVersionDistribution: sortRecord(
      accumulator.catalogVersionDistribution,
    ),
    modelVersionDistribution: sortRecord(
      accumulator.modelVersionDistribution,
    ),
  };
}

export function buildRecommendationValueV8PassiveShadowGate(
  metrics: RecommendationValueV8PassiveShadowMetrics,
  thresholds: RecommendationValueV8PassiveShadowThresholds =
    DEFAULT_RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_THRESHOLDS,
): RecommendationValueV8PassiveShadowGate {
  validateThresholds(thresholds);
  const checks = {
    matchCount: metrics.matchCount >= thresholds.minimumMatchCount,
    decisionCount: metrics.decisionCount >= thresholds.minimumDecisionCount,
    candidateCoverage:
      metrics.candidateCoverage >= thresholds.minimumCandidateCoverage,
    fallbackRate: metrics.fallbackRate <= thresholds.maximumFallbackRate,
    criticalErrors:
      metrics.criticalErrorCount <= thresholds.maximumCriticalErrorCount,
    scoreSeparation:
      metrics.zeroSeparationRate <= thresholds.maximumZeroSeparationRate,
    latency: metrics.p95LatencyMs <= thresholds.maximumP95LatencyMs,
    duplicateDecisions: metrics.duplicateDecisionCount === 0,
  };
  const reasons: string[] = [];
  if (!checks.matchCount) reasons.push('Shadow match count is below the minimum.');
  if (!checks.decisionCount) reasons.push('Shadow decision count is below the minimum.');
  if (!checks.candidateCoverage) reasons.push('Shadow candidate coverage is below the minimum.');
  if (!checks.fallbackRate) reasons.push('Shadow fallback rate exceeds the maximum.');
  if (!checks.criticalErrors) reasons.push('Shadow contains critical prediction errors.');
  if (!checks.scoreSeparation) reasons.push('Shadow candidate scores collapse too frequently.');
  if (!checks.latency) reasons.push('Shadow prediction latency exceeds the limit.');
  if (!checks.duplicateDecisions) reasons.push('Shadow log contains duplicate decisions.');
  return {
    passed: reasons.length === 0,
    thresholds: { ...thresholds },
    checks,
    reasons,
    randomizedCanaryAuthorized: false,
  };
}

export function recommendationValueV8RuntimeFeatureIndex(
  key: string,
  hashDimension: number,
): { index: number; sign: 1 | -1 } {
  const hash = fnv1a(key);
  return {
    index: hash % hashDimension,
    sign: (hash & 0x80000000) === 0 ? 1 : -1,
  };
}

function stateFeatures(
  state: RecommendationDatasetV6StateFeatures,
  hashDimension: number,
): SparseFeature[] {
  const features = new Map<number, number>();
  const add = featureAdder(features, hashDimension);
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
  for (const heroId of state.alliedHeroIds) add(`state:ally:${heroId}`, 0.2);
  for (const heroId of state.enemyHeroIds) add(`state:enemy:${heroId}`, 0.2);
  add('state:time-value', bounded(state.gameTimeS, 0, 3_600) / 3_600);
  add('state:networth', Math.log1p(Math.max(0, state.netWorth ?? 0)) / 12);
  add('state:kills', bounded(state.kills ?? 0, 0, 30) / 30);
  add('state:deaths', bounded(state.deaths ?? 0, 0, 30) / 30);
  add('state:assists', bounded(state.assists ?? 0, 0, 40) / 40);
  add('state:hero-damage', Math.log1p(Math.max(0, state.heroDamage ?? 0)) / 14);
  add('state:level', bounded(state.level ?? 0, 0, 30) / 30);
  add('state:health-ratio', healthRatio(state));
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
  state: RecommendationDatasetV6StateFeatures,
  candidate: RecommendationDatasetV6CandidateFeatures,
  hashDimension: number,
): SparseFeature[] {
  const features = new Map<number, number>();
  const add = featureAdder(features, hashDimension);
  const heroId = state.heroId;
  const timeBucket = Math.floor(state.gameTimeS / 300);
  const slot = candidate.slotType ?? 'UNKNOWN';
  const tier = candidate.tier ?? -1;
  add('action:bias');
  add(`action:type:${candidate.actionType}`);
  add(`action:hero-item:${heroId}:${candidate.itemId}`, 0.35);
  add(`action:phase-tier:${state.phase}:${tier}`);
  add(`action:time-tier:${timeBucket}:${tier}`);
  add(`action:slot:${slot}`);
  add(`action:hero-slot:${heroId}:${slot}`);
  add(`action:tier:${tier}`);
  add(`action:active:${candidate.isActiveItem === true ? 1 : 0}`);
  for (const tag of candidate.tags) {
    add(`action:tag:${tag}`);
    add(`action:hero-tag:${heroId}:${tag}`);
    add(`action:phase-tag:${state.phase}:${tag}`);
    add(
      `action:inventory-tag:${tag}`,
      bounded(state.inventoryTagCounts[tag] ?? 0, 0, 8) / 8,
    );
    for (const enemyHeroId of state.enemyHeroIds) {
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
  add('action:required-components', bounded(candidate.requiredComponentCount, 0, 8) / 8);
  add('action:owned-components', bounded(candidate.ownedComponentCount, 0, 8) / 8);
  add('action:missing-components', bounded(candidate.missingComponentCount, 0, 8) / 8);
  add('action:complete-recipe', candidate.hasCompleteRecipeComponents ? 1 : 0);
  add('action:already-owned', bounded(candidate.alreadyOwnedCount, 0, 4) / 4);
  add('action:same-slot-owned', bounded(candidate.sameSlotOwnedItemCount, 0, 8) / 8);
  add(
    'action:inventory-tag-overlap',
    bounded(candidate.inventoryTagOverlapCount, 0, 16) / 16,
  );
  add('action:previous-action-count', bounded(candidate.previousActionCount, 0, 4) / 4);
  add(
    'action:cost-networth-ratio',
    bounded(candidate.costToNetWorthRatio ?? 0, 0, 2) / 2,
  );
  add(
    `action:hero-tier:${heroId}:${tier}`,
    Math.log1p(Math.max(0, state.netWorth ?? 0)) / 12,
  );
  return finalizeFeatures(features);
}

function featureAdder(
  features: Map<number, number>,
  hashDimension: number,
): (key: string, value?: number) => void {
  return (key: string, value = 1): void => {
    if (!Number.isFinite(value) || value === 0) return;
    const { index, sign } = recommendationValueV8RuntimeFeatureIndex(
      key,
      hashDimension,
    );
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

function aggregateHorizonValues(values: RecommendationValueV8HorizonValues): number {
  return RECOMMENDATION_VALUE_V8_HORIZONS.reduce(
    (sum, horizon) => sum + HORIZON_WEIGHTS[horizon] * (values[horizon] ?? 0),
    0,
  );
}

function healthRatio(state: RecommendationDatasetV6StateFeatures): number {
  if (
    state.health === undefined ||
    state.maxHealth === undefined ||
    !Number.isFinite(state.health) ||
    !Number.isFinite(state.maxHealth) ||
    state.maxHealth <= 0
  ) {
    return 0;
  }
  return bounded(state.health / state.maxHealth, 0, 1);
}

function validateObservation(
  observation: RecommendationValueV8PassiveShadowObservation,
): void {
  if (!observation.decisionId.trim() || !observation.matchId.trim()) {
    throw new Error('Passive shadow observation identity is invalid.');
  }
  for (const value of [
    observation.expectedCandidateCount,
    observation.scoredCandidateCount,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Passive shadow candidate count is invalid.');
    }
  }
  if (observation.scoredCandidateCount > observation.expectedCandidateCount) {
    throw new Error('Passive shadow scored more candidates than expected.');
  }
  for (const value of [
    observation.latencyMs,
    observation.heapUsedBytes,
    observation.candidateSeparation,
  ]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('Passive shadow numeric observation is invalid.');
    }
  }
}

function validateThresholds(
  thresholds: RecommendationValueV8PassiveShadowThresholds,
): void {
  for (const value of [thresholds.minimumMatchCount, thresholds.minimumDecisionCount]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error('Passive shadow count threshold must be positive.');
    }
  }
  for (const value of [
    thresholds.minimumCandidateCoverage,
    thresholds.maximumFallbackRate,
    thresholds.maximumZeroSeparationRate,
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('Passive shadow rate threshold must be between zero and one.');
    }
  }
  if (
    !Number.isSafeInteger(thresholds.maximumCriticalErrorCount) ||
    thresholds.maximumCriticalErrorCount < 0
  ) {
    throw new Error('Passive shadow critical-error threshold is invalid.');
  }
  positive(thresholds.maximumP95LatencyMs, 'maximumP95LatencyMs');
}

function sameConfiguration(
  left: RecommendationValueV8Configuration,
  right: RecommendationValueV8Configuration,
): boolean {
  return (
    left.actionScale === right.actionScale &&
    left.policyTemperature === right.policyTemperature
  );
}

function percentile(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * value) - 1),
  );
  return sorted[index];
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
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

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive.`);
  }
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
