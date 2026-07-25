import {
  createRecommendationValueV5Model,
  serializeRecommendationValueV5Model,
  updateRecommendationValueV5Model,
} from '../src/deadlock-live/recommendation-value-v5-model';

describe('recommendation value v5 serialization', () => {
  it('filters contexts by raw observation support instead of weighted mass', () => {
    const model = createRecommendationValueV5Model();

    updateRecommendationValueV5Model(
      model,
      {
        decisionId: 'supported-1',
        matchId: 'match-1',
        playerWon: true,
        stateKeys: ['STATE:SUPPORTED', 'STATE:RARE'],
        actionKeys: ['ACTION:SUPPORTED', 'ACTION:RARE'],
      },
      20,
    );
    updateRecommendationValueV5Model(
      model,
      {
        decisionId: 'supported-2',
        matchId: 'match-2',
        playerWon: false,
        stateKeys: ['STATE:SUPPORTED'],
        actionKeys: ['ACTION:SUPPORTED'],
      },
      1,
    );

    const serialized = serializeRecommendationValueV5Model(model, 1) as {
      state: Record<string, { wins: number; total: number; observations: number }>;
      action: Record<string, { wins: number; total: number; observations: number }>;
    };

    expect(serialized.state).toEqual({
      'STATE:RARE': { wins: 20, total: 20, observations: 1 },
      'STATE:SUPPORTED': { wins: 20, total: 21, observations: 2 },
    });
    expect(serialized.action).toEqual({
      'ACTION:RARE': { wins: 20, total: 20, observations: 1 },
      'ACTION:SUPPORTED': { wins: 20, total: 21, observations: 2 },
    });

    expect(serializeRecommendationValueV5Model(model, 2)).toMatchObject({
      state: {
        'STATE:SUPPORTED': { wins: 20, total: 21, observations: 2 },
      },
      action: {
        'ACTION:SUPPORTED': { wins: 20, total: 21, observations: 2 },
      },
    });
  });
});
