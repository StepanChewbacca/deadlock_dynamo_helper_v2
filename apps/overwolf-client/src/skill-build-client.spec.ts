import {
  fetchHeroSkillBuild,
  HeroSkillBuildResponse,
  isHeroSkillBuildResponse,
} from './skill-build-client';
import { formatSkillStepTitle } from './skill-build-ui';

const RESPONSE: HeroSkillBuildResponse = {
  heroId: 11,
  windowDays: 14,
  sourcePlayerCount: 100,
  validPlayerCount: 95,
  partialPlayerCount: 3,
  rejectedPlayerCount: 2,
  diagnostics: [],
  totalPointCost: 2,
  actions: [
    {
      abilityId: 3760705623,
      skillSlot: 1,
      type: 'UNLOCK',
      fromLevel: 0,
      toLevel: 1,
      upgradeTier: 0,
      pointCost: 1,
      actionIndex: 1,
      cumulativePointCost: 1,
      sampleSize: 80,
      pickRate: 0.8,
    },
    {
      abilityId: 2031714424,
      skillSlot: 2,
      type: 'UPGRADE',
      fromLevel: 1,
      toLevel: 2,
      upgradeTier: 1,
      pointCost: 1,
      actionIndex: 2,
      cumulativePointCost: 2,
      sampleSize: 60,
      pickRate: 0.75,
    },
  ],
};

describe('skill build client', () => {
  it('loads a hero skill build from the analysis endpoint', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => RESPONSE,
    });

    await expect(
      fetchHeroSkillBuild('https://example.test/', 11, fetchImpl as unknown as typeof fetch),
    ).resolves.toEqual(RESPONSE);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/deadlock/analysis/heroes/11/skill-build',
      { method: 'GET', cache: 'no-store' },
    );
  });

  it('rejects an invalid response shape', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ heroId: 11, actions: [{ skillSlot: 9 }] }),
    });

    await expect(
      fetchHeroSkillBuild('https://example.test', 11, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('invalid shape');
  });

  it('validates and formats route steps for both UI surfaces', () => {
    expect(isHeroSkillBuildResponse(RESPONSE)).toBe(true);
    expect(formatSkillStepTitle(RESPONSE.actions[0])).toBe('Skill 1 - unlock');
    expect(formatSkillStepTitle({ ...RESPONSE.actions[1], skillSlot: 4 })).toBe(
      'Ultimate - tier 1',
    );
  });
});
