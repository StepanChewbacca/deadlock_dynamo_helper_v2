import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationProDecisionDatasetV6Row,
} from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';
import {
  buildRecommendationValueV8DiagnosticGate,
  createRecommendationValueV8ActionModel,
  createRecommendationValueV8DiagnosticMetricsAccumulator,
  createRecommendationValueV8StateModel,
  finalizeRecommendationValueV8DiagnosticMetrics,
  observeRecommendationValueV8DiagnosticDecision,
  permuteRecommendationValueV8CandidateMetadata,
  permuteRecommendationValueV8CandidatePayloads,
  predictRecommendationValueV8CandidateSet,
  predictRecommendationValueV8State,
  trainRecommendationValueV8ActionDecision,
  trainRecommendationValueV8StateDecision,
} from '../src/deadlock-live/recommendation-value-v8-diagnostic';

describe('Recommendation Value V8 diagnostic', () => {
  it('learns state-only outcome variation without candidate input', () => {
    const model = createRecommendationValueV8StateModel(512);
    for (let epoch = 0; epoch < 8; epoch += 1) {
      for (let index = 0; index < 80; index += 1) {
        trainRecommendationValueV8StateDecision(
          model,
          row({
            decisionId: `high-${epoch}-${index}`,
            matchId: `high-${index}`,
            netWorth: 20_000,
            outcome: 0.6,
            observedActionKey: 'BUY:100',
          }),
          {
            learningRate: 0.08,
            l2: 0.0001,
            maximumAbsolutePrediction: 1,
          },
        );
        trainRecommendationValueV8StateDecision(
          model,
          row({
            decisionId: `low-${epoch}-${index}`,
            matchId: `low-${index}`,
            netWorth: 2_000,
            outcome: -0.6,
            observedActionKey: 'BUY:100',
          }),
          {
            learningRate: 0.08,
            l2: 0.0001,
            maximumAbsolutePrediction: 1,
          },
        );
      }
    }

    const high = predictRecommendationValueV8State(
      model,
      row({
        decisionId: 'high-test',
        matchId: 'high-test',
        netWorth: 20_000,
        outcome: 0.6,
        observedActionKey: 'BUY:100',
      }),
    );
    const low = predictRecommendationValueV8State(
      model,
      row({
        decisionId: 'low-test',
        matchId: 'low-test',
        netWorth: 2_000,
        outcome: -0.6,
        observedActionKey: 'BUY:100',
      }),
    );

    expect(high['5m']).toBeGreaterThan(low['5m'] as number);
  });

  it('learns candidate residuals and centers advantages within decisions', () => {
    const model = createRecommendationValueV8ActionModel(1024);
    for (let epoch = 0; epoch < 12; epoch += 1) {
      for (let index = 0; index < 100; index += 1) {
        const good = row({
          decisionId: `good-${epoch}-${index}`,
          matchId: `good-${index}`,
          netWorth: 8_000,
          outcome: 0.7,
          observedActionKey: 'BUY:100',
        });
        const bad = row({
          decisionId: `bad-${epoch}-${index}`,
          matchId: `bad-${index}`,
          netWorth: 8_000,
          outcome: -0.7,
          observedActionKey: 'BUY:200',
        });
        trainRecommendationValueV8ActionDecision(
          model,
          good,
          { '3m': 0, '5m': 0, '10m': 0 },
          0.5,
          actionOptions(),
        );
        trainRecommendationValueV8ActionDecision(
          model,
          bad,
          { '3m': 0, '5m': 0, '10m': 0 },
          0.5,
          actionOptions(),
        );
      }
    }

    const value = row({
      decisionId: 'evaluation',
      matchId: 'evaluation',
      netWorth: 8_000,
      outcome: 0.7,
      observedActionKey: 'BUY:100',
    });
    const prediction = predictRecommendationValueV8CandidateSet(model, value);
    const good = prediction.candidates.find(
      (candidate) => candidate.actionKey === 'BUY:100',
    );
    const bad = prediction.candidates.find(
      (candidate) => candidate.actionKey === 'BUY:200',
    );

    expect(good?.aggregateAdvantage).toBeGreaterThan(
      bad?.aggregateAdvantage as number,
    );
    expect(prediction.candidateSeparation).toBeGreaterThan(0.05);
    expect(prediction.maximumAbsoluteCenteredMean).toBeLessThan(1e-12);
    for (const horizon of ['3m', '5m', '10m'] as const) {
      const mean =
        prediction.candidates.reduce(
          (sum, candidate) => sum + (candidate.advantages[horizon] ?? 0),
          0,
        ) / prediction.candidates.length;
      expect(Math.abs(mean)).toBeLessThan(1e-12);
    }
  });

  it('passes diagnostics only when candidate and metadata permutations degrade quality', () => {
    const model = createRecommendationValueV8ActionModel(1024);
    for (let epoch = 0; epoch < 16; epoch += 1) {
      for (let index = 0; index < 120; index += 1) {
        const observedActionKey = index % 2 === 0 ? 'BUY:100' : 'BUY:200';
        trainRecommendationValueV8ActionDecision(
          model,
          row({
            decisionId: `train-${epoch}-${index}`,
            matchId: `train-${index}`,
            netWorth: 8_000,
            outcome: observedActionKey === 'BUY:100' ? 0.8 : -0.8,
            observedActionKey,
          }),
          { '3m': 0, '5m': 0, '10m': 0 },
          0.5,
          actionOptions(),
        );
      }
    }

    const accumulator = createRecommendationValueV8DiagnosticMetricsAccumulator();
    for (let index = 0; index < 40; index += 1) {
      const observedActionKey = index % 2 === 0 ? 'BUY:100' : 'BUY:200';
      const value = row({
        decisionId: `tuning-${index}`,
        matchId: `tuning-${index}`,
        netWorth: 8_000,
        outcome: observedActionKey === 'BUY:100' ? 0.8 : -0.8,
        observedActionKey,
      });
      observeRecommendationValueV8DiagnosticDecision({
        accumulator,
        row: value,
        statePredictions: { '3m': 0, '5m': 0, '10m': 0 },
        candidatePrediction: predictRecommendationValueV8CandidateSet(
          model,
          value,
        ),
        candidatePermutationPrediction: predictRecommendationValueV8CandidateSet(
          model,
          value,
          permuteRecommendationValueV8CandidatePayloads(value.candidates),
        ),
        metadataPermutationPrediction: predictRecommendationValueV8CandidateSet(
          model,
          value,
          permuteRecommendationValueV8CandidateMetadata(value.candidates),
        ),
        sensitivityThreshold: 0.01,
      });
    }
    const metrics = finalizeRecommendationValueV8DiagnosticMetrics(accumulator);
    const gate = buildRecommendationValueV8DiagnosticGate(metrics, {
      minimumTuningDecisionCount: 20,
      minimumStateRmseImprovement: 0,
      minimumCandidateSensitiveDecisionRate: 0.9,
      minimumAverageCandidateSeparation: 0.01,
      minimumCandidatePermutationRmseIncrease: 0,
      minimumMetadataPermutationRmseIncrease: 0,
      maximumAbsoluteCenteredMean: 1e-9,
    });

    expect(metrics.actionRmse).toBeLessThan(metrics.stateRmse);
    expect(metrics.candidatePermutationRmse).toBeGreaterThan(metrics.actionRmse);
    expect(metrics.metadataPermutationRmse).toBeGreaterThan(metrics.actionRmse);
    expect(gate.passed).toBe(true);
    expect(gate.fullTrainingRecommended).toBe(true);
  });
});

function actionOptions() {
  return {
    learningRate: 0.06,
    l2: 0.0001,
    maximumAbsoluteResidual: 1,
    propensityFloor: 0.01,
    maximumImportanceWeight: 10,
  };
}

function row(input: {
  decisionId: string;
  matchId: string;
  netWorth: number;
  outcome: number;
  observedActionKey: string;
}): RecommendationProDecisionDatasetV6Row {
  return {
    schemaVersion: 1,
    datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
    dataSource: 'PRO_HISTORICAL',
    decisionSource: 'HISTORICAL_REPLAY',
    decisionId: input.decisionId,
    matchId: input.matchId,
    matchStartTime: '2026-07-01T00:00:00.000Z',
    playerId: '1',
    split: input.decisionId.startsWith('tuning') ? 'TUNING' : 'TRAIN',
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
      netWorth: input.netWorth,
      heroDamage: 4_000,
      health: 900,
      maxHealth: 1_000,
      level: 8,
    },
    candidates: [
      candidate({
        actionKey: 'BUY:100',
        itemId: 100,
        tier: 3,
        cost: 3_000,
        tags: ['DAMAGE', 'GOOD_VALUE'],
        ownedComponentCount: 2,
        missingComponentCount: 0,
        hasCompleteRecipeComponents: true,
      }),
      candidate({
        actionKey: 'BUY:200',
        itemId: 200,
        tier: 1,
        cost: 500,
        tags: ['LOW_IMPACT', 'BAD_VALUE'],
        ownedComponentCount: 0,
        missingComponentCount: 2,
        hasCompleteRecipeComponents: false,
      }),
    ],
    observedActionKey: input.observedActionKey,
    observedActionInCandidateSet: true,
    shortHorizonOutcomes: {
      threeMinutes: input.outcome,
      fiveMinutes: input.outcome,
      tenMinutes: input.outcome,
    },
    finalOutcome: input.outcome > 0 ? 1 : 0,
    versions: {
      catalog: 'catalog-1',
      catalogSha256: 'a'.repeat(64),
      candidateGenerator: 'generator-1',
      candidateGeneratorPolicy: 'policy-1',
      candidateGeneratorPolicySha256: 'b'.repeat(64),
      stateFeatures: 'RECOMMENDATION_STATE_FEATURES_V6_2_FUTURE_TIMELINE_FALLBACK',
      replay: 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_2',
    },
    eligibility: {
      stateModel: true,
      behavioralModel: true,
      actionModel: true,
      exclusionReasons: [],
    },
  };
}

function candidate(input: {
  actionKey: string;
  itemId: number;
  tier: number;
  cost: number;
  tags: string[];
  ownedComponentCount: number;
  missingComponentCount: number;
  hasCompleteRecipeComponents: boolean;
}): RecommendationDatasetV6CandidateFeatures {
  return {
    actionKey: input.actionKey,
    actionType: 'BUY',
    itemId: input.itemId,
    rank: input.itemId === 100 ? 1 : 2,
    generatorScore: input.itemId === 100 ? 0.6 : 0.4,
    historicalCount: 100,
    historicalProbability: 0.5,
    confidence: 0.8,
    predictedStateKey: `50x1|${input.itemId}x1`,
    catalogMetadataAvailable: true,
    cost: input.cost,
    tier: input.tier,
    slotType: 'WEAPON',
    itemType: 'UPGRADE',
    isActiveItem: false,
    activationType: 'PASSIVE',
    tags: input.tags,
    componentItemIds: [50, 51],
    requiredComponentCount: 2,
    ownedComponentCount: input.ownedComponentCount,
    missingComponentCount: input.missingComponentCount,
    hasAnyOwnedComponent: input.ownedComponentCount > 0,
    hasCompleteRecipeComponents: input.hasCompleteRecipeComponents,
    alreadyOwnedCount: 0,
    sameSlotOwnedItemCount: 1,
    inventoryTagOverlapCount: input.itemId === 100 ? 1 : 0,
    previousActionCount: 0,
    currentNetWorth: 8_000,
    costToNetWorthRatio: input.cost / 8_000,
  };
}
