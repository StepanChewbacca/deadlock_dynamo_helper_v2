from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    content = target.read_text()
    if content.count(old) != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {content.count(old)}")
    target.write_text(content.replace(old, new, 1))


engine = '''export const EMPTY_INVENTORY_MULTISET_STATE_KEY = 'EMPTY';

export type InventoryMultiset = ReadonlyMap<number, number>;

export type InventoryMultisetActionType =
  | 'BUY'
  | 'REBUY'
  | 'SELL'
  | 'UPGRADE'
  | 'HOLD';

export type InventoryMultisetActionRejectionReason =
  | 'INVALID_ITEM_ID'
  | 'INVALID_OWNED_COUNT_LIMIT'
  | 'OWNED_COUNT_LIMIT_REACHED'
  | 'ITEM_NOT_OWNED'
  | 'RECIPE_COMPONENTS_ABSENT'
  | 'INVALID_RECIPE_COMPONENT'
  | 'MISSING_RECIPE_COMPONENT';

export interface InventoryMultisetAction {
  type: InventoryMultisetActionType;
  itemId?: number;
  componentItemIds?: readonly number[];
  maxOwnedCount?: number;
}

export interface InventoryMultisetActionResult {
  legal: boolean;
  action: InventoryMultisetAction;
  previousStateKey: string;
  nextStateKey: string;
  nextItemCounts: Map<number, number>;
  rejectionReason?: InventoryMultisetActionRejectionReason;
  missingItemId?: number;
  requiredCount?: number;
  availableCount?: number;
}

export interface InventoryMultisetActionSequenceResult {
  legal: boolean;
  steps: InventoryMultisetActionResult[];
  finalItemCounts: Map<number, number>;
  finalStateKey: string;
  failedActionIndex?: number;
}

export function createInventoryMultiset(
  itemIds: readonly number[],
): Map<number, number> {
  const itemCounts = new Map<number, number>();
  for (const itemId of itemIds) {
    if (!isPositiveSafeInteger(itemId)) {
      continue;
    }
    itemCounts.set(itemId, (itemCounts.get(itemId) ?? 0) + 1);
  }
  return itemCounts;
}

export function createInventoryStateKeyFromItemIds(
  itemIds: readonly number[],
): string {
  return createInventoryStateKeyFromMultiset(createInventoryMultiset(itemIds));
}

export function createInventoryStateKeyFromMultiset(
  itemCounts: InventoryMultiset,
): string {
  const tokens = [...itemCounts.entries()]
    .filter(
      ([itemId, count]) =>
        isPositiveSafeInteger(itemId) && isPositiveSafeInteger(count),
    )
    .sort(([leftItemId], [rightItemId]) => leftItemId - rightItemId)
    .map(([itemId, count]) => `${itemId}x${count}`);
  return tokens.join('|') || EMPTY_INVENTORY_MULTISET_STATE_KEY;
}

export function parseInventoryStateKey(
  stateKey: string,
): InventoryMultiset | undefined {
  if (stateKey === EMPTY_INVENTORY_MULTISET_STATE_KEY) {
    return new Map<number, number>();
  }
  if (stateKey.length === 0) {
    return undefined;
  }

  const itemCounts = new Map<number, number>();
  for (const token of stateKey.split('|')) {
    const match = /^([1-9][0-9]*)x([1-9][0-9]*)$/.exec(token);
    if (!match) {
      return undefined;
    }
    const itemId = Number(match[1]);
    const count = Number(match[2]);
    if (!isPositiveSafeInteger(itemId) || !isPositiveSafeInteger(count)) {
      return undefined;
    }
    if (itemCounts.has(itemId)) {
      return undefined;
    }
    itemCounts.set(itemId, count);
  }
  return itemCounts;
}

export function getInventoryItemCount(
  itemCounts: InventoryMultiset,
  itemId: number,
): number {
  return itemCounts.get(itemId) ?? 0;
}

export function applyInventoryMultisetAction(
  currentItemCounts: InventoryMultiset,
  action: InventoryMultisetAction,
): InventoryMultisetActionResult {
  const previousStateKey = createInventoryStateKeyFromMultiset(currentItemCounts);
  const nextItemCounts = cloneInventoryMultiset(currentItemCounts);

  if (action.type === 'HOLD') {
    return createLegalResult(action, previousStateKey, nextItemCounts);
  }

  if (!isPositiveSafeInteger(action.itemId)) {
    return createRejectedResult(
      action,
      previousStateKey,
      nextItemCounts,
      'INVALID_ITEM_ID',
    );
  }
  const itemId = action.itemId;

  if (action.type === 'BUY' || action.type === 'REBUY') {
    if (
      action.maxOwnedCount !== undefined &&
      !isPositiveSafeInteger(action.maxOwnedCount)
    ) {
      return createRejectedResult(
        action,
        previousStateKey,
        nextItemCounts,
        'INVALID_OWNED_COUNT_LIMIT',
      );
    }
    const currentOwnedCount = getInventoryItemCount(nextItemCounts, itemId);
    if (
      action.maxOwnedCount !== undefined &&
      currentOwnedCount >= action.maxOwnedCount
    ) {
      return createRejectedResult(
        action,
        previousStateKey,
        nextItemCounts,
        'OWNED_COUNT_LIMIT_REACHED',
      );
    }
    incrementItemCount(nextItemCounts, itemId);
    return createLegalResult(action, previousStateKey, nextItemCounts);
  }

  if (action.type === 'SELL') {
    if (!decrementItemCount(nextItemCounts, itemId)) {
      return createRejectedResult(
        action,
        previousStateKey,
        nextItemCounts,
        'ITEM_NOT_OWNED',
      );
    }
    return createLegalResult(action, previousStateKey, nextItemCounts);
  }

  const componentItemIds = action.componentItemIds ?? [];
  if (componentItemIds.length === 0) {
    return createRejectedResult(
      action,
      previousStateKey,
      nextItemCounts,
      'RECIPE_COMPONENTS_ABSENT',
    );
  }
  const requiredCounts = new Map<number, number>();
  for (const componentItemId of componentItemIds) {
    if (!isPositiveSafeInteger(componentItemId) || componentItemId === itemId) {
      return createRejectedResult(
        action,
        previousStateKey,
        nextItemCounts,
        'INVALID_RECIPE_COMPONENT',
      );
    }
    requiredCounts.set(
      componentItemId,
      (requiredCounts.get(componentItemId) ?? 0) + 1,
    );
  }
  for (const [componentItemId, requiredCount] of requiredCounts) {
    const availableCount = getInventoryItemCount(
      nextItemCounts,
      componentItemId,
    );
    if (availableCount < requiredCount) {
      return {
        ...createRejectedResult(
          action,
          previousStateKey,
          nextItemCounts,
          'MISSING_RECIPE_COMPONENT',
        ),
        missingItemId: componentItemId,
        requiredCount,
        availableCount,
      };
    }
  }
  for (const [componentItemId, requiredCount] of requiredCounts) {
    for (let index = 0; index < requiredCount; index += 1) {
      decrementItemCount(nextItemCounts, componentItemId);
    }
  }
  incrementItemCount(nextItemCounts, itemId);
  return createLegalResult(action, previousStateKey, nextItemCounts);
}

export function applyInventoryMultisetActionSequence(
  initialItemCounts: InventoryMultiset,
  actions: readonly InventoryMultisetAction[],
): InventoryMultisetActionSequenceResult {
  let currentItemCounts = cloneInventoryMultiset(initialItemCounts);
  const steps: InventoryMultisetActionResult[] = [];

  for (const [index, action] of actions.entries()) {
    const result = applyInventoryMultisetAction(currentItemCounts, action);
    steps.push(result);
    if (!result.legal) {
      return {
        legal: false,
        steps,
        finalItemCounts: currentItemCounts,
        finalStateKey: createInventoryStateKeyFromMultiset(currentItemCounts),
        failedActionIndex: index,
      };
    }
    currentItemCounts = result.nextItemCounts;
  }

  return {
    legal: true,
    steps,
    finalItemCounts: currentItemCounts,
    finalStateKey: createInventoryStateKeyFromMultiset(currentItemCounts),
  };
}

function cloneInventoryMultiset(
  itemCounts: InventoryMultiset,
): Map<number, number> {
  return new Map(
    [...itemCounts.entries()].filter(
      ([itemId, count]) =>
        isPositiveSafeInteger(itemId) && isPositiveSafeInteger(count),
    ),
  );
}

function createLegalResult(
  action: InventoryMultisetAction,
  previousStateKey: string,
  nextItemCounts: Map<number, number>,
): InventoryMultisetActionResult {
  return {
    legal: true,
    action: { ...action },
    previousStateKey,
    nextStateKey: createInventoryStateKeyFromMultiset(nextItemCounts),
    nextItemCounts,
  };
}

function createRejectedResult(
  action: InventoryMultisetAction,
  previousStateKey: string,
  nextItemCounts: Map<number, number>,
  rejectionReason: InventoryMultisetActionRejectionReason,
): InventoryMultisetActionResult {
  return {
    legal: false,
    action: { ...action },
    previousStateKey,
    nextStateKey: previousStateKey,
    nextItemCounts,
    rejectionReason,
  };
}

function incrementItemCount(
  itemCounts: Map<number, number>,
  itemId: number,
): void {
  itemCounts.set(itemId, (itemCounts.get(itemId) ?? 0) + 1);
}

function decrementItemCount(
  itemCounts: Map<number, number>,
  itemId: number,
): boolean {
  const count = itemCounts.get(itemId) ?? 0;
  if (count <= 0) {
    return false;
  }
  if (count === 1) {
    itemCounts.delete(itemId);
  } else {
    itemCounts.set(itemId, count - 1);
  }
  return true;
}

function isPositiveSafeInteger(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
'''
(ROOT / 'apps/api/src/deadlock-live/inventory-multiset-action-engine.ts').write_text(engine)

engine_spec = '''import {
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
'''
(ROOT / 'apps/api/test/inventory-multiset-action-engine.spec.ts').write_text(engine_spec)

replace_once(
    'apps/api/src/deadlock-live/recipe-aware-timeline-reconciliation.service.ts',
    '''      const componentItemIds = nextRecipes.get(parentItemId) ?? [];
      if (!componentItemIds.includes(componentItemId)) {
        componentItemIds.push(componentItemId);
      }
      nextRecipes.set(parentItemId, componentItemIds);''',
    '''      const componentItemIds = nextRecipes.get(parentItemId) ?? [];
      componentItemIds.push(componentItemId);
      nextRecipes.set(parentItemId, componentItemIds);''',
)
replace_once(
    'apps/api/src/deadlock-live/recipe-aware-timeline-reconciliation.service.ts',
    '''      const componentSellActions: CanonicalItemAction[] = [];
      let complete = true;
      for (const componentItemId of requiredComponentItemIds) {
        const candidates = sellsByItemId.get(componentItemId) ?? [];
        if (candidates.length !== 1) {
          complete = false;
          break;
        }
        componentSellActions.push(candidates[0]);
      }

      if (complete) {
        proposals.push({ parentAction: action, componentSellActions });
      }''',
    '''      const componentSellActions: CanonicalItemAction[] = [];
      let complete = true;
      for (const [componentItemId, requiredCount] of countItemIds(
        requiredComponentItemIds,
      )) {
        const candidates = sellsByItemId.get(componentItemId) ?? [];
        if (candidates.length !== requiredCount) {
          complete = false;
          break;
        }
        componentSellActions.push(...candidates);
      }

      if (complete) {
        proposals.push({ parentAction: action, componentSellActions });
      }''',
)
replace_once(
    'apps/api/src/deadlock-live/recipe-aware-timeline-reconciliation.service.ts',
    '''function groupActionsByTime(actions: CanonicalItemAction[]): CanonicalItemAction[][] {''',
    '''function countItemIds(itemIds: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const itemId of itemIds) {
    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  return counts;
}

function groupActionsByTime(actions: CanonicalItemAction[]): CanonicalItemAction[][] {''',
)

recommendation_path = 'apps/api/src/deadlock-live/hero-build-recommendation.service.ts'
replace_once(
    recommendation_path,
    '''import { Injectable } from '@nestjs/common';
import {
  createInventoryStateKeyFromItemIds,''',
    '''import { Injectable } from '@nestjs/common';
import {
  applyInventoryMultisetAction,
  createInventoryMultiset,
  createInventoryStateKeyFromMultiset,
  parseInventoryStateKey,
  type InventoryMultiset,
} from './inventory-multiset-action-engine';
import {
  createInventoryStateKeyFromItemIds,''',
)
replace_once(
    recommendation_path,
    '''type InventoryItemCounts = ReadonlyMap<number, number>;''',
    '''type InventoryItemCounts = InventoryMultiset;''',
)
replace_once(
    recommendation_path,
    '''export function parseInventoryStateKey(stateKey: string): InventoryItemCounts | undefined {
  if (stateKey === 'EMPTY') {
    return new Map<number, number>();
  }
  if (stateKey.length === 0) {
    return undefined;
  }

  const itemCounts = new Map<number, number>();
  for (const token of stateKey.split('|')) {
    const match = /^([1-9][0-9]*)x([1-9][0-9]*)$/.exec(token);
    if (!match) {
      return undefined;
    }

    const itemId = Number(match[1]);
    const count = Number(match[2]);
    if (!Number.isSafeInteger(itemId) || !Number.isSafeInteger(count)) {
      return undefined;
    }
    itemCounts.set(itemId, count);
  }

  return itemCounts;
}''',
    '''export { parseInventoryStateKey };''',
)
replace_once(
    recommendation_path,
    '''  const predictedItemCounts = new Map(requestedItemCounts);

  if (historicalAction.actionType === 'BUY' || historicalAction.actionType === 'REBUY') {
    const currentOwnedCount = requestedItemCounts.get(historicalAction.itemId) ?? 0;
    const observedOwnedCountLimit = resolveObservedOwnedCountLimit(
      historicalAction,
      matchedItemCounts,
    );
    if (currentOwnedCount >= observedOwnedCountLimit) {
      return undefined;
    }

    incrementItemCount(predictedItemCounts, historicalAction.itemId);
    return {
      type: 'BUY',
      predictedItemCounts,
      currentOwnedCount,
      observedOwnedCountLimit,
    };
  }

  if (historicalAction.actionType === 'SELL') {
    if (!decrementItemCount(predictedItemCounts, historicalAction.itemId)) {
      return undefined;
    }
    return { type: 'SELL', predictedItemCounts };
  }

  const componentItemIds = recipeResolver(historicalAction.itemId);
  if (componentItemIds.length === 0) {
    return undefined;
  }

  for (const componentItemId of componentItemIds) {
    if (!decrementItemCount(predictedItemCounts, componentItemId)) {
      return undefined;
    }
  }
  incrementItemCount(predictedItemCounts, historicalAction.itemId);
  return { type: 'UPGRADE', predictedItemCounts };''',
    '''  if (historicalAction.actionType === 'BUY' || historicalAction.actionType === 'REBUY') {
    const currentOwnedCount = requestedItemCounts.get(historicalAction.itemId) ?? 0;
    const observedOwnedCountLimit = resolveObservedOwnedCountLimit(
      historicalAction,
      matchedItemCounts,
    );
    const applied = applyInventoryMultisetAction(requestedItemCounts, {
      type: historicalAction.actionType,
      itemId: historicalAction.itemId,
      maxOwnedCount: observedOwnedCountLimit,
    });
    if (!applied.legal) {
      return undefined;
    }
    return {
      type: 'BUY',
      predictedItemCounts: applied.nextItemCounts,
      currentOwnedCount,
      observedOwnedCountLimit,
    };
  }

  if (historicalAction.actionType === 'SELL') {
    const applied = applyInventoryMultisetAction(requestedItemCounts, {
      type: 'SELL',
      itemId: historicalAction.itemId,
    });
    return applied.legal
      ? { type: 'SELL', predictedItemCounts: applied.nextItemCounts }
      : undefined;
  }

  const applied = applyInventoryMultisetAction(requestedItemCounts, {
    type: 'UPGRADE',
    itemId: historicalAction.itemId,
    componentItemIds: recipeResolver(historicalAction.itemId),
  });
  return applied.legal
    ? { type: 'UPGRADE', predictedItemCounts: applied.nextItemCounts }
    : undefined;''',
)
replace_once(
    recommendation_path,
    '''function createItemCounts(itemIds: readonly number[]): Map<number, number> {
  const itemCounts = new Map<number, number>();
  for (const itemId of itemIds) {
    incrementItemCount(itemCounts, itemId);
  }
  return itemCounts;
}''',
    '''function createItemCounts(itemIds: readonly number[]): Map<number, number> {
  return createInventoryMultiset(itemIds);
}''',
)
replace_once(
    recommendation_path,
    '''function createStateKeyFromCounts(itemCounts: InventoryItemCounts): string {
  if (itemCounts.size === 0) {
    return 'EMPTY';
  }

  return [...itemCounts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([leftItemId], [rightItemId]) => leftItemId - rightItemId)
    .map(([itemId, count]) => `${itemId}x${count}`)
    .join('|') || 'EMPTY';
}

function incrementItemCount(itemCounts: Map<number, number>, itemId: number): void {
  itemCounts.set(itemId, (itemCounts.get(itemId) ?? 0) + 1);
}

function decrementItemCount(itemCounts: Map<number, number>, itemId: number): boolean {
  const count = itemCounts.get(itemId) ?? 0;
  if (count <= 0) {
    return false;
  }
  if (count === 1) {
    itemCounts.delete(itemId);
  } else {
    itemCounts.set(itemId, count - 1);
  }
  return true;
}''',
    '''function createStateKeyFromCounts(itemCounts: InventoryItemCounts): string {
  return createInventoryStateKeyFromMultiset(itemCounts);
}''',
)

recipe_spec_path = 'apps/api/test/recipe-aware-timeline-reconciliation.spec.ts'
replace_once(
    recipe_spec_path,
    '''  it('does not infer an upgrade when a required component sale is missing', async () => {''',
    '''  it('preserves repeated recipe components and consumes distinct duplicate instances', async () => {
    const service = await createService([
      { parentItemId: 300, componentItemId: 100, componentOrder: 0 },
      { parentItemId: 300, componentItemId: 100, componentOrder: 1 },
    ]);
    const observed = new MatchTimelineNormalizationService().normalizePlayer(
      createPlayer([
        { id: 1, itemId: 100, purchaseTimeS: 30, soldTimeS: 120 },
        { id: 2, itemId: 100, purchaseTimeS: 60, soldTimeS: 120 },
        { id: 3, itemId: 300, purchaseTimeS: 120 },
      ]),
    );

    const timeline = service.reconcilePlayer(observed);

    expect(timeline.actions.map((action) => action.type)).toEqual([
      'BUY',
      'BUY',
      'UPGRADE',
    ]);
    expect(timeline.actions[2]).toMatchObject({
      consumedComponentItemIds: [100, 100],
      consumedComponentInstanceIds: ['7:1', '7:2'],
    });
  });

  it('does not infer an upgrade when a required component sale is missing', async () => {''',
)

recommendation_spec_path = 'apps/api/test/hero-build-recommendation.spec.ts'
replace_once(
    recommendation_spec_path,
    '''  it('normalizes a historical rebuy into a buy recommendation', () => {''',
    '''  it('requires repeated recipe component multiplicity for upgrades', () => {
    const state = createState(
      '10x2',
      10,
      [createAction('UPGRADE', 30, 8, 0.8, 300)],
    );
    const policy = createPolicy(72, [state]);
    const recipeResolver = (parentItemId: number) =>
      parentItemId === 30 ? [10, 10] : [];

    const complete = recommendFromPolicy(
      { heroId: 72, itemIds: [10, 10], gameTimeS: 300 },
      '10x2',
      policy,
      parseStates([state]),
      recipeResolver,
      OPTIONS,
    );
    const incomplete = recommendFromPolicy(
      { heroId: 72, itemIds: [10], gameTimeS: 300 },
      '10x1',
      policy,
      parseStates([state]),
      recipeResolver,
      OPTIONS,
    );

    expect(complete.action.type).toBe('UPGRADE');
    expect(complete.action.predictedStateKey).toBe('30x1');
    expect(incomplete.action.type).toBe('HOLD');
    expect(incomplete.noMatchReason).toBe('NO_LEGAL_ACTION');
  });

  it('normalizes a historical rebuy into a buy recommendation', () => {''',
)
