import type { MinimalMatchState } from '@deadlock-live-probe/shared';
import type {
  LiveBuildRecommendationTraversalSnapshot,
  LiveBuildRecommendationTraversalStatus,
} from '../src/deadlock-live/live-build-recommendation-traversal.service';
import { RecommendationValueV8PassiveShadowTraversalFacade } from '../src/deadlock-live/recommendation-value-v8-passive-shadow-traversal.facade';

describe('Recommendation Value V8 passive shadow traversal facade', () => {
  it('returns baseline traversal behavior and schedules shadow after baseline idle', async () => {
    const snapshot = traversalSnapshot();
    const base = baseTraversal(() => snapshot);
    const shadow = shadowService();
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

  it('does not retry a stale snapshot without another observation', async () => {
    const snapshot = traversalSnapshot('decision-1', 50);
    const base = baseTraversal(() => snapshot);
    const shadow = shadowService();
    const facade = new RecommendationValueV8PassiveShadowTraversalFacade(
      base as never,
      shadow as never,
    );

    facade.observeState(state(60));
    await expect(
      Promise.race([
        facade.waitForShadowIdle('match-1').then(() => 'IDLE'),
        delay(250).then(() => 'TIMEOUT'),
      ]),
    ).resolves.toBe('IDLE');

    expect(base.waitForIdle).toHaveBeenCalledTimes(1);
    expect(shadow.schedule).not.toHaveBeenCalled();
  });

  it('processes the latest decision queued while baseline is running', async () => {
    let snapshot = traversalSnapshot('decision-1', 50);
    let resolveBaseline!: () => void;
    const baselineIdle = new Promise<void>((resolve) => {
      resolveBaseline = resolve;
    });
    const base = baseTraversal(() => snapshot, () => baselineIdle);
    const shadow = shadowService();
    const facade = new RecommendationValueV8PassiveShadowTraversalFacade(
      base as never,
      shadow as never,
    );

    facade.observeState(state(50));
    snapshot = traversalSnapshot('decision-2', 60);
    facade.observeState(state(60));
    resolveBaseline();
    await facade.waitForShadowIdle('match-1');

    expect(shadow.schedule).toHaveBeenCalledTimes(1);
    expect(shadow.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionId: 'decision-2',
        displayedActionKeys: ['BUY:100', 'BUY:200'],
      }),
    );
  });
});

function baseTraversal(
  getSnapshot: () => LiveBuildRecommendationTraversalSnapshot,
  waitForIdle: () => Promise<void> = async () => undefined,
) {
  return {
    observeState: jest.fn(),
    getMatchSnapshot: jest.fn(getSnapshot),
    getAllSnapshots: jest.fn(() => [getSnapshot()]),
    getStatus: jest.fn(() => traversalStatus()),
    waitForIdle: jest.fn(waitForIdle),
  };
}

function shadowService() {
  return {
    schedule: jest.fn(),
    waitForIdle: jest.fn(async () => undefined),
  };
}

function state(itemId = 50): MinimalMatchState {
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
            id: itemId,
            name: 'Item',
            className: `item_${itemId}`,
            enhanced: false,
          },
        ],
      },
    },
  };
}

function traversalSnapshot(
  decisionId = 'decision-1',
  itemId = 50,
): LiveBuildRecommendationTraversalSnapshot {
  return {
    state: 'READY',
    matchId: 'match-1',
    steamId: 'player',
    heroId: 1,
    teamId: 0,
    itemIds: [itemId],
    alliedHeroIds: [1],
    enemyHeroIds: [2],
    previousActionKeys: [`BUY:${itemId}`],
    inventoryStateKey: `${itemId}x1`,
    gameTimeS: 600,
    timeBucket: 5,
    traversalKey: `key-${decisionId}`,
    decisionId,
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
