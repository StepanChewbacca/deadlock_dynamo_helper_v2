import { LiveInventoryEventNormalizerService } from '../src/deadlock-live/live-inventory-event-normalizer.service';

describe('LiveInventoryEventNormalizerService', () => {
  it('keeps an item when a fast inventory update only contains its id', () => {
    const service = new LiveInventoryEventNormalizerService();

    service.normalizeBatch({
      clientId: 'client-1',
      events: [
        {
          receivedAt: 1,
          source: 'onInfoUpdates2',
          key: 'items_0',
          payload: {
            steam_id: 's1',
            items: [
              {
                id: 100,
                name: 'Extra Charge',
                class_name: 'extra_charge',
                enhanced: false,
              },
            ],
          },
        },
      ],
    });

    const normalized = service.normalizeBatch({
      clientId: 'client-1',
      events: [
        {
          receivedAt: 2,
          source: 'onInfoUpdates2',
          key: 'items_0',
          payload: {
            steam_id: 's1',
            items: [{ id: '100' }, { item_id: 200 }],
          },
        },
      ],
    });

    expect(normalized.events[0].payload).toEqual({
      steam_id: 's1',
      items: [
        {
          id: 100,
          name: 'Extra Charge',
          class_name: 'extra_charge',
          enhanced: false,
        },
        {
          item_id: 200,
          id: 200,
          name: 'Item 200',
          class_name: 'item_200',
          enhanced: false,
        },
      ],
    });
  });

  it('does not modify non-inventory events', () => {
    const service = new LiveInventoryEventNormalizerService();
    const event = {
      receivedAt: 1,
      source: 'onInfoUpdates2' as const,
      key: 'roster_0',
      payload: { steam_id: 's1' },
    };

    const normalized = service.normalizeBatch({
      clientId: 'client-1',
      events: [event],
    });

    expect(normalized.events[0]).toBe(event);
  });
});
