import {
  LiveBuildRecommendationAction,
  LiveBuildRecommendationSnapshot,
} from './live-build-recommendation-poller';

const PANEL_ID = 'live-build-recommendation-panel';
const STYLE_ID = 'live-build-recommendation-styles';

export function showLiveBuildRecommendation(
  snapshot: LiveBuildRecommendationSnapshot,
): void {
  const panel = ensurePanel();
  if (!panel) {
    return;
  }

  panel.style.display = 'flex';
  panel.replaceChildren(createPanelContent(snapshot));
}

export function hideLiveBuildRecommendation(): void {
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.style.display = 'none';
    panel.replaceChildren();
  }
}

function ensurePanel(): HTMLElement | undefined {
  injectStyles();

  const existing = document.getElementById(PANEL_ID);
  if (existing) {
    return existing;
  }

  const container = document.querySelector('.hud-container');
  if (!container) {
    return undefined;
  }

  const panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.className = 'live-build-panel';
  panel.style.display = 'none';
  container.prepend(panel);
  return panel;
}

function createPanelContent(snapshot: LiveBuildRecommendationSnapshot): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(createHeader(snapshot));

  const recommendation = snapshot.recommendation;
  if (recommendation) {
    fragment.append(
      createPrimaryAction(
        recommendation.action,
        snapshot.isStale,
        recommendation.recommendationModel === 'CONTEXTUAL_V3'
          ? recommendation.contextualFeatures?.enemyHeroIds.length ?? 0
          : undefined,
      ),
    );
    if (recommendation.alternatives.length > 0) {
      fragment.append(createAlternatives(recommendation.alternatives.slice(0, 4)));
    }
  } else {
    fragment.append(createStateMessage(snapshot));
  }

  if (snapshot.lastError) {
    const error = document.createElement('div');
    error.className = 'live-build-error';
    error.textContent = snapshot.lastError;
    fragment.append(error);
  }

  return fragment;
}

function createHeader(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const header = document.createElement('div');
  header.className = 'live-build-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'live-build-header-copy';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'live-build-eyebrow';
  const source = snapshot.recommendation?.recommendationModel === 'CONTEXTUAL_V3'
    ? 'MODEL V3'
    : snapshot.recommendation
      ? 'BASELINE'
      : undefined;
  const phase = snapshot.recommendation?.contextualFeatures?.phase;
  eyebrow.textContent = ['NEXT BUILD ACTION', source, phase]
    .filter((value): value is string => Boolean(value))
    .join(' · ');

  const status = document.createElement('span');
  status.className = `live-build-status live-build-status-${snapshot.state.toLowerCase()}`;
  status.textContent = formatState(snapshot.state);

  titleGroup.append(eyebrow, status);

  const controls = document.createElement('div');
  controls.className = 'live-build-controls';

  if (snapshot.isStale) {
    const stale = document.createElement('span');
    stale.className = 'live-build-stale';
    stale.textContent = 'UPDATING';
    controls.append(stale);
  }

  const refreshButton = document.createElement('button');
  refreshButton.type = 'button';
  refreshButton.className = 'live-build-refresh';
  refreshButton.textContent = 'Refresh';
  refreshButton.title = 'Refresh live build recommendation';
  refreshButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const refresh = (window as any).refreshLiveBuildRecommendation;
    if (typeof refresh === 'function') {
      refresh();
    }
  });
  controls.append(refreshButton);

  header.append(titleGroup, controls);
  return header;
}

function createPrimaryAction(
  action: LiveBuildRecommendationAction,
  isStale: boolean,
  evaluatedEnemyCount: number | undefined,
): HTMLElement {
  const card = document.createElement('div');
  card.className = `live-build-primary live-build-slot-${normalizeSlot(action.item?.slotType)}`;
  if (isStale) {
    card.classList.add('live-build-primary-stale');
  }

  const top = document.createElement('div');
  top.className = 'live-build-primary-top';

  const copy = document.createElement('div');
  copy.className = 'live-build-primary-copy';

  const label = document.createElement('strong');
  label.className = 'live-build-action-label';
  label.textContent = action.label;

  const metadata = document.createElement('span');
  metadata.className = 'live-build-action-meta';
  metadata.textContent = formatItemMetadata(action);

  copy.append(label, metadata);

  const confidence = document.createElement('div');
  confidence.className = 'live-build-confidence';
  const confidenceValue = document.createElement('strong');
  confidenceValue.textContent = `${formatPercent(action.confidencePercent)}%`;
  const confidenceLabel = document.createElement('span');
  confidenceLabel.textContent = 'confidence';
  confidence.append(confidenceValue, confidenceLabel);

  top.append(copy, confidence);

  const explanation = document.createElement('p');
  explanation.className = 'live-build-explanation';
  explanation.textContent = action.explanation.text;

  card.append(top, explanation);
  const matchup = createMatchupSignals(action, evaluatedEnemyCount);
  if (matchup) {
    card.append(matchup);
  }
  return card;
}

function createAlternatives(actions: LiveBuildRecommendationAction[]): HTMLElement {
  const section = document.createElement('div');
  section.className = 'live-build-alternatives';

  const title = document.createElement('span');
  title.className = 'live-build-alternatives-title';
  title.textContent = 'Alternatives';
  section.append(title);

  for (const action of actions) {
    const row = document.createElement('div');
    row.className = `live-build-alternative live-build-slot-${normalizeSlot(action.item?.slotType)}`;

    const copy = document.createElement('div');
    copy.className = 'live-build-alternative-copy';

    const label = document.createElement('strong');
    label.textContent = action.label;

    const metadata = document.createElement('span');
    metadata.textContent = [
      formatItemMetadata(action),
      formatFirstMatchupSignal(action),
    ].filter(Boolean).join(' | ');

    copy.append(label, metadata);

    const confidence = document.createElement('span');
    confidence.className = 'live-build-alternative-confidence';
    confidence.textContent = `${formatPercent(action.confidencePercent)}%`;

    row.append(copy, confidence);
    section.append(row);
  }

  return section;
}

function createMatchupSignals(
  action: LiveBuildRecommendationAction,
  evaluatedEnemyCount: number | undefined,
): HTMLElement | undefined {
  const signals = (action.matchupSignals ?? []).filter(
    (signal) => signal.direction === 'POSITIVE',
  );
  if (signals.length === 0 && evaluatedEnemyCount === undefined) {
    return undefined;
  }

  const section = document.createElement('div');
  section.className = 'live-build-matchup';
  section.title =
    'Historical purchase pattern used by Contextual V3. This is model influence, not proven win-rate counter effectiveness.';

  const title = document.createElement('span');
  title.className = 'live-build-matchup-title';
  title.textContent = signals.length > 0 ? 'MATCHUP SIGNAL' : 'MATCHUP CONTEXT';

  const note = document.createElement('span');
  note.className = 'live-build-matchup-note';

  if (signals.length === 0) {
    note.textContent = evaluatedEnemyCount && evaluatedEnemyCount > 0
      ? `${evaluatedEnemyCount} enemies evaluated · no strong individual signal.`
      : 'Enemy roster unavailable for this recommendation.';
    section.append(title, note);
    return section;
  }

  const chips = document.createElement('div');
  chips.className = 'live-build-matchup-chips';
  for (const signal of signals.slice(0, 2)) {
    const chip = document.createElement('span');
    chip.className = 'live-build-matchup-chip';
    chip.textContent = formatMatchupSignal(signal);
    chips.append(chip);
  }

  note.textContent = 'Historical purchase tendency, not win-rate proof.';
  section.append(title, chips, note);
  return section;
}

function formatFirstMatchupSignal(
  action: LiveBuildRecommendationAction,
): string {
  const signal = action.matchupSignals?.find(
    (value) => value.direction === 'POSITIVE',
  );
  return signal ? formatMatchupSignal(signal) : '';
}

export function formatMatchupSignal(
  signal: NonNullable<LiveBuildRecommendationAction['matchupSignals']>[number],
): string {
  return `VS ${signal.heroName} +${formatPercent(signal.modelLiftPercent)}% model lift · ${signal.observationCount} samples`;
}

function createStateMessage(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const message = document.createElement('div');
  message.className = 'live-build-state-message';

  const title = document.createElement('strong');
  const detail = document.createElement('span');

  if (snapshot.state === 'WAITING_FOR_BACKEND') {
    title.textContent = 'Waiting for live match data';
    detail.textContent = 'The backend has not created a traversal snapshot for this match yet.';
  } else if (snapshot.state === 'WAITING_FOR_LOCAL_PLAYER') {
    title.textContent = 'Waiting for local player';
    detail.textContent = 'The roster has not identified the local player yet.';
  } else if (snapshot.state === 'WAITING_FOR_HERO') {
    title.textContent = 'Waiting for hero selection';
    detail.textContent = 'Choose a hero to start live build recommendations.';
  } else if (snapshot.state === 'REFRESHING') {
    title.textContent = 'Calculating recommendation';
    detail.textContent = 'The current inventory state is being evaluated.';
  } else if (snapshot.state === 'ERROR') {
    title.textContent = 'Recommendation unavailable';
    detail.textContent = 'The previous recommendation will be kept when available.';
  } else {
    title.textContent = 'No recommendation yet';
    detail.textContent = 'Waiting for the next live inventory update.';
  }

  message.append(title, detail);
  return message;
}

function formatItemMetadata(action: LiveBuildRecommendationAction): string {
  const parts: string[] = [];
  if (action.item?.slotType) {
    parts.push(capitalize(action.item.slotType));
  }
  if (Number.isFinite(action.item?.cost) && Number(action.item?.cost) > 0) {
    parts.push(`${action.item?.cost} souls`);
  }
  if (Number.isFinite(action.item?.tier) && Number(action.item?.tier) > 0) {
    parts.push(`Tier ${action.item?.tier}`);
  }
  if (action.typicalGameTimeLabel) {
    parts.push(`typical ${action.typicalGameTimeLabel}`);
  }
  return parts.join(' | ') || action.type;
}

function formatState(state: LiveBuildRecommendationSnapshot['state']): string {
  return state.replace(/_/g, ' ');
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function normalizeSlot(slotType: string | undefined): string {
  const normalized = slotType?.toLowerCase();
  return normalized === 'weapon' || normalized === 'vitality' || normalized === 'spirit'
    ? normalized
    : 'neutral';
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .live-build-panel {
      display: flex;
      flex: 0 0 auto;
      flex-direction: column;
      gap: 0.45rem;
      min-width: 0;
      padding: 0.55rem;
      border: 1px solid rgba(255, 107, 74, 0.42);
      border-radius: 9px;
      background: rgba(255, 107, 74, 0.08);
    }
    .live-build-header,
    .live-build-primary-top,
    .live-build-alternative {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      min-width: 0;
    }
    .live-build-header-copy,
    .live-build-primary-copy,
    .live-build-alternative-copy,
    .live-build-state-message {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .live-build-eyebrow,
    .live-build-alternatives-title {
      color: #ff8a70;
      font-size: 0.6rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .live-build-status {
      color: #9ca3af;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.55rem;
      text-transform: uppercase;
    }
    .live-build-status-ready { color: #34d399; }
    .live-build-status-error { color: #f87171; }
    .live-build-status-refreshing { color: #fbbf24; }
    .live-build-controls { display: flex; align-items: center; gap: 0.35rem; }
    .live-build-stale {
      color: #fbbf24;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.52rem;
      font-weight: 700;
    }
    .live-build-refresh {
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 4px;
      padding: 0.2rem 0.35rem;
      background: rgba(30,30,40,0.75);
      color: #f3f4f6;
      font-family: inherit;
      font-size: 0.58rem;
      cursor: pointer;
    }
    .live-build-primary,
    .live-build-alternative,
    .live-build-state-message {
      border: 1px solid rgba(255,255,255,0.08);
      border-left-width: 3px;
      border-radius: 7px;
      background: rgba(12,12,16,0.42);
    }
    .live-build-primary { padding: 0.5rem; }
    .live-build-primary-stale { opacity: 0.68; }
    .live-build-slot-weapon { border-left-color: #f59e0b; }
    .live-build-slot-vitality { border-left-color: #10b981; }
    .live-build-slot-spirit { border-left-color: #a855f7; }
    .live-build-slot-neutral { border-left-color: #9ca3af; }
    .live-build-action-label {
      color: #f3f4f6;
      font-size: 0.84rem;
      line-height: 1.15;
      overflow-wrap: anywhere;
    }
    .live-build-action-meta,
    .live-build-alternative-copy span,
    .live-build-state-message span {
      color: #9ca3af;
      font-size: 0.59rem;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .live-build-confidence {
      display: flex;
      flex: 0 0 auto;
      flex-direction: column;
      align-items: flex-end;
      color: #ff8a70;
      font-family: 'JetBrains Mono', monospace;
    }
    .live-build-confidence strong { font-size: 0.82rem; }
    .live-build-confidence span { color: #9ca3af; font-size: 0.48rem; }
    .live-build-matchup {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-top: 0.42rem;
      padding-top: 0.38rem;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .live-build-matchup-title {
      color: #67e8f9;
      font-size: 0.52rem;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
    .live-build-matchup-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }
    .live-build-matchup-chip {
      padding: 0.18rem 0.3rem;
      border: 1px solid rgba(103,232,249,0.24);
      border-radius: 4px;
      background: rgba(8,145,178,0.12);
      color: #a5f3fc;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.51rem;
      line-height: 1.2;
    }
    .live-build-matchup-note {
      color: #7f8794;
      font-size: 0.48rem;
      line-height: 1.2;
    }
    .live-build-explanation {
      margin-top: 0.4rem;
      color: #c4c7ce;
      font-size: 0.58rem;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .live-build-alternatives { display: flex; flex-direction: column; gap: 0.28rem; }
    .live-build-alternative { padding: 0.32rem 0.4rem; }
    .live-build-alternative-copy strong {
      color: #e5e7eb;
      font-size: 0.66rem;
      overflow-wrap: anywhere;
    }
    .live-build-alternative-confidence {
      flex: 0 0 auto;
      color: #c4c7ce;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.58rem;
    }
    .live-build-state-message { gap: 0.12rem; padding: 0.5rem; }
    .live-build-state-message strong { color: #f3f4f6; font-size: 0.72rem; }
    .live-build-error {
      color: #fca5a5;
      font-size: 0.56rem;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .hud-container.compact .live-build-explanation,
    .hud-container.compact .live-build-matchup,
    .hud-container.compact .live-build-alternatives {
      display: none;
    }
  `;
  document.head.append(style);
}
