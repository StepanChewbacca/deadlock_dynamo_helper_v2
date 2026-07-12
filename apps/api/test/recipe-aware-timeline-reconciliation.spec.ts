import { Repository } from 'typeorm';
import { ItemComponent } from '../src/deadlock-live/entities/item-component.entity';
import { MatchTimelineNormalizationService } from '../src/deadlock-live/match-timeline-normalization.service';
import { RecentMatchPlayerSnapshot } from '../src/deadlock-live/recent-matches-window.service';
import { RecipeAwareTimelineReconciliationService } from '../src/deadlock-live/recipe-aware-timeline-reconciliation.service';

describe('RecipeAwareTimelineReconciliationService', () => {
  it('replaces a same-time component sale and parent purchase with one derived upgrade', async () => {
    const service = await createService([
      { parentItemId: 200, componentItemId: 100, componentOrder: 0 },
    ]);
    const observed = new MatchTimelineNormalizationService().normalizePlayer(
      createPlayer([
        { id: 1, itemId: 100, purchaseTimeS: 60, soldTimeS: 180 },
        { id: 2, itemId: 200, purchaseTimeS: 180 },
      ]),
    );

    const timeline = service.reconcilePlayer(observed);

    expect(timeline.actions.map((action) => action.type)).toEqual(['BUY', 'UPGRADE']);
    expect(timeline.actions[1]).toMatchObject({
      itemId: 200,
      instanceId: '7:2',
      evidence: 'recipeGraph',
      evidenceLevel: 'DERIVED',
      confidence: 1,
      consumedComponentItemIds: [100],
      consumedComponentInstanceIds: ['7:1'],
    });
    expect(timeline.actions.map((action) => action.sequence)).toEqual([1, 2]);
  });

  it('requires every direct recipe component to be sold at the parent purchase time', async () => {
    const service = await createService([
      { parentItemId: 300, componentItemId: 100, componentOrder: 0 },
      { parentItemId: 300, componentItemId: 200, componentOrder: 1 },
    ]);
    const observed = new MatchTimelineNormalizationService().normalizePlayer(
      createPlayer([
        { id: 1, itemId: 100, purchaseTimeS: 30, soldTimeS: 120 },
        { id: 2, itemId: 200, purchaseTimeS: 60, soldTimeS: 120 },
        { id: 3, itemId: 300, purchaseTimeS: 120 },
      ]),
    );

    const timeline = service.reconcilePlayer(observed);

    expect(timeline.actions.map((action) => action.type)).toEqual(['BUY', 'BUY', 'UPGRADE']);
    expect(timeline.actions[2]).toMatchObject({
      consumedComponentItemIds: [100, 200],
      consumedComponentInstanceIds: ['7:1', '7:2'],
    });
  });

  it('does not infer an upgrade when a required component sale is missing', async () => {
    const service = await createService([
      { parentItemId: 300, componentItemId: 100, componentOrder: 0 },
      { parentItemId: 300, componentItemId: 200, componentOrder: 1 },
    ]);
    const observed = new MatchTimelineNormalizationService().normalizePlayer(
      createPlayer([
        { id: 1, itemId: 100, purchaseTimeS: 30, soldTimeS: 120 },
        { id: 2, itemId: 200, purchaseTimeS: 60 },
        { id: 3, itemId: 300, purchaseTimeS: 120 },
      ]),
    );

    const timeline = service.reconcilePlayer(observed);

    expect(timeline.actions.map((action) => action.type)).toEqual([
      'BUY',
      'BUY',
      'SELL',
      'BUY',
    ]);
  });

  it('keeps ambiguous duplicate component sales instead of guessing an upgrade', async () => {
    const service = await createService([
      { parentItemId: 200, componentItemId: 100, componentOrder: 0 },
    ]);
    const observed = new MatchTimelineNormalizationService().normalizePlayer(
      createPlayer([
        { id: 1, itemId: 100, purchaseTimeS: 30, soldTimeS: 120 },
        { id: 2, itemId: 100, purchaseTimeS: 60, soldTimeS: 120 },
        { id: 3, itemId: 200, purchaseTimeS: 120 },
      ]),
    );

    const timeline = service.reconcilePlayer(observed);

    expect(timeline.actions.map((action) => action.type)).toEqual([
      'BUY',
      'BUY',
      'SELL',
      'SELL',
      'BUY',
    ]);
  });
});

async function createService(
  rows: Array<Pick<ItemComponent, 'parentItemId' | 'componentItemId' | 'componentOrder'>>,
): Promise<RecipeAwareTimelineReconciliationService> {
  const repository = {
    find: jest.fn().mockResolvedValue(rows),
  } as unknown as Repository<ItemComponent>;
  const service = new RecipeAwareTimelineReconciliationService(repository);
  await service.refreshRecipes();
  return service;
}

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
