import { extractRecommendationHistoricalPostgresTimeline } from '../src/deadlock-live/recommendation-historical-postgres-timeline-cache.service';
import { buildRecommendationHistoricalShortHorizonOutcomes } from '../src/deadlock-live/recommendation-historical-pro-replay-outcomes';
import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';

 describe('Recommendation historical PostgreSQL timeline cache', () => {
  it('extracts player stats and objective events from raw match metadata', () => {
    const timeline = extractRecommendationHistoricalPostgresTimeline({
      matchId: 100,
      rawMetadataId: 42,
      fetchedAt: '2026-07-10T13:00:00.000Z',
      payload: {
        match_info: {
          players: [
            {
              account_id: 987654,
              player_slot: 3,
              team: 0,
              hero_id: 1,
              stats: [
                {
                  time_stamp_s: 295,
                  net_worth: 5_000,
                  kills: 1,
                  deaths: 0,
                  assists: 2,
                  player_damage: 3_000,
                },
                {
                  time_stamp_s: 470,
                  net_worth: 6_000,
                  kills: 2,
                  deaths: 0,
                  assists: 4,
                  player_damage: 5_500,
                },
                {
                  time_stamp_s: 590,
                  net_worth: 7_000,
                  kills: 2,
                  deaths: 0,
                  assists: 5,
                  player_damage: 7_000,
                },
                {
                  time_stamp_s: 890,
                  net_worth: 9_000,
                  kills: 3,
                  deaths: 1,
                  assists: 6,
                  player_damage: 10_000,
                },
              ],
            },
          ],
          objectives: [
            { legacy_objective_id: 17, destroyed_time_s: 400 },
            { legacy_objective_id: 2, destroyed_time_s: 550 },
          ],
        },
      },
    });

    expect(timeline.snapshots).toHaveLength(4);
    expect(timeline.snapshots[0]).toMatchObject({
      matchId: 100,
      gameTimeS: 295,
      steamId: '987654',
      heroId: 1,
      teamId: 2,
      kills: 1,
      deaths: 0,
      assists: 2,
      netWorth: 5_000,
      heroDamage: 3_000,
    });
    expect(timeline.objectives).toEqual([
      expect.objectContaining({
        gameTimeS: 400,
        entityIndex: 17,
        teamId: 3,
      }),
      expect.objectContaining({
        gameTimeS: 550,
        entityIndex: 2,
        teamId: 2,
      }),
    ]);
  });

  it('joins outcomes by hero and team instead of internal match player id', () => {
    const timeline = extractRecommendationHistoricalPostgresTimeline({
      matchId: 100,
      rawMetadataId: 42,
      fetchedAt: '2026-07-10T13:00:00.000Z',
      payload: {
        match_info: {
          players: [
            {
              account_id: 999999,
              team: 0,
              hero_id: 1,
              stats: [
                {
                  time_stamp_s: 295,
                  net_worth: 5_000,
                  kills: 1,
                  deaths: 0,
                  assists: 2,
                  player_damage: 3_000,
                },
                {
                  time_stamp_s: 470,
                  net_worth: 6_000,
                  kills: 2,
                  deaths: 0,
                  assists: 4,
                  player_damage: 5_500,
                },
                {
                  time_stamp_s: 590,
                  net_worth: 7_000,
                  kills: 2,
                  deaths: 0,
                  assists: 5,
                  player_damage: 7_000,
                },
                {
                  time_stamp_s: 890,
                  net_worth: 9_000,
                  kills: 3,
                  deaths: 1,
                  assists: 6,
                  player_damage: 10_000,
                },
              ],
            },
          ],
        },
      },
    });

    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision: decision(),
      snapshots: timeline.snapshots,
      objectives: timeline.objectives,
      snapshotStalenessS: 120,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({ horizon: '3m', complete: true }),
      expect.objectContaining({ horizon: '5m', complete: true }),
      expect.objectContaining({ horizon: '10m', complete: true }),
    ]);
  });

  it('fails closed when raw metadata contains no timeline stats', () => {
    const timeline = extractRecommendationHistoricalPostgresTimeline({
      matchId: 100,
      rawMetadataId: 42,
      fetchedAt: '2026-07-10T13:00:00.000Z',
      payload: {
        match_info: {
          players: [
            {
              account_id: 987654,
              team: 0,
              hero_id: 1,
              kills: 10,
              deaths: 1,
              assists: 20,
              net_worth: 50_000,
            },
          ],
        },
      },
    });

    expect(timeline.snapshots).toEqual([]);
  });
});

function decision(): HeroBuildDecisionDatasetV3Row {
  return {
    schemaVersion: 1,
    decisionId: 'decision-1',
    matchId: 100,
    matchStartTime: '2026-07-10T12:00:00.000Z',
    playerId: 200,
    heroId: 1,
    team: 0,
    gameTimeS: 300,
    phase: 'EARLY',
    inventoryBeforeStateKey: '1001x1',
    inventoryAfterStateKey: '1001x1|1002x1',
    previousActionKeys: ['BUY:1001'],
    buildPrefixKey: 'BUY:1001',
    alliedHeroIds: [1, 2, 3, 4, 5, 6],
    enemyHeroIds: [7, 8, 9, 10, 11, 12],
    actualActionType: 'BUY',
    actualItemId: 1002,
    actualActionKey: 'BUY:1002',
    outcomeLabel: { playerWon: true },
  };
}
