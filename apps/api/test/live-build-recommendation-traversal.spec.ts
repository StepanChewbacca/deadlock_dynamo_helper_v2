import { MinimalMatchState } from '@deadlock-live-probe/shared';
import { HeroBuildRecommendationWithAlternativeFilter } from '../src/deadlock-live/hero-build-recommendation-alternative-filter';
import { HeroBuildRecommendationOwnershipFilterService } from '../src/deadlock-live/hero-build-recommendation-ownership-filter.service';
import { HeroBuildRecommendationPresentationService } from '../src/deadlock-live/hero-build-recommendation-presentation.service';
import {
  createTraversalInput,
  LiveBuildRecommendationTraversalService,
} from '../src/deadlock-live/live-build-recommendation-traversal.service';
import {
  HeroBuildRecommendationResponse,
  HeroBuildRecommendationService,
} from '../src/deadlock-live/hero-build-recommendation.service';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

describe('live build recommendation traversal', () => {
  it('canonicalizes inventory and enemy roster into the traversal key', () => {
    const state = createState(59, [200, 100, 200]);
    const localPlayer = state.playersBySteamId.local;

    const input = createTraversalInput(state, localPlayer);

    expect(input.itemIds).toEqual([100, 200, 200]);
    expect(input.enemyHeroIds).toEqual([13]);
    expect(input.inventoryStateKey).toBe('100x1|200x2');
    expect(input.timeBucket).toBe(0);
    expect(input.traversalKey).toBe('match-1:local:72:100x1|200x2:13:0');
  });

  it('serves repeated observations from the traversal cache within the same time bucket', async () => {
    const harness = createHarness();

    harness.service.observeState(createState(10, [100]));
    await harness.service.waitForIdle('match-1');
    harness.service.observeState(createState(20, [100]));
    await harness.service.waitForIdle('match-1');

    expect(harness.recommend).toHaveBeenCalledTimes(1);
    expect(harness.recommend).toHaveBeenCalledWith(
      expect.objectContaining({ enemyHeroIds: [13] }),
    );
    expect(harness.present).toHaveBeenCalledTimes(1);
    expect(harness.service.getMatchSnapshot('match-1')).toMatchObject({
      state: 'READY',
      enemyHeroIds: [13],
      inventoryStateKey: '100x1',
      timeBucket: 0,
      refreshCount: 1,
      cacheHitCount: 1,
      isStale: false,
    });
  });

  it('refreshes when the inventory multiset changes', async () => {
    const harness = createHarness();

    harness.service.observeState(createState(10, [100]));
    await harness.service.waitForIdle('match-1');
    harness.service.observeState(createState(20, [100, 200]));
    await harness.service.waitForIdle('match-1');

    expect(harness.recommend).toHaveBeenCalledTimes(2);
    expect(harness.service.getMatchSnapshot('match-1')).toMatchObject({
      state: 'READY',
      itemIds: [100, 200],
      enemyHeroIds: [13],
      inventoryStateKey: '100x1|200x1',
      refreshCount: 2,
    });
  });

  it('keeps the previous recommendation visible during a slow refresh', async () => {
    const nextRecommendation = deferred<HeroBuildRecommendationResponse>();
    const recommend = createRecommendMock();
    recommend
      .mockImplementationOnce(async (request) => createRecommendation(request.itemIds))
      .mockImplementationOnce(() => nextRecommendation.promise);
    const harness = createHarness(recommend);

    harness.service.observeState(createState(10, [100]));
    await harness.service.waitForIdle('match-1');
    harness.service.observeState(createState(20, [100, 200]));

    expect(harness.service.getMatchSnapshot('match-1')).toMatchObject({
      state: 'READY',
      itemIds: [100, 200],
      inventoryStateKey: '100x1|200x1',
      isStale: true,
      recommendation: {
        action: {
          itemId: 999,
        },
      },
    });

    nextRecommendation.resolve(createRecommendation([100, 200]));
    await harness.service.waitForIdle('match-1');
  });

  it('removes a purchased primary action before the slow refresh completes', async () => {
    const nextRecommendation = deferred<HeroBuildRecommendationResponse>();
    const recommend = createRecommendMock();
    recommend
      .mockImplementationOnce(async (request) => createRecommendation(request.itemIds))
      .mockImplementationOnce(() => nextRecommendation.promise);
    const harness = createHarness(recommend);

    harness.service.observeState(createState(10, [100]));
    await harness.service.waitForIdle('match-1');
    harness.service.observeState(createState(11, [100, 999]));

    expect(harness.service.getMatchSnapshot('match-1')).toMatchObject({
      state: 'READY',
      itemIds: [100, 999],
      inventoryStateKey: '100x1|999x1',
      isStale: true,
      recommendation: {
        mode: 'NO_MATCH',
        action: {
          type: 'HOLD',
          actionKey: 'HOLD',
          label: 'Recalculating next item',
        },
      },
    });

    nextRecommendation.resolve(createRecommendation([100, 999]));
    await harness.service.waitForIdle('match-1');
  });

  it('refreshes when game time crosses a recommendation bucket', async () => {
    const harness = createHarness();

    harness.service.observeState(createState(119, [100]));
    await harness.service.waitForIdle('match-1');
    harness.service.observeState(createState(120, [100]));
    await harness.service.waitForIdle('match-1');

    expect(harness.recommend).toHaveBeenCalledTimes(2);
    expect(harness.service.getMatchSnapshot('match-1')).toMatchObject({
      state: 'READY',
      timeBucket: 1,
      gameTimeS: 120,
      refreshCount: 2,
    });
  });

  it('discards an obsolete result and resolves only the latest desired inventory state', async () => {
    const firstRecommendation = deferred<HeroBuildRecommendationResponse>();
    const recommend = createRecommendMock();
    recommend
      .mockImplementationOnce(() => firstRecommendation.promise)
      .mockImplementationOnce(async (request) => createRecommendation(request.itemIds));
    const harness = createHarness(recommend);

    harness.service.observeState(createState(10, [100]));
    harness.service.observeState(createState(11, [100, 200]));
    firstRecommendation.resolve(createRecommendation([100]));
    await harness.service.waitForIdle('match-1');

    expect(recommend).toHaveBeenCalledTimes(2);
    expect(harness.service.getMatchSnapshot('match-1')).toMatchObject({
      state: 'READY',
      itemIds: [100, 200],
      enemyHeroIds: [13],
      inventoryStateKey: '100x1|200x1',
      refreshCount: 1,
      discardedResultCount: 1,
      isStale: false,
    });
  });

  it('waits without invoking the recommender when no local player is available', async () => {
    const harness = createHarness();
    const state = createState(10, [100]);
    state.playersBySteamId.local.isLocal = false;

    harness.service.observeState(state);
    await harness.service.waitForIdle('match-1');

    expect(harness.recommend).not.toHaveBeenCalled();
    expect(harness.service.getMatchSnapshot('match-1')).toMatchObject({
      state: 'WAITING_FOR_LOCAL_PLAYER',
      itemIds: [],
      enemyHeroIds: [],
      refreshCount: 0,
      isStale: false,
    });
  });

  it('keeps a ready recommendation when a later snapshot temporarily lacks the local player', async () => {
    const harness = createHarness();

    harness.service.observeState(createState(10, [100]));
    await harness.service.waitForIdle('match-1');

    const incompleteState = createState(11, [100]);
    incompleteState.playersBySteamId.local.isLocal = false;
    harness.service.observeState(incompleteState);

    expect(harness.service.getMatchSnapshot('match-1')).toMatchObject({
      state: 'READY',
      itemIds: [100],
      inventoryStateKey: '100x1',
      isStale: true,
      recommendation: {
        action: {
          itemId: 999,
        },
      },
    });
  });
});

function createHarness(recommend = createRecommendMock()) {
  const present = jest.fn(async (response: HeroBuildRecommendationWithAlternativeFilter) => ({
    ...response,
    action: {
      ...response.action,
      label: `Buy Item ${response.action.itemId}`,
      confidencePercent: response.action.confidence * 100,
      historicalProbabilityPercent: response.action.historicalProbability * 100,
      typicalGameTimeLabel: '0:10',
      explanation: {
        code: 'EXACT_STATE_EVIDENCE' as const,
        evidenceLevel: 'OBSERVED' as const,
        text: 'Observed test recommendation.',
      },
    },
    alternatives: [],
    itemMetadata: {
      requestedCount: 1,
      resolvedCount: 0,
      missingItemIds: [Number(response.action.itemId)],
    },
  }));
  const isActionLegalForState = jest.fn(
    (action: { type: string; itemId?: number }, stateKey: string) =>
      action.type !== 'BUY' ||
      action.itemId === undefined ||
      !stateKey.split('|').some((token) => token.startsWith(`${action.itemId}x`)),
  );

  const service = new LiveBuildRecommendationTraversalService(
    { recommend } as unknown as HeroBuildRecommendationService,
    { present } as unknown as HeroBuildRecommendationPresentationService,
    { isActionLegalForState } as unknown as HeroBuildRecommendationOwnershipFilterService,
  );

  return { service, recommend, present, isActionLegalForState };
}

function createRecommendMock() {
  return jest.fn(async (request: { itemIds: number[]; enemyHeroIds?: number[] }) =>
    createRecommendation(request.itemIds),
  );
}

function createState(gameTimeSec: number, itemIds: number[]): MinimalMatchState {
  return {
    matchId: 'match-1',
    gameTimeSec,
    lastUpdatedAt: new Date().toISOString(),
    playersBySteamId: {
      local: {
        steamId: 'local',
        playerName: 'Local Player',
        isLocal: true,
        heroId: 72,
        teamId: 1,
        items: itemIds.map((itemId) => ({
          id: itemId,
          name: `Item ${itemId}`,
          className: `item_${itemId}`,
          enhanced: false,
        })),
      },
      enemy: {
        steamId: 'enemy',
        playerName: 'Enemy Player',
        isLocal: false,
        heroId: 13,
        teamId: 2,
        items: [],
      },
    },
  };
}

function createRecommendation(itemIds: number[]): HeroBuildRecommendationResponse {
  const requestedStateKey = createStateKey(itemIds);
  const predictedStateKey = requestedStateKey === 'EMPTY'
    ? '999x1'
    : `${requestedStateKey}|999x1`;

  return {
    mode: 'EXACT',
    heroId: 72,
    requestedStateKey,
    gameTimeS: 10,
    matchedStateKey: requestedStateKey,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    observationCount: 10,
    candidateStateCount: 1,
    action: {
      type: 'BUY',
      sourceActionType: 'BUY',
      itemId: 999,
      actionKey: 'BUY:999',
      historicalCount: 8,
      historicalProbability: 0.8,
      averageGameTimeS: 10,
      matchedStateKey: requestedStateKey,
      matchedStateObservationCount: 10,
      stateDistance: 0,
      missingItemCount: 0,
      extraItemCount: 0,
      matchedBySubset: true,
      currentOwnedCount: 0,
      observedOwnedCountLimit: 1,
      predictedStateKey,
      score: 0.8,
      confidence: 0.8,
    },
    alternatives: [],
  };
}

function createStateKey(itemIds: number[]): string {
  if (itemIds.length === 0) {
    return 'EMPTY';
  }

  const counts = new Map<number, number>();
  for (const itemId of itemIds) {
    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([leftItemId], [rightItemId]) => leftItemId - rightItemId)
    .map(([itemId, count]) => `${itemId}x${count}`)
    .join('|');
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
