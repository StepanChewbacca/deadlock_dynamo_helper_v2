import {
  assertNoUserLiveContamination,
  assertRecommendationSourceEligible,
  isProRecommendationDataSource,
  parseRecommendationDataSource,
  recommendationEligibilityForSource,
  resolveTrustedRecommendationDataSource,
} from '../src/deadlock-live/recommendation-data-provenance';
import { createRecommendationUserLiveDecisionEvent } from '../src/deadlock-live/recommendation-user-live-telemetry.service';

describe('recommendation data provenance', () => {
  it('allows only explicit pro sources into pro training', () => {
    expect(isProRecommendationDataSource('PRO_HISTORICAL')).toBe(true);
    expect(isProRecommendationDataSource('PRO_LIVE')).toBe(true);
    expect(isProRecommendationDataSource('USER_LIVE')).toBe(false);

    expect(() =>
      assertRecommendationSourceEligible('PRO_HISTORICAL', 'PRO_VALUE_TRAIN'),
    ).not.toThrow();
    expect(() =>
      assertRecommendationSourceEligible('USER_LIVE', 'PRO_VALUE_TRAIN'),
    ).toThrow('USER_LIVE');
    expect(() =>
      assertRecommendationSourceEligible('USER_LIVE', 'PRO_BEHAVIOR_TRAIN'),
    ).toThrow('USER_LIVE');
    expect(() =>
      assertRecommendationSourceEligible('USER_LIVE', 'PRO_MODEL_SELECTION'),
    ).toThrow('USER_LIVE');
    expect(() =>
      assertRecommendationSourceEligible('USER_LIVE', 'PRO_TEST'),
    ).toThrow('USER_LIVE');
    expect(() =>
      assertRecommendationSourceEligible('USER_LIVE', 'PRO_OPE'),
    ).toThrow('USER_LIVE');
    expect(() =>
      assertRecommendationSourceEligible(
        'USER_LIVE',
        'USER_RUNTIME_EVALUATION',
      ),
    ).not.toThrow();
  });

  it('fails closed for unknown sources', () => {
    expect(() => parseRecommendationDataSource('UNKNOWN')).toThrow(
      'Unsupported recommendation data source',
    );
  });

  it('derives the source from trusted ingestion paths', () => {
    expect(
      resolveTrustedRecommendationDataSource({
        ingestionKind: 'HISTORICAL_PRO_CRAWLER',
      }),
    ).toBe('PRO_HISTORICAL');
    expect(
      resolveTrustedRecommendationDataSource({
        ingestionKind: 'LIVE_PRO_CRAWLER',
      }),
    ).toBe('PRO_LIVE');
    expect(
      resolveTrustedRecommendationDataSource({
        ingestionKind: 'LOCAL_CLIENT',
      }),
    ).toBe('USER_LIVE');
  });

  it('rejects any user live row in a pro artifact', () => {
    expect(() =>
      assertNoUserLiveContamination({
        sourceCounts: {
          PRO_HISTORICAL: 100,
          USER_LIVE: 1,
        },
        artifactName: 'Recommendation Dataset V6',
      }),
    ).toThrow('must never enter a pro-model artifact');
  });

  it('marks user live telemetry as ineligible for pro modeling', () => {
    const eligibility = recommendationEligibilityForSource('USER_LIVE');
    expect(eligibility).toEqual({
      eligibleForProBehaviorTraining: false,
      eligibleForProValueTraining: false,
      eligibleForProModelSelection: false,
      eligibleForProTest: false,
      eligibleForProOpe: false,
      eligibleForRuntimeEvaluation: true,
    });
  });
});

describe('user live recommendation telemetry', () => {
  it('creates an isolated event without pro-training eligibility', () => {
    const event = createRecommendationUserLiveDecisionEvent({
      decisionId: 'decision-1',
      matchId: 'match-1',
      playerSlot: 0,
      gameTimeSeconds: 300,
      candidateGeneratorVersion: 'candidate-v1',
      catalogVersion: 'catalog-v1',
      stateFeatureVersion: 'state-v1',
      baselineModelVersion: 'baseline-v1',
      challengerModelVersion: 'challenger-v1',
      policyVersion: 'policy-v1',
      rolloutMode: 'CANARY',
      candidateActionKeys: ['BUY:1', 'BUY:2'],
      baselineRanking: [
        { actionKey: 'BUY:1', score: 0.5, rank: 1, supported: true },
        { actionKey: 'BUY:2', score: 0.4, rank: 2, supported: true },
      ],
      challengerRanking: [
        { actionKey: 'BUY:2', score: 0.6, rank: 1, supported: true },
        { actionKey: 'BUY:1', score: 0.3, rank: 2, supported: true },
      ],
      displayedActionKeys: ['BUY:2', 'BUY:1'],
      elapsedMs: 8,
    });

    expect(event.dataSource).toBe('USER_LIVE');
    expect(event.eligibility.eligibleForProValueTraining).toBe(false);
    expect(event.eligibility.eligibleForProBehaviorTraining).toBe(false);
    expect(event.eligibility.eligibleForProModelSelection).toBe(false);
    expect(event.candidateActionKeys).toEqual(['BUY:1', 'BUY:2']);
  });

  it('rejects rankings that introduce actions outside the candidate set', () => {
    expect(() =>
      createRecommendationUserLiveDecisionEvent({
        matchId: 'match-1',
        playerSlot: 0,
        gameTimeSeconds: 300,
        candidateGeneratorVersion: 'candidate-v1',
        catalogVersion: 'catalog-v1',
        stateFeatureVersion: 'state-v1',
        baselineModelVersion: 'baseline-v1',
        policyVersion: 'policy-v1',
        rolloutMode: 'SHADOW',
        candidateActionKeys: ['BUY:1'],
        baselineRanking: [
          { actionKey: 'BUY:2', score: 0.5, rank: 1, supported: true },
        ],
        displayedActionKeys: ['BUY:1'],
        elapsedMs: 1,
      }),
    ).toThrow('outside the candidate set');
  });
});
