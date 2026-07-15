import { Injectable } from '@nestjs/common';
import {
  OverwolfLiveBatchDto,
  OverwolfLiveEventDto,
} from '@deadlock-live-probe/shared';

interface LiveItemMetadata {
  name: string;
  className: string;
}

@Injectable()
export class LiveInventoryEventNormalizerService {
  private readonly metadataByItemId = new Map<number, LiveItemMetadata>();

  normalizeBatch(batch: OverwolfLiveBatchDto): OverwolfLiveBatchDto {
    return {
      ...batch,
      events: batch.events.map((event) => this.normalizeEvent(event)),
    };
  }

  private normalizeEvent(event: OverwolfLiveEventDto): OverwolfLiveEventDto {
    if (
      !event.key?.startsWith('items') ||
      !isRecord(event.payload) ||
      !Array.isArray(event.payload.items)
    ) {
      return event;
    }

    const items = event.payload.items
      .map((item) => this.normalizeItem(item))
      .filter((item): item is Record<string, unknown> => item !== undefined);

    return {
      ...event,
      payload: {
        ...event.payload,
        items,
      },
    };
  }

  private normalizeItem(value: unknown): Record<string, unknown> | undefined {
    if (!isRecord(value)) {
      return undefined;
    }

    const id = readPositiveInteger(value.id ?? value.item_id ?? value.itemId);
    if (id === undefined) {
      return undefined;
    }

    const cached = this.metadataByItemId.get(id);
    const name = readString(value.name ?? value.item_name ?? value.itemName)
      ?? cached?.name
      ?? `Item ${id}`;
    const className = readString(value.class_name ?? value.className)
      ?? cached?.className
      ?? `item_${id}`;

    this.metadataByItemId.set(id, { name, className });

    return {
      ...value,
      id,
      name,
      class_name: className,
      enhanced: readBoolean(value.enhanced),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return value === 'true' || value === '1';
}
