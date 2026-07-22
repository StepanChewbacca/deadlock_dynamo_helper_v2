import { Match } from '../src/deadlock-live/entities/match.entity';
import { MatchPlayer } from '../src/deadlock-live/entities/match-player.entity';
import { MatchPlayerItem } from '../src/deadlock-live/entities/match-player-item.entity';
import { MatchPlayerSkillUpgrade } from '../src/deadlock-live/entities/match-player-skill-upgrade.entity';
import {
  chunkValues,
  getRecentMatchCutoff,
  RECENT_MATCH_QUERY_BATCH_SIZE,
  RECENT_MATCH_REFRESH_INTERVAL_MS,
  RECENT_MATCH_TARGET_COUNT,
  RECENT_MATCH_WINDOW_DAYS,
  toRecentMatchSnapshot,
} from '../src/deadlock-live/recent-matches-window.service';

describe('recent matches window', () => {
  it('uses an exact rolling fourteen-day cutoff capped at 50,000 matches', () => {
    const now = new Date('2026-07-12T12:00:00.000Z');

    expect(RECENT_MATCH_WINDOW_DAYS).toBe(14);
    expect(RECENT_MATCH_TARGET_COUNT).toBe(50_000);
    expect(RECENT_MATCH_REFRESH_INTERVAL_MS).toBe(300_000);
    expect(getRecentMatchCutoff(now).toISOString()).toBe('2026-06-28T12:00:00.000Z');
  });

  it('splits database identifiers into bounded batches', () => {
    const values = Array.from(
      { length: RECENT_MATCH_QUERY_BATCH_SIZE * 2 + 1 },
      (_, index) => index + 1,
    );

    const batches = chunkValues(values, RECENT_MATCH_QUERY_BATCH_SIZE);

    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(RECENT_MATCH_QUERY_BATCH_SIZE);
    expect(batches[1]).toHaveLength(RECENT_MATCH_QUERY_BATCH_SIZE);
    expect(batches[2]).toEqual([RECENT_MATCH_QUERY_BATCH_SIZE * 2 + 1]);
  });

  it('creates a version-independent snapshot with ordered item and skill timelines', () => {
    const lateItem = createItem({
      id: 12,
      itemId: 200,
      purchaseTimeS: 420,
      slotOrder: 2,
      soldTimeS: 700,
    });
    const earlyItem = createItem({
      id: 11,
      itemId: 100,
      purchaseTimeS: 120,
      slotOrder: 1,
    });
    const secondSkill = createSkill({
      id: 22,
      abilityId: 4,
      upgradeOrder: 1,
      upgradeTimeS: 240,
    });
    const firstSkill = createSkill({
      id: 21,
      abilityId: 1,
      upgradeOrder: 0,
      upgradeTimeS: 90,
    });

    const player = Object.assign(new MatchPlayer(), {
      id: 7,
      matchId: 91825430,
      heroId: 11,
      team: 0,
      won: true,
      kills: 8,
      deaths: 2,
      assists: 14,
      netWorth: 54000,
      itemPurchases: [lateItem, earlyItem],
      skillUpgrades: [secondSkill, firstSkill],
    });

    const match = Object.assign(new Match(), {
      matchId: 91825430,
      startTime: new Date('2026-07-10T13:07:49.000Z'),
      durationS: 2400,
      averageBadge: 116,
      winningTeam: 0,
      players: [player],
    });

    const snapshot = toRecentMatchSnapshot(match);

    expect(snapshot.matchId).toBe(91825430);
    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.players[0].itemPurchases.map((item) => item.itemId)).toEqual([
      100,
      200,
    ]);
    expect(snapshot.players[0].itemPurchases[1].soldTimeS).toBe(700);
    expect(snapshot.players[0].skillUpgrades.map((skill) => skill.abilityId)).toEqual([
      1,
      4,
    ]);
    expect(Object.keys(snapshot)).not.toContain('clientVersion');
    expect(Object.keys(snapshot)).not.toContain('rulesetId');
    expect(Object.keys(snapshot)).not.toContain('catalogVersionId');
  });
});

function createItem(values: Partial<MatchPlayerItem>): MatchPlayerItem {
  return Object.assign(new MatchPlayerItem(), {
    id: 0,
    matchPlayerId: 7,
    itemId: 0,
    purchaseTimeS: null,
    soldTimeS: null,
    upgradeId: null,
    flags: null,
    imbuedAbilityId: null,
    upgradeInfo: null,
    slotOrder: null,
    ...values,
  });
}

function createSkill(
  values: Partial<MatchPlayerSkillUpgrade>,
): MatchPlayerSkillUpgrade {
  return Object.assign(new MatchPlayerSkillUpgrade(), {
    id: 0,
    matchPlayerId: 7,
    abilityId: 0,
    upgradeOrder: 0,
    upgradeTimeS: null,
    ...values,
  });
}
