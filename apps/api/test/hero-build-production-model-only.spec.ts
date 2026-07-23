import type { HeroBuildContextualV3LiveService } from '../src/deadlock-live/hero-build-contextual-v3-live.service';
import type { HeroBuildTransitionAggregationService } from '../src/deadlock-live/hero-build-transition-aggregation.service';
import { ProductionHeroBuildRecommendationService } from '../src/deadlock-live/production-hero-build-recommendation.service';
import type { RecipeAwareTimelineReconciliationService } from '../src/deadlock-live/recipe-aware-timeline-reconciliation.service';

describe('ProductionHeroBuildRecommendationService model-only mode', () => {
  const previousMode = process.env.DEADLOCK_CONTEXTUAL_V3_LIVE_MODE;

  beforeEach(() => {
    process.env.DEADLOCK_CONTEXTUAL_V3_LIVE_MODE = 'PRODUCTION';
  });

  afterEach(() => {
    if (previousMode === undefined) {
      delete process.env.DEADLOCK_CONTEXTUAL_V3_LIVE_MODE;
    } else {
      process.env.DEADLOCK_CONTEXTUAL_V3_LIVE_MODE = previousMode;
    }
    jest.restoreAllMocks();
  });

  it('returns Contextual V3 without loading the baseline policy', async () => {
    const transitionService = {
      ensureReady: jest.fn(async () => undefined),
      getStatus: jest.fn(),
      getHeroPolicy: jest.fn(),
    } as unknown as HeroBuildTransitionAggregationService;
    const recipeService = {
      getComponentItemIds: jest.fn(() => []),
    } as unknown as RecipeAwareTimelineReconciliationService;
    const contextualService = {
      getStatus: jest.fn(() => ({ state: 'READY' })),
      recommend: jest.fn((request: { heroId: number }) =>
        createModelResponse(request.heroId),
      ),
    } as unknown as HeroBuildContextualV3LiveService;
    const service = new ProductionHeroBuildRecommendationService(
      transitionService,
      recipeService,
      contextualService,
    );

    const response = await service.recommend({
      heroId: 64,
      itemIds: [],
      gameTimeS: 180,
      enemyHeroIds: [3, 4],
      previousActionKeys: [],
      limit: 5,
    });

    expect(response.heroId).toBe(64);
    expect((response as { recommendationModel?: string }).recommendationModel).toBe(
      'CONTEXTUAL_V3',
    );
    expect(contextualService.recommend).toHaveBeenCalledWith(
      expect.objectContaining({ heroId: 2 }),
    );
    expect(transitionService.ensureReady).not.toHaveBeenCalled();
    expect(transitionService.getHeroPolicy).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        modelOnly: true,
        fallbackEnabled: false,
        contextualResponseCount: 1,
        baselineResponseCount: 0,
        fallbackCount: 0,
        modelErrorCount: 0,
      }),
    );
  });

  it('propagates model failures instead of returning baseline', async () => {
    const transitionService = {
      ensureReady: jest.fn(async () => undefined),
      getStatus: jest.fn(),
      getHeroPolicy: jest.fn(),
    } as unknown as HeroBuildTransitionAggregationService;
    const recipeService = {
      getComponentItemIds: jest.fn(() => []),
    } as unknown as RecipeAwareTimelineReconciliationService;
    const contextualService = {
      getStatus: jest.fn(() => ({ state: 'READY' })),
      recommend: jest.fn(() => {
        throw new Error('model exploded');
      }),
    } as unknown as HeroBuildContextualV3LiveService;
    const service = new ProductionHeroBuildRecommendationService(
      transitionService,
      recipeService,
      contextualService,
    );

    await expect(
      service.recommend({
        heroId: 2,
        itemIds: [],
        gameTimeS: 180,
        limit: 5,
      }),
    ).rejects.toThrow('model exploded');

    expect(transitionService.ensureReady).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        fallbackCount: 0,
        baselineResponseCount: 0,
        modelErrorCount: 1,
        lastModelError: 'model exploded',
      }),
    );
  });
});

function createModelResponse(heroId: number) {
  return {
    mode: 'BACKOFF' as const,
    heroId,
    requestedStateKey: 'EMPTY',
    gameTimeS: 180,
    matchedStateKey: 'EMPTY',
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    observationCount: 10,
    candidateStateCount: 5,
    action: createAction(),
    alternatives: [],
    recommendationModel: 'CONTEXTUAL_V3' as const,
    modelVersion: 'CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_1',
    modelSha256: 'test',
    candidateSetPolicy: 'TRAIN_OBSERVED_GLOBAL_BACKOFF_LEGAL_SHORTLIST',
    candidateLimit: 128,
    buildArchetypeId: 'UNKNOWN',
    contextualFeatures: {
      phase: 'EARLY' as const,
      alliedHeroIds: [],
      enemyHeroIds: [],
      previousActionCount: 0,
      archetypeApplied: false,
    },
  };
}

function createAction() {
  return {
    type: 'BUY' as const,
    sourceActionType: 'BUY' as const,
    itemId: 100,
    actionKey: 'BUY:100',
    historicalCount: 10,
    historicalProbability: 1,
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
    score: 1,
    confidence: 1,
  };
}
