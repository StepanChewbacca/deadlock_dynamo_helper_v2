from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    if old not in source:
        raise RuntimeError(f'Expected block was not found in {path}')
    target.write_text(source.replace(old, new, 1))


replace(
    'apps/api/src/deadlock-live/hero-build-contextual-v3-live.service.ts',
    """      archetypeId,
      archetypeApplied: previousActionKeys.length > 0,
      alliedHeroIds,
""",
    """      archetypeId,
      alliedHeroIds,
""",
)
replace(
    'apps/api/src/deadlock-live/hero-build-contextual-v3-live.service.ts',
    """  archetypeId: string;
  archetypeApplied: boolean;
  alliedHeroIds: readonly number[];
""",
    """  archetypeId: string;
  alliedHeroIds: readonly number[];
""",
)
replace(
    'apps/api/src/deadlock-live/hero-build-contextual-v3-live.service.ts',
    """      const archetypeDelta = input.archetypeApplied
        ? logProbability(
            input.model.counts.heroPhaseArchetype[
              `${baseKey}|${input.archetypeId}`
            ],
            sourceActionKey,
            input.candidates.length,
            smoothing,
          ) - base
        : 0;
""",
    """      const archetypeDelta =
        logProbability(
          input.model.counts.heroPhaseArchetype[
            `${baseKey}|${input.archetypeId}`
          ],
          sourceActionKey,
          input.candidates.length,
          smoothing,
        ) - base;
""",
)

path = 'apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts'
replace(
    path,
    """import { createInventoryStateKeyFromItemIds } from './hero-build-transition-aggregation.service';
""",
    """import { deriveContextualV3PreviousActionKeys } from './hero-build-recommendation.controller';
import { createInventoryStateKeyFromItemIds } from './hero-build-transition-aggregation.service';
import { RecipeAwareTimelineReconciliationService } from './recipe-aware-timeline-reconciliation.service';
""",
)
replace(
    path,
    """  enemyHeroIds: number[];
  inventoryStateKey: string;
""",
    """  alliedHeroIds: number[];
  enemyHeroIds: number[];
  previousActionKeys: string[];
  inventoryStateKey: string;
""",
)
replace(
    path,
    """  lastObservedAtMs: number;
  snapshot: LiveBuildRecommendationTraversalSnapshot;
""",
    """  lastObservedAtMs: number;
  inventorySnapshots: number[][];
  snapshot: LiveBuildRecommendationTraversalSnapshot;
""",
)
replace(
    path,
    """    private readonly heroBuildRecommendationOwnershipFilterService:
      HeroBuildRecommendationOwnershipFilterService,
  ) {}
""",
    """    private readonly heroBuildRecommendationOwnershipFilterService:
      HeroBuildRecommendationOwnershipFilterService,
    private readonly recipeAwareTimelineReconciliationService:
      RecipeAwareTimelineReconciliationService,
  ) {}
""",
)
replace(
    path,
    """    const input = createTraversalInput(state, localPlayer);
""",
    """    const currentItemIds = localPlayer.items
      .map((item) => Number(item.id))
      .filter((itemId) => Number.isSafeInteger(itemId) && itemId > 0)
      .sort((left, right) => left - right);
    const previousSnapshot = runtime.inventorySnapshots.at(-1);
    if (!previousSnapshot || !sameNumberArrays(previousSnapshot, currentItemIds)) {
      runtime.inventorySnapshots.push(currentItemIds);
      if (runtime.inventorySnapshots.length > 128) {
        runtime.inventorySnapshots.shift();
      }
    }
    const previousActionKeys = deriveContextualV3PreviousActionKeys(
      runtime.inventorySnapshots,
      (parentItemId) =>
        this.recipeAwareTimelineReconciliationService.getComponentItemIds(
          parentItemId,
        ),
    );
    const input = createTraversalInput(state, localPlayer, previousActionKeys);
""",
)
replace(
    path,
    """          enemyHeroIds: [...input.enemyHeroIds],
          gameTimeS: input.gameTimeS,
""",
    """          alliedHeroIds: [...input.alliedHeroIds],
          enemyHeroIds: [...input.enemyHeroIds],
          previousActionKeys: [...input.previousActionKeys],
          gameTimeS: input.gameTimeS,
""",
)
replace(
    path,
    """      lastObservedAtMs: observedAt.getTime(),
      snapshot: {
""",
    """      lastObservedAtMs: observedAt.getTime(),
      inventorySnapshots: [],
      snapshot: {
""",
)
replace(
    path,
    """export function createTraversalInput(
  state: MinimalMatchState,
  localPlayer: MinimalPlayerState,
): LiveBuildRecommendationTraversalInput {
""",
    """export function createTraversalInput(
  state: MinimalMatchState,
  localPlayer: MinimalPlayerState,
  previousActionKeys: readonly string[] = [],
): LiveBuildRecommendationTraversalInput {
""",
)
replace(
    path,
    """  const enemyHeroIds = localPlayer.teamId === undefined
""",
    """  const alliedHeroIds = localPlayer.teamId === undefined
    ? []
    : [...new Set(
        Object.values(state.playersBySteamId)
          .filter(
            (player) =>
              player.steamId !== localPlayer.steamId &&
              player.teamId === localPlayer.teamId &&
              Number.isSafeInteger(player.heroId) &&
              Number(player.heroId) > 0,
          )
          .map((player) => Number(player.heroId)),
      )].sort((left, right) => left - right);
  const enemyHeroIds = localPlayer.teamId === undefined
""",
)
replace(
    path,
    """    inventoryStateKey,
    enemyHeroIds.join(','),
    timeBucket,
""",
    """    inventoryStateKey,
    alliedHeroIds.join(','),
    enemyHeroIds.join(','),
    previousActionKeys.join(','),
    timeBucket,
""",
)
replace(
    path,
    """    itemIds,
    enemyHeroIds,
    inventoryStateKey,
""",
    """    itemIds,
    alliedHeroIds,
    enemyHeroIds,
    previousActionKeys: [...previousActionKeys],
    inventoryStateKey,
""",
)
Path(path).write_text(
    Path(path).read_text()
    + """

function sameNumberArrays(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
"""
)

path = 'apps/api/test/live-build-recommendation-traversal.spec.ts'
replace(
    path,
    """    expect(input.enemyHeroIds).toEqual([13]);
    expect(input.inventoryStateKey).toBe('100x1|200x2');
    expect(input.timeBucket).toBe(0);
    expect(input.traversalKey).toBe('match-1:local:72:100x1|200x2:13:0');
""",
    """    expect(input.alliedHeroIds).toEqual([]);
    expect(input.enemyHeroIds).toEqual([13]);
    expect(input.previousActionKeys).toEqual([]);
    expect(input.inventoryStateKey).toBe('100x1|200x2');
    expect(input.timeBucket).toBe(0);
    expect(input.traversalKey).toBe('match-1:local:72:100x1|200x2::13::0');
""",
)
replace(
    path,
    """    { isActionLegalForState } as unknown as HeroBuildRecommendationOwnershipFilterService,
  );
""",
    """    { isActionLegalForState } as unknown as HeroBuildRecommendationOwnershipFilterService,
    { getComponentItemIds: jest.fn(() => []) } as never,
  );
""",
)
