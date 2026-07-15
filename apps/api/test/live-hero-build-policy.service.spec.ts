import { LiveHeroBuildPolicyService } from '../src/deadlock-live/live-hero-build-policy.service';

describe('LiveHeroBuildPolicyService', () => {
  it('builds Victor policy from exact Valve hero id without Yamato matches', async () => {
    const queryBuilder = createQueryBuilder([
      {
        id: 10,
        matchId: 100,
        heroId: 66,
        team: 2,
        won: true,
        kills: 1,
        deaths: 0,
        assists: 2,
        netWorth: 5000,
        match: {
          matchId: 100,
          startTime: new Date(),
          durationS: 1800,
          averageBadge: 50,
          winningTeam: 2,
        },
      },
    ]);
    const matchPlayerRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    const matchPlayerItemRepository = {
      find: jest.fn(async () => [
        {
          id: 20,
          matchPlayerId: 10,
          itemId: 1000,
          purchaseTimeS: 60,
          soldTimeS: undefined,
          upgradeId: undefined,
          flags: undefined,
          imbuedAbilityId: undefined,
          upgradeInfo: undefined,
          slotOrder: 1,
        },
      ]),
    };
    const normalizeMatch = jest.fn(() => ({ players: [{ playerId: 10 }] }));
    const replayMatch = jest.fn(() => ({ players: [{ playerId: 10 }] }));
    const canonicalizeMatch = jest.fn(() => ({
      players: [
        {
          matchId: 100,
          playerId: 10,
          heroId: 66,
          sourceActionCount: 1,
          canonicalStepCount: 1,
          ignoredActionCount: 0,
          replayDiagnosticCount: 0,
          initialStateKey: 'EMPTY',
          finalStateKey: '1000x1',
          actionSequenceKey: 'BUY:1000',
          sequenceKey: 'EMPTY>BUY:1000>1000x1',
          steps: [
            {
              sequence: 1,
              sourceSequence: 1,
              gameTimeS: 60,
              actionType: 'BUY',
              itemId: 1000,
              actionKey: 'BUY:1000',
              beforeStateKey: 'EMPTY',
              afterStateKey: '1000x1',
              transitionKey: 'EMPTY>BUY:1000>1000x1',
            },
          ],
        },
      ],
    }));

    const service = new LiveHeroBuildPolicyService(
      matchPlayerRepository as any,
      matchPlayerItemRepository as any,
      { normalizeMatch } as any,
      { replayMatch } as any,
      { canonicalizeMatch } as any,
      { refreshRecipes: jest.fn(async () => undefined) } as any,
    );

    await service.ensureReady(27);

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'player.heroId = :heroId',
      { heroId: 66 },
    );
    expect(matchPlayerItemRepository.find).toHaveBeenCalledTimes(1);
    expect(normalizeMatch).toHaveBeenCalledTimes(1);
    expect(replayMatch).toHaveBeenCalledTimes(1);
    expect(canonicalizeMatch).toHaveBeenCalledTimes(1);
    expect(service.getHeroPolicy(27)?.statesByKey.get('EMPTY')?.nextActions[0]).toMatchObject({
      actionKey: 'BUY:1000',
      count: 1,
    });
  });

  it('does not remap Abrams item history to Billy', async () => {
    const queryBuilder = createQueryBuilder([]);
    const service = new LiveHeroBuildPolicyService(
      { createQueryBuilder: jest.fn(() => queryBuilder) } as any,
      { find: jest.fn(async () => []) } as any,
      { normalizeMatch: jest.fn() } as any,
      { replayMatch: jest.fn() } as any,
      { canonicalizeMatch: jest.fn() } as any,
      { refreshRecipes: jest.fn(async () => undefined) } as any,
    );

    await service.ensureReady(6);

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'player.heroId = :heroId',
      { heroId: 6 },
    );
  });
});

function createQueryBuilder(result: unknown[]) {
  const queryBuilder: any = {
    innerJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    take: jest.fn(),
    getMany: jest.fn(async () => result),
  };
  for (const method of [
    'innerJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'take',
  ]) {
    queryBuilder[method].mockReturnValue(queryBuilder);
  }
  return queryBuilder;
}
