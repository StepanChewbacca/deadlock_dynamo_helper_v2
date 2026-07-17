import { Injectable, Logger } from '@nestjs/common';
import {
  ContextualHeroBuildRecommendationResponse,
  ContextualHeroBuildRecommendationService,
  HeroBuildContextualRecommendationRequest,
} from './contextual-hero-build-recommendation.service';
import { canonicalHeroId } from './hero-id-aliases';
import {
  HeroBuildRecommendationResponse,
  HeroBuildRecommendationService,
} from './hero-build-recommendation.service';
import { HeroBuildTransitionAggregationService } from './hero-build-transition-aggregation.service';
import { RecipeAwareTimelineReconciliationService } from './recipe-aware-timeline-reconciliation.service';

const SHADOW_ENABLED_ENV = 'DEADLOCK_CONTEXTUAL_SHADOW_ENABLED';
const SHADOW_SAMPLE_RATE_ENV = 'DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE';
const SHADOW_MAX_IN_FLIGHT_ENV = 'DEADLOCK_CONTEXTUAL_SHADOW_MAX_IN_FLIGHT';
const DEFAULT_SHADOW_SAMPLE_RATE = 0.1;
const DEFAULT_SHADOW_MAX_IN_FLIGHT = 2;

interface ContextualShadowLog {
  event: 'hero_build_contextual_shadow';
  heroId: number;
  canonicalHeroId: number;
  gameTimeS: number;
  enemyHeroIds: number[];
  baselineMode: HeroBuildRecommendationResponse['mode'];
  contextualMode: ContextualHeroBuildRecommendationResponse['mode'];
  baselineTopActionKey: string;
  contextualTopActionKey: string;
  baselineTop3ActionKeys: string[];
  contextualTop3ActionKeys: string[];
  changedTop1: boolean;
  changedTop3: boolean;
  baselineTopScore: number;
  contextualTopScore: number;
  situationalCandidateCount: number;
  promotedSituationalCandidateCount: number;
  insertedSituationalCandidateCount: number;
  elapsedMs: number;
}

@Injectable()
export class ProductionHeroBuildRecommendationService extends HeroBuildRecommendationService {
  private readonly logger = new Logger(
    ProductionHeroBuildRecommendationService.name,
  );
  private readonly shadowEnabled = readBooleanEnvironmentValue(
    SHADOW_ENABLED_ENV,
    true,
  );
  private readonly shadowSampleRate = readBoundedNumberEnvironmentValue(
    SHADOW_SAMPLE_RATE_ENV,
    DEFAULT_SHADOW_SAMPLE_RATE,
    0,
    1,
  );
  private readonly shadowMaxInFlight = readBoundedIntegerEnvironmentValue(
    SHADOW_MAX_IN_FLIGHT_ENV,
    DEFAULT_SHADOW_MAX_IN_FLIGHT,
    1,
    32,
  );
  private shadowInFlight = 0;

  constructor(
    heroBuildTransitionAggregationService: HeroBuildTransitionAggregationService,
    recipeAwareTimelineReconciliationService: RecipeAwareTimelineReconciliationService,
    private readonly contextualHeroBuildRecommendationService:
      ContextualHeroBuildRecommendationService,
  ) {
    super(
      heroBuildTransitionAggregationService,
      recipeAwareTimelineReconciliationService,
    );
  }

  override async recommend(
    request: HeroBuildContextualRecommendationRequest,
  ): Promise<HeroBuildRecommendationResponse> {
    const requestedHeroId = request.heroId;
    const canonicalRequest = createCanonicalRequest(request);
    const canonicalBaseline = await super.recommend(canonicalRequest);
    const baseline = {
      ...canonicalBaseline,
      heroId: requestedHeroId,
    };
    this.scheduleContextualShadow(
      canonicalRequest,
      requestedHeroId,
      baseline,
    );
    return baseline;
  }

  private scheduleContextualShadow(
    request: HeroBuildContextualRecommendationRequest,
    requestedHeroId: number,
    baseline: HeroBuildRecommendationResponse,
  ): void {
    if (
      !this.shadowEnabled ||
      this.shadowSampleRate <= 0 ||
      this.shadowInFlight >= this.shadowMaxInFlight ||
      Math.random() >= this.shadowSampleRate ||
      !request.enemyHeroIds ||
      request.enemyHeroIds.length === 0
    ) {
      return;
    }

    this.shadowInFlight += 1;
    const startedAt = Date.now();
    void this.contextualHeroBuildRecommendationService
      .recommend({
        ...request,
        itemIds: [...request.itemIds],
        enemyHeroIds: [...request.enemyHeroIds],
      })
      .then((contextual) => {
        const log = createContextualShadowLog(
          request,
          requestedHeroId,
          baseline,
          contextual,
          Date.now() - startedAt,
        );
        if (
          log.changedTop1 ||
          log.changedTop3 ||
          log.situationalCandidateCount > 0
        ) {
          this.logger.log(JSON.stringify(log));
        }
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Contextual shadow evaluation failed: ${getErrorMessage(error)}`,
        );
      })
      .finally(() => {
        this.shadowInFlight -= 1;
      });
  }
}

function createCanonicalRequest(
  request: HeroBuildContextualRecommendationRequest,
): HeroBuildContextualRecommendationRequest {
  return {
    ...request,
    heroId: canonicalHeroId(request.heroId),
    itemIds: [...request.itemIds],
    enemyHeroIds: request.enemyHeroIds ? [...request.enemyHeroIds] : undefined,
  };
}

function createContextualShadowLog(
  request: HeroBuildContextualRecommendationRequest,
  requestedHeroId: number,
  baseline: HeroBuildRecommendationResponse,
  contextual: ContextualHeroBuildRecommendationResponse,
  elapsedMs: number,
): ContextualShadowLog {
  const baselineActionKeys = [
    baseline.action.actionKey,
    ...baseline.alternatives.map((action) => action.actionKey),
  ];
  const contextualActionKeys = [
    contextual.action.actionKey,
    ...contextual.alternatives.map((action) => action.actionKey),
  ];
  const baselineTop3ActionKeys = baselineActionKeys.slice(0, 3);
  const contextualTop3ActionKeys = contextualActionKeys.slice(0, 3);

  return {
    event: 'hero_build_contextual_shadow',
    heroId: requestedHeroId,
    canonicalHeroId: request.heroId,
    gameTimeS: request.gameTimeS,
    enemyHeroIds: [...(request.enemyHeroIds ?? [])],
    baselineMode: baseline.mode,
    contextualMode: contextual.mode,
    baselineTopActionKey: baseline.action.actionKey,
    contextualTopActionKey: contextual.action.actionKey,
    baselineTop3ActionKeys,
    contextualTop3ActionKeys,
    changedTop1: baseline.action.actionKey !== contextual.action.actionKey,
    changedTop3: !sameValues(baselineTop3ActionKeys, contextualTop3ActionKeys),
    baselineTopScore: baseline.action.score,
    contextualTopScore: contextual.action.contextualScore,
    situationalCandidateCount: contextual.situationalCandidateCount,
    promotedSituationalCandidateCount:
      contextual.promotedSituationalCandidateCount,
    insertedSituationalCandidateCount:
      contextual.insertedSituationalCandidateCount,
    elapsedMs,
  };
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function readBooleanEnvironmentValue(name: string, defaultValue: boolean): boolean {
  const rawValue = process.env[name]?.trim().toLowerCase();
  if (rawValue === undefined || rawValue.length === 0) {
    return defaultValue;
  }
  if (rawValue === 'true' || rawValue === '1' || rawValue === 'yes') {
    return true;
  }
  if (rawValue === 'false' || rawValue === '0' || rawValue === 'no') {
    return false;
  }
  return defaultValue;
}

function readBoundedNumberEnvironmentValue(
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    return defaultValue;
  }
  return parsed;
}

function readBoundedIntegerEnvironmentValue(
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(process.env[name]);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return defaultValue;
  }
  return parsed;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
