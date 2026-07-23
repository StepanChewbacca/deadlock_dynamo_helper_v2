import type { HeroBuildContextualV3LiveService } from '../src/deadlock-live/hero-build-contextual-v3-live.service';
import type { HeroBuildRecommendationResponse } from '../src/deadlock-live/hero-build-recommendation.service';
import type {
  HeroBuildPolicy,
  HeroBuildTransitionAggregationService,
} from '../src/deadlock-live/hero-build-transition-aggregation.service';
import { ProductionHeroBuildRecommendationService } from '../src/deadlock-live/production-hero-build-recommendation.service';
import type { RecipeAwareTimelineReconciliationService } from '../src/deadlock-live/recipe-aware-timeline-reconciliation.service';

describe('ProductionHeroBuildRecommendationService hero aliases', () => {
  const previousLiveMode = process.env.DEADLOCK_CONTEXTUAL_V3_LIVE_MODE;
  const previousShadowSampleRate =
    process.env.DEADLOCK_CONTEXTUAL_V3_SHADOW_SAMPLE_RATE;

  afterEach(() => {
    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_V3_LIVE_MODE',
      previousLiveMode,
    );
    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_V3_SHADOW_SAMPLE_RATE',
      previousShadowSampleRate,
    );
    jest.restoreAllMocks();
  });

  it.each([
    { requestedHeroId: 64, canonicalHeroId: 2 },
    { requestedHeroId: 76, canonicalHeroId: 12 },
  ])(
    'uses canonical policy for alias $requestedHeroId and preserves the requested response id',
    async ({ requestedHeroId, canonicalHeroId }) => {
      process.env.DEADLOCK_CONTEXTUAL_V3_LIVE_MODE = 'SHADOW';
      process.env.DEADLOCK_CONTEXTUAL_V3_SHADOW_SAMPLE_RATE = '1';

      const policy = createPolicy(canonicalHeroId);
      const transitionService = {
        ensureReady: jest.fn(async () => undefined),
        getStatus: jest.fn(() => ({
          lastRefreshedAt: new Date('2026-07-17T00:00:00.000Z'),
        })),
        getHeroPolicy: jest.fn((heroId: number) =>
          heroId === canonicalHeroId ? policy : undefined,
        ),
      } as unknown as HeroBuildTransitionAggregationService;
      const recipeService = {
        getComponentItemIds: jest.fn(() => []),
      } as unknown as RecipeAwareTimelineReconciliationService;
      const contextualService = {
        getStatus: jest.fn(() => ({ state: 'READY' })),
        recommend: jest.fn(
          (
            request: { heroId: number; enemyHeroIds?: number[] },
            baseline: HeroBuildRecommendationResponse,
          ) => createContextualResponse(request, baseline),
        ),
      } as unknown as HeroBuildContextualV3LiveService;
      const service = new ProductionHeroBuildRecommendationService(
        transitionService,
        recipeService,
        contextualService,
      );

      const response = await service.recommend({
        heroId: requestedHeroId,
        itemIds: [],
        gameTimeS: 60,
        enemyHeroIds: [3, 4, 5, 6, 7],
        limit: 5,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(response.heroId).toBe(requestedHeroId);
      expect(response.mode).toBe('EXACT');
      expect(response.action.actionKey).toBe('BUY:100');
      expect(transitionService.getHeroPolicy).toHaveBeenCalledWith(canonicalHeroId);
      expect(contextualService.recommend).toHaveBeenCalledWith(
        expect.objectContaining({ heroId: canonicalHeroId }),
        expect.objectContaining({ heroId: requestedHeroId }),
      );
    },
  );

  it('leaves canonical hero ids unchanged', async () => {
    process.env.DEADLOCK_CONTEXTUAL_V3_LIVE_MODE = 'BASELINE';

    const policy = createPolicy(2);
    const transitionService = {
      ensureReady: jest.fn(async () => undefined),
      getStatus: jest.fn(() => ({ lastRefreshedAt: new Date() })),
      getHeroPolicy: jest.fn(() => policy),
    } as unknown as HeroBuildTransitionAggregationService;
    const recipeService = {
      getComponentItemIds: jest.fn(() => []),
    } as unknown as RecipeAwareTimelineReconciliationService;
    const contextualService = {
      getStatus: jest.fn(() => ({ state: 'READY' })),
      recommend: jest.fn(),
    } as unknown as HeroBuildContextualV3LiveService;
    const service = new ProductionHeroBuildRecommendationService(
      transitionService,
      recipeService,
      contextualService,
    );

    const response = await service.recommend({
      heroId: 2,
      itemIds: [],
      gameTimeS: 60,
      enemyHeroIds: [],
      limit: 5,
    });

    expect(response.heroId).toBe(2);
    expect(transitionService.getHeroPolicy).toHaveBeenCalledWith(2);
    expect(contextualService.recommend).not.toHaveBeenCalled();
  });
});

function createPolicy(heroId: number): HeroBuildPolicy {
  return {
    heroId,
    playerCount: 10,
    stateCount: 1,
    transitionCount: 10,
    statesByKey: new Map([
      [
        'EMPTY',
        {
          heroId,
          stateKey: 'EMPTY',
          observationCount: 10,
          nextActionCount: 1,
          nextActions: [
            {
              actionType: 'BUY',
              itemId: 100,
              actionKey: 'BUY:100',
              count: 10,
              probability: 1,
              averageGameTimeS: 60,
              afterStates: [
                {
                  afterStateKey: '100x1',
                  count: 10,
                  probability: 1,
                },
              ],
            },
          ],
        },
      ],
    ]),
  };
}

function createContextualResponse(
  request: { heroId: number; enemyHeroIds?: number[] },
  baseline: HeroBuildRecommendationResponse,
) {
  return {
    ...baseline,
    heroId: request.heroId,
    recommendationModel: 'CONTEXTUAL_V3' as const,
    modelVersion: 'CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_1',
    modelSha256: 'test',
    candidateSetPolicy: 'TRAIN_OBSERVED_GLOBAL_BACKOFF_LEGAL_SHORTLIST',
    candidateLimit: 128,
    buildArchetypeId: 'UNKNOWN',
    contextualFeatures: {
      phase: 'EARLY' as const,
      alliedHeroIds: [],
      enemyHeroIds: [...(request.enemyHeroIds ?? [])],
      previousActionCount: 0,
      archetypeApplied: false,
    },
  };
}

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
