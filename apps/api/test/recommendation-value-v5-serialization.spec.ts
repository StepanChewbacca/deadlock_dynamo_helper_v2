import {
  createRecommendationValueV5Model,
  serializeRecommendationValueV5Model,
  updateRecommendationValueV5Model,
} from '../src/deadlock-live/recommendation-value-v5-model';

describe('recommendation value v5 serialization', () => {
  it('excludes contexts below the minimum effective observation threshold', () => {
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

    const serialized = serializeRecommendationValueV5Model(model, 20) as {
      state: Record<string, { wins: number; total: number }>;
      action: Record<string, { wins: number; total: number }>;
    };

    expect(serialized.state).toEqual({
      'STATE:RARE': { wins: 20, total: 20 },
      'STATE:SUPPORTED': { wins: 20, total: 21 },
    });
    expect(serialized.action).toEqual({
      'ACTION:RARE': { wins: 20, total: 20 },
      'ACTION:SUPPORTED': { wins: 20, total: 21 },
    });

    expect(serializeRecommendationValueV5Model(model, 21)).toMatchObject({
      state: {
        'STATE:SUPPORTED': { wins: 20, total: 21 },
      },
      action: {
        'ACTION:SUPPORTED': { wins: 20, total: 21 },
      },
    });
  });
});
