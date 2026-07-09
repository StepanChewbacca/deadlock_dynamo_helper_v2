import { Injectable } from '@nestjs/common';
import {
  MinimalItemState,
  MinimalMatchState,
  MinimalPlayerState,
  OverwolfLiveBatchDto,
  OverwolfLiveEventDto,
} from '@deadlock-live-probe/shared';

@Injectable()
export class LiveMatchStateService {
  private readonly states = new Map<string, MinimalMatchState>();
  private readonly clientMatchIds = new Map<string, string>();

  applyBatch(batch: OverwolfLiveBatchDto): MinimalMatchState | undefined {
    const extractedMatchId = this.extractMatchId(batch.events);
    const previousMatchId = this.clientMatchIds.get(batch.clientId);
    const currentMatchId = extractedMatchId ?? previousMatchId ?? 'unknown';
    const state = this.getOrCreateState(currentMatchId, previousMatchId, extractedMatchId);

    this.clientMatchIds.set(batch.clientId, currentMatchId);

    for (const event of batch.events) {
      this.applyEvent(state, event);
    }

    state.lastUpdatedAt = new Date().toISOString();
    this.states.set(currentMatchId, state);

    return state;
  }

  getState(matchId: string): MinimalMatchState | undefined {
    return this.states.get(matchId);
  }

  getAllStates(): MinimalMatchState[] {
    return [...this.states.values()];
  }

  private getOrCreateState(
    currentMatchId: string,
    previousMatchId: string | undefined,
    extractedMatchId: string | undefined,
  ): MinimalMatchState {
    if (previousMatchId === 'unknown' && extractedMatchId && extractedMatchId !== 'unknown') {
      return this.migrateUnknownState(extractedMatchId);
    }

    return (
      this.states.get(currentMatchId) ?? {
        matchId: currentMatchId,
        playersBySteamId: {},
        lastUpdatedAt: new Date().toISOString(),
      }
    );
  }

  private migrateUnknownState(matchId: string): MinimalMatchState {
    const unknownState = this.states.get('unknown');
    const existingState = this.states.get(matchId);

    if (!unknownState) {
      return (
        existingState ?? {
          matchId,
          playersBySteamId: {},
          lastUpdatedAt: new Date().toISOString(),
        }
      );
    }

    if (!existingState) {
      this.states.delete('unknown');
      return {
        ...unknownState,
        matchId,
      };
    }

    this.states.delete('unknown');

    return {
      ...unknownState,
      ...existingState,
      matchId,
      playersBySteamId: this.mergePlayersBySteamId(
        unknownState.playersBySteamId,
        existingState.playersBySteamId,
      ),
    };
  }

  private mergePlayersBySteamId(
    basePlayers: Record<string, MinimalPlayerState>,
    nextPlayers: Record<string, MinimalPlayerState>,
  ): Record<string, MinimalPlayerState> {
    const mergedPlayers: Record<string, MinimalPlayerState> = { ...basePlayers };

    for (const [steamId, nextPlayer] of Object.entries(nextPlayers)) {
      mergedPlayers[steamId] = {
        ...(mergedPlayers[steamId] ?? {}),
        ...nextPlayer,
      };
    }

    return mergedPlayers;
  }

  private applyEvent(state: MinimalMatchState, event: OverwolfLiveEventDto): void {
    if (event.key === 'match_clock') {
      const seconds = this.parseClockSeconds(event.payload);
      if (seconds !== undefined) {
        state.gameTimeSec = seconds;
      }
      return;
    }

    if (event.key?.startsWith('roster')) {
      this.applyRosterPayload(state, event.payload);
      return;
    }

    if (event.key?.startsWith('items')) {
      this.applyItemsPayload(state, event.payload);
    }
  }

  private extractMatchId(events: OverwolfLiveEventDto[]): string | undefined {
    for (const event of events) {
      if (typeof event.matchId === 'string' && event.matchId.length > 0) {
        return event.matchId;
      }

      if (event.key === 'match_id' && typeof event.payload === 'string' && event.payload.length > 0) {
        return event.payload;
      }

      if (this.isRecord(event.payload)) {
        const payloadMatchId = this.getStringValue(event.payload, 'match_id');
        if (payloadMatchId) {
          return payloadMatchId;
        }
      }
    }

    return undefined;
  }

  private parseClockSeconds(payload: unknown): number | undefined {
    if (typeof payload !== 'string') {
      return undefined;
    }

    const parts = payload.split(':').map((part) => Number.parseInt(part, 10));
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => Number.isNaN(part))) {
      return undefined;
    }

    if (parts.length === 2) {
      const [minutes, seconds] = parts;
      return minutes * 60 + seconds;
    }

    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  private applyRosterPayload(state: MinimalMatchState, payload: unknown): void {
    if (!this.isRecord(payload)) {
      return;
    }

    const steamId = this.getStringValue(payload, 'steam_id');
    if (!steamId) {
      return;
    }

    const player = this.getOrCreatePlayer(state, steamId);
    const playerName = this.getStringValue(payload, 'player_name');
    const heroName = this.getStringValue(payload, 'hero_name');
    const heroId = this.getNumericValue(payload, 'hero_id');
    const teamId = this.getNumericValue(payload, 'team');
    const lane = this.getNumericValue(payload, 'lane');
    const level = this.getNumericValue(payload, 'level');
    const souls = this.getNumericValue(payload, 'souls');
    const health = this.getNumericValue(payload, 'health');
    const maxHealth = this.getNumericValue(payload, 'max_health');
    const kills = this.getNumericValue(payload, 'kills');
    const deaths = this.getNumericValue(payload, 'deaths');
    const assists = this.getNumericValue(payload, 'assists');
    const heroDamage = this.getNumericValue(payload, 'hero_damage');
    const objectDamage = this.getNumericValue(payload, 'object_damage');
    const healing = this.getNumericValue(payload, 'healing');

    if (playerName !== undefined) {
      player.playerName = playerName;
    }
    if (heroName !== undefined) {
      player.heroName = heroName;
    }
    if (heroId !== undefined) {
      player.heroId = heroId;
    }
    if (teamId !== undefined) {
      player.teamId = teamId;
    }
    if (lane !== undefined) {
      player.lane = lane;
    }
    if (level !== undefined) {
      player.level = level;
    }
    if (souls !== undefined) {
      player.souls = souls;
    }
    if (health !== undefined) {
      player.health = health;
    }
    if (maxHealth !== undefined) {
      player.maxHealth = maxHealth;
    }
    if (kills !== undefined) {
      player.kills = kills;
    }
    if (deaths !== undefined) {
      player.deaths = deaths;
    }
    if (assists !== undefined) {
      player.assists = assists;
    }
    if (heroDamage !== undefined) {
      player.heroDamage = heroDamage;
    }
    if (objectDamage !== undefined) {
      player.objectDamage = objectDamage;
    }
    if (healing !== undefined) {
      player.healing = healing;
    }
  }

  private applyItemsPayload(state: MinimalMatchState, payload: unknown): void {
    if (!this.isRecord(payload)) {
      return;
    }

    const steamId = this.getStringValue(payload, 'steam_id');
    if (!steamId) {
      return;
    }

    const itemsValue = payload.items;
    if (!Array.isArray(itemsValue)) {
      return;
    }

    const player = this.getOrCreatePlayer(state, steamId);
    const nextItems: MinimalItemState[] = [];

    for (const item of itemsValue) {
      if (!this.isRecord(item)) {
        continue;
      }

      const id = this.getNumericValue(item, 'id');
      const name = this.getStringValue(item, 'name');
      const className = this.getStringValue(item, 'class_name');
      if (id === undefined || name === undefined || className === undefined) {
        continue;
      }

      nextItems.push({
        id,
        name,
        className,
        enhanced: this.getBooleanValue(item, 'enhanced'),
        firstSeenAtSec: state.gameTimeSec,
      });
    }

    player.items = nextItems;
  }

  private getOrCreatePlayer(state: MinimalMatchState, steamId: string): MinimalPlayerState {
    const existing = state.playersBySteamId[steamId];
    if (existing) {
      return existing;
    }

    const created: MinimalPlayerState = {
      steamId,
      playerName: '',
      items: [],
    };
    state.playersBySteamId[steamId] = created;
    return created;
  }

  private getStringValue(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private getNumericValue(record: Record<string, unknown>, key: string): number | undefined {
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

  private getBooleanValue(record: Record<string, unknown>, key: string): boolean {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value !== 0;
    }

    if (typeof value === 'string') {
      return value === 'true' || value === '1';
    }

    return false;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
