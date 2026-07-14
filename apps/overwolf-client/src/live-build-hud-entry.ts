import { disableLegacyBuildGuide } from './disable-legacy-build-guide';
import {
  clearLiveBuildDesktop,
  showLiveBuildDesktop,
  showLiveBuildDesktopError,
} from './live-build-desktop-table-ui';
import {
  LiveBuildRecommendationPoller,
  LiveBuildRecommendationSnapshot,
} from './live-build-recommendation-poller';
import { showLiveBuildRecommendation } from './live-build-recommendation-ui';

const API_BASE_URL = 'https://aboba-telegramovich.duckdns.org';
const MATCH_INFO_REFRESH_MS = 2000;

const ow = (window as any).overwolf;

if (ow?.windows) {
  ow.windows.getCurrentWindow((windowResult: any) => {
    const currentWindowName = windowResult?.window?.name;
    if (currentWindowName === 'in_game') {
      initializeInGameHud();
      return;
    }

    initializeBackgroundTraversal();
  });
}

function initializeInGameHud(): void {
  const mainWindow = ow.windows.getMainWindow() as any;
  disableLegacyBuildGuide();

  mainWindow.inGameLiveBuildRecommendationUpdate = (
    snapshot: LiveBuildRecommendationSnapshot,
  ) => {
    disableLegacyBuildGuide();
    showLiveBuildRecommendation(snapshot);
    resizeOverlayToContent();
  };

  mainWindow.inGameLiveBuildRecommendationClear = () => {
    disableLegacyBuildGuide();
    showLiveBuildRecommendation(createWaitingSnapshot(''));
    resizeOverlayToContent();
  };

  (window as any).refreshLiveBuildRecommendation = () => {
    if (typeof mainWindow.forceLiveBuildRecommendationRefresh === 'function') {
      mainWindow.forceLiveBuildRecommendationRefresh();
    }
  };

  if (mainWindow.latestLiveBuildRecommendation) {
    showLiveBuildRecommendation(mainWindow.latestLiveBuildRecommendation);
  } else {
    showLiveBuildRecommendation(createWaitingSnapshot(''));
  }
  resizeOverlayToContent();
}

function initializeBackgroundTraversal(): void {
  const mainWindow = ow.windows.getMainWindow() as any;
  mainWindow.latestLiveBuildRecommendation =
    mainWindow.latestLiveBuildRecommendation ?? null;

  let currentMatchId = '';
  exposeCurrentMatchId(mainWindow, currentMatchId);
  showLiveBuildDesktop(createWaitingSnapshot(currentMatchId));

  const poller = new LiveBuildRecommendationPoller({
    apiBaseUrl: API_BASE_URL,
    onSnapshot: (snapshot) => {
      mainWindow.latestLiveBuildRecommendation = snapshot;
      showLiveBuildDesktop(snapshot);
      if (typeof mainWindow.inGameLiveBuildRecommendationUpdate === 'function') {
        mainWindow.inGameLiveBuildRecommendationUpdate(snapshot);
      }
    },
    onClear: () => {
      mainWindow.latestLiveBuildRecommendation = null;
      clearLiveBuildDesktop();
      if (typeof mainWindow.inGameLiveBuildRecommendationClear === 'function') {
        mainWindow.inGameLiveBuildRecommendationClear();
      }
    },
    onError: (error) => {
      showLiveBuildDesktopError(error.message);
      console.warn(`Live build recommendation polling failed: ${error.message}`);
    },
  });

  const setCurrentMatchId = (matchId: string): void => {
    const normalizedMatchId = matchId.trim();
    exposeCurrentMatchId(mainWindow, normalizedMatchId);

    if (normalizedMatchId === currentMatchId) {
      return;
    }

    currentMatchId = normalizedMatchId;
    if (currentMatchId) {
      showLiveBuildDesktop(createWaitingSnapshot(currentMatchId));
    } else {
      clearLiveBuildDesktop();
    }
    poller.setMatchId(currentMatchId);
    console.log(
      currentMatchId
        ? `Live build HUD tracking match ${currentMatchId}.`
        : 'Live build HUD cleared match tracking.',
    );
  };

  mainWindow.forceLiveBuildRecommendationRefresh = () => {
    void poller.forceRefresh();
  };

  poller.start();
  restoreMatchIdFromGep(setCurrentMatchId);
  setInterval(() => restoreMatchIdFromGep(setCurrentMatchId), MATCH_INFO_REFRESH_MS);
  registerMatchLifecycleListeners(setCurrentMatchId);
}

function restoreMatchIdFromGep(setMatchId: (matchId: string) => void): void {
  ow.games?.events?.getInfo((result: any) => {
    if (!result?.success || !result.res) {
      return;
    }

    const lifecycle = extractMatchLifecycle(result.res);
    if (lifecycle.ended) {
      setMatchId('');
      return;
    }

    if (lifecycle.matchId) {
      setMatchId(lifecycle.matchId);
    }
  });
}

function registerMatchLifecycleListeners(
  setMatchId: (matchId: string) => void,
): void {
  ow.games?.events?.onInfoUpdates2?.addListener((update: any) => {
    const lifecycle = extractMatchLifecycle(update?.info);
    if (lifecycle.ended) {
      setMatchId('');
      return;
    }

    if (lifecycle.matchId) {
      setMatchId(lifecycle.matchId);
    }
  });

  ow.games?.events?.onNewEvents?.addListener((eventBatch: any) => {
    const events = Array.isArray(eventBatch?.events) ? eventBatch.events : [];
    let nextMatchId = '';
    let ended = false;

    for (const event of events) {
      if (event?.name === 'match_id') {
        nextMatchId = readString(event.data) ?? nextMatchId;
      }

      if (event?.name === 'match_state') {
        ended = readString(event.data)?.toLowerCase() === 'ended' || ended;
      }
    }

    if (ended) {
      setMatchId('');
    } else if (nextMatchId) {
      setMatchId(nextMatchId);
    }
  });
}

export function readString(value: unknown): string | undefined {
  const parsed = parseJsonValue(value);
  if (typeof parsed === 'string') {
    const normalized = parsed.trim();
    return normalized || undefined;
  }

  if (typeof parsed === 'number' && Number.isFinite(parsed)) {
    return String(parsed);
  }

  return undefined;
}

function extractMatchLifecycle(value: unknown): {
  matchId?: string;
  ended: boolean;
} {
  if (!isRecord(value)) {
    return { ended: false };
  }

  let matchId = readString(value.match_id);
  let ended = readString(value.match_state)?.toLowerCase() === 'ended';

  for (const nested of Object.values(value)) {
    if (!isRecord(nested)) {
      continue;
    }

    matchId = readString(nested.match_id) ?? matchId;
    ended = readString(nested.match_state)?.toLowerCase() === 'ended' || ended;
  }

  return { matchId, ended };
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  try {
    return JSON.parse(normalized);
  } catch {
    return normalized;
  }
}

function exposeCurrentMatchId(mainWindow: any, matchId: string): void {
  (globalThis as any).__deadlockLiveMatchId = matchId;
  mainWindow.__deadlockLiveMatchId = matchId;
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
    lastObservedAt: new Date().toISOString(),
  };
}

function resizeOverlayToContent(): void {
  const resize = (window as any).ensureOverlayHeight;
  if (typeof resize === 'function') {
    resize();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
