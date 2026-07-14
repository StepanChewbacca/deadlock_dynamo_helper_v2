import { initializeDesktopBuildDeduplication } from './live-build-desktop-dedup';
import { LiveBuildRecommendationSnapshot } from './live-build-recommendation-poller';
import {
  clearLiveBuildDesktop as clearBaseDesktop,
  showLiveBuildDesktop as showBaseDesktop,
  showLiveBuildDesktopError as showBaseDesktopError,
} from './live-build-desktop-table-ui';
import {
  decorateDesktopSituationalItems,
  initializeDesktopSituationalItems,
} from './situational-item-ui';

const STYLE_ID = 'live-build-full-route-overrides';
const MATCHUP_DIAGNOSTICS_ID = 'live-build-matchup-diagnostics';

interface MatchupDiagnosticRecommendation {
  evaluatedCandidateCount?: number;
  situationalCandidateCount?: number;
  promotedSituationalCandidateCount?: number;
  insertedSituationalCandidateCount?: number;
}

export function showLiveBuildDesktop(snapshot: LiveBuildRecommendationSnapshot): void {
  injectOverrides();
  initializeDesktopSituationalItems();
  initializeDesktopBuildDeduplication();
  showBaseDesktop(createFullRouteSnapshot(snapshot));
  decorateDesktopSituationalItems(snapshot);
  renderMatchupDiagnostics(snapshot);
}

export function showLiveBuildDesktopError(message: string): void {
  showBaseDesktopError(message);
}

export function clearLiveBuildDesktop(): void {
  document.getElementById(MATCHUP_DIAGNOSTICS_ID)?.remove();
  clearBaseDesktop();
}

export function describeMatchupDiagnostics(
  snapshot: LiveBuildRecommendationSnapshot,
): string {
  const enemyCount = snapshot.enemyHeroIds?.length ?? 0;
  if (enemyCount === 0) {
    return 'Enemy roster missing. Situational scoring is disabled.';
  }

  if (!snapshot.recommendation) {
    return `Enemy roster: ${enemyCount}. Waiting for a recommendation.`;
  }

  const recommendation = snapshot.recommendation as typeof snapshot.recommendation &
    MatchupDiagnosticRecommendation;
  const evaluated = recommendation.evaluatedCandidateCount;
  const situational = recommendation.situationalCandidateCount;
  const promoted = recommendation.promotedSituationalCandidateCount;
  const inserted = recommendation.insertedSituationalCandidateCount;

  if (!Number.isFinite(evaluated)) {
    return `Enemy roster: ${enemyCount}. Backend response has no matchup funnel counters.`;
  }

  if (!Number.isFinite(situational) || Number(situational) <= 0) {
    return `Matchup funnel: ${evaluated} evaluated, 0 statistically supported. No situational item exists for this state.`;
  }

  if (!Number.isFinite(promoted) || Number(promoted) <= 0) {
    return `Matchup funnel: ${evaluated} evaluated, ${situational} supported, 0 promoted. No warning can fire in this state.`;
  }

  const primary = snapshot.recommendation.action;
  if (primary.isSituational && primary.wasPromotedByMatchup) {
    return `Warning-ready: ${evaluated} evaluated, ${situational} supported, ${promoted} promoted, ${inserted ?? 0} inserted.`;
  }

  return `Matchup funnel: ${evaluated} evaluated, ${situational} supported, ${promoted} promoted, but the primary action is not matchup-promoted.`;
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

function renderMatchupDiagnostics(
  snapshot: LiveBuildRecommendationSnapshot,
): void {
  document.getElementById(MATCHUP_DIAGNOSTICS_ID)?.remove();

  const root = document.getElementById('live-build-desktop-root');
  if (!root) {
    return;
  }

  const diagnostics = document.createElement('div');
  diagnostics.id = MATCHUP_DIAGNOSTICS_ID;
  diagnostics.className = 'live-build-matchup-diagnostics';

  const label = document.createElement('strong');
  label.textContent = 'Situational diagnostics';
  const detail = document.createElement('span');
  detail.textContent = describeMatchupDiagnostics(snapshot);
  diagnostics.append(label, detail);

  const summary = root.querySelector('.live-build-summary');
  if (summary) {
    summary.after(diagnostics);
  } else {
    root.prepend(diagnostics);
  }
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
    .live-build-matchup-diagnostics {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 12px 0;
      padding: 12px 14px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.22);
    }
    .live-build-matchup-diagnostics strong {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .live-build-matchup-diagnostics span {
      opacity: 0.82;
    }
    @media (max-width: 900px) {
      .live-build-summary {
        grid-template-columns: 1fr !important;
      }
    }
  `;
  document.head.append(style);
}
