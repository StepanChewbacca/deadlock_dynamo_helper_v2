import type { ContextualHeroBuildRecommendationV2Service } from '../src/deadlock-live/contextual-hero-build-recommendation-v2.service';
import type { HeroBuildRecommendationResponse } from '../src/deadlock-live/hero-build-recommendation.service';
import type {
  HeroBuildPolicy,
  HeroBuildTransitionAggregationService,
} from '../src/deadlock-live/hero-build-transition-aggregation.service';
import { ProductionHeroBuildRecommendationService } from '../src/deadlock-live/production-hero-build-recommendation.service';
import type { RecipeAwareTimelineReconciliationService } from '../src/deadlock-live/recipe-aware-timeline-reconciliation.service';

describe('ProductionHeroBuildRecommendationService hero aliases', () => {
  const previousShadowEnabled = process.env.DEADLOCK_CONTEXTUAL_SHADOW_ENABLED;
  const previousShadowSampleRate =
    process.env.DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE;

  afterEach(() => {
    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_SHADOW_ENABLED',
      previousShadowEnabled,
    );
    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE',
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
      process.env.DEADLOCK_CONTEXTUAL_SHADOW_ENABLED = 'true';
      process.env.DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE = '1';

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
        rerank: jest.fn(
          async (
            request: { heroId: number; enemyHeroIds?: number[] },
            baseline: HeroBuildRecommendationResponse,
          ) => createContextualResponse(request, baseline),
        ),
      } as unknown as ContextualHeroBuildRecommendationV2Service;
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
      expect(contextualService.rerank).toHaveBeenCalledWith(
        expect.objectContaining({ heroId: canonicalHeroId }),
        expect.objectContaining({ heroId: requestedHeroId }),
      );
    },
  );

  it('leaves canonical hero ids unchanged', async () => {
    process.env.DEADLOCK_CONTEXTUAL_SHADOW_ENABLED = 'false';

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
      rerank: jest.fn(),
    } as unknown as ContextualHeroBuildRecommendationV2Service;
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
    expect(contextualService.rerank).not.toHaveBeenCalled();
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
  const action = {
    ...baseline.action,
    baseScore: baseline.action.score,
    contextualScore: baseline.action.score,
    baseRank: 1,
    contextualRank: 1,
    contextualLogitBonus: 0,
    rosterInteractionLogOdds: 0,
    observedEnemyCount: request.enemyHeroIds?.length ?? 0,
    eligibleEnemyCount: 0,
    wasPromotedByContext: false,
    modelVersion: 'NEXT_ACTION_ROSTER_SHRINKAGE_V2' as const,
    configId: 'test',
    enemySignals: [],
    contextEvidence: [],
  };
  return {
    ...baseline,
    heroId: request.heroId,
    enemyHeroIds: [...(request.enemyHeroIds ?? [])],
    modelVersion: 'NEXT_ACTION_ROSTER_SHRINKAGE_V2' as const,
    config: {
      id: 'test',
      candidateLimit: 5,
      minimumActionObservations: 1,
      minimumContextObservations: 1,
      shrinkageStrength: 1,
      lambda: 0,
      maximumLogitBonus: 0,
      maximumPromotionDistance: 1,
    },
    evaluatedCandidateCount: 1,
    promotedCandidateCount: 0,
    changedTop1: false,
    changedTop3: false,
    action,
    alternatives: [],
  };
}

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
