import {
  LiveBuildRecommendationPoller,
  LiveBuildRecommendationSnapshot,
} from './live-build-recommendation-poller';
import {
  hideLiveBuildRecommendation,
  showLiveBuildRecommendation,
} from './live-build-recommendation-ui';

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

  mainWindow.inGameLiveBuildRecommendationUpdate = (
    snapshot: LiveBuildRecommendationSnapshot,
  ) => {
    showLiveBuildRecommendation(snapshot);
    resizeOverlayToContent();
  };

  mainWindow.inGameLiveBuildRecommendationClear = () => {
    hideLiveBuildRecommendation();
    resizeOverlayToContent();
  };

  (window as any).refreshLiveBuildRecommendation = () => {
    if (typeof mainWindow.forceLiveBuildRecommendationRefresh === 'function') {
      mainWindow.forceLiveBuildRecommendationRefresh();
    }
  };

  if (mainWindow.latestLiveBuildRecommendation) {
    showLiveBuildRecommendation(mainWindow.latestLiveBuildRecommendation);
    resizeOverlayToContent();
  }
}

function initializeBackgroundTraversal(): void {
  const mainWindow = ow.windows.getMainWindow() as any;
  mainWindow.latestLiveBuildRecommendation =
    mainWindow.latestLiveBuildRecommendation ?? null;

  let currentMatchId = '';

  const poller = new LiveBuildRecommendationPoller({
    apiBaseUrl: API_BASE_URL,
    onSnapshot: (snapshot) => {
      mainWindow.latestLiveBuildRecommendation = snapshot;
      if (typeof mainWindow.inGameLiveBuildRecommendationUpdate === 'function') {
        mainWindow.inGameLiveBuildRecommendationUpdate(snapshot);
      }
    },
    onClear: () => {
      mainWindow.latestLiveBuildRecommendation = null;
      if (typeof mainWindow.inGameLiveBuildRecommendationClear === 'function') {
        mainWindow.inGameLiveBuildRecommendationClear();
      }
    },
    onError: (error) => {
      console.warn(`Live build recommendation polling failed: ${error.message}`);
    },
  });

  const setCurrentMatchId = (matchId: string): void => {
    const normalizedMatchId = matchId.trim();
    if (normalizedMatchId === currentMatchId) {
      return;
    }

    currentMatchId = normalizedMatchId;
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

    const matchInfo = result.res.match_info;
    const matchId = readString(matchInfo?.match_id);
    if (matchId) {
      setMatchId(matchId);
    }

    const matchState = readString(matchInfo?.match_state);
    if (matchState?.toLowerCase() === 'ended') {
      setMatchId('');
    }
  });
}

function registerMatchLifecycleListeners(
  setMatchId: (matchId: string) => void,
): void {
  ow.games?.events?.onInfoUpdates2?.addListener((update: any) => {
    const info = update?.info;
    if (!info || typeof info !== 'object') {
      return;
    }

    const matchInfo = info.match_info;
    const matchId = readString(matchInfo?.match_id);
    if (matchId) {
      setMatchId(matchId);
    }

    const matchState = readString(matchInfo?.match_state);
    if (matchState?.toLowerCase() === 'ended') {
      setMatchId('');
    }
  });

  ow.games?.events?.onNewEvents?.addListener((eventBatch: any) => {
    const events = Array.isArray(eventBatch?.events) ? eventBatch.events : [];
    for (const event of events) {
      if (event?.name === 'match_id') {
        const matchId = readString(event.data);
        if (matchId) {
          setMatchId(matchId);
        }
      }

      if (event?.name === 'match_state') {
        const matchState = readString(event.data);
        if (matchState?.toLowerCase() === 'ended') {
          setMatchId('');
        }
      }
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

function resizeOverlayToContent(): void {
  const resize = (window as any).ensureOverlayHeight;
  if (typeof resize === 'function') {
    resize();
  }
}
