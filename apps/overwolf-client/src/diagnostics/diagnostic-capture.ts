export type DiagnosticRawSource = 'onInfoUpdates2' | 'onNewEvents';

export interface DiagnosticRawEvent {
  receivedAt: number;
  source: DiagnosticRawSource;
  feature?: string;
  category?: string;
  key?: string;
  rawPayload: unknown;
}

type DiagnosticSystemSource = 'getInfo' | 'runningGameInfo' | 'manifest' | 'system';

type DiagnosticEntry = {
  sequence: number;
  appSessionId: string;
  receivedAt: string;
  source: DiagnosticRawSource | DiagnosticSystemSource;
  matchId?: string;
  feature?: string;
  category?: string;
  key?: string;
  rawPayload: unknown;
};

type DiagnosticNote = {
  id: string;
  createdAt: string;
  approximateGameTime?: string;
  action: string;
  item?: string;
  note?: string;
};

type DiagnosticAppSession = {
  id: string;
  clientId: string;
  startedAt: string;
};

type PersistedDiagnosticState = {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  currentMatchId?: string;
  manualSteamBuildId?: string;
  truncated: boolean;
  sequence: number;
  appSessions: DiagnosticAppSession[];
  entries: DiagnosticEntry[];
  notes: DiagnosticNote[];
};

type ZipFile = {
  name: string;
  content: string;
  modifiedAt?: Date;
};

const STORAGE_KEY = 'deadlock-live-probe-diagnostics-v1';
const MAX_PERSISTED_CHARS = 4_200_000;
const MAX_ENTRIES = 12_000;
const PERSIST_DELAY_MS = 750;

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function sanitizeForJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => sanitizeForJson(item, seen));
    seen.delete(value);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = sanitizeForJson(item, seen);
  }
  seen.delete(value);
  return result;
}

function stringifyForStorage(value: unknown, space?: number): string {
  return JSON.stringify(sanitizeForJson(value), null, space);
}

function extractStringPayload(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string' || (typeof parsed === 'number' && Number.isFinite(parsed))) {
      return String(parsed);
    }
  } catch {
    // Preserve non-JSON GEP string values.
  }

  return trimmed;
}

function findMatchId(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    try {
      return findMatchId(JSON.parse(value), depth + 1);
    } catch {
      return undefined;
    }
  }

  if (typeof value !== 'object') {
    return undefined;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'match_id' || key === 'matchId') {
      const matchId = extractStringPayload(item);
      if (matchId) {
        return matchId;
      }
    }
  }

  for (const item of Object.values(value as Record<string, unknown>)) {
    const nested = findMatchId(item, depth + 1);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function collectVersionCandidates(value: unknown, result = new Set<string>(), depth = 0): Set<string> {
  if (depth > 8 || value === null || value === undefined) {
    return result;
  }

  if (typeof value === 'string') {
    try {
      collectVersionCandidates(JSON.parse(value), result, depth + 1);
    } catch {
      // Non-JSON strings are handled by their parent key.
    }
    return result;
  }

  if (typeof value !== 'object') {
    return result;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(build|version)/i.test(key) && (typeof item === 'string' || typeof item === 'number')) {
      result.add(`${key}: ${String(item)}`);
    }
    collectVersionCandidates(item, result, depth + 1);
  }

  return result;
}

function shouldCaptureEvent(event: DiagnosticRawEvent): boolean {
  if (event.source === 'onNewEvents') {
    return true;
  }

  const category = event.category || '';
  const key = event.key || '';
  return (
    category === 'match_info' ||
    category === 'game_info' ||
    category === 'roster' ||
    category === 'items' ||
    key === 'match_id' ||
    key === 'match_state' ||
    key.startsWith('items_') ||
    key.startsWith('roster_')
  );
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { date: dosDate, time: dosTime };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function createStoredZipBytes(files: ZipFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const contentBytes = encoder.encode(file.content);
    const checksum = crc32(contentBytes);
    const modifiedAt = file.modifiedAt || new Date();
    const dos = toDosDateTime(modifiedAt);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, dos.time);
    writeUint16(localView, 12, dos.date);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, contentBytes.length);
    writeUint32(localView, 22, contentBytes.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, contentBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, dos.time);
    writeUint16(centralView, 14, dos.date);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, contentBytes.length);
    writeUint32(centralView, 24, contentBytes.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + contentBytes.length;
  }

  const localData = concatBytes(localParts);
  const centralData = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralData.length);
  writeUint32(endView, 16, localData.length);
  writeUint16(endView, 20, 0);

  return concatBytes([localData, centralData, end]);
}

function createInitialState(clientId: string, appSessionId: string): PersistedDiagnosticState {
  const timestamp = nowIso();
  return {
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    truncated: false,
    sequence: 0,
    appSessions: [{ id: appSessionId, clientId, startedAt: timestamp }],
    entries: [],
    notes: [],
  };
}

export class DiagnosticCapture {
  private readonly appSessionId = randomId('session');
  private state: PersistedDiagnosticState;
  private persistTimerId?: number;
  private estimatedChars = 0;
  private initialized = false;
  private readonly lastFingerprintByChannel = new Map<string, string>();

  constructor(private readonly clientId: string) {
    this.state = this.loadState();
    if (!this.state.appSessions.some((session) => session.id === this.appSessionId)) {
      this.state.appSessions.push({
        id: this.appSessionId,
        clientId,
        startedAt: nowIso(),
      });
    }
    this.state.appSessions = this.state.appSessions.slice(-100);
    this.captureSystem('system', 'app_session_started', {
      clientId,
      appSessionId: this.appSessionId,
    });
  }

  initialize(overwolfApi: any): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.mountPanel();

    if (overwolfApi?.games?.events?.getInfo) {
      overwolfApi.games.events.getInfo((result: unknown) => {
        this.captureSystem('getInfo', 'initial_snapshot', result);
      });
    }

    if (overwolfApi?.games?.getRunningGameInfo) {
      overwolfApi.games.getRunningGameInfo((result: unknown) => {
        this.captureSystem('runningGameInfo', 'running_game_info', result);
      });
    }

    if (overwolfApi?.extensions?.current?.getManifest) {
      overwolfApi.extensions.current.getManifest((result: unknown) => {
        this.captureSystem('manifest', 'overwolf_manifest', result);
      });
    }
  }

  captureRaw(event: DiagnosticRawEvent): void {
    if (!shouldCaptureEvent(event)) {
      return;
    }

    const rawPayload = sanitizeForJson(event.rawPayload);
    const fingerprint = stringifyForStorage(rawPayload);
    const channel = [event.source, event.feature || '', event.category || '', event.key || ''].join('|');
    if (this.lastFingerprintByChannel.get(channel) === fingerprint) {
      return;
    }
    this.lastFingerprintByChannel.set(channel, fingerprint);

    const matchId = this.resolveMatchId(event.key, rawPayload);
    this.appendEntry({
      sequence: ++this.state.sequence,
      appSessionId: this.appSessionId,
      receivedAt: new Date(event.receivedAt).toISOString(),
      source: event.source,
      matchId,
      feature: event.feature,
      category: event.category,
      key: event.key,
      rawPayload,
    });
  }

  private captureSystem(source: DiagnosticSystemSource, key: string, rawPayload: unknown): void {
    const sanitizedPayload = sanitizeForJson(rawPayload);
    const discoveredMatchId = findMatchId(sanitizedPayload);
    if (discoveredMatchId) {
      this.state.currentMatchId = discoveredMatchId;
    }

    this.appendEntry({
      sequence: ++this.state.sequence,
      appSessionId: this.appSessionId,
      receivedAt: nowIso(),
      source,
      matchId: this.state.currentMatchId,
      key,
      rawPayload: sanitizedPayload,
    });
  }

  private resolveMatchId(key: string | undefined, rawPayload: unknown): string | undefined {
    if (key === 'match_id') {
      const nextMatchId = extractStringPayload(rawPayload);
      if (nextMatchId) {
        this.state.currentMatchId = nextMatchId;
      }
    }
    return this.state.currentMatchId;
  }

  private appendEntry(entry: DiagnosticEntry): void {
    const serializedLength = stringifyForStorage(entry).length + 1;
    this.state.entries.push(entry);
    this.estimatedChars += serializedLength;

    while (this.state.entries.length > MAX_ENTRIES || this.estimatedChars > MAX_PERSISTED_CHARS) {
      const removed = this.state.entries.shift();
      if (!removed) {
        break;
      }
      this.estimatedChars = Math.max(0, this.estimatedChars - stringifyForStorage(removed).length - 1);
      this.state.truncated = true;
    }

    this.state.updatedAt = nowIso();
    this.schedulePersist();
    this.refreshPanel();
  }

  private loadState(): PersistedDiagnosticState {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const initial = createInitialState(this.clientId, this.appSessionId);
        this.estimatedChars = 0;
        return initial;
      }

      const parsed = JSON.parse(raw) as PersistedDiagnosticState;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries) || !Array.isArray(parsed.notes)) {
        return createInitialState(this.clientId, this.appSessionId);
      }
      if (!Array.isArray(parsed.appSessions)) {
        parsed.appSessions = [];
      }

      this.estimatedChars = parsed.entries.reduce((sum, entry) => sum + stringifyForStorage(entry).length + 1, 0);
      return parsed;
    } catch (error) {
      console.error('Failed to restore diagnostic capture state:', error);
      return createInitialState(this.clientId, this.appSessionId);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimerId !== undefined) {
      return;
    }

    this.persistTimerId = window.setTimeout(() => {
      this.persistTimerId = undefined;
      this.persist();
    }, PERSIST_DELAY_MS);
  }

  private persist(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, stringifyForStorage(this.state));
    } catch (error) {
      console.error('Failed to persist diagnostic capture state:', error);
      this.state.truncated = true;
      while (this.state.entries.length > 100) {
        this.state.entries.shift();
      }
      this.estimatedChars = this.state.entries.reduce((sum, entry) => sum + stringifyForStorage(entry).length + 1, 0);
      try {
        window.localStorage.setItem(STORAGE_KEY, stringifyForStorage(this.state));
      } catch (retryError) {
        console.error('Failed to persist reduced diagnostic state:', retryError);
      }
    }
  }

  private addNoteFromPanel(): void {
    const actionEl = document.getElementById('diagnostic-action') as HTMLSelectElement | null;
    const itemEl = document.getElementById('diagnostic-item') as HTMLInputElement | null;
    const timeEl = document.getElementById('diagnostic-game-time') as HTMLInputElement | null;
    const noteEl = document.getElementById('diagnostic-note') as HTMLInputElement | null;
    if (!actionEl) {
      return;
    }

    const note: DiagnosticNote = {
      id: randomId('note'),
      createdAt: nowIso(),
      action: actionEl.value,
      item: itemEl?.value.trim() || undefined,
      approximateGameTime: timeEl?.value.trim() || undefined,
      note: noteEl?.value.trim() || undefined,
    };
    this.state.notes.push(note);
    this.state.updatedAt = nowIso();
    this.persist();

    if (itemEl) itemEl.value = '';
    if (timeEl) timeEl.value = '';
    if (noteEl) noteEl.value = '';
    this.refreshPanel();
  }

  private setManualSteamBuildId(value: string): void {
    this.state.manualSteamBuildId = value.trim() || undefined;
    this.state.updatedAt = nowIso();
    this.schedulePersist();
  }

  private clear(): void {
    const accepted = window.confirm('Clear all captured diagnostic events and notes?');
    if (!accepted) {
      return;
    }

    this.state = createInitialState(this.clientId, this.appSessionId);
    this.lastFingerprintByChannel.clear();
    this.estimatedChars = 0;
    this.persist();
    this.refreshPanel();
  }

  private exportArchive(): void {
    this.persist();

    const matchIds = Array.from(
      new Set(this.state.entries.map((entry) => entry.matchId).filter((value): value is string => !!value)),
    );
    const ndjson = this.state.entries.map((entry) => stringifyForStorage(entry)).join('\n');
    const sessionInfo = {
      schemaVersion: this.state.schemaVersion,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
      exportedAt: nowIso(),
      currentMatchId: this.state.currentMatchId,
      matchIds,
      manualSteamBuildId: this.state.manualSteamBuildId,
      truncated: this.state.truncated,
      entryCount: this.state.entries.length,
      appSessions: this.state.appSessions,
    };
    const versionCandidates = Array.from(
      this.state.entries.reduce((result, entry) => collectVersionCandidates(entry.rawPayload, result), new Set<string>()),
    ).sort();
    const steamBuildText = [
      `Manual Steam build ID: ${this.state.manualSteamBuildId || 'not provided'}`,
      '',
      'Detected build/version candidates:',
      ...(versionCandidates.length > 0 ? versionCandidates.map((candidate) => `- ${candidate}`) : ['- none']),
      '',
      'The raw running game information is also available in overwolf-events.ndjson.',
    ].join('\n');
    const readme = [
      'Deadlock Live Probe diagnostic capture',
      '',
      'Files:',
      '- overwolf-events.ndjson: deduplicated raw GEP values and startup snapshots.',
      '- session-info.json: capture metadata and match IDs.',
      '- notes.json: manually recorded actions and approximate game times.',
      '- steam-build.txt: manual Steam build ID and extraction note.',
      '',
      'Please upload the complete ZIP without editing the files.',
    ].join('\n');

    const zipBytes = createStoredZipBytes([
      { name: 'overwolf-events.ndjson', content: ndjson },
      { name: 'session-info.json', content: stringifyForStorage(sessionInfo, 2) },
      { name: 'notes.json', content: stringifyForStorage(this.state.notes, 2) },
      { name: 'steam-build.txt', content: steamBuildText },
      { name: 'README.txt', content: readme },
    ]);

    const blob = new Blob([zipBytes], { type: 'application/zip' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const matchLabel = matchIds.length === 1 ? matchIds[0] : matchIds.length > 1 ? 'multiple-matches' : 'unknown-match';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.href = objectUrl;
    anchor.download = `deadlock-diagnostics-${matchLabel}-${timestamp}.zip`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  private mountPanel(): void {
    if (document.getElementById('diagnostic-capture-panel')) {
      this.refreshPanel();
      return;
    }

    const style = document.createElement('style');
    style.textContent = `
      #diagnostic-capture-panel {
        border: 1px solid #3b3b4b;
        border-radius: 10px;
        background: #14141a;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-family: 'Outfit', sans-serif;
      }
      #diagnostic-capture-panel .diagnostic-row {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      #diagnostic-capture-panel .diagnostic-title {
        font-size: 12px;
        font-weight: 700;
        color: #ff6b4a;
        margin-right: auto;
      }
      #diagnostic-capture-panel .diagnostic-status {
        font-size: 11px;
        color: #9ca3af;
      }
      #diagnostic-capture-panel input,
      #diagnostic-capture-panel select,
      #diagnostic-capture-panel button {
        border: 1px solid #343444;
        border-radius: 5px;
        background: #1b1b22;
        color: #f3f4f6;
        padding: 5px 7px;
        font: inherit;
        font-size: 11px;
      }
      #diagnostic-capture-panel input {
        min-width: 90px;
        flex: 1;
      }
      #diagnostic-capture-panel button {
        cursor: pointer;
      }
      #diagnostic-capture-panel button.primary {
        background: #ff6b4a;
        border-color: #ff6b4a;
        color: #111;
        font-weight: 700;
      }
      #diagnostic-capture-panel button.danger {
        color: #f87171;
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.id = 'diagnostic-capture-panel';
    panel.innerHTML = `
      <div class="diagnostic-row">
        <span class="diagnostic-title">Diagnostic Capture</span>
        <span class="diagnostic-status" id="diagnostic-status"></span>
        <button type="button" class="primary" id="diagnostic-export">Export ZIP</button>
        <button type="button" class="danger" id="diagnostic-clear">Clear</button>
      </div>
      <div class="diagnostic-row">
        <input id="diagnostic-steam-build" placeholder="Steam build ID (optional)" />
        <select id="diagnostic-action">
          <option value="BUY">BUY</option>
          <option value="UPGRADE">UPGRADE</option>
          <option value="SELL">SELL</option>
          <option value="REBUY">REBUY</option>
          <option value="CONSUME">CONSUME</option>
          <option value="RECONNECT">RECONNECT</option>
          <option value="OTHER">OTHER</option>
        </select>
        <input id="diagnostic-item" placeholder="Item name" />
        <input id="diagnostic-game-time" placeholder="Game time MM:SS" />
        <input id="diagnostic-note" placeholder="Optional note" />
        <button type="button" id="diagnostic-add-note">Add marker</button>
      </div>
    `;

    const appLayout = document.querySelector('.app-layout');
    if (appLayout?.parentElement) {
      appLayout.parentElement.insertBefore(panel, appLayout);
    } else {
      document.body.prepend(panel);
    }

    document.getElementById('diagnostic-export')?.addEventListener('click', () => this.exportArchive());
    document.getElementById('diagnostic-clear')?.addEventListener('click', () => this.clear());
    document.getElementById('diagnostic-add-note')?.addEventListener('click', () => this.addNoteFromPanel());
    document.getElementById('diagnostic-steam-build')?.addEventListener('input', (event) => {
      this.setManualSteamBuildId((event.target as HTMLInputElement).value);
    });

    const buildInput = document.getElementById('diagnostic-steam-build') as HTMLInputElement | null;
    if (buildInput) {
      buildInput.value = this.state.manualSteamBuildId || '';
    }
    this.refreshPanel();
  }

  private refreshPanel(): void {
    const status = document.getElementById('diagnostic-status');
    if (!status) {
      return;
    }

    const approxKb = Math.round(this.estimatedChars / 1024);
    const matchId = this.state.currentMatchId || 'unknown';
    const truncated = this.state.truncated ? ' | TRUNCATED' : '';
    status.textContent = `match ${matchId} | ${this.state.entries.length} events | ${this.state.notes.length} markers | ~${approxKb} KB${truncated}`;
  }
}
