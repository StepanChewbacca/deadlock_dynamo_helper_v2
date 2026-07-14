import { SituationalRecommendationDiagnosticsService } from '../src/deadlock-live/situational-recommendation-diagnostics.service';

describe('SituationalRecommendationDiagnosticsService', () => {
  it('returns a reproducible state that triggers a promoted situational warning', async () => {
    const transitionAggregation = {
      ensureReady: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockReturnValue({ actionOptionCount: 1 }),
      getHeroPolicy: jest.fn((heroId: number) =>
        heroId === 1
          ? {
              statesByKey: new Map([
                [
                  'EMPTY',
                  {
                    stateKey: 'EMPTY',
                    observationCount: 100,
                    nextActions: [
                      {
                        actionType: 'BUY',
                        itemId: 100,
                        actionKey: 'BUY:100',
                        count: 40,
                        probability: 0.4,
                        averageGameTimeS: 321,
                        afterStates: [],
                      },
                    ],
                  },
                ],
              ]),
            }
          : undefined,
      ),
    };
    const matchupStatistics = {
      evaluate: jest.fn().mockResolvedValue({
        evidence: [
          {
            enemyHeroId: 2,
            matchupObservationCount: 80,
            actionMatchupObservationCount: 30,
            otherActionMatchupObservationCount: 50,
            actionWinRateAgainst: 0.7,
            otherActionsWinRateAgainst: 0.5,
            actionWinRateWithoutEnemy: 0.5,
            otherActionsWinRateWithoutEnemy: 0.5,
            interactionLogOddsRatio: Math.log(2),
            interactionOddsRatio: 2,
            standardError: 0.1,
            lower95InteractionLogOddsRatio: Math.log(1.5),
            upper95InteractionLogOddsRatio: Math.log(2.5),
            lower95InteractionOddsRatio: 1.5,
            upper95InteractionOddsRatio: 2.5,
          },
        ],
      }),
    };
    const recommendation = {
      recommend: jest.fn().mockResolvedValue({
        evaluatedCandidateCount: 12,
        situationalCandidateCount: 2,
        promotedSituationalCandidateCount: 1,
        insertedSituationalCandidateCount: 1,
        action: {
          type: 'BUY',
          itemId: 100,
          actionKey: 'BUY:100',
          baseRank: 3,
          contextualRank: 1,
          wasInBaseBuild: false,
          isSituational: true,
          wasPromotedByMatchup: true,
          wasInsertedByMatchup: true,
          situationalLower95OddsRatio: 1.5,
          situationalInteractionOddsRatio: 2,
          matchupObservationCount: 80,
        },
        alternatives: [],
      }),
    };
    const recentMatchesWindow = {
      getMatches: jest.fn().mockReturnValue([
        {
          players: [
            { heroId: 1 },
            { heroId: 2 },
          ],
        },
      ]),
    };
    const service = new SituationalRecommendationDiagnosticsService(
      transitionAggregation as any,
      matchupStatistics as any,
      recommendation as any,
      recentMatchesWindow as any,
    );

    const result = await service.findExamples({ limit: 5 });

    expect(result.rawPositiveSignalCount).toBe(1);
    expect(result.warningExampleCount).toBe(1);
    expect(result.examples).toHaveLength(1);
    expect(result.examples[0]).toMatchObject({
      heroId: 1,
      enemyHeroId: 2,
      stateKey: 'EMPTY',
      itemIds: [],
      gameTimeS: 321,
      itemId: 100,
      wasPromotedByMatchup: true,
      wasInsertedByMatchup: true,
      isPrimaryRecommendation: true,
      wouldTriggerWarning: true,
    });
    expect(recommendation.recommend).toHaveBeenCalledWith({
      heroId: 1,
      itemIds: [],
      gameTimeS: 321,
      enemyHeroIds: [2],
      limit: 20,
    });
  });
});
