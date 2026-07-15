import {
  extractReliableAutomaticSkillTelemetry,
  normalizeAutomaticSkillPayload,
} from './skill-build-automatic-runtime-v2';
import type { HeroSkillBuildResponse, SkillSlot } from './skill-build-client';

const ABILITY_IDS: Record<SkillSlot, number> = {
  1: 3760705623,
  2: 2031714424,
  3: 492030745,
  4: 249410288,
};

const BUILD = {
  heroId: 11,
  resolvedHeroId: 11,
  windowDays: 14,
  sourcePlayerCount: 1,
  validPlayerCount: 1,
  partialPlayerCount: 0,
  rejectedPlayerCount: 0,
  diagnostics: [],
  abilityIdsBySlot: ABILITY_IDS,
  currentLevels: { 1: 0, 2: 0, 3: 0, 4: 0 },
  currentPointCost: 0,
  totalPointCost: 36,
  actions: [],
} as unknown as HeroSkillBuildResponse;

describe('automatic skill runtime v2', () => {
  it('reads a primitive packed ability vector from a full getInfo snapshot', () => {
    const result = extractReliableAutomaticSkillTelemetry(
      {
        source: 'getInfo',
        eventKey: 'getInfo',
        receivedAt: 1,
        value: {
          match_info: {
            m_vecAbilityUpgradeState: [65537, 1, 1, 1],
          },
        },
      } as any,
      { build: BUILD, localSteamId: '76561198000000001' },
    );

    expect(result).toMatchObject({
      levels: { 1: 1, 2: 0, 3: 0, 4: 0 },
      observedSlots: [1, 2, 3, 4],
      complete: true,
    });
  });

  it('normalizes direct numeric vectors without treating packed zero markers as learned', () => {
    expect(
      normalizeAutomaticSkillPayload({
        m_vecAbilityUpgradeState: [1, 0, 0, 0],
      }),
    ).toEqual({
      m_vecAbilityUpgradeState: [
        { ability_slot: 1, level: 1 },
        { ability_slot: 2, level: 0 },
        { ability_slot: 3, level: 0 },
        { ability_slot: 4, level: 0 },
      ],
    });
  });

  it('keeps an all-ones vector unresolved because it is ambiguous', () => {
    expect(
      normalizeAutomaticSkillPayload({
        m_vecAbilityUpgradeState: [1, 1, 1, 1],
      }),
    ).toEqual({
      m_vecAbilityUpgradeState: [1, 1, 1, 1],
    });
  });

  it('rejects an unscoped vector from an incremental event', () => {
    const result = extractReliableAutomaticSkillTelemetry(
      {
        source: 'new-event',
        eventKey: 'ability_update',
        receivedAt: 1,
        value: {
          m_vecAbilityUpgradeState: [
            { m_nUpgradeInfo: 65537 },
            { m_nUpgradeInfo: 1 },
            { m_nUpgradeInfo: 1 },
            { m_nUpgradeInfo: 1 },
          ],
        },
      } as any,
      { build: BUILD, localSteamId: '76561198000000001' },
    );

    expect(result).toBeUndefined();
  });
});
