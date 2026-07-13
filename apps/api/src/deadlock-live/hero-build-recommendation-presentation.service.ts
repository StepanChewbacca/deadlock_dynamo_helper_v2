import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Item } from './entities/item.entity';
import {
  HeroBuildRecommendationAction,
  HeroBuildRecommendationResponse,
} from './hero-build-recommendation.service';

export type HeroBuildPresentationEvidenceLevel = 'OBSERVED' | 'INFERRED';
export type HeroBuildPresentationExplanationCode =
  | 'EXACT_STATE_EVIDENCE'
  | 'SUBSET_STATE_EVIDENCE'
  | 'DIRECTIONAL_STATE_INFERENCE'
  | 'NO_HERO_POLICY'
  | 'NO_NEARBY_STATE'
  | 'NO_LEGAL_ACTION';

export interface HeroBuildPresentedItem {
  itemId: number;
  name: string;
  className: string;
  slotType: string;
  cost: number;
  tier: number;
}

export interface HeroBuildPresentationExplanation {
  code: HeroBuildPresentationExplanationCode;
  evidenceLevel: HeroBuildPresentationEvidenceLevel;
  text: string;
}

export type HeroBuildPresentedAction = HeroBuildRecommendationAction & {
  label: string;
  confidencePercent: number;
  historicalProbabilityPercent: number;
  typicalGameTimeLabel: string;
  item?: HeroBuildPresentedItem;
  explanation: HeroBuildPresentationExplanation;
};

export interface HeroBuildItemMetadataSummary {
  requestedCount: number;
  resolvedCount: number;
  missingItemIds: number[];
}

export type HeroBuildPresentedRecommendation<
  T extends HeroBuildRecommendationResponse = HeroBuildRecommendationResponse,
> = Omit<T, 'action' | 'alternatives'> & {
  action: HeroBuildPresentedAction;
  alternatives: HeroBuildPresentedAction[];
  itemMetadata: HeroBuildItemMetadataSummary;
};

export interface HeroBuildPresentationItemSource {
  itemId: number;
  name: string;
  className: string;
  itemSlotType: string;
  cost: number;
  itemTier: number;
}

@Injectable()
export class HeroBuildRecommendationPresentationService {
  constructor(
    @InjectRepository(Item)
    private readonly itemRepository: Repository<Item>,
  ) {}

  async present<T extends HeroBuildRecommendationResponse>(
    response: T,
  ): Promise<HeroBuildPresentedRecommendation<T>> {
    const itemIds = collectRecommendationItemIds(response);
    const items = itemIds.length > 0
      ? await this.itemRepository.find({ where: { itemId: In(itemIds) } })
      : [];

    return presentHeroBuildRecommendation(response, items);
  }
}

export function presentHeroBuildRecommendation<T extends HeroBuildRecommendationResponse>(
  response: T,
  items: readonly HeroBuildPresentationItemSource[],
): HeroBuildPresentedRecommendation<T> {
  const itemById = new Map<number, HeroBuildPresentedItem>();
  for (const item of items) {
    const itemId = Number(item.itemId);
    if (!Number.isSafeInteger(itemId) || itemId <= 0) {
      continue;
    }
    itemById.set(itemId, {
      itemId,
      name: item.name,
      className: item.className,
      slotType: item.itemSlotType,
      cost: item.cost,
      tier: item.itemTier,
    });
  }

  const itemIds = collectRecommendationItemIds(response);
  const missingItemIds = itemIds.filter((itemId) => !itemById.has(itemId));

  return {
    ...response,
    action: presentAction(response.action, response, itemById),
    alternatives: response.alternatives.map((action) =>
      presentAction(action, response, itemById),
    ),
    itemMetadata: {
      requestedCount: itemIds.length,
      resolvedCount: itemIds.length - missingItemIds.length,
      missingItemIds,
    },
  };
}

function presentAction(
  action: HeroBuildRecommendationAction,
  response: HeroBuildRecommendationResponse,
  itemById: ReadonlyMap<number, HeroBuildPresentedItem>,
): HeroBuildPresentedAction {
  const item = action.itemId ? itemById.get(action.itemId) : undefined;
  return {
    ...action,
    label: createActionLabel(action, item),
    confidencePercent: toPercent(action.confidence),
    historicalProbabilityPercent: toPercent(action.historicalProbability),
    typicalGameTimeLabel: formatGameTime(action.averageGameTimeS),
    item,
    explanation: createExplanation(action, response),
  };
}

function createActionLabel(
  action: HeroBuildRecommendationAction,
  item: HeroBuildPresentedItem | undefined,
): string {
  if (action.type === 'HOLD') {
    return 'Hold current build';
  }

  const itemLabel = item?.name ?? `Item ${action.itemId}`;
  const verb = action.type === 'BUY'
    ? 'Buy'
    : action.type === 'UPGRADE'
      ? 'Upgrade to'
      : 'Sell';
  return `${verb} ${itemLabel}`;
}

function createExplanation(
  action: HeroBuildRecommendationAction,
  response: HeroBuildRecommendationResponse,
): HeroBuildPresentationExplanation {
  if (action.type === 'HOLD') {
    if (response.noMatchReason === 'HERO_POLICY_NOT_FOUND') {
      return {
        code: 'NO_HERO_POLICY',
        evidenceLevel: 'INFERRED',
        text: 'No build policy data is available for this hero.',
      };
    }
    if (response.noMatchReason === 'NO_NEARBY_STATE') {
      return {
        code: 'NO_NEARBY_STATE',
        evidenceLevel: 'INFERRED',
        text: 'No sufficiently nearby historical inventory state was found.',
      };
    }
    return {
      code: 'NO_LEGAL_ACTION',
      evidenceLevel: 'INFERRED',
      text: 'Historical candidates exist, but none produce a legal action for the current inventory.',
    };
  }

  const probability = toPercent(action.historicalProbability);
  const typicalTime = formatGameTime(action.averageGameTimeS);

  if (response.mode === 'EXACT') {
    return {
      code: 'EXACT_STATE_EVIDENCE',
      evidenceLevel: 'OBSERVED',
      text: `Observed ${action.historicalCount} times from this exact inventory state (${probability}% of transitions), usually around ${typicalTime}.`,
    };
  }

  if (action.matchedBySubset) {
    return {
      code: 'SUBSET_STATE_EVIDENCE',
      evidenceLevel: 'INFERRED',
      text: `Observed ${action.historicalCount} times from a subset inventory state with ${action.extraItemCount} extra current item(s) (${probability}% of transitions), usually around ${typicalTime}.`,
    };
  }

  return {
    code: 'DIRECTIONAL_STATE_INFERENCE',
    evidenceLevel: 'INFERRED',
    text: `Inferred from a nearby inventory state missing ${action.missingItemCount} item(s); observed ${action.historicalCount} times (${probability}% of transitions), usually around ${typicalTime}.`,
  };
}

function collectRecommendationItemIds(
  response: HeroBuildRecommendationResponse,
): number[] {
  const itemIds = [response.action, ...response.alternatives]
    .map((action) => action.itemId)
    .filter((itemId): itemId is number =>
      Number.isSafeInteger(itemId) && Number(itemId) > 0,
    );
  return [...new Set(itemIds)].sort((left, right) => left - right);
}

function toPercent(value: number): number {
  return Math.round(value * 10_000) / 100;
}

function formatGameTime(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
