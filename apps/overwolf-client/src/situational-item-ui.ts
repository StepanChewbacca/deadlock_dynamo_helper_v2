import type {
  LiveBuildRecommendationAction,
  LiveBuildRecommendationSnapshot,
} from './live-build-recommendation-poller';
import {
  createSituationalBadgeText,
  createSituationalEvidenceText,
} from './situational-item-metadata';
import type { HeroNameMap } from './situational-item-metadata';

const STYLE_ID = 'situational-item-marker-styles';
const FETCH_PATCH_KEY = '__deadlockSituationalFetchPatched';
const projectedActionsByLookupKey = new Map<string, LiveBuildRecommendationAction>();
let trackedMatchId = '';
let desktopObserver: MutationObserver | undefined;

export function decorateLiveBuildRecommendation(
  snapshot: LiveBuildRecommendationSnapshot,
): void {
  injectStyles();
  const recommendation = snapshot.recommendation;
  if (!recommendation) {
    return;
  }

  const root = document.getElementById('live-build-recommendation-panel');
  if (!root) {
    return;
  }

  const heroNames = getHeroNames();
  const primary = root.querySelector('.live-build-primary-copy');
  applyActionMarker(primary, recommendation.action, heroNames);

  const alternatives = Array.from(
    root.querySelectorAll('.live-build-alternative-copy'),
  );
  recommendation.alternatives.forEach((action, index) => {
    applyActionMarker(alternatives[index], action, heroNames);
  });
}

export function initializeDesktopSituationalItems(): void {
  injectStyles();
  patchBuildRecommendationFetch();

  if (desktopObserver || !document.documentElement) {
    return;
  }

  desktopObserver = new MutationObserver(() => {
    decorateProjectedBuildRows();
  });
  desktopObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

export function decorateDesktopSituationalItems(
  snapshot: LiveBuildRecommendationSnapshot,
): void {
  initializeDesktopSituationalItems();
  if (snapshot.matchId !== trackedMatchId) {
    trackedMatchId = snapshot.matchId;
    projectedActionsByLookupKey.clear();
  }

  const recommendation = snapshot.recommendation;
  if (recommendation) {
    captureAction(recommendation.action);
    recommendation.alternatives.forEach(captureAction);
  }

  scheduleDesktopDecoration(snapshot);
}

function scheduleDesktopDecoration(
  snapshot: LiveBuildRecommendationSnapshot,
): void {
  const decorate = (): void => {
    const currentAction = snapshot.recommendation?.action;
    if (currentAction) {
      const bannerCopy = document.querySelector(
        '.live-build-current-action .live-build-action-banner > div:first-child',
      );
      applyActionMarker(bannerCopy, currentAction, getHeroNames());
    }
    decorateProjectedBuildRows();
  };

  queueMicrotask(decorate);
  requestAnimationFrame(decorate);
}

function patchBuildRecommendationFetch(): void {
  const target = window as any;
  if (target[FETCH_PATCH_KEY]) {
    return;
  }

  const originalFetch = window.fetch.bind(window);
  target[FETCH_PATCH_KEY] = true;
  window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const response = await originalFetch(...args);
    const url = readRequestUrl(args[0]);
    if (
      response.ok &&
      url.includes('/deadlock/analysis/build-recommendation')
    ) {
      void response
        .clone()
        .json()
        .then((payload: any) => {
          captureAction(payload?.action);
          if (Array.isArray(payload?.alternatives)) {
            payload.alternatives.forEach(captureAction);
          }
          requestAnimationFrame(decorateProjectedBuildRows);
        })
        .catch(() => undefined);
    }
    return response;
  };
}

function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function captureAction(value: unknown): void {
  if (!isAction(value) || !value.item?.name) {
    return;
  }

  const lookupKey = createActionLookupKey(value.type, value.item.name);
  if (!value.isSituational) {
    projectedActionsByLookupKey.delete(lookupKey);
    return;
  }

  projectedActionsByLookupKey.set(lookupKey, value);
}

function decorateProjectedBuildRows(): void {
  const heroNames = getHeroNames();
  const rows = document.querySelectorAll('.live-build-phase tbody tr');
  rows.forEach((row) => {
    const actionCell = row.children.item(1) as HTMLElement | null;
    const itemCell = row.children.item(2) as HTMLElement | null;
    if (!actionCell || !itemCell) {
      return;
    }

    const lookupKey = createActionLookupKey(
      actionCell.textContent || '',
      readItemCellName(itemCell),
    );
    const action = projectedActionsByLookupKey.get(lookupKey);
    applyActionMarker(itemCell, action, heroNames);
    if (action?.isSituational) {
      row.classList.add('live-build-situational-row');
    } else {
      row.classList.remove('live-build-situational-row');
    }
  });
}

function readItemCellName(cell: HTMLElement): string {
  const clone = cell.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.situational-item-marker').forEach((node) => node.remove());
  return clone.textContent?.trim() || '';
}

function applyActionMarker(
  container: Element | null | undefined,
  action: LiveBuildRecommendationAction | undefined,
  heroNames: HeroNameMap,
): void {
  if (!container) {
    return;
  }

  const existing = container.querySelector(
    ':scope > .situational-item-marker',
  ) as HTMLElement | null;
  if (!action?.isSituational) {
    existing?.remove();
    return;
  }

  const badgeText = createSituationalBadgeText(action, heroNames);
  if (!badgeText) {
    existing?.remove();
    return;
  }

  const evidenceText = createSituationalEvidenceText(action) || '';
  const markerKey = [
    action.actionKey,
    badgeText,
    evidenceText,
    action.wasPromotedByMatchup ? 'promoted' : 'situational',
  ].join('|');
  if (existing?.dataset.markerKey === markerKey) {
    return;
  }

  existing?.remove();
  const marker = document.createElement('span');
  marker.className = action.wasPromotedByMatchup
    ? 'situational-item-marker situational-item-promoted'
    : 'situational-item-marker';
  marker.dataset.markerKey = markerKey;

  const badge = document.createElement('strong');
  badge.textContent = badgeText;
  marker.append(badge);

  if (evidenceText) {
    const evidence = document.createElement('span');
    evidence.textContent = evidenceText;
    marker.append(evidence);
  }

  container.append(marker);
}

function getHeroNames(): HeroNameMap {
  try {
    const mainWindow = (window as any).overwolf?.windows?.getMainWindow?.();
    return mainWindow?.heroNamesMap || {};
  } catch {
    return {};
  }
}

function createActionLookupKey(actionType: string, itemName: string): string {
  return `${actionType.trim().toUpperCase()}:${itemName.trim().toLowerCase()}`;
}

function isAction(value: unknown): value is LiveBuildRecommendationAction {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LiveBuildRecommendationAction).actionKey === 'string'
  );
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .situational-item-marker {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.3rem;
      width: fit-content;
      margin-top: 0.22rem;
      padding: 0.18rem 0.32rem;
      border: 1px solid rgba(251, 191, 36, 0.38);
      border-radius: 4px;
      background: rgba(251, 191, 36, 0.09);
      color: #fbbf24;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.52rem;
      line-height: 1.2;
      white-space: normal;
    }
    .situational-item-marker strong {
      color: #fbbf24 !important;
      font-size: inherit !important;
      text-transform: uppercase;
    }
    .situational-item-marker span {
      color: #d1d5db !important;
      font-size: inherit !important;
    }
    .situational-item-promoted {
      border-color: rgba(255, 107, 74, 0.75);
      background: rgba(255, 107, 74, 0.15);
      box-shadow: 0 0 12px rgba(255, 107, 74, 0.12);
    }
    .situational-item-promoted strong {
      color: #ff8a70 !important;
    }
    .live-build-situational-row {
      background: rgba(251, 191, 36, 0.045);
    }
    .live-build-phase td .situational-item-marker {
      max-width: 100%;
    }
  `;
  document.head.append(style);
}
