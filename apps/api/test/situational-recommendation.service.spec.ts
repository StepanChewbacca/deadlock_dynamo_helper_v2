import { SituationalRecommendationService } from '../src/deadlock-live/situational-recommendation.service';

describe('SituationalRecommendationService', () => {
  it('abstains when no live state is available', async () => {
    const service = new SituationalRecommendationService(
      { getState: jest.fn(), getAllStates: jest.fn().mockReturnValue([]), getSnapshots: jest.fn().mockReturnValue([]) } as any,
      {} as any,
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      { save: jest.fn() } as any,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
    );

    const result = await service.recommend({});

    expect(result.decision).toBe('ABSTAIN');
    expect(result.confidence).toBe(0);
    expect(result.recommendationId).toBeNull();
    expect(result.recommendationState).toBe('CANDIDATE');
  });

  it('continues core when live state is ready but threat evidence is weak', async () => {
    const now = new Date().toISOString();
    const playersBySteamId: Record<string, any> = {
      local: {
        steamId: 'local',
        playerName: 'Local',
        isLocal: true,
        heroId: 13,
        heroName: 'Haze',
        teamId: 0,
        souls: 5000,
        heroDamage: 3000,
        deaths: 0,
        health: 900,
        maxHealth: 1000,
        items: [{ id: 101, name: 'Weapon Item', className: 'weapon_item', enhanced: false }],
      },
    };

    for (let i = 0; i < 4; i++) {
      playersBySteamId[`ally${i}`] = {
        steamId: `ally${i}`,
        playerName: `Ally ${i}`,
        heroId: 20 + i,
        teamId: 0,
        souls: 4000,
        heroDamage: 1000,
        items: [{ id: 101, name: 'Weapon Item', className: 'weapon_item', enhanced: false }],
      };
      playersBySteamId[`enemy${i}`] = {
        steamId: `enemy${i}`,
        playerName: `Enemy ${i}`,
        heroId: 30 + i,
        teamId: 1,
        souls: 3000,
        heroDamage: 800,
        deaths: 4,
        items: [{ id: 101, name: 'Weapon Item', className: 'weapon_item', enhanced: false }],
      };
    }

    const mockQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ netWorthPerSec: 8.5, killsPerSec: 0.005 }),
    };

    const matchPlayerRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const service = new SituationalRecommendationService(
      {
        getState: jest.fn(),
        getSnapshots: jest.fn().mockReturnValue([]),
        getAllStates: jest.fn().mockReturnValue([
          {
            matchId: 'm1',
            gameTimeSec: 600,
            playersBySteamId,
            lastUpdatedAt: now,
          },
        ]),
      } as any,
      {
        getHeroBuilds: jest.fn().mockResolvedValue({
          builds: [
            {
              buildType: 'weapon',
              phases: {
                early: [{ id: 101, name: 'Weapon Item', avgPurchaseTimeS: 120 }],
                mid: [{ id: 102, name: 'Core Item', avgPurchaseTimeS: 620 }],
                late: [],
              },
            },
          ],
        }),
      } as any,
      {
        find: jest.fn().mockResolvedValue([
          { itemId: 101, name: 'Weapon Item', className: 'weapon_item', itemSlotType: 'weapon', cost: 800, itemTier: 1 },
          { itemId: 102, name: 'Core Item', className: 'core_item', itemSlotType: 'weapon', cost: 1600, itemTier: 2 },
        ]),
      } as any,
      matchPlayerRepoMock as any,
      { save: jest.fn() } as any,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
    );

    const result = await service.recommend({});

    expect(result.decision).toBe('CONTINUE_CORE');
    expect(result.nextCoreItem?.id).toBe(102);
    expect(result.recommendationId).toBeNull();
    expect(result.recommendationState).toBe('CANDIDATE');
  });

  it('uses rolling snapshots as recent momentum evidence', async () => {
    const now = new Date().toISOString();
    const playersBySteamId: Record<string, any> = {
      local: {
        steamId: 'local',
        playerName: 'Local',
        isLocal: true,
        heroId: 13,
        heroName: 'Haze',
        teamId: 0,
        souls: 5000,
        heroDamage: 3000,
        deaths: 2,
        health: 500,
        maxHealth: 1000,
        items: [{ id: 101, name: 'Weapon Item', className: 'weapon_item', enhanced: false }],
      },
      enemy0: {
        steamId: 'enemy0',
        playerName: 'Enemy 0',
        heroId: 30,
        heroName: 'Haze',
        teamId: 1,
        souls: 10000,
        heroDamage: 9000,
        kills: 8,
        deaths: 1,
        assists: 4,
        items: [{ id: 201, name: 'Weapon Item', className: 'weapon_item', enhanced: false }],
      },
    };

    for (let i = 0; i < 4; i++) {
      playersBySteamId[`ally${i}`] = { steamId: `ally${i}`, playerName: `Ally ${i}`, heroId: 20 + i, teamId: 0, items: [] };
    }
    for (let i = 1; i < 4; i++) {
      playersBySteamId[`enemy${i}`] = { steamId: `enemy${i}`, playerName: `Enemy ${i}`, heroId: 30 + i, teamId: 1, souls: 2000, heroDamage: 500, deaths: 4, items: [] };
    }

    const mockQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ netWorthPerSec: 8.5, killsPerSec: 0.005 }),
    };

    const matchPlayerRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const service = new SituationalRecommendationService(
      {
        getState: jest.fn(),
        getSnapshots: jest.fn().mockReturnValue([
          {
            matchId: 'm1',
            gameTimeSec: 340,
            capturedAt: now,
            playersBySteamId: {
              enemy0: {
                steamId: 'enemy0',
                heroId: 30,
                teamId: 1,
                souls: 5000,
                heroDamage: 2500,
                kills: 2,
                deaths: 1,
                assists: 1,
                itemIds: [],
              },
            },
          },
        ]),
        getAllStates: jest.fn().mockReturnValue([
          {
            matchId: 'm1',
            gameTimeSec: 600,
            playersBySteamId,
            lastUpdatedAt: now,
          },
        ]),
      } as any,
      { getHeroBuilds: jest.fn().mockResolvedValue({ builds: [] }) } as any,
      {
        find: jest.fn().mockResolvedValue([
          { itemId: 101, name: 'Weapon Item', className: 'weapon_item', itemSlotType: 'weapon', cost: 800, itemTier: 1 },
          { itemId: 201, name: 'Weapon Item', className: 'weapon_item', itemSlotType: 'weapon', cost: 800, itemTier: 1 },
          { itemId: 301, name: 'Metal Skin', className: 'upgrade_metal_skin', itemSlotType: 'vitality', cost: 3200, itemTier: 3 },
        ]),
      } as any,
      matchPlayerRepoMock as any,
      { save: jest.fn() } as any,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
    );

    const result = await service.recommend({});
    const evidence = result.candidates.length > 0 ? JSON.stringify(result) : result.supportingEvidence.join(' ');

    expect(evidence).toContain('recent momentum');
  });

  it('activates a lifecycle recommendation when a supported situational item clears policy thresholds', async () => {
    const now = new Date().toISOString();
    const playersBySteamId: Record<string, any> = {
      local: {
        steamId: 'local',
        playerName: 'Local',
        isLocal: true,
        heroId: 13,
        heroName: 'Haze',
        teamId: 0,
        souls: 6500,
        heroDamage: 3200,
        deaths: 4,
        health: 260,
        maxHealth: 1000,
        items: [{ id: 101, name: 'Weapon Item', className: 'weapon_item', enhanced: false }],
      },
      enemy0: {
        steamId: 'enemy0',
        playerName: 'Enemy Haze',
        heroId: 13,
        heroName: 'Haze',
        teamId: 1,
        souls: 14500,
        heroDamage: 13500,
        kills: 12,
        deaths: 1,
        assists: 6,
        items: [
          { id: 201, name: 'Weapon Item', className: 'weapon_item', enhanced: false },
          { id: 202, name: 'Weapon Item 2', className: 'weapon_item_2', enhanced: false },
        ],
      },
    };

    for (let i = 0; i < 4; i++) {
      playersBySteamId[`ally${i}`] = { steamId: `ally${i}`, playerName: `Ally ${i}`, heroId: 20 + i, teamId: 0, souls: 5000, heroDamage: 1200, deaths: 2, items: [] };
    }
    for (let i = 1; i < 4; i++) {
      playersBySteamId[`enemy${i}`] = { steamId: `enemy${i}`, playerName: `Enemy ${i}`, heroId: 30 + i, teamId: 1, souls: 3500, heroDamage: 900, deaths: 5, items: [] };
    }

    const withMetalSkin = Array.from({ length: 120 }, (_, i) => ({
      matchId: 1000 + i,
      heroId: 13,
      team: 0,
      won: true,
      crawledAt: new Date(),
      itemPurchases: [{ itemId: 301, purchaseTimeS: 600 }],
      match: {
        averageBadge: 65,
        players: [{ heroId: 13, team: 1 }],
      },
    }));
    const withoutMetalSkin = Array.from({ length: 40 }, (_, i) => ({
      matchId: 2000 + i,
      heroId: 13,
      team: 0,
      won: false,
      crawledAt: new Date(),
      itemPurchases: [],
      match: {
        averageBadge: 65,
        players: [{ heroId: 13, team: 1 }],
      },
    }));
    const historicalPlayers = [...withMetalSkin, ...withoutMetalSkin];

    const mockQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ netWorthPerSec: 10, killsPerSec: 0.008 }),
    };

    const matchPlayerRepo = {
      find: jest.fn().mockResolvedValue(historicalPlayers),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const shadowMock = {
      save: jest.fn().mockResolvedValue({}),
    };

    const service = new SituationalRecommendationService(
      {
        getState: jest.fn(),
        getSnapshots: jest.fn().mockReturnValue([]),
        getAllStates: jest.fn().mockReturnValue([
          {
            matchId: 'm-lifecycle',
            gameTimeSec: 720,
            playersBySteamId,
            lastUpdatedAt: now,
          },
        ]),
      } as any,
      {
        getHeroBuilds: jest.fn().mockResolvedValue({
          builds: [
            {
              buildType: 'weapon',
              phases: {
                early: [{ id: 101, name: 'Weapon Item', avgPurchaseTimeS: 120 }],
                mid: [{ id: 102, name: 'Core Item', avgPurchaseTimeS: 2000 }],
                late: [],
              },
            },
          ],
        }),
      } as any,
      {
        find: jest.fn().mockResolvedValue([
          { itemId: 101, name: 'Weapon Item', className: 'weapon_item', itemSlotType: 'weapon', cost: 800, itemTier: 1 },
          { itemId: 102, name: 'Core Item', className: 'core_item', itemSlotType: 'weapon', cost: 1600, itemTier: 2 },
          { itemId: 201, name: 'Weapon Item', className: 'weapon_item', itemSlotType: 'weapon', cost: 800, itemTier: 1 },
          { itemId: 202, name: 'Weapon Item 2', className: 'weapon_item_2', itemSlotType: 'weapon', cost: 1600, itemTier: 2 },
          { itemId: 301, name: 'Metal Skin', className: 'upgrade_metal_skin', itemSlotType: 'vitality', cost: 3200, itemTier: 3 },
        ]),
      } as any,
      matchPlayerRepo as any,
      shadowMock as any,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
    );

    const result = await service.recommend({});

    expect(result.decision).toBe('BUY_SITUATIONAL_ITEM');
    expect(result.recommendedItemId).toBe(301);
    expect(result.recommendationState).toBe('ACTIVE');
    expect(result.historicalSampleSize).toBe(120);
    expect(shadowMock.save).toHaveBeenCalled();
  });

  it('evaluates and returns baselines comparison', async () => {
    const service = new SituationalRecommendationService(
      {} as any,
      {} as any,
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      { save: jest.fn() } as any,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
    );

    const threat: any = {
      weaponPressure: 0.8,
      spiritPressure: 0.2,
      healing: 0.1,
      hardCc: 0.1,
    };

    const candidates: any[] = [
      { name: 'Metal Skin', support: 50, score: 0.8 },
      { name: 'Bullet Armor', support: 20, score: 0.6 },
    ];

    const baselines = service.evaluateBaselines(
      { id: 101, name: 'Core Item' },
      threat,
      {},
      candidates,
    );

    expect(baselines.staticPopular).toBe('Core Item');
    expect(baselines.ruleOnly).toBe('Metal Skin');
    expect(baselines.nearestNeighbor).toBe('Metal Skin');
    expect(baselines.situationAware).toBe('Metal Skin');
  });

  it('uses hero id aliases for situational historical support', async () => {
    const historicalPlayers = [
      {
        matchId: 1000,
        heroId: 76,
        team: 0,
        won: true,
        itemPurchases: [{ itemId: 301, purchaseTimeS: 700 }],
        match: {
          averageBadge: 65,
          players: [{ heroId: 76, team: 1 }],
        },
      },
      {
        matchId: 1001,
        heroId: 76,
        team: 0,
        won: false,
        itemPurchases: [],
        match: {
          averageBadge: 65,
          players: [{ heroId: 76, team: 1 }],
        },
      },
    ];
    const matchPlayerRepo = {
      find: jest.fn().mockResolvedValue(historicalPlayers),
    };
    const service = new SituationalRecommendationService(
      {} as any,
      {} as any,
      { find: jest.fn() } as any,
      matchPlayerRepo as any,
      { save: jest.fn() } as any,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
    );

    const support = await (service as any).calculateHistoricalSupport(
      12,
      [{ heroId: 12 }],
      [301],
      720,
    );

    expect(matchPlayerRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          heroId: expect.objectContaining({ _value: expect.arrayContaining([12, 76]) }),
        }),
      }),
    );
    expect(support[301].support).toBe(1);
    expect(support[301].uplift).toBeGreaterThan(0);
  });

  it('triggers SWITCH_ARCHETYPE when archetype probability shifts', async () => {
    const now = new Date().toISOString();
    const playersBySteamId: Record<string, any> = {
      local: {
        steamId: 'local',
        playerName: 'Local',
        isLocal: true,
        heroId: 13,
        heroName: 'Haze',
        teamId: 0,
        souls: 5000,
        items: [
          { id: 101, name: 'Weapon Item', className: 'weapon_item' },
        ],
      },
      enemy0: {
        steamId: 'enemy0',
        playerName: 'Enemy 0',
        heroId: 30,
        teamId: 1,
        souls: 3000,
        items: [],
      },
    };

    for (let i = 0; i < 4; i++) {
      playersBySteamId[`ally${i}`] = { steamId: `ally${i}`, teamId: 0, items: [] };
    }
    for (let i = 1; i < 4; i++) {
      playersBySteamId[`enemy${i}`] = { steamId: `enemy${i}`, teamId: 1, souls: 2000, items: [] };
    }

    const mockQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ netWorthPerSec: 8.5, killsPerSec: 0.005 }),
    };

    const matchPlayerRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const shadowMock = {
      save: jest.fn().mockResolvedValue({}),
    };

    const service = new SituationalRecommendationService(
      {
        getState: jest.fn(),
        getSnapshots: jest.fn().mockReturnValue([]),
        getAllStates: jest.fn().mockReturnValue([
          {
            matchId: 'm-switch',
            gameTimeSec: 600,
            playersBySteamId,
            lastUpdatedAt: now,
          },
        ]),
      } as any,
      {
        getHeroBuilds: jest.fn().mockResolvedValue({
          builds: [
            {
              buildType: 'weapon',
              winRate: 52,
              phases: { early: [], mid: [], late: [] },
            },
            {
              buildType: 'vitality',
              winRate: 58,
              phases: { early: [], mid: [], late: [] },
            },
          ],
        }),
      } as any,
      {
        find: jest.fn().mockResolvedValue([
          { itemId: 101, name: 'Weapon Item', className: 'weapon_item', itemSlotType: 'weapon', cost: 800, itemTier: 1 },
          { itemId: 301, name: 'Vitality Item', className: 'vitality_item', itemSlotType: 'vitality', cost: 1250, itemTier: 2 },
          { itemId: 302, name: 'Vitality Item 2', className: 'vitality_item_2', itemSlotType: 'vitality', cost: 1250, itemTier: 2 },
          { itemId: 303, name: 'Vitality Item 3', className: 'vitality_item_3', itemSlotType: 'vitality', cost: 1250, itemTier: 2 },
        ]),
      } as any,
      matchPlayerRepoMock as any,
      shadowMock as any,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
    );

    // Call 1: initializes probability with weapon item, setting current build archetype to 'weapon'.
    await service.recommend({});

    // Shift local player items to vitality for Call 2 & Call 3
    playersBySteamId.local.items = [
      { id: 301, name: 'Vitality Item', className: 'vitality_item' },
      { id: 302, name: 'Vitality Item 2', className: 'vitality_item_2' },
      { id: 303, name: 'Vitality Item 3', className: 'vitality_item_3' },
    ];

    // Call 2: shifts probability towards vitality (but won't exceed 0.65 switch threshold yet)
    await service.recommend({});

    // Call 3: shifts probability again (exceeds 0.65 threshold and triggers archetype switch)
    const res = await service.recommend({});

    expect(res.decision).toBe('SWITCH_ARCHETYPE');
    expect(res.currentBuildArchetype).toBe('vitality');
    expect(shadowMock.save).toHaveBeenCalled();
  });
});
