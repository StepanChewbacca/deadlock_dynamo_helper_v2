import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import type { MatchTimelinePlayerSnapshot } from '../src/deadlock-live/match-timeline-collector.service';
import {
  generateRecommendationHistoricalCandidatesFromPreparedPolicy,
  prepareRecommendationSerializedHeroBuildPolicy,
  RECOMMENDATION_HISTORICAL_OFFLINE_CANDIDATE_LIMIT,
  type RecommendationSerializedHeroBuildPolicy,
} from '../src/deadlock-live/recommendation-candidate-generator-snapshot';
import {
  createRecommendationHistoricalProReplayRow,
  type RecommendationFrozenCandidateGeneratorSnapshot,
  type RecommendationHistoricalCatalogItem,
} from '../src/deadlock-live/recommendation-historical-pro-replay';
import {
  buildRecommendationHistoricalShortHorizonOutcomes,
  selectRecommendationDecisionTimelineSnapshot,
} from '../src/deadlock-live/recommendation-historical-pro-replay-outcomes';
import { createRecommendationProDecisionDatasetV6Row } from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';

const sha = 'a'.repeat(64);

describe('Recommendation V8 audit-ready fallback', () => {
  it('uses the earliest future snapshot only when no fresh earlier snapshot exists', () => {
    const selected = selectRecommendationDecisionTimelineSnapshot({
      matchId: 100,
      heroId: 1,
      team: 0,
      gameTimeS: 65,
      snapshots: [snapshot(180), snapshot(360)],
      snapshotStalenessS: 300,
    });

    expect(selected?.gameTimeS).toBe(180);
  });

  it('does not reuse the future baseline as the horizon target', () => {
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision: decision(),
      snapshots: [snapshot(180), snapshot(360), snapshot(720)],
      objectives: [],
      snapshotStalenessS: 300,
    });

    expect(outcomes[0]).toMatchObject({
      complete: true,
      snapshotGameTimeS: 360,
      outcomeSource: 'TIMELINE_SNAPSHOT',
    });
  });

  it('expands the offline historical choice set beyond the serving limit', () => {
    const policy = prepareRecommendationSerializedHeroBuildPolicy(
      serializedPolicy(RECOMMENDATION_HISTORICAL_OFFLINE_CANDIDATE_LIMIT),
    );
    const candidates = generateRecommendationHistoricalCandidatesFromPreparedPolicy({
      decision: decision(),
      snapshot: generatorSnapshot(),
      generatorOptions: {
        minExactObservations: 3,
        maxBackoffDistance: 4,
        maxBackoffStates: 64,
        limit: 100,
      },
      catalog: { version: '6637', items: catalog(300) },
      policy,
    });

    expect(candidates).toHaveLength(
      RECOMMENDATION_HISTORICAL_OFFLINE_CANDIDATE_LIMIT,
    );
    expect(candidates.some((candidate) => candidate.actionKey === 'BUY:1150')).toBe(
      true,
    );
  });

  it('marks future snapshot usage and resolves compact catalog metadata', () => {
    const item = catalog(1)[0];
    const replay = createRecommendationHistoricalProReplayRow({
      decision: decision(),
      decisionTimelineJoined: true,
      candidateActions: [
        {
          actionKey: 'BUY:1001',
          actionType: 'BUY',
          itemId: 1001,
          rank: 1,
          score: 0.8,
          historicalCount: 10,
          historicalProbability: 0.5,
          confidence: 0.8,
          predictedStateKey: '1001x1',
        },
      ],
      catalogItemsById: new Map([[item.itemId, item]]),
      shortHorizonOutcomes: [
        {
          horizon: '3m',
          complete: true,
          utility: 0.25,
          outcomeSource: 'TIMELINE_SNAPSHOT',
          snapshotGameTimeS: 360,
        },
      ],
      generatorSnapshot: generatorSnapshot(),
    });
    expect(replay.candidates[0].catalog).toBeUndefined();

    const row = createRecommendationProDecisionDatasetV6Row({
      replayRow: replay,
      split: 'TRAIN',
      catalogItemsById: new Map([[item.itemId, item]]),
      decisionTimelineSnapshot: snapshot(180),
    });

    expect(row.state).toMatchObject({
      timelineJoined: true,
      timelineSnapshotGameTimeS: 180,
      timelineSnapshotLagS: -115,
      timelineSnapshotFutureFallback: true,
    });
    expect(row.candidates[0].catalogMetadataAvailable).toBe(true);
    expect(row.candidates[0].cost).toBe(item.cost);
  });
});

function decision(): HeroBuildDecisionDatasetV3Row {
  return {
    schemaVersion: 1,
    decisionId: 'decision-future',
    matchId: 100,
    matchStartTime: '2026-07-10T12:00:00.000Z',
    playerId: 200,
    heroId: 1,
    team: 0,
    gameTimeS: 65,
    phase: 'EARLY',
    inventoryBeforeStateKey: 'EMPTY',
    inventoryAfterStateKey: '1001x1',
    previousActionKeys: [],
    buildPrefixKey: 'EMPTY',
    alliedHeroIds: [1, 2, 3, 4, 5, 6],
    enemyHeroIds: [7, 8, 9, 10, 11, 12],
    actualActionType: 'BUY',
    actualItemId: 1001,
    actualActionKey: 'BUY:1001',
    outcomeLabel: { playerWon: true },
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
    kills: gameTimeS / 180,
    deaths: 0,
    assists: 1,
    netWorth: 5_000 + gameTimeS,
    heroDamage: 3_000 + gameTimeS,
    receivedAt: '2026-07-10T12:00:00.000Z',
  };
}

function serializedPolicy(actionCount: number): RecommendationSerializedHeroBuildPolicy {
  return {
    heroId: 1,
    playerCount: 10,
    stateCount: 1,
    transitionCount: actionCount,
    states: [
      {
        stateKey: 'EMPTY',
        observationCount: actionCount,
        nextActionCount: actionCount,
        nextActions: Array.from({ length: actionCount }, (_, index) => ({
          actionType: 'BUY' as const,
          itemId: 1001 + index,
          actionKey: `BUY:${1001 + index}`,
          count: actionCount - index,
          probability: (actionCount - index) / actionCount,
          averageGameTimeS: 65,
          afterStates: [
            {
              afterStateKey: `${1001 + index}x1`,
              count: 1,
              probability: 1,
            },
          ],
        })),
      },
    ],
  };
}

function generatorSnapshot(): RecommendationFrozenCandidateGeneratorSnapshot {
  return {
    snapshotId: 'snapshot-1',
    generatorVersion: 'generator-v3',
    policyVersion: 'policy-v3',
    policySha256: sha,
    catalogVersion: '6637',
    catalogSha256: sha,
    trainingWindowStart: '2026-07-01T00:00:00.000Z',
    trainingWindowEnd: '2026-07-05T00:00:00.000Z',
  };
}

function catalog(count: number): RecommendationHistoricalCatalogItem[] {
  return Array.from({ length: count }, (_, index) => ({
    itemId: 1001 + index,
    name: `Item ${index}`,
    cost: 500 + index,
    tier: 1,
    slotType: 'WEAPON',
    tags: ['weapon'],
    componentItemIds: [],
  }));
}
