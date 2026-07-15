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

  it('keeps normal real-player steam ids unchanged with current roster fields', () => {
    const service = new LiveMatchStateService();
    const state = service.applyBatch({
      clientId: 'test-client',
      events: [
        {
          receivedAt: 1,
          source: 'onInfoUpdates2',
          key: 'roster_1',
          payload: {
            steam_id: '76561198000000001',
            player_name: 'Local',
            is_local: true,
            hero_id: 15,
            team_id: 2,
            assigned_lane: 6,
            assist: 2,
            hero_healing: 100,
          },
        },
        {
          receivedAt: 2,
          source: 'onInfoUpdates2',
          key: 'roster_7',
          payload: {
            steam_id: '76561198000000002',
            player_name: 'Enemy',
            hero_id: 35,
            team_id: 3,
          },
        },
      ],
    });

    expect(Object.keys(state?.playersBySteamId ?? {}).sort()).toEqual([
      '76561198000000001',
      '76561198000000002',
    ]);
    expect(state?.playersBySteamId['76561198000000001']).toMatchObject({
      steamId: '76561198000000001',
      teamId: 2,
      lane: 6,
      assists: 2,
      healing: 100,
      isLocal: true,
    });
    expect(state?.playersBySteamId['76561198000000002']).toMatchObject({
      steamId: '76561198000000002',
      teamId: 3,
      heroId: 35,
    });
  });

  it('keeps zero-steam-id players separate by roster slot', () => {
    const service = new LiveMatchStateService();
    service.applyBatch({
      clientId: 'test-client',
      events: [
        {
          receivedAt: 1,
          source: 'onInfoUpdates2',
          key: 'roster_6',
          payload: {
            steam_id: '0',
            player_name: 'Bot5',
            hero_id: 67,
            team_id: 3,
          },
        },
        {
          receivedAt: 2,
          source: 'onInfoUpdates2',
          key: 'roster_10',
          payload: {
            steam_id: '0',
            player_name: 'Bot9',
            hero_id: 35,
            team_id: 3,
          },
        },
      ],
    });

    const state = service.applyBatch({
      clientId: 'test-client',
      events: [
        {
          receivedAt: 3,
          source: 'onInfoUpdates2',
          key: 'roster_10',
          payload: {
            steam_id: '0',
            player_name: 'Bot9',
            hero_id: 35,
            team_id: 3,
            souls: 5700,
          },
        },
        {
          receivedAt: 4,
          source: 'onInfoUpdates2',
          key: 'items_10',
          payload: {
            steam_id: '0',
            items: [
              {
                id: 1,
                name: 'Boots',
                class_name: 'boots',
                enhanced: false,
              },
            ],
          },
        },
      ],
    });

    expect(Object.keys(state?.playersBySteamId ?? {}).sort()).toEqual([
      'bot:roster_10',
      'bot:roster_6',
    ]);
    expect(state?.playersBySteamId['bot:roster_6']).toMatchObject({
      steamId: 'bot:roster_6',
      heroId: 67,
      teamId: 3,
    });
    expect(state?.playersBySteamId['bot:roster_10']).toMatchObject({
      steamId: 'bot:roster_10',
      heroId: 35,
      teamId: 3,
      souls: 5700,
      items: [
        {
          id: 1,
          name: 'Boots',
          className: 'boots',
          enhanced: false,
        },
      ],
    });
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

  it('keeps later batches without match id on the last resolved match for a client', () => {
    const service = new LiveMatchStateService();
    service.applyBatch({
      clientId: 'test-client',
      events: [
        { receivedAt: 1, source: 'onInfoUpdates2', key: 'match_id', payload: '42' },
        {
          receivedAt: 2,
          source: 'onInfoUpdates2',
          key: 'roster_0',
          payload: { steam_id: 's1', player_name: 'P1', hero_name: 'Warden' },
        },
      ],
    });

    const state = service.applyBatch({
      clientId: 'test-client',
      events: [
        {
          receivedAt: 3,
          source: 'onInfoUpdates2',
          key: 'roster_0',
          payload: { steam_id: 's1', kills: 2 },
        },
      ],
    });

    expect(state?.matchId).toBe('42');
    expect(service.getState('42')?.playersBySteamId.s1.kills).toBe(2);
  });

  it('migrates pre-id client state from unknown once a real match id arrives', () => {
    const service = new LiveMatchStateService();
    service.applyBatch({
      clientId: 'test-client',
      events: [
        { receivedAt: 1, source: 'onInfoUpdates2', key: 'match_clock', payload: '00:45' },
        {
          receivedAt: 2,
          source: 'onInfoUpdates2',
          key: 'roster_0',
          payload: { steam_id: 's1', player_name: 'P1', hero_name: 'Warden', souls: 500 },
        },
      ],
    });

    const state = service.applyBatch({
      clientId: 'test-client',
      events: [{ receivedAt: 3, source: 'onInfoUpdates2', key: 'match_id', payload: '42' }],
    });

    expect(state).toMatchObject({
      matchId: '42',
      gameTimeSec: 45,
      playersBySteamId: {
        s1: {
          steamId: 's1',
          playerName: 'P1',
          heroName: 'Warden',
          souls: 500,
        },
      },
    });
    expect(service.getState('unknown')).toBeUndefined();
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

  it('captures rolling snapshots on interval and item changes', () => {
    const service = new LiveMatchStateService();

    service.applyBatch({
      clientId: 'test-client',
      events: [
        { receivedAt: 1, source: 'onInfoUpdates2', key: 'match_id', payload: '42' },
        { receivedAt: 2, source: 'onInfoUpdates2', key: 'match_clock', payload: '01:00' },
        {
          receivedAt: 3,
          source: 'onInfoUpdates2',
          key: 'roster_0',
          payload: { steam_id: 's1', hero_id: 13, team: 0, souls: 1000 },
        },
      ],
    });

    service.applyBatch({
      clientId: 'test-client',
      events: [
        { receivedAt: 4, source: 'onInfoUpdates2', key: 'match_clock', payload: '01:10' },
        {
          receivedAt: 5,
          source: 'onInfoUpdates2',
          key: 'items_0',
          payload: { steam_id: 's1', items: [{ id: 1, name: 'Boots', class_name: 'boots', enhanced: false }] },
        },
      ],
    });

    service.applyBatch({
      clientId: 'test-client',
      events: [{ receivedAt: 6, source: 'onInfoUpdates2', key: 'match_clock', payload: '01:40' }],
    });

    const snapshots = service.getSnapshots('42');
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    expect(snapshots[snapshots.length - 1]?.playersBySteamId.s1.itemIds).toEqual([1]);
  });
});
