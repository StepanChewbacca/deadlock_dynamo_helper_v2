import { Injectable } from '@nestjs/common';
import { canonicalHeroId } from './hero-id-aliases';
import {
  GraphMatchupEvidence,
  GRAPH_MATCHUP_MODEL_VERSION,
  HeroBuildMatchupStatisticsService,
} from './hero-build-matchup-statistics.service';
import {
  HERO_BUILD_DEFAULT_RECOMMENDATION_LIMIT,
  HERO_BUILD_MAX_BACKOFF_DISTANCE,
  HERO_BUILD_MAX_BACKOFF_STATES,
  HERO_BUILD_MIN_EXACT_OBSERVATIONS,
  HeroBuildRecommendationAction,
  HeroBuildRecommendationRequest,
  HeroBuildRecommendationResponse,
  HeroBuildRecommendationService,
  normalizeRecommendationLimit,
  parseInventoryStateKey,
  recommendFromPolicy,
} from './hero-build-recommendation.service';
import {
  createInventoryStateKeyFromItemIds,
  HeroBuildTransitionAggregationService,
} from './hero-build-transition-aggregation.service';
import { RecipeAwareTimelineReconciliationService } from './recipe-aware-timeline-reconciliation.service';

export const HERO_BUILD_CONTEXTUAL_CANDIDATE_LIMIT = 100;

export interface HeroBuildContextualRecommendationRequest
  extends HeroBuildRecommendationRequest {
  enemyHeroIds?: number[];
}

export interface ContextualRecommendationCandidateSource {
  action: HeroBuildRecommendationAction;
  baseRank: number;
  wasInBaseBuild: boolean;
}

export type ContextualHeroBuildRecommendationAction =
  HeroBuildRecommendationAction & {
    baseScore: number;
    contextualScore: number;
    baseRank: number;
    contextualRank: number;
    wasInBaseBuild: boolean;
    isSituational: boolean;
    wasPromotedByMatchup: boolean;
    wasInsertedByMatchup: boolean;
    situationalAgainstHeroId?: number;
    situationalInteractionOddsRatio?: number;
    situationalLower95OddsRatio?: number;
    matchupObservationCount: number;
    matchupModelVersion: typeof GRAPH_MATCHUP_MODEL_VERSION;
    matchupEvidence: GraphMatchupEvidence[];
  };

export type ContextualHeroBuildRecommendationResponse = Omit<
  HeroBuildRecommendationResponse,
  'action' | 'alternatives'
> & {
  enemyHeroIds: number[];
  matchupModelVersion: typeof GRAPH_MATCHUP_MODEL_VERSION;
  evaluatedCandidateCount: number;
  situationalCandidateCount: number;
  promotedSituationalCandidateCount: number;
  insertedSituationalCandidateCount: number;
  action: ContextualHeroBuildRecommendationAction;
  alternatives: ContextualHeroBuildRecommendationAction[];
};

interface ExpandedRecommendationCandidatePool {
  baseResponse: HeroBuildRecommendationResponse;
  candidates: ContextualRecommendationCandidateSource[];
}

@Injectable()
export class ContextualHeroBuildRecommendationService extends HeroBuildRecommendationService {
  constructor(
    private readonly contextualTransitionAggregationService: HeroBuildTransitionAggregationService,
    private readonly contextualRecipeReconciliationService: RecipeAwareTimelineReconciliationService,
    private readonly heroBuildMatchupStatisticsService:
      HeroBuildMatchupStatisticsService,
  ) {
    super(
      contextualTransitionAggregationService,
      contextualRecipeReconciliationService,
    );
  }

  async recommend(
    request: HeroBuildContextualRecommendationRequest,
  ): Promise<ContextualHeroBuildRecommendationResponse> {
    const requestedLimit = normalizeRecommendationLimit(request.limit);
    const pool = await this.recommendExpandedCandidatePool(request);
    const baseResponse = pool.baseResponse;
    const enemyHeroIds = normalizeEnemyHeroIds(request.enemyHeroIds ?? []);
    const contextualActions = await Promise.all(
      pool.candidates.map((candidate) =>
        this.contextualizeAction(
          request.heroId,
          enemyHeroIds,
          candidate.action,
          candidate.baseRank,
          candidate.wasInBaseBuild,
        ),
      ),
    );
    const rankedActions = rankContextualActions(
      contextualActions,
      requestedLimit,
    );
    const selectedActions = rankedActions.slice(0, requestedLimit);
    const action = selectedActions[0];
    const alternatives = selectedActions.slice(1);

    return {
      ...baseResponse,
      matchedStateKey: action.matchedStateKey,
      stateDistance: action.stateDistance,
      missingItemCount: action.missingItemCount,
      extraItemCount: action.extraItemCount,
      matchedBySubset: action.matchedBySubset,
      observationCount: action.matchedStateObservationCount,
      enemyHeroIds,
      matchupModelVersion: GRAPH_MATCHUP_MODEL_VERSION,
      evaluatedCandidateCount: rankedActions.length,
      situationalCandidateCount: rankedActions.filter(
        (candidate) => candidate.isSituational,
      ).length,
      promotedSituationalCandidateCount: rankedActions.filter(
        (candidate) => candidate.wasPromotedByMatchup,
      ).length,
      insertedSituationalCandidateCount: rankedActions.filter(
        (candidate) => candidate.wasInsertedByMatchup,
      ).length,
      action,
      alternatives,
    };
  }

  private async recommendExpandedCandidatePool(
    request: HeroBuildContextualRecommendationRequest,
  ): Promise<ExpandedRecommendationCandidatePool> {
    await this.contextualTransitionAggregationService.ensureReady();

    const policyStatus = this.contextualTransitionAggregationService.getStatus();
    const policy = this.contextualTransitionAggregationService.getHeroPolicy(request.heroId);
    if (!policy) {
      const baseResponse = await super.recommend(request);
      return {
        baseResponse,
        candidates: createBaseCandidateSources(baseResponse),
      };
    }

    const requestedStateKey = createInventoryStateKeyFromItemIds(request.itemIds);
    const parsedStates = [...policy.statesByKey.values()]
      .map((state) => ({
        state,
        itemCounts: parseInventoryStateKey(state.stateKey),
      }))
      .filter(
        (
          value,
        ): value is {
          state: typeof value.state;
          itemCounts: ReadonlyMap<number, number>;
        } => value.itemCounts !== undefined,
      );
    const recipeResolver = (parentItemId: number): readonly number[] =>
      this.contextualRecipeReconciliationService.getComponentItemIds(parentItemId);
    const commonOptions = {
      maxBackoffDistance: HERO_BUILD_MAX_BACKOFF_DISTANCE,
      maxBackoffStates: HERO_BUILD_MAX_BACKOFF_STATES,
      limit: HERO_BUILD_CONTEXTUAL_CANDIDATE_LIMIT,
    };
    const baseResponse = recommendFromPolicy(
      request,
      requestedStateKey,
      policy,
      parsedStates,
      recipeResolver,
      {
        ...commonOptions,
        minExactObservations: HERO_BUILD_MIN_EXACT_OBSERVATIONS,
      },
    );
    const nearbyResponse = recommendFromPolicy(
      request,
      requestedStateKey,
      policy,
      parsedStates,
      recipeResolver,
      {
        ...commonOptions,
        minExactObservations: Number.MAX_SAFE_INTEGER,
      },
    );
    const policyLastRefreshedAt = policyStatus.lastRefreshedAt
      ? new Date(policyStatus.lastRefreshedAt)
      : undefined;
    const responseWithVersion = {
      ...baseResponse,
      policyLastRefreshedAt,
    };

    return {
      baseResponse: responseWithVersion,
      candidates: mergeContextualRecommendationCandidatePool(
        [baseResponse.action, ...baseResponse.alternatives],
        [nearbyResponse.action, ...nearbyResponse.alternatives],
        HERO_BUILD_CONTEXTUAL_CANDIDATE_LIMIT,
      ),
    };
  }

  private async contextualizeAction(
    heroId: number,
    enemyHeroIds: number[],
    action: HeroBuildRecommendationAction,
    baseRank: number,
    wasInBaseBuild: boolean,
  ): Promise<ContextualHeroBuildRecommendationAction> {
    if (
      enemyHeroIds.length === 0 ||
      action.type === 'HOLD' ||
      action.itemId === undefined ||
      action.sourceActionType === undefined
    ) {
      return createUnchangedContextualAction(
        action,
        baseRank,
        wasInBaseBuild,
      );
    }

    const evaluation = await this.heroBuildMatchupStatisticsService.evaluate({
      heroId,
      stateKey: action.matchedStateKey,
      actionKey: `${action.sourceActionType}:${action.itemId}`,
      enemyHeroIds,
    });
    const bestEvidence = evaluation.bestEvidence;
    const conservativeInteractionLogOdds = Math.max(
      0,
      bestEvidence?.lower95InteractionLogOddsRatio ?? 0,
    );
    const contextualScore = applyConservativeMatchupOdds(
      action.score,
      conservativeInteractionLogOdds,
    );

    return {
      ...action,
      score: contextualScore,
      baseScore: action.score,
      contextualScore,
      baseRank,
      contextualRank: baseRank,
      wasInBaseBuild,
      isSituational: conservativeInteractionLogOdds > 0,
      wasPromotedByMatchup: false,
      wasInsertedByMatchup: false,
      situationalAgainstHeroId:
        conservativeInteractionLogOdds > 0
          ? bestEvidence?.enemyHeroId
          : undefined,
      situationalInteractionOddsRatio:
        conservativeInteractionLogOdds > 0
          ? bestEvidence?.interactionOddsRatio
          : undefined,
      situationalLower95OddsRatio:
        conservativeInteractionLogOdds > 0
          ? bestEvidence?.lower95InteractionOddsRatio
          : undefined,
      matchupObservationCount: bestEvidence?.matchupObservationCount ?? 0,
      matchupModelVersion: GRAPH_MATCHUP_MODEL_VERSION,
      matchupEvidence: evaluation.evidence,
    };
  }
}

export function mergeContextualRecommendationCandidatePool(
  baseActions: readonly HeroBuildRecommendationAction[],
  nearbyActions: readonly HeroBuildRecommendationAction[],
  limit = HERO_BUILD_CONTEXTUAL_CANDIDATE_LIMIT,
): ContextualRecommendationCandidateSource[] {
  const candidates: ContextualRecommendationCandidateSource[] = [];
  const seenActionKeys = new Set<string>();

  for (const action of baseActions) {
    if (seenActionKeys.has(action.actionKey)) {
      continue;
    }
    seenActionKeys.add(action.actionKey);
    candidates.push({
      action: { ...action },
      baseRank: candidates.length + 1,
      wasInBaseBuild: true,
    });
  }

  for (const action of nearbyActions) {
    if (seenActionKeys.has(action.actionKey) || action.type === 'HOLD') {
      continue;
    }
    seenActionKeys.add(action.actionKey);
    candidates.push({
      action: { ...action },
      baseRank: candidates.length + 1,
      wasInBaseBuild: false,
    });
    if (candidates.length >= limit) {
      break;
    }
  }

  return candidates.slice(0, limit);
}

export function applyConservativeMatchupOdds(
  baseScore: number,
  conservativeInteractionLogOdds: number,
): number {
  const probability = clampProbability(baseScore);
  if (probability <= 0 || conservativeInteractionLogOdds <= 0) {
    return probability;
  }
  if (probability >= 1) {
    return 1;
  }

  const baseOdds = probability / (1 - probability);
  const contextualOdds = baseOdds * Math.exp(conservativeInteractionLogOdds);
  return contextualOdds / (1 + contextualOdds);
}

export function rankContextualActions(
  actions: readonly ContextualHeroBuildRecommendationAction[],
  visibleLimit = HERO_BUILD_DEFAULT_RECOMMENDATION_LIMIT,
): ContextualHeroBuildRecommendationAction[] {
  return [...actions]
    .sort(compareContextualActions)
    .map((action, index) => {
      const contextualRank = index + 1;
      return {
        ...action,
        contextualRank,
        wasPromotedByMatchup:
          action.isSituational && contextualRank < action.baseRank,
        wasInsertedByMatchup:
          action.isSituational &&
          (!action.wasInBaseBuild || action.baseRank > visibleLimit) &&
          contextualRank <= visibleLimit,
      };
    });
}

function createBaseCandidateSources(
  response: HeroBuildRecommendationResponse,
): ContextualRecommendationCandidateSource[] {
  return [response.action, ...response.alternatives].map((action, index) => ({
    action: { ...action },
    baseRank: index + 1,
    wasInBaseBuild: true,
  }));
}

function createUnchangedContextualAction(
  action: HeroBuildRecommendationAction,
  baseRank: number,
  wasInBaseBuild: boolean,
): ContextualHeroBuildRecommendationAction {
  return {
    ...action,
    baseScore: action.score,
    contextualScore: action.score,
    baseRank,
    contextualRank: baseRank,
    wasInBaseBuild,
    isSituational: false,
    wasPromotedByMatchup: false,
    wasInsertedByMatchup: false,
    matchupObservationCount: 0,
    matchupModelVersion: GRAPH_MATCHUP_MODEL_VERSION,
    matchupEvidence: [],
  };
}

function normalizeEnemyHeroIds(heroIds: readonly number[]): number[] {
  return [...new Set(
    heroIds
      .filter((heroId) => Number.isSafeInteger(heroId) && heroId > 0)
      .map(canonicalHeroId),
  )].sort((left, right) => left - right);
}

function compareContextualActions(
  left: ContextualHeroBuildRecommendationAction,
  right: ContextualHeroBuildRecommendationAction,
): number {
  if (left.contextualScore !== right.contextualScore) {
    return right.contextualScore - left.contextualScore;
  }

  const leftLowerBound = left.matchupEvidence[0]?.lower95InteractionLogOddsRatio ?? 0;
  const rightLowerBound = right.matchupEvidence[0]?.lower95InteractionLogOddsRatio ?? 0;
  if (leftLowerBound !== rightLowerBound) {
    return rightLowerBound - leftLowerBound;
  }

  if (left.historicalCount !== right.historicalCount) {
    return right.historicalCount - left.historicalCount;
  }

  return left.baseRank - right.baseRank;
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
