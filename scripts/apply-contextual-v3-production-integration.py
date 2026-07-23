from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    if old not in source:
        raise RuntimeError(f'Expected block was not found in {path}')
    target.write_text(source.replace(old, new, 1))


replace(
    'apps/api/src/deadlock-live/contextual-hero-build-recommendation.service.ts',
    """export interface HeroBuildContextualRecommendationRequest
  extends HeroBuildRecommendationRequest {
  enemyHeroIds?: number[];
}
""",
    """export interface HeroBuildContextualRecommendationRequest
  extends HeroBuildRecommendationRequest {
  enemyHeroIds?: number[];
  alliedHeroIds?: number[];
  previousActionKeys?: string[];
}
""",
)

replace(
    'apps/api/src/deadlock-live/hero-build-recommendation.controller.ts',
    """import { ProductionHeroBuildRecommendationService } from './production-hero-build-recommendation.service';
""",
    """import { ProductionHeroBuildRecommendationService } from './production-hero-build-recommendation.service';
import { RecipeAwareTimelineReconciliationService } from './recipe-aware-timeline-reconciliation.service';
""",
)

replace(
    'apps/api/src/deadlock-live/hero-build-recommendation.controller.ts',
    """interface ValidatedRecommendHeroBuildRequest {
  recommendationRequest: HeroBuildContextualRecommendationRequest;
  alternativeFilter: HeroBuildAlternativeFilterOptions;
}
""",
    """interface ValidatedRecommendHeroBuildRequest {
  recommendationRequest: HeroBuildContextualRecommendationRequest;
  alternativeFilter: HeroBuildAlternativeFilterOptions;
}

interface ResolvedLiveRecommendationContext {
  alliedHeroIds: number[];
  enemyHeroIds: number[];
  previousActionKeys: string[];
}
""",
)

replace(
    'apps/api/src/deadlock-live/hero-build-recommendation.controller.ts',
    """    private readonly liveMatchStateService: LiveMatchStateService,
  ) {}
""",
    """    private readonly liveMatchStateService: LiveMatchStateService,
    private readonly recipeAwareTimelineReconciliationService:
      RecipeAwareTimelineReconciliationService,
  ) {}
""",
)

replace(
    'apps/api/src/deadlock-live/hero-build-recommendation.controller.ts',
    """    const enemyHeroIds =
      validated.recommendationRequest.enemyHeroIds ??
      this.resolveLiveEnemyHeroIds(validated.recommendationRequest.heroId);
    const contextualRequest: HeroBuildContextualRecommendationRequest = {
      ...validated.recommendationRequest,
      enemyHeroIds,
      limit: HERO_BUILD_MAX_RECOMMENDATION_LIMIT,
    };
""",
    """    const liveContext = this.resolveLiveContext(
      validated.recommendationRequest.heroId,
    );
    const contextualRequest: HeroBuildContextualRecommendationRequest = {
      ...validated.recommendationRequest,
      enemyHeroIds:
        validated.recommendationRequest.enemyHeroIds ??
        liveContext.enemyHeroIds,
      alliedHeroIds: liveContext.alliedHeroIds,
      previousActionKeys: liveContext.previousActionKeys,
      limit: HERO_BUILD_MAX_RECOMMENDATION_LIMIT,
    };
""",
)

replace(
    'apps/api/src/deadlock-live/hero-build-recommendation.controller.ts',
    """  private resolveLiveEnemyHeroIds(heroId: number): number[] {
    const canonicalRequestedHeroId = canonicalHeroId(heroId);
    const states = this.liveMatchStateService
      .getAllStates()
      .sort(
        (left, right) =>
          Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt),
      );

    for (const state of states) {
      const players = Object.values(state.playersBySteamId);
      const localPlayer = players.find(
        (player) =>
          player.isLocal === true &&
          Number.isSafeInteger(player.heroId) &&
          canonicalHeroId(Number(player.heroId)) === canonicalRequestedHeroId,
      );
      if (!localPlayer || localPlayer.teamId === undefined) {
        continue;
      }

      return [...new Set(
        players
          .filter(
            (player) =>
              player.teamId !== undefined &&
              player.teamId !== localPlayer.teamId &&
              Number.isSafeInteger(player.heroId) &&
              Number(player.heroId) > 0,
          )
          .map((player) => Number(player.heroId)),
      )].sort((left, right) => left - right);
    }

    return [];
  }
""",
    """  private resolveLiveContext(heroId: number): ResolvedLiveRecommendationContext {
    const canonicalRequestedHeroId = canonicalHeroId(heroId);
    const states = this.liveMatchStateService
      .getAllStates()
      .sort(
        (left, right) =>
          Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt),
      );

    for (const state of states) {
      const entries = Object.entries(state.playersBySteamId);
      const localEntry = entries.find(
        ([, player]) =>
          player.isLocal === true &&
          Number.isSafeInteger(player.heroId) &&
          canonicalHeroId(Number(player.heroId)) === canonicalRequestedHeroId,
      );
      if (!localEntry || localEntry[1].teamId === undefined) {
        continue;
      }

      const [localPlayerId, localPlayer] = localEntry;
      const alliedHeroIds = [...new Set(
        entries
          .filter(
            ([playerId, player]) =>
              playerId !== localPlayerId &&
              player.teamId === localPlayer.teamId &&
              Number.isSafeInteger(player.heroId) &&
              Number(player.heroId) > 0,
          )
          .map(([, player]) => Number(player.heroId)),
      )].sort((left, right) => left - right);
      const enemyHeroIds = [...new Set(
        entries
          .filter(
            ([, player]) =>
              player.teamId !== undefined &&
              player.teamId !== localPlayer.teamId &&
              Number.isSafeInteger(player.heroId) &&
              Number(player.heroId) > 0,
          )
          .map(([, player]) => Number(player.heroId)),
      )].sort((left, right) => left - right);
      const inventorySnapshots = this.liveMatchStateService
        .getSnapshots(state.matchId)
        .map((snapshot) => snapshot.playersBySteamId[localPlayerId]?.itemIds)
        .filter((itemIds): itemIds is number[] => Array.isArray(itemIds));
      inventorySnapshots.push(localPlayer.items.map((item) => item.id));
      const previousActionKeys = deriveContextualV3PreviousActionKeys(
        inventorySnapshots,
        (parentItemId) =>
          this.recipeAwareTimelineReconciliationService.getComponentItemIds(
            parentItemId,
          ),
      );

      return { alliedHeroIds, enemyHeroIds, previousActionKeys };
    }

    return {
      alliedHeroIds: [],
      enemyHeroIds: [],
      previousActionKeys: [],
    };
  }
""",
)

controller = Path('apps/api/src/deadlock-live/hero-build-recommendation.controller.ts')
controller.write_text(
    controller.read_text()
    + """

export function deriveContextualV3PreviousActionKeys(
  inventorySnapshots: readonly (readonly number[])[],
  recipeResolver: (parentItemId: number) => readonly number[],
): string[] {
  const actions: string[] = [];
  let previous = new Map<number, number>();

  for (const snapshot of inventorySnapshots) {
    const next = createItemCounts(snapshot);
    if (sameItemCounts(previous, next)) {
      continue;
    }
    const additions = subtractItemCounts(next, previous);
    const removals = subtractItemCounts(previous, next);

    for (const itemId of [...additions.keys()].sort((left, right) => left - right)) {
      while ((additions.get(itemId) ?? 0) > 0) {
        const components = recipeResolver(itemId);
        if (
          components.length === 0 ||
          !components.every(
            (componentItemId) => (removals.get(componentItemId) ?? 0) > 0,
          )
        ) {
          break;
        }
        decrementItemCount(additions, itemId);
        for (const componentItemId of components) {
          decrementItemCount(removals, componentItemId);
        }
        actions.push(`UPGRADE:${itemId}`);
      }
    }

    appendCountedActions(actions, removals, 'SELL');
    appendCountedActions(actions, additions, 'BUY');
    previous = next;
  }

  return actions.slice(0, 64);
}

function createItemCounts(itemIds: readonly number[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const itemId of itemIds) {
    if (Number.isSafeInteger(itemId) && itemId > 0) {
      result.set(itemId, (result.get(itemId) ?? 0) + 1);
    }
  }
  return result;
}

function subtractItemCounts(
  left: ReadonlyMap<number, number>,
  right: ReadonlyMap<number, number>,
): Map<number, number> {
  const result = new Map<number, number>();
  for (const [itemId, count] of left) {
    const difference = count - (right.get(itemId) ?? 0);
    if (difference > 0) {
      result.set(itemId, difference);
    }
  }
  return result;
}

function sameItemCounts(
  left: ReadonlyMap<number, number>,
  right: ReadonlyMap<number, number>,
): boolean {
  return (
    left.size === right.size &&
    [...left].every(([itemId, count]) => right.get(itemId) === count)
  );
}

function decrementItemCount(counts: Map<number, number>, itemId: number): void {
  const count = counts.get(itemId) ?? 0;
  if (count <= 1) {
    counts.delete(itemId);
  } else {
    counts.set(itemId, count - 1);
  }
}

function appendCountedActions(
  actions: string[],
  counts: ReadonlyMap<number, number>,
  actionType: 'BUY' | 'SELL',
): void {
  for (const [itemId, count] of [...counts].sort(([left], [right]) => left - right)) {
    for (let index = 0; index < count; index += 1) {
      actions.push(`${actionType}:${itemId}`);
    }
  }
}
"""
)

replace(
    'apps/api/src/deadlock-live/hero-build-recommendation-presentation.service.ts',
    """  | 'DIRECTIONAL_STATE_INFERENCE'
  | 'NO_HERO_POLICY'
""",
    """  | 'DIRECTIONAL_STATE_INFERENCE'
  | 'CONTEXTUAL_V3_MODEL'
  | 'NO_HERO_POLICY'
""",
)

replace(
    'apps/api/src/deadlock-live/hero-build-recommendation-presentation.service.ts',
    """  const probability = toPercent(action.historicalProbability);
  const typicalTime = formatGameTime(action.averageGameTimeS);

  if (response.mode === 'EXACT') {
""",
    """  const probability = toPercent(action.historicalProbability);
  const typicalTime = formatGameTime(action.averageGameTimeS);
  const contextualV3 = response as HeroBuildRecommendationResponse & {
    recommendationModel?: string;
    buildArchetypeId?: string;
    contextualFeatures?: {
      phase?: string;
      alliedHeroIds?: number[];
      enemyHeroIds?: number[];
      previousActionCount?: number;
      archetypeApplied?: boolean;
    };
  };
  if (contextualV3.recommendationModel === 'CONTEXTUAL_V3') {
    const features = contextualV3.contextualFeatures;
    return {
      code: 'CONTEXTUAL_V3_MODEL',
      evidenceLevel: 'INFERRED',
      text:
        `Contextual V3 ranked this action for ${features?.phase ?? 'UNKNOWN'} phase ` +
        `using ${features?.alliedHeroIds?.length ?? 0} allies, ` +
        `${features?.enemyHeroIds?.length ?? 0} enemies, and ` +
        `${features?.previousActionCount ?? 0} observed build actions ` +
        `(archetype ${contextualV3.buildArchetypeId ?? 'UNKNOWN'}).`,
    };
  }

  if (response.mode === 'EXACT') {
""",
)

replace(
    'apps/api/src/deadlock-live/deadlock-live.module.ts',
    """import { HeroBuildContextualV3FinalTestController } from './hero-build-contextual-v3-final-test.controller';
import { HeroBuildContextualV3FinalTestService } from './hero-build-contextual-v3-final-test.service';
""",
    """import { HeroBuildContextualV3FinalTestController } from './hero-build-contextual-v3-final-test.controller';
import { HeroBuildContextualV3FinalTestService } from './hero-build-contextual-v3-final-test.service';
import { HeroBuildContextualV3LiveController } from './hero-build-contextual-v3-live.controller';
import { HeroBuildContextualV3LiveService } from './hero-build-contextual-v3-live.service';
""",
)

replace(
    'apps/api/src/deadlock-live/deadlock-live.module.ts',
    """    HeroBuildContextualV3FinalTestController,
    SkillBuildAnalysisController,
""",
    """    HeroBuildContextualV3FinalTestController,
    HeroBuildContextualV3LiveController,
    SkillBuildAnalysisController,
""",
)

replace(
    'apps/api/src/deadlock-live/deadlock-live.module.ts',
    """    HeroBuildContextualV3FinalTestService,
    {
      provide: HeroBuildOfflineEvaluationService,
""",
    """    HeroBuildContextualV3FinalTestService,
    HeroBuildContextualV3LiveService,
    {
      provide: HeroBuildOfflineEvaluationService,
""",
)

replace(
    'apps/api/src/deadlock-live/deadlock-live.module.ts',
    """    {
      provide: HeroBuildRecommendationService,
      useExisting: ContextualHeroBuildRecommendationService,
    },
""",
    """    {
      provide: HeroBuildRecommendationService,
      useExisting: ProductionHeroBuildRecommendationService,
    },
""",
)

replace(
    'apps/api/src/deadlock-live/deadlock-live.module.ts',
    """    HeroBuildContextualV3FinalTestService,
    HeroBuildRecommendationService,
""",
    """    HeroBuildContextualV3FinalTestService,
    HeroBuildContextualV3LiveService,
    HeroBuildRecommendationService,
""",
)

replace(
    'docker-compose.yml',
    """      - DEADLOCK_CONTEXTUAL_V3_TRAINING_DIR=${DEADLOCK_CONTEXTUAL_V3_TRAINING_DIR:-/app/apps/api/storage/contextual-v3-training}
      - DEADLOCK_CONTEXTUAL_V3_EXPECTED_SOURCE_SHA256=${DEADLOCK_CONTEXTUAL_V3_EXPECTED_SOURCE_SHA256:-be4522139021cc5d7c449b0845cba8fbbd7fe781cd2eff5e30099924782770f7}
""",
    """      - DEADLOCK_CONTEXTUAL_V3_TRAINING_DIR=${DEADLOCK_CONTEXTUAL_V3_TRAINING_DIR:-/app/apps/api/storage/contextual-v3-training}
      - DEADLOCK_CONTEXTUAL_V3_CANDIDATE_EVALUATION_DIR=${DEADLOCK_CONTEXTUAL_V3_CANDIDATE_EVALUATION_DIR:-/app/apps/api/storage/contextual-v3-candidate-evaluation-v2}
      - DEADLOCK_CONTEXTUAL_V3_FINAL_TEST_DIR=${DEADLOCK_CONTEXTUAL_V3_FINAL_TEST_DIR:-/app/apps/api/storage/contextual-v3-final-test}
      - DEADLOCK_CONTEXTUAL_V3_EXPECTED_SOURCE_SHA256=${DEADLOCK_CONTEXTUAL_V3_EXPECTED_SOURCE_SHA256:-be4522139021cc5d7c449b0845cba8fbbd7fe781cd2eff5e30099924782770f7}
      - DEADLOCK_CONTEXTUAL_V3_PRODUCTION_EXPECTED_MODEL_SHA256=${DEADLOCK_CONTEXTUAL_V3_PRODUCTION_EXPECTED_MODEL_SHA256:-88e3400e7bc88f0af7a6752fc4b7ea9b83af9a8a6424dff707b151e6459f10d3}
      - DEADLOCK_CONTEXTUAL_V3_LIVE_MODE=${DEADLOCK_CONTEXTUAL_V3_LIVE_MODE:-PRODUCTION}
      - DEADLOCK_CONTEXTUAL_V3_SHADOW_SAMPLE_RATE=${DEADLOCK_CONTEXTUAL_V3_SHADOW_SAMPLE_RATE:-1}
      - DEADLOCK_CONTEXTUAL_V3_SHADOW_MAX_IN_FLIGHT=${DEADLOCK_CONTEXTUAL_V3_SHADOW_MAX_IN_FLIGHT:-2}
""",
)
