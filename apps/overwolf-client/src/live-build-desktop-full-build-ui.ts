import { LiveBuildRecommendationSnapshot } from './live-build-recommendation-poller';
import {
  clearLiveBuildDesktop as clearBaseDesktop,
  showLiveBuildDesktop as showBaseDesktop,
  showLiveBuildDesktopError as showBaseDesktopError,
} from './live-build-desktop-table-ui';

const STYLE_ID = 'live-build-full-route-overrides';

export function showLiveBuildDesktop(snapshot: LiveBuildRecommendationSnapshot): void {
  injectOverrides();
  showBaseDesktop(createFullRouteSnapshot(snapshot));
}

export function showLiveBuildDesktopError(message: string): void {
  showBaseDesktopError(message);
}

export function clearLiveBuildDesktop(): void {
  clearBaseDesktop();
}

function createFullRouteSnapshot(
  snapshot: LiveBuildRecommendationSnapshot,
): LiveBuildRecommendationSnapshot {
  const heroId = Number(snapshot.heroId);
  return {
    ...snapshot,
    itemIds: [],
    inventoryStateKey: 'EMPTY',
    gameTimeS: 0,
    timeBucket: 0,
    traversalKey: Number.isSafeInteger(heroId) && heroId > 0
      ? `full-build:${heroId}`
      : snapshot.traversalKey,
  };
}

function injectOverrides(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .live-build-summary > div:first-child,
    .live-build-diagnostics {
      display: none !important;
    }
    .live-build-summary {
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    }
    @media (max-width: 900px) {
      .live-build-summary {
        grid-template-columns: 1fr !important;
      }
    }
  `;
  document.head.append(style);
}
