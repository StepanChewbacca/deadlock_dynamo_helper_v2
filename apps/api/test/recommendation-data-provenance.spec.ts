import {
  allRecommendationDataSources,
  assertNoUserLiveContamination,
  assertRecommendationArtifactSources,
  assertRecommendationSourceEligible,
  isProRecommendationDataSource,
  parseRecommendationDataSource,
  recommendationEligibilityForSource,
  resolveTrustedRecommendationDataSource,
} from '../src/deadlock-live/recommendation-data-provenance';

describe('recommendation data provenance', () => {
  it('uses a closed set of explicit sources', () => {
    expect(allRecommendationDataSources()).toEqual([
      'PRO_HISTORICAL',
      'PRO_FUTURE_HOLDOUT',
      'USER_LIVE',
    ]);
    expect(parseRecommendationDataSource('PRO_HISTORICAL')).toBe(
      'PRO_HISTORICAL',
    );
    expect(parseRecommendationDataSource('PRO_FUTURE_HOLDOUT')).toBe(
      'PRO_FUTURE_HOLDOUT',
    );
    expect(parseRecommendationDataSource('USER_LIVE')).toBe('USER_LIVE');
    expect(() => parseRecommendationDataSource('PRO_LIVE')).toThrow(
      'Unsupported recommendation data source',
    );
    expect(() => parseRecommendationDataSource('UNKNOWN')).toThrow(
      'Unsupported recommendation data source',
    );
  });

  it('allows only historical pro data into training and model selection', () => {
    for (const purpose of [
      'PRO_BEHAVIOR_TRAIN',
      'PRO_VALUE_TRAIN',
      'PRO_MODEL_SELECTION',
      'PRO_CALIBRATION',
    ] as const) {
      expect(() =>
        assertRecommendationSourceEligible('PRO_HISTORICAL', purpose),
      ).not.toThrow();
      expect(() =>
        assertRecommendationSourceEligible('PRO_FUTURE_HOLDOUT', purpose),
      ).toThrow('PRO_FUTURE_HOLDOUT');
      expect(() =>
        assertRecommendationSourceEligible('USER_LIVE', purpose),
      ).toThrow('USER_LIVE');
    }
  });

  it('reserves the future holdout for final test and evaluation', () => {
    expect(() =>
      assertRecommendationSourceEligible('PRO_HISTORICAL', 'PRO_TEST'),
    ).toThrow('PRO_HISTORICAL');
    expect(() =>
      assertRecommendationSourceEligible('PRO_FUTURE_HOLDOUT', 'PRO_TEST'),
    ).not.toThrow();
    expect(() =>
      assertRecommendationSourceEligible('PRO_FUTURE_HOLDOUT', 'PRO_OPE'),
    ).not.toThrow();
    expect(() =>
      assertRecommendationSourceEligible('USER_LIVE', 'PRO_TEST'),
    ).toThrow('USER_LIVE');
    expect(() =>
      assertRecommendationSourceEligible('USER_LIVE', 'PRO_OPE'),
    ).toThrow('USER_LIVE');
  });

  it('allows user live data only for runtime evaluation', () => {
    const eligibility = recommendationEligibilityForSource('USER_LIVE');

    expect(eligibility).toEqual({
      eligibleForProBehaviorTraining: false,
      eligibleForProValueTraining: false,
      eligibleForProModelSelection: false,
      eligibleForProCalibration: false,
      eligibleForProTest: false,
      eligibleForProOpe: false,
      eligibleForRuntimeEvaluation: true,
    });
    expect(() =>
      assertRecommendationSourceEligible(
        'USER_LIVE',
        'USER_RUNTIME_EVALUATION',
      ),
    ).not.toThrow();
  });

  it('validates complete artifact source counts against their purpose', () => {
    expect(() =>
      assertRecommendationArtifactSources({
        artifactName: 'Behavioral V5 training dataset',
        purpose: 'PRO_BEHAVIOR_TRAIN',
        sourceCounts: {
          PRO_HISTORICAL: 100,
        },
      }),
    ).not.toThrow();

    expect(() =>
      assertRecommendationArtifactSources({
        artifactName: 'Behavioral V5 training dataset',
        purpose: 'PRO_BEHAVIOR_TRAIN',
        sourceCounts: {
          PRO_HISTORICAL: 100,
          PRO_FUTURE_HOLDOUT: 1,
        },
      }),
    ).toThrow('PRO_FUTURE_HOLDOUT');

    expect(() =>
      assertRecommendationArtifactSources({
        artifactName: 'Value V8 training dataset',
        purpose: 'PRO_VALUE_TRAIN',
        sourceCounts: {
          PRO_HISTORICAL: 100,
          USER_LIVE: 1,
        },
      }),
    ).toThrow('USER_LIVE');
  });

  it('fails closed when any user live row enters a pro artifact', () => {
    expect(() =>
      assertNoUserLiveContamination({
        artifactName: 'Recommendation Pro Decision Dataset V6',
        sourceCounts: {
          PRO_HISTORICAL: 100,
          USER_LIVE: 1,
        },
      }),
    ).toThrow('must never enter a pro-model artifact');
  });

  it('rejects invalid source counters before eligibility checks', () => {
    expect(() =>
      assertRecommendationArtifactSources({
        artifactName: 'Invalid artifact',
        purpose: 'PRO_VALUE_TRAIN',
        sourceCounts: {
          PRO_HISTORICAL: -1,
        },
      }),
    ).toThrow('invalid PRO_HISTORICAL row count');
  });

  it('derives sources only from trusted server ingestion paths', () => {
    expect(
      resolveTrustedRecommendationDataSource({
        ingestionKind: 'HISTORICAL_PRO_CRAWLER',
      }),
    ).toBe('PRO_HISTORICAL');
    expect(
      resolveTrustedRecommendationDataSource({
        ingestionKind: 'FUTURE_PRO_HOLDOUT_CRAWLER',
      }),
    ).toBe('PRO_FUTURE_HOLDOUT');
    expect(
      resolveTrustedRecommendationDataSource({
        ingestionKind: 'LOCAL_CLIENT',
      }),
    ).toBe('USER_LIVE');
  });

  it('classifies both trusted pro sources without making them interchangeable', () => {
    expect(isProRecommendationDataSource('PRO_HISTORICAL')).toBe(true);
    expect(isProRecommendationDataSource('PRO_FUTURE_HOLDOUT')).toBe(true);
    expect(isProRecommendationDataSource('USER_LIVE')).toBe(false);

    expect(
      recommendationEligibilityForSource('PRO_HISTORICAL')
        .eligibleForProValueTraining,
    ).toBe(true);
    expect(
      recommendationEligibilityForSource('PRO_FUTURE_HOLDOUT')
        .eligibleForProValueTraining,
    ).toBe(false);
  });
});
