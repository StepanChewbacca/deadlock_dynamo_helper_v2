import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import {
  HERO_BUILD_MAX_RECOMMENDATION_LIMIT,
  HeroBuildRecommendationRequest,
  HeroBuildRecommendationService,
} from './hero-build-recommendation.service';

export class RecommendHeroBuildDto {
  heroId!: number;
  itemIds!: number[];
  gameTimeS!: number;
  limit?: number;
}

@Controller('deadlock/analysis/build-recommendation')
export class HeroBuildRecommendationController {
  constructor(
    private readonly heroBuildRecommendationService: HeroBuildRecommendationService,
  ) {}

  @Post()
  async recommend(@Body() dto: RecommendHeroBuildDto) {
    const request = validateRequest(dto);
    return this.heroBuildRecommendationService.recommend(request);
  }
}

function validateRequest(dto: RecommendHeroBuildDto): HeroBuildRecommendationRequest {
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

  return {
    heroId: dto.heroId,
    itemIds: [...dto.itemIds],
    gameTimeS: dto.gameTimeS,
    limit: dto.limit,
  };
}
