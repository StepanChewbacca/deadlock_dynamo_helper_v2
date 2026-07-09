import { Test } from '@nestjs/testing';
import { HeroAnalysisService, DynamoMatchData } from '../src/deadlock-live/hero-analysis.service';
import * as fs from 'fs';

describe('HeroAnalysisService', () => {
  let service: HeroAnalysisService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [HeroAnalysisService],
    }).compile();

    service = moduleRef.get(HeroAnalysisService);
  });

  it('correctly aggregates and clusters builds', () => {
    // Inject mock matches directly into cachedMatches
    const mockMatches: Record<number, DynamoMatchData> = {
      1: {
        matchId: 1,
        averageBadge: 80,
        win: true,
        kills: 5,
        deaths: 2,
        assists: 15,
        netWorth: 15000,
        items: [
          { id: 101, name: 'Healing Rite', className: 'upgrade_health_stimpak', slotType: 'vitality', cost: 800, buyTimeS: 200 },
          { id: 102, name: 'Restorative Locket', className: 'upgrade_restorative_locket', slotType: 'vitality', cost: 1600, buyTimeS: 500 },
          { id: 103, name: 'Rescue Beam', className: 'upgrade_rescue_beam', slotType: 'vitality', cost: 3200, buyTimeS: 1100 },
        ],
      },
      2: {
        matchId: 2,
        averageBadge: 70,
        win: false,
        kills: 8,
        deaths: 4,
        assists: 6,
        netWorth: 18000,
        items: [
          { id: 201, name: 'Kinetic Dash', className: 'upgrade_kinetic_dash', slotType: 'weapon', cost: 800, buyTimeS: 150 },
          { id: 202, name: 'Lucky Shot', className: 'upgrade_lucky_shot', slotType: 'weapon', cost: 6200, buyTimeS: 1300 },
        ],
      },
      3: {
        matchId: 3,
        averageBadge: 75,
        win: true,
        kills: 4,
        deaths: 1,
        assists: 12,
        netWorth: 14000,
        items: [
          { id: 301, name: 'Mystic Reach', className: 'upgrade_mystic_reach', slotType: 'spirit', cost: 800, buyTimeS: 300 },
          { id: 302, name: 'Improved Reach', className: 'upgrade_improved_reach', slotType: 'spirit', cost: 1600, buyTimeS: 900 },
          { id: 303, name: 'Refresher', className: 'upgrade_curtis_cooldown', slotType: 'spirit', cost: 6200, buyTimeS: 1500 },
        ],
      },
    };

    // Use reflection/casting to bypass private modifier
    (service as any).cachedMatches = mockMatches;

    const result = service.getBuilds();
    expect(result.totalMatches).toBe(3);

    // Support build (match 1 has stimpak, locket, rescue beam -> supportScore >= 2)
    const support = result.builds.find(b => b.name.includes('Support'));
    expect(support).toBeDefined();
    expect(support?.matchesCount).toBe(1);
    expect(support?.winRate).toBe(100);
    expect(support?.earlyGame).toHaveLength(2); // Healing Rite & Restorative Locket bought <= 10m
    expect(support?.midGame).toHaveLength(1); // Rescue Beam bought <= 20m

    // Weapon build (match 2 has 2 weapon items, 0 spirit items -> weaponCount > spiritCount)
    const weapon = result.builds.find(b => b.name.includes('Weapon'));
    expect(weapon).toBeDefined();
    expect(weapon?.matchesCount).toBe(1);
    expect(weapon?.winRate).toBe(0);
    expect(weapon?.earlyGame).toHaveLength(1); // Kinetic Dash
    expect(weapon?.lateGame).toHaveLength(1); // Lucky Shot

    // Spirit build (match 3 has 3 spirit items, 0 weapon items)
    const spirit = result.builds.find(b => b.name.includes('Spirit'));
    expect(spirit).toBeDefined();
    expect(spirit?.matchesCount).toBe(1);
    expect(spirit?.winRate).toBe(100);
    expect(spirit?.earlyGame).toHaveLength(1); // Mystic Reach
    expect(spirit?.midGame).toHaveLength(1); // Improved Reach
    expect(spirit?.lateGame).toHaveLength(1); // Refresher
  });
});
