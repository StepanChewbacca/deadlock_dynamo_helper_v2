import type { LiveBuildRecommendationAction } from './live-build-recommendation-poller';
import { formatRecommendationSignal } from './live-build-desktop-table-ui';
import { formatRecommendationActionSignal } from './live-build-recommendation-ui';

describe('recommendation signal formatting', () => {
  it('shows V6 advantage instead of candidate-generator confidence', () => {
    const action = createAction({
      valueV6: {
        rankingModel: 'RECOMMENDATION_VALUE_V6',
        baselineRank: 3,
        modelRank: 1,
        actionUtility: 0.15,
        actionAdvantage: 0.0324,
        directSupportedActionKeyCount: 1,
        totalSupportedActionKeyCount: 4,
        supportType: 'DIRECT_ACTION',
      },
    });

    expect(formatRecommendationSignal(action)).toEqual({
      value: '+0.032',
      label: 'V6 advantage',
    });
    expect(formatRecommendationActionSignal(action)).toEqual({
      value: '+0.032',
      label: 'V6 advantage',
    });
  });

  it('labels generator probability as historical evidence', () => {
    const action = createAction({ confidencePercent: 7.5 });
    expect(formatRecommendationSignal(action)).toEqual({
      value: '7.5%',
      label: 'historical evidence',
    });
  });
});

function createAction(
  overrides: Partial<LiveBuildRecommendationAction> = {},
): LiveBuildRecommendationAction {
  return {
    type: 'BUY',
    itemId: 100,
    actionKey: 'BUY:100',
    label: 'Buy Item 100',
    confidencePercent: 5,
    historicalProbabilityPercent: 5,
    typicalGameTimeLabel: '3:00',
    explanation: {
      code: 'TEST',
      evidenceLevel: 'INFERRED',
      text: 'Test',
    },
    ...overrides,
  };
}
