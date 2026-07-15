import type {
  AutomaticSkillTrackingState,
  AutomaticSkillTrackingStatus,
} from './skill-build-automatic-runtime';

const STYLE_ID = 'skill-build-automatic-ui-styles';
const NOTE_CLASS = 'skill-build-automatic-note';
const UPDATE_INTERVAL_MS = 500;

let observer: MutationObserver | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let updateScheduled = false;

export interface AutomaticSkillTrackingCopy {
  status: string;
  note: string;
}

export function getAutomaticSkillTrackingCopy(
  state: AutomaticSkillTrackingState,
): AutomaticSkillTrackingCopy {
  if (state === 'SYNCED') {
    return {
      status: 'AUTO',
      note: 'Skill levels are tracked automatically from the game.',
    };
  }
  if (state === 'WAITING_FOR_TELEMETRY') {
    return {
      status: 'AUTO SYNC',
      note: 'Waiting for the current skill state from the game.',
    };
  }
  return {
    status: 'WAITING',
    note: 'Waiting for the local hero before automatic skill tracking starts.',
  };
}

export function initializeAutomaticSkillBuildUi(): void {
  if (typeof document === 'undefined') {
    return;
  }

  if (!document.documentElement) {
    document.addEventListener('DOMContentLoaded', initializeAutomaticSkillBuildUi, {
      once: true,
    });
    return;
  }

  injectStyles();
  updateAutomaticSkillBuildUi();

  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (!timer) {
    timer = setInterval(updateAutomaticSkillBuildUi, UPDATE_INTERVAL_MS);
  }
}

export function updateAutomaticSkillBuildUi(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const mainWindow = getMainWindow();
  const status = mainWindow?.latestAutomaticSkillTrackingStatus as
    | AutomaticSkillTrackingStatus
    | undefined;
  const copy = getAutomaticSkillTrackingCopy(
    status?.state ?? 'WAITING_FOR_HERO',
  );
  let changed = false;

  for (const panel of document.querySelectorAll<HTMLElement>('.skill-build-panel')) {
    for (const manualControl of panel.querySelectorAll(
      '.skill-build-confirm, .skill-build-controls',
    )) {
      manualControl.remove();
      changed = true;
    }

    const statusElement = panel.querySelector<HTMLElement>('.skill-build-status');
    if (statusElement && statusElement.textContent !== copy.status) {
      statusElement.textContent = copy.status;
      changed = true;
    }

    const actionCopy = panel.querySelector<HTMLElement>('.skill-build-next-copy');
    if (!actionCopy) {
      continue;
    }

    let note = actionCopy.querySelector<HTMLElement>(`.${NOTE_CLASS}`);
    if (!note) {
      note = document.createElement('span');
      note.className = NOTE_CLASS;
      actionCopy.append(note);
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
    updateAutomaticSkillBuildUi();
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
    .skill-build-automatic-note {
      margin-top: 3px;
      color: #60a5fa !important;
      font-size: 9px !important;
      line-height: 1.25 !important;
    }
    .skill-build-status {
      max-width: 90px;
      text-align: right;
    }
  `;
  document.head.append(style);
}
