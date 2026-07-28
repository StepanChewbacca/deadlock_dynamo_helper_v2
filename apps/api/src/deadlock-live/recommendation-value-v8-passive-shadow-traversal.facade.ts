import { Inject, Injectable } from '@nestjs/common';
import type {
  MinimalMatchState,
  MinimalPlayerState,
} from '@deadlock-live-probe/shared';
import {
  LiveBuildRecommendationTraversalService,
  type LiveBuildRecommendationTraversalSnapshot,
  type LiveBuildRecommendationTraversalStatus,
} from './live-build-recommendation-traversal.service';
import { RecommendationValueV8PassiveShadowService } from './recommendation-value-v8-passive-shadow.service';

export const BASE_LIVE_BUILD_RECOMMENDATION_TRAVERSAL = Symbol(
  'BASE_LIVE_BUILD_RECOMMENDATION_TRAVERSAL',
);

@Injectable()
export class RecommendationValueV8PassiveShadowTraversalFacade {
  private readonly latestStateByMatchId = new Map<string, MinimalMatchState>();
  private readonly processedDecisionIds = new Set<string>();
  private readonly pendingMatchIds = new Set<string>();
  private readonly workersByMatchId = new Map<string, Promise<void>>();

  constructor(
    @Inject(BASE_LIVE_BUILD_RECOMMENDATION_TRAVERSAL)
    private readonly base: LiveBuildRecommendationTraversalService,
    private readonly shadowService: RecommendationValueV8PassiveShadowService,
  ) {}

  observeState(state: MinimalMatchState | undefined): void {
    if (state?.matchId && state.matchId !== 'unknown') {
      this.latestStateByMatchId.set(state.matchId, clone(state));
    }
    this.base.observeState(state);
    if (state?.matchId && state.matchId !== 'unknown') {
      this.pendingMatchIds.add(state.matchId);
      this.scheduleAfterBaseline(state.matchId);
    }
  }

  getMatchSnapshot(
    matchId: string,
  ): LiveBuildRecommendationTraversalSnapshot | undefined {
    return this.base.getMatchSnapshot(matchId);
  }

  getAllSnapshots(): LiveBuildRecommendationTraversalSnapshot[] {
    return this.base.getAllSnapshots();
  }

  getStatus(): LiveBuildRecommendationTraversalStatus {
    return this.base.getStatus();
  }

  async waitForIdle(matchId: string): Promise<void> {
    await this.base.waitForIdle(matchId);
  }

  async waitForShadowIdle(matchId: string): Promise<void> {
    while (this.workersByMatchId.has(matchId)) {
      await this.workersByMatchId.get(matchId);
    }
    await this.shadowService.waitForIdle();
  }

  private scheduleAfterBaseline(matchId: string): void {
    if (this.workersByMatchId.has(matchId)) {
      return;
    }
    const worker = this.processPendingMatch(matchId).finally(() => {
      this.workersByMatchId.delete(matchId);
      if (this.pendingMatchIds.has(matchId)) {
        this.scheduleAfterBaseline(matchId);
      }
    });
    this.workersByMatchId.set(matchId, worker);
  }

  private async processPendingMatch(matchId: string): Promise<void> {
    while (this.pendingMatchIds.delete(matchId)) {
      await this.captureLatestDecision(matchId);
    }
  }

  private async captureLatestDecision(matchId: string): Promise<void> {
    await this.base.waitForIdle(matchId);
    const snapshot = this.base.getMatchSnapshot(matchId);
    if (
      !snapshot?.decisionId ||
      !snapshot.recommendation ||
      this.processedDecisionIds.has(snapshot.decisionId)
    ) {
      return;
    }
    const state = this.latestStateByMatchId.get(matchId);
    const localPlayer = state ? findLocalPlayer(state) : undefined;
    if (!state || !localPlayer || !stateMatchesSnapshot(state, localPlayer, snapshot)) {
      return;
    }
    this.processedDecisionIds.add(snapshot.decisionId);
    if (this.processedDecisionIds.size > 200_000) {
      this.processedDecisionIds.clear();
      this.processedDecisionIds.add(snapshot.decisionId);
    }
    this.shadowService.schedule({
      decisionId: snapshot.decisionId,
      state,
      localPlayer,
      previousActionKeys: [...snapshot.previousActionKeys],
      displayedActionKeys: [
        snapshot.recommendation.action.actionKey,
        ...snapshot.recommendation.alternatives.map(
          (candidate) => candidate.actionKey,
        ),
      ],
    });
  }
}

function stateMatchesSnapshot(
  state: MinimalMatchState,
  player: MinimalPlayerState,
  snapshot: LiveBuildRecommendationTraversalSnapshot,
): boolean {
  const itemIds = player.items
    .map((item) => Number(item.id))
    .filter((itemId) => Number.isSafeInteger(itemId) && itemId > 0)
    .sort((left, right) => left - right);
  const snapshotItems = [...snapshot.itemIds].sort((left, right) => left - right);
  const gameTimeS = Number.isFinite(state.gameTimeSec)
    ? Number(state.gameTimeSec)
    : 0;
  return (
    itemIds.length === snapshotItems.length &&
    itemIds.every((itemId, index) => itemId === snapshotItems[index]) &&
    Math.floor(gameTimeS / 120) === snapshot.timeBucket
  );
}

function findLocalPlayer(
  state: MinimalMatchState,
): MinimalPlayerState | undefined {
  const players = Object.values(state.playersBySteamId);
  return players.find((player) => player.isLocal) ??
    (players.length === 1 ? players[0] : undefined);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
