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
