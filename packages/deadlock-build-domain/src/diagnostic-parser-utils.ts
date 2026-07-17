import { InventoryAction, InventoryItem, InventoryState } from './types';
import {
  DiagnosticEntry,
  DiagnosticGamePhase,
  DiagnosticIncomingDamageSnapshot,
  DiagnosticManualNote,
  DiagnosticParserDiagnostic,
  DiagnosticRosterPlayer,
  DiagnosticTeamScoreSnapshot,
} from './diagnostic-types';

export interface MarkerCandidate {
  note: DiagnosticManualNote;
  gameTimeSec?: number;
  createdAtMs?: number;
  deltaSec?: number;
}

export function compareDiagnosticEntries(left: DiagnosticEntry, right: DiagnosticEntry): number {
  if (left.id !== undefined && right.id !== undefined && left.id !== right.id) return left.id - right.id;
  const leftTime = Date.parse(left.receivedAt);
  const rightTime = Date.parse(right.receivedAt);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  return left.appSessionId.localeCompare(right.appSessionId);
}

export function parseNestedJson(value: unknown, depth = 0): unknown {
  if (depth >= 4 || typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return parseNestedJson(JSON.parse(trimmed), depth + 1);
  } catch {
    return value;
  }
}

export function resolveMatchId(entry: DiagnosticEntry): string | undefined {
  return normalizeMatchId(entry.matchId) ?? findMatchId(entry.key, parseNestedJson(entry.rawPayload));
}

export function parseSlot(key: string | undefined, prefix: string): number | undefined {
  if (!key?.startsWith(prefix)) return undefined;
  const slot = Number.parseInt(key.slice(prefix.length), 10);
  return Number.isSafeInteger(slot) && slot >= 0 ? slot : undefined;
}

export function parseRosterPlayer(slot: number, payload: unknown): DiagnosticRosterPlayer | undefined {
  const record = toRecord(payload);
  if (!record) return undefined;
  const steamId = getString(record, 'steam_id');
  return {
    slot,
    playerKey: createPlayerKey(slot, steamId),
    playerName: getString(record, 'player_name'),
    steamId,
    heroId: getNumber(record, 'hero_id'),
    heroName: getString(record, 'hero_name'),
    teamId: getNumber(record, 'team_id'),
    teamName: getString(record, 'team_name'),
    isLocal: getBoolean(record, 'is_local') ?? false,
  };
}

export function mergeRosterPlayer(
  existing: DiagnosticRosterPlayer | undefined,
  incoming: DiagnosticRosterPlayer,
): DiagnosticRosterPlayer {
  const steamId = incoming.steamId ?? existing?.steamId;
  return {
    slot: incoming.slot,
    playerKey: createPlayerKey(incoming.slot, steamId),
    playerName: incoming.playerName ?? existing?.playerName,
    steamId,
    heroId: incoming.heroId ?? existing?.heroId,
    heroName: incoming.heroName ?? existing?.heroName,
    teamId: incoming.teamId ?? existing?.teamId,
    teamName: incoming.teamName ?? existing?.teamName,
    isLocal: incoming.isLocal || existing?.isLocal || false,
  };
}

export function parseItemsPlayer(slot: number, payload: unknown): DiagnosticRosterPlayer | undefined {
  const record = toRecord(payload);
  if (!record) return undefined;
  const steamId = getString(record, 'steam_id');
  const playerName = getString(record, 'player_name');
  if (!steamId && !playerName) return undefined;
  return {
    slot,
    playerKey: createPlayerKey(slot, steamId),
    playerName,
    steamId,
    isLocal: false,
  };
}

export function createUnknownPlayer(slot: number, payload: unknown): DiagnosticRosterPlayer {
  const record = toRecord(payload) ?? {};
  const steamId = getString(record, 'steam_id');
  return {
    slot,
    playerKey: createPlayerKey(slot, steamId),
    playerName: getString(record, 'player_name'),
    steamId,
    isLocal: false,
  };
}

export function parseItemsSnapshot(
  payload: unknown,
  diagnostics: DiagnosticParserDiagnostic[],
  matchId: string,
  entrySequence: number,
): InventoryItem[] | undefined {
  const record = toRecord(payload);
  if (!record) {
    diagnostics.push({
      code: 'INVALID_ITEMS_PAYLOAD',
      message: `Entry ${entrySequence} items payload is not an object.`,
      matchId,
      entrySequence,
    });
    return undefined;
  }
  if (record.items === undefined || record.items === null) return [];
  if (!Array.isArray(record.items)) {
    diagnostics.push({
      code: 'INVALID_ITEMS_PAYLOAD',
      message: `Entry ${entrySequence} items field is not an array.`,
      matchId,
      entrySequence,
    });
    return undefined;
  }

  const items: InventoryItem[] = [];
  for (const rawItem of record.items) {
    const itemRecord = toRecord(rawItem);
    const itemId = itemRecord ? getNumber(itemRecord, 'id') : undefined;
    if (!itemRecord || !Number.isSafeInteger(itemId) || (itemId as number) <= 0) {
      diagnostics.push({
        code: 'INVALID_ITEM',
        message: `Entry ${entrySequence} contains an invalid item.`,
        matchId,
        entrySequence,
      });
      continue;
    }
    items.push({
      itemId: itemId as number,
      name: getString(itemRecord, 'name'),
      className: getString(itemRecord, 'class_name'),
      enhanced: getBoolean(itemRecord, 'enhanced'),
    });
  }
  return items;
}

export function parseIncomingDamage(
  payload: unknown,
  observedAtMs: number,
  gameTimeSec: number | undefined,
): DiagnosticIncomingDamageSnapshot | undefined {
  const record = toRecord(payload);
  if (!record) return undefined;
  const totalDamage = getNumber(record, 'total_damage');
  if (totalDamage === undefined) return undefined;
  const damageBySource: Record<string, number> = {};
  if (Array.isArray(record.damages)) {
    for (const rawDamage of record.damages) {
      const damage = toRecord(rawDamage);
      if (!damage) continue;
      const name = getString(damage, 'name');
      const amount = getNumber(damage, 'int');
      if (name && amount !== undefined) damageBySource[name] = amount;
    }
  }
  return {
    observedAtMs,
    gameTimeSec,
    timeFilterSec: getNumber(record, 'time_filter'),
    totalDamage,
    damageBySource,
  };
}

export function parseTeamScore(
  payload: unknown,
  observedAtMs: number,
  gameTimeSec: number | undefined,
): DiagnosticTeamScoreSnapshot | undefined {
  const record = toRecord(payload);
  if (!record) return undefined;
  const amber = getNumber(record, 'amber');
  const sapphire = getNumber(record, 'sapphire');
  return amber === undefined || sapphire === undefined
    ? undefined
    : { observedAtMs, gameTimeSec, amber, sapphire };
}

export function parseClockSeconds(payload: unknown): number | undefined {
  if (typeof payload === 'number' && Number.isFinite(payload) && payload >= 0) return payload;
  if (typeof payload !== 'string') return undefined;
  const parts = payload.trim().split(':').map((part) => Number.parseInt(part, 10));
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => Number.isNaN(part) || part < 0)) {
    return undefined;
  }
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function createDiagnosticInventoryStateKey(itemIds: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const itemId of itemIds) {
    if (!Number.isSafeInteger(itemId) || itemId <= 0) continue;
    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  if (!counts.size) return 'EMPTY';
  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([itemId, count]) => `${itemId}x${count}`)
    .join('|');
}

export function getDiagnosticGamePhase(gameTimeSec: number | undefined): DiagnosticGamePhase {
  if (gameTimeSec === undefined || !Number.isFinite(gameTimeSec) || gameTimeSec < 0) return 'UNKNOWN';
  if (gameTimeSec < 600) return 'EARLY';
  if (gameTimeSec < 1200) return 'MID';
  return 'LATE';
}

export function toMarkerCandidates(notes: readonly DiagnosticManualNote[]): MarkerCandidate[] {
  return notes.map((note) => ({
    note,
    gameTimeSec: parseClockSeconds(note.approximateGameTime),
    createdAtMs: validDateMs(note.createdAt),
  }));
}

export function findMarkerCandidate(
  candidates: readonly MarkerCandidate[],
  blockedIds: ReadonlySet<string>,
  ignoredIds: ReadonlySet<string>,
  acceptedActions: readonly string[],
  item: { itemId: number; name?: string; className?: string } | undefined,
  gameTimeSec: number | undefined,
  observedAtMs: number,
  toleranceSec: number,
): MarkerCandidate | undefined {
  if (!item) return undefined;
  const accepted = new Set(acceptedActions.map(normalizeMarkerAction));
  let best: MarkerCandidate | undefined;
  for (const candidate of candidates) {
    if (blockedIds.has(candidate.note.id) || ignoredIds.has(candidate.note.id)) continue;
    if (!accepted.has(normalizeMarkerAction(candidate.note.action))) continue;
    if (!markerItemMatches(candidate.note.item, item)) continue;
    const deltaSec = candidate.gameTimeSec !== undefined && gameTimeSec !== undefined
      ? Math.abs(candidate.gameTimeSec - gameTimeSec)
      : candidate.createdAtMs !== undefined
        ? Math.abs(candidate.createdAtMs - observedAtMs) / 1000
        : Number.POSITIVE_INFINITY;
    if (deltaSec > toleranceSec) continue;
    if (!best || deltaSec < (best.deltaSec ?? Number.POSITIVE_INFINITY)) best = { ...candidate, deltaSec };
  }
  return best;
}

export function normalizeMarkerAction(action: string): string {
  return action.trim().toUpperCase();
}

export function getActionItem(
  action: InventoryAction,
  beforeState: InventoryState,
): { itemId: number; name?: string; className?: string } | undefined {
  switch (action.type) {
    case 'BUY':
    case 'REBUY':
    case 'UPGRADE':
      return action.item;
    case 'SELL':
    case 'CONSUME':
    case 'USE':
    case 'HOLD':
      return beforeState.heldByItemId.get(action.itemId) ?? { itemId: action.itemId };
    case 'UNKNOWN_REMOVE': {
      const itemId = action.itemIds[0];
      return itemId === undefined ? undefined : beforeState.heldByItemId.get(itemId) ?? { itemId };
    }
    case 'RECONCILE':
      return undefined;
  }
}

export function findLatestSnapshot<T extends { observedAtMs: number }>(
  snapshots: readonly T[],
  observedAtMs: number,
): T | undefined {
  let latest: T | undefined;
  for (const snapshot of snapshots) {
    if (snapshot.observedAtMs <= observedAtMs && (!latest || snapshot.observedAtMs > latest.observedAtMs)) {
      latest = snapshot;
    }
  }
  return latest;
}

export function validDateMs(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findMatchId(key: string | undefined, value: unknown, depth = 0): string | undefined {
  if (key === 'match_id') return normalizeMatchId(value);
  if (depth > 8 || value === null || value === undefined) return undefined;
  if (typeof value === 'string') return findMatchId(undefined, parseNestedJson(value), depth + 1);
  if (typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const direct = normalizeMatchId(record.match_id) ?? normalizeMatchId(record.matchId);
  if (direct) return direct;
  for (const nested of Object.values(record)) {
    const matchId = findMatchId(undefined, nested, depth + 1);
    if (matchId) return matchId;
  }
  return undefined;
}

function normalizeMatchId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function createPlayerKey(slot: number, steamId: string | undefined): string {
  return steamId && steamId !== '0' ? steamId : `slot:${slot}`;
}

function markerItemMatches(
  markerItem: string | undefined,
  item: { itemId: number; name?: string; className?: string },
): boolean {
  if (!markerItem?.trim()) return true;
  const marker = normalizeLabel(markerItem);
  return [String(item.itemId), item.name, item.className]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizeLabel(value) === marker);
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}
