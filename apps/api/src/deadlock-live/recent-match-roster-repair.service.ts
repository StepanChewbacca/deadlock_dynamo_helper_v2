import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RawMatchMetadata } from './entities/raw-match-metadata.entity';
import { chunkValues } from './recent-matches-window.service';
import { RecentMatchesWindowService } from './recent-matches-window.service';
import { StoredMatchReprocessingService } from './stored-match-reprocessing.service';

export const RECENT_MATCH_ROSTER_REPAIR_QUERY_BATCH_SIZE = 200;
export const RECENT_MATCH_ROSTER_REPAIR_FAILURE_LIMIT = 20;

export type RecentMatchRosterRepairState = 'idle' | 'running' | 'completed' | 'failed';

export interface RecentMatchRosterRepairCandidate {
  matchId: number;
  rawMetadataId: number;
  currentPlayerCount: number;
  bestRawPlayerCount: number;
  missingPlayerCount: number;
}

export interface RecentMatchRosterRepairFailure {
  matchId: number;
  error: string;
}

export interface RecentMatchRosterRepairStatus {
  state: RecentMatchRosterRepairState;
  queryBatchSize: number;
  windowMatchCount: number;
  scannedMatchCount: number;
  repairCandidateCount: number;
  processedCandidateCount: number;
  repairedMatchCount: number;
  failedMatchCount: number;
  restoredPlayerCount: number;
  memoryWindowRefreshed: boolean;
  currentMatchId?: number;
  startedAt?: Date;
  finishedAt?: Date;
  lastSuccessfulRunAt?: Date;
  lastError?: string;
  recentFailures: RecentMatchRosterRepairFailure[];
}

interface RosterRepairCandidateRow {
  matchId?: unknown;
  rawMetadataId?: unknown;
  currentPlayerCount?: unknown;
  bestRawPlayerCount?: unknown;
}

const DISCOVER_REPAIR_CANDIDATES_SQL = `
  WITH current_rosters AS (
    SELECT
      "matchId",
      COUNT(DISTINCT "heroId") FILTER (WHERE "heroId" > 0)::int AS "currentPlayerCount"
    FROM "match_players"
    WHERE "matchId" = ANY($1::bigint[])
    GROUP BY "matchId"
  ),
  raw_counts AS (
    SELECT
      raw."matchId" AS "matchId",
      raw."id" AS "rawMetadataId",
      raw."fetchedAt" AS "fetchedAt",
      COUNT(
        DISTINCT CASE
          WHEN BTRIM(player.value->>'hero_id') ~ '^[1-9][0-9]*$'
          THEN BTRIM(player.value->>'hero_id')
        END
      )::int AS "bestRawPlayerCount"
    FROM "raw_match_metadata" raw
    LEFT JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(raw."payload"->'match_info'->'players') = 'array'
        THEN raw."payload"->'match_info'->'players'
        ELSE '[]'::jsonb
      END
    ) AS player(value) ON TRUE
    WHERE raw."matchId" = ANY($1::bigint[])
    GROUP BY raw."matchId", raw."id", raw."fetchedAt"
  ),
  ranked_raw AS (
    SELECT
      raw_counts.*,
      ROW_NUMBER() OVER (
        PARTITION BY "matchId"
        ORDER BY "bestRawPlayerCount" DESC, "fetchedAt" DESC, "rawMetadataId" DESC
      ) AS "rank"
    FROM raw_counts
  )
  SELECT
    ranked_raw."matchId" AS "matchId",
    ranked_raw."rawMetadataId" AS "rawMetadataId",
    COALESCE(current_rosters."currentPlayerCount", 0)::int AS "currentPlayerCount",
    ranked_raw."bestRawPlayerCount" AS "bestRawPlayerCount"
  FROM ranked_raw
  LEFT JOIN current_rosters ON current_rosters."matchId" = ranked_raw."matchId"
  WHERE ranked_raw."rank" = 1
    AND ranked_raw."bestRawPlayerCount" > COALESCE(current_rosters."currentPlayerCount", 0)
  ORDER BY ranked_raw."matchId" ASC
`;

@Injectable()
export class RecentMatchRosterRepairService {
  private readonly logger = new Logger(RecentMatchRosterRepairService.name);
  private runPromise?: Promise<void>;
  private status: RecentMatchRosterRepairStatus = createInitialRosterRepairStatus();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RawMatchMetadata)
    private readonly rawMatchMetadataRepository: Repository<RawMatchMetadata>,
    private readonly storedMatchReprocessingService: StoredMatchReprocessingService,
    private readonly recentMatchesWindowService: RecentMatchesWindowService,
  ) {}

  start(): RecentMatchRosterRepairStatus {
    if (this.runPromise) {
      return this.getStatus();
    }

    const lastSuccessfulRunAt = cloneDate(this.status.lastSuccessfulRunAt);
    this.status = {
      ...createInitialRosterRepairStatus(),
      state: 'running',
      startedAt: new Date(),
      lastSuccessfulRunAt,
    };

    this.runPromise = this.execute()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.status.state = 'failed';
        this.status.lastError = message;
        this.status.finishedAt = new Date();
        this.status.currentMatchId = undefined;
        this.logger.error(`Recent match roster repair failed: ${message}`);
      })
      .finally(() => {
        this.runPromise = undefined;
      });

    return this.getStatus();
  }

  getStatus(): RecentMatchRosterRepairStatus {
    return {
      ...this.status,
      startedAt: cloneDate(this.status.startedAt),
      finishedAt: cloneDate(this.status.finishedAt),
      lastSuccessfulRunAt: cloneDate(this.status.lastSuccessfulRunAt),
      recentFailures: this.status.recentFailures.map((failure) => ({ ...failure })),
    };
  }

  private async execute(): Promise<void> {
    let windowStatus = this.recentMatchesWindowService.getStatus();
    if (!windowStatus.lastRefreshedAt) {
      windowStatus = await this.recentMatchesWindowService.refresh();
    }

    const matchIds = this.recentMatchesWindowService.getMatchIds();
    this.status.windowMatchCount = matchIds.length;

    const candidates = await this.discoverCandidates(matchIds);
    this.status.repairCandidateCount = candidates.length;

    this.logger.log(
      `Found ${candidates.length} recent matches with a more complete raw roster ` +
        `after scanning ${matchIds.length} matches.`,
    );

    for (const candidate of candidates) {
      this.status.currentMatchId = candidate.matchId;

      try {
        const rawMetadata = await this.rawMatchMetadataRepository.findOne({
          where: { id: candidate.rawMetadataId },
        });
        if (!rawMetadata) {
          throw new Error(`Raw metadata row ${candidate.rawMetadataId} was not found.`);
        }

        const result = await this.storedMatchReprocessingService.reprocessRawMetadata(rawMetadata);
        this.status.repairedMatchCount += 1;
        this.status.restoredPlayerCount += calculateRestoredPlayerCount(
          candidate.currentPlayerCount,
          result.playersProcessed,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.status.failedMatchCount += 1;
        this.status.recentFailures.push({ matchId: candidate.matchId, error: message });
        if (this.status.recentFailures.length > RECENT_MATCH_ROSTER_REPAIR_FAILURE_LIMIT) {
          this.status.recentFailures.shift();
        }
        this.logger.warn(`Failed to repair roster for match ${candidate.matchId}: ${message}`);
      } finally {
        this.status.processedCandidateCount += 1;
      }
    }

    this.status.currentMatchId = undefined;
    if (this.status.repairedMatchCount > 0) {
      await this.recentMatchesWindowService.refresh();
      this.status.memoryWindowRefreshed = true;
    }

    const finishedAt = new Date();
    this.status.state = 'completed';
    this.status.finishedAt = finishedAt;
    this.status.lastSuccessfulRunAt = finishedAt;
    this.status.lastError = undefined;

    this.logger.log(
      `Recent match roster repair completed: ${this.status.repairedMatchCount} repaired, ` +
        `${this.status.restoredPlayerCount} players restored and ` +
        `${this.status.failedMatchCount} failures.`,
    );
  }

  private async discoverCandidates(
    matchIds: readonly number[],
  ): Promise<RecentMatchRosterRepairCandidate[]> {
    const candidates: RecentMatchRosterRepairCandidate[] = [];

    for (const batch of chunkValues([...matchIds], RECENT_MATCH_ROSTER_REPAIR_QUERY_BATCH_SIZE)) {
      const rows = (await this.dataSource.query(
        DISCOVER_REPAIR_CANDIDATES_SQL,
        [batch],
      )) as RosterRepairCandidateRow[];
      candidates.push(...parseRosterRepairCandidateRows(rows));
      this.status.scannedMatchCount += batch.length;
    }

    return candidates.sort((left, right) => left.matchId - right.matchId);
  }
}

export function parseRosterRepairCandidateRows(
  rows: readonly RosterRepairCandidateRow[],
): RecentMatchRosterRepairCandidate[] {
  const candidates: RecentMatchRosterRepairCandidate[] = [];

  for (const row of rows) {
    const matchId = toPositiveSafeInteger(row.matchId);
    const rawMetadataId = toPositiveSafeInteger(row.rawMetadataId);
    const currentPlayerCount = toNonNegativeSafeInteger(row.currentPlayerCount);
    const bestRawPlayerCount = toNonNegativeSafeInteger(row.bestRawPlayerCount);

    if (
      matchId === undefined ||
      rawMetadataId === undefined ||
      currentPlayerCount === undefined ||
      bestRawPlayerCount === undefined ||
      bestRawPlayerCount <= currentPlayerCount
    ) {
      continue;
    }

    candidates.push({
      matchId,
      rawMetadataId,
      currentPlayerCount,
      bestRawPlayerCount,
      missingPlayerCount: bestRawPlayerCount - currentPlayerCount,
    });
  }

  return candidates;
}

export function calculateRestoredPlayerCount(
  currentPlayerCount: number,
  processedPlayerCount: number,
): number {
  return Math.max(0, processedPlayerCount - currentPlayerCount);
}

function createInitialRosterRepairStatus(): RecentMatchRosterRepairStatus {
  return {
    state: 'idle',
    queryBatchSize: RECENT_MATCH_ROSTER_REPAIR_QUERY_BATCH_SIZE,
    windowMatchCount: 0,
    scannedMatchCount: 0,
    repairCandidateCount: 0,
    processedCandidateCount: 0,
    repairedMatchCount: 0,
    failedMatchCount: 0,
    restoredPlayerCount: 0,
    memoryWindowRefreshed: false,
    recentFailures: [],
  };
}

function toPositiveSafeInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function toNonNegativeSafeInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function cloneDate(value: Date | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}
