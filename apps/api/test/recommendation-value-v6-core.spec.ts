import {
  createRecommendationValueV6MetricsAccumulator,
  createRecommendationValueV6Model,
  finalizeRecommendationValueV6Metrics,
  observeRecommendationValueV6Prediction,
  predictRecommendationValueV6,
  updateRecommendationValueV6Model,
  type RecommendationValueV6ModelOptions,
  type RecommendationValueV6SourceRow,
} from '../src/deadlock-live/recommendation-value-v6-model';

const options: RecommendationValueV6ModelOptions = {
  statePriorStrength: 0,
  actionPriorStrength: 0,
  minimumObservations: 1,
  maximumAbsoluteStateResidual: 1,
  maximumAbsoluteActionResidual: 1,
};

describe('Recommendation Value V6 model', () => {
  it('ranks an action with stronger observed utility above a weaker action', () => {
    const model = createRecommendationValueV6Model();
    for (let index = 0; index < 4; index += 1) {
      updateRecommendationValueV6Model(
        model,
        sourceRow(`good-${index}`, 'BUY:1', 0.8, true),
        0.25,
      );
      updateRecommendationValueV6Model(
        model,
        sourceRow(`bad-${index}`, 'BUY:2', -0.6, false),
        0.25,
      );
    }

    const good = predictRecommendationValueV6(
      model,
      { stateKeys: ['HERO:1'], actionKeys: ['ACTION:BUY:1'] },
      options,
      1,
    );
    const bad = predictRecommendationValueV6(
      model,
      { stateKeys: ['HERO:1'], actionKeys: ['ACTION:BUY:2'] },
      options,
      1,
    );

    expect(good.actionAdvantage).toBeGreaterThan(bad.actionAdvantage);
    expect(good.actionUtility).toBeGreaterThan(bad.actionUtility);
    expect(good.actionWinProbability).toBeGreaterThan(
      bad.actionWinProbability,
    );
  });

  it('reports observed-action top-k ranking diagnostics', () => {
    const model = createRecommendationValueV6Model();
    const row = sourceRow('decision', 'BUY:1', 0.5, true);
    updateRecommendationValueV6Model(model, row, 1);
    updateRecommendationValueV6Model(
      model,
      sourceRow('other', 'BUY:2', -0.5, false),
      1,
    );
    const observed = predictRecommendationValueV6(model, row, options, 1);
    const candidates = row.candidateActions.map((candidate) => ({
      actionKey: candidate.actionKey,
      prediction: predictRecommendationValueV6(
        model,
        { stateKeys: row.stateKeys, actionKeys: candidate.actionKeys },
        options,
        1,
      ),
    }));
    const accumulator = createRecommendationValueV6MetricsAccumulator();
    observeRecommendationValueV6Prediction(
      accumulator,
      row,
      observed,
      candidates,
      1,
    );
    const metrics = finalizeRecommendationValueV6Metrics(accumulator);

    expect(metrics.observedActionTop1Agreement).toBe(1);
    expect(metrics.observedActionTop3Agreement).toBe(1);
    expect(metrics.observedActionMeanReciprocalRank).toBe(1);
    expect(metrics.actionSupportCoverage).toBe(1);
  });
});

function sourceRow(
  decisionId: string,
  observedActionKey: string,
  targetUtility: number,
  playerWon: boolean,
): RecommendationValueV6SourceRow {
  return {
    decisionId,
    matchId: decisionId,
    heroId: 1,
    playerWon,
    targetUtility,
    targetComponents: {
      finalOutcome: playerWon ? 1 : -1,
      shortHorizonUtility: targetUtility,
      shortHorizonCount: 1,
    },
    stateKeys: ['HERO:1'],
    actionKeys: [`ACTION:${observedActionKey}`],
    observedActionKey,
    candidateActions: [
      { actionKey: 'BUY:1', actionKeys: ['ACTION:BUY:1'] },
      { actionKey: 'BUY:2', actionKeys: ['ACTION:BUY:2'] },
    ],
  };
}
