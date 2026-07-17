import { applyInventoryAction, createEmptyInventoryState, getHeldItemIds } from './inventory-reducer';
import { createRecipeGraph } from './recipe-graph';
import { normalizeInventorySnapshot } from './snapshot-normalizer';
import { InventoryAction, InventoryState, SnapshotRemovalDecision } from './types';
import {
  DiagnosticBuildActionType,
  DiagnosticEntry,
  DiagnosticIncomingDamageSnapshot,
  DiagnosticInventorySnapshot,
  DiagnosticManualNote,
  DiagnosticMarkerResult,
  DiagnosticNormalizedAction,
  DiagnosticParserDiagnostic,
  DiagnosticParserOptions,
  DiagnosticPlayerTimeline,
  DiagnosticRosterPlayer,
  DiagnosticTeamScoreSnapshot,
  DiagnosticTrainingExample,
  ParsedDiagnosticArchive,
  ParsedDiagnosticMatch,
} from './diagnostic-types';
import {
  MarkerCandidate,
  compareDiagnosticEntries,
  createDiagnosticInventoryStateKey,
  createUnknownPlayer,
  findLatestSnapshot,
  findMarkerCandidate,
  getActionItem,
  getDiagnosticGamePhase,
  mergeRosterPlayer,
  normalizeMarkerAction,
  parseClockSeconds,
  parseIncomingDamage,
  parseItemsPlayer,
  parseItemsSnapshot,
  parseNestedJson,
  parseRosterPlayer,
  parseSlot,
  parseTeamScore,
  resolveMatchId,
  toMarkerCandidates,
  validDateMs,
} from './diagnostic-parser-utils';
import { readDiagnosticArchiveFiles } from './diagnostic-zip';

export * from './diagnostic-types';
export { createDiagnosticInventoryStateKey, getDiagnosticGamePhase } from './diagnostic-parser-utils';
export { parseStoredZipFiles } from './diagnostic-zip';

interface EntryGroup {
  matchId: string;
  entries: DiagnosticEntry[];
}

interface MutableTimeline {
  slot: number;
  playerKey: string;
  state: InventoryState;
  snapshots: DiagnosticInventorySnapshot[];
  actions: DiagnosticNormalizedAction[];
  diagnostics: DiagnosticParserDiagnostic[];
}

const DEFAULT_MARKER_TOLERANCE_SEC = 8;
const BUILD_ACTION_TYPES = new Set<InventoryAction['type']>(['BUY', 'REBUY', 'UPGRADE', 'SELL']);

export function parseDiagnosticArchive(
  bytes: Uint8Array,
  options: Omit<DiagnosticParserOptions, 'manualNotes'> = {},
): ParsedDiagnosticArchive {
  const files = readDiagnosticArchiveFiles(bytes);
  if (!files.eventsNdjson) {
    return {
      sessionInfo: files.sessionInfo,
      matches: [],
      markerResults: [],
      diagnostics: files.diagnostics,
    };
  }
  const parsed = parseDiagnosticNdjson(files.eventsNdjson, {
    ...options,
    manualNotes: files.notes,
  });
  return {
    sessionInfo: files.sessionInfo,
    matches: parsed.matches,
    markerResults: parsed.markerResults,
    diagnostics: [...files.diagnostics, ...parsed.diagnostics],
  };
}

export function parseDiagnosticNdjson(
  ndjson: string,
  options: DiagnosticParserOptions = {},
): ParsedDiagnosticArchive {
  const diagnostics: DiagnosticParserDiagnostic[] = [];
  const entries = parseEntries(ndjson, diagnostics);
  const groups = groupEntries(entries, diagnostics);
  const notesByMatch = assignNotes(options.manualNotes ?? [], groups);
  const matches = groups.map((group) =>
    parseMatch(group.matchId, group.entries, {
      ...options,
      manualNotes: notesByMatch.get(group.matchId) ?? [],
    }),
  );
  return {
    matches,
    markerResults: matches.flatMap((match) => match.markerResults),
    diagnostics: [...diagnostics, ...matches.flatMap((match) => match.diagnostics)],
  };
}

function parseEntries(
  ndjson: string,
  diagnostics: DiagnosticParserDiagnostic[],
): DiagnosticEntry[] {
  const result: DiagnosticEntry[] = [];
  for (const [index, rawLine] of ndjson.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as DiagnosticEntry;
      if (!entry || typeof entry !== 'object') throw new Error('Entry is not an object.');
      result.push(entry);
    } catch (error) {
      diagnostics.push({
        code: 'INVALID_NDJSON_LINE',
        message: `Line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        lineNumber: index + 1,
      });
    }
  }
  return result;
}

function groupEntries(
  entries: readonly DiagnosticEntry[],
  diagnostics: DiagnosticParserDiagnostic[],
): EntryGroup[] {
  const groups = new Map<string, DiagnosticEntry[]>();
  const prelude: DiagnosticEntry[] = [];
  let currentMatchId: string | undefined;

  for (const entry of [...entries].sort(compareDiagnosticEntries)) {
    currentMatchId = resolveMatchId(entry) ?? currentMatchId;
    if (!currentMatchId) {
      prelude.push(entry);
      continue;
    }
    const matchEntries = groups.get(currentMatchId) ?? [];
    matchEntries.push(entry);
    groups.set(currentMatchId, matchEntries);
  }

  if (groups.size === 1 && prelude.length) {
    const [matchId, matchEntries] = [...groups.entries()][0];
    groups.set(matchId, [...prelude, ...matchEntries]);
  } else if (prelude.length) {
    diagnostics.push({
      code: 'MISSING_MATCH_ID',
      message: `${prelude.length} entries could not be assigned to a match.`,
    });
  }
  if (!groups.size && entries.length) {
    diagnostics.push({ code: 'MISSING_MATCH_ID', message: 'No match ID could be resolved.' });
    groups.set('unknown', [...entries]);
  }
  if (groups.size > 1) {
    diagnostics.push({
      code: 'MULTIPLE_MATCHES',
      message: `Diagnostic stream contains ${groups.size} matches.`,
    });
  }

  return [...groups.entries()].map(([matchId, matchEntries]) => ({
    matchId,
    entries: matchEntries,
  }));
}

function assignNotes(
  notes: readonly DiagnosticManualNote[],
  groups: readonly EntryGroup[],
): Map<string, DiagnosticManualNote[]> {
  const result = new Map<string, DiagnosticManualNote[]>();
  if (groups.length === 1) {
    result.set(groups[0].matchId, [...notes]);
    return result;
  }
  const windows = groups.map((group) => {
    const times = group.entries
      .map((entry) => validDateMs(entry.receivedAt))
      .filter((value): value is number => value !== undefined);
    return {
      matchId: group.matchId,
      start: times.length ? Math.min(...times) - 300_000 : Number.NEGATIVE_INFINITY,
      end: times.length ? Math.max(...times) + 300_000 : Number.POSITIVE_INFINITY,
    };
  });
  for (const note of notes) {
    const createdAtMs = validDateMs(note.createdAt);
    if (createdAtMs === undefined) continue;
    const window = windows.find((candidate) => createdAtMs >= candidate.start && createdAtMs <= candidate.end);
    if (!window) continue;
    result.set(window.matchId, [...(result.get(window.matchId) ?? []), note]);
  }
  return result;
}

function parseMatch(
  matchId: string,
  entries: readonly DiagnosticEntry[],
  options: DiagnosticParserOptions,
): ParsedDiagnosticMatch {
  const recipeGraph = options.recipeGraph ?? createRecipeGraph([]);
  const diagnostics: DiagnosticParserDiagnostic[] = [];
  const playersBySlot = new Map<number, DiagnosticRosterPlayer>();
  const timelinesBySlot = new Map<number, MutableTimeline>();
  const incomingDamage: DiagnosticIncomingDamageSnapshot[] = [];
  const teamScores: DiagnosticTeamScoreSnapshot[] = [];
  const ignoredIds = new Set(options.ignoredNoteIds ?? []);
  const markerCandidates = toMarkerCandidates(options.manualNotes ?? []);
  const usedMarkerIds = new Set<string>();
  const markerMatches = new Map<string, DiagnosticMarkerResult>();
  const toleranceSec = options.removalMarkerToleranceSec ?? DEFAULT_MARKER_TOLERANCE_SEC;
  const sortedEntries = [...entries].sort(compareDiagnosticEntries);
  let currentGameTimeSec: number | undefined;
  let localPlayerKey: string | undefined;
  let actionSequence = 0;

  for (const entry of sortedEntries) {
    const slot = parseSlot(entry.key, 'roster_');
    if (slot === undefined) continue;
    const player = parseRosterPlayer(slot, parseNestedJson(entry.rawPayload));
    if (!player) continue;
    const merged = mergeRosterPlayer(playersBySlot.get(slot), player);
    playersBySlot.set(slot, merged);
    if (merged.isLocal) localPlayerKey = merged.playerKey;
  }

  for (const entry of sortedEntries) {
    const observedAtMs = validDateMs(entry.receivedAt);
    if (observedAtMs === undefined) {
      diagnostics.push({
        code: 'INVALID_ENTRY_TIMESTAMP',
        message: `Entry ${entry.sequence} has invalid receivedAt: ${entry.receivedAt}.`,
        matchId,
        entrySequence: entry.sequence,
      });
      continue;
    }
    const payload = parseNestedJson(entry.rawPayload);
    if (entry.key === 'match_clock') {
      currentGameTimeSec = parseClockSeconds(payload) ?? currentGameTimeSec;
      continue;
    }
    if (entry.key === 'incoming_damage') {
      const snapshot = parseIncomingDamage(payload, observedAtMs, currentGameTimeSec);
      if (snapshot) incomingDamage.push(snapshot);
      continue;
    }
    if (entry.key === 'team_score') {
      const snapshot = parseTeamScore(payload, observedAtMs, currentGameTimeSec);
      if (snapshot) teamScores.push(snapshot);
      continue;
    }

    const rosterSlot = parseSlot(entry.key, 'roster_');
    if (rosterSlot !== undefined) {
      const player = parseRosterPlayer(rosterSlot, payload);
      if (!player) {
        diagnostics.push({
          code: 'INVALID_ROSTER_PAYLOAD',
          message: `Entry ${entry.sequence} has an invalid roster payload.`,
          matchId,
          entrySequence: entry.sequence,
        });
        continue;
      }
      const merged = mergeRosterPlayer(playersBySlot.get(rosterSlot), player);
      playersBySlot.set(rosterSlot, merged);
      if (merged.isLocal) localPlayerKey = merged.playerKey;
      continue;
    }

    const itemSlot = parseSlot(entry.key, 'items_');
    if (itemSlot === undefined) continue;
    const snapshotItems = parseItemsSnapshot(payload, diagnostics, matchId, entry.sequence);
    if (!snapshotItems) continue;

    const payloadPlayer = parseItemsPlayer(itemSlot, payload);
    if (payloadPlayer) {
      playersBySlot.set(itemSlot, mergeRosterPlayer(playersBySlot.get(itemSlot), payloadPlayer));
    }
    const player = playersBySlot.get(itemSlot) ?? createUnknownPlayer(itemSlot, payload);
    playersBySlot.set(itemSlot, player);
    if (player.isLocal) localPlayerKey = player.playerKey;

    const timeline = timelinesBySlot.get(itemSlot) ?? createTimeline(itemSlot, player.playerKey);
    timeline.playerKey = player.playerKey;
    const reservedRemovalMarkers = new Map<number, MarkerCandidate>();
    const classifyRemoval = (context: {
      removedItem: { itemId: number; name?: string; className?: string };
    }): SnapshotRemovalDecision => {
      if (!player.isLocal) return 'UNKNOWN_REMOVE';
      const blocked = new Set([
        ...usedMarkerIds,
        ...[...reservedRemovalMarkers.values()].map((candidate) => candidate.note.id),
      ]);
      const marker = findMarkerCandidate(
        markerCandidates,
        blocked,
        ignoredIds,
        ['SELL', 'CONSUME'],
        context.removedItem,
        currentGameTimeSec,
        observedAtMs,
        toleranceSec,
      );
      if (!marker) return 'UNKNOWN_REMOVE';
      reservedRemovalMarkers.set(context.removedItem.itemId, marker);
      return normalizeMarkerAction(marker.note.action) === 'CONSUME' ? 'CONSUME' : 'SELL';
    };

    const normalized = normalizeInventorySnapshot({
      state: timeline.state,
      snapshotItems,
      recipeGraph,
      observedAtMs,
      gameTimeSec: currentGameTimeSec,
      classifyRemoval,
    });
    for (const snapshotDiagnostic of normalized.diagnostics) {
      const diagnostic: DiagnosticParserDiagnostic = {
        code: 'SNAPSHOT_DIAGNOSTIC',
        message: `${snapshotDiagnostic.code}: ${snapshotDiagnostic.message}`,
        matchId,
        entrySequence: entry.sequence,
        playerKey: timeline.playerKey,
        itemIds: snapshotDiagnostic.itemIds,
      };
      timeline.diagnostics.push(diagnostic);
      diagnostics.push(diagnostic);
    }

    let replayState = timeline.state;
    for (const action of normalized.actions) {
      const beforeState = replayState;
      const item = getActionItem(action, beforeState);
      const applied = applyInventoryAction(beforeState, action, { recipeGraph });
      if (!applied.ok) {
        const diagnostic: DiagnosticParserDiagnostic = {
          code: 'INVENTORY_REDUCER_ERROR',
          message: `${applied.error.code}: ${applied.error.message}`,
          matchId,
          entrySequence: entry.sequence,
          playerKey: timeline.playerKey,
          itemIds: applied.error.itemIds,
        };
        timeline.diagnostics.push(diagnostic);
        diagnostics.push(diagnostic);
        continue;
      }
      replayState = applied.state;
      const reserved = item && (action.type === 'SELL' || action.type === 'CONSUME')
        ? reservedRemovalMarkers.get(item.itemId)
        : undefined;
      const marker = reserved ?? (player.isLocal
        ? findMarkerCandidate(
            markerCandidates,
            usedMarkerIds,
            ignoredIds,
            [action.type],
            item,
            currentGameTimeSec,
            observedAtMs,
            toleranceSec,
          )
        : undefined);
      const normalizedAction: DiagnosticNormalizedAction = {
        sequence: ++actionSequence,
        observedAtMs,
        gameTimeSec: currentGameTimeSec,
        type: action.type,
        action,
        itemId: item?.itemId,
        itemName: item?.name,
        beforeStateKey: createDiagnosticInventoryStateKey(getHeldItemIds(beforeState)),
        afterStateKey: createDiagnosticInventoryStateKey(getHeldItemIds(replayState)),
        markerId: marker?.note.id,
        markerConfirmed: Boolean(marker),
      };
      timeline.actions.push(normalizedAction);
      if (marker) {
        usedMarkerIds.add(marker.note.id);
        if (item) reservedRemovalMarkers.delete(item.itemId);
        markerMatches.set(marker.note.id, {
          note: marker.note,
          status: 'MATCHED',
          matchId,
          playerKey: timeline.playerKey,
          actionSequence: normalizedAction.sequence,
          timeDeltaSec: marker.deltaSec,
        });
      }
    }

    timeline.state = normalized.state;
    timeline.snapshots.push({
      observedAtMs,
      gameTimeSec: currentGameTimeSec,
      items: snapshotItems,
      itemIds: snapshotItems.map((item) => item.itemId).sort((left, right) => left - right),
    });
    timelinesBySlot.set(itemSlot, timeline);
  }

  const players = [...playersBySlot.values()].sort((left, right) => left.slot - right.slot);
  const timelines = buildTimelines(timelinesBySlot, playersBySlot);
  const markerResults = buildMarkerResults(
    markerCandidates,
    ignoredIds,
    markerMatches,
    matchId,
    diagnostics,
  );
  const trainingExamples = buildTrainingExamples(matchId, players, timelines, incomingDamage, teamScores);
  const entryTimes = sortedEntries
    .map((entry) => validDateMs(entry.receivedAt))
    .filter((value): value is number => value !== undefined);

  return {
    matchId,
    startedAtMs: entryTimes.length ? Math.min(...entryTimes) : undefined,
    endedAtMs: entryTimes.length ? Math.max(...entryTimes) : undefined,
    players,
    localPlayerKey,
    timelines,
    incomingDamage,
    teamScores,
    markerResults,
    trainingExamples,
    diagnostics,
  };
}

function createTimeline(slot: number, playerKey: string): MutableTimeline {
  return {
    slot,
    playerKey,
    state: createEmptyInventoryState(),
    snapshots: [],
    actions: [],
    diagnostics: [],
  };
}

function buildTimelines(
  timelinesBySlot: ReadonlyMap<number, MutableTimeline>,
  playersBySlot: ReadonlyMap<number, DiagnosticRosterPlayer>,
): DiagnosticPlayerTimeline[] {
  return [...timelinesBySlot.values()]
    .sort((left, right) => left.slot - right.slot)
    .map((timeline) => ({
      slot: timeline.slot,
      playerKey: timeline.playerKey,
      player: playersBySlot.get(timeline.slot) ?? createUnknownPlayer(timeline.slot, {}),
      snapshots: timeline.snapshots,
      actions: timeline.actions,
      finalStateKey: createDiagnosticInventoryStateKey(getHeldItemIds(timeline.state)),
      diagnostics: timeline.diagnostics,
    }));
}

function buildMarkerResults(
  candidates: readonly MarkerCandidate[],
  ignoredIds: ReadonlySet<string>,
  matched: ReadonlyMap<string, DiagnosticMarkerResult>,
  matchId: string,
  diagnostics: DiagnosticParserDiagnostic[],
): DiagnosticMarkerResult[] {
  return candidates.map(({ note }) => {
    if (ignoredIds.has(note.id)) return { note, status: 'IGNORED', matchId };
    const result = matched.get(note.id);
    if (result) return result;
    diagnostics.push({
      code: 'UNMATCHED_MARKER',
      message: `Marker ${note.id} (${note.action} ${note.item ?? ''}) did not match a telemetry action.`,
      matchId,
    });
    return { note, status: 'UNMATCHED', matchId };
  });
}

function buildTrainingExamples(
  matchId: string,
  players: readonly DiagnosticRosterPlayer[],
  timelines: readonly DiagnosticPlayerTimeline[],
  incomingDamage: readonly DiagnosticIncomingDamageSnapshot[],
  teamScores: readonly DiagnosticTeamScoreSnapshot[],
): DiagnosticTrainingExample[] {
  const examples: DiagnosticTrainingExample[] = [];
  for (const timeline of timelines) {
    const player = timeline.player;
    const enemyHeroIds = players
      .filter((candidate) =>
        candidate.heroId !== undefined &&
        player.teamId !== undefined &&
        candidate.teamId !== undefined &&
        candidate.teamId !== player.teamId,
      )
      .map((candidate) => candidate.heroId as number)
      .sort((left, right) => left - right);

    for (const action of timeline.actions) {
      if (!BUILD_ACTION_TYPES.has(action.type) || action.itemId === undefined) continue;
      const actionType = action.type as DiagnosticBuildActionType;
      const teamScore = findLatestSnapshot(teamScores, action.observedAtMs);
      const damage = player.isLocal ? findLatestSnapshot(incomingDamage, action.observedAtMs) : undefined;
      examples.push({
        matchId,
        playerKey: timeline.playerKey,
        slot: timeline.slot,
        isLocal: player.isLocal,
        heroId: player.heroId,
        teamId: player.teamId,
        enemyHeroIds,
        observedAtMs: action.observedAtMs,
        gameTimeSec: action.gameTimeSec,
        phase: getDiagnosticGamePhase(action.gameTimeSec),
        beforeStateKey: action.beforeStateKey,
        afterStateKey: action.afterStateKey,
        actionType,
        actionKey: `${actionType}:${action.itemId}`,
        itemId: action.itemId,
        itemName: action.itemName,
        markerConfirmed: action.markerConfirmed,
        teamScore: teamScore ? { amber: teamScore.amber, sapphire: teamScore.sapphire } : undefined,
        incomingDamage: damage ? {
          timeFilterSec: damage.timeFilterSec,
          totalDamage: damage.totalDamage,
          damageBySource: { ...damage.damageBySource },
        } : undefined,
      });
    }
  }
  return examples;
}
