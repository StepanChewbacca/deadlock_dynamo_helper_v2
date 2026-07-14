import { LiveEventBuffer } from './overwolf/live-event-buffer';
import { setRequiredFeatures } from './overwolf/set-required-features';
import { listenOverwolfEvents } from './overwolf/listen-overwolf-events';
import * as ui from './ui';

const clientId = `client-${Math.random().toString(36).substring(2, 8)}`;
const apiBaseUrl = 'https://aboba-telegramovich.duckdns.org';
const ow = (window as any).overwolf;

if (ow?.windows) {
  ow.windows.getCurrentWindow((windowResult: any) => {
    const currentWindowName = windowResult?.window?.name;
    if (currentWindowName === 'in_game') {
      initializeInGameWindow(windowResult.window.id);
      return;
    }

    initializeBackgroundWindow();
  });
}

function initializeInGameWindow(windowId: string): void {
  ui.logConsole('In-game live build overlay loaded.');

  const ensureOverlayHeight = (): void => {
    const hud = document.querySelector('.hud-container') as HTMLElement | null;
    if (!hud) {
      return;
    }

    requestAnimationFrame(() => {
      const minimumHeight = 260;
      const maximumHeight = 700;
      const contentHeight = Math.ceil(hud.scrollHeight + 24);
      const targetHeight = Math.max(
        minimumHeight,
        Math.min(maximumHeight, contentHeight),
      );
      ow.windows.changeSize(windowId, 340, targetHeight);
    });
  };

  const toggleHudMode = (): void => {
    const hud = document.querySelector('.hud-container');
    const button = document.getElementById('hud-toggle-mode');
    if (!hud || !button) {
      return;
    }

    const isCompact = hud.classList.toggle('compact');
    button.textContent = isCompact ? '🗖' : '🗕';
    ensureOverlayHeight();
  };

  (window as any).ensureOverlayHeight = ensureOverlayHeight;
  (window as any).toggleHudMode = toggleHudMode;

  const setupDrag = (): void => {
    const container = document.querySelector('.hud-container');
    if (!container) {
      return;
    }

    container.addEventListener('mousedown', (event: any) => {
      if (
        event.target?.tagName === 'SELECT' ||
        event.target?.tagName === 'OPTION' ||
        event.target?.tagName === 'BUTTON' ||
        event.target?.closest?.('button') ||
        event.target?.closest?.('.guide-item-row') ||
        event.target?.closest?.('.skill-badge') ||
        event.target?.closest?.('.phase-col')
      ) {
        return;
      }
      ow.windows.dragMove(windowId);
    });

    setTimeout(ensureOverlayHeight, 500);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDrag, { once: true });
  } else {
    setupDrag();
  }
}

function initializeBackgroundWindow(): void {
  ui.logConsole(`Initializing background controller for clientId: ${clientId}`);

  const mainWindow = ow.windows.getMainWindow() as any;
  mainWindow.heroNamesMap = mainWindow.heroNamesMap || {};
  mainWindow.overlayMenuActive = false;

  preloadDynamoWarningWindow(mainWindow);

  const customFetch = async (
    url: string,
    init?: RequestInit,
  ): Promise<Response> => {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        ui.incrementSends();
        ui.updateIndicator('NestJS API connected & sending', true);
      } else {
        ui.logConsole(`Ingest error: HTTP ${response.status}`);
        ui.updateIndicator(`Ingest error: HTTP ${response.status}`, false);
      }
      return response;
    } catch (error: any) {
      ui.logConsole(`Network error: ${error?.message || error}`);
      ui.updateIndicator('NestJS API offline', false);
      throw error;
    }
  };

  const buffer = new LiveEventBuffer(clientId, apiBaseUrl, customFetch, 1000);

  const register = async (): Promise<void> => {
    try {
      ui.updateStatus('REGISTERING...', 'init');
      await setRequiredFeatures();
      ui.updateStatus('REGISTERED', 'success');
      ui.logConsole('Successfully registered GEP required features: game_info, match_info');

      restoreHeroNamesFromGep(mainWindow);
      listenOverwolfEvents((event) => {
        const eventDetails = `Source: ${event.source} | Key: ${event.key || 'n/a'} | Cat: ${event.category || 'n/a'}`;
        ui.updateLastEvent(eventDetails);
        captureHeroName(event, mainWindow);
        buffer.push(event);
      });

      registerOverlayConfigurationListener(mainWindow);
    } catch (error: any) {
      ui.updateStatus('FAILED', 'error');
      ui.logConsole(
        `GEP feature registration failed: ${error?.message || error}. Retrying in 5s...`,
      );
      setTimeout(() => {
        void register();
      }, 5000);
    }
  };

  void register();
}

function preloadDynamoWarningWindow(mainWindow: any): void {
  ow.windows.obtainDeclaredWindow('dynamo_warning', (result: any) => {
    if (!result?.success || !result.window?.id) {
      return;
    }

    ow.windows.restore(result.window.id, () => {
      ui.logConsole('dynamo_warning window loaded for situational item alerts.');
      mainWindow.updateWarningUI?.();
    });
  });
}

function restoreHeroNamesFromGep(mainWindow: any): void {
  ow.games.events.getInfo((result: any) => {
    if (!result?.success || !result.res?.roster) {
      return;
    }

    for (const rawValue of Object.values(result.res.roster)) {
      const payload = parsePayload(rawValue);
      storeHeroName(payload, mainWindow);
    }
  });
}

function captureHeroName(event: any, mainWindow: any): void {
  if (
    event?.category !== 'roster' &&
    !(typeof event?.key === 'string' && event.key.startsWith('roster_'))
  ) {
    return;
  }

  storeHeroName(parsePayload(event.payload), mainWindow);
}

function storeHeroName(payload: any, mainWindow: any): void {
  const heroId = Number(payload?.hero_id ?? payload?.heroId);
  const heroName = normalizeHeroName(payload?.hero_name ?? payload?.heroName);
  if (!Number.isSafeInteger(heroId) || heroId <= 0 || !heroName) {
    return;
  }

  mainWindow.heroNamesMap[heroId] = heroName;
  if (mainWindow.situationalItemWarning?.enemyHeroId === heroId) {
    mainWindow.situationalItemWarning.enemyHeroName = heroName;
    mainWindow.updateWarningUI?.();
  }
}

function parsePayload(value: unknown): any {
  if (typeof value !== 'string') {
    return value || {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeHeroName(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .trim()
    .replace(/^hero_/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function registerOverlayConfigurationListener(mainWindow: any): void {
  ow.overlay?.onGameInputExclusiveModeChanged?.addListener((event: any) => {
    mainWindow.overlayMenuActive = Boolean(event?.enabled);
    mainWindow.updateWarningUI?.();
  });
}
