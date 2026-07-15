import {
  HeroSkillBuildResponse,
  SkillBuildPathStep,
  SkillBuildPresentation,
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
    return `${skill} - unlock`;
  }
  return `${skill} - tier ${step.upgradeTier}`;
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
    fragment.append(createSummary(presentation.build, compact));
    fragment.append(createRoute(presentation.build, compact));
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
  eyebrow.textContent = compact ? 'SKILL ROUTE' : 'ABILITY POINT ROUTE';

  const title = document.createElement(compact ? 'strong' : 'h3');
  title.textContent = 'Skill build';
  copy.append(eyebrow, title);

  const status = document.createElement('span');
  status.className = `skill-build-status skill-build-status-${presentation.state.toLowerCase()}`;
  status.textContent = presentation.state;

  header.append(copy, status);
  return header;
}

function createSummary(build: HeroSkillBuildResponse, compact: boolean): HTMLElement {
  const summary = document.createElement('div');
  summary.className = 'skill-build-summary';

  const text = document.createElement('span');
  text.textContent = compact
    ? `${build.sourcePlayerCount} players / ${build.windowDays}d`
    : `${build.sourcePlayerCount} players from the last ${build.windowDays} days`;

  const quality = document.createElement('span');
  quality.textContent = compact
    ? `${build.validPlayerCount} valid`
    : `${build.validPlayerCount} valid, ${build.partialPlayerCount} partial, ${build.rejectedPlayerCount} rejected`;

  summary.append(text, quality);
  return summary;
}

function createRoute(build: HeroSkillBuildResponse, compact: boolean): HTMLElement {
  const route = document.createElement('div');
  route.className = compact ? 'skill-build-route skill-build-route-compact' : 'skill-build-route';

  for (const step of build.actions) {
    route.append(createStep(step, compact));
  }

  if (build.actions.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'skill-build-message';
    empty.textContent = 'No valid skill route was found.';
    route.append(empty);
  }

  return route;
}

function createStep(step: SkillBuildPathStep, compact: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = `skill-build-step skill-build-slot-${step.skillSlot}`;
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
  tier.textContent = step.type === 'UNLOCK' ? 'UNLOCK' : `T${step.upgradeTier}`;

  card.append(ap, action, tier);

  if (!compact) {
    const support = document.createElement('span');
    support.className = 'skill-build-step-support';
    support.textContent = `${formatPercent(step.pickRate)} / n=${step.sampleSize}`;
    card.append(support);
  }

  return card;
}

function createStateMessage(presentation: SkillBuildPresentation): HTMLElement {
  const message = document.createElement('div');
  message.className = 'skill-build-message';

  if (presentation.state === 'LOADING') {
    message.textContent = `Loading skill build for hero ${presentation.heroId}...`;
  } else if (presentation.state === 'ERROR') {
    message.textContent = presentation.message;
  } else {
    message.textContent = 'Select a hero to load the skill build.';
  }

  return message;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  const percent = Math.max(0, value) * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
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
    .skill-build-panel-overlay {
      padding: 8px;
      gap: 6px;
      max-height: 230px;
      overflow-y: auto;
    }
    .skill-build-header,
    .skill-build-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .skill-build-header-copy {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .skill-build-header h3,
    .skill-build-header strong {
      margin: 0;
      color: #f3f4f6;
    }
    .skill-build-eyebrow {
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
    .skill-build-summary {
      color: #9ca3af;
      font-size: 11px;
    }
    .skill-build-route {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
      gap: 6px;
    }
    .skill-build-route-compact {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 4px;
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
    .skill-build-route-compact .skill-build-step {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
      padding: 5px;
    }
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
    .skill-build-route-compact .skill-build-step strong {
      font-size: 12px;
      line-height: 1;
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
  `;
  document.head.append(style);
}
