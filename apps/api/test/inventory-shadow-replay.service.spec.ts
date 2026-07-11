import { Repository } from 'typeorm';
import { InventoryShadowReplayService } from '../src/deadlock-live/inventory-shadow-replay.service';
import { ItemComponent } from '../src/deadlock-live/entities/item-component.entity';

const items = {
  extraRegen: { id: 2829638276, class_name: 'upgrade_endurance', name: 'Extra Regen', enhanced: false },
  highVelocityRounds: {
    id: 3077079169,
    class_name: 'upgrade_high_velocity_mag',
    name: 'High-Velocity Rounds',
    enhanced: false,
  },
  openingRounds: {
    id: 2064029594,
    class_name: 'upgrade_pristine_emblem',
    name: 'Opening Rounds',
    enhanced: false,
  },
  kineticDash: {
    id: 3977876567,
    class_name: 'upgrade_kinetic_sash',
    name: 'Kinetic Dash',
    enhanced: false,
  },
};

describe('InventoryShadowReplayService', () => {
  it('replays the sanitized Overwolf timeline without changing the primary live state', async () => {
    const repository = {
      find: jest.fn().mockResolvedValue([
        {
          parentItemId: items.openingRounds.id,
          componentItemId: items.highVelocityRounds.id,
          componentOrder: 0,
        },
      ]),
    } as unknown as Repository<ItemComponent>;
    const service = new InventoryShadowReplayService(repository);
    await service.refreshRecipes();

    const snapshots = [
      { gameTime: '0:15', items: undefined },
      { gameTime: '2:48', items: [items.extraRegen] },
      { gameTime: '5:01', items: [items.extraRegen, items.highVelocityRounds] },
      { gameTime: '5:02', items: [items.extraRegen, items.openingRounds] },
      { gameTime: '5:50', items: [items.extraRegen, items.openingRounds, items.kineticDash] },
      { gameTime: '5:51', items: [items.extraRegen, items.openingRounds] },
      { gameTime: '6:26', items: [items.extraRegen, items.openingRounds, items.kineticDash] },
    ];

    snapshots.forEach((snapshot, index) => {
      service.applyBatch(
        {
          clientId: 'test-client',
          events: [
            ...(index === 0
              ? [{ receivedAt: 1, source: 'onInfoUpdates2' as const, key: 'match_id', payload: '93314383' }]
              : []),
            {
              receivedAt: index * 10 + 2,
              source: 'onInfoUpdates2',
              key: 'match_clock',
              payload: snapshot.gameTime,
            },
            {
              receivedAt: index * 10 + 3,
              source: 'onInfoUpdates2',
              key: 'items_12',
              payload: {
                steam_id: 'local-player',
                ...(snapshot.items ? { items: snapshot.items } : {}),
              },
            },
          ],
        },
        '93314383',
      );
    });

    const timeline = service.getPlayerTimeline('93314383', 'local-player');
    expect(timeline?.actions.map((action) => action.type)).toEqual([
      'RECONCILE',
      'BUY',
      'BUY',
      'UPGRADE',
      'BUY',
      'UNKNOWN_REMOVE',
      'REBUY',
    ]);
    expect(timeline?.diagnostics).toEqual([]);
    expect(timeline?.heldItems.map((item) => item.itemId)).toEqual(
      [items.openingRounds.id, items.extraRegen.id, items.kineticDash.id].sort((a, b) => a - b),
    );
    expect(timeline?.heldItems.find((item) => item.itemId === items.kineticDash.id)).toMatchObject({
      lifecycle: 2,
      acquiredBy: 'REBUY',
    });
  });
});
