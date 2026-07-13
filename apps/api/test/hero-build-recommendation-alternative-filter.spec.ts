import {
  filterHeroBuildRecommendationAlternatives,
  HeroBuildAlternativeFilterOptions,
} from '../src/deadlock-live/hero-build-recommendation-alternative-filter';
import type {
  HeroBuildRecommendationAction,
  HeroBuildRecommendationResponse,
} from '../src/deadlock-live/hero-build-recommendation.service';

const OPTIONS: HeroBuildAlternativeFilterOptions = {
  limit: 2,
  minHistoricalCount: 3,
  minConfidence: 0.01,
};

describe('hero build recommendation alternative filter', () => {
  it('separates evidence rejection from limit truncation', () => {
    const response = createResponse([
      createAction(200, 2, 0.02),
      createAction(300, 3, 0.005),
      createAction(400, 3, 0.02),
      createAction(500, 10, 0.5),
    ]);

    const result = filterHeroBuildRecommendationAlternatives(response, OPTIONS);

    expect(result.alternatives.map((action) => action.itemId)).toEqual([400]);
    expect(result.alternativeFilter).toEqual({
      minimumHistoricalCount: 3,
      minimumConfidence: 0.01,
      availableCount: 4,
      eligibleCount: 2,
      returnedCount: 1,
      evidenceRejectedCount: 2,
      limitTruncatedCount: 1,
    });
  });

  it('preserves the selected action even when alternatives are fully suppressed', () => {
    const response = createResponse([createAction(200, 100, 0.9)]);
    response.action = createAction(100, 1, 0.001);

    const result = filterHeroBuildRecommendationAlternatives(response, {
      ...OPTIONS,
      limit: 1,
    });

    expect(result.action.itemId).toBe(100);
    expect(result.alternatives).toEqual([]);
    expect(result.alternativeFilter.returnedCount).toBe(0);
    expect(result.alternativeFilter.limitTruncatedCount).toBe(1);
  });
});

function createResponse(
  alternatives: HeroBuildRecommendationAction[],
): HeroBuildRecommendationResponse {
  return {
    mode: 'BACKOFF',
    heroId: 72,
    requestedStateKey: '100x1',
    gameTimeS: 180,
    matchedStateKey: '100x1',
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    observationCount: 100,
    candidateStateCount: 1,
    action: createAction(100, 50, 0.5),
    alternatives,
    backoffReason: 'SUBSET_STATE',
  };
}

function createAction(
  itemId: number,
  historicalCount: number,
  confidence: number,
): HeroBuildRecommendationAction {
  return {
    type: 'BUY',
    sourceActionType: 'BUY',
    itemId,
    actionKey: `BUY:${itemId}`,
    historicalCount,
    historicalProbability: confidence,
    averageGameTimeS: 180,
    matchedStateKey: '100x1',
    matchedStateObservationCount: 100,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    currentOwnedCount: 0,
    observedOwnedCountLimit: 1,
    predictedStateKey: `100x1|${itemId}x1`,
    score: confidence,
    confidence,
  };
}
