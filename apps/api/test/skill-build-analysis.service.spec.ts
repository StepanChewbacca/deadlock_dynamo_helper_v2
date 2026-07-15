import { NotFoundException } from '@nestjs/common';
import type { Repository, SelectQueryBuilder } from 'typeorm';
import { MatchPlayerSkillUpgrade } from '../src/deadlock-live/entities/match-player-skill-upgrade.entity';
import { MatchPlayer } from '../src/deadlock-live/entities/match-player.entity';
import { SkillBuildAnalysisService } from '../src/deadlock-live/skill-build-analysis.service';

const STORED_UNKNOWN_SKILL = 0;
const STORED_SKILL_1 = 1;
const STORED_SKILL_2 = 2;
const STORED_SKILL_3 = 3;
const DYNAMO_ABILITY_1 = 3760705623;
const DYNAMO_ABILITY_2 = 2031714424;

function createPlayer(id: number, heroId = 11): MatchPlayer {
  return {
    id,
    matchId: id,
    heroId,
    match: { matchId: id, startTime: new Date() },
  } as MatchPlayer;
}

function createUpgrade(
  id: number,
  matchPlayerId: number,
  abilityId: number,
  upgradeOrder: number,
  upgradeTimeS?: number,
): MatchPlayerSkillUpgrade {
  return {
    id,
    matchPlayerId,
    abilityId,
    upgradeOrder,
    upgradeTimeS,
  } as MatchPlayerSkillUpgrade;
}

function createRepositories(
  players: MatchPlayer[],
  upgrades: MatchPlayerSkillUpgrade[],
): {
  matchPlayerRepository: Repository<MatchPlayer>;
  skillUpgradeRepository: Repository<MatchPlayerSkillUpgrade>;
  queryBuilder: SelectQueryBuilder<MatchPlayer>;
} {
  const queryBuilder = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(players),
  } as unknown as SelectQueryBuilder<MatchPlayer>;

  return {
    matchPlayerRepository: {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MatchPlayer>,
    skillUpgradeRepository: {
      find: jest.fn().mockResolvedValue(upgrades),
    } as unknown as Repository<MatchPlayerSkillUpgrade>,
    queryBuilder,
  };
}

function createService(
  players: MatchPlayer[],
  upgrades: MatchPlayerSkillUpgrade[],
): {
  service: SkillBuildAnalysisService;
  matchPlayerRepository: Repository<MatchPlayer>;
  skillUpgradeRepository: Repository<MatchPlayerSkillUpgrade>;
  queryBuilder: SelectQueryBuilder<MatchPlayer>;
} {
  const repositories = createRepositories(players, upgrades);
  return {
    service: new SkillBuildAnalysisService(
      repositories.matchPlayerRepository,
      repositories.skillUpgradeRepository,
    ),
    ...repositories,
  };
}

describe('SkillBuildAnalysisService', () => {
  it('builds a state-conditioned path and restores raw ability IDs', async () => {
    const players = [createPlayer(1), createPlayer(2), createPlayer(3)];
    const upgrades = [
      createUpgrade(1, 1, STORED_SKILL_1, 1, 10),
      createUpgrade(2, 1, STORED_SKILL_2, 2, 20),
      createUpgrade(3, 1, STORED_SKILL_1, 3, 30),
      createUpgrade(4, 2, STORED_SKILL_1, 1, 12),
      createUpgrade(5, 2, STORED_SKILL_2, 2, 22),
      createUpgrade(6, 2, STORED_SKILL_1, 3, 32),
      createUpgrade(7, 3, STORED_SKILL_2, 1),
      createUpgrade(8, 3, STORED_SKILL_3, 2),
    ];
    const { service, queryBuilder } = createService(players, upgrades);

    const result = await service.getHeroSkillBuild(11);

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'player.heroId = :heroId',
      { heroId: 11 },
    );
    expect(result.actions.map((action) => action.skillSlot)).toEqual([1, 2, 1]);
    expect(result.actions.map((action) => action.abilityId)).toEqual([
      DYNAMO_ABILITY_1,
      DYNAMO_ABILITY_2,
      DYNAMO_ABILITY_1,
    ]);
    expect(result.actions.map((action) => action.cumulativePointCost)).toEqual([1, 2, 3]);
    expect(result.nextAction).toEqual(result.actions[0]);
    expect(result.currentLevels).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
    expect(result.currentPointCost).toBe(0);
    expect(result.abilityIdsBySlot).toMatchObject({
      1: DYNAMO_ABILITY_1,
      2: DYNAMO_ABILITY_2,
    });
    expect(result.sourcePlayerCount).toBe(3);
    expect(result.validPlayerCount).toBe(3);
  });

  it('recommends the next action from the current live levels', async () => {
    const { service } = createService(
      [createPlayer(1)],
      [
        createUpgrade(1, 1, STORED_SKILL_1, 1),
        createUpgrade(2, 1, STORED_SKILL_2, 2),
        createUpgrade(3, 1, STORED_SKILL_1, 3),
      ],
    );

    const result = await service.getHeroSkillBuild(11, {
      currentLevels: { 1: 1, 2: 0, 3: 0, 4: 0 },
    });

    expect(result.currentPointCost).toBe(1);
    expect(result.nextAction).toMatchObject({
      skillSlot: 2,
      type: 'UNLOCK',
      fromLevel: 0,
      toLevel: 1,
      cumulativePointCost: 2,
    });
    expect(result.actions.map((action) => action.skillSlot)).toEqual([2, 1]);
  });

  it('uses a valid prefix and reports the persisted unknown skill marker', async () => {
    const { service } = createService(
      [createPlayer(1)],
      [
        createUpgrade(1, 1, STORED_SKILL_1, 1),
        createUpgrade(2, 1, STORED_UNKNOWN_SKILL, 2),
      ],
    );

    const result = await service.getHeroSkillBuild(11);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.abilityId).toBe(DYNAMO_ABILITY_1);
    expect(result.validPlayerCount).toBe(0);
    expect(result.partialPlayerCount).toBe(1);
    expect(result.diagnostics).toEqual([{ code: 'UNKNOWN_ABILITY', count: 1 }]);
  });

  it('respects the requested point budget', async () => {
    const { service } = createService(
      [createPlayer(1)],
      [
        createUpgrade(1, 1, STORED_SKILL_1, 1),
        createUpgrade(2, 1, STORED_SKILL_1, 2),
        createUpgrade(3, 1, STORED_SKILL_1, 3),
        createUpgrade(4, 1, STORED_SKILL_1, 4),
      ],
    );

    const result = await service.getHeroSkillBuild(11, { maxPointBudget: 4 });

    expect(result.actions).toHaveLength(3);
    expect(result.totalPointCost).toBe(4);
  });

  it('caches the hero graph for repeated live state requests', async () => {
    const { service, matchPlayerRepository, skillUpgradeRepository } = createService(
      [createPlayer(1)],
      [createUpgrade(1, 1, STORED_SKILL_1, 1)],
    );

    await service.getHeroSkillBuild(11);
    await service.getHeroSkillBuild(11, {
      currentLevels: { 1: 1, 2: 0, 3: 0, 4: 0 },
    });

    expect(matchPlayerRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(skillUpgradeRepository.find).toHaveBeenCalledTimes(1);
  });

  it('does not query aliases or players from other heroes', async () => {
    const { service, queryBuilder } = createService(
      [createPlayer(1)],
      [createUpgrade(1, 1, STORED_SKILL_1, 1)],
    );

    await service.getHeroSkillBuild(11);

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'player.heroId = :heroId',
      { heroId: 11 },
    );
    expect(queryBuilder.where).not.toHaveBeenCalledWith(
      expect.stringContaining('IN'),
      expect.anything(),
    );
  });

  it('throws when the hero has no ability mapping', async () => {
    const { service, matchPlayerRepository } = createService([], []);

    await expect(service.getHeroSkillBuild(999)).rejects.toBeInstanceOf(NotFoundException);
    expect(matchPlayerRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('throws when no recent player exists for the exact hero', async () => {
    const { service } = createService([], []);

    await expect(service.getHeroSkillBuild(11)).rejects.toBeInstanceOf(NotFoundException);
  });
});
