import { Injectable, Logger } from '@nestjs/common';
import { MinimalMatchState, MinimalPlayerState } from '@deadlock-live-probe/shared';
import type { HeroBuildContextualRecommendationRequest } from './contextual-hero-build-recommendation.service';
import {
  filterHeroBuildRecommendationAlternatives,
  HERO_BUILD_DEFAULT_MIN_ALTERNATIVE_CONFIDENCE,
  HERO_BUILD_DEFAULT_MIN_ALTERNATIVE_HISTORICAL_COUNT,
  HeroBuildRecommendationWithAlternativeFilter,
} from './hero-build-recommendation-alternative-filter';
import {
  HeroBuildPresentedRecommendation,
  HeroBuildRecommendationPresentationService,
} from './hero-build-recommendation-presentation.service';
import {
  HERO_BUILD_MAX_RECOMMENDATION_LIMIT,
  HeroBuildRecommendationService,
} from './hero-build-recommendation.service';
import { createInventoryStateKeyFromItemIds } from './hero-build-transition-aggregation.service';

export const LIVE_BUILD_RECOMMENDATION_TIME_BUCKET_S = 30;
export const LIVE_BUILD_RECOMMENDATION_LIMIT = 5;
export const LIVE_BUILD_RECOMMENDATION_MAX_TRACKED_MATCHES = 32;

export type LiveBuildRecommendationTraversalState =
  | 'WAITING_FOR_LOCAL_PLAYER'
  | 'WAITING_FOR_HERO'
  | 'REFRESHING'
  | 'READY'
  | 'ERROR';

export type LiveBuildPresentedRecommendation = HeroBuildPresentedRecommendation<
  HeroBuildRecommendationWithAlternativeFilter
>;

export interface LiveBuildRecommendationTraversalInput {
  matchId: string;
  steamId: string;
  heroId: number;
  itemIds: number[];
  enemyHeroIds: number[];
  inventoryStateKey: string;
  gameTimeS: number;
  timeBucket: number;
  traversalKey: string;
}

export interface LiveBuildRecommendationTraversalSnapshot {
  state: LiveBuildRecommendationTraversalState;
  matchId: string;
  steamId?: string;
  heroId?: number;
  itemIds: number[];
  enemyHeroIds: number[];
  inventoryStateKey?: string;
  gameTimeS?: number;
  timeBucket?: number;
  traversalKey?: string;
  isStale: boolean;
  recommendation?: LiveBuildPresentedRecommendation;
  refreshCount: number;
  cacheHitCount: number;
  discardedResultCount: number;
  lastObservedAt: string;
  lastStartedAt?: string;
  lastUpdatedAt?: string;
  lastError?: string;
}

export interface LiveBuildRecommendationTraversalStatus {
  timeBucketSeconds: number;
  maximumTrackedMatches: number;
  trackedMatchCount: number;
  readyCount: number;
  refreshingCount: number;
  waitingCount: number;
  errorCount: number;
  totalRefreshCount: number;
  totalCacheHitCount: number;
  totalDiscardedResultCount: number;
}

interface TraversalRuntime {
  matchId: string;
  desiredInput?: LiveBuildRecommendationTraversalInput;
  resolvedKey?: string;
  lastAttemptedKey?: string;
  worker?: Promise<void>;
  lastObservedAtMs: number;
  snapshot: LiveBuildRecommendationTraversalSnapshot;
}

@Injectable()
export class LiveBuildRecommendationTraversalService {
  private readonly logger = new Logger(LiveBuildRecommendationTraversalService.name);
  private readonly runtimes = new Map<string, TraversalRuntime>();

  constructor(
    private readonly heroBuildRecommendationService: HeroBuildRecommendationService,
    private readonly heroBuildRecommendationPresentationService:
      HeroBuildRecommendationPresentationService,
  ) {}

  observeState(state: MinimalMatchState | undefined): void {
    if (!state || !state.matchId || state.matchId === 'unknown') {
      return;
    }

    const observedAt = new Date();
    const runtime = this.getOrCreateRuntime(state.matchId, observedAt);
    runtime.lastObservedAtMs = observedAt.getTime();
    runtime.snapshot.lastObservedAt = observedAt.toISOString();
    this.evictOldRuntimes();

    const localPlayer = findLocalPlayer(state);
    if (!localPlayer) {
      this.setWaitingState(runtime, 'WAITING_FOR_LOCAL_PLAYER', observedAt);
      return;
    }

    if (!Number.isSafeInteger(localPlayer.heroId) || Number(localPlayer.heroId) <= 0) {
      this.setWaitingState(runtime, 'WAITING_FOR_HERO', observedAt, localPlayer.steamId);
      return;
    }

    const input = createTraversalInput(state, localPlayer);
    if (
      runtime.desiredInput?.traversalKey === input.traversalKey ||
      runtime.lastAttemptedKey === input.traversalKey
    ) {
      runtime.snapshot.cacheHitCount += 1;
      return;
    }

    runtime.desiredInput = input;
    runtime.snapshot = {
      ...runtime.snapshot,
      state: runtime.snapshot.recommendation ? 'READY' : 'REFRESHING',
      matchId: input.matchId,
      steamId: input.steamId,
      heroId: input.heroId,
      itemIds: [...input.itemIds],
      enemyHeroIds: [...input.enemyHeroIds],
      inventoryStateKey: input.inventoryStateKey,
      gameTimeS: input.gameTimeS,
      timeBucket: input.timeBucket,
      traversalKey: input.traversalKey,
      isStale:
        runtime.snapshot.recommendation !== undefined &&
        runtime.resolvedKey !== input.traversalKey,
      lastError: undefined,
    };

    this.startWorker(runtime);
  }

  getMatchSnapshot(matchId: string): LiveBuildRecommendationTraversalSnapshot | undefined {
    const snapshot = this.runtimes.get(matchId)?.snapshot;
    return snapshot ? cloneSnapshot(snapshot) : undefined;
  }

  getAllSnapshots(): LiveBuildRecommendationTraversalSnapshot[] {
    return [...this.runtimes.values()]
      .sort((left, right) => right.lastObservedAtMs - left.lastObservedAtMs)
      .map((runtime) => cloneSnapshot(runtime.snapshot));
  }

  getStatus(): LiveBuildRecommendationTraversalStatus {
    const snapshots = [...this.runtimes.values()].map((runtime) => runtime.snapshot);
    return {
      timeBucketSeconds: LIVE_BUILD_RECOMMENDATION_TIME_BUCKET_S,
      maximumTrackedMatches: LIVE_BUILD_RECOMMENDATION_MAX_TRACKED_MATCHES,
      trackedMatchCount: snapshots.length,
      readyCount: snapshots.filter((snapshot) => snapshot.state === 'READY').length,
      refreshingCount: snapshots.filter((snapshot) => snapshot.state === 'REFRESHING').length,
      waitingCount: snapshots.filter(
        (snapshot) =>
          snapshot.state === 'WAITING_FOR_LOCAL_PLAYER' ||
          snapshot.state === 'WAITING_FOR_HERO',
      ).length,
      errorCount: snapshots.filter((snapshot) => snapshot.state === 'ERROR').length,
      totalRefreshCount: snapshots.reduce((total, snapshot) => total + snapshot.refreshCount, 0),
      totalCacheHitCount: snapshots.reduce((total, snapshot) => total + snapshot.cacheHitCount, 0),
      totalDiscardedResultCount: snapshots.reduce(
        (total, snapshot) => total + snapshot.discardedResultCount,
        0,
      ),
    };
  }

  async waitForIdle(matchId: string): Promise<void> {
    while (this.runtimes.get(matchId)?.worker) {
      await this.runtimes.get(matchId)?.worker;
    }
  }

  private getOrCreateRuntime(matchId: string, observedAt: Date): TraversalRuntime {
    const existing = this.runtimes.get(matchId);
    if (existing) {
      return existing;
    }

    const runtime: TraversalRuntime = {
      matchId,
      lastObservedAtMs: observedAt.getTime(),
      snapshot: {
        state: 'WAITING_FOR_LOCAL_PLAYER',
        matchId,
        itemIds: [],
        enemyHeroIds: [],
        isStale: false,
        refreshCount: 0,
        cacheHitCount: 0,
        discardedResultCount: 0,
        lastObservedAt: observedAt.toISOString(),
      },
    };
    this.runtimes.set(matchId, runtime);
    return runtime;
  }

  private setWaitingState(
    runtime: TraversalRuntime,
    state: Extract<
      LiveBuildRecommendationTraversalState,
      'WAITING_FOR_LOCAL_PLAYER' | 'WAITING_FOR_HERO'
    >,
    observedAt: Date,
    steamId?: string,
  ): void {
    if (runtime.snapshot.recommendation) {
      runtime.snapshot = {
        ...runtime.snapshot,
        state: 'READY',
        isStale: true,
        lastObservedAt: observedAt.toISOString(),
        lastError: undefined,
      };
      return;
    }

    runtime.desiredInput = undefined;
    runtime.resolvedKey = undefined;
    runtime.lastAttemptedKey = undefined;
    runtime.snapshot = {
      state,
      matchId: runtime.matchId,
      steamId,
      itemIds: [],
      enemyHeroIds: [],
      isStale: false,
      refreshCount: runtime.snapshot.refreshCount,
      cacheHitCount: runtime.snapshot.cacheHitCount,
      discardedResultCount: runtime.snapshot.discardedResultCount,
      lastObservedAt: observedAt.toISOString(),
    };
  }

  private startWorker(runtime: TraversalRuntime): void {
    if (runtime.worker) {
      return;
    }

    runtime.worker = this.processRuntime(runtime).finally(() => {
      runtime.worker = undefined;
      this.evictOldRuntimes();
      if (
        runtime.desiredInput &&
        runtime.desiredInput.traversalKey !== runtime.lastAttemptedKey
      ) {
        this.startWorker(runtime);
      }
    });
  }

  private async processRuntime(runtime: TraversalRuntime): Promise<void> {
    while (
      runtime.desiredInput &&
      runtime.desiredInput.traversalKey !== runtime.lastAttemptedKey
    ) {
      const input = runtime.desiredInput;
      runtime.lastAttemptedKey = input.traversalKey;
      runtime.snapshot.state = runtime.snapshot.recommendation ? 'READY' : 'REFRESHING';
      runtime.snapshot.isStale = runtime.snapshot.recommendation !== undefined;
      runtime.snapshot.lastStartedAt = new Date().toISOString();
      runtime.snapshot.lastError = undefined;

      try {
        const recommendationRequest: HeroBuildContextualRecommendationRequest = {
          heroId: input.heroId,
          itemIds: [...input.itemIds],
          enemyHeroIds: [...input.enemyHeroIds],
          gameTimeS: input.gameTimeS,
          limit: HERO_BUILD_MAX_RECOMMENDATION_LIMIT,
        };
        const recommendation = await this.heroBuildRecommendationService.recommend(
          recommendationRequest,
        );
        const filtered = filterHeroBuildRecommendationAlternatives(recommendation, {
          limit: LIVE_BUILD_RECOMMENDATION_LIMIT,
          minHistoricalCount: HERO_BUILD_DEFAULT_MIN_ALTERNATIVE_HISTORICAL_COUNT,
          minConfidence: HERO_BUILD_DEFAULT_MIN_ALTERNATIVE_CONFIDENCE,
        });
        const presented = await this.heroBuildRecommendationPresentationService.present(filtered);

        if (runtime.desiredInput?.traversalKey !== input.traversalKey) {
          runtime.snapshot.discardedResultCount += 1;
          continue;
        }

        runtime.resolvedKey = input.traversalKey;
        runtime.snapshot = {
          ...runtime.snapshot,
          state: 'READY',
          matchId: input.matchId,
          steamId: input.steamId,
          heroId: input.heroId,
          itemIds: [...input.itemIds],
          enemyHeroIds: [...input.enemyHeroIds],
          inventoryStateKey: input.inventoryStateKey,
          gameTimeS: input.gameTimeS,
          timeBucket: input.timeBucket,
          traversalKey: input.traversalKey,
          isStale: false,
          recommendation: presented,
          refreshCount: runtime.snapshot.refreshCount + 1,
          lastUpdatedAt: new Date().toISOString(),
          lastError: undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (runtime.desiredInput?.traversalKey !== input.traversalKey) {
          runtime.snapshot.discardedResultCount += 1;
          continue;
        }
        runtime.snapshot = {
          ...runtime.snapshot,
          state: 'ERROR',
          isStale: runtime.snapshot.recommendation !== undefined,
          lastUpdatedAt: new Date().toISOString(),
          lastError: message,
        };
        this.logger.warn(
          `Live build recommendation traversal failed for match ${input.matchId}: ${message}`,
        );
      }
    }
  }

  private evictOldRuntimes(): void {
    if (this.runtimes.size <= LIVE_BUILD_RECOMMENDATION_MAX_TRACKED_MATCHES) {
      return;
    }

    const removable = [...this.runtimes.values()]
      .filter((runtime) => !runtime.worker)
      .sort((left, right) => left.lastObservedAtMs - right.lastObservedAtMs);
    while (
      this.runtimes.size > LIVE_BUILD_RECOMMENDATION_MAX_TRACKED_MATCHES &&
      removable.length > 0
    ) {
      const runtime = removable.shift();
      if (runtime) {
        this.runtimes.delete(runtime.matchId);
      }
    }
  }
}

export function createTraversalInput(
  state: MinimalMatchState,
  localPlayer: MinimalPlayerState,
): LiveBuildRecommendationTraversalInput {
  const heroId = Number(localPlayer.heroId);
  const itemIds = localPlayer.items
    .map((item) => Number(item.id))
    .filter((itemId) => Number.isSafeInteger(itemId) && itemId > 0)
    .sort((left, right) => left - right);
  const enemyHeroIds = localPlayer.teamId === undefined
    ? []
    : [...new Set(
        Object.values(state.playersBySteamId)
          .filter(
            (player) =>
              player.teamId !== undefined &&
              player.teamId !== localPlayer.teamId &&
              Number.isSafeInteger(player.heroId) &&
              Number(player.heroId) > 0,
          )
          .map((player) => Number(player.heroId)),
      )].sort((left, right) => left - right);
  const inventoryStateKey = createInventoryStateKeyFromItemIds(itemIds);
  const gameTimeS = Number.isFinite(state.gameTimeSec)
    ? Math.max(0, Math.floor(Number(state.gameTimeSec)))
    : 0;
  const timeBucket = Math.floor(gameTimeS / LIVE_BUILD_RECOMMENDATION_TIME_BUCKET_S);
  const traversalKey = [
    state.matchId,
    localPlayer.steamId,
    heroId,
    inventoryStateKey,
    enemyHeroIds.join(','),
    timeBucket,
  ].join(':');

  return {
    matchId: state.matchId,
    steamId: localPlayer.steamId,
    heroId,
    itemIds,
    enemyHeroIds,
    inventoryStateKey,
    gameTimeS,
    timeBucket,
    traversalKey,
  };
}

function findLocalPlayer(state: MinimalMatchState): MinimalPlayerState | undefined {
  return Object.values(state.playersBySteamId)
    .filter((player) => player.isLocal === true)
    .sort((left, right) => left.steamId.localeCompare(right.steamId))[0];
}

function cloneSnapshot(
  snapshot: LiveBuildRecommendationTraversalSnapshot,
): LiveBuildRecommendationTraversalSnapshot {
  return {
    ...snapshot,
    itemIds: [...snapshot.itemIds],
    enemyHeroIds: [...snapshot.enemyHeroIds],
    recommendation: snapshot.recommendation
      ? {
          ...snapshot.recommendation,
          action: { ...snapshot.recommendation.action },
          alternatives: snapshot.recommendation.alternatives.map((action) => ({ ...action })),
          itemMetadata: {
            ...snapshot.recommendation.itemMetadata,
            missingItemIds: [...snapshot.recommendation.itemMetadata.missingItemIds],
          },
          alternativeFilter: { ...snapshot.recommendation.alternativeFilter },
        }
      : undefined,
  };
}
