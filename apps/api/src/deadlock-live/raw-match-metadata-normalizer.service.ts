import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RawMatchMetadata } from './entities/raw-match-metadata.entity';
import {
  RulesetResolutionResult,
} from './ruleset-resolver.service';
import { RulesetResolutionRefreshService } from './ruleset-resolution-refresh.service';

export const RAW_MATCH_METADATA_NORMALIZATION_VERSION = 'raw-match-metadata-v2';
const DEFAULT_NORMALIZATION_LIMIT = 100;
const MAX_NORMALIZATION_LIMIT = 1000;

export class NormalizeRawMatchMetadataDto {
  limit?: number;
  afterId?: number;
  force?: boolean;
  resolveRuleset?: boolean;
}

export interface NumericFieldCandidate {
  value: number;
  path: string;
}

export interface NormalizedRawMatchMetadataSummary {
  metadataVersion?: NumericFieldCandidate;
  clientVersion?: NumericFieldCandidate;
  gameMode?: NumericFieldCandidate;
  matchMode?: NumericFieldCandidate;
  gameModeVersion?: NumericFieldCandidate;
  matchStartTime?: NumericFieldCandidate;
  playerCount: number;
  hasMatchInfo: boolean;
}

export interface RawMatchMetadataNormalizationResult {
  matchId: number;
  rawMetadataId: number;
  normalizationVersion: string;
  normalizedAt: Date;
  metadataVersion?: number;
  clientVersion?: number;
  gameMode?: number;
  matchMode?: number;
  gameModeVersion?: number;
  matchStartTime?: Date;
  playerCount: number;
  ruleset?: RulesetResolutionResult;
}

@Injectable()
export class RawMatchMetadataNormalizerService {
  constructor(
    @InjectRepository(RawMatchMetadata)
    private readonly rawMetadataRepository: Repository<RawMatchMetadata>,
    private readonly rulesetResolutionRefreshService: RulesetResolutionRefreshService,
  ) {}

  async normalizeLatestForMatch(
    matchId: number,
    resolveRuleset = true,
  ): Promise<RawMatchMetadataNormalizationResult> {
    const rawMetadata = await this.rawMetadataRepository.findOne({
      where: { matchId },
      order: { fetchedAt: 'DESC', id: 'DESC' },
    });
    if (!rawMetadata) {
      throw new Error(`No raw metadata found for match ${matchId}`);
    }

    return this.normalizeRawMetadata(rawMetadata, resolveRuleset);
  }

  async normalizeRawMetadata(
    rawMetadata: RawMatchMetadata,
    resolveRuleset = true,
  ): Promise<RawMatchMetadataNormalizationResult> {
    const summary = extractNormalizedRawMatchMetadataSummary(rawMetadata.payload);
    const normalizedAt = new Date();
    const matchStartTime = summary.matchStartTime
      ? toDateFromUnixValue(summary.matchStartTime.value)
      : undefined;
    const normalizationDetails = {
      hasMatchInfo: summary.hasMatchInfo,
      playerCount: summary.playerCount,
      sourcePaths: {
        metadataVersion: summary.metadataVersion?.path,
        clientVersion: summary.clientVersion?.path,
        gameMode: summary.gameMode?.path,
        matchMode: summary.matchMode?.path,
        gameModeVersion: summary.gameModeVersion?.path,
        matchStartTime: summary.matchStartTime?.path,
      },
      matchStartTime: matchStartTime?.toISOString(),
    };
    const update = {
      metadataVersion: summary.metadataVersion?.value ?? null,
      clientVersion: summary.clientVersion?.value ?? null,
      gameMode: summary.gameMode?.value ?? null,
      matchMode: summary.matchMode?.value ?? null,
      gameModeVersion: summary.gameModeVersion?.value ?? null,
      normalizationVersion: RAW_MATCH_METADATA_NORMALIZATION_VERSION,
      normalizationDetails,
      normalizedAt,
    } as unknown as Partial<RawMatchMetadata>;

    await this.rawMetadataRepository.update(rawMetadata.id, update as any);
    Object.assign(rawMetadata, update);

    const ruleset = resolveRuleset
      ? await this.rulesetResolutionRefreshService.resolveRawMetadata(rawMetadata)
      : undefined;

    return {
      matchId: Number(rawMetadata.matchId),
      rawMetadataId: rawMetadata.id,
      normalizationVersion: RAW_MATCH_METADATA_NORMALIZATION_VERSION,
      normalizedAt,
      metadataVersion: summary.metadataVersion?.value,
      clientVersion: ruleset?.clientVersion ?? summary.clientVersion?.value,
      gameMode: summary.gameMode?.value,
      matchMode: summary.matchMode?.value,
      gameModeVersion: summary.gameModeVersion?.value,
      matchStartTime,
      playerCount: summary.playerCount,
      ruleset,
    };
  }

  async normalizePending(dto: NormalizeRawMatchMetadataDto = {}) {
    const limit = normalizeNormalizationLimit(dto.limit);
    const afterId = normalizeCursor(dto.afterId);
    const query = this.rawMetadataRepository
      .createQueryBuilder('raw')
      .where('raw.id > :afterId', { afterId })
      .orderBy('raw.id', 'ASC')
      .take(limit);

    if (dto.force !== true) {
      query.andWhere('raw.normalizationVersion IS DISTINCT FROM :normalizationVersion', {
        normalizationVersion: RAW_MATCH_METADATA_NORMALIZATION_VERSION,
      });
    }

    const rows = await query.getMany();
    const results: Array<
      | { status: 'normalized'; result: RawMatchMetadataNormalizationResult }
      | { status: 'failed'; matchId: number; rawMetadataId: number; error: string }
    > = [];

    for (const row of rows) {
      try {
        results.push({
          status: 'normalized',
          result: await this.normalizeRawMetadata(row, dto.resolveRuleset !== false),
        });
      } catch (error) {
        results.push({
          status: 'failed',
          matchId: Number(row.matchId),
          rawMetadataId: row.id,
          error: (error as Error).message,
        });
      }
    }

    return {
      requestedLimit: limit,
      processed: results.length,
      normalized: results.filter((entry) => entry.status === 'normalized').length,
      failed: results.filter((entry) => entry.status === 'failed').length,
      nextAfterId: rows.length > 0 ? rows[rows.length - 1].id : afterId,
      hasMore: rows.length === limit,
      normalizationVersion: RAW_MATCH_METADATA_NORMALIZATION_VERSION,
      results,
    };
  }
}

export function extractNormalizedRawMatchMetadataSummary(
  payload: Record<string, unknown>,
): NormalizedRawMatchMetadataSummary {
  const matchInfo = toRecord(payload.match_info);
  const players = Array.isArray(matchInfo?.players) ? matchInfo.players : [];

  return {
    metadataVersion: readNumericCandidate(payload, [
      ['metadata_version'],
      ['version'],
      ['metadata', 'metadata_version'],
      ['metadata', 'version'],
    ]),
    clientVersion: readNumericCandidate(payload, [
      ['client_version'],
      ['match_info', 'client_version'],
    ]),
    gameMode: readNumericCandidate(payload, [
      ['match_info', 'game_mode'],
      ['game_mode'],
      ['metadata', 'game_mode'],
    ]),
    matchMode: readNumericCandidate(payload, [
      ['match_info', 'match_mode'],
      ['match_mode'],
      ['metadata', 'match_mode'],
    ]),
    gameModeVersion: readNumericCandidate(payload, [
      ['match_info', 'game_mode_version'],
      ['game_mode_version'],
      ['metadata', 'game_mode_version'],
    ]),
    matchStartTime: readNumericCandidate(payload, [
      ['match_info', 'start_time'],
      ['start_time'],
    ]),
    playerCount: players.length,
    hasMatchInfo: matchInfo !== undefined,
  };
}

export function normalizeNormalizationLimit(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) {
    return DEFAULT_NORMALIZATION_LIMIT;
  }
  return Math.min(value, MAX_NORMALIZATION_LIMIT);
}

export function toDateFromUnixValue(value: number): Date | undefined {
  const timestampMs = value > 10_000_000_000 ? value : value * 1000;
  const date = new Date(timestampMs);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeCursor(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function readNumericCandidate(
  payload: Record<string, unknown>,
  paths: string[][],
): NumericFieldCandidate | undefined {
  for (const path of paths) {
    const value = readPath(payload, path);
    const numeric = toFiniteNumber(value);
    if (numeric !== undefined) {
      return { value: numeric, path: path.join('.') };
    }
  }
  return undefined;
}

function readPath(payload: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = payload;
  for (const segment of path) {
    const record = toRecord(current);
    if (!record) {
      return undefined;
    }
    current = record[segment];
  }
  return current;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
