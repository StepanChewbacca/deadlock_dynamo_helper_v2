import {
  applyInventoryMultisetAction,
  applyInventoryMultisetActionSequence,
  createInventoryMultiset,
  createInventoryStateKeyFromMultiset,
} from '../src/deadlock-live/inventory-multiset-action-engine';

describe('inventory multiset action engine', () => {
  it('buys duplicate copies up to an explicit owned-count limit', () => {
    const first = applyInventoryMultisetAction(createInventoryMultiset([]), {
      type: 'BUY',
      itemId: 100,
      maxOwnedCount: 2,
    });
    const second = applyInventoryMultisetAction(first.nextItemCounts, {
      type: 'BUY',
      itemId: 100,
      maxOwnedCount: 2,
    });
    const third = applyInventoryMultisetAction(second.nextItemCounts, {
      type: 'BUY',
      itemId: 100,
      maxOwnedCount: 2,
    });

    expect(first.legal).toBe(true);
    expect(second.nextStateKey).toBe('100x2');
    expect(third).toMatchObject({
      legal: false,
      rejectionReason: 'OWNED_COUNT_LIMIT_REACHED',
      nextStateKey: '100x2',
    });
  });

  it('sells exactly one of two identical items', () => {
    const result = applyInventoryMultisetAction(
      createInventoryMultiset([100, 100, 200]),
      { type: 'SELL', itemId: 100 },
    );

    expect(result.legal).toBe(true);
    expect(result.nextStateKey).toBe('100x1|200x1');
  });

  it('supports a deterministic sell then rebuy lifecycle', () => {
    const result = applyInventoryMultisetActionSequence(
      createInventoryMultiset([100]),
      [
        { type: 'SELL', itemId: 100 },
        { type: 'REBUY', itemId: 100 },
      ],
    );

    expect(result.legal).toBe(true);
    expect(result.steps.map((step) => step.nextStateKey)).toEqual([
      'EMPTY',
      '100x1',
    ]);
    expect(result.finalStateKey).toBe('100x1');
  });

  it('consumes repeated recipe components by multiplicity', () => {
    const result = applyInventoryMultisetAction(
      createInventoryMultiset([100, 100, 200]),
      {
        type: 'UPGRADE',
        itemId: 300,
        componentItemIds: [100, 100, 200],
      },
    );

    expect(result.legal).toBe(true);
    expect(result.nextStateKey).toBe('300x1');
  });

  it('rejects an upgrade without enough repeated components atomically', () => {
    const initial = createInventoryMultiset([100, 200]);
    const result = applyInventoryMultisetAction(initial, {
      type: 'UPGRADE',
      itemId: 300,
      componentItemIds: [100, 100, 200],
    });

    expect(result).toMatchObject({
      legal: false,
      rejectionReason: 'MISSING_RECIPE_COMPONENT',
      missingItemId: 100,
      requiredCount: 2,
      availableCount: 1,
      nextStateKey: '100x1|200x1',
    });
    expect(createInventoryStateKeyFromMultiset(initial)).toBe('100x1|200x1');
  });

  it('keeps HOLD immutable and serializes states deterministically', () => {
    const initial = createInventoryMultiset([300, 100, 300]);
    const result = applyInventoryMultisetAction(initial, { type: 'HOLD' });

    expect(result.legal).toBe(true);
    expect(result.previousStateKey).toBe('100x1|300x2');
    expect(result.nextStateKey).toBe('100x1|300x2');
    expect(result.nextItemCounts).not.toBe(initial);
  });
});
