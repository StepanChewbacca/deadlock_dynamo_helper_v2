import {
  createSituationalBadgeText,
  createSituationalItemWarning,
} from './situational-item-metadata';
import {
  LiveBuildRecommendationAction,
  LiveBuildRecommendationSnapshot,
} from './live-build-recommendation-poller';

describe('presented situational hero names', () => {
  it('uses the backend hero name before the GEP hero map', () => {
    const action = createAction() as LiveBuildRecommendationAction & {
      situationalAgainstHeroName: string;
    };
    action.situationalAgainstHeroName = 'Warden';
    const snapshot = createSnapshot(action);

    expect(createSituationalBadgeText(action, { 8: 'Wrong Name' }))
      .toBe('Situational vs Warden');
    expect(createSituationalItemWarning(snapshot, {})?.enemyHeroName)
      .toBe('Warden');
  });
});

function createAction(): LiveBuildRecommendationAction {
  return {
    type: 'BUY',
    itemId: 100,
    actionKey: 'BUY:100',
    label: 'Buy Extra Charge',
    confidencePercent: 32,
    historicalProbabilityPercent: 17,
    typicalGameTimeLabel: '3:20',
    item: {
      itemId: 100,
      name: 'Extra Charge',
      className: 'extra_charge',
      slotType: 'spirit',
      cost: 500,
      tier: 1,
    },
    explanation: {
      code: 'EXACT_STATE_EVIDENCE',
      evidenceLevel: 'OBSERVED',
      text: 'Observed from this state.',
    },
    isSituational: true,
    wasPromotedByMatchup: false,
    wasInsertedByMatchup: false,
    situationalAgainstHeroId: 8,
    situationalLower95OddsRatio: 1.17,
    matchupObservationCount: 86,
  };
}

function createSnapshot(
  action: LiveBuildRecommendationAction,
): LiveBuildRecommendationSnapshot {
  return {
    state: 'READY',
    matchId: 'match-1',
    itemIds: [],
    enemyHeroIds: [8],
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
