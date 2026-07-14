import {
  LiveBuildRecommendationAction,
  LiveBuildRecommendationSnapshot,
} from './live-build-recommendation-poller';

const API_BASE_URL = 'https://aboba-telegramovich.duckdns.org';
const ROOT_ID = 'live-build-desktop-root';
const STYLE_ID = 'live-build-desktop-styles';
const MAX_PROJECTED_STEPS = 10;

interface ExtendedLiveBuildRecommendationAction extends LiveBuildRecommendationAction {
  historicalCount?: number;
  historicalProbability?: number;
  averageGameTimeS?: number;
  matchedStateKey?: string;
  predictedStateKey?: string;
  score?: number;
  confidence?: number;
}

interface ProjectedRecommendationResponse {
  mode: 'EXACT' | 'BACKOFF' | 'NO_MATCH';
  heroId: number;
  requestedStateKey: string;
  gameTimeS: number;
  action: ExtendedLiveBuildRecommendationAction;
  alternatives: ExtendedLiveBuildRecommendationAction[];
}

interface ProjectedBuildStep {
  index: number;
  mode: ProjectedRecommendationResponse['mode'];
  requestedStateKey: string;
  predictedStateKey: string;
  action: ExtendedLiveBuildRecommendationAction;
}

type ProjectionStatus = 'IDLE' | 'LOADING' | 'READY' | 'ERROR';

let latestSnapshot: LiveBuildRecommendationSnapshot | undefined;
let projectionKey = '';
let projectionStatus: ProjectionStatus = 'IDLE';
let projectionSteps: ProjectedBuildStep[] = [];
let projectionError = '';
let projectionGeneration = 0;
let externalError = '';
let domReadyListenerRegistered = false;

export function showLiveBuildDesktop(snapshot: LiveBuildRecommendationSnapshot): void {
  latestSnapshot = snapshot;
  externalError = '';
  renderWhenReady();

  const nextProjectionKey = createProjectionKey(snapshot);
  if (!canProject(snapshot)) {
    projectionKey = '';
    projectionStatus = 'IDLE';
    projectionSteps = [];
    projectionError = '';
    projectionGeneration += 1;
    renderWhenReady();
    return;
  }

  if (nextProjectionKey === projectionKey) {
    return;
  }

  projectionKey = nextProjectionKey;
  projectionStatus = 'LOADING';
  projectionSteps = [];
  projectionError = '';
  const generation = ++projectionGeneration;
  renderWhenReady();

  void projectBuild(snapshot, generation)
    .then((steps) => {
      if (generation !== projectionGeneration) {
        return;
      }
      projectionSteps = steps;
      projectionStatus = 'READY';
      renderWhenReady();
    })
    .catch((error: unknown) => {
      if (generation !== projectionGeneration) {
        return;
      }
      projectionSteps = [];
      projectionStatus = 'ERROR';
      projectionError = error instanceof Error ? error.message : String(error);
      renderWhenReady();
    });
}

export function showLiveBuildDesktopError(message: string): void {
  externalError = message;
  renderWhenReady();
}

export function clearLiveBuildDesktop(): void {
  latestSnapshot = undefined;
  projectionKey = '';
  projectionStatus = 'IDLE';
  projectionSteps = [];
  projectionError = '';
  externalError = '';
  projectionGeneration += 1;
  renderWhenReady();
}

async function projectBuild(
  snapshot: LiveBuildRecommendationSnapshot,
  generation: number,
): Promise<ProjectedBuildStep[]> {
  const heroId = Number(snapshot.heroId);
  let itemIds = [...snapshot.itemIds];
  let gameTimeS = normalizeGameTime(snapshot.gameTimeS);
  const steps: ProjectedBuildStep[] = [];
  const visitedTransitions = new Set<string>();

  for (let index = 0; index < MAX_PROJECTED_STEPS; index += 1) {
    if (generation !== projectionGeneration) {
      return steps;
    }

    const response = await fetch(`${API_BASE_URL}/deadlock/analysis/build-recommendation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        heroId,
        itemIds,
        gameTimeS,
        limit: 5,
      }),
    });

    if (!response.ok) {
      throw new Error(`Projected build request failed with HTTP ${response.status}.`);
    }

    const parsed = await response.json() as unknown;
    if (!isProjectedRecommendationResponse(parsed)) {
      throw new Error('Projected build response has an invalid shape.');
    }

    const action = parsed.action;
    const predictedStateKey = action.predictedStateKey ?? parsed.requestedStateKey;
    const transitionKey = `${parsed.requestedStateKey}>${action.actionKey}>${predictedStateKey}`;

    if (visitedTransitions.has(transitionKey)) {
      break;
    }
    visitedTransitions.add(transitionKey);

    steps.push({
      index: index + 1,
      mode: parsed.mode,
      requestedStateKey: parsed.requestedStateKey,
      predictedStateKey,
      action,
    });

    if (action.type === 'HOLD' || predictedStateKey === parsed.requestedStateKey) {
      break;
    }

    const nextItemIds = parseInventoryStateKey(predictedStateKey);
    if (!nextItemIds) {
      break;
    }

    itemIds = nextItemIds;
    const typicalGameTimeS = normalizeGameTime(action.averageGameTimeS);
    gameTimeS = Math.max(gameTimeS + 1, typicalGameTimeS);
  }

  return steps;
}

function renderWhenReady(): void {
  if (document.readyState !== 'loading') {
    render();
    return;
  }

  if (domReadyListenerRegistered) {
    return;
  }

  domReadyListenerRegistered = true;
  document.addEventListener('DOMContentLoaded', () => {
    domReadyListenerRegistered = false;
    render();
  }, { once: true });
}

function render(): void {
  const root = ensureRoot();
  if (!root) {
    return;
  }

  const snapshot = latestSnapshot;
  root.replaceChildren();

  if (!snapshot) {
    root.append(createEmptyView());
    return;
  }

  root.append(
    createHeader(snapshot),
    createSummary(snapshot),
    createInventorySection(snapshot),
    createRecommendationGrid(snapshot),
    createProjectedPath(snapshot),
    createDiagnostics(snapshot),
  );
}

function ensureRoot(): HTMLElement | undefined {
  injectStyles();

  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    return existing;
  }

  const host = document.querySelector('.right-col') as HTMLElement | null;
  if (!host) {
    return undefined;
  }

  host.classList.add('live-build-desktop-host');
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'live-build-desktop';
  host.append(root);
  return root;
}

function createEmptyView(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'live-build-desktop-empty';

  const title = document.createElement('strong');
  title.textContent = 'Waiting for a live match';

  const text = document.createElement('span');
  text.textContent = 'Start a match and select a hero. The current recommendation and projected build path will appear here.';

  empty.append(title, text);
  return empty;
}

function createHeader(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const header = document.createElement('div');
  header.className = 'live-build-desktop-header';

  const copy = document.createElement('div');
  const eyebrow = document.createElement('span');
  eyebrow.className = 'live-build-desktop-eyebrow';
  eyebrow.textContent = 'LIVE BUILD PLAN';

  const title = document.createElement('h2');
  title.textContent = snapshot.heroId ? `Hero ${snapshot.heroId}` : 'Waiting for hero';

  const subtitle = document.createElement('span');
  subtitle.className = 'live-build-desktop-subtitle';
  subtitle.textContent = snapshot.matchId
    ? `Match ${snapshot.matchId}`
    : 'No active match is being tracked';

  copy.append(eyebrow, title, subtitle);

  const controls = document.createElement('div');
  controls.className = 'live-build-desktop-controls';

  const status = document.createElement('span');
  status.className = `live-build-desktop-status live-build-desktop-status-${snapshot.state.toLowerCase()}`;
  status.textContent = formatState(snapshot.state);

  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Refresh live build';
  refresh.addEventListener('click', () => {
    const refreshHandler = (window as any).forceLiveBuildRecommendationRefresh;
    if (typeof refreshHandler === 'function') {
      refreshHandler();
    }
  });

  controls.append(status, refresh);
  header.append(copy, controls);
  return header;
}

function createSummary(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const summary = document.createElement('div');
  summary.className = 'live-build-summary-grid';

  const mode = snapshot.recommendation?.mode ?? 'WAITING';
  const entries: Array<[string, string]> = [
    ['Game time', formatGameTime(snapshot.gameTimeS)],
    ['Inventory items', String(snapshot.itemIds.length)],
    ['Recommendation mode', mode],
    ['Refresh generation', String(snapshot.refreshCount)],
  ];

  for (const [label, value] of entries) {
    const card = document.createElement('div');
    card.className = 'live-build-summary-card';

    const labelElement = document.createElement('span');
    labelElement.textContent = label;

    const valueElement = document.createElement('strong');
    valueElement.textContent = value;

    card.append(labelElement, valueElement);
    summary.append(card);
  }

  return summary;
}

function createInventorySection(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const section = document.createElement('section');
  section.className = 'live-build-desktop-section';

  const header = createSectionHeader('Current inventory', snapshot.inventoryStateKey ?? createInventoryStateKey(snapshot.itemIds));
  section.append(header);

  const items = document.createElement('div');
  items.className = 'live-build-inventory-list';
  const counts = countItemIds(snapshot.itemIds);
  const metadata = collectItemMetadata(snapshot);

  if (counts.size === 0) {
    const empty = document.createElement('span');
    empty.className = 'live-build-muted';
    empty.textContent = 'Empty inventory';
    items.append(empty);
  } else {
    for (const [itemId, count] of [...counts.entries()].sort((left, right) => left[0] - right[0])) {
      const chip = document.createElement('span');
      const item = metadata.get(itemId);
      chip.className = `live-build-inventory-chip live-build-slot-${normalizeSlot(item?.slotType)}`;
      chip.textContent = `${item?.name ?? `Item ${itemId}`}${count > 1 ? ` x${count}` : ''}`;
      chip.title = `Item ID ${itemId}`;
      items.append(chip);
    }
  }

  section.append(items);
  return section;
}

function createRecommendationGrid(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'live-build-recommendation-grid';

  const primarySection = document.createElement('section');
  primarySection.className = 'live-build-desktop-section';
  primarySection.append(createSectionHeader('Next action', snapshot.isStale ? 'Updating' : 'Current'));

  if (snapshot.recommendation) {
    primarySection.append(createActionCard(snapshot.recommendation.action, true));
  } else {
    primarySection.append(createStateMessage(snapshot));
  }

  const alternativesSection = document.createElement('section');
  alternativesSection.className = 'live-build-desktop-section';
  const alternatives = snapshot.recommendation?.alternatives ?? [];
  alternativesSection.append(createSectionHeader('Strong alternatives', `${alternatives.length} available`));

  const alternativesList = document.createElement('div');
  alternativesList.className = 'live-build-alternatives-list';
  if (alternatives.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'live-build-muted';
    empty.textContent = 'No alternatives passed the evidence filter.';
    alternativesList.append(empty);
  } else {
    for (const action of alternatives) {
      alternativesList.append(createActionCard(action, false));
    }
  }
  alternativesSection.append(alternativesList);

  grid.append(primarySection, alternativesSection);
  return grid;
}

function createProjectedPath(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const section = document.createElement('section');
  section.className = 'live-build-desktop-section live-build-projection-section';
  section.append(createSectionHeader('Projected build path', `${MAX_PROJECTED_STEPS} step maximum`));

  const note = document.createElement('p');
  note.className = 'live-build-projection-note';
  note.textContent = 'This path repeatedly follows the highest-ranked legal action from each predicted inventory state. It is recalculated whenever the live traversal key changes.';
  section.append(note);

  if (!canProject(snapshot)) {
    section.append(createProjectionMessage('Waiting for a ready hero and inventory state.'));
    return section;
  }

  if (projectionStatus === 'LOADING') {
    section.append(createProjectionMessage('Calculating the projected path...'));
    return section;
  }

  if (projectionStatus === 'ERROR') {
    section.append(createProjectionMessage(projectionError || 'Projected path is unavailable.', true));
    return section;
  }

  if (projectionSteps.length === 0) {
    section.append(createProjectionMessage('No additional legal build actions were found.'));
    return section;
  }

  const timeline = document.createElement('div');
  timeline.className = 'live-build-timeline';
  for (const step of projectionSteps) {
    timeline.append(createProjectedStep(step));
  }
  section.append(timeline);
  return section;
}

function createProjectedStep(step: ProjectedBuildStep): HTMLElement {
  const row = document.createElement('div');
  row.className = `live-build-timeline-step live-build-slot-${normalizeSlot(step.action.item?.slotType)}`;

  const index = document.createElement('span');
  index.className = 'live-build-step-index';
  index.textContent = String(step.index);

  const copy = document.createElement('div');
  copy.className = 'live-build-step-copy';

  const label = document.createElement('strong');
  label.textContent = step.action.label;

  const meta = document.createElement('span');
  meta.textContent = [
    step.mode,
    formatItemMetadata(step.action),
    step.action.explanation?.evidenceLevel,
  ].filter(Boolean).join(' | ');

  const state = document.createElement('code');
  state.textContent = `${step.requestedStateKey} -> ${step.predictedStateKey}`;

  copy.append(label, meta, state);

  const confidence = document.createElement('div');
  confidence.className = 'live-build-step-confidence';
  const value = document.createElement('strong');
  value.textContent = `${formatPercent(step.action.confidencePercent)}%`;
  const caption = document.createElement('span');
  caption.textContent = 'confidence';
  confidence.append(value, caption);

  row.append(index, copy, confidence);
  return row;
}

function createActionCard(
  action: LiveBuildRecommendationAction,
  primary: boolean,
): HTMLElement {
  const card = document.createElement('article');
  card.className = `${primary ? 'live-build-action-primary' : 'live-build-action-alternative'} live-build-slot-${normalizeSlot(action.item?.slotType)}`;

  const top = document.createElement('div');
  top.className = 'live-build-action-top';

  const copy = document.createElement('div');
  copy.className = 'live-build-action-copy';

  const label = document.createElement('strong');
  label.textContent = action.label;

  const metadata = document.createElement('span');
  metadata.textContent = formatItemMetadata(action);
  copy.append(label, metadata);

  const confidence = document.createElement('div');
  confidence.className = 'live-build-action-confidence';
  const confidenceValue = document.createElement('strong');
  confidenceValue.textContent = `${formatPercent(action.confidencePercent)}%`;
  const confidenceLabel = document.createElement('span');
  confidenceLabel.textContent = 'confidence';
  confidence.append(confidenceValue, confidenceLabel);

  top.append(copy, confidence);
  card.append(top);

  if (primary || action.explanation?.text) {
    const explanation = document.createElement('p');
    explanation.textContent = action.explanation?.text ?? 'No evidence explanation is available.';
    card.append(explanation);
  }

  return card;
}

function createDiagnostics(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const section = document.createElement('section');
  section.className = 'live-build-diagnostics';

  const entries = [
    `Traversal: ${snapshot.traversalKey ?? 'not ready'}`,
    `Cache hits: ${snapshot.cacheHitCount}`,
    `Discarded results: ${snapshot.discardedResultCount}`,
    snapshot.isStale ? 'Recommendation is updating' : 'Recommendation is current',
  ];

  if (snapshot.lastError) {
    entries.push(`Backend error: ${snapshot.lastError}`);
  }
  if (externalError) {
    entries.push(`Client error: ${externalError}`);
  }

  section.textContent = entries.join(' | ');
  return section;
}

function createSectionHeader(title: string, meta: string): HTMLElement {
  const header = document.createElement('div');
  header.className = 'live-build-section-header';

  const titleElement = document.createElement('h3');
  titleElement.textContent = title;

  const metaElement = document.createElement('span');
  metaElement.textContent = meta;

  header.append(titleElement, metaElement);
  return header;
}

function createStateMessage(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const message = document.createElement('div');
  message.className = 'live-build-desktop-state-message';

  const title = document.createElement('strong');
  const detail = document.createElement('span');

  if (snapshot.state === 'WAITING_FOR_BACKEND') {
    title.textContent = 'Waiting for backend traversal';
    detail.textContent = 'Live events have not produced a recommendation snapshot yet.';
  } else if (snapshot.state === 'WAITING_FOR_LOCAL_PLAYER') {
    title.textContent = 'Waiting for local player';
    detail.textContent = 'The roster has not identified the local player yet.';
  } else if (snapshot.state === 'WAITING_FOR_HERO') {
    title.textContent = 'Waiting for hero selection';
    detail.textContent = 'Select a hero to initialize the build policy.';
  } else if (snapshot.state === 'REFRESHING') {
    title.textContent = 'Refreshing recommendation';
    detail.textContent = 'The latest inventory state is being evaluated.';
  } else if (snapshot.state === 'ERROR') {
    title.textContent = 'Recommendation unavailable';
    detail.textContent = snapshot.lastError ?? 'The previous recommendation will remain visible when available.';
  } else {
    title.textContent = 'No recommendation yet';
    detail.textContent = 'Waiting for the next live inventory event.';
  }

  message.append(title, detail);
  return message;
}

function createProjectionMessage(text: string, error = false): HTMLElement {
  const message = document.createElement('div');
  message.className = error
    ? 'live-build-projection-message live-build-projection-message-error'
    : 'live-build-projection-message';
  message.textContent = text;
  return message;
}

function createProjectionKey(snapshot: LiveBuildRecommendationSnapshot): string {
  return snapshot.traversalKey ?? [
    snapshot.matchId,
    snapshot.heroId ?? '',
    createInventoryStateKey(snapshot.itemIds),
    snapshot.timeBucket ?? '',
  ].join(':');
}

function canProject(snapshot: LiveBuildRecommendationSnapshot): boolean {
  return (
    snapshot.state === 'READY' &&
    Number.isSafeInteger(snapshot.heroId) &&
    Number(snapshot.heroId) > 0 &&
    Array.isArray(snapshot.itemIds)
  );
}

function collectItemMetadata(
  snapshot: LiveBuildRecommendationSnapshot,
): Map<number, LiveBuildRecommendationAction['item']> {
  const result = new Map<number, LiveBuildRecommendationAction['item']>();
  const actions = [
    snapshot.recommendation?.action,
    ...(snapshot.recommendation?.alternatives ?? []),
    ...projectionSteps.map((step) => step.action),
  ];

  for (const action of actions) {
    if (action?.item && Number.isSafeInteger(action.item.itemId)) {
      result.set(action.item.itemId, action.item);
    }
  }
  return result;
}

export function parseInventoryStateKey(stateKey: string): number[] | undefined {
  if (stateKey === 'EMPTY') {
    return [];
  }

  const itemIds: number[] = [];
  for (const part of stateKey.split('|')) {
    const match = /^(\d+)x(\d+)$/.exec(part);
    if (!match) {
      return undefined;
    }

    const itemId = Number(match[1]);
    const count = Number(match[2]);
    if (!Number.isSafeInteger(itemId) || itemId <= 0 || !Number.isSafeInteger(count) || count <= 0 || count > 64) {
      return undefined;
    }

    for (let index = 0; index < count; index += 1) {
      itemIds.push(itemId);
    }
  }

  return itemIds.sort((left, right) => left - right);
}

function createInventoryStateKey(itemIds: readonly number[]): string {
  const counts = countItemIds(itemIds);
  if (counts.size === 0) {
    return 'EMPTY';
  }

  return [...counts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([itemId, count]) => `${itemId}x${count}`)
    .join('|');
}

function countItemIds(itemIds: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const rawItemId of itemIds) {
    const itemId = Number(rawItemId);
    if (!Number.isSafeInteger(itemId) || itemId <= 0) {
      continue;
    }
    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  return counts;
}

function isProjectedRecommendationResponse(value: unknown): value is ProjectedRecommendationResponse {
  if (!isRecord(value) || !isRecord(value.action)) {
    return false;
  }

  return (
    typeof value.mode === 'string' &&
    Number.isSafeInteger(value.heroId) &&
    typeof value.requestedStateKey === 'string' &&
    typeof value.action.type === 'string' &&
    typeof value.action.actionKey === 'string' &&
    typeof value.action.label === 'string' &&
    Array.isArray(value.alternatives)
  );
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
    parts.push(`Typical ${action.typicalGameTimeLabel}`);
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

function formatGameTime(value: number | undefined): string {
  const totalSeconds = normalizeGameTime(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function normalizeGameTime(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(Number(value))) : 0;
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

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #guide-empty,
    #guide-active {
      display: none !important;
    }
    .live-build-desktop-host {
      padding: 1.25rem;
      overflow-y: auto;
    }
    .live-build-desktop {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      min-height: 100%;
    }
    .live-build-desktop-header,
    .live-build-section-header,
    .live-build-action-top,
    .live-build-timeline-step {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .live-build-desktop-header {
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    .live-build-desktop-header h2 {
      margin: 0.15rem 0;
      color: var(--text-primary);
      font-size: 1.45rem;
    }
    .live-build-desktop-eyebrow,
    .live-build-section-header h3 {
      color: var(--accent);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .live-build-desktop-subtitle,
    .live-build-section-header span,
    .live-build-muted,
    .live-build-projection-note {
      color: var(--text-secondary);
      font-size: 0.75rem;
    }
    .live-build-desktop-controls {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .live-build-desktop-controls button {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.55rem 0.8rem;
      background: #1b1b22;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 0.72rem;
      cursor: pointer;
    }
    .live-build-desktop-status {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .live-build-desktop-status-ready { color: var(--success); }
    .live-build-desktop-status-refreshing { color: #fbbf24; }
    .live-build-desktop-status-error { color: var(--danger); }
    .live-build-desktop-status-waiting_for_backend,
    .live-build-desktop-status-waiting_for_local_player,
    .live-build-desktop-status-waiting_for_hero { color: var(--text-secondary); }
    .live-build-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.75rem;
    }
    .live-build-summary-card,
    .live-build-desktop-section {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.16);
    }
    .live-build-summary-card {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      padding: 0.8rem;
    }
    .live-build-summary-card span {
      color: var(--text-secondary);
      font-size: 0.66rem;
      text-transform: uppercase;
    }
    .live-build-summary-card strong {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.88rem;
    }
    .live-build-desktop-section {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
    }
    .live-build-section-header {
      padding-bottom: 0.65rem;
      border-bottom: 1px solid var(--border);
    }
    .live-build-section-header h3 {
      margin: 0;
    }
    .live-build-inventory-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .live-build-inventory-chip {
      border: 1px solid var(--border);
      border-left-width: 3px;
      border-radius: 6px;
      padding: 0.4rem 0.6rem;
      background: #1b1b22;
      font-size: 0.72rem;
    }
    .live-build-recommendation-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      gap: 1rem;
    }
    .live-build-action-primary,
    .live-build-action-alternative,
    .live-build-timeline-step,
    .live-build-desktop-state-message,
    .live-build-projection-message {
      border: 1px solid var(--border);
      border-left-width: 4px;
      border-radius: 8px;
      background: #1b1b22;
    }
    .live-build-action-primary {
      padding: 1rem;
    }
    .live-build-action-alternative {
      padding: 0.7rem 0.8rem;
    }
    .live-build-action-copy,
    .live-build-step-copy,
    .live-build-desktop-state-message {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      min-width: 0;
    }
    .live-build-action-copy strong,
    .live-build-step-copy strong {
      color: var(--text-primary);
      font-size: 0.88rem;
    }
    .live-build-action-copy span,
    .live-build-step-copy span,
    .live-build-desktop-state-message span {
      color: var(--text-secondary);
      font-size: 0.68rem;
    }
    .live-build-action-primary p,
    .live-build-action-alternative p {
      margin-top: 0.65rem;
      color: #c4c7ce;
      font-size: 0.72rem;
      line-height: 1.45;
    }
    .live-build-action-confidence,
    .live-build-step-confidence {
      display: flex;
      flex: 0 0 auto;
      flex-direction: column;
      align-items: flex-end;
      color: var(--accent);
      font-family: 'JetBrains Mono', monospace;
    }
    .live-build-action-confidence strong,
    .live-build-step-confidence strong {
      font-size: 1rem;
    }
    .live-build-action-confidence span,
    .live-build-step-confidence span {
      color: var(--text-secondary);
      font-size: 0.55rem;
    }
    .live-build-alternatives-list,
    .live-build-timeline {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }
    .live-build-projection-note {
      line-height: 1.45;
    }
    .live-build-timeline-step {
      justify-content: flex-start;
      padding: 0.7rem 0.8rem;
    }
    .live-build-step-index {
      display: flex;
      flex: 0 0 28px;
      width: 28px;
      height: 28px;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(255, 107, 74, 0.14);
      color: var(--accent);
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      font-weight: 700;
    }
    .live-build-step-copy {
      flex: 1;
    }
    .live-build-step-copy code {
      overflow: hidden;
      color: #7f8490;
      font-size: 0.58rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .live-build-slot-weapon { border-left-color: #f59e0b; }
    .live-build-slot-vitality { border-left-color: #10b981; }
    .live-build-slot-spirit { border-left-color: #a855f7; }
    .live-build-slot-neutral { border-left-color: #9ca3af; }
    .live-build-desktop-state-message,
    .live-build-projection-message {
      padding: 0.85rem;
      border-left-color: #9ca3af;
      color: var(--text-secondary);
      font-size: 0.75rem;
    }
    .live-build-projection-message-error {
      border-left-color: var(--danger);
      color: #fca5a5;
    }
    .live-build-diagnostics {
      color: #6b7280;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.58rem;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .live-build-desktop-empty {
      display: flex;
      min-height: 300px;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.6rem;
      color: var(--text-secondary);
      text-align: center;
    }
    .live-build-desktop-empty strong {
      color: var(--text-primary);
      font-size: 1.1rem;
    }
    @media (max-width: 900px) {
      .live-build-summary-grid,
      .live-build-recommendation-grid {
        grid-template-columns: 1fr 1fr;
      }
    }
    @media (max-width: 680px) {
      .live-build-summary-grid,
      .live-build-recommendation-grid {
        grid-template-columns: 1fr;
      }
      .live-build-desktop-header {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  `;
  document.head.append(style);
}
