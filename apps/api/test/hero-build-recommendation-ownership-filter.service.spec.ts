import { HeroBuildRecommendationOwnershipFilterService } from '../src/deadlock-live/hero-build-recommendation-ownership-filter.service';
import {
  HeroBuildRecommendationAction,
  HeroBuildRecommendationResponse,
} from '../src/deadlock-live/hero-build-recommendation.service';

describe('HeroBuildRecommendationOwnershipFilterService', () => {
  it('promotes the next action when the primary item is contained in an owned upgrade', () => {
    const service = new HeroBuildRecommendationOwnershipFilterService({
      getComponentItemIds: jest.fn((parentItemId: number) => {
        if (parentItemId === 300) {
          return [200];
        }
        if (parentItemId === 200) {
          return [100];
        }
        return [];
      }),
    } as any);
    const response = createResponse(
      '300x1',
      createBuyAction(100, 1),
      [createBuyAction(400, 1)],
    );

    const filtered = service.filter(response);

    expect(filtered.action.actionKey).toBe('BUY:400');
    expect(filtered.alternatives).toEqual([]);
  });

  it('keeps a repeatable item below its observed ownership limit', () => {
    const service = new HeroBuildRecommendationOwnershipFilterService({
      getComponentItemIds: jest.fn(() => []),
    } as any);
    const response = createResponse('100x1', createBuyAction(100, 2));

    const filtered = service.filter(response);

    expect(filtered.action.actionKey).toBe('BUY:100');
  });

  it('returns HOLD when every candidate is already effectively owned', () => {
    const service = new HeroBuildRecommendationOwnershipFilterService({
      getComponentItemIds: jest.fn((parentItemId: number) =>
        parentItemId === 200 ? [100] : [],
      ),
    } as any);
    const response = createResponse('200x1', createBuyAction(100, 1));

    const filtered = service.filter(response);

    expect(filtered.mode).toBe('NO_MATCH');
    expect(filtered.noMatchReason).toBe('NO_LEGAL_ACTION');
    expect(filtered.action.actionKey).toBe('HOLD');
  });
});

function createResponse(
  requestedStateKey: string,
  action: HeroBuildRecommendationAction,
  alternatives: HeroBuildRecommendationAction[] = [],
): HeroBuildRecommendationResponse {
  return {
    mode: 'EXACT',
    heroId: 15,
    requestedStateKey,
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

function createBuyAction(
  itemId: number,
  observedOwnedCountLimit: number,
): HeroBuildRecommendationAction {
  return {
    type: 'BUY',
    sourceActionType: 'BUY',
    itemId,
    actionKey: `BUY:${itemId}`,
    historicalCount: 10,
    historicalProbability: 0.5,
    averageGameTimeS: 180,
    matchedStateKey: 'EMPTY',
    matchedStateObservationCount: 20,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    currentOwnedCount: 0,
    observedOwnedCountLimit,
    predictedStateKey: `${itemId}x1`,
    score: 0.5,
    confidence: 0.5,
  };
}
