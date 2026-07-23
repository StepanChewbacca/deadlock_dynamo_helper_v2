from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    content = target.read_text()
    if content.count(old) != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {content.count(old)}")
    target.write_text(content.replace(old, new, 1))


reconstruction = '''import {
  applyInventoryMultisetActionSequence,
  createInventoryMultiset,
  createInventoryStateKeyFromMultiset,
  type InventoryMultiset,
  type InventoryMultisetAction,
} from './inventory-multiset-action-engine';

export type InventoryTransactionReconstructionConfidence =
  | 'EXACT_SINGLE_ACTION'
  | 'MULTI_ACTION_INTERVAL'
  | 'AMBIGUOUS_MULTI_ACTION'
  | 'UNRESOLVED';

export type ReconstructedInventoryActionType = 'BUY' | 'SELL' | 'UPGRADE';

export interface ReconstructedInventoryAction {
  type: ReconstructedInventoryActionType;
  itemId: number;
  actionKey: string;
  componentItemIds?: number[];
}

export interface InventoryTransactionReconstructionResult {
  previousStateKey: string;
  currentStateKey: string;
  actions: ReconstructedInventoryAction[];
  actionKeys: string[];
  confidence: InventoryTransactionReconstructionConfidence;
  resolved: boolean;
  ambiguous: boolean;
}

interface UpgradePlanSearchResult {
  consumedComponentCount: number;
  upgradePlans: number[][];
}

const MAX_DISTINCT_OPTIMAL_PLANS = 2;

export function reconstructInventoryTransaction(
  previousItemIds: readonly number[],
  currentItemIds: readonly number[],
  recipeResolver: (parentItemId: number) => readonly number[],
): InventoryTransactionReconstructionResult {
  const previousItemCounts = createInventoryMultiset(previousItemIds);
  const currentItemCounts = createInventoryMultiset(currentItemIds);
  const previousStateKey = createInventoryStateKeyFromMultiset(
    previousItemCounts,
  );
  const currentStateKey = createInventoryStateKeyFromMultiset(currentItemCounts);

  if (previousStateKey === currentStateKey) {
    return createResult(
      previousStateKey,
      currentStateKey,
      [],
      true,
      false,
    );
  }

  const additions = subtractItemCounts(currentItemCounts, previousItemCounts);
  const removals = subtractItemCounts(previousItemCounts, currentItemCounts);
  const addedItemIds = expandItemCounts(additions);
  const planSearch = findOptimalUpgradePlans(
    addedItemIds,
    removals,
    recipeResolver,
  );
  const selectedUpgradeItemIds = planSearch.upgradePlans[0] ?? [];
  const remainingAdditions = new Map(additions);
  const remainingRemovals = new Map(removals);
  const actions: ReconstructedInventoryAction[] = [];

  for (const itemId of selectedUpgradeItemIds) {
    const componentItemIds = normalizeRecipe(
      recipeResolver(itemId),
      itemId,
    );
    if (
      !componentItemIds ||
      !decrementItemCount(remainingAdditions, itemId) ||
      !consumeItemCounts(remainingRemovals, componentItemIds)
    ) {
      return createResult(
        previousStateKey,
        currentStateKey,
        [],
        false,
        false,
      );
    }
    actions.push({
      type: 'UPGRADE',
      itemId,
      actionKey: `UPGRADE:${itemId}`,
      componentItemIds: [...componentItemIds],
    });
  }

  appendCountedActions(actions, remainingRemovals, 'SELL');
  appendCountedActions(actions, remainingAdditions, 'BUY');

  const replay = applyInventoryMultisetActionSequence(
    previousItemCounts,
    actions.map(toMultisetAction),
  );
  if (!replay.legal || replay.finalStateKey !== currentStateKey) {
    return createResult(
      previousStateKey,
      currentStateKey,
      actions,
      false,
      false,
    );
  }

  return createResult(
    previousStateKey,
    currentStateKey,
    actions,
    true,
    planSearch.upgradePlans.length > 1,
  );
}

function findOptimalUpgradePlans(
  addedItemIds: readonly number[],
  removals: InventoryMultiset,
  recipeResolver: (parentItemId: number) => readonly number[],
): UpgradePlanSearchResult {
  const memo = new Map<string, UpgradePlanSearchResult>();

  const visit = (
    index: number,
    availableRemovals: InventoryMultiset,
  ): UpgradePlanSearchResult => {
    if (index >= addedItemIds.length) {
      return { consumedComponentCount: 0, upgradePlans: [[]] };
    }

    const memoKey = `${index}:${createInventoryStateKeyFromMultiset(
      availableRemovals,
    )}`;
    const cached = memo.get(memoKey);
    if (cached) {
      return cached;
    }

    const itemId = addedItemIds[index];
    const buyResult = visit(index + 1, availableRemovals);
    let best: UpgradePlanSearchResult = {
      consumedComponentCount: buyResult.consumedComponentCount,
      upgradePlans: buyResult.upgradePlans.map((plan) => [...plan]),
    };

    const componentItemIds = normalizeRecipe(recipeResolver(itemId), itemId);
    if (componentItemIds && hasItemCounts(availableRemovals, componentItemIds)) {
      const remainingRemovals = new Map(availableRemovals);
      consumeItemCounts(remainingRemovals, componentItemIds);
      const upgradeResult = visit(index + 1, remainingRemovals);
      const candidate: UpgradePlanSearchResult = {
        consumedComponentCount:
          upgradeResult.consumedComponentCount + componentItemIds.length,
        upgradePlans: upgradeResult.upgradePlans.map((plan) => [
          itemId,
          ...plan,
        ]),
      };
      best = selectBetterPlanSearchResult(best, candidate);
    }

    const normalized = normalizePlanSearchResult(best);
    memo.set(memoKey, normalized);
    return normalized;
  };

  return visit(0, removals);
}

function selectBetterPlanSearchResult(
  left: UpgradePlanSearchResult,
  right: UpgradePlanSearchResult,
): UpgradePlanSearchResult {
  if (left.consumedComponentCount > right.consumedComponentCount) {
    return left;
  }
  if (right.consumedComponentCount > left.consumedComponentCount) {
    return right;
  }
  return {
    consumedComponentCount: left.consumedComponentCount,
    upgradePlans: [...left.upgradePlans, ...right.upgradePlans],
  };
}

function normalizePlanSearchResult(
  result: UpgradePlanSearchResult,
): UpgradePlanSearchResult {
  const uniquePlans = new Map<string, number[]>();
  for (const plan of result.upgradePlans) {
    const normalizedPlan = [...plan].sort((left, right) => left - right);
    uniquePlans.set(createUpgradePlanKey(normalizedPlan), normalizedPlan);
  }
  return {
    consumedComponentCount: result.consumedComponentCount,
    upgradePlans: [...uniquePlans.values()]
      .sort(compareUpgradePlans)
      .slice(0, MAX_DISTINCT_OPTIMAL_PLANS),
  };
}

function normalizeRecipe(
  componentItemIds: readonly number[],
  parentItemId: number,
): number[] | undefined {
  if (componentItemIds.length === 0) {
    return undefined;
  }
  const normalized = [...componentItemIds].sort((left, right) => left - right);
  if (
    normalized.some(
      (componentItemId) =>
        !Number.isSafeInteger(componentItemId) ||
        componentItemId <= 0 ||
        componentItemId === parentItemId,
    )
  ) {
    return undefined;
  }
  return normalized;
}

function subtractItemCounts(
  left: InventoryMultiset,
  right: InventoryMultiset,
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

function expandItemCounts(itemCounts: InventoryMultiset): number[] {
  const itemIds: number[] = [];
  for (const [itemId, count] of [...itemCounts.entries()].sort(
    ([leftItemId], [rightItemId]) => leftItemId - rightItemId,
  )) {
    for (let index = 0; index < count; index += 1) {
      itemIds.push(itemId);
    }
  }
  return itemIds;
}

function hasItemCounts(
  itemCounts: InventoryMultiset,
  requiredItemIds: readonly number[],
): boolean {
  const requiredCounts = createInventoryMultiset(requiredItemIds);
  return [...requiredCounts].every(
    ([itemId, requiredCount]) =>
      (itemCounts.get(itemId) ?? 0) >= requiredCount,
  );
}

function consumeItemCounts(
  itemCounts: Map<number, number>,
  consumedItemIds: readonly number[],
): boolean {
  if (!hasItemCounts(itemCounts, consumedItemIds)) {
    return false;
  }
  for (const itemId of consumedItemIds) {
    decrementItemCount(itemCounts, itemId);
  }
  return true;
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

function appendCountedActions(
  actions: ReconstructedInventoryAction[],
  itemCounts: InventoryMultiset,
  type: 'BUY' | 'SELL',
): void {
  for (const itemId of expandItemCounts(itemCounts)) {
    actions.push({ type, itemId, actionKey: `${type}:${itemId}` });
  }
}

function toMultisetAction(
  action: ReconstructedInventoryAction,
): InventoryMultisetAction {
  return {
    type: action.type,
    itemId: action.itemId,
    componentItemIds: action.componentItemIds,
  };
}

function createResult(
  previousStateKey: string,
  currentStateKey: string,
  actions: ReconstructedInventoryAction[],
  resolved: boolean,
  ambiguous: boolean,
): InventoryTransactionReconstructionResult {
  const actionKeys = actions.map((action) => action.actionKey);
  return {
    previousStateKey,
    currentStateKey,
    actions: actions.map((action) => ({
      ...action,
      componentItemIds: action.componentItemIds
        ? [...action.componentItemIds]
        : undefined,
    })),
    actionKeys,
    confidence: resolveConfidence(actionKeys.length, resolved, ambiguous),
    resolved,
    ambiguous,
  };
}

function resolveConfidence(
  actionCount: number,
  resolved: boolean,
  ambiguous: boolean,
): InventoryTransactionReconstructionConfidence {
  if (!resolved || actionCount === 0) {
    return 'UNRESOLVED';
  }
  if (ambiguous) {
    return 'AMBIGUOUS_MULTI_ACTION';
  }
  return actionCount === 1
    ? 'EXACT_SINGLE_ACTION'
    : 'MULTI_ACTION_INTERVAL';
}

function createUpgradePlanKey(plan: readonly number[]): string {
  return plan.join(',');
}

function compareUpgradePlans(
  left: readonly number[],
  right: readonly number[],
): number {
  return createUpgradePlanKey(left).localeCompare(createUpgradePlanKey(right));
}
'''
(ROOT / 'apps/api/src/deadlock-live/inventory-transaction-reconstruction.ts').write_text(reconstruction)

context = '''import {
  reconstructInventoryTransaction,
  type InventoryTransactionReconstructionConfidence,
} from './inventory-transaction-reconstruction';

export interface ContextualV3PreviousActionsResult {
  actionKeys: string[];
  confidence: InventoryTransactionReconstructionConfidence;
  ambiguous: boolean;
  unresolvedIntervalCount: number;
}

export function deriveContextualV3PreviousActions(
  inventorySnapshots: readonly (readonly number[])[],
  recipeResolver: (parentItemId: number) => readonly number[],
): ContextualV3PreviousActionsResult {
  if (inventorySnapshots.length < 2) {
    return createResult([], false, 0);
  }

  const actionKeys: string[] = [];
  let ambiguous = false;
  let unresolvedIntervalCount = 0;

  for (let index = 1; index < inventorySnapshots.length; index += 1) {
    const reconstruction = reconstructInventoryTransaction(
      inventorySnapshots[index - 1],
      inventorySnapshots[index],
      recipeResolver,
    );
    if (reconstruction.previousStateKey === reconstruction.currentStateKey) {
      continue;
    }
    actionKeys.push(...reconstruction.actionKeys);
    ambiguous ||= reconstruction.ambiguous;
    if (!reconstruction.resolved) {
      unresolvedIntervalCount += 1;
    }
  }

  const truncated = actionKeys.length > 64;
  return createResult(
    actionKeys.slice(0, 64),
    ambiguous,
    unresolvedIntervalCount + (truncated ? 1 : 0),
  );
}

export function deriveContextualV3PreviousActionKeys(
  inventorySnapshots: readonly (readonly number[])[],
  recipeResolver: (parentItemId: number) => readonly number[],
): string[] {
  return deriveContextualV3PreviousActions(
    inventorySnapshots,
    recipeResolver,
  ).actionKeys;
}

function createResult(
  actionKeys: string[],
  ambiguous: boolean,
  unresolvedIntervalCount: number,
): ContextualV3PreviousActionsResult {
  return {
    actionKeys: [...actionKeys],
    confidence: resolveConfidence(
      actionKeys.length,
      ambiguous,
      unresolvedIntervalCount,
    ),
    ambiguous,
    unresolvedIntervalCount,
  };
}

function resolveConfidence(
  actionCount: number,
  ambiguous: boolean,
  unresolvedIntervalCount: number,
): InventoryTransactionReconstructionConfidence {
  if (unresolvedIntervalCount > 0 || actionCount === 0) {
    return 'UNRESOLVED';
  }
  if (ambiguous) {
    return 'AMBIGUOUS_MULTI_ACTION';
  }
  return actionCount === 1
    ? 'EXACT_SINGLE_ACTION'
    : 'MULTI_ACTION_INTERVAL';
}
'''
(ROOT / 'apps/api/src/deadlock-live/contextual-v3-live-context.ts').write_text(context)

spec = '''import { reconstructInventoryTransaction } from '../src/deadlock-live/inventory-transaction-reconstruction';

describe('inventory transaction reconstruction', () => {
  it('reconstructs an exact upgrade with repeated components', () => {
    const result = reconstructInventoryTransaction(
      [100, 100],
      [300],
      (parentItemId) => (parentItemId === 300 ? [100, 100] : []),
    );

    expect(result).toMatchObject({
      actionKeys: ['UPGRADE:300'],
      confidence: 'EXACT_SINGLE_ACTION',
      resolved: true,
      ambiguous: false,
    });
  });

  it('does not infer a repeated-component upgrade from one component', () => {
    const result = reconstructInventoryTransaction(
      [100],
      [300],
      (parentItemId) => (parentItemId === 300 ? [100, 100] : []),
    );

    expect(result).toMatchObject({
      actionKeys: ['SELL:100', 'BUY:300'],
      confidence: 'MULTI_ACTION_INTERVAL',
      resolved: true,
      ambiguous: false,
    });
  });

  it('chooses the explanation that consumes the most removed components', () => {
    const recipes = new Map<number, number[]>([
      [300, [100]],
      [400, [100, 200]],
    ]);
    const result = reconstructInventoryTransaction(
      [100, 200],
      [300, 400],
      (parentItemId) => recipes.get(parentItemId) ?? [],
    );

    expect(result.actionKeys).toEqual(['UPGRADE:400', 'BUY:300']);
    expect(result.confidence).toBe('MULTI_ACTION_INTERVAL');
    expect(result.ambiguous).toBe(false);
  });

  it('marks equally optimal overlapping upgrade explanations as ambiguous', () => {
    const result = reconstructInventoryTransaction(
      [100],
      [300, 400],
      (parentItemId) =>
        parentItemId === 300 || parentItemId === 400 ? [100] : [],
    );

    expect(result.actionKeys).toEqual(['UPGRADE:300', 'BUY:400']);
    expect(result.confidence).toBe('AMBIGUOUS_MULTI_ACTION');
    expect(result.ambiguous).toBe(true);
    expect(result.resolved).toBe(true);
  });

  it('reconstructs duplicate partial sales deterministically', () => {
    const result = reconstructInventoryTransaction(
      [100, 100, 200],
      [100, 200],
      () => [],
    );

    expect(result.actionKeys).toEqual(['SELL:100']);
    expect(result.confidence).toBe('EXACT_SINGLE_ACTION');
  });

  it('returns unresolved for identical snapshots', () => {
    const result = reconstructInventoryTransaction(
      [200, 100, 100],
      [100, 200, 100],
      () => [],
    );

    expect(result).toMatchObject({
      actionKeys: [],
      confidence: 'UNRESOLVED',
      resolved: true,
      ambiguous: false,
      previousStateKey: '100x2|200x1',
      currentStateKey: '100x2|200x1',
    });
  });
});
'''
(ROOT / 'apps/api/test/inventory-transaction-reconstruction.spec.ts').write_text(spec)

replace_once(
    'apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts',
    "import { deriveContextualV3PreviousActionKeys } from './contextual-v3-live-context';",
    "import { deriveContextualV3PreviousActions } from './contextual-v3-live-context';",
)
replace_once(
    'apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts',
    '''    const observedActionKeys = deriveContextualV3PreviousActionKeys(
      [previousItemIds, currentItemIds],
      (parentItemId) =>
        this.recipeAwareTimelineReconciliationService.getComponentItemIds(
          parentItemId,
        ),
    );
    telemetry.recordObservedAction({''',
    '''    const reconstruction = deriveContextualV3PreviousActions(
      [previousItemIds, currentItemIds],
      (parentItemId) =>
        this.recipeAwareTimelineReconciliationService.getComponentItemIds(
          parentItemId,
        ),
    );
    telemetry.recordObservedAction({''',
)
replace_once(
    'apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts',
    '''      observedActionKeys,
      observedInventoryStateKey:
        createInventoryStateKeyFromItemIds(currentItemIds),
      observedAtGameTimeS: normalizeGameTime(state.gameTimeSec),
      reconstructionConfidence:
        observedActionKeys.length === 1
          ? 'EXACT_SINGLE_ACTION'
          : observedActionKeys.length > 1
            ? 'MULTI_ACTION_INTERVAL'
            : 'UNRESOLVED',''',
    '''      observedActionKeys: reconstruction.actionKeys,
      observedInventoryStateKey:
        createInventoryStateKeyFromItemIds(currentItemIds),
      observedAtGameTimeS: normalizeGameTime(state.gameTimeSec),
      reconstructionConfidence: reconstruction.confidence,''',
)
replace_once(
    'apps/api/src/deadlock-live/recommendation-decision-telemetry.service.ts',
    '''export type RecommendationActionReconstructionConfidence =
  | 'EXACT_SINGLE_ACTION'
  | 'MULTI_ACTION_INTERVAL'
  | 'UNRESOLVED';''',
    '''export type RecommendationActionReconstructionConfidence =
  | 'EXACT_SINGLE_ACTION'
  | 'MULTI_ACTION_INTERVAL'
  | 'AMBIGUOUS_MULTI_ACTION'
  | 'UNRESOLVED';''',
)
replace_once(
    'apps/api/test/hero-build-contextual-v3-live.spec.ts',
    "import { deriveContextualV3PreviousActionKeys } from '../src/deadlock-live/contextual-v3-live-context';",
    "import {\n  deriveContextualV3PreviousActionKeys,\n  deriveContextualV3PreviousActions,\n} from '../src/deadlock-live/contextual-v3-live-context';",
)
replace_once(
    'apps/api/test/hero-build-contextual-v3-live.spec.ts',
    '''  it('canonicalizes roster hero aliases before model lookup', () => {''',
    '''  it('propagates ambiguous interval confidence from optimal reconstruction', () => {
    const result = deriveContextualV3PreviousActions(
      [
        [100],
        [300, 400],
      ],
      (parentItemId) =>
        parentItemId === 300 || parentItemId === 400 ? [100] : [],
    );

    expect(result).toEqual({
      actionKeys: ['UPGRADE:300', 'BUY:400'],
      confidence: 'AMBIGUOUS_MULTI_ACTION',
      ambiguous: true,
      unresolvedIntervalCount: 0,
    });
  });

  it('canonicalizes roster hero aliases before model lookup', () => {''',
)
