import {
  centerWindowOnDisplay,
  OverwolfDisplay,
  selectSecondaryDisplay,
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

function moveDesktopWindowToSecondaryMonitor(): void {
  if (
    typeof ow?.windows?.getCurrentWindow !== 'function' ||
    typeof ow?.windows?.changePosition !== 'function' ||
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

    ow.utils.getMonitorsList((monitorsResult: any) => {
      if (
        !isSuccessfulOverwolfResult(monitorsResult) ||
        !Array.isArray(monitorsResult.displays)
      ) {
        console.warn('Failed to get the monitor list for desktop positioning.');
        return;
      }

      const secondaryDisplay = selectSecondaryDisplay(
        monitorsResult.displays as OverwolfDisplay[],
      );
      if (!secondaryDisplay) {
        console.info(
          'No secondary monitor detected. Keeping the desktop client in its current position.',
        );
        return;
      }

      const position = centerWindowOnDisplay(
        secondaryDisplay,
        windowResult.window.width,
        windowResult.window.height,
      );

      ow.windows.changePosition(
        windowResult.window.id,
        position.x,
        position.y,
        (moveResult: any) => {
          if (!isSuccessfulOverwolfResult(moveResult)) {
            console.warn('Failed to move the desktop client to the secondary monitor.');
            return;
          }

          console.info(
            `Desktop client moved to secondary monitor ${secondaryDisplay.name || secondaryDisplay.id || ''} at ${position.x},${position.y}.`,
          );
        },
      );
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateDesktopVersion, { once: true });
} else {
  updateDesktopVersion();
}

moveDesktopWindowToSecondaryMonitor();
