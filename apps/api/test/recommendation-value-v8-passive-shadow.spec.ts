import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationDatasetV6StateFeatures,
} from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';
import {
  buildRecommendationValueV8PassiveShadowGate,
  createRecommendationValueV8PassiveShadowAccumulator,
  finalizeRecommendationValueV8PassiveShadowMetrics,
  observeRecommendationValueV8PassiveShadow,
  predictRecommendationValueV8Runtime,
  recommendationValueV8RuntimeFeatureIndex,
  validateRecommendationValueV8PassiveShadowAuthorization,
  type RecommendationValueV8PassiveShadowAuthorizationAudit,
  type RecommendationValueV8PassiveShadowAuthorizationManifest,
  type RecommendationValueV8RuntimeModelArtifact,
} from '../src/deadlock-live/recommendation-value-v8-passive-shadow';
import {
  createRecommendationValueV8ActionModel,
  createRecommendationValueV8StateModel,
} from '../src/deadlock-live/recommendation-value-v8-diagnostic';

const MODEL_SHA = 'a'.repeat(64);

 describe('Recommendation Value V8 passive shadow', () => {
  it('ranks candidates with the same hashed State and Action feature contract', () => {
    const model = modelArtifact();
    const feature = recommendationValueV8RuntimeFeatureIndex(
      'action:hero-item:1:100',
      256,
    );
    for (const horizon of ['3m', '5m', '10m'] as const) {
      model.actionModel.weights[horizon][feature.index] = feature.sign;
    }

    const prediction = predictRecommendationValueV8Runtime({
      model,
      row: {
        state: state(),
        candidates: [candidate(100, 1), candidate(200, 2)],
      },
    });

    expect(prediction.candidateScores.map((value) => value.actionKey)).toEqual([
      'BUY:100',
      'BUY:200',
    ]);
    expect(prediction.candidateScores[0].actionAdvantage).toBeGreaterThan(0);
    expect(prediction.candidateScores[1].actionAdvantage).toBeLessThan(0);
    expect(prediction.candidateSeparation).toBeGreaterThan(0);
    expect(prediction.maximumAbsoluteCenteredMean).toBeLessThanOrEqual(1e-12);
  });

  it('requires the exact offline release and model SHA contract', () => {
    const model = modelArtifact();
    const manifest = authorizationManifest();
    const audit = authorizationAudit();

    expect(() =>
      validateRecommendationValueV8PassiveShadowAuthorization({
        manifest,
        audit,
        model,
        modelSha256: MODEL_SHA,
      }),
    ).not.toThrow();

    expect(() =>
      validateRecommendationValueV8PassiveShadowAuthorization({
        manifest: { ...manifest, passiveShadowAuthorized: false },
        audit,
        model,
        modelSha256: MODEL_SHA,
      }),
    ).toThrow('did not authorize passive shadow');
  });

  it('passes the shadow gate only after the required safe volume', () => {
    const accumulator = createRecommendationValueV8PassiveShadowAccumulator();
    for (let index = 0; index < 4; index += 1) {
      observeRecommendationValueV8PassiveShadow(accumulator, {
        decisionId: `decision-${index}`,
        matchId: `match-${index}`,
        expectedCandidateCount: 2,
        scoredCandidateCount: 2,
        missingFeature: false,
        fallback: false,
        criticalError: false,
        latencyMs: 10,
        heapUsedBytes: 1_000,
        candidateSeparation: 0.1,
        changedTop1: index % 2 === 0,
        catalogVersion: 'catalog-1',
        modelSha256: MODEL_SHA,
      });
    }
    const metrics = finalizeRecommendationValueV8PassiveShadowMetrics(accumulator);
    const gate = buildRecommendationValueV8PassiveShadowGate(metrics, {
      minimumMatchCount: 4,
      minimumDecisionCount: 4,
      minimumCandidateCoverage: 0.99,
      maximumFallbackRate: 0.005,
      maximumCriticalErrorCount: 0,
      maximumZeroSeparationRate: 0,
      maximumP95LatencyMs: 20,
    });

    expect(metrics.candidateCoverage).toBe(1);
    expect(metrics.top1DisagreementRate).toBe(0.5);
    expect(gate.passed).toBe(true);
    expect(gate.randomizedCanaryAuthorized).toBe(false);
  });
});

function modelArtifact(): RecommendationValueV8RuntimeModelArtifact {
  return {
    schemaVersion: 1,
    evaluationVersion: 'RECOMMENDATION_VALUE_V8_FULL_EVALUATION_1',
    generatedAt: '2026-07-28T00:00:00.000Z',
    stateModelVersion: 'RECOMMENDATION_VALUE_V8_HASHED_STATE_1',
    actionModelVersion: 'RECOMMENDATION_VALUE_V8_HASHED_ACTION_RESIDUAL_1',
    featureVersion: 'RECOMMENDATION_VALUE_V8_FEATURES_1',
    selectedConfiguration: { actionScale: 1, policyTemperature: 0.5 },
    selectedOn: 'TUNING_ONLY',
    options: {
      state: { maximumAbsolutePrediction: 1 },
      action: { maximumAbsoluteResidual: 1 },
    },
    finalStateModel: createRecommendationValueV8StateModel(256),
    actionModel: createRecommendationValueV8ActionModel(256),
  };
}

function authorizationManifest(): RecommendationValueV8PassiveShadowAuthorizationManifest {
  return {
    schemaVersion: 1,
    evaluationVersion: 'RECOMMENDATION_VALUE_V8_FULL_EVALUATION_1',
    releaseGatePassed: true,
    passiveShadowAuthorized: true,
    randomizedCanaryAuthorized: false,
    selectedConfiguration: { actionScale: 1, policyTemperature: 0.5 },
    artifacts: { model: { sha256: MODEL_SHA } },
  };
}

function authorizationAudit(): RecommendationValueV8PassiveShadowAuthorizationAudit {
  return {
    schemaVersion: 1,
    evaluationVersion: 'RECOMMENDATION_VALUE_V8_FULL_EVALUATION_1',
    passed: true,
    releaseGatePassed: true,
    passiveShadowAuthorized: true,
    randomizedCanaryAuthorized: false,
    artifacts: { modelSha256: MODEL_SHA },
  };
}

function state(): RecommendationDatasetV6StateFeatures {
  return {
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
    kills: 2,
    deaths: 1,
    assists: 3,
    netWorth: 8_000,
    heroDamage: 4_000,
    health: 900,
    maxHealth: 1_000,
    level: 8,
  };
}

function candidate(
  itemId: number,
  rank: number,
): RecommendationDatasetV6CandidateFeatures {
  return {
    actionKey: `BUY:${itemId}`,
    actionType: 'BUY',
    itemId,
    rank,
    generatorScore: rank === 1 ? 0.6 : 0.4,
    historicalCount: 100,
    historicalProbability: 0.5,
    confidence: 0.8,
    predictedStateKey: `50x1|${itemId}x1`,
    catalogMetadataAvailable: true,
    cost: 3_000,
    tier: 3,
    slotType: 'WEAPON',
    itemType: 'UPGRADE',
    isActiveItem: false,
    activationType: 'PASSIVE',
    tags: ['DAMAGE'],
    componentItemIds: [50],
    requiredComponentCount: 1,
    ownedComponentCount: 1,
    missingComponentCount: 0,
    hasAnyOwnedComponent: true,
    hasCompleteRecipeComponents: true,
    alreadyOwnedCount: 0,
    sameSlotOwnedItemCount: 1,
    inventoryTagOverlapCount: 1,
    previousActionCount: 0,
    currentNetWorth: 8_000,
    costToNetWorthRatio: 0.375,
  };
}
