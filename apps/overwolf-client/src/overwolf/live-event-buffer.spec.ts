import { LiveEventBuffer } from './live-event-buffer';

describe('LiveEventBuffer', () => {
  it('flushes a batch to the api', async () => {
    const calls: unknown[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true } as Response;
    };

    const buffer = new LiveEventBuffer('client-1', 'http://localhost:3000', fetchImpl, 10);
    buffer.push({ receivedAt: 1, source: 'onInfoUpdates2', payload: { ok: true } });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(calls).toEqual([
      {
        clientId: 'client-1',
        events: [{ receivedAt: 1, source: 'onInfoUpdates2', payload: { ok: true } }],
      },
    ]);
  });

  it('flushes inventory events without waiting for the normal batch delay', async () => {
    const calls: any[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true } as Response;
    };

    const buffer = new LiveEventBuffer(
      'client-1',
      'http://localhost:3000',
      fetchImpl,
      1000,
      () => 'match-1',
    );
    buffer.push({
      receivedAt: 1,
      source: 'onInfoUpdates2',
      key: 'match_clock',
      payload: '01:00',
    });
    buffer.push({
      receivedAt: 2,
      source: 'onInfoUpdates2',
      key: 'items_12',
      payload: {
        steam_id: '76561198000000001',
        items: [{ id: 100, name: 'Extra Regen', class_name: 'extra_regen' }],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toHaveLength(1);
    expect(calls[0].events).toEqual([
      expect.objectContaining({ key: 'match_clock', matchId: 'match-1' }),
      expect.objectContaining({ key: 'items_12', matchId: 'match-1' }),
    ]);
  });

  it('flushes a full state recovery event immediately', async () => {
    const calls: any[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true } as Response;
    };

    const buffer = new LiveEventBuffer(
      'client-1',
      'http://localhost:3000',
      fetchImpl,
      1000,
      () => 'match-1',
    );
    buffer.push({
      receivedAt: 1,
      source: 'onInfoUpdates2',
      feature: 'state_safety_poll',
      category: 'roster',
      key: 'roster_12',
      payload: { steam_id: '76561198000000001', hero_id: 15, team_id: 2 },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toHaveLength(1);
    expect(calls[0].events[0]).toEqual(
      expect.objectContaining({
        feature: 'state_safety_poll',
        category: 'roster',
        key: 'roster_12',
        matchId: 'match-1',
      }),
    );
  });

  it('attaches the restored match id to events that do not contain one', async () => {
    const calls: any[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true } as Response;
    };

    const buffer = new LiveEventBuffer(
      'client-1',
      'http://localhost:3000',
      fetchImpl,
      10,
      () => '93405163',
    );
    buffer.push({ receivedAt: 1, source: 'onInfoUpdates2', payload: { ok: true } });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(calls[0].events[0]).toEqual({
      matchId: '93405163',
      receivedAt: 1,
      source: 'onInfoUpdates2',
      payload: { ok: true },
    });
  });

  it('preserves an explicit event match id', async () => {
    const calls: any[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return { ok: true } as Response;
    };

    const buffer = new LiveEventBuffer(
      'client-1',
      'http://localhost:3000',
      fetchImpl,
      10,
      () => 'restored-match',
    );
    buffer.push({
      matchId: 'explicit-match',
      receivedAt: 1,
      source: 'onInfoUpdates2',
      payload: { ok: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(calls[0].events[0].matchId).toBe('explicit-match');
  });
});
