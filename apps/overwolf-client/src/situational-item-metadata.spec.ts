import {
  createSituationalBadgeText,
  createSituationalEvidenceText,
  createSituationalItemWarning,
} from './situational-item-metadata';
import {
  LiveBuildRecommendationAction,
  LiveBuildRecommendationSnapshot,
} from './live-build-recommendation-poller';

function createAction(
  overrides: Partial<LiveBuildRecommendationAction> = {},
): LiveBuildRecommendationAction {
  return {
    type: 'BUY',
    itemId: 100,
    actionKey: 'BUY:100',
    label: 'Buy Reactive Barrier',
    confidencePercent: 70,
    historicalProbabilityPercent: 40,
    typicalGameTimeLabel: '8:00',
    item: {
      itemId: 100,
      name: 'Reactive Barrier',
      className: 'reactive_barrier',
      slotType: 'vitality',
      cost: 1250,
      tier: 2,
    },
    explanation: {
      code: 'EXACT_STATE_EVIDENCE',
      evidenceLevel: 'OBSERVED',
      text: 'Observed from this state.',
    },
    isSituational: true,
    wasPromotedByMatchup: true,
    situationalAgainstHeroId: 13,
    situationalLower95OddsRatio: 1.25,
    matchupObservationCount: 42,
    ...overrides,
  };
}

function createSnapshot(
  action: LiveBuildRecommendationAction,
): LiveBuildRecommendationSnapshot {
  return {
    state: 'READY',
    matchId: 'match-1',
    itemIds: [],
    enemyHeroIds: [13],
    isStale: false,
    recommendation: {
      mode: 'EXACT',
      action,
      alternatives: [],
    },
    refreshCount: 1,
    cacheHitCount: 0,
    discardedResultCount: 0,
    lastObservedAt: new Date(0).toISOString(),
  };
}

describe('situational item metadata', () => {
  it('creates a Dynamo warning only for an item promoted by matchup scoring', () => {
    const warning = createSituationalItemWarning(
      createSnapshot(createAction()),
      { 13: 'Haze' },
    );

    expect(warning).toEqual(expect.objectContaining({
      key: 'match-1:BUY:100:13',
      itemName: 'Reactive Barrier',
      enemyHeroName: 'Haze',
      lower95OddsRatio: 1.25,
      matchupObservationCount: 42,
    }));
  });

  it('does not create a warning when a situational item remains at its base rank', () => {
    const warning = createSituationalItemWarning(
      createSnapshot(createAction({ wasPromotedByMatchup: false })),
      { 13: 'Haze' },
    );

    expect(warning).toBeUndefined();
  });

  it('marks every supported matchup item and exposes conservative evidence', () => {
    const action = createAction({ wasPromotedByMatchup: false });

    expect(createSituationalBadgeText(action, { 13: 'Haze' }))
      .toBe('Situational vs Haze');
    expect(createSituationalEvidenceText(action))
      .toBe('95% lower OR x1.25 | n=42');
  });
});
