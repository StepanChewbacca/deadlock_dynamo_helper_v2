import {
  centerWindowOnDisplay,
  OverwolfDisplay,
  selectPreferredDesktopDisplay,
} from './overwolf/secondary-monitor';
import { isSuccessfulOverwolfResult } from './overwolf/window-result';

const DESKTOP_VERSION = 'v0.1.2';
const ow = (window as any).overwolf;

function updateDesktopVersion(): void {
  const versionTag = document.querySelector('.version-tag');
  if (versionTag) {
    versionTag.textContent = DESKTOP_VERSION;
  }
}

export function showDesktopBuildWindow(preferSecondary = true): void {
  if (
    typeof ow?.windows?.getCurrentWindow !== 'function' ||
    typeof ow?.windows?.changePosition !== 'function' ||
    typeof ow?.windows?.restore !== 'function' ||
    typeof ow?.utils?.getMonitorsList !== 'function'
  ) {
    return;
  }

  ow.windows.getCurrentWindow((windowResult: any) => {
    if (
      !isSuccessfulOverwolfResult(windowResult) ||
      windowResult.window?.name !== 'desktop' ||
      !windowResult.window?.id
    ) {
      return;
    }

    const desktopWindow = windowResult.window;
    ow.utils.getMonitorsList((monitorsResult: any) => {
      if (
        !isSuccessfulOverwolfResult(monitorsResult) ||
        !Array.isArray(monitorsResult.displays)
      ) {
        console.warn('Failed to get the monitor list for desktop positioning.');
        restoreDesktopWindow(desktopWindow.id);
        return;
      }

      const targetDisplay = selectPreferredDesktopDisplay(
        monitorsResult.displays as OverwolfDisplay[],
        preferSecondary,
      );
      if (!targetDisplay) {
        console.warn('No usable monitor detected for desktop positioning.');
        restoreDesktopWindow(desktopWindow.id);
        return;
      }

      const position = centerWindowOnDisplay(
        targetDisplay,
        desktopWindow.width,
        desktopWindow.height,
      );

      ow.windows.changePosition(
        desktopWindow.id,
        position.x,
        position.y,
        (moveResult: any) => {
          if (!isSuccessfulOverwolfResult(moveResult)) {
            console.warn('Failed to move the desktop build window.');
          }

          restoreDesktopWindow(desktopWindow.id);
        },
      );
    });
  });
}

function restoreDesktopWindow(windowId: string): void {
  ow.windows.restore(windowId, (restoreResult: any) => {
    if (!isSuccessfulOverwolfResult(restoreResult)) {
      console.warn('Failed to restore the desktop build window.');
      return;
    }

    if (typeof ow.windows.bringToFront === 'function') {
      ow.windows.bringToFront(windowId);
    }
  });
}

(window as any).showDesktopBuildWindow = showDesktopBuildWindow;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateDesktopVersion, { once: true });
} else {
  updateDesktopVersion();
}

setTimeout(() => showDesktopBuildWindow(true), 250);
