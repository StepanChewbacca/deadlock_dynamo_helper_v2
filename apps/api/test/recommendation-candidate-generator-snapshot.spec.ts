import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import {
  createRecommendationCandidateGeneratorSnapshotArtifact,
  generateRecommendationHistoricalCandidatesFromSnapshot,
  selectRecommendationCandidateGeneratorSnapshotArtifact,
  validateRecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationSerializedHeroBuildPolicy,
} from '../src/deadlock-live/recommendation-candidate-generator-snapshot';
import type { RecommendationHistoricalCatalogItem } from '../src/deadlock-live/recommendation-historical-pro-replay';

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

function catalogItem(itemId: number): RecommendationHistoricalCatalogItem {
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
  };
}

function policy(): RecommendationSerializedHeroBuildPolicy {
  return {
    heroId: 1,
    playerCount: 50,
    stateCount: 1,
    transitionCount: 20,
    states: [
      {
        stateKey: '1001:1',
        observationCount: 20,
        nextActionCount: 2,
        nextActions: [
          {
            actionType: 'BUY',
            itemId: 1002,
            actionKey: 'BUY:1002',
            count: 12,
            probability: 0.6,
            averageGameTimeS: 320,
            afterStates: [
              {
                afterStateKey: '1001:1|1002:1',
                count: 12,
                probability: 1,
              },
            ],
          },
          {
            actionType: 'BUY',
            itemId: 1003,
            actionKey: 'BUY:1003',
            count: 8,
            probability: 0.4,
            averageGameTimeS: 340,
            afterStates: [
              {
                afterStateKey: '1001:1|1003:1',
                count: 8,
                probability: 1,
              },
            ],
          },
        ],
      },
    ],
  };
}

function artifact(trainingWindowEnd: string, snapshotId: string) {
  return createRecommendationCandidateGeneratorSnapshotArtifact({
    snapshot: {
      snapshotId,
      generatorVersion: 'HERO_BUILD_CANDIDATE_GENERATOR_V1',
      policyVersion: `policy-${snapshotId}`,
      catalogVersion: 'catalog-1',
      trainingWindowStart: '2026-06-01T00:00:00.000Z',
      trainingWindowEnd,
    },
    generatorOptions: {
      minExactObservations: 3,
      maxBackoffDistance: 4,
      maxBackoffStates: 64,
      limit: 100,
    },
    policies: [policy()],
    catalog: {
      version: 'catalog-1',
      items: [catalogItem(1001), catalogItem(1002), catalogItem(1003)],
    },
  });
}

describe('Recommendation candidate generator snapshot', () => {
  it('creates and validates immutable policy and catalog hashes', () => {
    const value = artifact('2026-07-01T00:00:00.000Z', 'snapshot-1');

    expect(() =>
      validateRecommendationCandidateGeneratorSnapshotArtifact(value),
    ).not.toThrow();
    expect(value.snapshot.policySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(value.snapshot.catalogSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('selects the latest snapshot trained strictly before the match', () => {
    const selected = selectRecommendationCandidateGeneratorSnapshotArtifact(
      [
        artifact('2026-06-20T00:00:00.000Z', 'snapshot-old'),
        artifact('2026-07-09T00:00:00.000Z', 'snapshot-new'),
        artifact('2026-07-10T12:00:00.000Z', 'snapshot-leaking'),
      ],
      '2026-07-10T12:00:00.000Z',
    );

    expect(selected?.snapshot.snapshotId).toBe('snapshot-new');
  });

  it('runs the frozen policy and returns only generated candidates', () => {
    const candidates =
      generateRecommendationHistoricalCandidatesFromSnapshot({
        decision: decision({ actualActionKey: 'BUY:9999', actualItemId: 9999 }),
        artifact: artifact('2026-07-01T00:00:00.000Z', 'snapshot-1'),
      });

    expect(candidates.map((candidate) => candidate.actionKey)).toEqual([
      'BUY:1002',
      'BUY:1003',
    ]);
    expect(candidates.map((candidate) => candidate.actionKey)).not.toContain(
      'BUY:9999',
    );
  });

  it('fails when policy content is changed after hashing', () => {
    const value = artifact('2026-07-01T00:00:00.000Z', 'snapshot-1');
    value.policies[0].states[0].nextActions[0].count += 1;

    expect(() =>
      validateRecommendationCandidateGeneratorSnapshotArtifact(value),
    ).toThrow('policy SHA-256 mismatch');
  });

  it('rejects a snapshot trained on the replay match', () => {
    expect(() =>
      generateRecommendationHistoricalCandidatesFromSnapshot({
        decision: decision(),
        artifact: artifact(
          '2026-07-10T12:00:00.000Z',
          'snapshot-leaking',
        ),
      }),
    ).toThrow('must end before');
  });
});
