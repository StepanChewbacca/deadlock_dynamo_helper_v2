import {
  HeroSkillBuildResponse,
  SkillBuildPathStep,
  SkillBuildPresentation,
  SkillLevels,
  SkillSlot,
} from './skill-build-client';

const DESKTOP_PANEL_ID = 'skill-build-desktop-panel';
const OVERLAY_PANEL_ID = 'skill-build-overlay-panel';
const STYLE_ID = 'skill-build-ui-styles';

let desktopPresentation: SkillBuildPresentation = { state: 'EMPTY' };
let observedDesktopRoot: HTMLElement | undefined;
let desktopObserver: MutationObserver | undefined;
let desktopRestoreScheduled = false;

export function showDesktopSkillBuild(presentation: SkillBuildPresentation): void {
  desktopPresentation = presentation;
  renderDesktopSkillBuild();
}

export function rerenderDesktopSkillBuild(): void {
  renderDesktopSkillBuild();
}

export function showOverlaySkillBuild(presentation: SkillBuildPresentation): void {
  injectStyles();
  const host = document.querySelector('.hud-container');
  if (!host) {
    return;
  }

  let panel = document.getElementById(OVERLAY_PANEL_ID);
  if (!panel) {
    panel = document.createElement('section');
    panel.id = OVERLAY_PANEL_ID;
    panel.className = 'skill-build-panel skill-build-panel-overlay';
    const itemPanel = document.getElementById('live-build-recommendation-panel');
    if (itemPanel?.parentElement === host) {
      itemPanel.after(panel);
    } else {
      host.prepend(panel);
    }
  }

  panel.replaceChildren(createPresentationContent(presentation, true));
}

export function clearOverlaySkillBuild(): void {
  document.getElementById(OVERLAY_PANEL_ID)?.remove();
}

export function formatSkillStepTitle(step: SkillBuildPathStep): string {
  const skill = step.skillSlot === 4 ? 'Ultimate' : `Skill ${step.skillSlot}`;
  if (step.type === 'UNLOCK') {
    return `Learn ${skill}`;
  }
  return `Upgrade ${skill} - Level ${step.upgradeTier}`;
}

function renderDesktopSkillBuild(): void {
  injectStyles();
  const root = document.getElementById('live-build-desktop-root');
  if (!root) {
    return;
  }

  observeDesktopRoot(root);

  let panel = root.querySelector(`#${DESKTOP_PANEL_ID}`) as HTMLElement | null;
  if (!panel) {
    panel = document.createElement('section');
    panel.id = DESKTOP_PANEL_ID;
    panel.className = 'skill-build-panel skill-build-panel-desktop';
    root.append(panel);
  }

  panel.replaceChildren(createPresentationContent(desktopPresentation, false));
}

function observeDesktopRoot(root: HTMLElement): void {
  if (observedDesktopRoot === root && desktopObserver) {
    return;
  }

  desktopObserver?.disconnect();
  observedDesktopRoot = root;
  desktopObserver = new MutationObserver(() => {
    if (root.querySelector(`#${DESKTOP_PANEL_ID}`) || desktopRestoreScheduled) {
      return;
    }

    desktopRestoreScheduled = true;
    queueMicrotask(() => {
      desktopRestoreScheduled = false;
      if (document.getElementById('live-build-desktop-root') === root) {
        renderDesktopSkillBuild();
      }
    });
  });
  desktopObserver.observe(root, { childList: true });
}

function createPresentationContent(
  presentation: SkillBuildPresentation,
  compact: boolean,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(createHeader(presentation, compact));

  if (presentation.state === 'READY') {
    fragment.append(createCurrentLevels(presentation.build.currentLevels));
    fragment.append(createNextAction(presentation.build, compact));
    fragment.append(createProgressControls(compact));
    if (!compact) {
      fragment.append(createSummary(presentation.build));
      fragment.append(createRemainingRoute(presentation.build));
    }
  } else {
    fragment.append(createStateMessage(presentation));
  }

  return fragment;
}

function createHeader(
  presentation: SkillBuildPresentation,
  compact: boolean,
): HTMLElement {
  const header = document.createElement('div');
  header.className = 'skill-build-header';

  const copy = document.createElement('div');
  copy.className = 'skill-build-header-copy';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'skill-build-eyebrow';
  eyebrow.textContent = compact ? 'NEXT SKILL' : 'LIVE SKILL RECOMMENDATION';

  const title = document.createElement(compact ? 'strong' : 'h3');
  title.textContent = 'Skill build';
  copy.append(eyebrow, title);

  const status = document.createElement('span');
  status.className = `skill-build-status skill-build-status-${presentation.state.toLowerCase()}`;
  status.textContent = presentation.state;

  header.append(copy, status);
  return header;
}

function createCurrentLevels(levels: SkillLevels): HTMLElement {
  const row = document.createElement('div');
  row.className = 'skill-build-levels';

  for (const skillSlot of [1, 2, 3, 4] as const) {
    const cell = document.createElement('span');
    cell.className = `skill-build-level skill-build-slot-${skillSlot}`;
    cell.textContent = `${skillSlot === 4 ? 'ULT' : skillSlot}: ${formatCurrentLevel(levels[skillSlot])}`;
    row.append(cell);
  }

  return row;
}

function createNextAction(
  build: HeroSkillBuildResponse,
  compact: boolean,
): HTMLElement {
  const action = build.nextAction;
  const card = document.createElement('div');
  card.className = action
    ? `skill-build-next skill-build-slot-${action.skillSlot}`
    : 'skill-build-next skill-build-complete';

  if (!action) {
    const complete = document.createElement('strong');
    complete.textContent = 'Skill build complete';
    const detail = document.createElement('span');
    detail.textContent = `${build.currentPointCost} AP spent`;
    card.append(complete, detail);
    return card;
  }

  const copy = document.createElement('div');
  copy.className = 'skill-build-next-copy';

  const title = document.createElement('strong');
  title.textContent = formatSkillStepTitle(action);

  const metadata = document.createElement('span');
  metadata.textContent = [
    `Cost ${action.pointCost} AP`,
    `after ${action.cumulativePointCost} AP`,
    `${formatPercent(action.pickRate)} pick rate`,
    `n=${action.sampleSize}`,
  ].join(' | ');
  copy.append(title, metadata);

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'skill-build-confirm';
  confirm.textContent = compact ? 'DONE' : 'MARK AS APPLIED';
  confirm.title = `Confirm: ${formatSkillStepTitle(action)}`;
  confirm.addEventListener('click', (event) => {
    event.stopPropagation();
    invokeSkillCommand('confirmRecommendedSkillAction');
  });

  card.append(copy, confirm);
  return card;
}

function createProgressControls(compact: boolean): HTMLElement {
  const controls = document.createElement('div');
  controls.className = 'skill-build-controls';

  const label = document.createElement('span');
  label.className = 'skill-build-controls-label';
  label.textContent = compact ? 'ACTUAL' : 'Applied a different skill:';
  controls.append(label);

  const slots = document.createElement('div');
  slots.className = 'skill-build-slot-controls';
  for (const skillSlot of [1, 2, 3, 4] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `skill-build-slot-button skill-build-slot-${skillSlot}`;
    button.textContent = skillSlot === 4 ? 'ULT' : String(skillSlot);
    button.title = `Record actual upgrade for ${skillSlot === 4 ? 'Ultimate' : `Skill ${skillSlot}`}`;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      invokeSkillCommand('recordActualSkillUpgrade', skillSlot);
    });
    slots.append(button);
  }
  controls.append(slots);

  const history = document.createElement('div');
  history.className = 'skill-build-history-controls';
  history.append(
    createCommandButton('UNDO', 'undoSkillUpgrade'),
    createCommandButton('RESET', 'resetSkillProgress'),
  );
  controls.append(history);

  return controls;
}

function createCommandButton(label: string, command: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'skill-build-secondary-button';
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    invokeSkillCommand(command);
  });
  return button;
}

function createSummary(build: HeroSkillBuildResponse): HTMLElement {
  const summary = document.createElement('div');
  summary.className = 'skill-build-summary';

  const text = document.createElement('span');
  text.textContent = `${build.sourcePlayerCount} players from the last ${build.windowDays} days`;

  const quality = document.createElement('span');
  quality.textContent =
    `${build.validPlayerCount} valid, ${build.partialPlayerCount} partial, ` +
    `${build.rejectedPlayerCount} rejected`;

  summary.append(text, quality);
  return summary;
}

function createRemainingRoute(build: HeroSkillBuildResponse): HTMLElement {
  const section = document.createElement('div');
  section.className = 'skill-build-route-section';

  const title = document.createElement('span');
  title.className = 'skill-build-route-title';
  title.textContent = 'Remaining route';
  section.append(title);

  const route = document.createElement('div');
  route.className = 'skill-build-route';
  for (const [index, step] of build.actions.entries()) {
    route.append(createStep(step, index === 0));
  }

  if (build.actions.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'skill-build-message';
    empty.textContent = 'No remaining upgrades.';
    route.append(empty);
  }

  section.append(route);
  return section;
}

function createStep(step: SkillBuildPathStep, isNext: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = `skill-build-step skill-build-slot-${step.skillSlot}`;
  if (isNext) {
    card.classList.add('skill-build-step-next');
  }
  card.title = [
    formatSkillStepTitle(step),
    `Ability ID ${step.abilityId}`,
    `AP cost ${step.pointCost}`,
    `Pick rate ${formatPercent(step.pickRate)}`,
    `Sample ${step.sampleSize}`,
  ].join(' | ');

  const ap = document.createElement('span');
  ap.className = 'skill-build-step-ap';
  ap.textContent = `AP ${step.cumulativePointCost}`;

  const action = document.createElement('strong');
  action.textContent = step.skillSlot === 4 ? 'ULT' : String(step.skillSlot);

  const tier = document.createElement('span');
  tier.className = 'skill-build-step-tier';
  tier.textContent = step.type === 'UNLOCK' ? 'LEARN' : `LVL ${step.upgradeTier}`;

  const support = document.createElement('span');
  support.className = 'skill-build-step-support';
  support.textContent = `${formatPercent(step.pickRate)} / n=${step.sampleSize}`;

  card.append(ap, action, tier, support);
  return card;
}

function createStateMessage(presentation: SkillBuildPresentation): HTMLElement {
  const message = document.createElement('div');
  message.className = 'skill-build-message';

  if (presentation.state === 'LOADING') {
    message.textContent = `Calculating next skill from ${formatLevelsKey(presentation.levels)}...`;
  } else if (presentation.state === 'ERROR') {
    message.textContent = presentation.message;
  } else {
    message.textContent = 'Select a hero to load the next skill recommendation.';
  }

  return message;
}

function formatCurrentLevel(level: number): string {
  if (level === 0) {
    return '-';
  }
  if (level === 1) {
    return 'LEARNED';
  }
  return `LVL ${level - 1}`;
}

function formatLevelsKey(levels: SkillLevels): string {
  return [levels[1], levels[2], levels[3], levels[4]].join('/');
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  const percent = Math.max(0, value) * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function invokeSkillCommand(command: string, ...args: unknown[]): void {
  const currentWindow = window as any;
  const mainWindow = currentWindow.overwolf?.windows?.getMainWindow?.() as any;
  const handler = mainWindow?.[command] ?? currentWindow[command];
  if (typeof handler === 'function') {
    handler(...args);
  }
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .skill-build-panel {
      display: flex;
      flex: 0 0 auto;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
      padding: 12px;
      border: 1px solid rgba(96, 165, 250, 0.34);
      border-radius: 9px;
      background: rgba(30, 64, 175, 0.08);
    }
    .skill-build-panel-desktop { margin-top: 12px; }
    .skill-build-panel-overlay { padding: 8px; gap: 6px; }
    .skill-build-header,
    .skill-build-summary,
    .skill-build-next,
    .skill-build-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .skill-build-header-copy,
    .skill-build-next-copy {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .skill-build-header h3,
    .skill-build-header strong {
      margin: 0;
      color: #f3f4f6;
    }
    .skill-build-eyebrow,
    .skill-build-route-title,
    .skill-build-controls-label {
      color: #60a5fa;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
    .skill-build-status {
      color: #9ca3af;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
    }
    .skill-build-status-ready { color: #34d399; }
    .skill-build-status-loading { color: #fbbf24; }
    .skill-build-status-error { color: #f87171; }
    .skill-build-levels {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 4px;
    }
    .skill-build-level {
      min-width: 0;
      padding: 4px 5px;
      border: 1px solid rgba(255,255,255,0.09);
      border-left-width: 3px;
      border-radius: 5px;
      background: rgba(12,12,16,0.45);
      color: #cbd5e1;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      text-align: center;
      white-space: nowrap;
    }
    .skill-build-next {
      padding: 9px;
      border: 1px solid rgba(255,255,255,0.12);
      border-left-width: 4px;
      border-radius: 7px;
      background: rgba(12,12,16,0.58);
    }
    .skill-build-next-copy strong {
      color: #f8fafc;
      font-size: 14px;
      line-height: 1.15;
    }
    .skill-build-next-copy span,
    .skill-build-next > span {
      color: #9ca3af;
      font-size: 10px;
      line-height: 1.3;
    }
    .skill-build-confirm,
    .skill-build-slot-button,
    .skill-build-secondary-button {
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 5px;
      background: rgba(30,30,40,0.82);
      color: #f3f4f6;
      font-family: inherit;
      font-size: 9px;
      font-weight: 700;
      cursor: pointer;
    }
    .skill-build-confirm {
      flex: 0 0 auto;
      padding: 7px 9px;
      border-color: rgba(52, 211, 153, 0.55);
      color: #6ee7b7;
    }
    .skill-build-controls { align-items: center; }
    .skill-build-slot-controls,
    .skill-build-history-controls {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .skill-build-slot-button,
    .skill-build-secondary-button { padding: 4px 6px; }
    .skill-build-summary {
      color: #9ca3af;
      font-size: 11px;
    }
    .skill-build-route-section {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .skill-build-route {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
      gap: 6px;
    }
    .skill-build-step {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: center;
      gap: 2px 6px;
      min-width: 0;
      padding: 7px 8px;
      border: 1px solid rgba(255,255,255,0.09);
      border-left-width: 3px;
      border-radius: 6px;
      background: rgba(12,12,16,0.5);
    }
    .skill-build-step-next { box-shadow: inset 0 0 0 1px rgba(96,165,250,0.45); }
    .skill-build-slot-1 { border-left-color: #f59e0b; }
    .skill-build-slot-2 { border-left-color: #10b981; }
    .skill-build-slot-3 { border-left-color: #3b82f6; }
    .skill-build-slot-4 { border-left-color: #a855f7; }
    .skill-build-step-ap,
    .skill-build-step-tier,
    .skill-build-step-support {
      color: #9ca3af;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      white-space: nowrap;
    }
    .skill-build-step strong {
      color: #f3f4f6;
      font-size: 14px;
      justify-self: end;
    }
    .skill-build-step-support {
      grid-column: 1 / -1;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .skill-build-message {
      color: #9ca3af;
      font-size: 11px;
      line-height: 1.35;
    }
    .skill-build-complete { border-left-color: #34d399; }
    .skill-build-panel-overlay .skill-build-next-copy strong { font-size: 13px; }
    .skill-build-panel-overlay .skill-build-next-copy span { font-size: 9px; }
    .skill-build-panel-overlay .skill-build-summary { display: none; }
    .skill-build-panel-overlay .skill-build-controls-label { font-size: 8px; }
  `;
  document.head.append(style);
}
