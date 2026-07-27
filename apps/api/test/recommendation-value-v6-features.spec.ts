import {
  buildRecommendationValueV6ActionKeys,
  buildRecommendationValueV6StateKeys,
  classifyRecommendationValueV6TeamEconomy,
} from '../src/deadlock-live/recommendation-value-v6-features';

describe('Recommendation Value V6 shared features', () => {
  it('builds byte-compatible state keys', () => {
    expect(
      buildRecommendationValueV6StateKeys({
        heroId: 15,
        teamId: 1,
        timeBucket: 10,
        inventoryStateKey: '1x1,2x1',
        previousActionKeys: [
          'BUY:1',
          'BUY:2',
          'BUY:3',
          'BUY:4',
          'BUY:5',
          'BUY:6',
        ],
        alliedHeroIds: [20, 21],
        enemyHeroIds: [30, 31],
        inventoryTotalCost: 3_500,
        inventoryHighestTier: 4,
        playerNetWorth: 12_345,
        playerKills: 4,
        playerDeaths: 2,
        playerAssists: 6,
        teamNetWorthDelta: 12_345,
        teamRelativeNetWorthDelta: 0.1,
        playerNetWorthRankInTeam: 1,
        playerNetWorthShare: 0.21,
      }),
    ).toEqual([
      'HERO:15',
      'HERO_TIME:15|10',
      'HERO_TEAM_TIME:15|10|1',
      'HERO_TIME_INVENTORY:15|10|1x1,2x1',
      'HERO_TIME_PREVIOUS:15|10|BUY:2>BUY:3>BUY:4>BUY:5>BUY:6',
      'BUILD_TOTAL_COST:15|3',
      'BUILD_HIGHEST_TIER:15|4',
      'TIMELINE_NET_WORTH:15|12',
      'TIMELINE_KDA:15|4',
      'TEAM_ECONOMY_BAND:15|AHEAD',
      'TEAM_NET_WORTH_DELTA:15|2',
      'TEAM_RELATIVE_NET_WORTH_DELTA:15|2',
      'PLAYER_TEAM_NET_WORTH_RANK:15|1',
      'PLAYER_TEAM_NET_WORTH_SHARE:15|2',
      'ALLY:15|10|20',
      'ALLY:15|10|21',
      'ENEMY:15|10|30',
      'ENEMY:15|10|31',
    ]);
  });

  it('omits unavailable live-only state keys', () => {
    expect(
      buildRecommendationValueV6StateKeys({
        heroId: 15,
        timeBucket: 10,
        inventoryStateKey: 'EMPTY',
        previousActionKeys: [],
        alliedHeroIds: [],
        enemyHeroIds: [],
      }),
    ).toEqual([
      'HERO:15',
      'HERO_TIME:15|10',
      'HERO_TEAM_TIME:15|10|UNKNOWN',
      'HERO_TIME_INVENTORY:15|10|EMPTY',
      'HERO_TIME_PREVIOUS:15|10|EMPTY',
    ]);
  });

  it('builds byte-compatible action keys', () => {
    expect(
      buildRecommendationValueV6ActionKeys({
        heroId: 15,
        timeBucket: 10,
        inventoryStateKey: '1x1,2x1',
        previousActionKeys: [
          'BUY:1',
          'BUY:2',
          'BUY:3',
          'BUY:4',
          'BUY:5',
          'BUY:6',
        ],
        teamEconomyBand: 'AHEAD',
        actionKey: 'BUY:100',
        slotType: 'weapon',
        tier: 3,
        cost: 3_250,
        isActiveItem: true,
        tags: ['burst', 'spirit'],
        interactionKeys: ['HERO_ITEM:15:100'],
      }),
    ).toEqual([
      'HERO_TIME_ACTION:15|10|BUY:100',
      'HERO_TIME_INVENTORY_ACTION:15|10|1x1,2x1|BUY:100',
      'HERO_TIME_PREVIOUS_ACTION:15|10|BUY:2>BUY:3>BUY:4>BUY:5>BUY:6|BUY:100',
      'HERO_TEAM_ECONOMY_ACTION:15|AHEAD|BUY:100',
      'HERO_TEAM_ECONOMY_SLOT:15|AHEAD|weapon',
      'HERO_SLOT:15|weapon',
      'HERO_TIER:15|3',
      'HERO_COST_BUCKET:15|6',
      'HERO_ACTIVE_ITEM:15',
      'HERO_ITEM_TAG:15|burst',
      'HERO_ITEM_TAG:15|spirit',
      'INTERACTION:HERO_ITEM:15:100',
    ]);
  });

  it.each([
    [-0.15, 'FAR_BEHIND'],
    [-0.149, 'BEHIND'],
    [-0.05, 'EVEN'],
    [0.05, 'EVEN'],
    [0.051, 'AHEAD'],
    [0.15, 'FAR_AHEAD'],
  ] as const)('classifies team economy %s as %s', (value, expected) => {
    expect(classifyRecommendationValueV6TeamEconomy(value)).toBe(expected);
  });
});
