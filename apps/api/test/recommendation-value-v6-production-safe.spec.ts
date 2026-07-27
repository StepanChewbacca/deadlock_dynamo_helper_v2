import type { HeroBuildContextualV3LiveService } from '../src/deadlock-live/hero-build-contextual-v3-live.service';
import type { HeroBuildRecommendationResponse } from '../src/deadlock-live/hero-build-recommendation.service';
import type { HeroBuildTransitionAggregationService } from '../src/deadlock-live/hero-build-transition-aggregation.service';
import { ProductionSafeHeroBuildRecommendationService } from '../src/deadlock-live/production-safe-hero-build-recommendation.service';
import {
  countRecommendationValueV6DirectActionSupport,
  isRecommendationValueV6DirectActionKey,
  recommendationValueV6SupportType,
} from '../src/deadlock-live/recommendation-value-v6-production-safe.service';
import type {
  LoadedRecommendationValueV6Model,
  RecommendationValueV6LiveService,
} from '../src/deadlock-live/recommendation-value-v6-live.service';
import type { RecipeAwareTimelineReconciliationService } from '../src/deadlock-live/recipe-aware-timeline-reconciliation.service';

const MODEL_VERSION = 'RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1' as const;

describe('Recommendation Value V6 production safety', () => {
  it('requires item-specific action evidence for direct support', () => {
    expect(isRecommendationValueV6DirectActionKey('HERO_TIME_ACTION:2|1|BUY:100')).toBe(true);
    expect(isRecommendationValueV6DirectActionKey('HERO_TIME_INVENTORY_ACTION:2|1|EMPTY|BUY:100')).toBe(true);
    expect(isRecommendationValueV6DirectActionKey('HERO_SLOT:2|weapon')).toBe(false);
    expect(isRecommendationValueV6DirectActionKey('HERO_TIER:2|2')).toBe(false);
  });

  it('does not treat generic-only support as direct candidate support', () => {
    const loaded = createLoadedModel(new Map([
      ['HERO_TIME_ACTION:2|1|BUY:100', count(10)],
      ['HERO_SLOT:2|weapon', count(200)],
    ]));

    expect(countRecommendationValueV6DirectActionSupport(loaded, [
      'HERO_TIME_ACTION:2|1|BUY:100',
      'HERO_SLOT:2|weapon',
    ])).toBe(1);
    expect(countRecommendationValueV6DirectActionSupport(loaded, [
      'HERO_SLOT:2|weapon',
    ])).toBe(0);
    expect(recommendationValueV6SupportType(0, 1)).toBe('GENERIC_ONLY');
    expect(recommendationValueV6SupportType(0, 0)).toBe('UNSUPPORTED');
    expect(recommendationValueV6SupportType(1, 3)).toBe('DIRECT_ACTION');
  });

  it('returns the pro candidate ranking instead of throwing when V6 falls back', async () => {
    const transitionService = createTransitionService();
    const recipeService = { getComponentItemIds: jest.fn(() => []) } as unknown as RecipeAwareTimelineReconciliationService;
    const v6Service = {
      getMode: jest.fn(() => 'CANARY'),
      apply: jest.fn(async (_request, baseline: HeroBuildRecommendationResponse) => ({
        ...baseline,
        recommendationExperiment: {
          source: 'BASELINE',
          fallbackReason: 'INSUFFICIENT_DIRECTLY_SUPPORTED_CANDIDATES',
        },
      })),
    } as unknown as RecommendationValueV6LiveService;
    const service = new ProductionSafeHeroBuildRecommendationService(
      transitionService,
      recipeService,
      { getStatus: jest.fn(() => ({ state: 'READY' })) } as unknown as HeroBuildContextualV3LiveService,
      v6Service,
    );

    const response = await service.recommend({
      heroId: 2,
      itemIds: [],
      gameTimeS: 180,
      limit: 5,
    });
    const extended = response as HeroBuildRecommendationResponse & {
      recommendationModel?: string;
      rankingMode?: string;
      fallbackReason?: string;
      action: HeroBuildRecommendationResponse['action'] & { confidenceSemantic?: string };
    };

    expect(extended.recommendationModel).toBe('PRO_BUILD_CANDIDATE_GENERATOR');
    expect(extended.rankingMode).toBe('CANDIDATE_GENERATOR_FALLBACK');
    expect(extended.fallbackReason).toBe('INSUFFICIENT_DIRECTLY_SUPPORTED_CANDIDATES');
    expect(extended.action.actionKey).toBe('BUY:100');
    expect(extended.action.confidenceSemantic).toBe('CANDIDATE_GENERATOR_EVIDENCE');
  });
});

function createLoadedModel(action: Map<string, ReturnType<typeof count>>): LoadedRecommendationValueV6Model {
  return {
    candidateId: 'candidate',
    modelVersion: MODEL_VERSION,
    modelSha256: 'a'.repeat(64),
    loadedAt: new Date(0).toISOString(),
    model: {
      version: MODEL_VERSION,
      global: count(1_000),
      state: new Map(),
      action,
    },
    options: {
      statePriorStrength: 10,
      actionPriorStrength: 0.1,
      minimumObservations: 10,
      maximumAbsoluteStateResidual: 1,
      maximumAbsoluteActionResidual: 1,
    },
    actionResidualScale: 1,
  };
}

function count(observations: number) {
  return {
    utilitySum: 0,
    utilitySquaredSum: 0,
    winWeight: observations / 2,
    totalWeight: observations,
    observations,
  };
}

function createTransitionService(): HeroBuildTransitionAggregationService {
  return {
    ensureReady: jest.fn(async () => undefined),
    getStatus: jest.fn(() => ({ lastRefreshedAt: new Date('2026-07-27T00:00:00.000Z') })),
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
        nextActions: [
          createPolicyAction(100, 6),
          createPolicyAction(200, 4),
        ],
      }]]),
    })),
  } as unknown as HeroBuildTransitionAggregationService;
}

function createPolicyAction(itemId: number, countValue: number) {
  return {
    actionType: 'BUY' as const,
    itemId,
    actionKey: `BUY:${itemId}`,
    count: countValue,
    probability: countValue / 10,
    averageGameTimeS: 180,
    afterStates: [{ afterStateKey: `${itemId}x1`, count: countValue, probability: 1 }],
  };
}
