import type { HeroBuildContextualV3LiveService } from '../src/deadlock-live/hero-build-contextual-v3-live.service';
import type { HeroBuildRecommendationResponse } from '../src/deadlock-live/hero-build-recommendation.service';
import type { HeroBuildTransitionAggregationService } from '../src/deadlock-live/hero-build-transition-aggregation.service';
import { ProductionHeroBuildRecommendationService } from '../src/deadlock-live/production-hero-build-recommendation.service';
import type { RecommendationValueV6LiveService } from '../src/deadlock-live/recommendation-value-v6-live.service';
import type { RecipeAwareTimelineReconciliationService } from '../src/deadlock-live/recipe-aware-timeline-reconciliation.service';

describe('ProductionHeroBuildRecommendationService V6 exclusive mode', () => {
  it('uses V6 exclusively and never invokes Contextual V3', async () => {
    const contextualService = createContextualService();
    const v6Service = createV6Service('VALUE_V6_CANARY');
    const service = new ProductionHeroBuildRecommendationService(
      createTransitionService(),
      createRecipeService(),
      contextualService,
      v6Service,
    );

    const response = await service.recommend({
      heroId: 64,
      itemIds: [],
      gameTimeS: 180,
      enemyHeroIds: [3, 4],
      previousActionKeys: [],
      limit: 5,
    });

    expect((response as { recommendationModel?: string }).recommendationModel).toBe('RECOMMENDATION_VALUE_V6');
    expect((response as { candidateId?: string }).candidateId).toBe('v6-short-only-20260727');
    expect(contextualService.recommend).not.toHaveBeenCalled();
    expect(v6Service.apply).toHaveBeenCalledWith(
      expect.objectContaining({ heroId: 2 }),
      expect.objectContaining({ heroId: 64 }),
      expect.objectContaining({ heroId: 2 }),
    );
  });

  it('fails closed instead of returning another ranking when V6 falls back', async () => {
    const service = new ProductionHeroBuildRecommendationService(
      createTransitionService(),
      createRecipeService(),
      createContextualService(),
      createV6Service('BASELINE', 'LOW_TOP_SEPARATION'),
    );

    await expect(service.recommend({ heroId: 2, itemIds: [], gameTimeS: 180, limit: 5 }))
      .rejects.toThrow('Recommendation Value V6 did not produce an exclusive ranking: LOW_TOP_SEPARATION.');
  });
});

function createTransitionService(): HeroBuildTransitionAggregationService {
  return {
    ensureReady: jest.fn(async () => undefined),
    getStatus: jest.fn(() => ({ lastRefreshedAt: new Date('2026-07-17T00:00:00.000Z') })),
    getHeroPolicy: jest.fn(() => ({
      heroId: 2,
      playerCount: 10,
      stateCount: 1,
      transitionCount: 10,
      statesByKey: new Map([['EMPTY', {
        heroId: 2,
        stateKey: 'EMPTY',
        observationCount: 10,
        nextActionCount: 2,
        nextActions: [createPolicyAction(100, 6), createPolicyAction(200, 4)],
      }]]),
    })),
  } as unknown as HeroBuildTransitionAggregationService;
}

function createPolicyAction(itemId: number, count: number) {
  return {
    actionType: 'BUY' as const,
    itemId,
    actionKey: `BUY:${itemId}`,
    count,
    probability: count / 10,
    averageGameTimeS: 180,
    afterStates: [{ afterStateKey: `${itemId}x1`, count, probability: 1 }],
  };
}

function createRecipeService(): RecipeAwareTimelineReconciliationService {
  return { getComponentItemIds: jest.fn(() => []) } as unknown as RecipeAwareTimelineReconciliationService;
}

function createContextualService(): HeroBuildContextualV3LiveService {
  return {
    getStatus: jest.fn(() => ({ state: 'READY' })),
    recommend: jest.fn(() => { throw new Error('Contextual V3 must not be called.'); }),
  } as unknown as HeroBuildContextualV3LiveService;
}

function createV6Service(source: 'VALUE_V6_CANARY' | 'BASELINE', fallbackReason?: string): RecommendationValueV6LiveService {
  return {
    getMode: jest.fn(() => 'CANARY'),
    apply: jest.fn(async (_request, baseline: HeroBuildRecommendationResponse) => ({
      ...baseline,
      recommendationExperiment: {
        source,
        candidateId: source === 'VALUE_V6_CANARY' ? 'v6-short-only-20260727' : undefined,
        modelVersion: source === 'VALUE_V6_CANARY' ? 'RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1' : undefined,
        modelSha256: source === 'VALUE_V6_CANARY' ? '799803f4882ca2ece436ab1087c41641713377f8a33f9bab0f0f4636a381938e' : undefined,
        fallbackReason,
      },
    })),
  } as unknown as RecommendationValueV6LiveService;
}
