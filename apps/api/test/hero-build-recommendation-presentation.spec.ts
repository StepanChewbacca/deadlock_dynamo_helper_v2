import {
  HeroBuildPresentationHeroSource,
  HeroBuildPresentationItemSource,
  presentHeroBuildRecommendation,
} from '../src/deadlock-live/hero-build-recommendation-presentation.service';
import {
  HeroBuildRecommendationAction,
  HeroBuildRecommendationMode,
  HeroBuildRecommendationResponse,
} from '../src/deadlock-live/hero-build-recommendation.service';

const HAZE: HeroBuildPresentationHeroSource = {
  heroId: 13,
  name: 'Haze',
};

const ITEM: HeroBuildPresentationItemSource = {
  itemId: 200,
  name: 'Test Item',
  className: 'upgrade_test_item',
  itemSlotType: 'weapon',
  cost: 1250,
  itemTier: 2,
};

describe('hero build recommendation presentation', () => {
  it('enriches an exact recommendation with item metadata and observed explanation', () => {
    const response = createResponse('EXACT', createAction({
      itemId: 200,
      historicalCount: 7,
      historicalProbability: 0.7,
      averageGameTimeS: 181,
      confidence: 0.61234,
    }));

    const result = presentHeroBuildRecommendation(response, [ITEM]);

    expect(result.action.label).toBe('Buy Test Item');
    expect(result.action.item).toEqual({
      itemId: 200,
      name: 'Test Item',
      className: 'upgrade_test_item',
      slotType: 'weapon',
      cost: 1250,
      tier: 2,
    });
    expect(result.action.confidencePercent).toBe(61.23);
    expect(result.action.historicalProbabilityPercent).toBe(70);
    expect(result.action.typicalGameTimeLabel).toBe('3:01');
    expect(result.action.explanation.code).toBe('EXACT_STATE_EVIDENCE');
    expect(result.action.explanation.evidenceLevel).toBe('OBSERVED');
    expect(result.itemMetadata).toEqual({
      requestedCount: 1,
      resolvedCount: 1,
      missingItemIds: [],
    });
  });

  it('marks subset backoff as inferred and explains extra current items', () => {
    const response = createResponse('BACKOFF', createAction({
      itemId: 200,
      matchedBySubset: true,
      extraItemCount: 2,
      historicalCount: 12,
      historicalProbability: 0.4,
    }));
    response.backoffReason = 'SUBSET_STATE';

    const result = presentHeroBuildRecommendation(response, [ITEM]);

    expect(result.action.explanation.code).toBe('SUBSET_STATE_EVIDENCE');
    expect(result.action.explanation.evidenceLevel).toBe('INFERRED');
    expect(result.action.explanation.text).toContain('2 extra current item(s)');
  });

  it('enriches model matchup signals with enemy hero names', () => {
    const response = createResponse('BACKOFF', createAction({
      matchupSignals: [
        {
          heroId: 13,
          direction: 'POSITIVE',
          scoreContribution: 0.04,
          modelLiftPercent: 4.08,
          observationCount: 84,
        },
      ],
    }));

    const result = presentHeroBuildRecommendation(response, [ITEM], [HAZE]);

    expect(result.action.matchupSignals).toEqual([
      expect.objectContaining({
        heroId: 13,
        heroName: 'Haze',
        modelLiftPercent: 4.08,
        observationCount: 84,
      }),
    ]);
  });

  it('presents hold without requiring item metadata', () => {
    const response = createResponse('NO_MATCH', createHoldAction());
    response.noMatchReason = 'NO_LEGAL_ACTION';

    const result = presentHeroBuildRecommendation(response, []);

    expect(result.action.label).toBe('Hold current build');
    expect(result.action.item).toBeUndefined();
    expect(result.action.explanation.code).toBe('NO_LEGAL_ACTION');
    expect(result.itemMetadata).toEqual({
      requestedCount: 0,
      resolvedCount: 0,
      missingItemIds: [],
    });
  });

  it('keeps the response valid and reports missing item metadata', () => {
    const primary = createAction({ itemId: 200 });
    const alternative = createAction({ itemId: 300 });
    const response = createResponse('BACKOFF', primary, [alternative]);

    const result = presentHeroBuildRecommendation(response, [ITEM]);

    expect(result.action.item?.name).toBe('Test Item');
    expect(result.alternatives[0].label).toBe('Buy Item 300');
    expect(result.alternatives[0].item).toBeUndefined();
    expect(result.itemMetadata).toEqual({
      requestedCount: 2,
      resolvedCount: 1,
      missingItemIds: [300],
    });
  });
});

function createResponse(
  mode: HeroBuildRecommendationMode,
  action: HeroBuildRecommendationAction,
  alternatives: HeroBuildRecommendationAction[] = [],
): HeroBuildRecommendationResponse {
  return {
    mode,
    heroId: 72,
    requestedStateKey: '100x1',
    gameTimeS: 180,
    matchedStateKey: action.matchedStateKey,
    stateDistance: action.stateDistance,
    missingItemCount: action.missingItemCount,
    extraItemCount: action.extraItemCount,
    matchedBySubset: action.matchedBySubset,
    observationCount: action.matchedStateObservationCount,
    candidateStateCount: 1,
    action,
    alternatives,
  };
}

function createAction(
  overrides: Partial<HeroBuildRecommendationAction> = {},
): HeroBuildRecommendationAction {
  const itemId = overrides.itemId ?? 200;
  return {
    type: 'BUY',
    sourceActionType: 'BUY',
    itemId,
    actionKey: `BUY:${itemId}`,
    historicalCount: 10,
    historicalProbability: 0.5,
    averageGameTimeS: 180,
    matchedStateKey: '100x1',
    matchedStateObservationCount: 20,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    currentOwnedCount: 0,
    observedOwnedCountLimit: 1,
    predictedStateKey: `100x1|${itemId}x1`,
    score: 0.5,
    confidence: 0.5,
    ...overrides,
  };
}

function createHoldAction(): HeroBuildRecommendationAction {
  return {
    type: 'HOLD',
    actionKey: 'HOLD',
    historicalCount: 0,
    historicalProbability: 0,
    averageGameTimeS: 180,
    matchedStateKey: '100x1',
    matchedStateObservationCount: 0,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    predictedStateKey: '100x1',
    score: 0,
    confidence: 0,
  };
}
