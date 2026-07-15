import {
  isSafeAutomaticSkillObservation,
  reconcileAutomaticSkillObservations,
} from './skill-build-automatic-runtime';
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
  sourcePlayerCount: 10,
  validPlayerCount: 10,
  partialPlayerCount: 0,
  rejectedPlayerCount: 0,
  diagnostics: [],
  abilityIdsBySlot: ABILITY_IDS,
  currentLevels: { 1: 0, 2: 0, 3: 0, 4: 0 },
  currentPointCost: 0,
  totalPointCost: 0,
  actions: [],
} as unknown as HeroSkillBuildResponse;

const CONTEXT = {
  matchId: 'match-1',
  heroId: 11,
  localSteamId: 'local',
  build: BUILD,
};

describe('automatic skill runtime reconciliation', () => {
  it('merges independent partial skill observations', () => {
    const result = reconcileAutomaticSkillObservations(
      [
        {
          receivedAt: 1,
          eventKey: 'ability_update',
          value: { ability_id: ABILITY_IDS[1], ability_level: 1 },
        },
        {
          receivedAt: 2,
          eventKey: 'ability_update',
          value: { ability_id: ABILITY_IDS[2], ability_level: 2 },
        },
      ],
      CONTEXT,
    );

    expect(result).toMatchObject({
      levels: { 1: 1, 2: 2, 3: 0, 4: 0 },
      observedSlots: [1, 2],
      complete: false,
      confidence: 'HIGH',
    });
  });

  it('uses the latest complete local snapshot and then applies newer partial increases', () => {
    const result = reconcileAutomaticSkillObservations(
      [
        {
          receivedAt: 10,
          eventKey: 'getInfo',
          value: createLocalVector([1, 1, 0, 0]),
        },
        {
          receivedAt: 20,
          eventKey: 'getInfo',
          value: createLocalVector([1, 2, 1, 0]),
        },
        {
          receivedAt: 30,
          eventKey: 'ability_update',
          value: { ability_id: ABILITY_IDS[4], ability_level: 1 },
        },
      ],
      CONTEXT,
    );

    expect(result).toMatchObject({
      levels: { 1: 1, 2: 2, 3: 1, 4: 1 },
      observedSlots: [1, 2, 3, 4],
      complete: true,
    });
  });

  it('rejects vector-index observations outside a full local getInfo snapshot', () => {
    expect(
      isSafeAutomaticSkillObservation(
        {
          levels: { 1: 1, 2: 0, 3: 0, 4: 0 },
          observedSlots: [1],
          complete: false,
          confidence: 'MEDIUM',
          evidence: ['packed-upgrade-info:vector-index:m_vecAbilityUpgradeState'],
        },
        { eventKey: 'ability_update' },
        { localSteamId: 'local' },
      ),
    ).toBe(false);
  });

  it('rejects an unscoped single ability vector even when it came from getInfo', () => {
    expect(
      isSafeAutomaticSkillObservation(
        {
          levels: { 1: 1, 2: 2, 3: 3, 4: 4 },
          observedSlots: [1, 2, 3, 4],
          complete: true,
          confidence: 'MEDIUM',
          evidence: [
            'packed-upgrade-info:vector-index:single-ability-state-vector',
          ],
        },
        { eventKey: 'getInfo' },
        { localSteamId: 'local' },
      ),
    ).toBe(false);
  });
});

function createLocalVector(levels: [number, number, number, number]) {
  return {
    match_info: {
      roster_5: {
        steam_id: 'local',
        m_vecAbilityUpgradeState: levels.map((level, index) => ({
          m_ItemID: 100 + index,
          m_nUpgradeInfo: encodePackedLevel(level),
        })),
      },
    },
  };
}

function encodePackedLevel(level: number): number {
  return (((1 << level) - 1) << 16) | 1;
}
