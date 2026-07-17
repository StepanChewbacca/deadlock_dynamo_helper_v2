import { InventoryAction, InventoryItem, RecipeGraph } from './types';

export type DiagnosticEntrySource =
  | 'onInfoUpdates2'
  | 'onNewEvents'
  | 'getInfo'
  | 'runningGameInfo'
  | 'manifest'
  | 'system';

export interface DiagnosticEntry {
  id?: number;
  sequence: number;
  appSessionId: string;
  receivedAt: string;
  source: DiagnosticEntrySource;
  matchId?: string;
  feature?: string;
  category?: string;
  key?: string;
  rawPayload: unknown;
}

export interface DiagnosticManualNote {
  id: string;
  createdAt: string;
  approximateGameTime?: string;
  action: string;
  item?: string;
  note?: string;
}

export interface DiagnosticSessionInfo {
  schemaVersion?: number;
  currentMatchId?: string;
  matchIds?: string[];
  truncated?: boolean;
  legacyTruncated?: boolean;
  storageStatus?: string;
  storageError?: string;
  entryCount?: number;
  persistedEntryCount?: number;
  memoryFallbackEntryCount?: number;
  [key: string]: unknown;
}

export interface DiagnosticRosterPlayer {
  slot: number;
  playerKey: string;
  playerName?: string;
  steamId?: string;
  heroId?: number;
  heroName?: string;
  teamId?: number;
  teamName?: string;
  isLocal: boolean;
}

export interface DiagnosticInventorySnapshot {
  observedAtMs: number;
  gameTimeSec?: number;
  itemIds: number[];
  items: InventoryItem[];
}

export type DiagnosticBuildActionType = 'BUY' | 'REBUY' | 'UPGRADE' | 'SELL';

export interface DiagnosticNormalizedAction {
  sequence: number;
  observedAtMs: number;
  gameTimeSec?: number;
  type: InventoryAction['type'];
  action: InventoryAction;
  itemId?: number;
  itemName?: string;
  beforeStateKey: string;
  afterStateKey: string;
  markerId?: string;
  markerConfirmed: boolean;
}

export interface DiagnosticPlayerTimeline {
  slot: number;
  playerKey: string;
  player: DiagnosticRosterPlayer;
  snapshots: DiagnosticInventorySnapshot[];
  actions: DiagnosticNormalizedAction[];
  finalStateKey: string;
  diagnostics: DiagnosticParserDiagnostic[];
}

export interface DiagnosticIncomingDamageSnapshot {
  observedAtMs: number;
  gameTimeSec?: number;
  timeFilterSec?: number;
  totalDamage: number;
  damageBySource: Record<string, number>;
}

export interface DiagnosticTeamScoreSnapshot {
  observedAtMs: number;
  gameTimeSec?: number;
  amber: number;
  sapphire: number;
}

export type DiagnosticGamePhase = 'EARLY' | 'MID' | 'LATE' | 'UNKNOWN';

export interface DiagnosticTrainingExample {
  matchId: string;
  playerKey: string;
  slot: number;
  isLocal: boolean;
  heroId?: number;
  teamId?: number;
  enemyHeroIds: number[];
  observedAtMs: number;
  gameTimeSec?: number;
  phase: DiagnosticGamePhase;
  beforeStateKey: string;
  afterStateKey: string;
  actionType: DiagnosticBuildActionType;
  actionKey: string;
  itemId: number;
  itemName?: string;
  markerConfirmed: boolean;
  teamScore?: { amber: number; sapphire: number };
  incomingDamage?: {
    timeFilterSec?: number;
    totalDamage: number;
    damageBySource: Record<string, number>;
  };
}

export type DiagnosticMarkerStatus = 'MATCHED' | 'UNMATCHED' | 'IGNORED';

export interface DiagnosticMarkerResult {
  note: DiagnosticManualNote;
  status: DiagnosticMarkerStatus;
  matchId: string;
  playerKey?: string;
  actionSequence?: number;
  timeDeltaSec?: number;
}

export type DiagnosticParserDiagnosticCode =
  | 'INVALID_NDJSON_LINE'
  | 'INVALID_ENTRY_TIMESTAMP'
  | 'MULTIPLE_MATCHES'
  | 'MISSING_MATCH_ID'
  | 'INVALID_ROSTER_PAYLOAD'
  | 'INVALID_ITEMS_PAYLOAD'
  | 'INVALID_ITEM'
  | 'INVENTORY_REDUCER_ERROR'
  | 'SNAPSHOT_DIAGNOSTIC'
  | 'UNMATCHED_MARKER'
  | 'INVALID_ARCHIVE'
  | 'MISSING_ARCHIVE_FILE';

export interface DiagnosticParserDiagnostic {
  code: DiagnosticParserDiagnosticCode;
  message: string;
  matchId?: string;
  entrySequence?: number;
  lineNumber?: number;
  playerKey?: string;
  itemIds?: number[];
}

export interface ParsedDiagnosticMatch {
  matchId: string;
  startedAtMs?: number;
  endedAtMs?: number;
  players: DiagnosticRosterPlayer[];
  localPlayerKey?: string;
  timelines: DiagnosticPlayerTimeline[];
  incomingDamage: DiagnosticIncomingDamageSnapshot[];
  teamScores: DiagnosticTeamScoreSnapshot[];
  markerResults: DiagnosticMarkerResult[];
  trainingExamples: DiagnosticTrainingExample[];
  diagnostics: DiagnosticParserDiagnostic[];
}

export interface ParsedDiagnosticArchive {
  sessionInfo?: DiagnosticSessionInfo;
  matches: ParsedDiagnosticMatch[];
  markerResults: DiagnosticMarkerResult[];
  diagnostics: DiagnosticParserDiagnostic[];
}

export interface DiagnosticParserOptions {
  recipeGraph?: RecipeGraph;
  manualNotes?: readonly DiagnosticManualNote[];
  ignoredNoteIds?: readonly string[];
  removalMarkerToleranceSec?: number;
}
