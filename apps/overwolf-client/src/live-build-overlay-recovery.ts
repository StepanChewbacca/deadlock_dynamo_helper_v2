import { disableLegacyBuildGuide } from './disable-legacy-build-guide';
import {
  LiveBuildRecommendationSnapshot,
} from './live-build-recommendation-poller';
import { showLiveBuildRecommendation } from './live-build-recommendation-ui';
import { decorateLiveBuildRecommendation } from './situational-item-ui';
import { isSuccessfulOverwolfResult } from './overwolf/window-result';

const OVERLAY_SYNC_INTERVAL_MS = 500;
const ow = (window as any).overwolf;

if (
  typeof ow?.windows?.getCurrentWindow === 'function' &&
  typeof ow?.windows?.getMainWindow === 'function'
) {
  ow.windows.getCurrentWindow((windowResult: any) => {
    if (
      !isSuccessfulOverwolfResult(windowResult) ||
      windowResult.window?.name !== 'in_game'
    ) {
      return;
    }

    initializeOverlayRecovery();
  });
}

function initializeOverlayRecovery(): void {
  const localWindow = window as any;
  const mainWindow = ow.windows.getMainWindow() as any;
  let lastAppliedKey = '';

  const synchronize = (): void => {
    const snapshot = mainWindow.latestLiveBuildRecommendation as
      | LiveBuildRecommendationSnapshot
      | undefined;
    if (!snapshot) {
      return;
    }

    localWindow.__deadlockLiveRecommendationSnapshot = snapshot;
    localWindow.__deadlockLiveMatchId = snapshot.matchId;

    const snapshotKey = createSnapshotKey(snapshot);
    if (snapshotKey === lastAppliedKey) {
      return;
    }
    lastAppliedKey = snapshotKey;

    disableLegacyBuildGuide();
    showLiveBuildRecommendation(snapshot);
    decorateLiveBuildRecommendation(snapshot);

    const resizeOverlay = localWindow.ensureOverlayHeight;
    if (typeof resizeOverlay === 'function') {
      resizeOverlay();
    }
  };

  synchronize();
  setInterval(synchronize, OVERLAY_SYNC_INTERVAL_MS);
}

function createSnapshotKey(snapshot: LiveBuildRecommendationSnapshot): string {
  return [
    snapshot.matchId,
    snapshot.state,
    snapshot.traversalKey ?? '',
    snapshot.refreshCount,
    snapshot.lastUpdatedAt ?? '',
    snapshot.lastError ?? '',
    snapshot.recommendation?.action.actionKey ?? '',
  ].join('|');
}
