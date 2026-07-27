from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding='utf-8')
    if old not in text:
        raise RuntimeError(f'Expected snippet not found in {path}: {old[:120]!r}')
    file_path.write_text(text.replace(old, new, 1), encoding='utf-8')


# Wire the production-safe V6 implementation behind the existing DI token.
replace_once(
    'apps/api/src/deadlock-live/recommendation-value-v6.module.ts',
    "import { RecommendationValueV6LiveService } from './recommendation-value-v6-live.service';\n",
    "import { RecommendationValueV6LiveService } from './recommendation-value-v6-live.service';\n"
    "import { RecommendationValueV6ProductionSafeService } from './recommendation-value-v6-production-safe.service';\n",
)
replace_once(
    'apps/api/src/deadlock-live/recommendation-value-v6.module.ts',
    "  providers: [\n"
    "    RecommendationValueV6TrainingService,\n"
    "    RecommendationValueV6LiveService,\n"
    "    RecommendationValueV6TelemetryService,\n"
    "  ],\n",
    "  providers: [\n"
    "    RecommendationValueV6TrainingService,\n"
    "    RecommendationValueV6TelemetryService,\n"
    "    RecommendationValueV6ProductionSafeService,\n"
    "    {\n"
    "      provide: RecommendationValueV6LiveService,\n"
    "      useExisting: RecommendationValueV6ProductionSafeService,\n"
    "    },\n"
    "  ],\n",
)

# Wire the production wrapper that preserves the pro candidate ranking on V6 fallback.
replace_once(
    'apps/api/src/deadlock-live/deadlock-live.module.ts',
    "import { ProductionHeroBuildRecommendationService } from './production-hero-build-recommendation.service';\n",
    "import { ProductionHeroBuildRecommendationService } from './production-hero-build-recommendation.service';\n"
    "import { ProductionSafeHeroBuildRecommendationService } from './production-safe-hero-build-recommendation.service';\n",
)
replace_once(
    'apps/api/src/deadlock-live/deadlock-live.module.ts',
    "    ProductionHeroBuildRecommendationService,\n"
    "    {\n"
    "      provide: HeroBuildRecommendationService,\n"
    "      useExisting: ProductionHeroBuildRecommendationService,\n"
    "    },\n",
    "    ProductionSafeHeroBuildRecommendationService,\n"
    "    {\n"
    "      provide: ProductionHeroBuildRecommendationService,\n"
    "      useExisting: ProductionSafeHeroBuildRecommendationService,\n"
    "    },\n"
    "    {\n"
    "      provide: HeroBuildRecommendationService,\n"
    "      useExisting: ProductionSafeHeroBuildRecommendationService,\n"
    "    },\n",
)

# Extend the client contract with explicit ranking/support semantics.
replace_once(
    'apps/overwolf-client/src/live-build-recommendation-poller.ts',
    "  matchupSignals?: LiveBuildRecommendationMatchupSignal[];\n"
    "}\n",
    "  matchupSignals?: LiveBuildRecommendationMatchupSignal[];\n"
    "  confidenceSemantic?: 'CANDIDATE_GENERATOR_EVIDENCE';\n"
    "  valueV6?: {\n"
    "    rankingModel: 'RECOMMENDATION_VALUE_V6';\n"
    "    baselineRank: number;\n"
    "    modelRank?: number;\n"
    "    actionUtility: number;\n"
    "    actionAdvantage: number;\n"
    "    directSupportedActionKeyCount: number;\n"
    "    totalSupportedActionKeyCount: number;\n"
    "    supportType: 'DIRECT_ACTION' | 'GENERIC_ONLY' | 'UNSUPPORTED';\n"
    "  };\n"
    "}\n",
)
replace_once(
    'apps/overwolf-client/src/live-build-recommendation-poller.ts',
    "  recommendationModel?: 'RECOMMENDATION_VALUE_V6';\n"
    "  modelVersion?: string;\n",
    "  recommendationModel?:\n"
    "    | 'RECOMMENDATION_VALUE_V6'\n"
    "    | 'PRO_BUILD_CANDIDATE_GENERATOR';\n"
    "  rankingMode?: 'VALUE_V6' | 'CANDIDATE_GENERATOR_FALLBACK';\n"
    "  rankingSource?: 'RECOMMENDATION_VALUE_V6' | 'CANDIDATE_GENERATOR';\n"
    "  fallbackReason?: string;\n"
    "  modelVersion?: string;\n",
)

# Desktop full-build projection accepts the safe candidate-generator fallback.
replace_once(
    'apps/overwolf-client/src/live-build-desktop-table-ui.ts',
    "  recommendationModel?: 'RECOMMENDATION_VALUE_V6';\n"
    "}\n",
    "  recommendationModel?:\n"
    "    | 'RECOMMENDATION_VALUE_V6'\n"
    "    | 'PRO_BUILD_CANDIDATE_GENERATOR';\n"
    "  rankingMode?: 'VALUE_V6' | 'CANDIDATE_GENERATOR_FALLBACK';\n"
    "  fallbackReason?: string;\n"
    "}\n",
)
replace_once(
    'apps/overwolf-client/src/live-build-desktop-table-ui.ts',
    "    if (parsed.recommendationModel !== 'RECOMMENDATION_VALUE_V6') {\n"
    "      throw new Error('Full build response did not come from Recommendation Value V6.');\n"
    "    }\n",
    "    if (\n"
    "      parsed.recommendationModel !== 'RECOMMENDATION_VALUE_V6' &&\n"
    "      parsed.recommendationModel !== 'PRO_BUILD_CANDIDATE_GENERATOR'\n"
    "    ) {\n"
    "      throw new Error('Full build response did not come from an approved pro-build ranking source.');\n"
    "    }\n",
)
replace_once(
    'apps/overwolf-client/src/live-build-desktop-table-ui.ts',
    "      snapshot.recommendation?.recommendationModel === 'RECOMMENDATION_VALUE_V6'\n"
    "        ? 'RECOMMENDATION VALUE V6'\n"
    "        : snapshot.recommendation\n"
    "          ? 'BASELINE'\n"
    "          : 'WAITING',\n",
    "      snapshot.recommendation?.recommendationModel === 'RECOMMENDATION_VALUE_V6'\n"
    "        ? 'RECOMMENDATION VALUE V6'\n"
    "        : snapshot.recommendation?.recommendationModel === 'PRO_BUILD_CANDIDATE_GENERATOR'\n"
    "          ? 'PRO BUILD FALLBACK'\n"
    "          : snapshot.recommendation\n"
    "            ? 'BASELINE'\n"
    "            : 'WAITING',\n",
)
replace_once(
    'apps/overwolf-client/src/live-build-desktop-table-ui.ts',
    "  const confidence = document.createElement('div');\n"
    "  confidence.className = 'live-build-action-confidence';\n"
    "  const value = document.createElement('strong');\n"
    "  value.textContent = `${formatPercent(action.confidencePercent)}%`;\n"
    "  const caption = document.createElement('span');\n"
    "  caption.textContent = 'confidence';\n"
    "  confidence.append(value, caption);\n",
    "  const confidence = document.createElement('div');\n"
    "  confidence.className = 'live-build-action-confidence';\n"
    "  const value = document.createElement('strong');\n"
    "  const signal = formatRecommendationSignal(action);\n"
    "  value.textContent = signal.value;\n"
    "  const caption = document.createElement('span');\n"
    "  caption.textContent = signal.label;\n"
    "  confidence.append(value, caption);\n",
)
replace_once(
    'apps/overwolf-client/src/live-build-desktop-table-ui.ts',
    "  for (const label of ['#', 'Action', 'Item', 'Type', 'Cost', 'Tier', 'Typical', 'Confidence', 'Evidence']) {\n",
    "  for (const label of ['#', 'Action', 'Item', 'Type', 'Cost', 'Tier', 'Typical', 'Model signal', 'Evidence']) {\n",
)
replace_once(
    'apps/overwolf-client/src/live-build-desktop-table-ui.ts',
    "    `${formatPercent(action.confidencePercent)}%`,\n"
    "    formatEvidence(action),\n",
    "    formatRecommendationSignal(action).value,\n"
    "    formatEvidence(action),\n",
)
replace_once(
    'apps/overwolf-client/src/live-build-desktop-table-ui.ts',
    "function formatItemMetadata(action: LiveBuildRecommendationAction): string {\n",
    "export function formatRecommendationSignal(\n"
    "  action: LiveBuildRecommendationAction,\n"
    "): { value: string; label: string } {\n"
    "  if (\n"
    "    action.valueV6?.supportType === 'DIRECT_ACTION' &&\n"
    "    Number.isFinite(action.valueV6.actionAdvantage)\n"
    "  ) {\n"
    "    const advantage = action.valueV6.actionAdvantage;\n"
    "    return {\n"
    "      value: `${advantage >= 0 ? '+' : ''}${advantage.toFixed(3)}`,\n"
    "      label: 'V6 advantage',\n"
    "    };\n"
    "  }\n"
    "  return {\n"
    "    value: `${formatPercent(action.confidencePercent)}%`,\n"
    "    label: 'historical evidence',\n"
    "  };\n"
    "}\n\n"
    "function formatItemMetadata(action: LiveBuildRecommendationAction): string {\n",
)
replace_once(
    'apps/overwolf-client/src/live-build-desktop-table-ui.ts',
    "  if (snapshot.lastError) {\n"
    "    entries.push(`Backend: ${snapshot.lastError}`);\n"
    "  }\n",
    "  if (snapshot.recommendation?.fallbackReason) {\n"
    "    entries.push(`Ranking fallback: ${snapshot.recommendation.fallbackReason}`);\n"
    "  }\n"
    "  if (snapshot.lastError) {\n"
    "    entries.push(`Backend: ${snapshot.lastError}`);\n"
    "  }\n",
)

# HUD uses V6 advantage when available and labels generator probability honestly.
replace_once(
    'apps/overwolf-client/src/live-build-recommendation-ui.ts',
    "  const source = snapshot.recommendation?.recommendationModel === 'RECOMMENDATION_VALUE_V6'\n"
    "    ? 'RECOMMENDATION VALUE V6'\n"
    "    : snapshot.recommendation\n"
    "      ? 'BASELINE'\n"
    "      : undefined;\n",
    "  const source = snapshot.recommendation?.recommendationModel === 'RECOMMENDATION_VALUE_V6'\n"
    "    ? 'RECOMMENDATION VALUE V6'\n"
    "    : snapshot.recommendation?.recommendationModel === 'PRO_BUILD_CANDIDATE_GENERATOR'\n"
    "      ? 'PRO BUILD FALLBACK'\n"
    "      : snapshot.recommendation\n"
    "        ? 'BASELINE'\n"
    "        : undefined;\n",
)
replace_once(
    'apps/overwolf-client/src/live-build-recommendation-ui.ts',
    "  const confidenceValue = document.createElement('strong');\n"
    "  confidenceValue.textContent = `${formatPercent(action.confidencePercent)}%`;\n"
    "  const confidenceLabel = document.createElement('span');\n"
    "  confidenceLabel.textContent = 'confidence';\n"
    "  confidence.append(confidenceValue, confidenceLabel);\n",
    "  const confidenceValue = document.createElement('strong');\n"
    "  const signal = formatRecommendationActionSignal(action);\n"
    "  confidenceValue.textContent = signal.value;\n"
    "  const confidenceLabel = document.createElement('span');\n"
    "  confidenceLabel.textContent = signal.label;\n"
    "  confidence.append(confidenceValue, confidenceLabel);\n",
)
replace_once(
    'apps/overwolf-client/src/live-build-recommendation-ui.ts',
    "    confidence.textContent = `${formatPercent(action.confidencePercent)}%`;\n",
    "    confidence.textContent = formatRecommendationActionSignal(action).value;\n",
)
replace_once(
    'apps/overwolf-client/src/live-build-recommendation-ui.ts',
    "function formatFirstMatchupSignal(\n",
    "export function formatRecommendationActionSignal(\n"
    "  action: LiveBuildRecommendationAction,\n"
    "): { value: string; label: string } {\n"
    "  if (\n"
    "    action.valueV6?.supportType === 'DIRECT_ACTION' &&\n"
    "    Number.isFinite(action.valueV6.actionAdvantage)\n"
    "  ) {\n"
    "    const advantage = action.valueV6.actionAdvantage;\n"
    "    return {\n"
    "      value: `${advantage >= 0 ? '+' : ''}${advantage.toFixed(3)}`,\n"
    "      label: 'V6 advantage',\n"
    "    };\n"
    "  }\n"
    "  return {\n"
    "    value: `${formatPercent(action.confidencePercent)}%`,\n"
    "    label: 'historical evidence',\n"
    "  };\n"
    "}\n\n"
    "function formatFirstMatchupSignal(\n",
)

# Make the desktop build marker distinguish a V6 ranking from a safe fallback.
replace_once(
    'apps/overwolf-client/src/desktop-version.ts',
    "const APP_VERSION = '0.1.13';\nconst APP_BUILD = '023';\n",
    "const APP_VERSION = '0.1.14';\nconst APP_BUILD = '024';\n",
)
replace_once(
    'apps/overwolf-client/src/desktop-version.ts',
    "    ? snapshot.recommendation.recommendationModel === 'RECOMMENDATION_VALUE_V6'\n"
    "      ? 'MODEL V6'\n"
    "      : 'BASELINE'\n",
    "    ? snapshot.recommendation.recommendationModel === 'RECOMMENDATION_VALUE_V6'\n"
    "      ? 'MODEL V6'\n"
    "      : snapshot.recommendation.recommendationModel === 'PRO_BUILD_CANDIDATE_GENERATOR'\n"
    "        ? 'PRO FALLBACK'\n"
    "        : 'BASELINE'\n",
)
replace_once(
    'apps/overwolf-client/package.json',
    '  "version": "0.1.13",\n',
    '  "version": "0.1.14",\n',
)
replace_once(
    'apps/overwolf-client/package.json',
    '  "description": "Recommendation Value V6 exclusive production build with visible model identity",\n',
    '  "description": "Recommendation Value V6 production build with support-aware pro-build fallback",\n',
)

# API regression coverage.
Path('apps/api/test/recommendation-value-v6-production-safe.spec.ts').write_text(
    """import type { HeroBuildContextualV3LiveService } from '../src/deadlock-live/hero-build-contextual-v3-live.service';
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
""",
    encoding='utf-8',
)

# Overwolf semantic-label regression coverage.
Path('apps/overwolf-client/src/live-build-recommendation-signal.spec.ts').write_text(
    """import type { LiveBuildRecommendationAction } from './live-build-recommendation-poller';
import { formatRecommendationSignal } from './live-build-desktop-table-ui';
import { formatRecommendationActionSignal } from './live-build-recommendation-ui';

describe('recommendation signal formatting', () => {
  it('shows V6 advantage instead of candidate-generator confidence', () => {
    const action = createAction({
      valueV6: {
        rankingModel: 'RECOMMENDATION_VALUE_V6',
        baselineRank: 3,
        modelRank: 1,
        actionUtility: 0.15,
        actionAdvantage: 0.0324,
        directSupportedActionKeyCount: 1,
        totalSupportedActionKeyCount: 4,
        supportType: 'DIRECT_ACTION',
      },
    });

    expect(formatRecommendationSignal(action)).toEqual({
      value: '+0.032',
      label: 'V6 advantage',
    });
    expect(formatRecommendationActionSignal(action)).toEqual({
      value: '+0.032',
      label: 'V6 advantage',
    });
  });

  it('labels generator probability as historical evidence', () => {
    const action = createAction({ confidencePercent: 7.5 });
    expect(formatRecommendationSignal(action)).toEqual({
      value: '7.5%',
      label: 'historical evidence',
    });
  });
});

function createAction(
  overrides: Partial<LiveBuildRecommendationAction> = {},
): LiveBuildRecommendationAction {
  return {
    type: 'BUY',
    itemId: 100,
    actionKey: 'BUY:100',
    label: 'Buy Item 100',
    confidencePercent: 5,
    historicalProbabilityPercent: 5,
    typicalGameTimeLabel: '3:00',
    explanation: {
      code: 'TEST',
      evidenceLevel: 'INFERRED',
      text: 'Test',
    },
    ...overrides,
  };
}
""",
    encoding='utf-8',
)
