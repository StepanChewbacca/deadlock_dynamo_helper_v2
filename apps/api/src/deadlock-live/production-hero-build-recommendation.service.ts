import { Injectable, Logger } from '@nestjs/common';
import type { HeroBuildContextualRecommendationRequest } from './contextual-hero-build-recommendation.service';
import {
  ContextualV3LiveRecommendationResponse,
  ContextualV3LiveStatus,
  HeroBuildContextualV3LiveService,
} from './hero-build-contextual-v3-live.service';
import { canonicalHeroId } from './hero-id-aliases';
import {
  HeroBuildRecommendationResponse,
  HeroBuildRecommendationService,
} from './hero-build-recommendation.service';
import { HeroBuildTransitionAggregationService } from './hero-build-transition-aggregation.service';
import { RecipeAwareTimelineReconciliationService } from './recipe-aware-timeline-reconciliation.service';

const MODE_ENV = 'DEADLOCK_CONTEXTUAL_V3_LIVE_MODE';
const SHADOW_SAMPLE_RATE_ENV = 'DEADLOCK_CONTEXTUAL_V3_SHADOW_SAMPLE_RATE';
const SHADOW_MAX_IN_FLIGHT_ENV = 'DEADLOCK_CONTEXTUAL_V3_SHADOW_MAX_IN_FLIGHT';
const DEFAULT_SHADOW_SAMPLE_RATE = 1;
const DEFAULT_SHADOW_MAX_IN_FLIGHT = 2;

export type ContextualV3LiveMode = 'BASELINE' | 'SHADOW' | 'PRODUCTION';

export interface ContextualV3ProductionStatus {
  mode: ContextualV3LiveMode;
  model: ContextualV3LiveStatus;
  requestCount: number;
  contextualResponseCount: number;
  baselineResponseCount: number;
  fallbackCount: number;
  shadowScheduledCount: number;
  shadowCompletedCount: number;
  shadowInFlight: number;
  lastFallbackAt?: string;
  lastFallbackError?: string;
}

interface ContextualV3ShadowLog {
  event: 'hero_build_contextual_v3_shadow';
  heroId: number;
  canonicalHeroId: number;
  gameTimeS: number;
  alliedHeroIds: number[];
  enemyHeroIds: number[];
  previousActionCount: number;
  modelVersion: string;
  modelSha256: string;
  buildArchetypeId: string;
  baselineTopActionKey: string;
  contextualTopActionKey: string;
  baselineTop3ActionKeys: string[];
  contextualTop3ActionKeys: string[];
  changedTop1: boolean;
  changedTop3: boolean;
  elapsedMs: number;
}

@Injectable()
export class ProductionHeroBuildRecommendationService extends HeroBuildRecommendationService {
  private readonly logger = new Logger(
    ProductionHeroBuildRecommendationService.name,
  );
  private readonly mode = readMode();
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

  private requestCount = 0;
  private contextualResponseCount = 0;
  private baselineResponseCount = 0;
  private fallbackCount = 0;
  private shadowScheduledCount = 0;
  private shadowCompletedCount = 0;
  private shadowInFlight = 0;
  private lastFallbackAt?: string;
  private lastFallbackError?: string;

  constructor(
    heroBuildTransitionAggregationService: HeroBuildTransitionAggregationService,
    recipeAwareTimelineReconciliationService: RecipeAwareTimelineReconciliationService,
    private readonly contextualV3LiveService: HeroBuildContextualV3LiveService,
  ) {
    super(
      heroBuildTransitionAggregationService,
      recipeAwareTimelineReconciliationService,
    );
  }

  getStatus(): ContextualV3ProductionStatus {
    return {
      mode: this.mode,
      model: this.contextualV3LiveService.getStatus(),
      requestCount: this.requestCount,
      contextualResponseCount: this.contextualResponseCount,
      baselineResponseCount: this.baselineResponseCount,
      fallbackCount: this.fallbackCount,
      shadowScheduledCount: this.shadowScheduledCount,
      shadowCompletedCount: this.shadowCompletedCount,
      shadowInFlight: this.shadowInFlight,
      lastFallbackAt: this.lastFallbackAt,
      lastFallbackError: this.lastFallbackError,
    };
  }

  override async recommend(
    request: HeroBuildContextualRecommendationRequest,
  ): Promise<HeroBuildRecommendationResponse> {
    this.requestCount += 1;
    const requestedHeroId = request.heroId;
    const canonicalRequest = createCanonicalRequest(request);
    const canonicalBaseline = await super.recommend(canonicalRequest);
    const baseline: HeroBuildRecommendationResponse = {
      ...canonicalBaseline,
      heroId: requestedHeroId,
    };

    if (this.mode === 'BASELINE') {
      this.baselineResponseCount += 1;
      return baseline;
    }

    if (this.mode === 'SHADOW') {
      this.baselineResponseCount += 1;
      this.scheduleContextualShadow(
        canonicalRequest,
        requestedHeroId,
        baseline,
      );
      return baseline;
    }

    try {
      const contextual = this.contextualV3LiveService.recommend(
        canonicalRequest,
        baseline,
      );
      this.contextualResponseCount += 1;
      return {
        ...contextual,
        heroId: requestedHeroId,
      };
    } catch (error) {
      this.recordFallback(error);
      this.baselineResponseCount += 1;
      return baseline;
    }
  }

  private scheduleContextualShadow(
    request: HeroBuildContextualRecommendationRequest,
    requestedHeroId: number,
    baseline: HeroBuildRecommendationResponse,
  ): void {
    if (
      this.shadowSampleRate <= 0 ||
      this.shadowInFlight >= this.shadowMaxInFlight ||
      Math.random() >= this.shadowSampleRate
    ) {
      return;
    }

    this.shadowInFlight += 1;
    this.shadowScheduledCount += 1;
    const startedAt = Date.now();
    void Promise.resolve()
      .then(() => this.contextualV3LiveService.recommend(request, baseline))
      .then((contextual) => {
        this.shadowCompletedCount += 1;
        const log = createContextualV3ShadowLog(
          request,
          requestedHeroId,
          baseline,
          contextual,
          Date.now() - startedAt,
        );
        if (log.changedTop1 || log.changedTop3) {
          this.logger.log(JSON.stringify(log));
        }
      })
      .catch((error: unknown) => {
        this.recordFallback(error);
        this.logger.warn(
          `Contextual V3 shadow evaluation failed: ${getErrorMessage(error)}`,
        );
      })
      .finally(() => {
        this.shadowInFlight -= 1;
      });
  }

  private recordFallback(error: unknown): void {
    const message = getErrorMessage(error);
    this.fallbackCount += 1;
    this.lastFallbackAt = new Date().toISOString();
    this.lastFallbackError = message;
    this.logger.warn(`Contextual V3 fallback to baseline: ${message}`);
  }
}

function createCanonicalRequest(
  request: HeroBuildContextualRecommendationRequest,
): HeroBuildContextualRecommendationRequest {
  return {
    ...request,
    heroId: canonicalHeroId(request.heroId),
    itemIds: [...request.itemIds],
    enemyHeroIds: request.enemyHeroIds
      ? [...request.enemyHeroIds]
      : undefined,
    alliedHeroIds: request.alliedHeroIds
      ? [...request.alliedHeroIds]
      : undefined,
    previousActionKeys: request.previousActionKeys
      ? [...request.previousActionKeys]
      : undefined,
  };
}

function createContextualV3ShadowLog(
  request: HeroBuildContextualRecommendationRequest,
  requestedHeroId: number,
  baseline: HeroBuildRecommendationResponse,
  contextual: ContextualV3LiveRecommendationResponse,
  elapsedMs: number,
): ContextualV3ShadowLog {
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
    event: 'hero_build_contextual_v3_shadow',
    heroId: requestedHeroId,
    canonicalHeroId: request.heroId,
    gameTimeS: request.gameTimeS,
    alliedHeroIds: [...(request.alliedHeroIds ?? [])],
    enemyHeroIds: [...(request.enemyHeroIds ?? [])],
    previousActionCount: request.previousActionKeys?.length ?? 0,
    modelVersion: contextual.modelVersion,
    modelSha256: contextual.modelSha256,
    buildArchetypeId: contextual.buildArchetypeId,
    baselineTopActionKey: baseline.action.actionKey,
    contextualTopActionKey: contextual.action.actionKey,
    baselineTop3ActionKeys,
    contextualTop3ActionKeys,
    changedTop1: baseline.action.actionKey !== contextual.action.actionKey,
    changedTop3: !sameValues(baselineTop3ActionKeys, contextualTop3ActionKeys),
    elapsedMs,
  };
}

function readMode(): ContextualV3LiveMode {
  const value = process.env[MODE_ENV]?.trim().toUpperCase();
  if (value === 'BASELINE' || value === 'SHADOW' || value === 'PRODUCTION') {
    return value;
  }
  return 'BASELINE';
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
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
