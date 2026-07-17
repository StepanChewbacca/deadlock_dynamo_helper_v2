import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Post,
} from '@nestjs/common';
import { canonicalHeroId } from './hero-id-aliases';
import type { HeroBuildContextualRecommendationRequest } from './contextual-hero-build-recommendation.service';
import {
  filterHeroBuildRecommendationAlternatives,
  HERO_BUILD_DEFAULT_MIN_ALTERNATIVE_CONFIDENCE,
  HERO_BUILD_DEFAULT_MIN_ALTERNATIVE_HISTORICAL_COUNT,
  HERO_BUILD_MAX_MIN_ALTERNATIVE_HISTORICAL_COUNT,
  HeroBuildAlternativeFilterOptions,
} from './hero-build-recommendation-alternative-filter';
import { HeroBuildRecommendationPresentationService } from './hero-build-recommendation-presentation.service';
import {
  HERO_BUILD_DEFAULT_RECOMMENDATION_LIMIT,
  HERO_BUILD_MAX_RECOMMENDATION_LIMIT,
  HeroBuildRecommendationService,
} from './hero-build-recommendation.service';
import { preferUpgradeOverComponentSell } from './hero-build-upgrade-preference';
import { LiveMatchStateService } from './live-match-state.service';
import { ProductionHeroBuildRecommendationService } from './production-hero-build-recommendation.service';

export class RecommendHeroBuildDto {
  heroId!: number;
  itemIds!: number[];
  gameTimeS!: number;
  enemyHeroIds?: number[];
  limit?: number;
  minAlternativeHistoricalCount?: number;
  minAlternativeConfidence?: number;
}

interface ValidatedRecommendHeroBuildRequest {
  recommendationRequest: HeroBuildContextualRecommendationRequest;
  alternativeFilter: HeroBuildAlternativeFilterOptions;
}

@Controller('deadlock/analysis/build-recommendation')
export class HeroBuildRecommendationController {
  constructor(
    @Inject(ProductionHeroBuildRecommendationService)
    private readonly heroBuildRecommendationService: HeroBuildRecommendationService,
    private readonly heroBuildRecommendationPresentationService:
      HeroBuildRecommendationPresentationService,
    private readonly liveMatchStateService: LiveMatchStateService,
  ) {}

  @Post()
  async recommend(@Body() dto: RecommendHeroBuildDto) {
    const validated = validateRequest(dto);
    const enemyHeroIds =
      validated.recommendationRequest.enemyHeroIds ??
      this.resolveLiveEnemyHeroIds(validated.recommendationRequest.heroId);
    const contextualRequest: HeroBuildContextualRecommendationRequest = {
      ...validated.recommendationRequest,
      enemyHeroIds,
      limit: HERO_BUILD_MAX_RECOMMENDATION_LIMIT,
    };
    const response = await this.heroBuildRecommendationService.recommend(
      contextualRequest,
    );
    const filtered = filterHeroBuildRecommendationAlternatives(
      response,
      validated.alternativeFilter,
    );
    const preferred = preferUpgradeOverComponentSell(
      filtered,
      contextualRequest.itemIds,
    );

    return this.heroBuildRecommendationPresentationService.present(preferred);
  }

  private resolveLiveEnemyHeroIds(heroId: number): number[] {
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
}

function validateRequest(dto: RecommendHeroBuildDto): ValidatedRecommendHeroBuildRequest {
  if (!Number.isSafeInteger(dto?.heroId) || dto.heroId <= 0) {
    throw new BadRequestException('heroId must be a positive safe integer.');
  }
  if (!Array.isArray(dto.itemIds)) {
    throw new BadRequestException('itemIds must be an array.');
  }
  for (const itemId of dto.itemIds) {
    if (!Number.isSafeInteger(itemId) || itemId <= 0) {
      throw new BadRequestException('Every itemIds value must be a positive safe integer.');
    }
  }
  if (!Number.isSafeInteger(dto.gameTimeS) || dto.gameTimeS < 0) {
    throw new BadRequestException('gameTimeS must be a non-negative safe integer.');
  }
  if (
    dto.limit !== undefined &&
    (!Number.isSafeInteger(dto.limit) ||
      dto.limit <= 0 ||
      dto.limit > HERO_BUILD_MAX_RECOMMENDATION_LIMIT)
  ) {
    throw new BadRequestException(
      `limit must be a positive safe integer not exceeding ${HERO_BUILD_MAX_RECOMMENDATION_LIMIT}.`,
    );
  }
  if (
    dto.minAlternativeHistoricalCount !== undefined &&
    (!Number.isSafeInteger(dto.minAlternativeHistoricalCount) ||
      dto.minAlternativeHistoricalCount < 0 ||
      dto.minAlternativeHistoricalCount >
        HERO_BUILD_MAX_MIN_ALTERNATIVE_HISTORICAL_COUNT)
  ) {
    throw new BadRequestException(
      `minAlternativeHistoricalCount must be a non-negative safe integer not exceeding ${HERO_BUILD_MAX_MIN_ALTERNATIVE_HISTORICAL_COUNT}.`,
    );
  }
  if (
    dto.minAlternativeConfidence !== undefined &&
    (!Number.isFinite(dto.minAlternativeConfidence) ||
      dto.minAlternativeConfidence < 0 ||
      dto.minAlternativeConfidence > 1)
  ) {
    throw new BadRequestException(
      'minAlternativeConfidence must be a finite number between 0 and 1.',
    );
  }

  const enemyHeroIds = validateEnemyHeroIds(dto.enemyHeroIds);

  return {
    recommendationRequest: {
      heroId: dto.heroId,
      itemIds: [...dto.itemIds],
      gameTimeS: dto.gameTimeS,
      enemyHeroIds,
    },
    alternativeFilter: {
      limit: dto.limit ?? HERO_BUILD_DEFAULT_RECOMMENDATION_LIMIT,
      minHistoricalCount:
        dto.minAlternativeHistoricalCount ??
        HERO_BUILD_DEFAULT_MIN_ALTERNATIVE_HISTORICAL_COUNT,
      minConfidence:
        dto.minAlternativeConfidence ??
        HERO_BUILD_DEFAULT_MIN_ALTERNATIVE_CONFIDENCE,
    },
  };
}

function validateEnemyHeroIds(value: number[] | undefined): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new BadRequestException('enemyHeroIds must be an array.');
  }

  for (const heroId of value) {
    if (!Number.isSafeInteger(heroId) || heroId <= 0) {
      throw new BadRequestException(
        'Every enemyHeroIds value must be a positive safe integer.',
      );
    }
  }

  return [...new Set(value)].sort((left, right) => left - right);
}
