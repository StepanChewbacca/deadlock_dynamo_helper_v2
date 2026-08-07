import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import type { MatchTimelinePlayerSnapshot } from '../src/deadlock-live/match-timeline-collector.service';
import {
  createRecommendationCandidateGeneratorSnapshotArtifact,
  generateRecommendationHistoricalCandidatesFromSnapshot,
} from '../src/deadlock-live/recommendation-candidate-generator-snapshot';
import {
  buildRecommendationHistoricalShortHorizonOutcomes,
  hasFreshRecommendationDecisionTimelineSnapshot,
} from '../src/deadlock-live/recommendation-historical-pro-replay-outcomes';
import {
  buildRecommendationHistoricalProReplayAudit,
  createRecommendationHistoricalProReplayRow,
} from '../src/deadlock-live/recommendation-historical-pro-replay';

describe('Recommendation historical replay audit recovery v2', () => {
  it('preserves REBUY action identity and adds hero-level support candidates', () => {
    const decision = sourceDecision();
    const artifact = createRecommendationCandidateGeneratorSnapshotArtifact({
      snapshot: {
        snapshotId: 'support-v2',
        generatorVersion: 'RECOMMENDATION_CANDIDATE_GENERATOR_V6_2_SUPPORT_UNION',
        policyVersion: 'RECOMMENDATION_CANDIDATE_POLICY_V6_2_SUPPORT_UNION',
        catalogVersion: 'test-catalog',
        trainingWindowStart: '2026-06-01T00:00:00.000Z',
        trainingWindowEnd: '2026-07-01T00:00:00.000Z',
      },
      generatorOptions: {
        minExactObservations: 3,
        maxBackoffDistance: 4,
        maxBackoffStates: 64,
        limit: 100,
      },
      policies: [
        {
          heroId: 1,
          playerCount: 10,
          stateCount: 2,
          transitionCount: 20,
          states: [
            {
              stateKey: '1001x1',
              observationCount: 10,
              nextActionCount: 1,
              nextActions: [
                {
                  actionType: 'BUY',
                  itemId: 1003,
                  actionKey: 'BUY:1003',
                  count: 10,
                  probability: 1,
                  averageGameTimeS: 300,
                  afterStates: [
                    {
                      afterStateKey: '1001x1|1003x1',
                      count: 10,
                      probability: 1,
                    },
                  ],
                },
              ],
            },
            {
              stateKey: 'EMPTY',
              observationCount: 10,
              nextActionCount: 1,
              nextActions: [
                {
                  actionType: 'REBUY',
                  itemId: 1002,
                  actionKey: 'REBUY:1002',
                  count: 10,
                  probability: 1,
                  averageGameTimeS: 600,
                  afterStates: [
                    {
                      afterStateKey: '1002x1',
                      count: 10,
                      probability: 1,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      catalog: {
        version: 'test-catalog',
        items: [catalogItem(1001), catalogItem(1002), catalogItem(1003)],
      },
    });

    const candidates = generateRecommendationHistoricalCandidatesFromSnapshot({
      decision,
      artifact,
    });

    expect(candidates.map((candidate) => candidate.actionKey)).toContain(
      'REBUY:1002',
    );
    expect(candidates.map((candidate) => candidate.actionKey)).toContain(
      'BUY:1003',
    );
  });

  it('separates decision timeline join from short-horizon completeness', () => {
    const decision = sourceDecision();
    const snapshots = [
      timelineSnapshot(299),
      timelineSnapshot(850),
    ];
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision,
      snapshots,
      objectives: [],
      snapshotStalenessS: 300,
    });
    expect(
      hasFreshRecommendationDecisionTimelineSnapshot({
        decision,
        snapshots,
        snapshotStalenessS: 300,
      }),
    ).toBe(true);

    const row = createRecommendationHistoricalProReplayRow({
      decision,
      decisionTimelineJoined: true,
      candidateActions: [
        {
          actionKey: 'REBUY:1002',
          actionType: 'REBUY',
          itemId: 1002,
          rank: 1,
          score: 1,
          historicalCount: 10,
          historicalProbability: 1,
          confidence: 1,
          predictedStateKey: '1001x1|1002x1',
        },
      ],
      catalogItemsById: new Map([
        [1002, catalogItem(1002)],
      ]),
      shortHorizonOutcomes: outcomes.map((outcome) => ({
        ...outcome,
        complete: false,
        utility: undefined,
      })),
      generatorSnapshot: {
        snapshotId: 'support-v2',
        generatorVersion: 'RECOMMENDATION_CANDIDATE_GENERATOR_V6_2_SUPPORT_UNION',
        policyVersion: 'RECOMMENDATION_CANDIDATE_POLICY_V6_2_SUPPORT_UNION',
        policySha256: 'a'.repeat(64),
        catalogVersion: 'test-catalog',
        catalogSha256: 'b'.repeat(64),
        trainingWindowStart: '2026-06-01T00:00:00.000Z',
        trainingWindowEnd: '2026-07-01T00:00:00.000Z',
      },
    });
    const audit = buildRecommendationHistoricalProReplayAudit([row], {
      minimumTimelineCoverage: 1,
      minimumCandidateMetadataCoverage: 1,
      minimumObservedActionCandidateCoverage: 1,
    });

    expect(audit.coverage.timelineCoverage).toBe(1);
    expect(row.eligibility.stateModel).toBe(false);
  });

  it('uses the nearest post-decision snapshot around a horizon', () => {
    const decision = sourceDecision();
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision,
      snapshots: [
        timelineSnapshot(299),
        timelineSnapshot(650),
        timelineSnapshot(850),
      ],
      objectives: [],
      snapshotStalenessS: 300,
    });

    expect(outcomes.find((outcome) => outcome.horizon === '5m')).toMatchObject({
      complete: true,
      snapshotGameTimeS: 650,
    });
  });
});

function sourceDecision(): HeroBuildDecisionDatasetV3Row {
  return {
    schemaVersion: 1,
    decisionId: '100:200:2',
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
    actualActionType: 'REBUY',
    actualItemId: 1002,
    actualActionKey: 'REBUY:1002',
    outcomeLabel: { playerWon: true },
  };
}

function timelineSnapshot(gameTimeS: number): MatchTimelinePlayerSnapshot {
  return {
    schemaVersion: 1,
    timelineVersion: 'MATCH_TIMELINE_V1',
    snapshotId: `snapshot-${gameTimeS}`,
    sourceEventId: `event-${gameTimeS}`,
    matchId: 100,
    gameTimeS,
    tick: Math.round(gameTimeS * 60),
    steamId: '200',
    heroId: 1,
    teamId: 2,
    kills: 1,
    deaths: 0,
    assists: 1,
    netWorth: 5_000 + gameTimeS,
    heroDamage: 2_000 + gameTimeS,
    receivedAt: '2026-07-10T13:00:00.000Z',
  };
}

function catalogItem(itemId: number) {
  return {
    itemId,
    name: `Item ${itemId}`,
    cost: 500,
    tier: 1,
    slotType: 'WEAPON',
    tags: [],
    componentItemIds: [],
  };
}
