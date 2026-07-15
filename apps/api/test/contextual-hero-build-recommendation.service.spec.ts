import {
  ContextualHeroBuildRecommendationAction,
  ContextualHeroBuildRecommendationService,
  HERO_BUILD_CONTEXTUAL_CANDIDATE_LIMIT,
  mergeContextualRecommendationCandidatePool,
  rankContextualActions,
} from '../src/deadlock-live/contextual-hero-build-recommendation.service';
import { GRAPH_MATCHUP_MODEL_VERSION } from '../src/deadlock-live/hero-build-matchup-statistics.service';
import { HeroBuildRecommendationAction } from '../src/deadlock-live/hero-build-recommendation.service';

function createAction(
  actionKey: string,
  baseRank: number,
  contextualScore: number,
  isSituational: boolean,
  wasInBaseBuild = true,
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
    wasInBaseBuild,
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

function createBaseAction(
  actionKey: string,
  itemId: number,
): HeroBuildRecommendationAction {
  return {
    type: 'BUY',
    sourceActionType: 'BUY',
    itemId,
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
    predictedStateKey: `${itemId}x1`,
    score: 0.5,
    confidence: 0.5,
  };
}

describe('contextual candidate expansion', () => {
  it('evaluates a wider internal candidate pool than the visible build', () => {
    expect(HERO_BUILD_CONTEXTUAL_CANDIDATE_LIMIT).toBe(100);
  });

  it('adds unique actions found only in nearby graph states', () => {
    const baseAction = createBaseAction('BUY:1', 1);
    const nearbyAction = createBaseAction('BUY:25', 25);
    const candidates = mergeContextualRecommendationCandidatePool(
      [baseAction],
      [baseAction, nearbyAction],
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        action: expect.objectContaining({ actionKey: 'BUY:1' }),
        baseRank: 1,
        wasInBaseBuild: true,
      }),
      expect.objectContaining({
        action: expect.objectContaining({ actionKey: 'BUY:25' }),
        baseRank: 2,
        wasInBaseBuild: false,
      }),
    ]);
  });

  it('returns the base recommendation before matchup warmup starts', async () => {
    jest.useFakeTimers();
    const matchupEvaluate = jest.fn(async () => ({
      modelVersion: GRAPH_MATCHUP_MODEL_VERSION,
      found: false,
      heroId: 6,
      stateKey: 'EMPTY',
      actionKey: 'BUY:1000',
      stateObservationCount: 0,
      actionObservationCount: 0,
      enemyHeroIds: [13],
      evidence: [],
    }));
    const policy = {
      heroId: 6,
      playerCount: 10,
      stateCount: 1,
      transitionCount: 10,
      statesByKey: new Map([
        [
          'EMPTY',
          {
            heroId: 6,
            stateKey: 'EMPTY',
            observationCount: 10,
            nextActionCount: 1,
            nextActions: [
              {
                actionType: 'BUY' as const,
                itemId: 1000,
                actionKey: 'BUY:1000',
                count: 10,
                probability: 1,
                averageGameTimeS: 60,
                afterStates: [{ afterStateKey: '1000x1', count: 10, probability: 1 }],
              },
            ],
          },
        ],
      ]),
    };
    const service = new ContextualHeroBuildRecommendationService(
      {
        ensureReady: jest.fn(async () => undefined),
        getStatus: () => ({ lastRefreshedAt: new Date() }),
        getHeroPolicy: () => policy,
      } as any,
      { getComponentItemIds: () => [] } as any,
      { evaluate: matchupEvaluate } as any,
    );

    const result = await service.recommend({
      heroId: 6,
      itemIds: [],
      gameTimeS: 0,
      enemyHeroIds: [13],
      limit: 1,
    });

    expect(result.action).toMatchObject({
      actionKey: 'BUY:1000',
      isSituational: false,
    });
    expect(matchupEvaluate).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();
    expect(matchupEvaluate).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

describe('rankContextualActions', () => {
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

  it('marks a matchup action as inserted when it enters from a nearby graph branch', () => {
    const ranked = rankContextualActions(
      [
        createAction('BUY:1', 1, 0.55, false),
        createAction('BUY:25', 25, 0.75, true, false),
      ],
      20,
    );

    expect(ranked[0]).toMatchObject({
      actionKey: 'BUY:25',
      baseRank: 25,
      contextualRank: 1,
      wasInBaseBuild: false,
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
