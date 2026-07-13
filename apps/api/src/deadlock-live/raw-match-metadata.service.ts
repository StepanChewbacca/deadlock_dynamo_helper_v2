import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosResponse } from 'axios';
import { Repository } from 'typeorm';
import {
  RawMatchMetadata,
  RulesetResolutionMethod,
} from './entities/raw-match-metadata.entity';
import { RawMatchMetadataNormalizerService } from './raw-match-metadata-normalizer.service';
import { sha256StableJson } from './stable-json';

const MATCH_METADATA_SOURCE = 'deadlock-api-match-metadata';
const MATCH_METADATA_URL_PATTERN = /\/v1\/matches\/(\d+)\/metadata(?:\?|$)/;

export interface RawMatchMetadataSummary {
  metadataVersion?: number;
  clientVersion?: number;
  gameMode?: number;
  matchMode?: number;
  gameModeVersion?: number;
  rulesetResolutionMethod: RulesetResolutionMethod;
  rulesetResolutionConfidence: number;
}

export function extractMatchIdFromMetadataUrl(url: string | undefined): number | undefined {
  if (!url) {
    return undefined;
  }

  const match = MATCH_METADATA_URL_PATTERN.exec(url);
  if (!match) {
    return undefined;
  }

  const matchId = Number(match[1]);
  return Number.isSafeInteger(matchId) ? matchId : undefined;
}

export function summarizeRawMatchMetadata(payload: Record<string, unknown>): RawMatchMetadataSummary {
  const matchInfo = toRecord(payload.match_info);
  const clientVersion =
    getNumericValue(payload, 'client_version') ?? getNumericValue(matchInfo, 'client_version');

  return {
    metadataVersion:
      getNumericValue(payload, 'metadata_version') ?? getNumericValue(payload, 'version'),
    clientVersion,
    gameMode: getNumericValue(matchInfo, 'game_mode') ?? getNumericValue(payload, 'game_mode'),
    matchMode: getNumericValue(matchInfo, 'match_mode') ?? getNumericValue(payload, 'match_mode'),
    gameModeVersion:
      getNumericValue(matchInfo, 'game_mode_version') ??
      getNumericValue(payload, 'game_mode_version'),
    rulesetResolutionMethod: clientVersion === undefined ? 'UNKNOWN' : 'OBSERVED',
    rulesetResolutionConfidence: clientVersion === undefined ? 0 : 1,
  };
}

export function hashRawMatchMetadata(payload: Record<string, unknown>): string {
  return sha256StableJson(payload);
}

export function countValidUniquePlayerHeroes(payload: Record<string, unknown>): number {
  const matchInfo = toRecord(payload.match_info);
  const players = Array.isArray(matchInfo?.players) ? matchInfo.players : [];
  const heroIds = new Set<number>();

  for (const entry of players) {
    const player = toRecord(entry);
    const heroId = getNumericValue(player, 'hero_id');
    if (heroId !== undefined && heroId > 0) {
      heroIds.add(heroId);
    }
  }

  return heroIds.size;
}

export function selectBestRawMatchMetadata(
  candidates: readonly RawMatchMetadata[],
): RawMatchMetadata | undefined {
  let best: RawMatchMetadata | undefined;
  let bestPlayerCount = -1;

  for (const candidate of candidates) {
    const playerCount = countValidUniquePlayerHeroes(candidate.payload);
    if (playerCount > bestPlayerCount) {
      best = candidate;
      bestPlayerCount = playerCount;
    }
  }

  return best;
}

@Injectable()
export class RawMatchMetadataService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RawMatchMetadataService.name);
  private interceptorId?: number;

  constructor(
    @InjectRepository(RawMatchMetadata)
    private readonly rawMatchMetadataRepository: Repository<RawMatchMetadata>,
    private readonly rawMatchMetadataNormalizerService: RawMatchMetadataNormalizerService,
  ) {}

  onModuleInit(): void {
    this.interceptorId = axios.interceptors.response.use(async (response) => {
      await this.captureAxiosResponse(response);
      return response;
    });
  }

  onModuleDestroy(): void {
    if (this.interceptorId !== undefined) {
      axios.interceptors.response.eject(this.interceptorId);
    }
  }

  async captureAxiosResponse(response: AxiosResponse): Promise<void> {
    const matchId = extractMatchIdFromMetadataUrl(response.config.url);
    const payload = toRecord(response.data);
    if (matchId === undefined || !payload) {
      return;
    }

    await this.store(matchId, payload, MATCH_METADATA_SOURCE);
  }

  async store(
    matchId: number,
    payload: Record<string, unknown>,
    source: string,
  ): Promise<RawMatchMetadata> {
    const payloadHash = hashRawMatchMetadata(payload);
    const summary = summarizeRawMatchMetadata(payload);
    const existing = await this.rawMatchMetadataRepository.findOne({
      where: { matchId, payloadHash },
    });
    if (existing) {
      await this.normalizeBestEffort(existing);
      return existing;
    }

    try {
      const stored = await this.rawMatchMetadataRepository.save(
        this.rawMatchMetadataRepository.create({
          matchId,
          source,
          payloadHash,
          payload,
          ...summary,
        }),
      );
      this.logger.debug(`Stored raw metadata for match ${matchId} (${payloadHash.slice(0, 12)})`);
      await this.normalizeBestEffort(stored);
      return stored;
    } catch (error) {
      const stored = await this.rawMatchMetadataRepository.findOne({
        where: { matchId, payloadHash },
      });
      if (stored) {
        await this.normalizeBestEffort(stored);
        return stored;
      }
      throw error;
    }
  }

  async getLatest(matchId: number): Promise<RawMatchMetadata> {
    const stored = await this.rawMatchMetadataRepository.findOne({
      where: { matchId },
      order: { fetchedAt: 'DESC', id: 'DESC' },
    });
    if (!stored) {
      throw new Error(`No raw metadata found for match ${matchId}`);
    }
    return stored;
  }

  async getBestForReprocessing(matchId: number): Promise<RawMatchMetadata> {
    const candidates = await this.rawMatchMetadataRepository.find({
      where: { matchId },
      order: { fetchedAt: 'DESC', id: 'DESC' },
    });
    const stored = selectBestRawMatchMetadata(candidates);
    if (!stored) {
      throw new Error(`No raw metadata found for match ${matchId}`);
    }
    return stored;
  }

  async markProcessed(rawMetadataId: number, processingVersion: string): Promise<void> {
    await this.rawMatchMetadataRepository.update(rawMetadataId, {
      processingVersion,
      lastProcessedAt: new Date(),
    });
  }

  private async normalizeBestEffort(rawMetadata: RawMatchMetadata): Promise<void> {
    try {
      await this.rawMatchMetadataNormalizerService.normalizeRawMetadata(rawMetadata, true);
    } catch (error) {
      this.logger.warn(
        `Stored raw metadata for match ${rawMetadata.matchId}, but normalization failed: ` +
          `${(error as Error).message}`,
      );
    }
  }
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getNumericValue(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!record) {
    return undefined;
  }

  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
