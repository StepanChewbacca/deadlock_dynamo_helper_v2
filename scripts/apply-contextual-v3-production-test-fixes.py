from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    if old not in source:
        raise RuntimeError(f'Expected block was not found in {path}')
    target.write_text(source.replace(old, new, 1))


path = 'apps/api/test/hero-build-contextual-v2-foundation.spec.ts'
replace(
    path,
    """import type {
  ContextualHeroBuildRecommendationV2Service,
  HeroBuildContextualV2RecommendationResponse,
} from '../src/deadlock-live/contextual-hero-build-recommendation-v2.service';
""",
    """import type { HeroBuildContextualV3LiveService } from '../src/deadlock-live/hero-build-contextual-v3-live.service';
""",
)
replace(
    path,
    """  const previousShadowEnabled = process.env.DEADLOCK_CONTEXTUAL_SHADOW_ENABLED;
  const previousShadowSampleRate =
    process.env.DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE;
""",
    """  const previousLiveMode = process.env.DEADLOCK_CONTEXTUAL_V3_LIVE_MODE;
  const previousShadowSampleRate =
    process.env.DEADLOCK_CONTEXTUAL_V3_SHADOW_SAMPLE_RATE;
""",
)
replace(
    path,
    """    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_SHADOW_ENABLED',
      previousShadowEnabled,
    );
    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE',
      previousShadowSampleRate,
    );
""",
    """    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_V3_LIVE_MODE',
      previousLiveMode,
    );
    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_V3_SHADOW_SAMPLE_RATE',
      previousShadowSampleRate,
    );
""",
)
replace(
    path,
    """    process.env.DEADLOCK_CONTEXTUAL_SHADOW_ENABLED = 'true';
    process.env.DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE = '1';
""",
    """    process.env.DEADLOCK_CONTEXTUAL_V3_LIVE_MODE = 'SHADOW';
    process.env.DEADLOCK_CONTEXTUAL_V3_SHADOW_SAMPLE_RATE = '1';
""",
)
replace(
    path,
    """    const contextualResponse = createContextualResponse();
    const contextualService = {
      rerank: jest.fn(async () => contextualResponse),
    } as unknown as ContextualHeroBuildRecommendationV2Service;
""",
    """    const contextualService = {
      getStatus: jest.fn(() => ({ state: 'READY' })),
      recommend: jest.fn((_request, baseline) => ({
        ...baseline,
        recommendationModel: 'CONTEXTUAL_V3',
        modelVersion: 'CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_1',
        modelSha256: 'test',
        candidateSetPolicy: 'TRAIN_OBSERVED_GLOBAL_BACKOFF_LEGAL_SHORTLIST',
        candidateLimit: 128,
        buildArchetypeId: 'UNKNOWN',
        contextualFeatures: {
          phase: 'EARLY',
          alliedHeroIds: [],
          enemyHeroIds: [2, 3, 4, 5, 6],
          previousActionCount: 0,
          archetypeApplied: false,
        },
        action: {
          ...baseline.action,
          itemId: 200,
          actionKey: 'BUY:200',
        },
      })),
    } as unknown as HeroBuildContextualV3LiveService;
""",
)
replace(
    path,
    """    expect(contextualService.rerank).toHaveBeenCalledTimes(1);
    expect(contextualResponse.action.actionKey).toBe('BUY:200');
""",
    """    expect(contextualService.recommend).toHaveBeenCalledTimes(1);
""",
)
start = Path(path).read_text().find('\nfunction createContextualResponse()')
end = Path(path).read_text().find('\nfunction createOutcome(', start)
if start < 0 or end < 0:
    raise RuntimeError(f'Contextual V2 response helper was not found in {path}')
source = Path(path).read_text()
Path(path).write_text(source[:start] + source[end:])

path = 'apps/api/test/hero-build-production-alias.spec.ts'
replace(
    path,
    """import type { ContextualHeroBuildRecommendationV2Service } from '../src/deadlock-live/contextual-hero-build-recommendation-v2.service';
""",
    """import type { HeroBuildContextualV3LiveService } from '../src/deadlock-live/hero-build-contextual-v3-live.service';
""",
)
replace(
    path,
    """  const previousShadowEnabled = process.env.DEADLOCK_CONTEXTUAL_SHADOW_ENABLED;
  const previousShadowSampleRate =
    process.env.DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE;
""",
    """  const previousLiveMode = process.env.DEADLOCK_CONTEXTUAL_V3_LIVE_MODE;
  const previousShadowSampleRate =
    process.env.DEADLOCK_CONTEXTUAL_V3_SHADOW_SAMPLE_RATE;
""",
)
replace(
    path,
    """    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_SHADOW_ENABLED',
      previousShadowEnabled,
    );
    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE',
      previousShadowSampleRate,
    );
""",
    """    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_V3_LIVE_MODE',
      previousLiveMode,
    );
    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_V3_SHADOW_SAMPLE_RATE',
      previousShadowSampleRate,
    );
""",
)
replace(
    path,
    """      process.env.DEADLOCK_CONTEXTUAL_SHADOW_ENABLED = 'true';
      process.env.DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE = '1';
""",
    """      process.env.DEADLOCK_CONTEXTUAL_V3_LIVE_MODE = 'SHADOW';
      process.env.DEADLOCK_CONTEXTUAL_V3_SHADOW_SAMPLE_RATE = '1';
""",
)
replace(
    path,
    """      const contextualService = {
        rerank: jest.fn(
          async (
            request: { heroId: number; enemyHeroIds?: number[] },
            baseline: HeroBuildRecommendationResponse,
          ) => createContextualResponse(request, baseline),
        ),
      } as unknown as ContextualHeroBuildRecommendationV2Service;
""",
    """      const contextualService = {
        getStatus: jest.fn(() => ({ state: 'READY' })),
        recommend: jest.fn(
          (
            request: { heroId: number; enemyHeroIds?: number[] },
            baseline: HeroBuildRecommendationResponse,
          ) => createContextualResponse(request, baseline),
        ),
      } as unknown as HeroBuildContextualV3LiveService;
""",
)
replace(
    path,
    """      expect(contextualService.rerank).toHaveBeenCalledWith(
""",
    """      expect(contextualService.recommend).toHaveBeenCalledWith(
""",
)
replace(
    path,
    """    process.env.DEADLOCK_CONTEXTUAL_SHADOW_ENABLED = 'false';
""",
    """    process.env.DEADLOCK_CONTEXTUAL_V3_LIVE_MODE = 'BASELINE';
""",
)
replace(
    path,
    """    const contextualService = {
      rerank: jest.fn(),
    } as unknown as ContextualHeroBuildRecommendationV2Service;
""",
    """    const contextualService = {
      getStatus: jest.fn(() => ({ state: 'READY' })),
      recommend: jest.fn(),
    } as unknown as HeroBuildContextualV3LiveService;
""",
)
replace(
    path,
    """    expect(contextualService.rerank).not.toHaveBeenCalled();
""",
    """    expect(contextualService.recommend).not.toHaveBeenCalled();
""",
)
start = Path(path).read_text().find('function createContextualResponse(')
end = Path(path).read_text().find('\nfunction restoreEnvironmentValue(', start)
if start < 0 or end < 0:
    raise RuntimeError(f'Contextual response helper was not found in {path}')
source = Path(path).read_text()
replacement = """function createContextualResponse(
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
"""
Path(path).write_text(source[:start] + replacement + source[end:])

path = 'apps/api/test/hero-build-recommendation.controller.spec.ts'
replace(
    path,
    """import { LiveMatchStateService } from '../src/deadlock-live/live-match-state.service';
""",
    """import { LiveMatchStateService } from '../src/deadlock-live/live-match-state.service';
import { RecipeAwareTimelineReconciliationService } from '../src/deadlock-live/recipe-aware-timeline-reconciliation.service';
""",
)
replace(
    path,
    """  const controller = new HeroBuildRecommendationController(
    { recommend } as unknown as HeroBuildRecommendationService,
    { present } as unknown as HeroBuildRecommendationPresentationService,
    { getAllStates } as unknown as LiveMatchStateService,
  );
""",
    """  const getSnapshots = jest.fn(() => []);
  const getComponentItemIds = jest.fn(() => []);
  const controller = new HeroBuildRecommendationController(
    { recommend } as unknown as HeroBuildRecommendationService,
    { present } as unknown as HeroBuildRecommendationPresentationService,
    { getAllStates, getSnapshots } as unknown as LiveMatchStateService,
    { getComponentItemIds } as unknown as RecipeAwareTimelineReconciliationService,
  );
""",
)
