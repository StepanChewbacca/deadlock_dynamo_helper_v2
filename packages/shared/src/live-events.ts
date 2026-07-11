export type OverwolfLiveEventSource = 'onInfoUpdates2' | 'onNewEvents';

export type OverwolfLiveEventDto = {
  matchId?: string;
  receivedAt: number;
  source: OverwolfLiveEventSource;
  feature?: string;
  category?: string;
  key?: string;
  payload: unknown;
};

export type OverwolfLiveBatchDto = {
  clientId: string;
  events: OverwolfLiveEventDto[];
};

export type MinimalItemState = {
  id: number;
  name: string;
  className: string;
  enhanced: boolean;
  firstSeenAtSec?: number;
};

export type MinimalPlayerState = {
  steamId: string;
  playerName: string;
  isLocal?: boolean;
  heroId?: number;
  heroName?: string;
  teamId?: number;
  lane?: number;
  level?: number;
  souls?: number;
  health?: number;
  maxHealth?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  heroDamage?: number;
  objectDamage?: number;
  healing?: number;
  items: MinimalItemState[];
};

export type MinimalMatchState = {
  matchId: string;
  gameTimeSec?: number;
  playersBySteamId: Record<string, MinimalPlayerState>;
  lastUpdatedAt: string;
};

export type MinimalPlayerSnapshot = Pick<
  MinimalPlayerState,
  | 'steamId'
  | 'heroId'
  | 'teamId'
  | 'level'
  | 'souls'
  | 'kills'
  | 'deaths'
  | 'assists'
  | 'heroDamage'
  | 'objectDamage'
  | 'healing'
> & {
  itemIds: number[];
};

export type MinimalMatchSnapshot = {
  matchId: string;
  gameTimeSec?: number;
  capturedAt: string;
  playersBySteamId: Record<string, MinimalPlayerSnapshot>;
};
