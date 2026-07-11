import axios from 'axios';
import { AllHeroesAnalysisService } from '../src/deadlock-live/all-heroes-analysis.service';

jest.mock('axios');

describe('AllHeroesAnalysisService', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  const originalApiKey = process.env.DEADLOCK_API_KEY;

  beforeEach(() => {
    mockedAxios.get.mockReset();
    delete process.env.DEADLOCK_API_KEY;
  });

  afterAll(() => {
    if (originalApiKey === undefined) {
      delete process.env.DEADLOCK_API_KEY;
      return;
    }

    process.env.DEADLOCK_API_KEY = originalApiKey;
  });

  it('fetches match pages using a descending max_match_id cursor and deduplicates ids', async () => {
    process.env.DEADLOCK_API_KEY = 'test-key';
    mockedAxios.get
      .mockResolvedValueOnce({
        data: [
          { match_id: 300 },
          { match_id: 299 },
          { match_id: 298 },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          { match_id: 297 },
          { match_id: 296 },
          { match_id: 296 },
          { match_id: 295 },
        ],
      });

    const service = new AllHeroesAnalysisService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const result = await (service as any).fetchCandidateMatchIds(new Set([299]), 5);

    expect(result).toEqual([300, 298, 297, 296, 295]);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://api.deadlock-api.com/v1/matches/metadata',
      expect.objectContaining({
        headers: { 'X-API-KEY': 'test-key' },
        params: expect.objectContaining({
          min_average_badge: 116,
          order_by: 'match_id',
          order_direction: 'desc',
        }),
      }),
    );
    expect(mockedAxios.get.mock.calls[0][1]?.params.start).toBeUndefined();
    expect(mockedAxios.get.mock.calls[1][1]?.params.max_match_id).toBe(297);
  });

  it('computes builds from normalized player item and skill relations', () => {
    const service = new AllHeroesAnalysisService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const itemsMap = {
      '101': { name: 'Healing Rite', class_name: 'upgrade_health_stimpak', item_slot_type: 'vitality', cost: 800, item_tier: 1 },
      '102': { name: 'Restorative Locket', class_name: 'upgrade_restorative_locket', item_slot_type: 'vitality', cost: 1600, item_tier: 2 },
    };

    // Generate 10 identical players to satisfy the minimum cluster size (>= 10)
    const mockPlayers = Array.from({ length: 10 }, () => ({
      won: true,
      itemPurchases: [
        { itemId: 101, purchaseTimeS: 200 },
        { itemId: 102, purchaseTimeS: 600 },
      ],
      skillUpgrades: [
        { abilityId: 1, upgradeOrder: 0 },
        { abilityId: 2, upgradeOrder: 1 },
      ],
    }));

    const builds = (service as any).computeBuilds(
      mockPlayers,
      itemsMap,
    );

    expect(builds.length).toBeGreaterThan(0);
    expect(builds[0].buildType).toBe('vitality');
    expect(builds[0].phases.early[0]).toEqual(
      expect.objectContaining({
        id: 101,
        name: 'Healing Rite',
        score: expect.any(Number),
        avgPurchaseTimeS: 200,
      }),
    );
    expect(builds[0].skillsOrder.slice(0, 2)).toEqual([1, 2]);
  });

  it('builds skill actions with learn vs upgrade costs', () => {
    const service = new AllHeroesAnalysisService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const skillBuild = (service as any).buildSkillActions([1, 2, 1, 1, 3, 1]);

    expect(skillBuild).toEqual([
      { step: 1, skill: 1, action: 'UNLOCK', upgradeTier: 0, pointCost: 1 },
      { step: 2, skill: 2, action: 'UNLOCK', upgradeTier: 0, pointCost: 1 },
      { step: 3, skill: 1, action: 'UPGRADE', upgradeTier: 1, pointCost: 1 },
      { step: 4, skill: 1, action: 'UPGRADE', upgradeTier: 2, pointCost: 2 },
      { step: 5, skill: 3, action: 'UNLOCK', upgradeTier: 0, pointCost: 1 },
      { step: 6, skill: 1, action: 'UPGRADE', upgradeTier: 3, pointCost: 5 },
    ]);
  });

  it('keeps the same item in only one build phase column', () => {
    const service = new AllHeroesAnalysisService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const itemsMap = {
      '101': { name: 'Repeat Item', class_name: 'repeat_item', item_slot_type: 'vitality', cost: 800, item_tier: 1 },
      '102': { name: 'Mid Item', class_name: 'mid_item', item_slot_type: 'vitality', cost: 1600, item_tier: 2 },
      '103': { name: 'Late Item', class_name: 'late_item', item_slot_type: 'vitality', cost: 3200, item_tier: 3 },
    };

    const mockPlayers = Array.from({ length: 10 }, (_, index) => ({
      won: true,
      itemPurchases: [
        { itemId: 101, purchaseTimeS: index < 8 ? 200 : 700 },
        { itemId: 102, purchaseTimeS: 700 },
        { itemId: 103, purchaseTimeS: 1400 },
      ],
      skillUpgrades: [
        { abilityId: 1, upgradeOrder: 0 },
        { abilityId: 2, upgradeOrder: 1 },
      ],
    }));

    const builds = (service as any).computeBuilds(mockPlayers, itemsMap);
    const build = builds[0];
    const allPhaseItemIds = [
      ...build.phases.early.map((item: { id: number }) => item.id),
      ...build.phases.mid.map((item: { id: number }) => item.id),
      ...build.phases.late.map((item: { id: number }) => item.id),
    ];

    expect(allPhaseItemIds.filter((id) => id === 101)).toHaveLength(1);
    expect(build.phases.early.find((item: { id: number }) => item.id === 101)).toEqual(
      expect.objectContaining({ avgPurchaseTimeS: 200 }),
    );
  });

  it('loads builds using all known hero id aliases', async () => {
    const mockMatchPlayerRepo = {
      find: jest.fn().mockResolvedValue([
        {
          won: true,
          itemPurchases: [{ itemId: 101, purchaseTimeS: 200 }],
          skillUpgrades: [{ abilityId: 1, upgradeOrder: 0 }],
        },
      ]),
    };

    const service = new AllHeroesAnalysisService(
      {} as any,
      mockMatchPlayerRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      {} as any,
      {} as any,
    );

    (service as any).loadHeroesMap = jest.fn().mockResolvedValue({
      '12': { name: 'Kelvin' },
      '76': { name: 'Kelvin' },
    });
    (service as any).loadItemsMap = jest.fn().mockResolvedValue({
      '101': { name: 'Weapon Item', class_name: 'weapon_item', item_slot_type: 'weapon', cost: 800, item_tier: 1 },
    });
    (service as any).loadItemComponentsMap = jest.fn().mockResolvedValue({});
    (service as any).computeBuilds = jest.fn().mockReturnValue([]);

    await service.getHeroBuilds(12);

    expect(mockMatchPlayerRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          heroId: expect.objectContaining({ _value: expect.arrayContaining([12, 76]) }),
        }),
      }),
    );
  });

  it('sorts items inside each phase by average purchase time', () => {
    const service = new AllHeroesAnalysisService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const itemsMap = {
      '101': { name: 'Later Strong Item', class_name: 'later_strong', item_slot_type: 'vitality', cost: 1600, item_tier: 2 },
      '102': { name: 'Earlier Weak Item', class_name: 'earlier_weak', item_slot_type: 'weapon', cost: 800, item_tier: 1 },
    };

    const mockPlayers = Array.from({ length: 10 }, (_, index) => ({
      won: true,
      itemPurchases: [
        { itemId: 101, purchaseTimeS: 360 },
        ...(index < 3 ? [] : [{ itemId: 102, purchaseTimeS: 120 }]),
      ],
      skillUpgrades: [
        { abilityId: 1, upgradeOrder: 0 },
        { abilityId: 2, upgradeOrder: 1 },
      ],
    }));

    const builds = (service as any).computeBuilds(mockPlayers, itemsMap);
    const earlyIds = builds[0].phases.early.map((item: { id: number }) => item.id);

    expect(earlyIds).toEqual([102, 101]);
  });

  it('reconstructs component purchases before the final upgrade item', () => {
    const service = new AllHeroesAnalysisService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    (service as any).itemComponentsMapCache = {
      2064029594: [3077079169],
    };

    const itemsMap = {
      '2064029594': { name: 'Opening Rounds', class_name: 'upgrade_pristine_emblem', item_slot_type: 'weapon', cost: 1600, item_tier: 2 },
      '3077079169': { name: 'High-Velocity Rounds', class_name: 'upgrade_high_velocity_mag', item_slot_type: 'weapon', cost: 800, item_tier: 1 },
    };

    const reconstructed = (service as any).reconstructPurchases(
      [{ itemId: 2064029594, purchaseTimeS: 300 }],
      itemsMap,
      { 3077079169: 180, 2064029594: 300 },
    );

    expect(reconstructed).toEqual([
      { itemId: 3077079169, purchaseTimeS: 180 },
      { itemId: 2064029594, purchaseTimeS: 300 },
    ]);
  });

  it('exposes component item ids on build items for HUD purchase filtering', () => {
    const service = new AllHeroesAnalysisService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    (service as any).itemComponentsMapCache = {
      2064029594: [3077079169],
    };

    const itemsMap = {
      '2064029594': { name: 'Opening Rounds', class_name: 'upgrade_pristine_emblem', item_slot_type: 'weapon', cost: 1600, item_tier: 2 },
      '3077079169': { name: 'High-Velocity Rounds', class_name: 'upgrade_high_velocity_mag', item_slot_type: 'weapon', cost: 800, item_tier: 1 },
    };

    const mockPlayers = Array.from({ length: 10 }, () => ({
      won: true,
      netWorth: 10000,
      itemPurchases: [
        { itemId: 3077079169, purchaseTimeS: 180 },
        { itemId: 2064029594, purchaseTimeS: 300 },
      ],
      skillUpgrades: [{ abilityId: 1, upgradeOrder: 0 }],
    }));

    const builds = (service as any).computeBuilds(mockPlayers, itemsMap);
    const openingRounds = [
      ...builds[0].phases.early,
      ...builds[0].phases.mid,
      ...builds[0].phases.late,
    ].find((item: { id: number }) => item.id === 2064029594);

    expect(openingRounds).toEqual(
      expect.objectContaining({
        componentItemIds: [3077079169],
      }),
    );
  });

  it('generates dynamic recommendations and adjusts suitability scores based on teammates and enemies', async () => {
    // Mock repositories and database calls
    const mockMatchPlayerRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 1,
          matchId: 1000,
          heroId: 2,
          won: true,
          netWorth: 40000,
          itemPurchases: [{ itemId: 101, purchaseTimeS: 150 }],
          skillUpgrades: [{ abilityId: 1, upgradeOrder: 0 }],
        }
      ]),
    };
    const mockItemComponentRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    const service = new AllHeroesAnalysisService(
      {} as any,
      mockMatchPlayerRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockItemComponentRepo as any,
      {} as any,
      {} as any,
    );

    // Mock internal methods
    (service as any).loadHeroesMap = jest.fn().mockResolvedValue({ '2': { name: 'Haze' }, '64': { name: 'Haze' } });
    (service as any).loadItemsMap = jest.fn().mockResolvedValue({
      '101': { name: 'Healing Rite', class_name: 'upgrade_health_stimpak', item_slot_type: 'vitality', cost: 800 },
    });

    // Stub computeBuilds to return a baseline mock build
    (service as any).computeBuilds = jest.fn().mockReturnValue([
      {
        buildType: 'vitality',
        matchCount: 1,
        winRate: 100,
        avgNetWorth: 40000,
        skillsOrder: [1],
        phases: { early: [], mid: [], late: [] },
        coreItems: [],
        situationalItems: [],
      }
    ]);

    const result = await service.recommendBuild({
      heroId: 2,
      teammates: [11],
      enemies: [7],
    });

    expect(result.heroId).toBe(2);
    expect(result.heroName).toBe('Haze');
    expect(result.recommendedBuildType).toBe('vitality');
    expect(result.suitabilityScore).toBeDefined();
    expect(result.matchupAdjustments).toBeInstanceOf(Array);
  });
});
