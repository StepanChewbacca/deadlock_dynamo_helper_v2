import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import type { MatchTimelinePlayerSnapshot } from '../src/deadlock-live/match-timeline-collector.service';
import { buildRecommendationHistoricalShortHorizonOutcomes } from '../src/deadlock-live/recommendation-historical-pro-replay-outcomes';
import { createRecommendationHistoricalProReplayRow } from '../src/deadlock-live/recommendation-historical-pro-replay';

describe('Recommendation historical replay fractional timeline snapshots', () => {
  it('accepts finite non-negative fractional snapshot game times', () => {
    const decision: HeroBuildDecisionDatasetV3Row = {
      schemaVersion: 1,
      decisionId: '100:200:1',
      matchId: 100,
      matchStartTime: '2026-07-20T00:00:00.000Z',
      playerId: 200,
      heroId: 10,
      team: 0,
      gameTimeS: 600,
      phase: 'MID',
      inventoryBeforeStateKey: 'EMPTY',
      inventoryAfterStateKey: '1001x1',
      previousActionKeys: [],
      buildPrefixKey: 'EMPTY',
      alliedHeroIds: [11, 12, 13, 14, 15],
      enemyHeroIds: [21, 22, 23, 24, 25, 26],
      actualActionType: 'BUY',
      actualItemId: 1001,
      actualActionKey: 'BUY:1001',
      outcomeLabel: { playerWon: true },
    };
    const snapshots: MatchTimelinePlayerSnapshot[] = [
      snapshot(599.5, 10, 1_000, 100),
      snapshot(779.5, 11, 1_200, 150),
      snapshot(899.25, 12, 1_400, 220),
      snapshot(1199.75, 13, 1_900, 330),
    ];
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision,
      snapshots,
      objectives: [],
    });

    expect(outcomes.find((outcome) => outcome.horizon === '10m')).toMatchObject({
      complete: true,
      snapshotGameTimeS: 1199.75,
    });

    expect(() =>
      createRecommendationHistoricalProReplayRow({
        decision,
        candidateActions: [
          {
            actionKey: 'BUY:1001',
            actionType: 'BUY',
            itemId: 1001,
            rank: 1,
            score: 1,
            historicalCount: 10,
            historicalProbability: 1,
            confidence: 1,
            predictedStateKey: '1001x1',
          },
        ],
        catalogItemsById: new Map([
          [
            1001,
            {
              itemId: 1001,
              name: 'Test item',
              cost: 500,
              tier: 1,
              slotType: 'weapon',
              tags: [],
              componentItemIds: [],
            },
          ],
        ]),
        shortHorizonOutcomes: outcomes,
        generatorSnapshot: {
          snapshotId: 'test-snapshot',
          generatorVersion: 'test-generator',
          policyVersion: 'test-policy',
          policySha256: 'a'.repeat(64),
          catalogVersion: '6640',
          catalogSha256: 'b'.repeat(64),
          trainingWindowStart: '2026-07-18T00:00:00.000Z',
          trainingWindowEnd: '2026-07-19T00:00:00.000Z',
        },
      }),
    ).not.toThrow();
  });
});

function snapshot(
  gameTimeS: number,
  kills: number,
  netWorth: number,
  heroDamage: number,
): MatchTimelinePlayerSnapshot {
  return {
    schemaVersion: 1,
    timelineVersion: 'MATCH_TIMELINE_V1',
    snapshotId: `snapshot-${gameTimeS}`,
    sourceEventId: `event-${gameTimeS}`,
    matchId: 100,
    gameTimeS,
    tick: Math.round(gameTimeS * 60),
    steamId: '200',
    heroId: 10,
    teamId: 2,
    kills,
    deaths: 0,
    assists: 0,
    netWorth,
    heroDamage,
    receivedAt: '2026-07-20T00:00:00.000Z',
  };
}
