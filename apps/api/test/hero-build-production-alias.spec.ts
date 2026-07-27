import type { HeroBuildContextualV3LiveService } from '../src/deadlock-live/hero-build-contextual-v3-live.service';
import type { HeroBuildRecommendationResponse } from '../src/deadlock-live/hero-build-recommendation.service';
import type { HeroBuildTransitionAggregationService } from '../src/deadlock-live/hero-build-transition-aggregation.service';
import { ProductionHeroBuildRecommendationService } from '../src/deadlock-live/production-hero-build-recommendation.service';
import type { RecommendationValueV6LiveService } from '../src/deadlock-live/recommendation-value-v6-live.service';
import type { RecipeAwareTimelineReconciliationService } from '../src/deadlock-live/recipe-aware-timeline-reconciliation.service';

describe('ProductionHeroBuildRecommendationService V6 hero aliases', () => {
  it.each([{ requestedHeroId: 64, canonicalHeroId: 2 }, { requestedHeroId: 76, canonicalHeroId: 12 }])(
    'passes canonical hero $canonicalHeroId to V6 and preserves requested id $requestedHeroId',
    async ({ requestedHeroId, canonicalHeroId }) => {
      const transitionService = {
        ensureReady: jest.fn(async () => undefined),
        getStatus: jest.fn(() => ({ lastRefreshedAt: new Date() })),
        getHeroPolicy: jest.fn(() => ({
          heroId: canonicalHeroId,
          playerCount: 10,
          stateCount: 1,
          transitionCount: 10,
          statesByKey: new Map([['EMPTY', {
            heroId: canonicalHeroId,
            stateKey: 'EMPTY',
            observationCount: 10,
            nextActionCount: 2,
            nextActions: [createPolicyAction(100, 6), createPolicyAction(200, 4)],
          }]]),
        })),
      } as unknown as HeroBuildTransitionAggregationService;
      const contextualService = {
        getStatus: jest.fn(() => ({ state: 'READY' })),
        recommend: jest.fn(),
      } as unknown as HeroBuildContextualV3LiveService;
      const v6Service = {
        getMode: jest.fn(() => 'CANARY'),
        apply: jest.fn(async (_request, baseline: HeroBuildRecommendationResponse) => ({
          ...baseline,
          recommendationExperiment: {
            source: 'VALUE_V6_CANARY',
            candidateId: 'v6-short-only-20260727',
            modelVersion: 'RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1',
            modelSha256: '799803f4882ca2ece436ab1087c41641713377f8a33f9bab0f0f4636a381938e',
          },
        })),
      } as unknown as RecommendationValueV6LiveService;
      const service = new ProductionHeroBuildRecommendationService(
        transitionService,
        { getComponentItemIds: jest.fn(() => []) } as unknown as RecipeAwareTimelineReconciliationService,
        contextualService,
        v6Service,
      );

      const response = await service.recommend({ heroId: requestedHeroId, itemIds: [], gameTimeS: 60, limit: 5 });
      expect(response.heroId).toBe(requestedHeroId);
      expect(transitionService.getHeroPolicy).toHaveBeenCalledWith(canonicalHeroId);
      expect(v6Service.apply).toHaveBeenCalledWith(
        expect.objectContaining({ heroId: canonicalHeroId }),
        expect.objectContaining({ heroId: requestedHeroId }),
        expect.objectContaining({ heroId: canonicalHeroId }),
      );
      expect(contextualService.recommend).not.toHaveBeenCalled();
    },
  );
});

function createPolicyAction(itemId: number, count: number) {
  return {
    actionType: 'BUY' as const,
    itemId,
    actionKey: `BUY:${itemId}`,
    count,
    probability: count / 10,
    averageGameTimeS: 60,
    afterStates: [{ afterStateKey: `${itemId}x1`, count, probability: 1 }],
  };
}
