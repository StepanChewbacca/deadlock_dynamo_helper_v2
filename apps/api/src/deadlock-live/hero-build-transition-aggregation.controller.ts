import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import {
  createInventoryStateKeyFromItemIds,
  HeroBuildTransitionAggregationService,
} from './hero-build-transition-aggregation.service';

export class GetHeroBuildNextActionsDto {
  heroId!: number;
  stateKey?: string;
  itemIds?: number[];
  limit?: number;
  minCount?: number;
}

@Controller('deadlock/analysis/build-policy')
export class HeroBuildTransitionAggregationController {
  constructor(
    private readonly heroBuildTransitionAggregationService: HeroBuildTransitionAggregationService,
  ) {}

  @Get('status')
  async getStatus() {
    await this.heroBuildTransitionAggregationService.ensureReady();
    return this.heroBuildTransitionAggregationService.getStatus();
  }

  @Post('next-actions')
  async getNextActions(@Body() dto: GetHeroBuildNextActionsDto) {
    const heroId = parsePositiveInteger(dto?.heroId, 'heroId');
    const stateKey = resolveStateKey(dto ?? {});
    const limit = parseBoundedPositiveInteger(dto?.limit, 'limit', 10, 100);
    const minCount = parseBoundedPositiveInteger(dto?.minCount, 'minCount', 1, 1_000_000);

    await this.heroBuildTransitionAggregationService.ensureReady();
    return this.heroBuildTransitionAggregationService.getNextActions(
      heroId,
      stateKey,
      limit,
      minCount,
    );
  }
}

function resolveStateKey(dto: GetHeroBuildNextActionsDto): string {
  const hasStateKey = typeof dto.stateKey === 'string' && dto.stateKey.trim().length > 0;
  const hasItemIds = Array.isArray(dto.itemIds);

  if (hasStateKey === hasItemIds) {
    throw new BadRequestException('Provide exactly one of stateKey or itemIds.');
  }

  if (hasStateKey) {
    return dto.stateKey!.trim();
  }

  const itemIds = dto.itemIds!;
  for (const itemId of itemIds) {
    if (!Number.isSafeInteger(itemId) || itemId <= 0) {
      throw new BadRequestException('Every itemIds value must be a positive safe integer.');
    }
  }
  return createInventoryStateKeyFromItemIds(itemIds);
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new BadRequestException(`${fieldName} must be a positive safe integer.`);
  }
  return Number(value);
}

function parseBoundedPositiveInteger(
  value: unknown,
  fieldName: string,
  defaultValue: number,
  maximum: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parsePositiveInteger(value, fieldName);
  if (parsed > maximum) {
    throw new BadRequestException(`${fieldName} must not exceed ${maximum}.`);
  }
  return parsed;
}
