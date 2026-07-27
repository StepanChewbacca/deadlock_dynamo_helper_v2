import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import type {
  MatchTimelineObjectiveEvent,
  MatchTimelinePlayerSnapshot,
} from '../src/deadlock-live/match-timeline-collector.service';
import {
  buildRecommendationHistoricalShortHorizonOutcomes,
  recommendationShortHorizonUtility,
} from '../src/deadlock-live/recommendation-historical-pro-replay-outcomes';

function decision(
  overrides: Partial<HeroBuildDecisionDatasetV3Row> = {},
): HeroBuildDecisionDatasetV3Row {
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
    inventoryBeforeStateKey: '1001:1',
    inventoryAfterStateKey: '1001:1|1002:1',
    previousActionKeys: ['BUY:1001'],
    buildPrefixKey: 'BUY:1001',
    alliedHeroIds: [1, 2, 3, 4, 5, 6],
    enemyHeroIds: [7, 8, 9, 10, 11, 12],
    actualActionType: 'BUY',
    actualItemId: 1002,
    actualActionKey: 'BUY:1002',
    outcomeLabel: { playerWon: true },
    ...overrides,
  };
}

function snapshot(
  gameTimeS: number,
  overrides: Partial<MatchTimelinePlayerSnapshot> = {},
): MatchTimelinePlayerSnapshot {
  return {
    schemaVersion: 1,
    timelineVersion: 'MATCH_TIMELINE_V1',
    snapshotId: `snapshot-${gameTimeS}`,
    sourceEventId: `event-${gameTimeS}`,
    matchId: 100,
    gameTimeS,
    tick: gameTimeS * 60,
    steamId: '200',
    heroId: 1,
    teamId: 2,
    kills: 1,
    deaths: 0,
    assists: 2,
    netWorth: 5_000,
    heroDamage: 3_000,
    receivedAt: '2026-07-10T12:00:00.000Z',
    ...overrides,
  };
}

function objective(
  gameTimeS: number,
  teamId: number,
): MatchTimelineObjectiveEvent {
  return {
    schemaVersion: 1,
    timelineVersion: 'MATCH_TIMELINE_V1',
    objectiveEventId: `objective-${gameTimeS}-${teamId}`,
    sourceEventId: `event-${gameTimeS}-${teamId}`,
    matchId: 100,
    gameTimeS,
    tick: gameTimeS * 60,
    eventName: 'entity_removed',
    objectiveType: 'destroyable_building',
    entityIndex: gameTimeS,
    teamId,
    receivedAt: '2026-07-10T12:00:00.000Z',
  };
}

describe('Recommendation historical short-horizon outcomes', () => {
  it('uses the same bounded utility components as Value V6', () => {
    expect(
      recommendationShortHorizonUtility({
        killsDelta: 1,
        deathsDelta: 0,
        assistsDelta: 2,
        netWorthDelta: 1_000,
        heroDamageDelta: 2_500,
        enemyObjectiveLossCount: 1,
        ownObjectiveLossCount: 0,
        survived: true,
      }),
    ).toBeCloseTo(0.71, 10);
  });

  it('builds complete 3m, 5m and 10m outcomes from fresh timeline snapshots', () => {
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision: decision(),
      snapshots: [
        snapshot(295),
        snapshot(470, {
          kills: 2,
          assists: 4,
          netWorth: 6_000,
          heroDamage: 5_500,
        }),
        snapshot(590, {
          kills: 2,
          assists: 5,
          netWorth: 7_000,
          heroDamage: 7_000,
        }),
        snapshot(890, {
          kills: 3,
          deaths: 1,
          assists: 6,
          netWorth: 9_000,
          heroDamage: 10_000,
        }),
      ],
      objectives: [objective(400, 3), objective(550, 2)],
      snapshotStalenessS: 120,
    });

    expect(outcomes.map((outcome) => outcome.complete)).toEqual([
      true,
      true,
      true,
    ]);
    expect(outcomes[0]).toMatchObject({
      horizon: '3m',
      snapshotGameTimeS: 470,
    });
    expect(outcomes[0].utility).toBeGreaterThan(0);
  });

  it('marks an outcome incomplete when the target snapshot is stale', () => {
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision: decision(),
      snapshots: [snapshot(295), snapshot(350)],
      objectives: [],
      snapshotStalenessS: 30,
    });

    expect(outcomes).toEqual([
      { horizon: '3m', complete: false, snapshotGameTimeS: 350 },
      { horizon: '5m', complete: false, snapshotGameTimeS: 350 },
      { horizon: '10m', complete: false, snapshotGameTimeS: 350 },
    ]);
  });

  it('falls back to hero and team identity when Steam ID is unavailable', () => {
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision: decision({ playerId: 999 }),
      snapshots: [
        snapshot(295, { steamId: 'different' }),
        snapshot(470, {
          steamId: 'different',
          kills: 2,
          netWorth: 6_000,
          heroDamage: 4_000,
        }),
      ],
      objectives: [],
    });

    expect(outcomes[0].complete).toBe(true);
  });
});
