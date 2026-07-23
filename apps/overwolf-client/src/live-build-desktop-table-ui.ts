import {
  LiveBuildRecommendationAction,
  LiveBuildRecommendationSnapshot,
} from './live-build-recommendation-poller';

const API_BASE_URL = 'https://aboba-telegramovich.duckdns.org';
const ROOT_ID = 'live-build-desktop-root';
const STYLE_ID = 'live-build-desktop-table-styles';
const MODEL_ROLLOUT_STEP_S = 90;
const MODEL_ROLLOUT_MAX_STEPS = 24;

export type LiveBuildPhase = 'EARLY' | 'MID' | 'LATE';

type ProjectionStatus = 'IDLE' | 'LOADING' | 'READY' | 'ERROR';

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
  recommendationModel?: 'CONTEXTUAL_V3';
}

interface ProjectedBuildStep {
  index: number;
  mode: ProjectedRecommendationResponse['mode'];
  gameTimeS: number;
  requestedStateKey: string;
  predictedStateKey: string;
  action: ExtendedLiveBuildRecommendationAction;
}

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
    resetProjection();
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

  void projectFullBuild(snapshot, generation)
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
  resetProjection();
  externalError = '';
  renderWhenReady();
}

async function projectFullBuild(
  snapshot: LiveBuildRecommendationSnapshot,
  generation: number,
): Promise<ProjectedBuildStep[]> {
  const heroId = Number(snapshot.heroId);
  let itemIds = [...snapshot.itemIds];
  let gameTimeS = normalizeGameTime(snapshot.gameTimeS);
  const alliedHeroIds = [...(snapshot.alliedHeroIds ?? [])];
  const enemyHeroIds = [...(snapshot.enemyHeroIds ?? [])];
  const previousActionKeys = [...(snapshot.previousActionKeys ?? [])];
  const steps: ProjectedBuildStep[] = [];
  const visitedTransitions = new Set<string>();
  const visitedStates = new Set<string>([
    snapshot.inventoryStateKey ?? createInventoryStateKey(itemIds),
  ]);

  while (
    generation === projectionGeneration &&
    steps.length < MODEL_ROLLOUT_MAX_STEPS
  ) {
    const response = await window.fetch(
      `${API_BASE_URL}/deadlock/analysis/build-recommendation`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          heroId,
          itemIds,
          gameTimeS,
          alliedHeroIds,
          enemyHeroIds,
          previousActionKeys,
          limit: 5,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Full build request failed with HTTP ${response.status}.`);
    }

    const parsed = await response.json() as unknown;
    if (!isProjectedRecommendationResponse(parsed)) {
      throw new Error('Full build response has an invalid shape.');
    }
    if (parsed.recommendationModel !== 'CONTEXTUAL_V3') {
      throw new Error('Full build response did not come from Contextual V3.');
    }

    const action = parsed.action;
    if (action.type === 'HOLD') {
      break;
    }

    const predictedStateKey = action.predictedStateKey ?? parsed.requestedStateKey;
    if (predictedStateKey === parsed.requestedStateKey) {
      break;
    }

    const transitionKey = `${parsed.requestedStateKey}>${action.actionKey}>${predictedStateKey}`;
    if (visitedTransitions.has(transitionKey)) {
      break;
    }
    visitedTransitions.add(transitionKey);

    steps.push({
      index: steps.length + 1,
      mode: parsed.mode,
      gameTimeS,
      requestedStateKey: parsed.requestedStateKey,
      predictedStateKey,
      action,
    });

    if (visitedStates.has(predictedStateKey)) {
      break;
    }
    visitedStates.add(predictedStateKey);

    const nextItemIds = parseInventoryStateKey(predictedStateKey);
    if (!nextItemIds) {
      break;
    }

    itemIds = nextItemIds;
    previousActionKeys.push(action.actionKey);
    gameTimeS = advanceModelRolloutTime(gameTimeS);
  }

  return steps;
}

function resetProjection(): void {
  projectionKey = '';
  projectionStatus = 'IDLE';
  projectionSteps = [];
  projectionError = '';
  projectionGeneration += 1;
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

  root.replaceChildren();
  const snapshot = latestSnapshot;
  if (!snapshot) {
    root.append(createEmptyView());
    return;
  }

  root.append(
    createHeader(snapshot),
    createSummary(snapshot),
    createCurrentAction(snapshot),
    createFullBuildTable(snapshot),
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
  empty.className = 'live-build-empty';

  const title = document.createElement('strong');
  title.textContent = 'Waiting for a live match';

  const detail = document.createElement('span');
  detail.textContent = 'Start a match and select a hero. The complete Early, Mid and Late build will appear here.';

  empty.append(title, detail);
  return empty;
}

function createHeader(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const header = document.createElement('header');
  header.className = 'live-build-header';

  const copy = document.createElement('div');
  const eyebrow = document.createElement('span');
  eyebrow.className = 'live-build-eyebrow';
  eyebrow.textContent = 'LIVE BUILD PLAN';

  const title = document.createElement('h2');
  title.textContent = resolveHeroDisplayName(snapshot);

  const subtitle = document.createElement('span');
  subtitle.className = 'live-build-subtitle';
  subtitle.textContent = snapshot.matchId
    ? `Match ${snapshot.matchId}`
    : 'No active match is being tracked';

  copy.append(eyebrow, title, subtitle);

  const controls = document.createElement('div');
  controls.className = 'live-build-controls';

  const status = document.createElement('span');
  status.className = `live-build-status live-build-status-${snapshot.state.toLowerCase()}`;
  status.textContent = formatState(snapshot.state);

  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Refresh live build';
  refresh.addEventListener('click', () => {
    const handler = (window as any).forceLiveBuildRecommendationRefresh;
    if (typeof handler === 'function') {
      handler();
    }
  });

  controls.append(status, refresh);
  header.append(copy, controls);
  return header;
}

function createSummary(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const summary = document.createElement('div');
  summary.className = 'live-build-summary';

  const entries: Array<[string, string]> = [
    ['Game time', formatGameTime(snapshot.gameTimeS)],
    [
      'Recommendation source',
      snapshot.recommendation?.recommendationModel === 'CONTEXTUAL_V3'
        ? `MODEL V3 ${snapshot.recommendation.contextualFeatures?.phase ?? ''}`.trim()
        : snapshot.recommendation
          ? 'BASELINE'
          : 'WAITING',
    ],
    ['Build actions', projectionStatus === 'READY' ? String(projectionSteps.length) : '...'],
    ['Refresh generation', String(snapshot.refreshCount)],
  ];

  for (const [label, value] of entries) {
    const card = document.createElement('div');
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    const valueElement = document.createElement('strong');
    valueElement.textContent = value;
    card.append(labelElement, valueElement);
    summary.append(card);
  }

  return summary;
}

function createCurrentAction(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const section = document.createElement('section');
  section.className = 'live-build-current-action';

  const heading = document.createElement('div');
  heading.className = 'live-build-section-heading';
  const title = document.createElement('h3');
  title.textContent = 'Next action';
  const meta = document.createElement('span');
  meta.textContent = snapshot.isStale ? 'Updating' : 'Current';
  heading.append(title, meta);
  section.append(heading);

  if (!snapshot.recommendation) {
    section.append(createStateMessage(snapshot));
    return section;
  }

  section.append(createActionBanner(snapshot.recommendation.action));
  return section;
}

function createActionBanner(action: LiveBuildRecommendationAction): HTMLElement {
  const banner = document.createElement('div');
  banner.className = `live-build-action-banner live-build-slot-${normalizeSlot(action.item?.slotType)}`;

  const copy = document.createElement('div');
  const label = document.createElement('strong');
  label.textContent = action.label;
  const metadata = document.createElement('span');
  metadata.textContent = formatItemMetadata(action);
  const explanation = document.createElement('p');
  explanation.textContent = action.explanation?.text ?? '';
  copy.append(label, metadata, explanation);

  const confidence = document.createElement('div');
  confidence.className = 'live-build-action-confidence';
  const value = document.createElement('strong');
  value.textContent = `${formatPercent(action.confidencePercent)}%`;
  const caption = document.createElement('span');
  caption.textContent = 'confidence';
  confidence.append(value, caption);

  banner.append(copy, confidence);
  return banner;
}

function createFullBuildTable(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const section = document.createElement('section');
  section.className = 'live-build-full-table';

  const heading = document.createElement('div');
  heading.className = 'live-build-section-heading';
  const title = document.createElement('h3');
  title.textContent = 'Full build';
  const meta = document.createElement('span');
  meta.textContent = 'Early / Mid / Late';
  heading.append(title, meta);
  section.append(heading);

  if (!canProject(snapshot)) {
    section.append(createStateMessage(snapshot));
    return section;
  }

  if (projectionStatus === 'LOADING') {
    section.append(createTableMessage('Building the complete route...'));
    return section;
  }

  if (projectionStatus === 'ERROR') {
    section.append(createTableMessage(projectionError || 'Full build calculation failed.', true));
    return section;
  }

  if (projectionSteps.length === 0) {
    section.append(createTableMessage('No further legal build actions were found.'));
    return section;
  }

  const phaseGrid = document.createElement('div');
  phaseGrid.className = 'live-build-phase-grid';
  phaseGrid.append(
    createPhaseTable('EARLY', projectionSteps.filter((step) => classifyBuildPhase(getStepTime(step)) === 'EARLY')),
    createPhaseTable('MID', projectionSteps.filter((step) => classifyBuildPhase(getStepTime(step)) === 'MID')),
    createPhaseTable('LATE', projectionSteps.filter((step) => classifyBuildPhase(getStepTime(step)) === 'LATE')),
  );
  section.append(phaseGrid);
  return section;
}

function createPhaseTable(phase: LiveBuildPhase, steps: ProjectedBuildStep[]): HTMLElement {
  const card = document.createElement('div');
  card.className = `live-build-phase live-build-phase-${phase.toLowerCase()}`;

  const header = document.createElement('div');
  header.className = 'live-build-phase-header';
  const title = document.createElement('strong');
  title.textContent = phase === 'EARLY'
    ? 'Early game (0-10m)'
    : phase === 'MID'
      ? 'Mid game (10-20m)'
      : 'Late game (20m+)';
  const count = document.createElement('span');
  count.textContent = `${steps.length} action${steps.length === 1 ? '' : 's'}`;
  header.append(title, count);
  card.append(header);

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const label of ['#', 'Action', 'Item', 'Type', 'Cost', 'Tier', 'Typical', 'Confidence', 'Evidence']) {
    const cell = document.createElement('th');
    cell.textContent = label;
    headerRow.append(cell);
  }
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  if (steps.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 9;
    cell.className = 'live-build-empty-phase';
    cell.textContent = 'No actions in this phase.';
    row.append(cell);
    tbody.append(row);
  } else {
    for (const step of steps) {
      tbody.append(createBuildRow(step));
    }
  }
  table.append(tbody);
  card.append(table);
  return card;
}

function createBuildRow(step: ProjectedBuildStep): HTMLTableRowElement {
  const row = document.createElement('tr');
  const action = step.action;
  row.className = `live-build-slot-${normalizeSlot(action.item?.slotType)}`;

  const values = [
    String(step.index),
    action.type,
    action.item?.name ?? action.label.replace(/^(Buy|Upgrade to|Sell)\s+/i, ''),
    capitalize(action.item?.slotType ?? '-'),
    Number(action.item?.cost) > 0 ? String(action.item?.cost) : '-',
    Number(action.item?.tier) > 0 ? String(action.item?.tier) : '-',
    action.typicalGameTimeLabel || formatGameTime(action.averageGameTimeS),
    `${formatPercent(action.confidencePercent)}%`,
    formatEvidence(action),
  ];

  for (const value of values) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }

  row.title = action.explanation?.text ?? '';
  return row;
}

function createDiagnostics(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const diagnostics = document.createElement('div');
  diagnostics.className = 'live-build-diagnostics';
  const entries = [
    `Traversal: ${snapshot.traversalKey ?? 'not ready'}`,
    `Cache hits: ${snapshot.cacheHitCount}`,
    `Discarded: ${snapshot.discardedResultCount}`,
  ];
  if (snapshot.lastError) {
    entries.push(`Backend: ${snapshot.lastError}`);
  }
  if (externalError) {
    entries.push(`Client: ${externalError}`);
  }
  diagnostics.textContent = entries.join(' | ');
  return diagnostics;
}

function createStateMessage(snapshot: LiveBuildRecommendationSnapshot): HTMLElement {
  const message = document.createElement('div');
  message.className = 'live-build-state-message';
  const title = document.createElement('strong');
  const detail = document.createElement('span');

  if (snapshot.state === 'WAITING_FOR_BACKEND') {
    title.textContent = 'Waiting for backend traversal';
    detail.textContent = 'Live events have not produced a recommendation yet.';
  } else if (snapshot.state === 'WAITING_FOR_LOCAL_PLAYER') {
    title.textContent = 'Waiting for local player';
    detail.textContent = 'The roster has not identified the local player yet.';
  } else if (snapshot.state === 'WAITING_FOR_HERO') {
    title.textContent = 'Waiting for hero selection';
    detail.textContent = 'Select a hero to initialize the build policy.';
  } else if (snapshot.state === 'REFRESHING') {
    title.textContent = 'Refreshing recommendation';
    detail.textContent = 'The latest state is being evaluated.';
  } else if (snapshot.state === 'ERROR') {
    title.textContent = 'Recommendation unavailable';
    detail.textContent = snapshot.lastError ?? 'The previous recommendation will remain visible when available.';
  } else {
    title.textContent = 'No recommendation yet';
    detail.textContent = 'Waiting for the next live event.';
  }

  message.append(title, detail);
  return message;
}

function createTableMessage(text: string, error = false): HTMLElement {
  const message = document.createElement('div');
  message.className = error ? 'live-build-table-message error' : 'live-build-table-message';
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

export function resolveHeroDisplayName(snapshot: Pick<LiveBuildRecommendationSnapshot, 'heroId'>): string {
  const mainWindow = getMainWindow();
  const heroId = Number(snapshot.heroId);
  const candidates = [
    mainWindow?.heroNamesMap?.[heroId],
    mainWindow?.heroNamesMap?.[String(heroId)],
    mainWindow?.heroName,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeHeroName(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return Number.isSafeInteger(heroId) && heroId > 0 ? `Hero ${heroId}` : 'Waiting for hero';
}

export function normalizeHeroName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value
    .trim()
    .replace(/^hero_/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');

  if (!normalized) {
    return undefined;
  }

  return normalized.replace(/\b\p{L}/gu, (character) => character.toUpperCase());
}

function getMainWindow(): any {
  try {
    const overwolf = (window as any).overwolf;
    return overwolf?.windows?.getMainWindow?.() ?? window;
  } catch {
    return window;
  }
}

export function classifyBuildPhase(gameTimeS: number): LiveBuildPhase {
  const normalized = normalizeGameTime(gameTimeS);
  if (normalized < 600) {
    return 'EARLY';
  }
  if (normalized < 1200) {
    return 'MID';
  }
  return 'LATE';
}

function getStepTime(step: ProjectedBuildStep): number {
  return normalizeGameTime(step.gameTimeS);
}

export function advanceModelRolloutTime(gameTimeS: number): number {
  return normalizeGameTime(gameTimeS) + MODEL_ROLLOUT_STEP_S;
}

function formatEvidence(action: ExtendedLiveBuildRecommendationAction): string {
  const matchup = action.matchupSignals?.find(
    (signal) => signal.direction === 'POSITIVE',
  );
  if (matchup) {
    return `VS ${matchup.heroName} +${formatPercent(matchup.modelLiftPercent)}% (${matchup.observationCount})`;
  }
  const count = Number(action.historicalCount);
  const probability = Number(action.historicalProbabilityPercent);
  if (Number.isFinite(count) && count > 0 && Number.isFinite(probability)) {
    return `${count} / ${formatPercent(probability)}%`;
  }
  return action.explanation?.evidenceLevel ?? '-';
}

function formatItemMetadata(action: LiveBuildRecommendationAction): string {
  const parts: string[] = [];
  if (action.item?.slotType) {
    parts.push(capitalize(action.item.slotType));
  }
  if (Number(action.item?.cost) > 0) {
    parts.push(`${action.item?.cost} souls`);
  }
  if (Number(action.item?.tier) > 0) {
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
  const counts = new Map<number, number>();
  for (const rawItemId of itemIds) {
    const itemId = Number(rawItemId);
    if (!Number.isSafeInteger(itemId) || itemId <= 0) {
      continue;
    }
    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return 'EMPTY';
  }

  return [...counts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([itemId, count]) => `${itemId}x${count}`)
    .join('|');
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
    #guide-empty, #guide-active, #live-build-desktop-root:not(.live-build-desktop) { display: none !important; }
    .live-build-desktop-host { padding: 1.25rem; overflow-y: auto; }
    .live-build-desktop { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
    .live-build-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
    .live-build-header > div:first-child { display: flex; flex-direction: column; gap: 0.18rem; }
    .live-build-eyebrow, .live-build-section-heading h3 { color: var(--accent); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .live-build-header h2 { margin: 0; font-size: 1.4rem; color: var(--text-primary); }
    .live-build-subtitle, .live-build-section-heading span, .live-build-phase-header span, .live-build-diagnostics { color: var(--text-secondary); font-size: 0.68rem; }
    .live-build-controls { display: flex; align-items: center; gap: 0.8rem; }
    .live-build-controls button { border: 1px solid var(--border); border-radius: 5px; padding: 0.55rem 0.8rem; background: #1b1b22; color: var(--text-primary); cursor: pointer; }
    .live-build-status { color: var(--text-secondary); font-family: 'JetBrains Mono', monospace; font-size: 0.66rem; font-weight: 700; text-transform: uppercase; }
    .live-build-status-ready { color: var(--success); }
    .live-build-status-error { color: var(--danger); }
    .live-build-status-refreshing { color: #fbbf24; }
    .live-build-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.75rem; }
    .live-build-summary > div { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.8rem; border: 1px solid var(--border); border-radius: 8px; background: rgba(0,0,0,0.15); }
    .live-build-summary span { color: #8fb6d9; font-size: 0.66rem; text-transform: uppercase; }
    .live-build-summary strong { color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; }
    .live-build-current-action, .live-build-full-table { padding: 1rem; border: 1px solid var(--border); border-radius: 10px; background: rgba(0,0,0,0.12); }
    .live-build-section-heading, .live-build-phase-header { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding-bottom: 0.65rem; border-bottom: 1px solid var(--border); }
    .live-build-action-banner { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-top: 0.75rem; padding: 0.9rem 1rem; border: 1px solid var(--border); border-left-width: 4px; border-radius: 8px; background: #1b1b22; }
    .live-build-action-banner > div:first-child { display: flex; flex: 1; flex-direction: column; gap: 0.2rem; min-width: 0; }
    .live-build-action-banner strong { font-size: 0.95rem; }
    .live-build-action-banner span, .live-build-action-banner p { color: var(--text-secondary); font-size: 0.7rem; line-height: 1.35; }
    .live-build-action-banner p { margin-top: 0.25rem; }
    .live-build-action-confidence { display: flex; flex-direction: column; align-items: flex-end; color: var(--accent); font-family: 'JetBrains Mono', monospace; }
    .live-build-action-confidence strong { font-size: 1rem; }
    .live-build-action-confidence span { font-size: 0.55rem; }
    .live-build-phase-grid { display: flex; flex-direction: column; gap: 0.9rem; margin-top: 0.85rem; }
    .live-build-phase { overflow: hidden; border: 1px solid var(--border); border-radius: 8px; background: rgba(0,0,0,0.18); }
    .live-build-phase-header { padding: 0.65rem 0.8rem; background: rgba(255,255,255,0.025); }
    .live-build-phase-header strong { font-size: 0.76rem; text-transform: uppercase; }
    .live-build-phase-early .live-build-phase-header strong { color: #34d399; }
    .live-build-phase-mid .live-build-phase-header strong { color: #fbbf24; }
    .live-build-phase-late .live-build-phase-header strong { color: #f87171; }
    .live-build-phase table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .live-build-phase th, .live-build-phase td { padding: 0.55rem 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.055); text-align: left; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .live-build-phase th { color: #8fb6d9; font-size: 0.62rem; font-weight: 600; text-transform: uppercase; }
    .live-build-phase td { color: var(--text-primary); font-size: 0.7rem; }
    .live-build-phase th:nth-child(1), .live-build-phase td:nth-child(1) { width: 3.5%; }
    .live-build-phase th:nth-child(2), .live-build-phase td:nth-child(2) { width: 7%; }
    .live-build-phase th:nth-child(3), .live-build-phase td:nth-child(3) { width: 23%; }
    .live-build-phase th:nth-child(4), .live-build-phase td:nth-child(4) { width: 8%; }
    .live-build-phase th:nth-child(5), .live-build-phase td:nth-child(5) { width: 7%; }
    .live-build-phase th:nth-child(6), .live-build-phase td:nth-child(6) { width: 5%; }
    .live-build-phase th:nth-child(7), .live-build-phase td:nth-child(7) { width: 9%; }
    .live-build-phase th:nth-child(8), .live-build-phase td:nth-child(8) { width: 10%; }
    .live-build-phase th:nth-child(9), .live-build-phase td:nth-child(9) { width: 13%; }
    .live-build-phase tbody tr:last-child td { border-bottom: 0; }
    .live-build-phase tbody tr:hover { background: rgba(255,107,74,0.06); }
    .live-build-phase tr.live-build-slot-weapon td:nth-child(3) { color: #fbbf24; }
    .live-build-phase tr.live-build-slot-vitality td:nth-child(3) { color: #34d399; }
    .live-build-phase tr.live-build-slot-spirit td:nth-child(3) { color: #c084fc; }
    .live-build-slot-weapon { border-left-color: #f59e0b; }
    .live-build-slot-vitality { border-left-color: #10b981; }
    .live-build-slot-spirit { border-left-color: #a855f7; }
    .live-build-slot-neutral { border-left-color: #9ca3af; }
    .live-build-empty-phase, .live-build-table-message, .live-build-state-message, .live-build-empty { padding: 1rem; color: var(--text-secondary); text-align: center; }
    .live-build-state-message, .live-build-empty { display: flex; flex-direction: column; gap: 0.3rem; }
    .live-build-table-message.error { color: #f87171; }
    .live-build-diagnostics { padding-top: 0.2rem; font-family: 'JetBrains Mono', monospace; overflow-wrap: anywhere; }
    @media (max-width: 900px) {
      .live-build-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .live-build-phase { overflow-x: auto; }
      .live-build-phase table { min-width: 900px; }
    }
  `;
  document.head.append(style);
}
