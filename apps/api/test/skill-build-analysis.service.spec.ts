import { NotFoundException } from '@nestjs/common';
import { SkillBuildAnalysisService } from '../src/deadlock-live/skill-build-analysis.service';
import type {
  RecentMatchPlayerSnapshot,
  RecentMatchesWindowService,
} from '../src/deadlock-live/recent-matches-window.service';

const STORED_UNKNOWN_SKILL = 0;
const STORED_SKILL_1 = 1;
const STORED_SKILL_2 = 2;
const STORED_SKILL_3 = 3;
const DYNAMO_ABILITY_1 = 3760705623;
const DYNAMO_ABILITY_2 = 2031714424;
const WINDOW_REFRESHED_AT = new Date('2026-07-15T12:00:00.000Z');

function createPlayer(
  id: number,
  skillUpgrades: RecentMatchPlayerSnapshot['skillUpgrades'],
  heroId = 11,
): RecentMatchPlayerSnapshot {
  return {
    id,
    matchId: id,
    heroId,
    team: 0,
    won: true,
    kills: 0,
    deaths: 0,
    assists: 0,
    netWorth: 0,
    itemPurchases: [],
    skillUpgrades,
  };
}

function createWindowService(
  players: RecentMatchPlayerSnapshot[],
  lastRefreshedAt: Date | undefined = WINDOW_REFRESHED_AT,
): RecentMatchesWindowService {
  return {
    getStatus: jest.fn().mockReturnValue({ lastRefreshedAt }),
    refresh: jest.fn().mockResolvedValue({ lastRefreshedAt: WINDOW_REFRESHED_AT }),
    getPlayersByHeroIds: jest.fn().mockReturnValue(players),
  } as unknown as RecentMatchesWindowService;
}

describe('SkillBuildAnalysisService', () => {
  it('builds a state-conditioned path and restores raw ability IDs', async () => {
    const players = [
      createPlayer(1, [
        { id: 1, abilityId: STORED_SKILL_1, upgradeOrder: 1, upgradeTimeS: 10 },
        { id: 2, abilityId: STORED_SKILL_2, upgradeOrder: 2, upgradeTimeS: 20 },
        { id: 3, abilityId: STORED_SKILL_1, upgradeOrder: 3, upgradeTimeS: 30 },
      ]),
      createPlayer(2, [
        { id: 4, abilityId: STORED_SKILL_1, upgradeOrder: 1, upgradeTimeS: 12 },
        { id: 5, abilityId: STORED_SKILL_2, upgradeOrder: 2, upgradeTimeS: 22 },
        { id: 6, abilityId: STORED_SKILL_1, upgradeOrder: 3, upgradeTimeS: 32 },
      ]),
      createPlayer(3, [
        { id: 7, abilityId: STORED_SKILL_2, upgradeOrder: 1 },
        { id: 8, abilityId: STORED_SKILL_3, upgradeOrder: 2 },
      ]),
    ];
    const recentMatchesWindowService = createWindowService(players);
    const service = new SkillBuildAnalysisService(recentMatchesWindowService);

    const result = await service.getHeroSkillBuild(11);

    expect(recentMatchesWindowService.getPlayersByHeroIds).toHaveBeenCalledWith([11]);
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
    expect(result.partialPlayerCount).toBe(0);
    expect(result.rejectedPlayerCount).toBe(0);
  });

  it('recommends the next action from the current live levels', async () => {
    const players = [
      createPlayer(1, [
        { id: 1, abilityId: STORED_SKILL_1, upgradeOrder: 1 },
        { id: 2, abilityId: STORED_SKILL_2, upgradeOrder: 2 },
        { id: 3, abilityId: STORED_SKILL_1, upgradeOrder: 3 },
      ]),
    ];
    const service = new SkillBuildAnalysisService(createWindowService(players));

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
    const player = createPlayer(1, [
      { id: 1, abilityId: STORED_SKILL_1, upgradeOrder: 1 },
      { id: 2, abilityId: STORED_UNKNOWN_SKILL, upgradeOrder: 2 },
    ]);
    const service = new SkillBuildAnalysisService(createWindowService([player]));

    const result = await service.getHeroSkillBuild(11);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.abilityId).toBe(DYNAMO_ABILITY_1);
    expect(result.validPlayerCount).toBe(0);
    expect(result.partialPlayerCount).toBe(1);
    expect(result.diagnostics).toEqual([{ code: 'UNKNOWN_ABILITY', count: 1 }]);
  });

  it('respects the requested point budget', async () => {
    const player = createPlayer(1, [
      { id: 1, abilityId: STORED_SKILL_1, upgradeOrder: 1 },
      { id: 2, abilityId: STORED_SKILL_1, upgradeOrder: 2 },
      { id: 3, abilityId: STORED_SKILL_1, upgradeOrder: 3 },
      { id: 4, abilityId: STORED_SKILL_1, upgradeOrder: 4 },
    ]);
    const service = new SkillBuildAnalysisService(createWindowService([player]));

    const result = await service.getHeroSkillBuild(11, { maxPointBudget: 4 });

    expect(result.actions).toHaveLength(3);
    expect(result.totalPointCost).toBe(4);
  });

  it('caches the hero graph until the recent window refresh version changes', async () => {
    const recentMatchesWindowService = createWindowService([
      createPlayer(1, [{ id: 1, abilityId: STORED_SKILL_1, upgradeOrder: 1 }]),
    ]);
    const service = new SkillBuildAnalysisService(recentMatchesWindowService);

    await service.getHeroSkillBuild(11);
    await service.getHeroSkillBuild(11, {
      currentLevels: { 1: 1, 2: 0, 3: 0, 4: 0 },
    });

    expect(recentMatchesWindowService.getPlayersByHeroIds).toHaveBeenCalledTimes(1);
  });

  it('loads the lazy recent window before building the graph', async () => {
    const recentMatchesWindowService = createWindowService(
      [createPlayer(1, [{ id: 1, abilityId: STORED_SKILL_1, upgradeOrder: 1 }])],
      undefined,
    );
    (recentMatchesWindowService.getStatus as jest.Mock)
      .mockReturnValueOnce({ lastRefreshedAt: undefined })
      .mockReturnValue({ lastRefreshedAt: WINDOW_REFRESHED_AT });
    const service = new SkillBuildAnalysisService(recentMatchesWindowService);

    await service.getHeroSkillBuild(11);

    expect(recentMatchesWindowService.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not merge matches from another hero through legacy aliases', async () => {
    const recentMatchesWindowService = createWindowService([
      createPlayer(1, [{ id: 1, abilityId: STORED_SKILL_1, upgradeOrder: 1 }]),
    ]);
    const service = new SkillBuildAnalysisService(recentMatchesWindowService);

    await service.getHeroSkillBuild(11);

    expect(recentMatchesWindowService.getPlayersByHeroIds).toHaveBeenCalledWith([11]);
  });

  it('throws when the hero has no ability mapping', async () => {
    const recentMatchesWindowService = createWindowService([]);
    const service = new SkillBuildAnalysisService(recentMatchesWindowService);

    await expect(service.getHeroSkillBuild(999)).rejects.toBeInstanceOf(NotFoundException);
    expect(recentMatchesWindowService.getPlayersByHeroIds).not.toHaveBeenCalled();
  });

  it('throws when the recent window contains no players for the hero', async () => {
    const service = new SkillBuildAnalysisService(createWindowService([]));

    await expect(service.getHeroSkillBuild(11)).rejects.toBeInstanceOf(NotFoundException);
  });
});
