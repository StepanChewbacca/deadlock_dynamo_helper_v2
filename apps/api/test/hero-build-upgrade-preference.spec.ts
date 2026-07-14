import {
  preferUpgradeOverComponentSell,
} from '../src/deadlock-live/hero-build-upgrade-preference';
import type {
  HeroBuildRecommendationAction,
  HeroBuildRecommendationResponse,
} from '../src/deadlock-live/hero-build-recommendation.service';

describe('preferUpgradeOverComponentSell', () => {
  it('promotes an upgrade that consumes the item selected for sale', () => {
    const sell = createAction('SELL', 100, '200x1|100x0');
    const upgrade = createAction('UPGRADE', 200, '200x1');
    const response = createResponse(sell, [upgrade]);

    const preferred = preferUpgradeOverComponentSell(response, [100]);

    expect(preferred.action).toMatchObject({ type: 'UPGRADE', itemId: 200 });
    expect(preferred.alternatives).toHaveLength(1);
    expect(preferred.alternatives[0]).toMatchObject({ type: 'SELL', itemId: 100 });
    expect(preferred.observationCount).toBe(upgrade.matchedStateObservationCount);
  });

  it('keeps the sale when an upgrade does not consume the sold item', () => {
    const sell = createAction('SELL', 100, '200x1');
    const unrelatedUpgrade = createAction('UPGRADE', 300, '100x1|300x1');
    const response = createResponse(sell, [unrelatedUpgrade]);

    expect(preferUpgradeOverComponentSell(response, [100])).toBe(response);
  });

  it('keeps non-sell recommendations unchanged', () => {
    const buy = createAction('BUY', 100, '100x1');
    const response = createResponse(buy, []);

    expect(preferUpgradeOverComponentSell(response, [])).toBe(response);
  });
});

function createResponse(
  action: HeroBuildRecommendationAction,
  alternatives: HeroBuildRecommendationAction[],
): HeroBuildRecommendationResponse {
  return {
    mode: 'EXACT',
    heroId: 11,
    requestedStateKey: '100x1',
    gameTimeS: 1800,
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
  type: HeroBuildRecommendationAction['type'],
  itemId: number,
  predictedStateKey: string,
): HeroBuildRecommendationAction {
  return {
    type,
    sourceActionType: type === 'HOLD' ? undefined : type,
    itemId,
    actionKey: `${type}:${itemId}`,
    historicalCount: 10,
    historicalProbability: 0.5,
    averageGameTimeS: 1800,
    matchedStateKey: '100x1',
    matchedStateObservationCount: type === 'UPGRADE' ? 20 : 10,
    stateDistance: type === 'UPGRADE' ? 0 : 1,
    missingItemCount: 0,
    extraItemCount: type === 'UPGRADE' ? 0 : 1,
    matchedBySubset: true,
    predictedStateKey,
    score: type === 'UPGRADE' ? 0.45 : 0.5,
    confidence: type === 'UPGRADE' ? 0.45 : 0.5,
  };
}
