import type { RecommendationProDecisionDatasetV6Row } from './recommendation-pro-decision-dataset-v6';
import {
  RECOMMENDATION_VALUE_V6_MODEL_VERSION,
  predictRecommendationValueV6,
  type RecommendationValueV6Count,
  type RecommendationValueV6Model,
  type RecommendationValueV6ModelOptions,
  type RecommendationValueV6Prediction,
  type RecommendationValueV6SourceRow,
} from './recommendation-value-v6-model';
import {
  aggregateRecommendationValueV8Target,
  RECOMMENDATION_V6_PRODUCTION_BASELINE_COMMIT,
  RECOMMENDATION_V6_SHORT_ONLY_BASELINE_VERSION,
  RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
  type RecommendationV6ShortOnlyBaselineRow,
} from './recommendation-value-v8-full-evaluation';

const PREVIOUS_ACTION_TAIL_SIZE = 5;

export interface RecommendationV6FrozenShortOnlyModelArtifact {
  schemaVersion: 1;
  modelVersion: typeof RECOMMENDATION_VALUE_V6_MODEL_VERSION;
  generatedAt: string;
  modelKind: 'OBSERVATIONAL_STATE_ACTION_ADVANTAGE';
  target: 'SHORT_HORIZON_UTILITY_WITH_FINAL_OUTCOME_AUXILIARY';
  weighting: 'EQUAL_TOTAL_WEIGHT_PER_MATCH';
  combination: 'STATE_VALUE_PLUS_TUNED_ACTION_ADVANTAGE';
  actionResidualScale: number;
  options: RecommendationValueV6ModelOptions;
  targetComposition: {
    finalOutcomeWeight: 0;
    shortHorizonWeight: 1;
    horizons: ['3m', '5m', '10m'];
  };
  counts: {
    version: typeof RECOMMENDATION_VALUE_V6_MODEL_VERSION;
    global: RecommendationValueV6Count;
    state: Record<string, RecommendationValueV6Count>;
    action: Record<string, RecommendationValueV6Count>;
  };
}

export interface RecommendationV6DatasetV6PreparedRow {
  source: RecommendationValueV6SourceRow;
  candidateActionKeys: Map<string, string[]>;
  unavailableFeatureFamilies: readonly [
    'BUILD_TOTAL_COST',
    'BUILD_HIGHEST_TIER',
    'TEAM_ECONOMY',
    'ORIGINAL_V5_INTERACTION_KEYS',
  ];
}

export function validateRecommendationV6FrozenShortOnlyModelArtifact(
  artifact: RecommendationV6FrozenShortOnlyModelArtifact,
): void {
  if (
    artifact.schemaVersion !== 1 ||
    artifact.modelVersion !== RECOMMENDATION_VALUE_V6_MODEL_VERSION ||
    artifact.modelKind !== 'OBSERVATIONAL_STATE_ACTION_ADVANTAGE' ||
    artifact.target !== 'SHORT_HORIZON_UTILITY_WITH_FINAL_OUTCOME_AUXILIARY' ||
    artifact.weighting !== 'EQUAL_TOTAL_WEIGHT_PER_MATCH' ||
    artifact.combination !== 'STATE_VALUE_PLUS_TUNED_ACTION_ADVANTAGE' ||
    artifact.targetComposition.finalOutcomeWeight !== 0 ||
    artifact.targetComposition.shortHorizonWeight !== 1 ||
    artifact.options.statePriorStrength !== 10 ||
    artifact.options.actionPriorStrength !== 0.1 ||
    artifact.options.minimumObservations !== 10 ||
    artifact.counts.version !== RECOMMENDATION_VALUE_V6_MODEL_VERSION
  ) {
    throw new Error('Frozen V6 short-only model artifact is incompatible.');
  }
  if (
    !Number.isFinite(artifact.actionResidualScale) ||
    artifact.actionResidualScale < 0 ||
    !Number.isFinite(artifact.options.maximumAbsoluteStateResidual) ||
    artifact.options.maximumAbsoluteStateResidual <= 0 ||
    !Number.isFinite(artifact.options.maximumAbsoluteActionResidual) ||
    artifact.options.maximumAbsoluteActionResidual <= 0
  ) {
    throw new Error('Frozen V6 short-only model parameters are invalid.');
  }
  validateCount(artifact.counts.global, 'global');
  for (const [key, count] of Object.entries(artifact.counts.state)) {
    validateCount(count, `state:${key}`);
  }
  for (const [key, count] of Object.entries(artifact.counts.action)) {
    validateCount(count, `action:${key}`);
  }
  if (artifact.counts.global.totalWeight <= 0) {
    throw new Error('Frozen V6 short-only model has no training weight.');
  }
}

export function rehydrateRecommendationV6FrozenShortOnlyModel(
  artifact: RecommendationV6FrozenShortOnlyModelArtifact,
): RecommendationValueV6Model {
  validateRecommendationV6FrozenShortOnlyModelArtifact(artifact);
  return {
    version: artifact.counts.version,
    global: { ...artifact.counts.global },
    state: new Map(
      Object.entries(artifact.counts.state).map(([key, count]) => [
        key,
        { ...count },
      ]),
    ),
    action: new Map(
      Object.entries(artifact.counts.action).map(([key, count]) => [
        key,
        { ...count },
      ]),
    ),
  };
}

export function prepareRecommendationValueV6DatasetV6Row(
  row: RecommendationProDecisionDatasetV6Row,
): RecommendationV6DatasetV6PreparedRow {
  if (
    row.split === 'TRAIN' ||
    !row.eligibility.stateModel ||
    !row.eligibility.actionModel ||
    !row.observedActionInCandidateSet ||
    row.candidates.length < 2
  ) {
    throw new Error(`Dataset V6 row ${row.decisionId} is not baseline eligible.`);
  }
  const targetUtility = aggregateRecommendationValueV8Target(row);
  const heroId = row.state.heroId;
  const timeBucket = Math.floor(row.state.gameTimeS / 300);
  const inventoryStateKey = row.state.inventoryStateKey || 'UNKNOWN';
  const previousTail =
    row.state.previousActionKeys.slice(-PREVIOUS_ACTION_TAIL_SIZE).join('>') ||
    'EMPTY';
  const baseKey = `${heroId}|${timeBucket}`;
  const stateKeys = unique([
    `HERO:${heroId}`,
    `HERO_TIME:${baseKey}`,
    `HERO_TEAM_TIME:${baseKey}|${row.state.team}`,
    `HERO_TIME_INVENTORY:${baseKey}|${inventoryStateKey}`,
    `HERO_TIME_PREVIOUS:${baseKey}|${previousTail}`,
    Number.isFinite(row.state.netWorth)
      ? `TIMELINE_NET_WORTH:${heroId}|${bucket(row.state.netWorth, 1_000)}`
      : undefined,
    `TIMELINE_KDA:${heroId}|${bucket(
      row.state.kills + row.state.assists - row.state.deaths,
      2,
    )}`,
    ...row.state.alliedHeroIds.map(
      (allyHeroId) => `ALLY:${baseKey}|${allyHeroId}`,
    ),
    ...row.state.enemyHeroIds.map(
      (enemyHeroId) => `ENEMY:${baseKey}|${enemyHeroId}`,
    ),
  ]);
  const candidateActionKeys = new Map(
    row.candidates.map((candidate) => [
      candidate.actionKey,
      unique([
        `HERO_TIME_ACTION:${heroId}|${timeBucket}|${candidate.actionKey}`,
        `HERO_TIME_INVENTORY_ACTION:${heroId}|${timeBucket}|${inventoryStateKey}|${candidate.actionKey}`,
        `HERO_TIME_PREVIOUS_ACTION:${heroId}|${timeBucket}|${previousTail}|${candidate.actionKey}`,
        candidate.slotType
          ? `HERO_SLOT:${heroId}|${candidate.slotType}`
          : undefined,
        candidate.tier > 0
          ? `HERO_TIER:${heroId}|${candidate.tier}`
          : undefined,
        candidate.cost > 0
          ? `HERO_COST_BUCKET:${heroId}|${bucket(candidate.cost, 500)}`
          : undefined,
        candidate.isActiveItem ? `HERO_ACTIVE_ITEM:${heroId}` : undefined,
        ...candidate.tags.map((tag) => `HERO_ITEM_TAG:${heroId}|${tag}`),
      ]),
    ]),
  );
  const observedActionKeys = candidateActionKeys.get(row.observedActionKey);
  if (!observedActionKeys) {
    throw new Error(`Dataset V6 observed action is missing for ${row.decisionId}.`);
  }
  return {
    source: {
      decisionId: row.decisionId,
      matchId: row.matchId,
      playerWon: row.finalOutcome > 0,
      targetUtility,
      targetComponents: {
        finalOutcome: row.finalOutcome > 0 ? 1 : -1,
        shortHorizonUtility: targetUtility,
        shortHorizonCount: shortHorizonCount(row),
      },
      stateKeys,
      actionKeys: observedActionKeys,
      observedActionKey: row.observedActionKey,
      candidateActions: row.candidates.map((candidate) => ({
        actionKey: candidate.actionKey,
        actionKeys: candidateActionKeys.get(candidate.actionKey) ?? [],
      })),
    },
    candidateActionKeys,
    unavailableFeatureFamilies: [
      'BUILD_TOTAL_COST',
      'BUILD_HIGHEST_TIER',
      'TEAM_ECONOMY',
      'ORIGINAL_V5_INTERACTION_KEYS',
    ],
  };
}

export function predictRecommendationV6DatasetV6Baseline(input: {
  artifact: RecommendationV6FrozenShortOnlyModelArtifact;
  model: RecommendationValueV6Model;
  row: RecommendationProDecisionDatasetV6Row;
  sourceModelSha256: string;
  sourceDatasetSha256: string;
  splitDescriptorSha256: string;
}): RecommendationV6ShortOnlyBaselineRow {
  const prepared = prepareRecommendationValueV6DatasetV6Row(input.row);
  const predictions = prepared.source.candidateActions.map((candidate) => ({
    actionKey: candidate.actionKey,
    prediction: predictRecommendationValueV6(
      input.model,
      {
        stateKeys: prepared.source.stateKeys,
        actionKeys: candidate.actionKeys,
      },
      input.artifact.options,
      input.artifact.actionResidualScale,
    ),
  }));
  const ranking = [...predictions]
    .sort(
      (left, right) =>
        right.prediction.actionAdvantage - left.prediction.actionAdvantage ||
        left.actionKey.localeCompare(right.actionKey),
    )
    .map((entry, index) => ({
      actionKey: entry.actionKey,
      rank: index + 1,
      actionUtility: entry.prediction.actionUtility,
      actionAdvantage: entry.prediction.actionAdvantage,
    }));
  const observed = predictionFor(predictions, input.row.observedActionKey);
  return {
    schemaVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
    baselineVersion: RECOMMENDATION_V6_SHORT_ONLY_BASELINE_VERSION,
    productionCommit: RECOMMENDATION_V6_PRODUCTION_BASELINE_COMMIT,
    decisionId: input.row.decisionId,
    matchId: input.row.matchId,
    split: input.row.split as 'TUNING' | 'FUTURE_TEST',
    observedActionKey: input.row.observedActionKey,
    targetUtility: prepared.source.targetUtility,
    stateUtility: observed.stateUtility,
    observedActionUtility: observed.actionUtility,
    observedActionAdvantage: observed.actionAdvantage,
    candidateRanking: ranking,
    sourceModelSha256: input.sourceModelSha256,
    sourceDatasetSha256: input.sourceDatasetSha256,
    splitDescriptorSha256: input.splitDescriptorSha256,
  };
}

function predictionFor(
  values: Array<{ actionKey: string; prediction: RecommendationValueV6Prediction }>,
  actionKey: string,
): RecommendationValueV6Prediction {
  const value = values.find((entry) => entry.actionKey === actionKey)?.prediction;
  if (!value) {
    throw new Error(`Frozen V6 prediction is missing for ${actionKey}.`);
  }
  return value;
}

function shortHorizonCount(row: RecommendationProDecisionDatasetV6Row): number {
  return [
    row.shortHorizonOutcomes.threeMinutes,
    row.shortHorizonOutcomes.fiveMinutes,
    row.shortHorizonOutcomes.tenMinutes,
  ].filter((value) => value !== undefined).length;
}

function validateCount(count: RecommendationValueV6Count, label: string): void {
  if (
    !Number.isFinite(count.utilitySum) ||
    !Number.isFinite(count.utilitySquaredSum) ||
    !Number.isFinite(count.winWeight) ||
    !Number.isFinite(count.totalWeight) ||
    !Number.isSafeInteger(count.observations) ||
    count.totalWeight < 0 ||
    count.observations < 0
  ) {
    throw new Error(`Frozen V6 count ${label} is invalid.`);
  }
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function bucket(value: number, size: number): number {
  return Math.floor(value / size) * size;
}
