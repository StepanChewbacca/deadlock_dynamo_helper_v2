import {
  applySkillBuildAction,
  createEmptySkillLevels,
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
  abilityIdsBySlot: {
    1: 3760705623,
    2: 2031714424,
    3: 492030745,
    4: 249410288,
  },
  currentLevels: { 1: 0, 2: 0, 3: 0, 4: 0 },
  currentPointCost: 0,
  totalPointCost: 2,
  nextAction: {
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
  it('loads a hero skill build for the current live levels', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => RESPONSE,
    });
    const levels = { 1: 1, 2: 0, 3: 2, 4: 3 } as const;

    await expect(
      fetchHeroSkillBuild(
        'https://example.test/',
        11,
        levels,
        fetchImpl as unknown as typeof fetch,
      ),
    ).resolves.toEqual(RESPONSE);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/deadlock/analysis/heroes/11/skill-build?levels=1%2C0%2C2%2C3',
      { method: 'GET', cache: 'no-store' },
    );
  });

  it('uses empty live levels by default', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => RESPONSE,
    });

    await fetchHeroSkillBuild(
      'https://example.test',
      11,
      createEmptySkillLevels(),
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl.mock.calls[0]?.[0]).toContain('levels=0%2C0%2C0%2C0');
  });

  it('rejects an invalid response shape', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ heroId: 11, actions: [{ skillSlot: 9 }] }),
    });

    await expect(
      fetchHeroSkillBuild(
        'https://example.test',
        11,
        createEmptySkillLevels(),
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow('invalid shape');
  });

  it('validates and formats exact next-skill instructions', () => {
    expect(isHeroSkillBuildResponse(RESPONSE)).toBe(true);
    expect(formatSkillStepTitle(RESPONSE.actions[0])).toBe('Learn Skill 1');
    expect(formatSkillStepTitle({ ...RESPONSE.actions[1], skillSlot: 4 })).toBe(
      'Upgrade Ultimate - Level 1',
    );
  });

  it('applies a confirmed recommendation to live levels', () => {
    expect(
      applySkillBuildAction(createEmptySkillLevels(), RESPONSE.actions[0]),
    ).toEqual({ 1: 1, 2: 0, 3: 0, 4: 0 });
  });
});
