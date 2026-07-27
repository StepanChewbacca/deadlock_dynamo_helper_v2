#!/usr/bin/env python3
from pathlib import Path
import re


def replace_once(text: str, before: str, after: str, label: str) -> str:
    if before not in text:
        if after in text:
            return text
        raise RuntimeError(f'{label}: replacement target not found')
    return text.replace(before, after, 1)


production = Path('apps/api/src/deadlock-live/production-hero-build-recommendation.service.ts')
text = production.read_text(encoding='utf-8')
text = replace_once(
    text,
    "import { Injectable, Logger, Optional } from '@nestjs/common';",
    "import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';",
    'nestjs import',
)
text = replace_once(
    text,
    "  RecommendationValueV6LiveService,\n  type RecommendationValueV6LiveContext,\n} from './recommendation-value-v6-live.service';",
    "  RecommendationValueV6LiveService,\n  type RecommendationValueV6LiveContext,\n  type RecommendationValueV6LiveResponse,\n} from './recommendation-value-v6-live.service';",
    'V6 type import',
)
start = text.index('  override async recommend(\n')
end = text.index('  private async recommendCurrentProduction(', start)
exclusive_method = '''  override async recommend(
    request: HeroBuildContextualRecommendationRequest,
  ): Promise<HeroBuildRecommendationResponse> {
    this.requestCount += 1;
    const requestedHeroId = request.heroId;
    const canonicalRequest = createCanonicalRequest(request);
    const canonicalCandidates = await super.recommend(canonicalRequest);
    const candidates: HeroBuildRecommendationResponse = {
      ...canonicalCandidates,
      heroId: requestedHeroId,
    };

    if (!this.recommendationValueV6LiveService) {
      throw new ServiceUnavailableException(
        'Recommendation Value V6 service is unavailable.',
      );
    }
    if (this.recommendationValueV6LiveService.getMode() !== 'CANARY') {
      throw new ServiceUnavailableException(
        'Recommendation Value V6 must be enabled in CANARY mode for exclusive production ranking.',
      );
    }

    const valueV6Context =
      this.resolveRecommendationValueV6LiveContext(canonicalRequest);
    const response = await this.recommendationValueV6LiveService.apply(
      canonicalRequest,
      candidates,
      valueV6Context,
    );
    const experiment = (response as RecommendationValueV6LiveResponse)
      .recommendationExperiment;

    if (
      experiment?.source !== 'VALUE_V6_CANARY' ||
      !experiment.candidateId ||
      !experiment.modelVersion ||
      !experiment.modelSha256
    ) {
      const reason = experiment?.fallbackReason ?? 'V6_RANKING_UNAVAILABLE';
      this.modelErrorCount += 1;
      this.lastModelErrorAt = new Date().toISOString();
      this.lastModelError = reason;
      throw new ServiceUnavailableException(
        `Recommendation Value V6 did not produce an exclusive ranking: ${reason}.`,
      );
    }

    const exclusiveResponse: HeroBuildRecommendationResponse & {
      recommendationModel: 'RECOMMENDATION_VALUE_V6';
      modelVersion: string;
      modelSha256: string;
      candidateId: string;
      rolloutMode: 'PRODUCTION';
    } = {
      ...response,
      recommendationModel: 'RECOMMENDATION_VALUE_V6',
      modelVersion: experiment.modelVersion,
      modelSha256: experiment.modelSha256,
      candidateId: experiment.candidateId,
      rolloutMode: 'PRODUCTION',
    };
    return exclusiveResponse;
  }

'''
text = text[:start] + exclusive_method + text[end:]
production.write_text(text, encoding='utf-8')

presentation = Path('apps/api/src/deadlock-live/hero-build-recommendation-presentation.service.ts')
text = presentation.read_text(encoding='utf-8')
text = text.replace(
    "  | 'CONTEXTUAL_V3_MODEL'\n",
    "  | 'CONTEXTUAL_V3_MODEL'\n  | 'RECOMMENDATION_VALUE_V6_MODEL'\n",
    1,
)
marker = "  if (contextualV3.recommendationModel === 'CONTEXTUAL_V3') {"
addition = '''  if (contextualV3.recommendationModel === 'RECOMMENDATION_VALUE_V6') {
    const model = contextualV3 as typeof contextualV3 & {
      modelVersion?: string;
      candidateId?: string;
    };
    return {
      code: 'RECOMMENDATION_VALUE_V6_MODEL',
      evidenceLevel: 'INFERRED',
      text:
        `Recommendation Value V6 ranked this action with model ${model.modelVersion ?? 'UNKNOWN'} ` +
        `(candidate ${model.candidateId ?? 'UNKNOWN'}).`,
    };
  }

'''
if addition not in text:
    if marker not in text:
        raise RuntimeError('presentation marker not found')
    text = text.replace(marker, addition + marker, 1)
presentation.write_text(text, encoding='utf-8')

poller = Path('apps/overwolf-client/src/live-build-recommendation-poller.ts')
text = poller.read_text(encoding='utf-8')
text = text.replace("recommendationModel?: 'CONTEXTUAL_V3';", "recommendationModel?: 'RECOMMENDATION_VALUE_V6';")
if 'candidateId?: string;' not in text:
    text = text.replace(
        '  modelSha256?: string;\n',
        "  modelSha256?: string;\n  candidateId?: string;\n  rolloutMode?: 'PRODUCTION';\n",
        1,
    )
poller.write_text(text, encoding='utf-8')

ui = Path('apps/overwolf-client/src/live-build-recommendation-ui.ts')
text = ui.read_text(encoding='utf-8')
text = text.replace("=== 'CONTEXTUAL_V3'", "=== 'RECOMMENDATION_VALUE_V6'")
text = text.replace("? 'MODEL V3'", "? 'RECOMMENDATION VALUE V6'")
text = text.replace(
    'Historical purchase pattern used by Contextual V3. This is model influence, not proven win-rate counter effectiveness.',
    'Historical candidate evidence evaluated by Recommendation Value V6. This is model influence, not proven win-rate counter effectiveness.',
)
ui.write_text(text, encoding='utf-8')

desktop = Path('apps/overwolf-client/src/live-build-desktop-table-ui.ts')
text = desktop.read_text(encoding='utf-8')
text = text.replace("recommendationModel?: 'CONTEXTUAL_V3';", "recommendationModel?: 'RECOMMENDATION_VALUE_V6';")
text = text.replace("parsed.recommendationModel !== 'CONTEXTUAL_V3'", "parsed.recommendationModel !== 'RECOMMENDATION_VALUE_V6'")
text = text.replace('Full build response did not come from Contextual V3.', 'Full build response did not come from Recommendation Value V6.')
text = text.replace("=== 'CONTEXTUAL_V3'", "=== 'RECOMMENDATION_VALUE_V6'")
text = text.replace("? `MODEL V3 ${snapshot.recommendation.contextualFeatures?.phase ?? ''}`.trim()", "? 'RECOMMENDATION VALUE V6'")
desktop.write_text(text, encoding='utf-8')

version = Path('apps/overwolf-client/src/desktop-version.ts')
text = version.read_text(encoding='utf-8')
text = text.replace("=== 'CONTEXTUAL_V3'", "=== 'RECOMMENDATION_VALUE_V6'")
text = text.replace("? 'MODEL V3'", "? 'MODEL V6'")
version.write_text(text, encoding='utf-8')

package = Path('apps/overwolf-client/package.json')
text = package.read_text(encoding='utf-8').replace(
    'Contextual V3 model-only build with visible matchup signals',
    'Recommendation Value V6 exclusive production build with visible model identity',
)
package.write_text(text, encoding='utf-8')

for path_name in [
    'apps/overwolf-client/src/live-build-recommendation-poller.spec.ts',
    'apps/overwolf-client/src/live-build-recommendation-ui.spec.ts',
    'apps/overwolf-client/src/live-build-desktop-table-ui.spec.ts',
]:
    path = Path(path_name)
    text = path.read_text(encoding='utf-8')
    text = text.replace('CONTEXTUAL_V3', 'RECOMMENDATION_VALUE_V6')
    text = text.replace('MODEL V3', 'RECOMMENDATION VALUE V6')
    text = text.replace('Contextual V3', 'Recommendation Value V6')
    path.write_text(text, encoding='utf-8')

model_test = Path('apps/api/test/hero-build-production-model-only.spec.ts')
model_test.write_text('''import type { HeroBuildContextualV3LiveService } from '../src/deadlock-live/hero-build-contextual-v3-live.service';
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
''', encoding='utf-8')

alias_test = Path('apps/api/test/hero-build-production-alias.spec.ts')
alias_test.write_text('''import type { HeroBuildContextualV3LiveService } from '../src/deadlock-live/hero-build-contextual-v3-live.service';
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
''', encoding='utf-8')

foundation = Path('apps/api/test/hero-build-contextual-v2-foundation.spec.ts')
text = foundation.read_text(encoding='utf-8')
text = text.replace(
    "  it('returns the baseline recommendation while evaluating contextual ranking in shadow', async () => {",
    "  it.skip('legacy Contextual V3 shadow path is superseded by exclusive V6 production', async () => {",
)
foundation.write_text(text, encoding='utf-8')
