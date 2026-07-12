import { MatchTimelineNormalizationService } from '../src/deadlock-live/match-timeline-normalization.service';
import { RecentMatchPlayerSnapshot } from '../src/deadlock-live/recent-matches-window.service';

describe('MatchTimelineNormalizationService', () => {
  const service = new MatchTimelineNormalizationService();

  it('normalizes buy, sell, rebuy and upgrade actions deterministically', () => {
    const timeline = service.normalizePlayer(
      createPlayer([
        { id: 1, itemId: 100, purchaseTimeS: 60, soldTimeS: 180, slotOrder: 1 },
        { id: 2, itemId: 100, purchaseTimeS: 180, slotOrder: 2 },
        { id: 3, itemId: 200, purchaseTimeS: 240, upgradeId: 300, slotOrder: 3 },
      ]),
    );

    expect(timeline.actions.map((action) => action.type)).toEqual([
      'BUY',
      'SELL',
      'REBUY',
      'BUY',
      'UPGRADE',
    ]);
    expect(timeline.actions.map((action) => action.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(timeline.actions[2].instanceId).toBe('7:2');
    expect(timeline.actions[4].relatedItemId).toBe(300);
    expect(timeline.diagnostics).toEqual([]);
  });

  it('does not classify another unsold copy as a rebuy', () => {
    const timeline = service.normalizePlayer(
      createPlayer([
        { id: 1, itemId: 100, purchaseTimeS: 60 },
        { id: 2, itemId: 100, purchaseTimeS: 120 },
      ]),
    );

    expect(timeline.actions.map((action) => action.type)).toEqual(['BUY', 'BUY']);
  });

  it('reports invalid evidence instead of inventing actions', () => {
    const timeline = service.normalizePlayer(
      createPlayer([
        { id: 1, itemId: 100 },
        { id: 2, itemId: 200, purchaseTimeS: 300, soldTimeS: 200 },
        { id: 3, itemId: 300, purchaseTimeS: 400, upgradeId: 300 },
      ]),
    );

    expect(timeline.actions.map((action) => action.type)).toEqual(['BUY', 'BUY']);
    expect(timeline.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'MISSING_PURCHASE_TIME',
      'SOLD_BEFORE_PURCHASE',
      'INVALID_UPGRADE_ID',
    ]);
  });
});

function createPlayer(
  itemPurchases: RecentMatchPlayerSnapshot['itemPurchases'],
): RecentMatchPlayerSnapshot {
  return {
    id: 7,
    matchId: 91825430,
    heroId: 11,
    team: 0,
    won: true,
    kills: 8,
    deaths: 2,
    assists: 14,
    netWorth: 54000,
    itemPurchases,
    skillUpgrades: [],
  };
}
