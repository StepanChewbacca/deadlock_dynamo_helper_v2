import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationProDecisionDatasetV6Row,
} from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';
import {
  predictRecommendationV6DatasetV6Baseline,
  prepareRecommendationValueV6DatasetV6Row,
  rehydrateRecommendationV6FrozenShortOnlyModel,
  validateRecommendationV6FrozenShortOnlyModelArtifact,
  type RecommendationV6FrozenShortOnlyModelArtifact,
} from '../src/deadlock-live/recommendation-v6-short-only-dataset-v6-baseline';

const MODEL_SHA = 'a'.repeat(64);
const DATASET_SHA = 'b'.repeat(64);
const SPLIT_SHA = 'c'.repeat(64);

describe('Frozen V6 short-only Dataset V6 baseline', () => {
  it('rejects any model that is not the frozen short-only configuration', () => {
    const value = artifact(row());
    expect(() =>
      validateRecommendationV6FrozenShortOnlyModelArtifact(value),
    ).not.toThrow();

    const invalid = structuredClone(value);
    invalid.options.actionPriorStrength = 0.2;
    expect(() =>
      validateRecommendationV6FrozenShortOnlyModelArtifact(invalid),
    ).toThrow('incompatible');
  });

  it('rehydrates serialized counts and predicts the exact Dataset V6 candidates', () => {
    const value = row();
    const modelArtifact = artifact(value);
    const model = rehydrateRecommendationV6FrozenShortOnlyModel(modelArtifact);
    const baseline = predictRecommendationV6DatasetV6Baseline({
      artifact: modelArtifact,
      model,
      row: value,
      sourceModelSha256: MODEL_SHA,
      sourceDatasetSha256: DATASET_SHA,
      splitDescriptorSha256: SPLIT_SHA,
    });

    expect(baseline.productionCommit).toBe('251660f');
    expect(baseline.targetUtility).toBeCloseTo(0.5);
    expect(baseline.candidateRanking.map((candidate) => candidate.actionKey).sort()).toEqual([
      'BUY:100',
      'BUY:200',
    ]);
    expect(baseline.candidateRanking[0].actionKey).toBe('BUY:100');
    expect(baseline.observedActionAdvantage).toBeGreaterThan(0);
    expect(baseline.sourceModelSha256).toBe(MODEL_SHA);
    expect(baseline.sourceDatasetSha256).toBe(DATASET_SHA);
    expect(baseline.splitDescriptorSha256).toBe(SPLIT_SHA);
  });

  it('records feature families that cannot be reconstructed from Dataset V6', () => {
    const prepared = prepareRecommendationValueV6DatasetV6Row(row());

    expect(prepared.unavailableFeatureFamilies).toEqual([
      'BUILD_TOTAL_COST',
      'BUILD_HIGHEST_TIER',
      'TEAM_ECONOMY',
      'ORIGINAL_V5_INTERACTION_KEYS',
    ]);
    expect(prepared.source.stateKeys).toContain('HERO:1');
    expect(prepared.source.candidateActions).toHaveLength(2);
  });
});

function artifact(
  value: RecommendationProDecisionDatasetV6Row,
): RecommendationV6FrozenShortOnlyModelArtifact {
  const prepared = prepareRecommendationValueV6DatasetV6Row(value);
  const positiveKeys = prepared.candidateActionKeys.get('BUY:100') ?? [];
  const negativeKeys = prepared.candidateActionKeys.get('BUY:200') ?? [];
  return {
    schemaVersion: 1,
    modelVersion: 'RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1',
    generatedAt: '2026-07-28T00:00:00.000Z',
    modelKind: 'OBSERVATIONAL_STATE_ACTION_ADVANTAGE',
    target: 'SHORT_HORIZON_UTILITY_WITH_FINAL_OUTCOME_AUXILIARY',
    weighting: 'EQUAL_TOTAL_WEIGHT_PER_MATCH',
    combination: 'STATE_VALUE_PLUS_TUNED_ACTION_ADVANTAGE',
    actionResidualScale: 1,
    options: {
      statePriorStrength: 10,
      actionPriorStrength: 0.1,
      minimumObservations: 10,
      maximumAbsoluteStateResidual: 1,
      maximumAbsoluteActionResidual: 1,
    },
    targetComposition: {
      finalOutcomeWeight: 0,
      shortHorizonWeight: 1,
      horizons: ['3m', '5m', '10m'],
    },
    counts: {
      version: 'RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1',
      global: count(0, 100),
      state: Object.fromEntries(
        prepared.source.stateKeys.map((key) => [key, count(0, 20)]),
      ),
      action: {
        ...Object.fromEntries(positiveKeys.map((key) => [key, count(0.6, 20)])),
        ...Object.fromEntries(negativeKeys.map((key) => [key, count(-0.6, 20)])),
      },
    },
  };
}

function count(mean: number, observations: number) {
  return {
    utilitySum: mean * observations,
    utilitySquaredSum: mean * mean * observations,
    winWeight: observations / 2,
    totalWeight: observations,
    observations,
  };
}

function row(): RecommendationProDecisionDatasetV6Row {
  return {
    schemaVersion: 1,
    datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_1',
    dataSource: 'PRO_HISTORICAL',
    decisionSource: 'HISTORICAL_REPLAY',
    decisionId: 'decision-future',
    matchId: 'match-future',
    matchStartTime: '2026-07-01T00:00:00.000Z',
    playerId: '1',
    split: 'FUTURE_TEST',
    state: {
      heroId: 1,
      team: 0,
      phase: 'EARLY',
      gameTimeS: 600,
      inventoryStateKey: '50x1',
      inventoryItemCounts: [{ itemId: 50, count: 1 }],
      previousActionKeys: ['BUY:50'],
      alliedHeroIds: [1, 2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
      inventoryTagCounts: { WEAPON: 1 },
      timelineJoined: true,
      timelineSnapshotLagS: 1,
      kills: 2,
      deaths: 1,
      assists: 3,
      netWorth: 8_000,
      heroDamage: 4_000,
      health: 900,
      maxHealth: 1_000,
      level: 8,
    },
    candidates: [
      candidate('BUY:100', 100, 3, 3_000),
      candidate('BUY:200', 200, 1, 500),
    ],
    observedActionKey: 'BUY:100',
    observedActionInCandidateSet: true,
    shortHorizonOutcomes: {
      threeMinutes: 0.5,
      fiveMinutes: 0.5,
      tenMinutes: 0.5,
    },
    finalOutcome: 1,
    versions: {
      catalog: 'catalog-1',
      catalogSha256: 'd'.repeat(64),
      candidateGenerator: 'generator-1',
      candidateGeneratorPolicy: 'policy-1',
      candidateGeneratorPolicySha256: 'e'.repeat(64),
      stateFeatures: 'RECOMMENDATION_STATE_FEATURES_V6_1',
      replay: 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_1',
    },
    eligibility: {
      stateModel: true,
      behavioralModel: true,
      actionModel: true,
      exclusionReasons: [],
    },
  };
}

function candidate(
  actionKey: string,
  itemId: number,
  tier: number,
  cost: number,
): RecommendationDatasetV6CandidateFeatures {
  return {
    actionKey,
    actionType: 'BUY',
    itemId,
    rank: itemId === 100 ? 1 : 2,
    generatorScore: itemId === 100 ? 0.6 : 0.4,
    historicalCount: 100,
    historicalProbability: 0.5,
    confidence: 0.8,
    predictedStateKey: `50x1|${itemId}x1`,
    catalogMetadataAvailable: true,
    cost,
    tier,
    slotType: 'WEAPON',
    itemType: 'UPGRADE',
    isActiveItem: false,
    activationType: 'PASSIVE',
    tags: itemId === 100 ? ['DAMAGE'] : ['UTILITY'],
    componentItemIds: [50, 51],
    requiredComponentCount: 2,
    ownedComponentCount: itemId === 100 ? 2 : 0,
    missingComponentCount: itemId === 100 ? 0 : 2,
    hasAnyOwnedComponent: itemId === 100,
    hasCompleteRecipeComponents: itemId === 100,
    alreadyOwnedCount: 0,
    sameSlotOwnedItemCount: 1,
    inventoryTagOverlapCount: 1,
    previousActionCount: 0,
    currentNetWorth: 8_000,
    costToNetWorthRatio: cost / 8_000,
  };
}
