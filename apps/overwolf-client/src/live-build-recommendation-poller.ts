export type LiveBuildTraversalState =
  | 'WAITING_FOR_BACKEND'
  | 'WAITING_FOR_LOCAL_PLAYER'
  | 'WAITING_FOR_HERO'
  | 'REFRESHING'
  | 'READY'
  | 'ERROR';

export interface LiveBuildRecommendationItem {
  itemId: number;
  name: string;
  className: string;
  slotType: string;
  cost: number;
  tier: number;
}

export interface LiveBuildRecommendationExplanation {
  code: string;
  evidenceLevel: 'OBSERVED' | 'INFERRED';
  text: string;
}

export interface LiveBuildRecommendationAction {
  type: 'BUY' | 'UPGRADE' | 'SELL' | 'HOLD';
  itemId?: number;
  actionKey: string;
  label: string;
  confidencePercent: number;
  historicalProbabilityPercent: number;
  typicalGameTimeLabel: string;
  item?: LiveBuildRecommendationItem;
  explanation: LiveBuildRecommendationExplanation;
}

export interface LiveBuildRecommendationPayload {
  mode: 'EXACT' | 'BACKOFF' | 'NO_MATCH';
  action: LiveBuildRecommendationAction;
  alternatives: LiveBuildRecommendationAction[];
}

export interface LiveBuildRecommendationSnapshot {
  state: LiveBuildTraversalState;
  matchId: string;
  steamId?: string;
  heroId?: number;
  itemIds: number[];
  inventoryStateKey?: string;
  gameTimeS?: number;
  timeBucket?: number;
  traversalKey?: string;
  isStale: boolean;
  recommendation?: LiveBuildRecommendationPayload;
  refreshCount: number;
  cacheHitCount: number;
  discardedResultCount: number;
  lastObservedAt: string;
  lastStartedAt?: string;
  lastUpdatedAt?: string;
  lastError?: string;
}

export interface LiveBuildRecommendationPollerOptions {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  onSnapshot: (snapshot: LiveBuildRecommendationSnapshot) => void;
  onClear: () => void;
  onError?: (error: Error) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;

export class LiveBuildRecommendationPoller {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly intervalMs: number;
  private readonly onSnapshot: (snapshot: LiveBuildRecommendationSnapshot) => void;
  private readonly onClear: () => void;
  private readonly onError?: (error: Error) => void;

  private matchId = '';
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<void>;
  private rerunRequested = false;
  private lastPresentationKey = '';

  constructor(options: LiveBuildRecommendationPollerOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl;
    this.intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onSnapshot = options.onSnapshot;
    this.onClear = options.onClear;
    this.onError = options.onError;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.pollNow();
    }, this.intervalMs);

    if (this.matchId) {
      void this.pollNow();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  setMatchId(matchId: string): void {
    const normalizedMatchId = matchId.trim();
    if (normalizedMatchId === this.matchId) {
      return;
    }

    this.matchId = normalizedMatchId;
    this.lastPresentationKey = '';
    this.rerunRequested = false;

    if (!this.matchId) {
      this.onClear();
      return;
    }

    void this.pollNow();
  }

  forceRefresh(): Promise<void> {
    this.lastPresentationKey = '';
    return this.pollNow();
  }

  pollNow(): Promise<void> {
    if (!this.matchId) {
      return Promise.resolve();
    }

    if (this.inFlight) {
      this.rerunRequested = true;
      return this.inFlight;
    }

    const requestedMatchId = this.matchId;
    this.inFlight = this.fetchSnapshot(requestedMatchId)
      .catch((error: unknown) => {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        this.onError?.(normalizedError);
      })
      .finally(() => {
        this.inFlight = undefined;
        if (this.rerunRequested) {
          this.rerunRequested = false;
          void this.pollNow();
        }
      });

    return this.inFlight;
  }

  private request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const injectedFetch = this.fetchImpl;
    if (injectedFetch) {
      return injectedFetch(input, init);
    }

    return window.fetch(input, init);
  }

  private async fetchSnapshot(requestedMatchId: string): Promise<void> {
    const response = await this.request(
      `${this.apiBaseUrl}/deadlock/live/matches/${encodeURIComponent(requestedMatchId)}/build-recommendation`,
      {
        method: 'GET',
        cache: 'no-store',
      },
    );

    if (requestedMatchId !== this.matchId) {
      return;
    }

    if (response.status === 404 || response.status === 204) {
      this.emitSnapshot(createWaitingSnapshot(requestedMatchId));
      return;
    }

    if (!response.ok) {
      throw new Error(`Build recommendation request failed with HTTP ${response.status}.`);
    }

    const body = await response.text();
    if (!body.trim()) {
      this.emitSnapshot(createWaitingSnapshot(requestedMatchId));
      return;
    }

    const parsed = JSON.parse(body) as unknown;
    if (!isLiveBuildRecommendationSnapshot(parsed)) {
      throw new Error('Build recommendation response has an invalid shape.');
    }

    if (requestedMatchId !== this.matchId) {
      return;
    }

    this.emitSnapshot(parsed);
  }

  private emitSnapshot(snapshot: LiveBuildRecommendationSnapshot): void {
    const presentationKey = createLiveBuildRecommendationPresentationKey(snapshot);
    if (presentationKey === this.lastPresentationKey) {
      return;
    }

    this.lastPresentationKey = presentationKey;
    this.onSnapshot(snapshot);
  }
}

export function createLiveBuildRecommendationPresentationKey(
  snapshot: LiveBuildRecommendationSnapshot,
): string {
  return [
    snapshot.matchId,
    snapshot.state,
    snapshot.traversalKey ?? '',
    snapshot.isStale ? 'stale' : 'fresh',
    snapshot.refreshCount,
    snapshot.lastError ?? '',
    snapshot.recommendation?.mode ?? '',
    snapshot.recommendation?.action.actionKey ?? '',
  ].join('|');
}

function createWaitingSnapshot(matchId: string): LiveBuildRecommendationSnapshot {
  return {
    state: 'WAITING_FOR_BACKEND',
    matchId,
    itemIds: [],
    isStale: false,
    refreshCount: 0,
    cacheHitCount: 0,
    discardedResultCount: 0,
    lastObservedAt: '',
  };
}

function isLiveBuildRecommendationSnapshot(
  value: unknown,
): value is LiveBuildRecommendationSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.state === 'string' &&
    typeof value.matchId === 'string' &&
    Array.isArray(value.itemIds) &&
    typeof value.isStale === 'boolean' &&
    typeof value.refreshCount === 'number' &&
    typeof value.cacheHitCount === 'number' &&
    typeof value.discardedResultCount === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
