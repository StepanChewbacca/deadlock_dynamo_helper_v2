import {
  RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION,
  RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION,
  type RecommendationHistoricalProReplayRow,
} from '../src/deadlock-live/recommendation-historical-pro-replay';
import { RecommendationHistoricalProReplayAuditAccumulator } from '../src/deadlock-live/recommendation-historical-pro-replay-streaming-audit';

describe('Recommendation historical pro replay streaming audit', () => {
  it('counts a joined decision timeline independently from horizon completeness', () => {
    const accumulator = new RecommendationHistoricalProReplayAuditAccumulator({
      minimumTimelineCoverage: 1,
      minimumCandidateMetadataCoverage: 1,
      minimumObservedActionCandidateCoverage: 1,
    });

    accumulator.observe(rowWithoutCompleteHorizon());
    const audit = accumulator.finalize('2026-08-02T20:21:26.676Z');

    expect(audit.passed).toBe(true);
    expect(audit.reasons).toEqual([]);
    expect(audit.coverage.timelineRowCount).toBe(1);
    expect(audit.coverage.timelineCoverage).toBe(1);
    expect(audit.coverage.stateModelEligibleCount).toBe(0);
    expect(audit.coverage.behavioralModelEligibleCount).toBe(1);
    expect(audit.coverage.actionModelEligibleCount).toBe(0);
  });
});

function rowWithoutCompleteHorizon(): RecommendationHistoricalProReplayRow {
  return {
    schemaVersion: RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION,
    replayVersion: RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION,
    dataSource: 'PRO_HISTORICAL',
    decisionId: 'decision-1',
    matchId: '100',
    matchStartTime: '2026-07-02T12:00:00.000Z',
    playerId: '200',
    heroId: 1,
    team: 0,
    decisionGameTimeS: 3_000,
    phase: 'LATE',
    timeline: {
      decisionSnapshotJoined: true,
    },
    state: {
      inventoryBeforeStateKey: '1001x1',
      previousActionKeys: ['BUY:1001'],
      buildPrefixKey: 'BUY:1001',
      alliedHeroIds: [1, 2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
    },
    observedAction: {
      actionType: 'BUY',
      itemId: 1002,
      actionKey: 'BUY:1002',
      inCandidateSet: true,
    },
    candidates: [
      {
        actionKey: 'BUY:1002',
        actionType: 'BUY',
        itemId: 1002,
        rank: 1,
        generatorScore: 0.7,
        historicalCount: 12,
        historicalProbability: 0.6,
        confidence: 0.8,
        predictedStateKey: '1001x1|1002x1',
        catalogMetadataAvailable: true,
        catalog: {
          itemId: 1002,
          cost: 1_250,
          tier: 2,
          slotType: 'WEAPON',
          tags: ['DAMAGE'],
          componentItemIds: [],
        },
      },
      {
        actionKey: 'BUY:1003',
        actionType: 'BUY',
        itemId: 1003,
        rank: 2,
        generatorScore: 0.6,
        historicalCount: 8,
        historicalProbability: 0.4,
        confidence: 0.7,
        predictedStateKey: '1001x1|1003x1',
        catalogMetadataAvailable: true,
        catalog: {
          itemId: 1003,
          cost: 1_250,
          tier: 2,
          slotType: 'WEAPON',
          tags: ['DAMAGE'],
          componentItemIds: [],
        },
      },
    ],
    shortHorizonOutcomes: [
      { horizon: '3m', complete: false },
      { horizon: '5m', complete: false },
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
      catalogVersion: 'catalog-1',
      catalogSha256: 'b'.repeat(64),
      trainingWindowStart: '2026-06-01T00:00:00.000Z',
      trainingWindowEnd: '2026-07-01T00:00:00.000Z',
    },
    eligibility: {
      stateModel: false,
      behavioralModel: true,
      actionModel: false,
      exclusionReasons: ['MISSING_COMPLETE_SHORT_HORIZON_OUTCOME'],
    },
  };
}
