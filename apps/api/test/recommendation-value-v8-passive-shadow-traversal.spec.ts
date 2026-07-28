import type { MinimalMatchState } from '@deadlock-live-probe/shared';
import type {
  LiveBuildRecommendationTraversalSnapshot,
  LiveBuildRecommendationTraversalStatus,
} from '../src/deadlock-live/live-build-recommendation-traversal.service';
import { RecommendationValueV8PassiveShadowTraversalFacade } from '../src/deadlock-live/recommendation-value-v8-passive-shadow-traversal.facade';

 describe('Recommendation Value V8 passive shadow traversal facade', () => {
  it('returns baseline traversal behavior and schedules shadow after baseline idle', async () => {
    const snapshot = traversalSnapshot();
    const base = {
      observeState: jest.fn(),
      getMatchSnapshot: jest.fn(() => snapshot),
      getAllSnapshots: jest.fn(() => [snapshot]),
      getStatus: jest.fn(() => traversalStatus()),
      waitForIdle: jest.fn(async () => undefined),
    };
    const shadow = {
      schedule: jest.fn(),
      waitForIdle: jest.fn(async () => undefined),
    };
    const facade = new RecommendationValueV8PassiveShadowTraversalFacade(
      base as never,
      shadow as never,
    );
    const value = state();

    facade.observeState(value);
    expect(base.observeState).toHaveBeenCalledWith(value);
    expect(facade.getMatchSnapshot('match-1')).toBe(snapshot);

    await facade.waitForShadowIdle('match-1');

    expect(base.waitForIdle).toHaveBeenCalledWith('match-1');
    expect(shadow.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionId: 'decision-1',
        displayedActionKeys: ['BUY:100', 'BUY:200'],
        previousActionKeys: ['BUY:50'],
      }),
    );
  });
});

function state(): MinimalMatchState {
  return {
    matchId: 'match-1',
    gameTimeSec: 600,
    lastUpdatedAt: '2026-07-28T00:00:00.000Z',
    playersBySteamId: {
      player: {
        steamId: 'player',
        playerName: 'Player',
        isLocal: true,
        heroId: 1,
        teamId: 0,
        souls: 8_000,
        items: [
          {
            id: 50,
            name: 'Item',
            className: 'item_50',
            enhanced: false,
          },
        ],
      },
    },
  };
}

function traversalSnapshot(): LiveBuildRecommendationTraversalSnapshot {
  return {
    state: 'READY',
    matchId: 'match-1',
    steamId: 'player',
    heroId: 1,
    teamId: 0,
    itemIds: [50],
    alliedHeroIds: [1],
    enemyHeroIds: [2],
    previousActionKeys: ['BUY:50'],
    inventoryStateKey: '50x1',
    gameTimeS: 600,
    timeBucket: 5,
    traversalKey: 'key-1',
    decisionId: 'decision-1',
    isStale: false,
    recommendation: {
      action: { actionKey: 'BUY:100' },
      alternatives: [{ actionKey: 'BUY:200' }],
    } as never,
    refreshCount: 1,
    cacheHitCount: 0,
    discardedResultCount: 0,
    lastObservedAt: '2026-07-28T00:00:00.000Z',
  };
}

function traversalStatus(): LiveBuildRecommendationTraversalStatus {
  return {
    timeBucketSeconds: 120,
    maximumTrackedMatches: 32,
    trackedMatchCount: 1,
    readyCount: 1,
    refreshingCount: 0,
    waitingCount: 0,
    errorCount: 0,
    totalRefreshCount: 1,
    totalCacheHitCount: 0,
    totalDiscardedResultCount: 0,
  };
}
