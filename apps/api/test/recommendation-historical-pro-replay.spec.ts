import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import {
  buildRecommendationHistoricalProReplayAudit,
  candidateActionsFromRecommendationResponse,
  createRecommendationHistoricalProReplayRow,
  type RecommendationFrozenCandidateGeneratorSnapshot,
  type RecommendationHistoricalCatalogItem,
  type RecommendationHistoricalCandidateInput,
} from '../src/deadlock-live/recommendation-historical-pro-replay';
import type { HeroBuildRecommendationResponse } from '../src/deadlock-live/hero-build-recommendation.service';

const POLICY_SHA = 'a'.repeat(64);
const CATALOG_SHA = 'b'.repeat(64);

function decision(
  overrides: Partial<HeroBuildDecisionDatasetV3Row> = {},
): HeroBuildDecisionDatasetV3Row {
  return {
    schemaVersion: 1,
    decisionId: 'decision-1',
    matchId: 100,
    matchStartTime: '2026-07-02T12:00:00.000Z',
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
    outcomeLabel: {
      playerWon: true,
    },
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<RecommendationFrozenCandidateGeneratorSnapshot> = {},
): RecommendationFrozenCandidateGeneratorSnapshot {
  return {
    snapshotId: 'candidate-snapshot-1',
    generatorVersion: 'HERO_BUILD_CANDIDATE_GENERATOR_V1',
    policyVersion: 'policy-1',
    policySha256: POLICY_SHA,
    catalogVersion: 'catalog-1',
    catalogSha256: CATALOG_SHA,
    trainingWindowStart: '2026-06-01T00:00:00.000Z',
    trainingWindowEnd: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function catalogItem(
  itemId: number,
  overrides: Partial<RecommendationHistoricalCatalogItem> = {},
): RecommendationHistoricalCatalogItem {
  return {
    itemId,
    name: `Item ${itemId}`,
    cost: 1_250,
    tier: 2,
    slotType: 'WEAPON',
    itemType: 'UPGRADE',
    isActiveItem: false,
    activationType: 'PASSIVE',
    tags: ['DAMAGE'],
    componentItemIds: [],
    ...overrides,
  };
}

function candidate(
  actionKey: string,
  itemId: number,
  rank: number,
  overrides: Partial<RecommendationHistoricalCandidateInput> = {},
): RecommendationHistoricalCandidateInput {
  return {
    actionKey,
    actionType: 'BUY',
    itemId,
    rank,
    score: 0.5 - rank * 0.01,
    historicalCount: 10,
    historicalProbability: 0.5,
    confidence: 0.8,
    predictedStateKey: `1001:1|${itemId}:1`,
    ...overrides,
  };
}

function completeOutcomes() {
  return [
    { horizon: '3m' as const, complete: true, utility: 0.1, snapshotGameTimeS: 480 },
    { horizon: '5m' as const, complete: true, utility: 0.2, snapshotGameTimeS: 600 },
    { horizon: '10m' as const, complete: true, utility: 0.3, snapshotGameTimeS: 900 },
  ];
}

describe('Recommendation historical pro replay', () => {
  it('never injects the observed action into the generated candidate set', () => {
    const row = createRecommendationHistoricalProReplayRow({
      decision: decision(),
      candidateActions: [candidate('BUY:1003', 1003, 1)],
      catalogItemsById: new Map([[1003, catalogItem(1003)]]),
      shortHorizonOutcomes: completeOutcomes(),
      generatorSnapshot: snapshot(),
    });

    expect(row.dataSource).toBe('PRO_HISTORICAL');
    expect(row.candidates.map((value) => value.actionKey)).toEqual([
      'BUY:1003',
    ]);
    expect(row.candidates.map((value) => value.actionKey)).not.toContain(
      'BUY:1002',
    );
    expect(row.observedAction.inCandidateSet).toBe(false);
    expect(row.eligibility.stateModel).toBe(true);
    expect(row.eligibility.behavioralModel).toBe(false);
    expect(row.eligibility.actionModel).toBe(false);
    expect(row.eligibility.exclusionReasons).toContain(
      'OBSERVED_ACTION_OUTSIDE_CANDIDATE_SET',
    );
  });

  it('allows behavior and action training only for honest supported choices', () => {
    const row = createRecommendationHistoricalProReplayRow({
      decision: decision(),
      candidateActions: [
        candidate('BUY:1002', 1002, 1),
        candidate('BUY:1003', 1003, 2),
      ],
      catalogItemsById: new Map([
        [1002, catalogItem(1002)],
        [1003, catalogItem(1003)],
      ]),
      shortHorizonOutcomes: completeOutcomes(),
      generatorSnapshot: snapshot(),
    });

    expect(row.observedAction.inCandidateSet).toBe(true);
    expect(row.eligibility).toEqual({
      stateModel: true,
      behavioralModel: true,
      actionModel: true,
      exclusionReasons: [],
    });
  });

  it('requires the frozen generator training window to precede the match', () => {
    expect(() =>
      createRecommendationHistoricalProReplayRow({
        decision: decision(),
        candidateActions: [candidate('BUY:1002', 1002, 1)],
        catalogItemsById: new Map([[1002, catalogItem(1002)]]),
        shortHorizonOutcomes: completeOutcomes(),
        generatorSnapshot: snapshot({
          trainingWindowEnd: '2026-07-02T12:00:00.000Z',
        }),
      }),
    ).toThrow('not strictly earlier');
  });

  it('keeps missing catalog metadata visible and excludes action training', () => {
    const row = createRecommendationHistoricalProReplayRow({
      decision: decision(),
      candidateActions: [
        candidate('BUY:1002', 1002, 1),
        candidate('BUY:1003', 1003, 2),
      ],
      catalogItemsById: new Map([[1002, catalogItem(1002)]]),
      shortHorizonOutcomes: completeOutcomes(),
      generatorSnapshot: snapshot(),
    });

    expect(row.candidates[0].catalogMetadataAvailable).toBe(true);
    expect(row.candidates[1].catalogMetadataAvailable).toBe(false);
    expect(row.eligibility.behavioralModel).toBe(false);
    expect(row.eligibility.actionModel).toBe(false);
    expect(row.eligibility.exclusionReasons).toContain(
      'INCOMPLETE_CANDIDATE_METADATA',
    );
  });

  it('uses only pre-action state features in the replay row', () => {
    const row = createRecommendationHistoricalProReplayRow({
      decision: decision(),
      candidateActions: [
        candidate('BUY:1002', 1002, 1),
        candidate('BUY:1003', 1003, 2),
      ],
      catalogItemsById: new Map([
        [1002, catalogItem(1002)],
        [1003, catalogItem(1003)],
      ]),
      shortHorizonOutcomes: completeOutcomes(),
      generatorSnapshot: snapshot(),
    });

    expect(row.state.inventoryBeforeStateKey).toBe('1001:1');
    expect(row).not.toHaveProperty('inventoryAfterStateKey');
    expect(row.state).not.toHaveProperty('inventoryAfterStateKey');
    expect(row.state).not.toHaveProperty('outcomeLabel');
    expect(row.state).not.toHaveProperty('actualActionKey');
  });

  it('normalizes candidate ordering deterministically and removes duplicates', () => {
    const row = createRecommendationHistoricalProReplayRow({
      decision: decision(),
      candidateActions: [
        candidate('BUY:1003', 1003, 20, { score: 0.7 }),
        candidate('BUY:1002', 1002, 10, { score: 0.5 }),
        candidate('BUY:1002', 1002, 11, { score: 0.9 }),
      ],
      catalogItemsById: new Map([
        [1002, catalogItem(1002)],
        [1003, catalogItem(1003)],
      ]),
      shortHorizonOutcomes: completeOutcomes(),
      generatorSnapshot: snapshot(),
    });

    expect(row.candidates.map((value) => value.actionKey)).toEqual([
      'BUY:1002',
      'BUY:1003',
    ]);
    expect(row.candidates.map((value) => value.rank)).toEqual([1, 2]);
    expect(row.candidates[0].generatorScore).toBe(0.5);
  });

  it('extracts non-HOLD candidates from a recommendation response', () => {
    const response: HeroBuildRecommendationResponse = {
      mode: 'EXACT',
      heroId: 1,
      requestedStateKey: '1001:1',
      gameTimeS: 300,
      observationCount: 10,
      candidateStateCount: 1,
      action: recommendationAction('BUY:1002', 1002, 0.7),
      alternatives: [
        recommendationAction('BUY:1003', 1003, 0.6),
        {
          ...recommendationAction('HOLD', 1004, 0.1),
          type: 'HOLD',
          sourceActionType: undefined,
          itemId: undefined,
          actionKey: 'HOLD',
        },
      ],
    };

    expect(candidateActionsFromRecommendationResponse(response)).toEqual([
      expect.objectContaining({ actionKey: 'BUY:1002', rank: 1 }),
      expect.objectContaining({ actionKey: 'BUY:1003', rank: 2 }),
    ]);
  });

  it('builds an audit with explicit candidate and timeline gates', () => {
    const rows = [
      createRecommendationHistoricalProReplayRow({
        decision: decision(),
        candidateActions: [
          candidate('BUY:1002', 1002, 1),
          candidate('BUY:1003', 1003, 2),
        ],
        catalogItemsById: new Map([
          [1002, catalogItem(1002)],
          [1003, catalogItem(1003)],
        ]),
        shortHorizonOutcomes: completeOutcomes(),
        generatorSnapshot: snapshot(),
      }),
    ];
    const audit = buildRecommendationHistoricalProReplayAudit(
      rows,
      {
        minimumTimelineCoverage: 1,
        minimumCandidateMetadataCoverage: 1,
        minimumObservedActionCandidateCoverage: 1,
      },
      '2026-07-27T00:00:00.000Z',
    );

    expect(audit.passed).toBe(true);
    expect(audit.sourceCounts).toEqual({
      PRO_HISTORICAL: 1,
      PRO_FUTURE_HOLDOUT: 0,
      USER_LIVE: 0,
    });
    expect(audit.integrity.observedActionInjectedCount).toBe(0);
    expect(audit.coverage.timelineCoverage).toBe(1);
    expect(audit.coverage.candidateMetadataCoverage).toBe(1);
    expect(audit.coverage.observedActionCandidateCoverage).toBe(1);
  });
});

function recommendationAction(
  actionKey: string,
  itemId: number,
  score: number,
) {
  return {
    type: 'BUY' as const,
    sourceActionType: 'BUY' as const,
    itemId,
    actionKey,
    historicalCount: 10,
    historicalProbability: 0.5,
    averageGameTimeS: 300,
    matchedStateKey: '1001:1',
    matchedStateObservationCount: 10,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    predictedStateKey: `1001:1|${itemId}:1`,
    score,
    confidence: 0.8,
  };
}
