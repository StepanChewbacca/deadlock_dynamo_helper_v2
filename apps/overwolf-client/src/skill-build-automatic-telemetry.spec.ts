import {
  decodePackedAbilityLevel,
  extractAutomaticSkillTelemetry,
  mergeObservedSkillLevels,
} from './skill-build-automatic-telemetry';
import type { SkillSlot } from './skill-build-client';

const ABILITY_IDS: Record<SkillSlot, number> = {
  1: 3760705623,
  2: 2031714424,
  3: 492030745,
  4: 249410288,
};

describe('automatic skill telemetry', () => {
  it('decodes the packed Deadlock ability upgrade mask', () => {
    expect(decodePackedAbilityLevel(1)).toBe(0);
    expect(decodePackedAbilityLevel(65537)).toBe(1);
    expect(decodePackedAbilityLevel(196609)).toBe(2);
    expect(decodePackedAbilityLevel(458753)).toBe(3);
    expect(decodePackedAbilityLevel(983041)).toBe(4);
    expect(decodePackedAbilityLevel(327681)).toBeUndefined();
  });

  it('reads exact levels from a local ability state vector by ability id', () => {
    const result = extractAutomaticSkillTelemetry(
      {
        match_info: {
          roster_5: JSON.stringify({
            steam_id: '76561198000000001',
            m_vecAbilityUpgradeState: [
              { m_ItemID: ABILITY_IDS[1], m_nUpgradeInfo: 65537 },
              { m_ItemID: ABILITY_IDS[2], m_nUpgradeInfo: 196609 },
              { m_ItemID: ABILITY_IDS[3], m_nUpgradeInfo: 1 },
              { m_ItemID: ABILITY_IDS[4], m_nUpgradeInfo: 458753 },
            ],
          }),
        },
      },
      {
        abilityIdsBySlot: ABILITY_IDS,
        localSteamId: '76561198000000001',
        eventKey: 'getInfo',
      },
    );

    expect(result).toMatchObject({
      levels: { 1: 1, 2: 2, 3: 0, 4: 3 },
      observedSlots: [1, 2, 3, 4],
      complete: true,
      confidence: 'HIGH',
    });
  });

  it('uses local vector order when Source 2 tokens do not match API item ids', () => {
    const result = extractAutomaticSkillTelemetry(
      {
        match_info: {
          roster_5: {
            steam_id: 'local',
            m_vecAbilityUpgradeState: [
              { m_ItemID: 101, m_nUpgradeInfo: 65537 },
              { m_ItemID: 102, m_nUpgradeInfo: 196609 },
              { m_ItemID: 103, m_nUpgradeInfo: 458753 },
              { m_ItemID: 104, m_nUpgradeInfo: 983041 },
            ],
          },
          roster_6: {
            steam_id: 'enemy',
            m_vecAbilityUpgradeState: [
              { m_ItemID: 201, m_nUpgradeInfo: 983041 },
              { m_ItemID: 202, m_nUpgradeInfo: 983041 },
              { m_ItemID: 203, m_nUpgradeInfo: 983041 },
              { m_ItemID: 204, m_nUpgradeInfo: 983041 },
            ],
          },
        },
      },
      {
        abilityIdsBySlot: ABILITY_IDS,
        localSteamId: 'local',
        eventKey: 'getInfo',
      },
    );

    expect(result).toMatchObject({
      levels: { 1: 1, 2: 2, 3: 3, 4: 4 },
      complete: true,
      confidence: 'MEDIUM',
    });
  });

  it('reads an explicit ability level update without using hero level', () => {
    const result = extractAutomaticSkillTelemetry(
      {
        ability_id: ABILITY_IDS[2],
        ability_level: 3,
        hero_level: 18,
      },
      {
        abilityIdsBySlot: ABILITY_IDS,
      },
    );

    expect(result).toMatchObject({
      levels: { 1: 0, 2: 3, 3: 0, 4: 0 },
      observedSlots: [2],
      complete: false,
      confidence: 'HIGH',
    });
  });

  it('uses repeated known ability item ids as an automatic fallback', () => {
    const result = extractAutomaticSkillTelemetry(
      {
        items_5: {
          steam_id: 'local',
          items: [
            { id: ABILITY_IDS[1] },
            { id: ABILITY_IDS[1] },
            { id: ABILITY_IDS[4] },
          ],
        },
      },
      {
        abilityIdsBySlot: ABILITY_IDS,
        localSteamId: 'local',
        eventKey: 'getInfo',
      },
    );

    expect(result).toMatchObject({
      levels: { 1: 2, 2: 0, 3: 0, 4: 1 },
      observedSlots: [1, 4],
      confidence: 'LOW',
    });
  });

  it('merges partial observations monotonically', () => {
    const result = extractAutomaticSkillTelemetry(
      {
        ability_id: ABILITY_IDS[3],
        level: 2,
      },
      { abilityIdsBySlot: ABILITY_IDS },
    );

    expect(result).toBeDefined();
    expect(
      mergeObservedSkillLevels(
        { 1: 1, 2: 2, 3: 1, 4: 0 },
        result!,
      ),
    ).toEqual({ 1: 1, 2: 2, 3: 2, 4: 0 });
  });

  it('does not infer skill levels from the general hero level', () => {
    expect(
      extractAutomaticSkillTelemetry(
        {
          roster_5: {
            steam_id: 'local',
            hero_id: 11,
            level: 18,
          },
        },
        {
          abilityIdsBySlot: ABILITY_IDS,
          localSteamId: 'local',
        },
      ),
    ).toBeUndefined();
  });
});
