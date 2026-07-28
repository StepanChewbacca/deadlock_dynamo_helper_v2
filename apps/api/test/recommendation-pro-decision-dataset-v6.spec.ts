import type { MatchTimelinePlayerSnapshot } from '../src/deadlock-live/match-timeline-collector.service';
import type {
  RecommendationHistoricalCatalogItem,
  RecommendationHistoricalProReplayRow,
} from '../src/deadlock-live/recommendation-historical-pro-replay';
import {
  buildRecommendationProDecisionDatasetV6Audit,
  createRecommendationProDecisionDatasetV6Row,
} from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';

describe('Recommendation pro decision dataset V6', () => {
  it('builds honest state and candidate-specific features from replay data', () => {
    const catalogItemsById = catalog();
    const replay = replayRow({
      decisionId: 'decision-1',
      matchId: '101',
      matchStartTime: '2026-07-01T00:00:00.000Z',
    });
    const row = createRecommendationProDecisionDatasetV6Row({
      replayRow: replay,
      split: 'TRAIN',
      catalogItemsById,
      decisionTimelineSnapshot: snapshot(101, 295),
    });

    expect(row).toMatchObject({
      decisionSource: 'HISTORICAL_REPLAY',
      observedActionKey: 'BUY:200',
      finalOutcome: 1,
      shortHorizonOutcomes: {
        threeMinutes: 0.1,
        fiveMinutes: 0.2,
      },
      state: {
        timelineJoined: true,
        timelineSnapshotLagS: 5,
        netWorth: 5_000,
        inventoryItemCounts: [
          { itemId: 100, count: 2 },
          { itemId: 150, count: 1 },
        ],
        inventoryTagCounts: {
          COMPONENT: 2,
          WEAPON: 1,
        },
      },
    });
    expect(row.candidates[0]).toMatchObject({
      actionKey: 'BUY:200',
      cost: 3_000,
      tier: 3,
      requiredComponentCount: 2,
      ownedComponentCount: 2,
      missingComponentCount: 0,
      hasAnyOwnedComponent: true,
      hasCompleteRecipeComponents: true,
      alreadyOwnedCount: 0,
      sameSlotOwnedItemCount: 3,
      inventoryTagOverlapCount: 1,
      previousActionCount: 1,
      currentNetWorth: 5_000,
      costToNetWorthRatio: 0.6,
    });
  });

  it('passes the Dataset V6 gates for complete non-overlapping rows', () => {
    const catalogItemsById = catalog();
    const rows = [
      createRecommendationProDecisionDatasetV6Row({
        replayRow: replayRow({
          decisionId: 'decision-1',
          matchId: '101',
          matchStartTime: '2026-07-01T00:00:00.000Z',
        }),
        split: 'TRAIN',
        catalogItemsById,
        decisionTimelineSnapshot: snapshot(101, 295),
      }),
      createRecommendationProDecisionDatasetV6Row({
        replayRow: replayRow({
          decisionId: 'decision-2',
          matchId: '102',
          matchStartTime: '2026-07-02T00:00:00.000Z',
        }),
        split: 'TUNING',
        catalogItemsById,
        decisionTimelineSnapshot: snapshot(102, 296),
      }),
    ];

    const audit = buildRecommendationProDecisionDatasetV6Audit(
      rows,
      undefined,
      '2026-07-03T00:00:00.000Z',
    );

    expect(audit).toMatchObject({
      passed: true,
      decisionCount: 2,
      matchCount: 2,
      candidateRowCount: 4,
      duplicateDecisionCount: 0,
      timelineJoinCoverage: 1,
      shortHorizonCoverage: 1,
      candidateMetadataCoverage: 1,
      observedActionInCandidateSetCoverage: 1,
      chronologicalSplitOverlapCount: 0,
      chronologicalSplitOrderViolationCount: 0,
      splitDistribution: {
        TRAIN: 1,
        TUNING: 1,
        FUTURE_TEST: 0,
      },
      decisionSourceDistribution: {
        HISTORICAL_REPLAY: 2,
        LIVE_LOG: 0,
      },
    });
  });

  it('fails when one match crosses split boundaries', () => {
    const catalogItemsById = catalog();
    const train = createRecommendationProDecisionDatasetV6Row({
      replayRow: replayRow({
        decisionId: 'decision-1',
        matchId: '101',
        matchStartTime: '2026-07-02T00:00:00.000Z',
      }),
      split: 'TRAIN',
      catalogItemsById,
      decisionTimelineSnapshot: snapshot(101, 295),
    });
    const tuning = createRecommendationProDecisionDatasetV6Row({
      replayRow: replayRow({
        decisionId: 'decision-2',
        matchId: '101',
        matchStartTime: '2026-07-01T00:00:00.000Z',
      }),
      split: 'TUNING',
      catalogItemsById,
      decisionTimelineSnapshot: snapshot(101, 295),
    });

    const audit = buildRecommendationProDecisionDatasetV6Audit([train, tuning]);

    expect(audit.passed).toBe(false);
    expect(audit.chronologicalSplitOverlapCount).toBe(1);
    expect(audit.chronologicalSplitOrderViolationCount).toBe(1);
    expect(audit.reasons).toEqual(
      expect.arrayContaining([
        'A match appears in more than one chronological split.',
        'Chronological split time ranges overlap or are out of order.',
      ]),
    );
  });
});

function replayRow(input: {
  decisionId: string;
  matchId: string;
  matchStartTime: string;
}): RecommendationHistoricalProReplayRow {
  return {
    schemaVersion: 1,
    replayVersion: 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_1',
    dataSource: 'PRO_HISTORICAL',
    decisionId: input.decisionId,
    matchId: input.matchId,
    matchStartTime: input.matchStartTime,
    playerId: '76561198000000000',
    heroId: 1,
    team: 0,
    decisionGameTimeS: 300,
    phase: 'EARLY',
    state: {
      inventoryBeforeStateKey: '100x2|150x1',
      previousActionKeys: ['BUY:100', 'BUY:200'],
      buildPrefixKey: 'BUY:100|BUY:200',
      alliedHeroIds: [1, 2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
    },
    observedAction: {
      actionType: 'BUY',
      itemId: 200,
      actionKey: 'BUY:200',
      inCandidateSet: true,
    },
    candidates: [
      {
        actionKey: 'BUY:200',
        actionType: 'BUY',
        itemId: 200,
        rank: 1,
        generatorScore: 0.8,
        historicalCount: 80,
        historicalProbability: 0.8,
        confidence: 0.9,
        predictedStateKey: '100x2|150x1|200x1',
        catalogMetadataAvailable: true,
        catalog: catalog().get(200),
      },
      {
        actionKey: 'BUY:300',
        actionType: 'BUY',
        itemId: 300,
        rank: 2,
        generatorScore: 0.2,
        historicalCount: 20,
        historicalProbability: 0.2,
        confidence: 0.7,
        predictedStateKey: '100x2|150x1|300x1',
        catalogMetadataAvailable: true,
        catalog: catalog().get(300),
      },
    ],
    shortHorizonOutcomes: [
      { horizon: '3m', complete: true, utility: 0.1, snapshotGameTimeS: 480 },
      { horizon: '5m', complete: true, utility: 0.2, snapshotGameTimeS: 600 },
      { horizon: '10m', complete: false },
    ],
    finalOutcomeAuxiliary: {
      playerWon: true,
    },
    generatorSnapshot: {
      snapshotId: 'snapshot-1',
      generatorVersion: 'HERO_BUILD_CANDIDATE_GENERATOR_V1',
      policyVersion: 'policy-1',
      policySha256: 'a'.repeat(64),
      catalogVersion: '999',
      catalogSha256: 'b'.repeat(64),
      trainingWindowStart: '2026-06-01T00:00:00.000Z',
      trainingWindowEnd: '2026-06-30T23:59:59.000Z',
    },
    eligibility: {
      stateModel: true,
      behavioralModel: true,
      actionModel: true,
      exclusionReasons: [],
    },
  };
}

function catalog(): ReadonlyMap<number, RecommendationHistoricalCatalogItem> {
  return new Map([
    [
      100,
      {
        itemId: 100,
        name: 'Component',
        cost: 500,
        tier: 1,
        slotType: 'WEAPON',
        itemType: 'UPGRADE',
        isActiveItem: false,
        tags: ['COMPONENT'],
        componentItemIds: [],
      },
    ],
    [
      150,
      {
        itemId: 150,
        name: 'Weapon item',
        cost: 1_250,
        tier: 2,
        slotType: 'WEAPON',
        itemType: 'UPGRADE',
        isActiveItem: false,
        tags: ['WEAPON'],
        componentItemIds: [],
      },
    ],
    [
      200,
      {
        itemId: 200,
        name: 'Candidate 200',
        cost: 3_000,
        tier: 3,
        slotType: 'WEAPON',
        itemType: 'UPGRADE',
        isActiveItem: false,
        tags: ['DAMAGE', 'WEAPON'],
        componentItemIds: [100, 100],
      },
    ],
    [
      300,
      {
        itemId: 300,
        name: 'Candidate 300',
        cost: 3_000,
        tier: 3,
        slotType: 'VITALITY',
        itemType: 'UPGRADE',
        isActiveItem: true,
        activationType: 'INSTANT',
        tags: ['VITALITY'],
        componentItemIds: [],
      },
    ],
  ]);
}

function snapshot(matchId: number, gameTimeS: number): MatchTimelinePlayerSnapshot {
  return {
    schemaVersion: 1,
    timelineVersion: 'MATCH_TIMELINE_V1',
    snapshotId: `snapshot-${matchId}`,
    sourceEventId: `event-${matchId}`,
    matchId,
    gameTimeS,
    tick: gameTimeS * 60,
    steamId: '76561198000000000',
    heroId: 1,
    teamId: 0,
    kills: 2,
    deaths: 1,
    assists: 4,
    netWorth: 5_000,
    heroDamage: 3_500,
    health: 900,
    maxHealth: 1_200,
    level: 8,
    receivedAt: '2026-07-01T00:05:00.000Z',
  };
}
