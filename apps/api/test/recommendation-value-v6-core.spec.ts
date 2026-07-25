import {
  createRecommendationValueV6Model,
  predictRecommendationValueV6,
  updateRecommendationValueV6Model,
  type RecommendationValueV6ModelOptions,
  type RecommendationValueV6SourceRow,
} from '../src/deadlock-live/recommendation-value-v6-model';
import {
  computeRecommendationValueV6ShortHorizonUtility,
  prepareRecommendationValueV6Row,
} from '../src/deadlock-live/recommendation-value-v6-training.service';
import { RECOMMENDATION_DECISION_DATASET_V5_VERSION } from '../src/deadlock-live/recommendation-decision-dataset-v5.service';

const modelOptions: RecommendationValueV6ModelOptions = {
  statePriorStrength: 0,
  actionPriorStrength: 0,
  minimumObservations: 1,
  maximumAbsoluteStateResidual: 1,
  maximumAbsoluteActionResidual: 1,
};

describe('Recommendation Value V6 core', () => {
  it('builds a bounded short-horizon utility target without using future fields as features', () => {
    const row = datasetRow('decision-1', 'match-1', true, 'BUY:1');
    const horizon = computeRecommendationValueV6ShortHorizonUtility(row);
    const prepared = prepareRecommendationValueV6Row(row, {
      finalOutcomeWeight: 0.25,
    });

    expect(horizon).toBeDefined();
    expect(horizon?.count).toBe(2);
    expect(horizon?.utility).toBeGreaterThan(0);
    expect(prepared).toBeDefined();
    expect(prepared?.targetUtility).toBeGreaterThan(0);
    expect(prepared?.targetUtility).toBeLessThanOrEqual(1);
    expect(prepared?.candidateActions.map((candidate) => candidate.actionKey)).toEqual([
      'BUY:1',
      'BUY:2',
    ]);
    expect(prepared?.stateKeys.some((key) => key.includes('killsDelta'))).toBe(false);
  });

  it('ranks the higher-utility action above the lower-utility action in the same state', () => {
    const model = createRecommendationValueV6Model();
    for (let index = 0; index < 8; index += 1) {
      updateRecommendationValueV6Model(
        model,
        sourceRow(`good-${index}`, `good-${index}`, 0.8, 'BUY:GOOD'),
        1,
      );
      updateRecommendationValueV6Model(
        model,
        sourceRow(`bad-${index}`, `bad-${index}`, -0.8, 'BUY:BAD'),
        1,
      );
    }

    const good = predictRecommendationValueV6(
      model,
      { stateKeys: ['STATE:COMMON'], actionKeys: ['ACTION:BUY:GOOD'] },
      modelOptions,
      1,
    );
    const bad = predictRecommendationValueV6(
      model,
      { stateKeys: ['STATE:COMMON'], actionKeys: ['ACTION:BUY:BAD'] },
      modelOptions,
      1,
    );

    expect(good.stateUtility).toBeCloseTo(bad.stateUtility);
    expect(good.actionAdvantage).toBeGreaterThan(0);
    expect(bad.actionAdvantage).toBeLessThan(0);
    expect(good.actionUtility).toBeGreaterThan(bad.actionUtility);
  });
});

function sourceRow(
  decisionId: string,
  matchId: string,
  targetUtility: number,
  actionKey: string,
): RecommendationValueV6SourceRow {
  return {
    decisionId,
    matchId,
    playerWon: targetUtility > 0,
    targetUtility,
    targetComponents: {
      finalOutcome: targetUtility > 0 ? 1 : -1,
      shortHorizonUtility: targetUtility,
      shortHorizonCount: 1,
    },
    stateKeys: ['STATE:COMMON'],
    actionKeys: [`ACTION:${actionKey}`],
    observedActionKey: actionKey,
    candidateActions: [{ actionKey, actionKeys: [`ACTION:${actionKey}`] }],
  };
}

function datasetRow(
  decisionId: string,
  matchId: string,
  playerWon: boolean,
  observedActionKey: string,
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
    decisionId,
    identity: {
      matchId,
      heroId: 15,
      teamId: 2,
      decisionGameTimeS: 600,
      decisionOccurredAt: '2026-07-01T00:10:00.000Z',
    },
    stateBeforeAction: {
      heroId: 15,
      teamId: 2,
      gameTimeS: 600,
      timeBucket: 5,
      inventoryStateKey: '1x1',
      alliedHeroIds: [15, 16],
      enemyHeroIds: [20, 21],
      candidateActions: [{ actionKey: 'BUY:1' }, { actionKey: 'BUY:2' }],
      playerTimelineSnapshot: {
        available: true,
        kills: 2,
        deaths: 1,
        assists: 3,
        netWorth: 5000,
      },
    },
    observedAction: { actionKey: observedActionKey, itemId: 1 },
    trajectory: {
      fullPreviousActionKeys: ['BUY:9', 'SELL:9'],
    },
    itemAndBuildFeatures: {
      available: true,
      inventory: { totalCost: 2500, highestTier: 2 },
      observedAction: {
        actionKey: observedActionKey,
        item: { slotType: 'vitality', tier: 2, cost: 1250, tags: ['defensive'] },
        interactionKeys: ['HERO_ITEM:15:1'],
      },
      candidates: [
        {
          actionKey: 'BUY:1',
          item: { slotType: 'vitality', tier: 2, cost: 1250, tags: ['defensive'] },
          interactionKeys: ['HERO_ITEM:15:1'],
        },
        {
          actionKey: 'BUY:2',
          item: { slotType: 'spirit', tier: 2, cost: 1250, tags: ['offensive'] },
          interactionKeys: ['HERO_ITEM:15:2'],
        },
      ],
    },
    shortHorizonOutcomes: {
      sourceAvailable: true,
      windows: {
        '3m': {
          available: true,
          killsDelta: 1,
          deathsDelta: 0,
          assistsDelta: 2,
          killParticipationDelta: 3,
          netWorthDelta: 1500,
          heroDamageDelta: 3000,
          survived: true,
          ownObjectiveLossCount: 0,
          enemyObjectiveLossCount: 1,
        },
        '5m': {
          available: true,
          killsDelta: 1,
          deathsDelta: 1,
          assistsDelta: 3,
          killParticipationDelta: 4,
          netWorthDelta: 2200,
          heroDamageDelta: 5000,
          survived: false,
          ownObjectiveLossCount: 0,
          enemyObjectiveLossCount: 1,
        },
        '10m': { available: false },
      },
    },
    finalOutcome: {
      available: true,
      conflicting: false,
      playerWon,
      auxiliaryTargetOnly: true,
    },
    trainingEligibility: {
      exactAction: true,
      finalOutcome: true,
      shortHorizon3m: true,
      shortHorizon5m: true,
      shortHorizon10m: false,
    },
  };
}
