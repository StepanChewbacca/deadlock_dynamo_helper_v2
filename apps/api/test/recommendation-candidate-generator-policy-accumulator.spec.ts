import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import { RecommendationCandidateGeneratorPolicyAccumulator } from '../src/deadlock-live/recommendation-candidate-generator-policy-accumulator';

function decision(input: {
  decisionId: string;
  matchId: number;
  playerId: number;
  actionKey: string;
  itemId: number;
  afterStateKey: string;
  gameTimeS: number;
}): HeroBuildDecisionDatasetV3Row {
  return {
    schemaVersion: 1,
    decisionId: input.decisionId,
    matchId: input.matchId,
    matchStartTime: '2026-07-10T12:00:00.000Z',
    playerId: input.playerId,
    heroId: 1,
    team: 0,
    gameTimeS: input.gameTimeS,
    phase: 'EARLY',
    inventoryBeforeStateKey: '1001x1',
    inventoryAfterStateKey: input.afterStateKey,
    previousActionKeys: ['BUY:1001'],
    buildPrefixKey: 'BUY:1001',
    alliedHeroIds: [1, 2, 3, 4, 5, 6],
    enemyHeroIds: [7, 8, 9, 10, 11, 12],
    actualActionType: 'BUY',
    actualItemId: input.itemId,
    actualActionKey: input.actionKey,
    outcomeLabel: { playerWon: true },
  };
}

describe('Recommendation candidate generator policy accumulator', () => {
  it('builds deterministic probabilities and average action times', () => {
    const accumulator = new RecommendationCandidateGeneratorPolicyAccumulator();
    accumulator.observe(
      decision({
        decisionId: 'decision-1',
        matchId: 1,
        playerId: 10,
        actionKey: 'BUY:1002',
        itemId: 1002,
        afterStateKey: '1001x1|1002x1',
        gameTimeS: 300,
      }),
    );
    accumulator.observe(
      decision({
        decisionId: 'decision-2',
        matchId: 2,
        playerId: 20,
        actionKey: 'BUY:1002',
        itemId: 1002,
        afterStateKey: '1001x1|1002x1',
        gameTimeS: 340,
      }),
    );
    accumulator.observe(
      decision({
        decisionId: 'decision-3',
        matchId: 3,
        playerId: 30,
        actionKey: 'BUY:1003',
        itemId: 1003,
        afterStateKey: '1001x1|1003x1',
        gameTimeS: 360,
      }),
    );

    const result = accumulator.build();

    expect(result.summary).toEqual({
      rowCount: 3,
      heroCount: 1,
      playerCount: 3,
      stateCount: 1,
      transitionCount: 3,
      actionOptionCount: 2,
    });
    expect(result.policies[0]).toMatchObject({
      heroId: 1,
      playerCount: 3,
      stateCount: 1,
      transitionCount: 3,
    });
    expect(result.policies[0].states[0].nextActions).toEqual([
      expect.objectContaining({
        actionKey: 'BUY:1002',
        count: 2,
        probability: 2 / 3,
        averageGameTimeS: 320,
      }),
      expect.objectContaining({
        actionKey: 'BUY:1003',
        count: 1,
        probability: 1 / 3,
        averageGameTimeS: 360,
      }),
    ]);
  });

  it('rejects conflicting metadata for one action key', () => {
    const accumulator = new RecommendationCandidateGeneratorPolicyAccumulator();
    accumulator.observe(
      decision({
        decisionId: 'decision-1',
        matchId: 1,
        playerId: 10,
        actionKey: 'BUY:1002',
        itemId: 1002,
        afterStateKey: '1001x1|1002x1',
        gameTimeS: 300,
      }),
    );

    expect(() =>
      accumulator.observe(
        decision({
          decisionId: 'decision-2',
          matchId: 2,
          playerId: 20,
          actionKey: 'BUY:1002',
          itemId: 9999,
          afterStateKey: '1001x1|9999x1',
          gameTimeS: 320,
        }),
      ),
    ).toThrow('conflicting action metadata');
  });
});
