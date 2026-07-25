import {
  bootstrapRecommendationPolicyV6,
  createRecommendationPolicyV6Contribution,
  finalizeRecommendationPolicyV6Estimators,
  softmaxRecommendationPolicyV6,
  type RecommendationPolicyV6Aggregate,
  type RecommendationPolicyV6MatchContribution,
} from '../src/deadlock-live/recommendation-policy-v6-evaluation.service';

describe('Recommendation Policy V6 evaluation core', () => {
  it('produces a normalized softmax and favors larger scores', () => {
    const probabilities = softmaxRecommendationPolicyV6([0, 1, 2], 1);

    expect(probabilities).toHaveLength(3);
    expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(probabilities[2]).toBeGreaterThan(probabilities[1]);
    expect(probabilities[1]).toBeGreaterThan(probabilities[0]);
  });

  it('clips importance weights and computes the doubly robust correction', () => {
    const contribution = createRecommendationPolicyV6Contribution({
      decisionId: 'decision-1',
      matchId: 'match-1',
      evaluationWeight: 0.5,
      reward: 0.8,
      observedActionKey: 'BUY:1',
      behaviorProbability: 0.1,
      targetProbability: 0.9,
      directValue: 0.35,
      observedActionValue: 0.2,
      maxImportanceWeight: 3,
    });

    expect(contribution.rawImportanceWeight).toBeCloseTo(9);
    expect(contribution.clippedImportanceWeight).toBe(3);
    expect(contribution.clipped).toBe(true);
    expect(contribution.ipsContribution).toBeCloseTo(2.4);
    expect(contribution.doublyRobustContribution).toBeCloseTo(2.15);
  });

  it('finalizes match-balanced IPS, SNIPS, direct, and DR estimators', () => {
    const aggregate: RecommendationPolicyV6Aggregate = {
      decisionCount: 2,
      evaluationWeightSum: 1,
      rewardWeightedSum: 0.2,
      ipsWeightedSum: 0.55,
      snipsWeightedSum: 0.55,
      importanceWeightWeightedSum: 1.25,
      importanceWeightSquareSum: 1.0625,
      directWeightedSum: 0.3,
      doublyRobustWeightedSum: 0.45,
    };

    const result = finalizeRecommendationPolicyV6Estimators(aggregate, 2);

    expect(result.observedValue).toBeCloseTo(0.2);
    expect(result.inversePropensityValue).toBeCloseTo(0.55);
    expect(result.selfNormalizedInversePropensityValue).toBeCloseTo(0.44);
    expect(result.directMethodValue).toBeCloseTo(0.3);
    expect(result.doublyRobustValue).toBeCloseTo(0.45);
    expect(result.effectiveSampleSize).toBeCloseTo(1.4705882353);
    expect(result.effectiveSampleSizeRatio).toBeCloseTo(0.7352941176);
    expect(result.deltasVsObserved.doublyRobust).toBeCloseTo(0.25);
  });

  it('bootstraps complete matches deterministically', () => {
    const matches: RecommendationPolicyV6MatchContribution[] = [
      matchContribution('match-1', 0.4, 0.5),
      matchContribution('match-2', -0.2, -0.1),
      matchContribution('match-3', 0.1, 0.2),
    ];

    const first = bootstrapRecommendationPolicyV6(matches, 100, 42);
    const second = bootstrapRecommendationPolicyV6(matches, 100, 42);

    expect(first).toEqual(second);
    expect(first.replicateCount).toBe(100);
    expect(first.intervals.doublyRobustValue.lower).toBeLessThanOrEqual(
      first.intervals.doublyRobustValue.median,
    );
    expect(first.intervals.doublyRobustValue.median).toBeLessThanOrEqual(
      first.intervals.doublyRobustValue.upper,
    );
  });

  it('rejects invalid behavior probability', () => {
    expect(() =>
      createRecommendationPolicyV6Contribution({
        decisionId: 'decision-1',
        matchId: 'match-1',
        evaluationWeight: 1,
        reward: 0,
        observedActionKey: 'BUY:1',
        behaviorProbability: 0,
        targetProbability: 1,
        directValue: 0,
        observedActionValue: 0,
        maxImportanceWeight: 10,
      }),
    ).toThrow('behaviorProbability must be positive and finite.');
  });
});

function matchContribution(
  matchId: string,
  reward: number,
  doublyRobust: number,
): RecommendationPolicyV6MatchContribution {
  return {
    matchId,
    decisionCount: 1,
    evaluationWeightSum: 1,
    rewardWeightedSum: reward,
    ipsWeightedSum: reward,
    snipsWeightedSum: reward,
    importanceWeightWeightedSum: 1,
    importanceWeightSquareSum: 1,
    directWeightedSum: doublyRobust,
    doublyRobustWeightedSum: doublyRobust,
  };
}
