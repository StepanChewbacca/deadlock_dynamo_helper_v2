import { NotFoundException } from '@nestjs/common';
import { SkillBuildAnalysisService } from '../src/deadlock-live/skill-build-analysis.service';
import type {
  RecentMatchPlayerSnapshot,
  RecentMatchesWindowService,
} from '../src/deadlock-live/recent-matches-window.service';

const STORED_SKILL_1 = 1;
const STORED_SKILL_2 = 2;
const STORED_SKILL_3 = 3;

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

describe('SkillBuildAnalysisService', () => {
  it('builds a state-conditioned skill path from persisted skill slot identifiers', () => {
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
    const recentMatchesWindowService = {
      getPlayersByHeroIds: jest.fn().mockReturnValue(players),
    } as unknown as RecentMatchesWindowService;
    const service = new SkillBuildAnalysisService(recentMatchesWindowService);

    const result = service.getHeroSkillBuild(11);

    expect(recentMatchesWindowService.getPlayersByHeroIds).toHaveBeenCalledWith([11]);
    expect(result.actions.map((action) => action.skillSlot)).toEqual([1, 2, 1]);
    expect(result.actions.map((action) => action.cumulativePointCost)).toEqual([1, 2, 3]);
    expect(result.sourcePlayerCount).toBe(3);
    expect(result.validPlayerCount).toBe(3);
    expect(result.partialPlayerCount).toBe(0);
    expect(result.rejectedPlayerCount).toBe(0);
  });

  it('uses a valid prefix and reports diagnostics for a damaged sequence', () => {
    const player = createPlayer(1, [
      { id: 1, abilityId: STORED_SKILL_1, upgradeOrder: 1 },
      { id: 2, abilityId: 999, upgradeOrder: 2 },
    ]);
    const recentMatchesWindowService = {
      getPlayersByHeroIds: jest.fn().mockReturnValue([player]),
    } as unknown as RecentMatchesWindowService;
    const service = new SkillBuildAnalysisService(recentMatchesWindowService);

    const result = service.getHeroSkillBuild(11);

    expect(result.actions).toHaveLength(1);
    expect(result.validPlayerCount).toBe(0);
    expect(result.partialPlayerCount).toBe(1);
    expect(result.diagnostics).toEqual([{ code: 'UNKNOWN_ABILITY', count: 1 }]);
  });

  it('respects the requested point budget', () => {
    const player = createPlayer(1, [
      { id: 1, abilityId: STORED_SKILL_1, upgradeOrder: 1 },
      { id: 2, abilityId: STORED_SKILL_1, upgradeOrder: 2 },
      { id: 3, abilityId: STORED_SKILL_1, upgradeOrder: 3 },
      { id: 4, abilityId: STORED_SKILL_1, upgradeOrder: 4 },
    ]);
    const recentMatchesWindowService = {
      getPlayersByHeroIds: jest.fn().mockReturnValue([player]),
    } as unknown as RecentMatchesWindowService;
    const service = new SkillBuildAnalysisService(recentMatchesWindowService);

    const result = service.getHeroSkillBuild(11, 4);

    expect(result.actions).toHaveLength(3);
    expect(result.totalPointCost).toBe(4);
  });

  it('does not merge matches from another hero through legacy aliases', () => {
    const recentMatchesWindowService = {
      getPlayersByHeroIds: jest.fn().mockReturnValue([
        createPlayer(1, [{ id: 1, abilityId: STORED_SKILL_1, upgradeOrder: 1 }]),
      ]),
    } as unknown as RecentMatchesWindowService;
    const service = new SkillBuildAnalysisService(recentMatchesWindowService);

    service.getHeroSkillBuild(11);

    expect(recentMatchesWindowService.getPlayersByHeroIds).toHaveBeenCalledWith([11]);
  });

  it('throws when the hero has no ability mapping', () => {
    const recentMatchesWindowService = {
      getPlayersByHeroIds: jest.fn(),
    } as unknown as RecentMatchesWindowService;
    const service = new SkillBuildAnalysisService(recentMatchesWindowService);

    expect(() => service.getHeroSkillBuild(999)).toThrow(NotFoundException);
    expect(recentMatchesWindowService.getPlayersByHeroIds).not.toHaveBeenCalled();
  });

  it('throws when the recent window contains no players for the hero', () => {
    const recentMatchesWindowService = {
      getPlayersByHeroIds: jest.fn().mockReturnValue([]),
    } as unknown as RecentMatchesWindowService;
    const service = new SkillBuildAnalysisService(recentMatchesWindowService);

    expect(() => service.getHeroSkillBuild(11)).toThrow(NotFoundException);
  });
});
