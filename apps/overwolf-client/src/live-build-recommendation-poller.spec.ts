import {
  createLiveBuildRecommendationPresentationKey,
  LiveBuildRecommendationPoller,
  LiveBuildRecommendationSnapshot,
} from './live-build-recommendation-poller';

describe('LiveBuildRecommendationPoller', () => {
  it('fetches the encoded match endpoint and emits a ready snapshot', async () => {
    const snapshot = createSnapshot();
    const emitted = deferred<LiveBuildRecommendationSnapshot>();
    const fetchImpl = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => createResponse(snapshot),
    );
    const poller = new LiveBuildRecommendationPoller({
      apiBaseUrl: 'https://example.test/',
      fetchImpl: fetchImpl as typeof fetch,
      onSnapshot: emitted.resolve,
      onClear: jest.fn(),
    });

    poller.setMatchId('match id/1');
    const result = await emitted.promise;

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'https://example.test/deadlock/live/matches/match%20id%2F1/build-recommendation',
    );
    expect(result.state).toBe('READY');
    expect(result.recommendation?.action.label).toBe('Buy Grit');
  });

  it('does not emit again when only cache counters change', async () => {
    let snapshot = createSnapshot();
    const onSnapshot = jest.fn<void, [LiveBuildRecommendationSnapshot]>();
    const firstEmission = deferred<LiveBuildRecommendationSnapshot>();
    onSnapshot.mockImplementationOnce(firstEmission.resolve);
    const fetchImpl = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => createResponse(snapshot),
    );
    const poller = new LiveBuildRecommendationPoller({
      apiBaseUrl: 'https://example.test',
      fetchImpl: fetchImpl as typeof fetch,
      onSnapshot,
      onClear: jest.fn(),
    });

    poller.setMatchId('match-1');
    await firstEmission.promise;

    snapshot = {
      ...snapshot,
      cacheHitCount: 999,
      discardedResultCount: 3,
    };
    await poller.pollNow();

    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('emits lifecycle transitions even when the traversal key is unchanged', async () => {
    let snapshot = createSnapshot();
    const onSnapshot = jest.fn<void, [LiveBuildRecommendationSnapshot]>();
    const firstEmission = deferred<LiveBuildRecommendationSnapshot>();
    onSnapshot.mockImplementationOnce(firstEmission.resolve);
    const fetchImpl = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => createResponse(snapshot),
    );
    const poller = new LiveBuildRecommendationPoller({
      apiBaseUrl: 'https://example.test',
      fetchImpl: fetchImpl as typeof fetch,
      onSnapshot,
      onClear: jest.fn(),
    });

    poller.setMatchId('match-1');
    await firstEmission.promise;

    snapshot = {
      ...snapshot,
      state: 'REFRESHING',
      isStale: true,
    };
    await poller.pollNow();

    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(onSnapshot.mock.calls[1][0]).toMatchObject({
      state: 'REFRESHING',
      traversalKey: 'match-1:local:72:EMPTY:0',
      isStale: true,
    });
  });

  it('keeps the last ready build when the backend temporarily returns waiting', async () => {
    let response = createResponse(createSnapshot());
    const onSnapshot = jest.fn<void, [LiveBuildRecommendationSnapshot]>();
    const firstEmission = deferred<LiveBuildRecommendationSnapshot>();
    onSnapshot.mockImplementationOnce(firstEmission.resolve);
    const fetchImpl = jest.fn(async () => response);
    const poller = new LiveBuildRecommendationPoller({
      apiBaseUrl: 'https://example.test',
      fetchImpl: fetchImpl as typeof fetch,
      onSnapshot,
      onClear: jest.fn(),
    });

    poller.setMatchId('match-1');
    await firstEmission.promise;

    response = {
      ok: true,
      status: 200,
      text: async () => '',
    } as Response;
    await poller.pollNow();

    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(onSnapshot.mock.calls[1][0]).toMatchObject({
      state: 'READY',
      matchId: 'match-1',
      isStale: true,
      recommendation: {
        action: {
          label: 'Buy Grit',
        },
      },
    });
  });

  it('emits a waiting snapshot for an empty backend response before any build is ready', async () => {
    const emitted = deferred<LiveBuildRecommendationSnapshot>();
    const fetchImpl = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({
        ok: true,
        status: 200,
        text: async () => '',
      } as Response),
    );
    const poller = new LiveBuildRecommendationPoller({
      apiBaseUrl: 'https://example.test',
      fetchImpl: fetchImpl as typeof fetch,
      onSnapshot: emitted.resolve,
      onClear: jest.fn(),
    });

    poller.setMatchId('match-1');
    const result = await emitted.promise;

    expect(result).toMatchObject({
      state: 'WAITING_FOR_BACKEND',
      matchId: 'match-1',
      isStale: false,
    });
  });

  it('excludes cache diagnostics from the presentation key', () => {
    const snapshot = createSnapshot();
    const changedCounters = {
      ...snapshot,
      cacheHitCount: 100,
      discardedResultCount: 25,
    };

    expect(createLiveBuildRecommendationPresentationKey(changedCounters)).toBe(
      createLiveBuildRecommendationPresentationKey(snapshot),
    );
  });
});

function createSnapshot(): LiveBuildRecommendationSnapshot {
  return {
    state: 'READY',
    matchId: 'match-1',
    steamId: 'local',
    heroId: 72,
    itemIds: [],
    inventoryStateKey: 'EMPTY',
    gameTimeS: 10,
    timeBucket: 0,
    traversalKey: 'match-1:local:72:EMPTY:0',
    isStale: false,
    refreshCount: 1,
    cacheHitCount: 0,
    discardedResultCount: 0,
    lastObservedAt: '2026-07-14T00:00:00.000Z',
    recommendation: {
      mode: 'EXACT',
      action: {
        type: 'BUY',
        itemId: 1672893796,
        actionKey: 'BUY:1672893796',
        label: 'Buy Grit',
        confidencePercent: 45,
        historicalProbabilityPercent: 53,
        typicalGameTimeLabel: '1:06',
        item: {
          itemId: 1672893796,
          name: 'Grit',
          className: 'upgrade_grit',
          slotType: 'vitality',
          cost: 800,
          tier: 1,
        },
        explanation: {
          code: 'EXACT_STATE_EVIDENCE',
          evidenceLevel: 'OBSERVED',
          text: 'Observed from the exact state.',
        },
      },
      alternatives: [],
    },
  };
}

function createResponse(snapshot: LiveBuildRecommendationSnapshot): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(snapshot),
  } as Response;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
