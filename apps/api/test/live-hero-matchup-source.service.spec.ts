import { LiveHeroMatchupSourceService } from '../src/deadlock-live/live-hero-matchup-source.service';

describe('LiveHeroMatchupSourceService', () => {
  it('loads only requested hero item history while retaining the match roster', async () => {
    const requestedPlayer = {
      id: 10,
      matchId: 100,
      heroId: 72,
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
    };
    const enemyPlayer = {
      id: 11,
      matchId: 100,
      heroId: 35,
      team: 3,
      won: false,
      kills: 0,
      deaths: 1,
      assists: 0,
      netWorth: 4000,
    };
    const queryBuilder = createQueryBuilder([requestedPlayer]);
    const matchPlayerRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      find: jest.fn(async () => [requestedPlayer, enemyPlayer]),
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

    const service = new LiveHeroMatchupSourceService(
      matchPlayerRepository as any,
      matchPlayerItemRepository as any,
    );

    await service.ensureReady(6);

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'player.heroId IN (:...heroIds)',
      { heroIds: [6, 72] },
    );
    expect(matchPlayerRepository.find).toHaveBeenCalledTimes(1);
    expect(matchPlayerItemRepository.find).toHaveBeenCalledTimes(1);
    const matches = service.getMatches(72);
    expect(matches).toHaveLength(1);
    expect(matches[0].players).toEqual([
      expect.objectContaining({
        id: 10,
        heroId: 72,
        itemPurchases: [expect.objectContaining({ itemId: 1000 })],
      }),
      expect.objectContaining({
        id: 11,
        heroId: 35,
        itemPurchases: [],
      }),
    ]);
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
