import {
  createRecommendationCandidateGeneratorSnapshotArtifactFromNormalizedPolicies,
  validateRecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationSerializedHeroBuildPolicy,
} from '../src/deadlock-live/recommendation-candidate-generator-snapshot';

describe('Recommendation candidate snapshot memory contract', () => {
  it('reuses an already-normalized policy graph without cloning it', () => {
    const policies: RecommendationSerializedHeroBuildPolicy[] = [
      {
        heroId: 1,
        playerCount: 1,
        stateCount: 1,
        transitionCount: 1,
        states: [
          {
            stateKey: 'EMPTY',
            observationCount: 1,
            nextActionCount: 1,
            nextActions: [
              {
                actionType: 'BUY',
                itemId: 1001,
                actionKey: 'BUY:1001',
                count: 1,
                probability: 1,
                averageGameTimeS: 300,
                afterStates: [
                  {
                    afterStateKey: '1001x1',
                    count: 1,
                    probability: 1,
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    const artifact =
      createRecommendationCandidateGeneratorSnapshotArtifactFromNormalizedPolicies({
        snapshot: {
          snapshotId: 'memory-test',
          generatorVersion: 'generator-test',
          policyVersion: 'policy-test',
          catalogVersion: 'catalog-test',
          trainingWindowStart: '2026-07-01T00:00:00.000Z',
          trainingWindowEnd: '2026-07-02T00:00:00.000Z',
        },
        policies,
        catalog: {
          version: 'catalog-test',
          items: [
            {
              itemId: 1001,
              cost: 500,
              tier: 1,
              slotType: 'WEAPON',
              tags: [],
              componentItemIds: [],
            },
          ],
        },
      });

    expect(artifact.policies).toBe(policies);
    expect(artifact.snapshot.policySha256).toMatch(/^[a-f0-9]{64}$/);
    validateRecommendationCandidateGeneratorSnapshotArtifact(artifact);
  });
});
