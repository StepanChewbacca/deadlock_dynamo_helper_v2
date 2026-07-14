import {
  ContextualHeroBuildRecommendationAction,
  HERO_BUILD_CONTEXTUAL_CANDIDATE_LIMIT,
  rankContextualActions,
} from '../src/deadlock-live/contextual-hero-build-recommendation.service';
import { GRAPH_MATCHUP_MODEL_VERSION } from '../src/deadlock-live/hero-build-matchup-statistics.service';

function createAction(
  actionKey: string,
  baseRank: number,
  contextualScore: number,
  isSituational: boolean,
): ContextualHeroBuildRecommendationAction {
  return {
    type: 'BUY',
    sourceActionType: 'BUY',
    itemId: baseRank,
    actionKey,
    historicalCount: 10,
    historicalProbability: 0.5,
    averageGameTimeS: 300,
    matchedStateKey: 'EMPTY',
    matchedStateObservationCount: 20,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: false,
    predictedStateKey: `${baseRank}x1`,
    score: contextualScore,
    confidence: 0.5,
    baseScore: baseRank === 1 ? 0.55 : 0.45,
    contextualScore,
    baseRank,
    contextualRank: baseRank,
    isSituational,
    wasPromotedByMatchup: false,
    wasInsertedByMatchup: false,
    situationalAgainstHeroId: isSituational ? 13 : undefined,
    situationalInteractionOddsRatio: isSituational ? 2 : undefined,
    situationalLower95OddsRatio: isSituational ? 1.2 : undefined,
    matchupObservationCount: isSituational ? 50 : 0,
    matchupModelVersion: GRAPH_MATCHUP_MODEL_VERSION,
    matchupEvidence: [],
  };
}

describe('rankContextualActions', () => {
  it('evaluates a wider internal candidate pool than the visible build', () => {
    expect(HERO_BUILD_CONTEXTUAL_CANDIDATE_LIMIT).toBe(100);
  });

  it('marks a situational action only when matchup scoring moves it ahead of its base rank', () => {
    const ranked = rankContextualActions([
      createAction('BUY:1', 1, 0.55, false),
      createAction('BUY:2', 2, 0.65, true),
    ]);

    expect(ranked[0].actionKey).toBe('BUY:2');
    expect(ranked[0].contextualRank).toBe(1);
    expect(ranked[0].wasPromotedByMatchup).toBe(true);
    expect(ranked[0].wasInsertedByMatchup).toBe(false);
    expect(ranked[1].wasPromotedByMatchup).toBe(false);
  });

  it('marks a matchup action as inserted when it enters the visible build from outside it', () => {
    const ranked = rankContextualActions(
      [
        createAction('BUY:1', 1, 0.55, false),
        createAction('BUY:25', 25, 0.75, true),
      ],
      20,
    );

    expect(ranked[0]).toMatchObject({
      actionKey: 'BUY:25',
      baseRank: 25,
      contextualRank: 1,
      wasPromotedByMatchup: true,
      wasInsertedByMatchup: true,
    });
  });

  it('does not mark a situational base leader as promoted when it stays first', () => {
    const ranked = rankContextualActions([
      createAction('BUY:1', 1, 0.7, true),
      createAction('BUY:2', 2, 0.5, false),
    ]);

    expect(ranked[0].actionKey).toBe('BUY:1');
    expect(ranked[0].isSituational).toBe(true);
    expect(ranked[0].wasPromotedByMatchup).toBe(false);
    expect(ranked[0].wasInsertedByMatchup).toBe(false);
  });
});
