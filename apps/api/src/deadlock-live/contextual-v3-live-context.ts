export function deriveContextualV3PreviousActionKeys(
  inventorySnapshots: readonly (readonly number[])[],
  recipeResolver: (parentItemId: number) => readonly number[],
): string[] {
  if (inventorySnapshots.length < 2) {
    return [];
  }

  const actions: string[] = [];
  let previous = createItemCounts(inventorySnapshots[0]);

  for (const snapshot of inventorySnapshots.slice(1)) {
    const next = createItemCounts(snapshot);
    if (sameItemCounts(previous, next)) {
      continue;
    }
    const additions = subtractItemCounts(next, previous);
    const removals = subtractItemCounts(previous, next);

    for (const itemId of [...additions.keys()].sort((left, right) => left - right)) {
      while ((additions.get(itemId) ?? 0) > 0) {
        const components = recipeResolver(itemId);
        if (
          components.length === 0 ||
          !components.every(
            (componentItemId) => (removals.get(componentItemId) ?? 0) > 0,
          )
        ) {
          break;
        }
        decrementItemCount(additions, itemId);
        for (const componentItemId of components) {
          decrementItemCount(removals, componentItemId);
        }
        actions.push(`UPGRADE:${itemId}`);
      }
    }

    appendCountedActions(actions, removals, 'SELL');
    appendCountedActions(actions, additions, 'BUY');
    previous = next;
  }

  return actions.slice(0, 64);
}

function createItemCounts(itemIds: readonly number[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const itemId of itemIds) {
    if (Number.isSafeInteger(itemId) && itemId > 0) {
      result.set(itemId, (result.get(itemId) ?? 0) + 1);
    }
  }
  return result;
}

function subtractItemCounts(
  left: ReadonlyMap<number, number>,
  right: ReadonlyMap<number, number>,
): Map<number, number> {
  const result = new Map<number, number>();
  for (const [itemId, count] of left) {
    const difference = count - (right.get(itemId) ?? 0);
    if (difference > 0) {
      result.set(itemId, difference);
    }
  }
  return result;
}

function sameItemCounts(
  left: ReadonlyMap<number, number>,
  right: ReadonlyMap<number, number>,
): boolean {
  return (
    left.size === right.size &&
    [...left].every(([itemId, count]) => right.get(itemId) === count)
  );
}

function decrementItemCount(counts: Map<number, number>, itemId: number): void {
  const count = counts.get(itemId) ?? 0;
  if (count <= 1) {
    counts.delete(itemId);
  } else {
    counts.set(itemId, count - 1);
  }
}

function appendCountedActions(
  actions: string[],
  counts: ReadonlyMap<number, number>,
  actionType: 'BUY' | 'SELL',
): void {
  for (const [itemId, count] of [...counts].sort(([left], [right]) => left - right)) {
    for (let index = 0; index < count; index += 1) {
      actions.push(`${actionType}:${itemId}`);
    }
  }
}
