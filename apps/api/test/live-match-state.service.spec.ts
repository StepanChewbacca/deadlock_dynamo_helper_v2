import { LiveMatchStateService } from '../src/deadlock-live/live-match-state.service';

describe('LiveMatchStateService', () => {
  it('extracts match id and match clock', () => {
    const service = new LiveMatchStateService();
    const state = service.applyBatch({
      clientId: 'test-client',
      events: [
        { receivedAt: 1, source: 'onInfoUpdates2', key: 'match_id', payload: '42' },
        { receivedAt: 2, source: 'onInfoUpdates2', key: 'match_clock', payload: '01:30' },
      ],
    });

    expect(state?.matchId).toBe('42');
    expect(state?.gameTimeSec).toBe(90);
  });

  it('merges roster updates by steam id', () => {
    const service = new LiveMatchStateService();
    service.applyBatch({
      clientId: 'test-client',
      events: [
        {
          receivedAt: 1,
          source: 'onInfoUpdates2',
          key: 'roster_0',
          payload: { steam_id: 's1', player_name: 'P1', hero_name: 'Warden', team: 1, souls: 500 },
        },
      ],
    });

    const state = service.applyBatch({
      clientId: 'test-client',
      events: [
        {
          receivedAt: 2,
          source: 'onInfoUpdates2',
          key: 'roster_0',
          payload: { steam_id: 's1', health: 900, kills: 2, deaths: 1, assists: 3 },
        },
      ],
    });

    expect(state?.playersBySteamId.s1.heroName).toBe('Warden');
    expect(state?.playersBySteamId.s1.teamId).toBe(1);
    expect(state?.playersBySteamId.s1.souls).toBe(500);
    expect(state?.playersBySteamId.s1.health).toBe(900);
    expect(state?.playersBySteamId.s1.kills).toBe(2);
  });

  it('replaces item lists for a player', () => {
    const service = new LiveMatchStateService();
    service.applyBatch({
      clientId: 'test-client',
      events: [
        { receivedAt: 1, source: 'onInfoUpdates2', key: 'match_id', payload: '42' },
        { receivedAt: 2, source: 'onInfoUpdates2', key: 'match_clock', payload: '02:00' },
        {
          receivedAt: 3,
          source: 'onInfoUpdates2',
          key: 'items_0',
          payload: { steam_id: 's1', items: [{ id: 1, name: 'Boots', class_name: 'boots', enhanced: false }] },
        },
      ],
    });

    const state = service.applyBatch({
      clientId: 'test-client',
      events: [
        {
          receivedAt: 4,
          source: 'onInfoUpdates2',
          key: 'items_0',
          payload: { steam_id: 's1', items: [{ id: 2, name: 'Gun', class_name: 'gun', enhanced: true }] },
        },
      ],
    });

    expect(state?.playersBySteamId.s1.items).toEqual([
      { id: 2, name: 'Gun', className: 'gun', enhanced: true, firstSeenAtSec: 120 },
    ]);
  });

  it('ignores malformed payloads without throwing', () => {
    const service = new LiveMatchStateService();

    expect(() =>
      service.applyBatch({
        clientId: 'test-client',
        events: [{ receivedAt: 1, source: 'onNewEvents', key: 'roster_0', payload: 'bad' }],
      }),
    ).not.toThrow();
  });
});
