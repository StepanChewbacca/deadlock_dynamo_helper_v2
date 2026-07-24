import { selectRecommendationOfflineThreeWaySplit } from '../src/deadlock-live/recommendation-offline-split';
import {
  buildRecommendationValueV5MatchBalancedRows,
  evaluateRecommendationValueV5,
  predictRecommendationValueV5,
  sumRecommendationValueV5WeightsByMatch,
  trainRecommendationValueV5Model,
  tuneRecommendationValueV5ActionResidualScale,
  type RecommendationValueV5ModelOptions,
  type RecommendationValueV5SourceRow,
} from '../src/deadlock-live/recommendation-value-v5-model';

const options: RecommendationValueV5ModelOptions = {
  statePriorStrength: 2,
  actionPriorStrength: 2,
  minimumEffectiveObservations: 1,
  maximumAbsoluteStateLogitResidual: 2,
  maximumAbsoluteActionLogitResidual: 2,
};

describe('Recommendation offline three-way split', () => {
  it('creates deterministic chronological train, tuning, and untouched test splits', () => {
    const descriptors = Array.from({ length: 10 }, (_, index) => ({
      matchId: String(10 - index),
      firstObservedAt: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
    }));
    const split = selectRecommendationOfflineThreeWaySplit(descriptors, {
      trainFraction: 0.7,
      tuningFraction: 0.15,
    });

    expect(split.train).toHaveLength(7);
    expect(split.tuning).toHaveLength(1);
    expect(split.test).toHaveLength(2);
    expect(split.train[0].matchId).toBe('10');
    expect(split.test.at(-1)?.matchId).toBe('1');
    expect(split.descriptorSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      new Set([
        ...split.train.map((value) => value.matchId),
        ...split.tuning.map((value) => value.matchId),
        ...split.test.map((value) => value.matchId),
      ]).size,
    ).toBe(10);
  });

  it('rejects invalid split fractions', () => {
    const descriptors = [
      { matchId: '1', firstObservedAt: '2026-07-01T00:00:00.000Z' },
      { matchId: '2', firstObservedAt: '2026-07-02T00:00:00.000Z' },
      { matchId: '3', firstObservedAt: '2026-07-03T00:00:00.000Z' },
    ];
    expect(() =>
      selectRecommendationOfflineThreeWaySplit(descriptors, {
        trainFraction: 0.8,
        tuningFraction: 0.2,
      }),
    ).toThrow('must be less than one');
  });
});

describe('Recommendation Value V5 model core', () => {
  it('gives every match the same total training weight', () => {
    const weighted = buildRecommendationValueV5MatchBalancedRows([
      row('a-1', 'a', true, 'BUY:1'),
      row('a-2', 'a', true, 'BUY:2'),
      row('a-3', 'a', true, 'BUY:3'),
      row('b-1', 'b', false, 'BUY:1'),
    ]);
    const weights = sumRecommendationValueV5WeightsByMatch(weighted);

    expect(weights.get('a')).toBeCloseTo(1);
    expect(weights.get('b')).toBeCloseTo(1);
    expect(weighted.find((value) => value.decisionId === 'a-1')?.matchWeight).toBeCloseTo(
      1 / 3,
    );
  });

  it('separates state probability from the action residual', () => {
    const training = buildRecommendationValueV5MatchBalancedRows([
      ...Array.from({ length: 8 }, (_, index) =>
        row(`win-${index}`, `win-${index}`, true, 'BUY:WIN'),
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        row(`lose-${index}`, `lose-${index}`, false, 'BUY:LOSE'),
      ),
    ]);
    const model = trainRecommendationValueV5Model(training);
    const winning = predictRecommendationValueV5(
      model,
      row('probe-win', 'probe-win', true, 'BUY:WIN'),
      options,
      1,
    );
    const losing = predictRecommendationValueV5(
      model,
      row('probe-lose', 'probe-lose', false, 'BUY:LOSE'),
      options,
      1,
    );

    expect(winning.stateProbability).toBeCloseTo(losing.stateProbability);
    expect(winning.actionProbability).toBeGreaterThan(winning.stateProbability);
    expect(losing.actionProbability).toBeLessThan(losing.stateProbability);
    expect(winning.supportedActionKeyCount).toBe(1);
  });

  it('selects the action residual scale only from tuning rows', () => {
    const training = buildRecommendationValueV5MatchBalancedRows([
      ...Array.from({ length: 10 }, (_, index) =>
        row(`train-win-${index}`, `train-win-${index}`, true, 'BUY:WIN'),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        row(`train-lose-${index}`, `train-lose-${index}`, false, 'BUY:LOSE'),
      ),
    ]);
    const tuning = buildRecommendationValueV5MatchBalancedRows([
      ...Array.from({ length: 4 }, (_, index) =>
        row(`tune-win-${index}`, `tune-win-${index}`, true, 'BUY:WIN'),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        row(`tune-lose-${index}`, `tune-lose-${index}`, false, 'BUY:LOSE'),
      ),
    ]);
    const model = trainRecommendationValueV5Model(training);
    const selection = tuneRecommendationValueV5ActionResidualScale(
      model,
      tuning,
      options,
      [0, 0.5, 1],
    );
    const stateOnly = evaluateRecommendationValueV5(model, tuning, options, 0);
    const selected = evaluateRecommendationValueV5(
      model,
      tuning,
      options,
      selection.actionResidualScale,
    );

    expect(selection.actionResidualScale).toBeGreaterThan(0);
    expect(selected.logLoss).toBeLessThan(stateOnly.logLoss);
    expect(selected.totalWeight).toBeCloseTo(8);
  });

  it('rejects duplicate decision IDs before weighting', () => {
    expect(() =>
      buildRecommendationValueV5MatchBalancedRows([
        row('duplicate', 'a', true, 'BUY:1'),
        row('duplicate', 'b', false, 'BUY:2'),
      ]),
    ).toThrow('Duplicate Value V5 decision ID');
  });
});

function row(
  decisionId: string,
  matchId: string,
  playerWon: boolean,
  actionKey: string,
): RecommendationValueV5SourceRow {
  return {
    decisionId,
    matchId,
    playerWon,
    stateKeys: ['STATE:COMMON'],
    actionKeys: [`ACTION:${actionKey}`],
  };
}
