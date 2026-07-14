import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { Match } from './entities/match.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { MatchPlayerItem } from './entities/match-player-item.entity';
import { MatchPlayerSkillUpgrade } from './entities/match-player-skill-upgrade.entity';

export const RECENT_MATCH_WINDOW_DAYS = 14;
export const RECENT_MATCH_TARGET_COUNT = 10_000;
export const RECENT_MATCH_REFRESH_INTERVAL_MS = 5 * 60_000;
export const RECENT_MATCH_QUERY_BATCH_SIZE = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecentMatchItemSnapshot {
  id: number;
  itemId: number;
  purchaseTimeS?: number;
  soldTimeS?: number;
  upgradeId?: number;
  flags?: number;
  imbuedAbilityId?: number;
  upgradeInfo?: number;
  slotOrder?: number;
}

export interface RecentMatchSkillSnapshot {
  id: number;
  abilityId: number;
  upgradeOrder: number;
  upgradeTimeS?: number;
}

export interface RecentMatchPlayerSnapshot {
  id: number;
  matchId: number;
  heroId: number;
  team: number;
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  netWorth: number;
  itemPurchases: RecentMatchItemSnapshot[];
  skillUpgrades: RecentMatchSkillSnapshot[];
}

export interface RecentMatchSnapshot {
  matchId: number;
  startTime: Date;
  durationS: number;
  averageBadge: number;
  winningTeam: number;
  players: RecentMatchPlayerSnapshot[];
}

export interface RecentMatchesWindowStatus {
  windowDays: number;
  targetMatchCount: number;
  refreshIntervalMs: number;
  cutoff: Date;
  matchCount: number;
  playerCount: number;
  itemEventCount: number;
  skillEventCount: number;
  lastRefreshDurationMs: number;
  lastRefreshedAt?: Date;
  oldestMatchStartTime?: Date;
  newestMatchStartTime?: Date;
  lastError?: string;
}

@Injectable()
export class RecentMatchesWindowService implements OnModuleInit {
  private readonly logger = new Logger(RecentMatchesWindowService.name);
  private matchesById = new Map<number, RecentMatchSnapshot>();
  private refreshPromise?: Promise<RecentMatchesWindowStatus>;
  private lastRefreshedAt?: Date;
  private lastRefreshDurationMs = 0;
  private lastError?: string;

  constructor(
    @InjectRepository(Match)
    private readonly matchRepository: Repository<Match>,
    @InjectRepository(MatchPlayer)
    private readonly matchPlayerRepository: Repository<MatchPlayer>,
    @InjectRepository(MatchPlayerItem)
    private readonly matchPlayerItemRepository: Repository<MatchPlayerItem>,
    @InjectRepository(MatchPlayerSkillUpgrade)
    private readonly matchPlayerSkillUpgradeRepository: Repository<MatchPlayerSkillUpgrade>,
  ) {}

  onModuleInit(): void {
    this.refreshInBackground('initial');
  }

  @Interval('recent-matches-window-refresh', RECENT_MATCH_REFRESH_INTERVAL_MS)
  refreshOnInterval(): void {
    this.refreshInBackground('scheduled');
  }

  async refresh(now = new Date()): Promise<RecentMatchesWindowStatus> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.loadWindow(now);
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  getMatches(): RecentMatchSnapshot[] {
    return Array.from(this.matchesById.values(), cloneMatchSnapshot);
  }

  getMatchIds(): number[] {
    return Array.from(this.matchesById.keys());
  }

  getMatch(matchId: number): RecentMatchSnapshot | undefined {
    const match = this.matchesById.get(matchId);
    return match ? cloneMatchSnapshot(match) : undefined;
  }

  getPlayersByHeroIds(
    heroIds: number[],
    limit = Number.MAX_SAFE_INTEGER,
  ): RecentMatchPlayerSnapshot[] {
    if (heroIds.length === 0 || limit <= 0) {
      return [];
    }

    const heroIdSet = new Set(heroIds);
    const result: RecentMatchPlayerSnapshot[] = [];
    const matches = Array.from(this.matchesById.values()).sort(
      (left, right) => right.startTime.getTime() - left.startTime.getTime(),
    );

    for (const match of matches) {
      for (const player of match.players) {
        if (!heroIdSet.has(player.heroId)) {
          continue;
        }
        result.push(clonePlayerSnapshot(player));
        if (result.length >= limit) {
          return result;
        }
      }
    }

    return result;
  }

  getPlayersByMatchIds(matchIds: number[]): RecentMatchPlayerSnapshot[] {
    const result: RecentMatchPlayerSnapshot[] = [];
    for (const matchId of new Set(matchIds)) {
      const match = this.matchesById.get(matchId);
      if (!match) {
        continue;
      }
      result.push(...match.players.map(clonePlayerSnapshot));
    }
    return result;
  }

  getStatus(now = new Date()): RecentMatchesWindowStatus {
    const matches = Array.from(this.matchesById.values());
    const startTimes = matches.map((match) => match.startTime.getTime());

    return {
      windowDays: RECENT_MATCH_WINDOW_DAYS,
      targetMatchCount: RECENT_MATCH_TARGET_COUNT,
      refreshIntervalMs: RECENT_MATCH_REFRESH_INTERVAL_MS,
      cutoff: getRecentMatchCutoff(now),
      matchCount: matches.length,
      playerCount: matches.reduce((total, match) => total + match.players.length, 0),
      itemEventCount: matches.reduce(
        (total, match) =>
          total +
          match.players.reduce(
            (playerTotal, player) => playerTotal + player.itemPurchases.length,
            0,
          ),
        0,
      ),
      skillEventCount: matches.reduce(
        (total, match) =>
          total +
          match.players.reduce(
            (playerTotal, player) => playerTotal + player.skillUpgrades.length,
            0,
          ),
        0,
      ),
      lastRefreshDurationMs: this.lastRefreshDurationMs,
      lastRefreshedAt: cloneDate(this.lastRefreshedAt),
      oldestMatchStartTime:
        startTimes.length > 0 ? new Date(Math.min(...startTimes)) : undefined,
      newestMatchStartTime:
        startTimes.length > 0 ? new Date(Math.max(...startTimes)) : undefined,
      lastError: this.lastError,
    };
  }

  private refreshInBackground(trigger: 'initial' | 'scheduled'): void {
    void this.refresh().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to refresh recent matches window (${trigger}): ${message}`);
    });
  }

  private async loadWindow(now: Date): Promise<RecentMatchesWindowStatus> {
    const startedAt = Date.now();
    const cutoff = getRecentMatchCutoff(now);

    try {
      const matches = await this.matchRepository.find({
        where: { startTime: MoreThanOrEqual(cutoff) },
        order: { startTime: 'DESC', matchId: 'DESC' },
        take: RECENT_MATCH_TARGET_COUNT,
      });

      const matchIds = matches.map((match) => Number(match.matchId));
      const players = await loadInBatches(matchIds, (batch) =>
        this.matchPlayerRepository.find({
          where: { matchId: In(batch) },
        }),
      );

      const playersById = new Map<number, MatchPlayer>();
      const playersByMatchId = new Map<number, MatchPlayer[]>();

      for (const player of players) {
        player.itemPurchases = [];
        player.skillUpgrades = [];
        playersById.set(Number(player.id), player);

        const matchId = Number(player.matchId);
        const matchPlayers = playersByMatchId.get(matchId) ?? [];
        matchPlayers.push(player);
        playersByMatchId.set(matchId, matchPlayers);
      }

      const playerIds = players.map((player) => Number(player.id));
      for (const playerIdBatch of chunkValues(playerIds, RECENT_MATCH_QUERY_BATCH_SIZE)) {
        const [items, skills] = await Promise.all([
          this.matchPlayerItemRepository.find({
            where: { matchPlayerId: In(playerIdBatch) },
          }),
          this.matchPlayerSkillUpgradeRepository.find({
            where: { matchPlayerId: In(playerIdBatch) },
          }),
        ]);

        for (const item of items) {
          playersById.get(Number(item.matchPlayerId))?.itemPurchases.push(item);
        }
        for (const skill of skills) {
          playersById.get(Number(skill.matchPlayerId))?.skillUpgrades.push(skill);
        }
      }

      const nextWindow = new Map<number, RecentMatchSnapshot>();
      for (const match of matches) {
        match.players = playersByMatchId.get(Number(match.matchId)) ?? [];
        const snapshot = toRecentMatchSnapshot(match);
        nextWindow.set(snapshot.matchId, snapshot);
      }

      this.matchesById = nextWindow;
      this.lastRefreshedAt = new Date();
      this.lastRefreshDurationMs = Date.now() - startedAt;
      this.lastError = undefined;

      const status = this.getStatus(now);
      this.logger.log(
        `Loaded ${status.matchCount}/${RECENT_MATCH_TARGET_COUNT} matches, ` +
          `${status.playerCount} players, ${status.itemEventCount} item events and ` +
          `${status.skillEventCount} skill events from the last ` +
          `${RECENT_MATCH_WINDOW_DAYS} days into memory in ` +
          `${status.lastRefreshDurationMs} ms.`,
      );
      return status;
    } catch (error) {
      this.lastRefreshDurationMs = Date.now() - startedAt;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
}

export function getRecentMatchCutoff(now: Date): Date {
  return new Date(now.getTime() - RECENT_MATCH_WINDOW_DAYS * DAY_MS);
}

export function chunkValues<T>(values: T[], batchSize: number): T[][] {
  if (batchSize <= 0) {
    throw new Error('batchSize must be greater than zero');
  }

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    chunks.push(values.slice(index, index + batchSize));
  }
  return chunks;
}

async function loadInBatches<T>(
  values: number[],
  loader: (batch: number[]) => Promise<T[]>,
): Promise<T[]> {
  const result: T[] = [];
  for (const batch of chunkValues(values, RECENT_MATCH_QUERY_BATCH_SIZE)) {
    result.push(...(await loader(batch)));
  }
  return result;
}

export function toRecentMatchSnapshot(match: Match): RecentMatchSnapshot {
  return {
    matchId: Number(match.matchId),
    startTime: new Date(match.startTime),
    durationS: toNumber(match.durationS),
    averageBadge: toNumber(match.averageBadge),
    winningTeam: toNumber(match.winningTeam),
    players: [...(match.players ?? [])]
      .sort((left, right) => Number(left.id) - Number(right.id))
      .map(toRecentMatchPlayerSnapshot),
  };
}

function toRecentMatchPlayerSnapshot(player: MatchPlayer): RecentMatchPlayerSnapshot {
  return {
    id: Number(player.id),
    matchId: Number(player.matchId),
    heroId: Number(player.heroId),
    team: toNumber(player.team),
    won: Boolean(player.won),
    kills: toNumber(player.kills),
    deaths: toNumber(player.deaths),
    assists: toNumber(player.assists),
    netWorth: toNumber(player.netWorth),
    itemPurchases: [...(player.itemPurchases ?? [])]
      .sort(compareItemPurchases)
      .map(toRecentMatchItemSnapshot),
    skillUpgrades: [...(player.skillUpgrades ?? [])]
      .sort((left, right) => left.upgradeOrder - right.upgradeOrder)
      .map(toRecentMatchSkillSnapshot),
  };
}

function toRecentMatchItemSnapshot(item: MatchPlayerItem): RecentMatchItemSnapshot {
  return {
    id: Number(item.id),
    itemId: Number(item.itemId),
    purchaseTimeS: toOptionalNumber(item.purchaseTimeS),
    soldTimeS: toOptionalNumber(item.soldTimeS),
    upgradeId: toOptionalNumber(item.upgradeId),
    flags: toOptionalNumber(item.flags),
    imbuedAbilityId: toOptionalNumber(item.imbuedAbilityId),
    upgradeInfo: toOptionalNumber(item.upgradeInfo),
    slotOrder: toOptionalNumber(item.slotOrder),
  };
}

function toRecentMatchSkillSnapshot(
  skill: MatchPlayerSkillUpgrade,
): RecentMatchSkillSnapshot {
  return {
    id: Number(skill.id),
    abilityId: Number(skill.abilityId),
    upgradeOrder: Number(skill.upgradeOrder),
    upgradeTimeS: toOptionalNumber(skill.upgradeTimeS),
  };
}

function compareItemPurchases(left: MatchPlayerItem, right: MatchPlayerItem): number {
  const leftTime = toOptionalNumber(left.purchaseTimeS) ?? Number.MAX_SAFE_INTEGER;
  const rightTime = toOptionalNumber(right.purchaseTimeS) ?? Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  const leftSlot = toOptionalNumber(left.slotOrder) ?? Number.MAX_SAFE_INTEGER;
  const rightSlot = toOptionalNumber(right.slotOrder) ?? Number.MAX_SAFE_INTEGER;
  if (leftSlot !== rightSlot) {
    return leftSlot - rightSlot;
  }

  return Number(left.id) - Number(right.id);
}

function cloneMatchSnapshot(match: RecentMatchSnapshot): RecentMatchSnapshot {
  return {
    ...match,
    startTime: new Date(match.startTime),
    players: match.players.map(clonePlayerSnapshot),
  };
}

function clonePlayerSnapshot(player: RecentMatchPlayerSnapshot): RecentMatchPlayerSnapshot {
  return {
    ...player,
    itemPurchases: player.itemPurchases.map((item) => ({ ...item })),
    skillUpgrades: player.skillUpgrades.map((skill) => ({ ...skill })),
  };
}

function cloneDate(value: Date | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}

function toNumber(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalNumber(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
