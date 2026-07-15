jest.mock('../diagnostics/diagnostic-capture', () => ({
  DiagnosticCapture: class {
    initialize(): void {}
    captureRaw(): void {}
  },
}));

import { listenOverwolfEvents } from './listen-overwolf-events';

describe('listenOverwolfEvents', () => {
  it('reconciles the current inventory through getInfo every fifteen seconds', () => {
    jest.useFakeTimers();
    const onEvent = jest.fn();
    const getInfo = jest.fn((callback: (result: unknown) => void) => {
      callback({
        success: true,
        res: {
          roster: {
            roster_12: JSON.stringify({
              steam_id: '76561198000000001',
              hero_id: 15,
            }),
          },
          items: {
            items_12: JSON.stringify({
              steam_id: '76561198000000001',
              items: [
                {
                  id: 100,
                  name: 'Extra Regen',
                  class_name: 'extra_regen',
                },
              ],
            }),
          },
        },
      });
    });

    (globalThis as any).overwolf = {
      games: {
        events: {
          onInfoUpdates2: { addListener: jest.fn() },
          onNewEvents: { addListener: jest.fn() },
          getInfo,
        },
      },
    };

    listenOverwolfEvents(onEvent);
    jest.advanceTimersByTime(15_000);

    expect(getInfo).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      receivedAt: expect.any(Number),
      source: 'onInfoUpdates2',
      feature: 'inventory_safety_poll',
      category: 'items',
      key: 'items_12',
      payload: {
        steam_id: '76561198000000001',
        items: [
          {
            id: 100,
            name: 'Extra Regen',
            class_name: 'extra_regen',
          },
        ],
      },
    });

    jest.useRealTimers();
    delete (globalThis as any).overwolf;
  });
});
