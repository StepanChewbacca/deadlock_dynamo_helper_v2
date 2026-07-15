import type {
  AutomaticSkillTrackingStateV2,
  AutomaticSkillTrackingStatusV2,
} from './skill-build-automatic-runtime-v2';

const STYLE_ID = 'skill-build-automatic-ui-v2-styles';
const NOTE_CLASS = 'skill-build-automatic-note-v2';
const WAITING_CLASS = 'skill-build-telemetry-waiting';
const UPDATE_INTERVAL_MS = 300;

let observer: MutationObserver | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let updateScheduled = false;

export interface AutomaticSkillTrackingCopyV2 {
  status: string;
  note: string;
}

export function getAutomaticSkillTrackingCopyV2(
  state: AutomaticSkillTrackingStateV2,
): AutomaticSkillTrackingCopyV2 {
  if (state === 'SYNCED') {
    return {
      status: 'AUTO',
      note: 'Skill levels are tracked automatically from the game.',
    };
  }
  if (state === 'WAITING_FOR_TELEMETRY') {
    return {
      status: 'AUTO SYNC',
      note: 'Waiting for a reliable live skill state. Recommendation is hidden until sync completes.',
    };
  }
  return {
    status: 'WAITING',
    note: 'Waiting for the local hero before automatic skill tracking starts.',
  };
}

export function initializeAutomaticSkillBuildUiV2(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (!document.documentElement) {
    document.addEventListener('DOMContentLoaded', initializeAutomaticSkillBuildUiV2, {
      once: true,
    });
    return;
  }

  injectStyles();
  updateAutomaticSkillBuildUiV2();

  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (!timer) {
    timer = setInterval(updateAutomaticSkillBuildUiV2, UPDATE_INTERVAL_MS);
  }
}

export function updateAutomaticSkillBuildUiV2(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const mainWindow = getMainWindow();
  const status = mainWindow?.latestAutomaticSkillTrackingStatus as
    | AutomaticSkillTrackingStatusV2
    | undefined;
  const state = status?.state ?? 'WAITING_FOR_HERO';
  const copy = getAutomaticSkillTrackingCopyV2(state);
  const isWaiting = state !== 'SYNCED';
  let changed = false;

  const panels = Array.from(
    document.querySelectorAll('.skill-build-panel'),
  ) as HTMLElement[];

  for (const panel of panels) {
    const manualControls = Array.from(
      panel.querySelectorAll('.skill-build-confirm, .skill-build-controls'),
    );
    for (const manualControl of manualControls) {
      manualControl.remove();
      changed = true;
    }

    if (panel.classList.contains(WAITING_CLASS) !== isWaiting) {
      panel.classList.toggle(WAITING_CLASS, isWaiting);
      changed = true;
    }

    const statusElement = panel.querySelector('.skill-build-status') as HTMLElement | null;
    if (statusElement && statusElement.textContent !== copy.status) {
      statusElement.textContent = copy.status;
      changed = true;
    }

    let note = panel.querySelector(`.${NOTE_CLASS}`) as HTMLElement | null;
    if (!note) {
      note = document.createElement('div');
      note.className = NOTE_CLASS;
      const header = panel.querySelector('.skill-build-header');
      if (header?.nextSibling) {
        panel.insertBefore(note, header.nextSibling);
      } else {
        panel.append(note);
      }
      changed = true;
    }
    if (note.textContent !== copy.note) {
      note.textContent = copy.note;
      changed = true;
    }
  }

  if (changed) {
    resizeOverlay();
  }
}

function scheduleUpdate(): void {
  if (updateScheduled) {
    return;
  }
  updateScheduled = true;
  queueMicrotask(() => {
    updateScheduled = false;
    updateAutomaticSkillBuildUiV2();
  });
}

function getMainWindow(): any {
  const currentWindow = window as any;
  return currentWindow.overwolf?.windows?.getMainWindow?.() ?? currentWindow;
}

function resizeOverlay(): void {
  const resize = (window as any).ensureOverlayHeight;
  if (typeof resize === 'function') {
    resize();
  }
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .skill-build-confirm,
    .skill-build-controls {
      display: none !important;
    }
    .skill-build-automatic-note-v2 {
      color: #60a5fa;
      font-size: 9px;
      line-height: 1.3;
    }
    .skill-build-telemetry-waiting .skill-build-levels,
    .skill-build-telemetry-waiting .skill-build-next,
    .skill-build-telemetry-waiting .skill-build-summary,
    .skill-build-telemetry-waiting .skill-build-route-section {
      display: none !important;
    }
    .skill-build-status {
      max-width: 90px;
      text-align: right;
    }
  `;
  document.head.append(style);
}
