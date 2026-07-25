import {
  createRecommendationValueV5Model,
  predictRecommendationValueV5,
  serializeRecommendationValueV5Model,
  updateRecommendationValueV5Model,
} from '../src/deadlock-live/recommendation-value-v5-model';

describe('recommendation value v5 support threshold', () => {
  it('uses raw observation support while preserving match-balanced estimation weights', () => {
    const model = createRecommendationValueV5Model();
    for (let index = 0; index < 20; index += 1) {
      updateRecommendationValueV5Model(
        model,
        {
          decisionId: `decision-${index}`,
          matchId: `match-${index}`,
          playerWon: index % 2 === 0,
          stateKeys: ['STATE:SUPPORTED'],
          actionKeys: ['ACTION:SUPPORTED'],
        },
        0.01,
      );
    }

    const prediction = predictRecommendationValueV5(
      model,
      { stateKeys: ['STATE:SUPPORTED'], actionKeys: ['ACTION:SUPPORTED'] },
      {
        statePriorStrength: 100,
        actionPriorStrength: 100,
        minimumEffectiveObservations: 20,
        maximumAbsoluteStateLogitResidual: 1.5,
        maximumAbsoluteActionLogitResidual: 1.5,
      },
      1,
    );

    const actionCount = model.action.get('ACTION:SUPPORTED');
    expect(actionCount?.observations).toBe(20);
    expect(actionCount?.wins).toBeCloseTo(0.1);
    expect(actionCount?.total).toBeCloseTo(0.2);
    expect(prediction.supportedStateKeyCount).toBe(1);
    expect(prediction.supportedActionKeyCount).toBe(1);
    expect(serializeRecommendationValueV5Model(model, 20)).toMatchObject({
      state: { 'STATE:SUPPORTED': { observations: 20 } },
      action: { 'ACTION:SUPPORTED': { observations: 20 } },
    });
  });
});
