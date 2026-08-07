import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import type { MatchTimelinePlayerSnapshot } from '../src/deadlock-live/match-timeline-collector.service';
import { buildRecommendationHistoricalShortHorizonOutcomes } from '../src/deadlock-live/recommendation-historical-pro-replay-outcomes';

describe('Recommendation historical terminal outcomes', () => {
  it.each([
    [true, 1],
    [false, -1],
  ])('uses final %s outcome when the match ends before every horizon', (playerWon, expectedUtility) => {
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision: decision(playerWon),
      snapshots: [snapshot(1_790), snapshot(1_920)],
      objectives: [],
      matchEndGameTimeS: 1_920,
      snapshotStalenessS: 300,
    });

    expect(outcomes).toEqual([
      terminal('3m', expectedUtility),
      terminal('5m', expectedUtility),
      terminal('10m', expectedUtility),
    ]);
  });

  it('keeps a missing horizon incomplete when match end is not confirmed', () => {
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision: decision(true),
      snapshots: [snapshot(1_790)],
      objectives: [],
      snapshotStalenessS: 30,
    });

    expect(outcomes.every((outcome) => !outcome.complete)).toBe(true);
  });
});

function terminal(horizon: '3m' | '5m' | '10m', utility: number) {
  return {
    horizon,
    complete: true,
    utility,
    outcomeSource: 'TERMINAL_FINAL_OUTCOME',
    terminalGameTimeS: 1_920,
  };
}

function decision(playerWon: boolean): HeroBuildDecisionDatasetV3Row {
  return {
    schemaVersion: 1,
    decisionId: 'decision-terminal',
    matchId: 100,
    matchStartTime: '2026-07-10T12:00:00.000Z',
    playerId: 200,
    heroId: 1,
    team: 0,
    gameTimeS: 1_800,
    phase: 'LATE',
    inventoryBeforeStateKey: '1001x1',
    inventoryAfterStateKey: '1001x1|1002x1',
    previousActionKeys: ['BUY:1001'],
    buildPrefixKey: 'BUY:1001',
    alliedHeroIds: [1, 2, 3, 4, 5, 6],
    enemyHeroIds: [7, 8, 9, 10, 11, 12],
    actualActionType: 'BUY',
    actualItemId: 1002,
    actualActionKey: 'BUY:1002',
    outcomeLabel: { playerWon },
  };
}

function snapshot(gameTimeS: number): MatchTimelinePlayerSnapshot {
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
  };
}
