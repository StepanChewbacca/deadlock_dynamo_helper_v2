import { disableLegacyBuildGuide } from './disable-legacy-build-guide';
import {
  clearLiveBuildDesktop,
  showLiveBuildDesktop,
  showLiveBuildDesktopError,
} from './live-build-desktop-full-build-ui';
import {
  LiveBuildRecommendationPoller,
  LiveBuildRecommendationSnapshot,
} from './live-build-recommendation-poller';
import { showLiveBuildRecommendation } from './live-build-recommendation-ui';
import { createSituationalItemWarning } from './situational-item-metadata';
import type { SituationalItemWarning } from './situational-item-metadata';
import { decorateLiveBuildRecommendation } from './situational-item-ui';
import {
  fetchHeroSkillBuild,
  SkillBuildPresentation,
} from './skill-build-client';
import {
  clearOverlaySkillBuild,
  showDesktopSkillBuild,
  showOverlaySkillBuild,
} from './skill-build-ui';

const API_BASE_URL = 'https://aboba-telegramovich.duckdns.org';
const MATCH_INFO_REFRESH_MS = 2000;
const SITUATIONAL_WARNING_DURATION_MS = 15_000;

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
    decorateLiveBuildRecommendation(snapshot);
    resizeOverlayToContent();
  };

  mainWindow.inGameLiveBuildRecommendationClear = () => {
    disableLegacyBuildGuide();
    const waiting = createWaitingSnapshot('');
    showLiveBuildRecommendation(waiting);
    decorateLiveBuildRecommendation(waiting);
    resizeOverlayToContent();
  };

  mainWindow.inGameSkillBuildUpdate = (
    presentation: SkillBuildPresentation,
  ) => {
    showOverlaySkillBuild(presentation);
    resizeOverlayToContent();
  };

  mainWindow.inGameSkillBuildClear = () => {
    clearOverlaySkillBuild();
    resizeOverlayToContent();
  };

  (window as any).refreshLiveBuildRecommendation = () => {
    if (typeof mainWindow.forceLiveBuildRecommendationRefresh === 'function') {
      mainWindow.forceLiveBuildRecommendationRefresh();
    }
  };

  const initialSnapshot = mainWindow.latestLiveBuildRecommendation
    ?? createWaitingSnapshot('');
  showLiveBuildRecommendation(initialSnapshot);
  decorateLiveBuildRecommendation(initialSnapshot);

  const initialSkillBuild = mainWindow.latestSkillBuildPresentation as
    | SkillBuildPresentation
    | undefined;
  if (initialSkillBuild && initialSkillBuild.state !== 'EMPTY') {
    showOverlaySkillBuild(initialSkillBuild);
  } else {
    clearOverlaySkillBuild();
  }
  resizeOverlayToContent();
}

function initializeBackgroundTraversal(): void {
  const mainWindow = ow.windows.getMainWindow() as any;
  mainWindow.latestLiveBuildRecommendation =
    mainWindow.latestLiveBuildRecommendation ?? null;
  mainWindow.latestSkillBuildPresentation =
    mainWindow.latestSkillBuildPresentation ?? { state: 'EMPTY' };
  mainWindow.situationalItemWarning = undefined;

  let currentMatchId = '';
  let currentSkillBuildHeroId: number | undefined;
  let skillBuildGeneration = 0;
  let warningTimer: ReturnType<typeof setTimeout> | undefined;
  const shownWarningKeys = new Set<string>();
  const skillBuildCache = new Map<number, SkillBuildPresentation>();

  const publishSkillBuild = (presentation: SkillBuildPresentation): void => {
    mainWindow.latestSkillBuildPresentation = presentation;
    showDesktopSkillBuild(presentation);
    if (typeof mainWindow.inGameSkillBuildUpdate === 'function') {
      mainWindow.inGameSkillBuildUpdate(presentation);
    }
  };

  const clearSkillBuild = (): void => {
    currentSkillBuildHeroId = undefined;
    skillBuildGeneration += 1;
    const empty: SkillBuildPresentation = { state: 'EMPTY' };
    mainWindow.latestSkillBuildPresentation = empty;
    showDesktopSkillBuild(empty);
    if (typeof mainWindow.inGameSkillBuildClear === 'function') {
      mainWindow.inGameSkillBuildClear();
    }
  };

  const syncSkillBuild = (heroIdValue: number | undefined): void => {
    const heroId = normalizeHeroId(heroIdValue);
    if (heroId === undefined) {
      if (currentSkillBuildHeroId !== undefined) {
        clearSkillBuild();
      }
      return;
    }

    if (heroId === currentSkillBuildHeroId) {
      return;
    }

    currentSkillBuildHeroId = heroId;
    const cached = skillBuildCache.get(heroId);
    if (cached?.state === 'READY') {
      publishSkillBuild(cached);
      return;
    }

    const generation = ++skillBuildGeneration;
    publishSkillBuild({ state: 'LOADING', heroId });

    void fetchHeroSkillBuild(API_BASE_URL, heroId)
      .then((build) => {
        if (generation !== skillBuildGeneration || heroId !== currentSkillBuildHeroId) {
          return;
        }
        const ready: SkillBuildPresentation = { state: 'READY', build };
        skillBuildCache.set(heroId, ready);
        publishSkillBuild(ready);
      })
      .catch((error: unknown) => {
        if (generation !== skillBuildGeneration || heroId !== currentSkillBuildHeroId) {
          return;
        }
        const presentation: SkillBuildPresentation = {
          state: 'ERROR',
          heroId,
          message: error instanceof Error ? error.message : String(error),
        };
        skillBuildCache.set(heroId, presentation);
        publishSkillBuild(presentation);
        console.warn(`Skill build loading failed: ${presentation.message}`);
      });
  };

  const clearSituationalWarning = (): void => {
    if (warningTimer) {
      clearTimeout(warningTimer);
      warningTimer = undefined;
    }
    mainWindow.situationalItemWarning = undefined;
    mainWindow.updateWarningUI?.();
  };

  const showSituationalWarning = (
    warning: SituationalItemWarning,
  ): void => {
    if (shownWarningKeys.has(warning.key)) {
      return;
    }

    shownWarningKeys.add(warning.key);
    mainWindow.situationalItemWarning = warning;
    mainWindow.updateWarningUI?.();

    if (warningTimer) {
      clearTimeout(warningTimer);
    }
    warningTimer = setTimeout(() => {
      if (mainWindow.situationalItemWarning?.key === warning.key) {
        mainWindow.situationalItemWarning = undefined;
        mainWindow.updateWarningUI?.();
      }
      warningTimer = undefined;
    }, SITUATIONAL_WARNING_DURATION_MS);
  };

  exposeCurrentMatchId(mainWindow, currentMatchId);
  showLiveBuildDesktop(createWaitingSnapshot(currentMatchId));
  showDesktopSkillBuild(mainWindow.latestSkillBuildPresentation);

  const poller = new LiveBuildRecommendationPoller({
    apiBaseUrl: API_BASE_URL,
    onSnapshot: (snapshot) => {
      mainWindow.latestLiveBuildRecommendation = snapshot;
      showLiveBuildDesktop(snapshot);
      syncSkillBuild(snapshot.heroId);
      if (typeof mainWindow.inGameLiveBuildRecommendationUpdate === 'function') {
        mainWindow.inGameLiveBuildRecommendationUpdate(snapshot);
      }

      const warning = createSituationalItemWarning(
        snapshot,
        mainWindow.heroNamesMap || {},
      );
      if (warning) {
        showSituationalWarning(warning);
      }
    },
    onClear: () => {
      mainWindow.latestLiveBuildRecommendation = null;
      clearLiveBuildDesktop();
      clearSkillBuild();
      clearSituationalWarning();
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
    shownWarningKeys.clear();
    clearSituationalWarning();

    if (currentMatchId) {
      showLiveBuildDesktop(createWaitingSnapshot(currentMatchId));
    } else {
      clearLiveBuildDesktop();
      clearSkillBuild();
    }
    poller.setMatchId(currentMatchId);
    console.log(
      currentMatchId
        ? `Live build HUD tracking match ${currentMatchId}.`
        : 'Live build HUD cleared match tracking.',
    );
  };

  mainWindow.forceLiveBuildRecommendationRefresh = () => {
    currentSkillBuildHeroId = undefined;
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
    enemyHeroIds: [],
    isStale: false,
    refreshCount: 0,
    cacheHitCount: 0,
    discardedResultCount: 0,
    lastObservedAt: new Date().toISOString(),
  };
}

function normalizeHeroId(value: number | undefined): number | undefined {
  const heroId = Number(value);
  return Number.isSafeInteger(heroId) && heroId > 0 ? heroId : undefined;
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
