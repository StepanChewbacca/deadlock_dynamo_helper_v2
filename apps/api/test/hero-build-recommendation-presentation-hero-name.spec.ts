import { presentHeroBuildRecommendation } from '../src/deadlock-live/hero-build-recommendation-presentation.service';
import {
  HeroBuildRecommendationAction,
  HeroBuildRecommendationResponse,
} from '../src/deadlock-live/hero-build-recommendation.service';

describe('situational hero presentation', () => {
  it('resolves a canonical situational hero through a stored alias id', () => {
    const action = createAction() as HeroBuildRecommendationAction & {
      situationalAgainstHeroId: number;
    };
    action.situationalAgainstHeroId = 8;
    const response: HeroBuildRecommendationResponse = {
      mode: 'EXACT',
      heroId: 6,
      requestedStateKey: 'EMPTY',
      gameTimeS: 180,
      matchedStateKey: 'EMPTY',
      stateDistance: 0,
      missingItemCount: 0,
      extraItemCount: 0,
      matchedBySubset: true,
      observationCount: 10,
      candidateStateCount: 1,
      action,
      alternatives: [],
    };

    const result = presentHeroBuildRecommendation(
      response,
      [],
      [{ heroId: 69, name: 'Warden' }],
    );

    expect(result.action.situationalAgainstHeroName).toBe('Warden');
  });
});

function createAction(): HeroBuildRecommendationAction {
  return {
    type: 'BUY',
    sourceActionType: 'BUY',
    itemId: 100,
    actionKey: 'BUY:100',
    historicalCount: 10,
    historicalProbability: 0.5,
    averageGameTimeS: 180,
    matchedStateKey: 'EMPTY',
    matchedStateObservationCount: 10,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    currentOwnedCount: 0,
    observedOwnedCountLimit: 1,
    predictedStateKey: '100x1',
    score: 0.5,
    confidence: 0.5,
  };
}
