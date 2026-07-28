import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import type {
  MatchTimelineObjectiveEvent,
  MatchTimelinePlayerSnapshot,
} from './match-timeline-collector.service';

export const RECOMMENDATION_HISTORICAL_POSTGRES_TIMELINE_CACHE_VERSION =
  'RECOMMENDATION_HISTORICAL_POSTGRES_TIMELINE_CACHE_1' as const;

const DEFAULT_TIMELINE_DIRECTORY =
  '/app/apps/api/storage/match-timeline-events-v1';
const RAW_METADATA_BATCH_SIZE = 250;

export interface RecommendationHistoricalPostgresTimelineData {
  snapshots: MatchTimelinePlayerSnapshot[];
  objectives: MatchTimelineObjectiveEvent[];
}

export interface RecommendationHistoricalPostgresTimelineCacheProgress {
  processedMatchCount: number;
  exportedMatchCount: number;
  playerSnapshotCount: number;
  objectiveEventCount: number;
  invalidPayloadCount: number;
}

export interface RecommendationHistoricalPostgresTimelineCacheManifest {
  schemaVersion: 1;
  cacheVersion: typeof RECOMMENDATION_HISTORICAL_POSTGRES_TIMELINE_CACHE_VERSION;
  state: 'COMPLETE';
  generatedAt: string;
  source: {
    table: 'raw_match_metadata';
    maximumRawMetadataId: number;
    maximumFetchedAt?: string;
  };
  artifact: {
    matchCount: number;
    playerSnapshotCount: number;
    objectiveEventCount: number;
    invalidPayloadCount: number;
  };
}

interface RawMetadataRow {
  id: number | string;
  matchId: number | string;
  payload: unknown;
  fetchedAt: Date | string;
}

@Injectable()
export class RecommendationHistoricalPostgresTimelineCacheService {
  private readonly logger = new Logger(
    RecommendationHistoricalPostgresTimelineCacheService.name,
  );
  private readonly timelineDirectory =
    process.env.DEADLOCK_TIMELINE_STORAGE_DIR?.trim() ||
    DEFAULT_TIMELINE_DIRECTORY;
  private readonly rootManifestPath = join(
    this.timelineDirectory,
    'postgres-cache-manifest.json',
  );

  constructor(private readonly dataSource: DataSource) {}

  async ensureCache(
    onProgress?: (
      progress: Readonly<RecommendationHistoricalPostgresTimelineCacheProgress>,
    ) => void,
  ): Promise<RecommendationHistoricalPostgresTimelineCacheManifest> {
    await mkdir(this.timelineDirectory, { recursive: true });
    const sourceBoundary = await this.loadSourceBoundary();
    if (sourceBoundary.maximumRawMetadataId <= 0) {
      throw new Error('PostgreSQL raw_match_metadata contains no rows.');
    }

    const existing = await readJson<RecommendationHistoricalPostgresTimelineCacheManifest>(
      this.rootManifestPath,
    );
    if (
      existing?.schemaVersion === 1 &&
      existing.cacheVersion ===
        RECOMMENDATION_HISTORICAL_POSTGRES_TIMELINE_CACHE_VERSION &&
      existing.state === 'COMPLETE' &&
      existing.source.maximumRawMetadataId ===
        sourceBoundary.maximumRawMetadataId &&
      existing.artifact.matchCount > 0
    ) {
      return existing;
    }

    const progress: RecommendationHistoricalPostgresTimelineCacheProgress = {
      processedMatchCount: 0,
      exportedMatchCount: 0,
      playerSnapshotCount: 0,
      objectiveEventCount: 0,
      invalidPayloadCount: 0,
    };
    let afterMatchId = 0;

    while (true) {
      const rows = await this.loadLatestRawMetadataBatch(
        afterMatchId,
        sourceBoundary.maximumRawMetadataId,
      );
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const matchId = positiveSafeInteger(row.matchId);
        if (matchId === undefined) {
          progress.invalidPayloadCount += 1;
          continue;
        }
        afterMatchId = Math.max(afterMatchId, matchId);
        progress.processedMatchCount += 1;

        const rawMetadataId = positiveSafeInteger(row.id) ?? 0;
        const fetchedAt = toIsoTimestamp(row.fetchedAt);
        const timeline = extractRecommendationHistoricalPostgresTimeline({
          matchId,
          payload: row.payload,
          fetchedAt,
          rawMetadataId,
        });
        if (timeline.snapshots.length === 0) {
          progress.invalidPayloadCount += 1;
          continue;
        }

        await this.writeMatchTimeline({
          matchId,
          rawMetadataId,
          fetchedAt,
          timeline,
        });
        progress.exportedMatchCount += 1;
        progress.playerSnapshotCount += timeline.snapshots.length;
        progress.objectiveEventCount += timeline.objectives.length;
      }

      onProgress?.({ ...progress });
      if (rows.length < RAW_METADATA_BATCH_SIZE) {
        break;
      }
    }

    if (progress.exportedMatchCount === 0) {
      throw new Error(
        'PostgreSQL raw_match_metadata produced no timeline-backed matches.',
      );
    }

    const manifest: RecommendationHistoricalPostgresTimelineCacheManifest = {
      schemaVersion: 1,
      cacheVersion:
        RECOMMENDATION_HISTORICAL_POSTGRES_TIMELINE_CACHE_VERSION,
      state: 'COMPLETE',
      generatedAt: new Date().toISOString(),
      source: {
        table: 'raw_match_metadata',
        maximumRawMetadataId: sourceBoundary.maximumRawMetadataId,
        maximumFetchedAt: sourceBoundary.maximumFetchedAt,
      },
      artifact: {
        matchCount: progress.exportedMatchCount,
        playerSnapshotCount: progress.playerSnapshotCount,
        objectiveEventCount: progress.objectiveEventCount,
        invalidPayloadCount: progress.invalidPayloadCount,
      },
    };
    await atomicJson(this.rootManifestPath, manifest);
    this.logger.log(
      `PostgreSQL historical timeline cache completed with ` +
        `${manifest.artifact.matchCount} matches and ` +
        `${manifest.artifact.playerSnapshotCount} player snapshots.`,
    );
    return manifest;
  }

  private async loadSourceBoundary(): Promise<{
    maximumRawMetadataId: number;
    maximumFetchedAt?: string;
  }> {
    const rows = (await this.dataSource.query(
      `
        SELECT
          COALESCE(MAX("id"), 0) AS "maximumRawMetadataId",
          MAX("fetchedAt") AS "maximumFetchedAt"
        FROM "raw_match_metadata"
      `,
    )) as Array<Record<string, unknown>>;
    const row = rows[0] ?? {};
    return {
      maximumRawMetadataId:
        positiveSafeInteger(row.maximumRawMetadataId) ?? 0,
      maximumFetchedAt:
        row.maximumFetchedAt === undefined || row.maximumFetchedAt === null
          ? undefined
          : toIsoTimestamp(row.maximumFetchedAt),
    };
  }

  private async loadLatestRawMetadataBatch(
    afterMatchId: number,
    maximumRawMetadataId: number,
  ): Promise<RawMetadataRow[]> {
    return (await this.dataSource.query(
      `
        SELECT DISTINCT ON ("matchId")
          "id",
          "matchId",
          "payload",
          "fetchedAt"
        FROM "raw_match_metadata"
        WHERE "matchId" > $1
          AND "id" <= $2
        ORDER BY "matchId" ASC, "fetchedAt" DESC, "id" DESC
        LIMIT $3
      `,
      [afterMatchId, maximumRawMetadataId, RAW_METADATA_BATCH_SIZE],
    )) as RawMetadataRow[];
  }

  private async writeMatchTimeline(input: {
    matchId: number;
    rawMetadataId: number;
    fetchedAt: string;
    timeline: RecommendationHistoricalPostgresTimelineData;
  }): Promise<void> {
    const directory = join(this.timelineDirectory, String(input.matchId));
    await mkdir(directory, { recursive: true });
    const snapshotsPath = join(directory, 'player-snapshots.ndjson');
    const objectivesPath = join(directory, 'objective-events.ndjson');
    const manifestPath = join(directory, 'manifest.json');
    const auditPath = join(directory, 'audit.json');
    const snapshotsRaw = toNdjson(input.timeline.snapshots);
    const objectivesRaw = toNdjson(input.timeline.objectives);

    await Promise.all([
      atomicText(snapshotsPath, snapshotsRaw),
      atomicText(objectivesPath, objectivesRaw),
    ]);
    const generatedAt = new Date().toISOString();
    await Promise.all([
      atomicJson(manifestPath, {
        schemaVersion: 1,
        timelineVersion: 'MATCH_TIMELINE_V1',
        generatedAt,
        matchId: input.matchId,
        source: 'POSTGRESQL_RAW_MATCH_METADATA',
        rawMetadataId: input.rawMetadataId,
        rawMetadataFetchedAt: input.fetchedAt,
        artifacts: {
          playerSnapshots: {
            fileName: 'player-snapshots.ndjson',
            rowCount: input.timeline.snapshots.length,
            byteLength: Buffer.byteLength(snapshotsRaw),
            sha256: sha256(snapshotsRaw),
          },
          objectives: {
            fileName: 'objective-events.ndjson',
            rowCount: input.timeline.objectives.length,
            byteLength: Buffer.byteLength(objectivesRaw),
            sha256: sha256(objectivesRaw),
          },
        },
      }),
      atomicJson(auditPath, {
        schemaVersion: 1,
        timelineVersion: 'MATCH_TIMELINE_V1',
        generatedAt,
        matchId: input.matchId,
        passed: input.timeline.snapshots.length > 0,
        source: 'POSTGRESQL_RAW_MATCH_METADATA',
        playerSnapshotCount: input.timeline.snapshots.length,
        objectiveEventCount: input.timeline.objectives.length,
        reasons:
          input.timeline.snapshots.length > 0
            ? []
            : ['Raw metadata contains no valid player timeline snapshots.'],
      }),
    ]);
  }
}

export function extractRecommendationHistoricalPostgresTimeline(input: {
  matchId: number;
  payload: unknown;
  fetchedAt: string;
  rawMetadataId: number;
}): RecommendationHistoricalPostgresTimelineData {
  const payload = record(input.payload);
  const matchInfo = record(payload?.match_info);
  const players = records(matchInfo?.players);
  const snapshots: MatchTimelinePlayerSnapshot[] = [];

  for (const player of players) {
    const heroId = positiveSafeInteger(player.hero_id);
    if (heroId === undefined) {
      continue;
    }
    const sourceTeam = nonNegativeSafeInteger(player.team);
    const teamId = sourceTeam === undefined ? undefined : liveTeamId(sourceTeam);
    const accountId = positiveSafeInteger(player.account_id);
    const playerSlot = nonNegativeSafeInteger(player.player_slot);
    const steamId = String(
      accountId ?? playerSlot ?? `${heroId}:${sourceTeam ?? -1}`,
    );
    const playerStats = records(player.stats);

    for (let index = 0; index < playerStats.length; index += 1) {
      const stats = playerStats[index];
      const gameTimeS = nonNegativeFiniteNumber(
        stats.time_stamp_s ??
          stats.timestamp_s ??
          stats.game_time_s ??
          stats.game_time_sec,
      );
      if (gameTimeS === undefined) {
        continue;
      }
      const snapshotIdentity = {
        source: 'POSTGRESQL_RAW_MATCH_METADATA',
        rawMetadataId: input.rawMetadataId,
        matchId: input.matchId,
        heroId,
        teamId,
        accountId,
        playerSlot,
        gameTimeS,
        index,
      };
      const identitySha = createHash('sha256')
        .update(JSON.stringify(snapshotIdentity))
        .digest('hex');
      snapshots.push({
        schemaVersion: 1,
        timelineVersion: 'MATCH_TIMELINE_V1',
        snapshotId: `postgres-${identitySha.slice(0, 24)}`,
        sourceEventId: `postgres-${identitySha}`,
        matchId: input.matchId,
        gameTimeS,
        tick: Math.max(0, Math.round(gameTimeS * 60)),
        steamId,
        heroId,
        teamId,
        kills: nonNegativeFiniteNumber(stats.kills) ?? 0,
        deaths: nonNegativeFiniteNumber(stats.deaths) ?? 0,
        assists: nonNegativeFiniteNumber(stats.assists) ?? 0,
        netWorth: nonNegativeFiniteNumber(stats.net_worth) ?? 0,
        heroDamage:
          nonNegativeFiniteNumber(stats.player_damage ?? stats.hero_damage) ?? 0,
        maxHealth: nonNegativeFiniteNumber(stats.max_health),
        level: nonNegativeFiniteNumber(stats.level),
        receivedAt: input.fetchedAt,
      });
    }
  }

  const objectives = records(matchInfo?.objectives).flatMap(
    (objective, index): MatchTimelineObjectiveEvent[] => {
      const objectiveId = nonNegativeSafeInteger(
        objective.legacy_objective_id ?? objective.objective_id,
      );
      const gameTimeS = nonNegativeFiniteNumber(
        objective.destroyed_time_s ?? objective.game_time_s,
      );
      if (
        objectiveId === undefined ||
        gameTimeS === undefined ||
        gameTimeS <= 0
      ) {
        return [];
      }
      const identitySha = createHash('sha256')
        .update(
          JSON.stringify({
            source: 'POSTGRESQL_RAW_MATCH_METADATA',
            rawMetadataId: input.rawMetadataId,
            matchId: input.matchId,
            objectiveId,
            gameTimeS,
            index,
          }),
        )
        .digest('hex');
      return [
        {
          schemaVersion: 1,
          timelineVersion: 'MATCH_TIMELINE_V1',
          objectiveEventId: `postgres-objective-${identitySha}`,
          sourceEventId: `postgres-objective-${identitySha}`,
          matchId: input.matchId,
          gameTimeS,
          tick: Math.max(0, Math.round(gameTimeS * 60)),
          eventName: 'objective_destroyed',
          objectiveType: `legacy_objective_${objectiveId}`,
          entityIndex: objectiveId,
          teamId: objectiveOwnerTeamId(objectiveId),
          receivedAt: input.fetchedAt,
        },
      ];
    },
  );

  return {
    snapshots: deduplicateSnapshots(snapshots),
    objectives: objectives.sort(
      (left, right) =>
        left.gameTimeS - right.gameTimeS ||
        left.objectiveEventId.localeCompare(right.objectiveEventId),
    ),
  };
}

function deduplicateSnapshots(
  snapshots: readonly MatchTimelinePlayerSnapshot[],
): MatchTimelinePlayerSnapshot[] {
  const byPlayerTime = new Map<string, MatchTimelinePlayerSnapshot>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.matchId}:${snapshot.heroId}:${snapshot.teamId ?? -1}:${snapshot.gameTimeS}`;
    byPlayerTime.set(key, snapshot);
  }
  return [...byPlayerTime.values()].sort(
    (left, right) =>
      left.gameTimeS - right.gameTimeS ||
      left.heroId - right.heroId ||
      (left.teamId ?? -1) - (right.teamId ?? -1) ||
      left.snapshotId.localeCompare(right.snapshotId),
  );
}

function objectiveOwnerTeamId(objectiveId: number): number | undefined {
  if (objectiveId >= 0 && objectiveId <= 15) {
    return 2;
  }
  if (objectiveId >= 16 && objectiveId <= 31) {
    return 3;
  }
  return undefined;
}

function liveTeamId(team: number): number {
  if (team === 0) {
    return 2;
  }
  if (team === 1) {
    return 3;
  }
  return team;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
    : [];
}

function nonNegativeFiniteNumber(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : undefined;
}

function positiveSafeInteger(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toIsoTimestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error('raw_match_metadata fetchedAt is invalid.');
  }
  return date.toISOString();
}

function toNdjson(values: readonly unknown[]): string {
  return values.length === 0
    ? ''
    : `${values.map((value) => JSON.stringify(value)).join('\n')}\n`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await atomicText(path, `${JSON.stringify(value, undefined, 2)}\n`);
}

async function atomicText(path: string, value: string): Promise<void> {
  const partial = `${path}.partial`;
  await writeFile(partial, value, 'utf8');
  await rename(partial, path);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return (
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
