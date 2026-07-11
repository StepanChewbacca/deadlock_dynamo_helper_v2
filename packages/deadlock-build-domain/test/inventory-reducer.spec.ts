import {
  applyInventoryAction,
  createEmptyInventoryState,
  createRecipeGraph,
  DEFAULT_INVENTORY_RULESET,
} from '../src';

const metadata = {
  observedAtMs: 1,
  evidence: 'DERIVED' as const,
  source: 'OVERWOLF_SNAPSHOT' as const,
};

const recipeGraph = createRecipeGraph([]);

describe('applyInventoryAction', () => {
  it('rejects duplicate held item instances', () => {
    const first = applyInventoryAction(
      createEmptyInventoryState(),
      { type: 'BUY', item: { itemId: 1 }, metadata },
      { recipeGraph },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const duplicate = applyInventoryAction(
      first.state,
      { type: 'BUY', item: { itemId: 1 }, metadata },
      { recipeGraph },
    );
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_ITEM_NOT_ALLOWED' },
    });
  });

  it('creates a new lifecycle instance after removal and rebuy', () => {
    const first = applyInventoryAction(
      createEmptyInventoryState(),
      { type: 'BUY', item: { itemId: 1 }, metadata },
      { recipeGraph },
    );
    if (!first.ok) throw new Error(first.error.message);
    const firstInstanceId = first.state.heldByItemId.get(1)?.instanceId;

    const sold = applyInventoryAction(first.state, { type: 'SELL', itemId: 1, metadata }, { recipeGraph });
    if (!sold.ok) throw new Error(sold.error.message);
    const rebought = applyInventoryAction(
      sold.state,
      { type: 'REBUY', item: { itemId: 1 }, metadata },
      { recipeGraph },
    );
    if (!rebought.ok) throw new Error(rebought.error.message);

    expect(rebought.state.heldByItemId.get(1)).toMatchObject({ lifecycle: 2, acquiredBy: 'REBUY' });
    expect(rebought.state.heldByItemId.get(1)?.instanceId).not.toBe(firstInstanceId);
  });

  it('uses all configured flex slots before rejecting inventory', () => {
    let state = createEmptyInventoryState();
    for (let itemId = 1; itemId <= 8; itemId++) {
      const result = applyInventoryAction(
        state,
        { type: 'BUY', item: { itemId, slotType: 'weapon' }, metadata },
        { recipeGraph, ruleset: DEFAULT_INVENTORY_RULESET },
      );
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }

    const overflow = applyInventoryAction(
      state,
      { type: 'BUY', item: { itemId: 9, slotType: 'weapon' }, metadata },
      { recipeGraph, ruleset: DEFAULT_INVENTORY_RULESET },
    );
    expect(overflow).toMatchObject({ ok: false, error: { code: 'SLOT_LIMIT_EXCEEDED' } });
  });
});
