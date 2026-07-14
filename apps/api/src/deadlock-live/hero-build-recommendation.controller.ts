import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
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
    private readonly heroBuildRecommendationService: HeroBuildRecommendationService,
    private readonly heroBuildRecommendationPresentationService:
      HeroBuildRecommendationPresentationService,
  ) {}

  @Post()
  async recommend(@Body() dto: RecommendHeroBuildDto) {
    const validated = validateRequest(dto);
    const response = await this.heroBuildRecommendationService.recommend({
      ...validated.recommendationRequest,
      limit: HERO_BUILD_MAX_RECOMMENDATION_LIMIT,
    });
    const filtered = filterHeroBuildRecommendationAlternatives(
      response,
      validated.alternativeFilter,
    );

    return this.heroBuildRecommendationPresentationService.present(filtered);
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

function validateEnemyHeroIds(value: number[] | undefined): number[] {
  if (value === undefined) {
    return [];
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
