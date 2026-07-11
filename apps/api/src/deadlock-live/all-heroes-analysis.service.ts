import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { CrawlerRun } from './entities/crawler-run.entity';
import { CrawlerState } from './entities/crawler-state.entity';
import { Hero } from './entities/hero.entity';
import { ItemComponent } from './entities/item-component.entity';
import { Item } from './entities/item.entity';
import { Match } from './entities/match.entity';
import { MatchPlayerItem } from './entities/match-player-item.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { MatchPlayerSkillUpgrade } from './entities/match-player-skill-upgrade.entity';
import { getDeadlockApiRequestConfig } from './deadlock-api-request';
import { mapAbilityToSkillNumber, isAbilityItem } from './hero-abilities';

const API_BASE = 'https://api.deadlock-api.com';
const REQUEST_DELAY_MS = 2000;
const RATE_LIMIT_WAIT_MS = 60000;
const MAX_MATCHES_PER_HERO = 1000;
const MAX_CRAWL_MATCHES = 2500;
const MIN_BADGE = 116;

// Deadlock inventory limits
// Players start with 9 slots and unlock up to 16 total by destroying objectives.
// We recommend a conservative budget of 12 items (4 per phase) to leave room for
// situational purchases during the match.
const MAX_PHASE_ITEMS = 4;       // per phase; 4 early + 4 mid + 4 late = 12 total
const MAX_CORE_ITEMS = 8;        // highest-scored items shown as "must-have"
const MAX_SITUATIONAL_ITEMS = 4; // secondary picks (was 6)
const MAX_ADJUSTMENTS = 4;       // counter/synergy items shown per matchup (was 5)

export const HERO_ID_ALIASES: Record<number, number[]> = {
  1: [1, 14],       // Infernus
  2: [2, 64],       // Seven
  3: [3],           // Vindicta
  4: [4],           // Lady Geist
  6: [6, 72],       // Abrams / Billy legacy collision fallback
  7: [7],           // Wraith
  8: [8, 69],       // McGinnis
  10: [10],         // Paradox
  11: [11],         // Dynamo
  12: [12, 76],     // Kelvin
  13: [13],         // Haze
  14: [14],         // Holliday
  15: [15, 80],     // Bebop
  16: [16, 27],     // Calico
  17: [17, 79],     // Grey Talon
  18: [18],         // Mo & Krill
  19: [19, 81],     // Shiv
  20: [20, 65],     // Ivy
  25: [25],         // Warden
  27: [27, 66],     // Yamato
  31: [31, 50],     // Lash
  35: [35, 60],     // Viscous
  50: [50],         // Pocket
  52: [52],         // Mirage
  58: [58],         // Vyper
  60: [60],         // Sinclair
  63: [63],         // Mina
  67: [67],         // Paige
  72: [72],         // Billy
  77: [77],         // Apollo
};

const HERO_ALIAS_TO_CANONICAL_ID: Record<number, number> = Object.entries(HERO_ID_ALIASES).reduce(
  (acc, [canonical, aliases]) => {
    for (const alias of aliases) {
      acc[alias] = Number(canonical);
    }
    return acc;
  },
  {} as Record<number, number>,
);

export function canonicalHeroId(heroId: number): number {
  return HERO_ALIAS_TO_CANONICAL_ID[heroId] || heroId;
}

export function heroIdAliases(heroId: number): number[] {
  const canonical = canonicalHeroId(heroId);
  return HERO_ID_ALIASES[canonical] || [heroId];
}

// Backward-compatible single-id mapping. New analysis code should use heroIdAliases().
export const GEP_TO_VALVE_ID: Record<number, number> = Object.fromEntries(
  Object.entries(HERO_ID_ALIASES).map(([canonical, aliases]) => [Number(canonical), aliases[aliases.length - 1]]),
);

export const VALVE_TO_GEP_ID: Record<number, number> = HERO_ALIAS_TO_CANONICAL_ID;

interface CrawlProgress {
  isCrawling: boolean;
  current: number;
  total: number;
  currentHero: string;
  status: string;
}

type BuildType = 'weapon' | 'spirit' | 'vitality';
type SkillActionType = 'UNLOCK' | 'UPGRADE';

interface SkillBuildAction {
  step: number;
  skill: number;
  action: SkillActionType;
  upgradeTier: number;
  pointCost: number;
}

interface PhaseItem {
  id: number;
  name: string;
  cost: number;
  slotType: string;
  score: number; // 0-100 win-weighted score
  avgPurchaseTimeS: number;
  isPermanent?: boolean;
  componentItemIds?: number[];
}

interface HeroBuild {
  buildType: BuildType;
  matchCount: number;
  winRate: number;
  avgNetWorth: number;
  skillsOrder: number[];
  skillBuild: SkillBuildAction[];
  phases: {
    early: PhaseItem[];  // < 8 min
    mid: PhaseItem[];    // 8–20 min
    late: PhaseItem[];   // > 20 min
  };
  coreItems: PhaseItem[];       // score >= 60
  situationalItems: PhaseItem[]; // score 35-59
}

interface MatchupAnalysis {
  enemyHeroId: number;
  enemyHeroName: string;
  matchCount: number;
  winRate: number; // overall winrate against them
  bestBuildType: BuildType;
  counterItems: {
    id: number;
    name: string;
    cost: number;
    slotType: string;
    winRateWith: number;
    winRateWithout: number;
    advantage: number; // winRateWith - winRateWithout
  }[];
}

interface SkillCorrelation {
  skillNumber: number; // 1-4
  skillName: string;
  correlatedItems: {
    id: number;
    name: string;
    cost: number;
    slotType: string;
    pickRateWith: number;    // pickrate when prioritizing this skill
    pickRateWithout: number; // pickrate when prioritizing other skills
    correlationStrength: number; // pickRateWith - pickRateWithout
  }[];
}

interface TeammateSynergy {
  teammateHeroId: number;
  teammateHeroName: string;
  matchCount: number;
  winRate: number; // overall winrate with them
  bestBuildType: BuildType;
  synergyItems: {
    id: number;
    name: string;
    cost: number;
    slotType: string;
    winRateWith: number;
    winRateWithout: number;
    advantage: number; // winRateWith - winRateWithout
  }[];
}

interface HeroBuildResponse {
  heroId: number;
  heroName: string;
  totalMatches: number;
  builds: HeroBuild[];
  matchups: MatchupAnalysis[];
  teammateSynergies: TeammateSynergy[];
  skillCorrelations: SkillCorrelation[];
}

export class RecommendBuildDto {
  heroId!: number;
  teammates!: number[];
  enemies!: number[];
}

export interface RecommendationAdjustmentItem {
  id: number;
  name: string;
  cost: number;
  slotType: string;
  type: 'counter' | 'synergy';
  advantage: number;
  reason: string;
  avgPurchaseTimeS: number; // average game-time (seconds) when this item is bought
}

export interface RecommendedBuildResponse {
  heroId: number;
  heroName: string;
  recommendedBuildType: BuildType;
  suitabilityScore: number;
  baseBuild: HeroBuild;
  matchupAdjustments: RecommendationAdjustmentItem[];
}

type ItemsMap = Record<string, { name: string; class_name: string; item_slot_type: string; cost: number; item_tier: number }>;

@Injectable()
export class AllHeroesAnalysisService implements OnModuleInit {
  private readonly logger = new Logger(AllHeroesAnalysisService.name);
  private readonly crawlerType = 'all_heroes';
  private itemsMapCache: Record<string, { name: string; class_name: string; item_slot_type: string; cost: number; item_tier: number }> | null = null;
  private heroesMapCache: Record<string, { hero_id: number; name: string }> | null = null;
  private itemComponentsMapCache: Record<number, number[]> | null = null;
  private activeRunId: number | null = null;

  private isCrawling = false;
  private progress: CrawlProgress = {
    isCrawling: false,
    current: 0,
    total: 0,
    currentHero: '',
    status: 'Idle',
  };

  constructor(
    @InjectRepository(Match)
    private readonly matchRepo: Repository<Match>,
    @InjectRepository(MatchPlayer)
    private readonly matchPlayerRepo: Repository<MatchPlayer>,
    @InjectRepository(MatchPlayerItem)
    private readonly matchPlayerItemRepo: Repository<MatchPlayerItem>,
    @InjectRepository(MatchPlayerSkillUpgrade)
    private readonly matchPlayerSkillUpgradeRepo: Repository<MatchPlayerSkillUpgrade>,
    @InjectRepository(Hero)
    private readonly heroRepo: Repository<Hero>,
    @InjectRepository(Item)
    private readonly itemRepo: Repository<Item>,
    @InjectRepository(ItemComponent)
    private readonly itemComponentRepo: Repository<ItemComponent>,
    @InjectRepository(CrawlerState)
    private readonly crawlerStateRepo: Repository<CrawlerState>,
    @InjectRepository(CrawlerRun)
    private readonly crawlerRunRepo: Repository<CrawlerRun>,
  ) {}

  async onModuleInit() {
    await this.recoverCrawlerStateAfterRestart();
  }

  getProgress(): CrawlProgress {
    return { ...this.progress };
  }

  async getHeroesSummary(): Promise<{ heroId: number; heroName: string; matchCount: number; lastUpdated: Date | null }[]> {
    const heroesMap = await this.loadHeroesMap();
    const result = await this.matchPlayerRepo
      .createQueryBuilder('mp')
      .select('mp.heroId', 'heroId')
      .addSelect('COUNT(*)', 'matchCount')
      .addSelect('MAX(mp.crawledAt)', 'lastUpdated')
      .groupBy('mp.heroId')
      .orderBy('mp.heroId', 'ASC')
      .getRawMany();

    return result.map((r) => ({
      heroId: r.heroId,
      heroName: heroesMap[String(r.heroId)]?.name || `Hero_${r.heroId}`,
      matchCount: parseInt(r.matchCount, 10),
      lastUpdated: r.lastUpdated,
    }));
  }

  async getHeroBuilds(requestHeroId: number): Promise<HeroBuildResponse> {
    const canonicalId = canonicalHeroId(requestHeroId);
    const heroAliases = heroIdAliases(requestHeroId);
    const heroesMap = await this.loadHeroesMap();
    const itemsMap = await this.loadItemsMap();
    await this.loadItemComponentsMap();
    const heroName = heroesMap[String(canonicalId)]?.name || heroesMap[String(heroAliases[0])]?.name || `Hero_${requestHeroId}`;

    const players = await this.matchPlayerRepo.find({
      where: { heroId: In(heroAliases) },
      order: { crawledAt: 'DESC' },
      take: MAX_MATCHES_PER_HERO,
      relations: {
        itemPurchases: true,
        skillUpgrades: true,
      },
    });

    if (players.length === 0) {
      return {
        heroId: requestHeroId,
        heroName,
        totalMatches: 0,
        builds: [],
        matchups: [],
        teammateSynergies: [],
        skillCorrelations: [],
      };
    }

    const builds = this.computeBuilds(players, itemsMap);

    // Fetch enemy players for matchups
    const matchIds = players.map((p) => p.matchId);
    let enemyPlayers: MatchPlayer[] = [];
    if (matchIds.length > 0) {
      enemyPlayers = await this.matchPlayerRepo.find({
        where: {
          matchId: In(matchIds),
        },
        select: {
          matchId: true,
          heroId: true,
          team: true,
        },
      });
    }

    const matchups = this.computeMatchups(players, enemyPlayers, heroesMap, itemsMap);
    const teammateSynergies = this.computeTeammateSynergies(players, enemyPlayers, heroesMap, itemsMap);
    const skillCorrelations = this.computeSkillCorrelations(players, itemsMap);

    return {
      heroId: requestHeroId,
      heroName,
      totalMatches: players.length,
      builds,
      matchups: matchups.map((m) => ({ ...m, enemyHeroId: VALVE_TO_GEP_ID[m.enemyHeroId] || m.enemyHeroId })),
      teammateSynergies: teammateSynergies.map((s) => ({ ...s, teammateHeroId: VALVE_TO_GEP_ID[s.teammateHeroId] || s.teammateHeroId })),
      skillCorrelations,
    };
  }

  private computeTeammateSynergies(
    players: MatchPlayer[],
    allPlayersInMatches: MatchPlayer[],
    heroesMap: Record<string, { hero_id: number; name: string }>,
    itemsMap: ItemsMap,
  ): TeammateSynergy[] {
    const teammatesMap: Record<number, number[]> = {};
    const ourPlayerMap: Record<number, MatchPlayer> = {};
    for (const p of players) {
      ourPlayerMap[p.matchId] = p;
    }

    for (const ep of allPlayersInMatches) {
      const ourP = ourPlayerMap[ep.matchId];
      if (!ourP) continue;
      if (ep.team === ourP.team && ep.heroId !== ourP.heroId) {
        if (!teammatesMap[ep.matchId]) teammatesMap[ep.matchId] = [];
        teammatesMap[ep.matchId].push(ep.heroId);
      }
    }

    const teammateStats: Record<number, { matchCount: number; wins: number; matchIds: number[] }> = {};
    for (const p of players) {
      const allies = teammatesMap[p.matchId] || [];
      for (const allyHeroId of allies) {
        if (!teammateStats[allyHeroId]) {
          teammateStats[allyHeroId] = { matchCount: 0, wins: 0, matchIds: [] };
        }
        teammateStats[allyHeroId].matchCount++;
        teammateStats[allyHeroId].matchIds.push(p.matchId);
        if (p.won) {
          teammateStats[allyHeroId].wins++;
        }
      }
    }

    const synergyList: TeammateSynergy[] = [];

    for (const [allyIdStr, stats] of Object.entries(teammateStats)) {
      const allyHeroId = parseInt(allyIdStr, 10);
      if (stats.matchCount < 5) continue;

      const winRate = Math.round((stats.wins / stats.matchCount) * 100);

      let bestBuildType: BuildType = 'weapon';
      let bestWR = -1;
      let bestCount = 0;

      const buildsStats: Record<BuildType, { wins: number; total: number }> = {
        weapon: { wins: 0, total: 0 },
        spirit: { wins: 0, total: 0 },
        vitality: { wins: 0, total: 0 },
      };

      for (const matchId of stats.matchIds) {
        const ourP = ourPlayerMap[matchId];
        if (!ourP) continue;

        const purchases = ourP.itemPurchases || [];
        let wSpend = 0, sSpend = 0, vSpend = 0;
        for (const pur of purchases) {
          const meta = itemsMap[String(pur.itemId)];
          if (!meta) continue;
          if (meta.item_slot_type === 'weapon') wSpend += meta.cost || 0;
          else if (meta.item_slot_type === 'spirit') sSpend += meta.cost || 0;
          else if (meta.item_slot_type === 'vitality') vSpend += meta.cost || 0;
        }
        const bType: BuildType =
          wSpend >= sSpend && wSpend >= vSpend
            ? 'weapon'
            : sSpend >= vSpend
            ? 'spirit'
            : 'vitality';

        buildsStats[bType].total++;
        if (ourP.won) buildsStats[bType].wins++;
      }

      for (const bType of ['weapon', 'spirit', 'vitality'] as BuildType[]) {
        const bStat = buildsStats[bType];
        if (bStat.total >= 3) {
          const wr = bStat.wins / bStat.total;
          if (wr > bestWR || (wr === bestWR && bStat.total > bestCount)) {
            bestWR = wr;
            bestBuildType = bType;
            bestCount = bStat.total;
          }
        }
      }

      const itemStats: Record<number, { winsWith: number; countWith: number }> = {};
      for (const matchId of stats.matchIds) {
        const ourP = ourPlayerMap[matchId];
        if (!ourP) continue;
        const boughtItemIds = this.getEffectiveFinalItems(ourP.itemPurchases || []);

        for (const itemId of boughtItemIds) {
          if (!itemStats[itemId]) {
            itemStats[itemId] = { winsWith: 0, countWith: 0 };
          }
          itemStats[itemId].countWith++;
          if (ourP.won) {
            itemStats[itemId].winsWith++;
          }
        }
      }

      const synergyItems: TeammateSynergy['synergyItems'] = [];
      for (const [itemIdStr, itemData] of Object.entries(itemStats)) {
        const itemId = parseInt(itemIdStr, 10);
        const meta = itemsMap[itemIdStr];
        if (!meta) continue;

        const countWith = itemData.countWith;
        const winsWith = itemData.winsWith;
        const winRateWith = countWith > 0 ? (winsWith / countWith) * 100 : 0;

        const countWithout = stats.matchCount - countWith;
        const winsWithout = stats.wins - winsWith;
        const winRateWithout = countWithout > 0 ? (winsWithout / countWithout) * 100 : 0;

        const advantage = winRateWith - winRateWithout;

        if (countWith >= 3 && countWithout >= 3 && advantage >= 5) {
          synergyItems.push({
            id: itemId,
            name: meta.name,
            cost: meta.cost || 0,
            slotType: meta.item_slot_type,
            winRateWith: Math.round(winRateWith),
            winRateWithout: Math.round(winRateWithout),
            advantage: Math.round(advantage),
          });
        }
      }

      synergyItems.sort((a, b) => b.advantage - a.advantage);

      const allyName = heroesMap[String(allyHeroId)]?.name || `Hero_${allyHeroId}`;
      synergyList.push({
        teammateHeroId: allyHeroId,
        teammateHeroName: allyName,
        matchCount: stats.matchCount,
        winRate,
        bestBuildType,
        synergyItems: synergyItems.slice(0, 3),
      });
    }

    return synergyList.sort((a, b) => b.matchCount - a.matchCount);
  }

  async recommendBuild(dto: RecommendBuildDto): Promise<RecommendedBuildResponse> {
    const requestHeroId = dto.heroId;
    const canonicalId = canonicalHeroId(requestHeroId);
    const heroAliases = heroIdAliases(requestHeroId);
    const dbTeammates = dto.teammates.flatMap((id) => heroIdAliases(id));
    const dbEnemies = dto.enemies.flatMap((id) => heroIdAliases(id));

    const heroesMap = await this.loadHeroesMap();
    const itemsMap = await this.loadItemsMap();
    await this.loadItemComponentsMap();
    const heroName = heroesMap[String(canonicalId)]?.name || heroesMap[String(heroAliases[0])]?.name || `Hero_${requestHeroId}`;

    const players = await this.matchPlayerRepo.find({
      where: { heroId: In(heroAliases) },
      order: { crawledAt: 'DESC' },
      take: MAX_MATCHES_PER_HERO,
      relations: {
        itemPurchases: true,
        skillUpgrades: true,
      },
    });

    if (players.length === 0) {
      throw new Error(`No historical data found for hero ${heroName}`);
    }

    const builds = this.computeBuilds(players, itemsMap);

    const matchIds = players.map((p) => p.matchId);
    let allPlayersInMatches: MatchPlayer[] = [];
    if (matchIds.length > 0) {
      allPlayersInMatches = await this.matchPlayerRepo.find({
        where: {
          matchId: In(matchIds),
        },
        select: {
          matchId: true,
          heroId: true,
          team: true,
        },
      });
    }

    const enemyMap: Record<number, Set<number>> = {};
    const teammateMap: Record<number, Set<number>> = {};
    const ourPlayerMap: Record<number, MatchPlayer> = {};
    for (const p of players) {
      ourPlayerMap[p.matchId] = p;
      enemyMap[p.matchId] = new Set();
      teammateMap[p.matchId] = new Set();
    }

    for (const ep of allPlayersInMatches) {
      const ourP = ourPlayerMap[ep.matchId];
      if (!ourP) continue;
      if (ep.team !== ourP.team) {
        enemyMap[ep.matchId].add(ep.heroId);
      } else if (ep.heroId !== ourP.heroId) {
        teammateMap[ep.matchId].add(ep.heroId);
      }
    }

    const buildScores: Record<BuildType, number> = {
      weapon: 0,
      spirit: 0,
      vitality: 0,
    };

    const buildCounts: Record<BuildType, number> = { weapon: 0, spirit: 0, vitality: 0 };
    const buildWins: Record<BuildType, number> = { weapon: 0, spirit: 0, vitality: 0 };

    const matchBuildTypes: Record<number, BuildType> = {};
    for (const p of players) {
      const purchases = p.itemPurchases || [];
      let wSpend = 0, sSpend = 0, vSpend = 0;
      for (const pur of purchases) {
        const meta = itemsMap[String(pur.itemId)];
        if (!meta) continue;
        if (meta.item_slot_type === 'weapon') wSpend += meta.cost || 0;
        else if (meta.item_slot_type === 'spirit') sSpend += meta.cost || 0;
        else if (meta.item_slot_type === 'vitality') vSpend += meta.cost || 0;
      }
      const bType: BuildType =
        wSpend >= sSpend && wSpend >= vSpend
          ? 'weapon'
          : sSpend >= vSpend
          ? 'spirit'
          : 'vitality';

      matchBuildTypes[p.matchId] = bType;
      buildCounts[bType]++;
      if (p.won) buildWins[bType]++;
    }

    const baselineWinRates: Record<BuildType, number> = {
      weapon: buildCounts.weapon > 0 ? buildWins.weapon / buildCounts.weapon : 0.5,
      spirit: buildCounts.spirit > 0 ? buildWins.spirit / buildCounts.spirit : 0.5,
      vitality: buildCounts.vitality > 0 ? buildWins.vitality / buildCounts.vitality : 0.5,
    };

    for (const bType of ['weapon', 'spirit', 'vitality'] as BuildType[]) {
      let score = baselineWinRates[bType];

      for (const enemyId of dbEnemies) {
        let countWithEnemy = 0;
        let winsWithEnemy = 0;
        for (const p of players) {
          if (matchBuildTypes[p.matchId] !== bType) continue;
          if (enemyMap[p.matchId].has(enemyId)) {
            countWithEnemy++;
            if (p.won) winsWithEnemy++;
          }
        }
        if (countWithEnemy >= 3) {
          const wr = winsWithEnemy / countWithEnemy;
          const diff = wr - baselineWinRates[bType];
          score += diff;
        }
      }

      for (const teammateId of dbTeammates) {
        let countWithAlly = 0;
        let winsWithAlly = 0;
        for (const p of players) {
          if (matchBuildTypes[p.matchId] !== bType) continue;
          if (teammateMap[p.matchId].has(teammateId)) {
            countWithAlly++;
            if (p.won) winsWithAlly++;
          }
        }
        if (countWithAlly >= 3) {
          const wr = winsWithAlly / countWithAlly;
          const diff = wr - baselineWinRates[bType];
          score += diff;
        }
      }

      buildScores[bType] = score;
    }

    let recommendedBuildType: BuildType = 'weapon';
    let maxScore = -1;
    for (const bType of ['weapon', 'spirit', 'vitality'] as BuildType[]) {
      if (buildScores[bType] > maxScore) {
        maxScore = buildScores[bType];
        recommendedBuildType = bType;
      }
    }

    const baseBuild = builds.find((b) => b.buildType === recommendedBuildType) || builds[0];
    const adjustments: RecommendationAdjustmentItem[] = [];

    for (let idx = 0; idx < dto.enemies.length; idx++) {
      const enemyId = dto.enemies[idx];
      const dbEnemyId = dbEnemies[idx];
      const enemyName = heroesMap[String(enemyId)]?.name || `Hero_${enemyId}`;
      let countWithEnemy = 0;
      let winsWithEnemy = 0;
      for (const p of players) {
        if (enemyMap[p.matchId].has(dbEnemyId)) {
          countWithEnemy++;
          if (p.won) winsWithEnemy++;
        }
      }
      if (countWithEnemy < 5) continue;

      const itemStats: Record<number, { wins: number; total: number; totalTime: number }> = {};
      for (const p of players) {
        if (!enemyMap[p.matchId].has(dbEnemyId)) continue;
        const boughtItemIds = this.getEffectiveFinalItems(p.itemPurchases || []);
        for (const itemId of boughtItemIds) {
          if (!itemStats[itemId]) itemStats[itemId] = { wins: 0, total: 0, totalTime: 0 };
          itemStats[itemId].total++;
          if (p.won) itemStats[itemId].wins++;
          // Record purchase time for this item (0 if unknown)
          const purchase = (p.itemPurchases || []).find((i) => Number(i.itemId) === itemId);
          itemStats[itemId].totalTime += purchase?.purchaseTimeS || 0;
        }
      }

      for (const [itemIdStr, itemData] of Object.entries(itemStats)) {
        if (itemData.total < 3 || (countWithEnemy - itemData.total) < 3) continue;
        const itemId = parseInt(itemIdStr, 10);
        const meta = itemsMap[itemIdStr];
        if (!meta) continue;

        const wrWith = itemData.wins / itemData.total;
        const wrWithout = (winsWithEnemy - itemData.wins) / (countWithEnemy - itemData.total);
        const adv = wrWith - wrWithout;

        if (adv >= 0.05) {
          adjustments.push({
            id: itemId,
            name: meta.name,
            cost: meta.cost || 0,
            slotType: meta.item_slot_type,
            type: 'counter',
            advantage: Math.round(adv * 100),
            reason: `Strong counter choice against ${enemyName} (+${Math.round(adv * 100)}% WinRate)`,
            avgPurchaseTimeS: itemData.total > 0 ? Math.round(itemData.totalTime / itemData.total) : 0,
          });
        }
      }
    }

    for (let idx = 0; idx < dto.teammates.length; idx++) {
      const allyId = dto.teammates[idx];
      const dbAllyId = dbTeammates[idx];
      const allyName = heroesMap[String(allyId)]?.name || `Hero_${allyId}`;
      let countWithAlly = 0;
      let winsWithAlly = 0;
      for (const p of players) {
        if (teammateMap[p.matchId].has(dbAllyId)) {
          countWithAlly++;
          if (p.won) winsWithAlly++;
        }
      }
      if (countWithAlly < 5) continue;

      const itemStats: Record<number, { wins: number; total: number; totalTime: number }> = {};
      for (const p of players) {
        if (!teammateMap[p.matchId].has(dbAllyId)) continue;
        const boughtItemIds = this.getEffectiveFinalItems(p.itemPurchases || []);
        for (const itemId of boughtItemIds) {
          if (!itemStats[itemId]) itemStats[itemId] = { wins: 0, total: 0, totalTime: 0 };
          itemStats[itemId].total++;
          if (p.won) itemStats[itemId].wins++;
          const purchase = (p.itemPurchases || []).find((i) => Number(i.itemId) === itemId);
          itemStats[itemId].totalTime += purchase?.purchaseTimeS || 0;
        }
      }

      for (const [itemIdStr, itemData] of Object.entries(itemStats)) {
        if (itemData.total < 3 || (countWithAlly - itemData.total) < 3) continue;
        const itemId = parseInt(itemIdStr, 10);
        const meta = itemsMap[itemIdStr];
        if (!meta) continue;

        const wrWith = itemData.wins / itemData.total;
        const wrWithout = (winsWithAlly - itemData.wins) / (countWithAlly - itemData.total);
        const adv = wrWith - wrWithout;

        if (adv >= 0.05) {
          adjustments.push({
            id: itemId,
            name: meta.name,
            cost: meta.cost || 0,
            slotType: meta.item_slot_type,
            type: 'synergy',
            advantage: Math.round(adv * 100),
            reason: `Great synergy choice with teammate ${allyName} (+${Math.round(adv * 100)}% WinRate)`,
            avgPurchaseTimeS: itemData.total > 0 ? Math.round(itemData.totalTime / itemData.total) : 0,
          });
        }
      }
    }

    const uniqueAdjustments: Record<number, RecommendationAdjustmentItem> = {};
    for (const adj of adjustments) {
      if (!uniqueAdjustments[adj.id] || adj.advantage > uniqueAdjustments[adj.id].advantage) {
        uniqueAdjustments[adj.id] = adj;
      }
    }

    // Filter out items already present in the core/situational build — no point
    // Filter out items already present ANYWHERE in the base build —
    // core, situational, or any phase (early / mid / late).
    // This prevents the same item appearing twice and exceeding the slot budget.
    const baseBuildItemIds = new Set<number>([
      ...(baseBuild?.coreItems || []).map((i) => i.id),
      ...(baseBuild?.situationalItems || []).map((i) => i.id),
      ...(baseBuild?.phases?.early || []).map((i) => i.id),
      ...(baseBuild?.phases?.mid || []).map((i) => i.id),
      ...(baseBuild?.phases?.late || []).map((i) => i.id),
    ]);

    const sortedAdjustments = Object.values(uniqueAdjustments)
      .sort((a, b) => b.advantage - a.advantage)
      .filter((adj) => !baseBuildItemIds.has(adj.id))
      .slice(0, MAX_ADJUSTMENTS);

    return {
      heroId: requestHeroId,
      heroName,
      recommendedBuildType,
      suitabilityScore: Math.round(maxScore * 100),
      baseBuild,
      matchupAdjustments: sortedAdjustments,
    };
  }

  private computeMatchups(
    players: MatchPlayer[],
    enemyPlayers: MatchPlayer[],
    heroesMap: Record<string, { hero_id: number; name: string }>,
    itemsMap: ItemsMap,
  ): MatchupAnalysis[] {
    const enemyMap: Record<number, number[]> = {};
    const ourPlayerMap: Record<number, MatchPlayer> = {};
    for (const p of players) {
      ourPlayerMap[p.matchId] = p;
    }

    for (const ep of enemyPlayers) {
      const ourP = ourPlayerMap[ep.matchId];
      if (!ourP) continue;
      if (ep.team !== ourP.team) {
        if (!enemyMap[ep.matchId]) enemyMap[ep.matchId] = [];
        enemyMap[ep.matchId].push(ep.heroId);
      }
    }

    const enemyStats: Record<number, { matchCount: number; wins: number; matchIds: number[] }> = {};
    for (const p of players) {
      const enemies = enemyMap[p.matchId] || [];
      for (const enemyHeroId of enemies) {
        if (!enemyStats[enemyHeroId]) {
          enemyStats[enemyHeroId] = { matchCount: 0, wins: 0, matchIds: [] };
        }
        enemyStats[enemyHeroId].matchCount++;
        enemyStats[enemyHeroId].matchIds.push(p.matchId);
        if (p.won) {
          enemyStats[enemyHeroId].wins++;
        }
      }
    }

    const matchupList: MatchupAnalysis[] = [];

    for (const [enemyIdStr, stats] of Object.entries(enemyStats)) {
      const enemyHeroId = parseInt(enemyIdStr, 10);
      if (stats.matchCount < 5) continue;

      const winRate = Math.round((stats.wins / stats.matchCount) * 100);

      let bestBuildType: BuildType = 'weapon';
      let bestWR = -1;
      let bestCount = 0;

      const buildsStats: Record<BuildType, { wins: number; total: number }> = {
        weapon: { wins: 0, total: 0 },
        spirit: { wins: 0, total: 0 },
        vitality: { wins: 0, total: 0 },
      };

      for (const matchId of stats.matchIds) {
        const ourP = ourPlayerMap[matchId];
        if (!ourP) continue;

        const purchases = ourP.itemPurchases || [];
        let wSpend = 0, sSpend = 0, vSpend = 0;
        for (const pur of purchases) {
          const meta = itemsMap[String(pur.itemId)];
          if (!meta) continue;
          if (meta.item_slot_type === 'weapon') wSpend += meta.cost || 0;
          else if (meta.item_slot_type === 'spirit') sSpend += meta.cost || 0;
          else if (meta.item_slot_type === 'vitality') vSpend += meta.cost || 0;
        }
        const bType: BuildType =
          wSpend >= sSpend && wSpend >= vSpend
            ? 'weapon'
            : sSpend >= vSpend
            ? 'spirit'
            : 'vitality';

        buildsStats[bType].total++;
        if (ourP.won) buildsStats[bType].wins++;
      }

      for (const bType of ['weapon', 'spirit', 'vitality'] as BuildType[]) {
        const bStat = buildsStats[bType];
        if (bStat.total >= 3) {
          const wr = bStat.wins / bStat.total;
          if (wr > bestWR || (wr === bestWR && bStat.total > bestCount)) {
            bestWR = wr;
            bestBuildType = bType;
            bestCount = bStat.total;
          }
        }
      }

      const itemStats: Record<number, { winsWith: number; countWith: number }> = {};
      for (const matchId of stats.matchIds) {
        const ourP = ourPlayerMap[matchId];
        if (!ourP) continue;
        const boughtItemIds = this.getEffectiveFinalItems(ourP.itemPurchases || []);

        for (const itemId of boughtItemIds) {
          if (!itemStats[itemId]) {
            itemStats[itemId] = { winsWith: 0, countWith: 0 };
          }
          itemStats[itemId].countWith++;
          if (ourP.won) {
            itemStats[itemId].winsWith++;
          }
        }
      }

      const counterItems: MatchupAnalysis['counterItems'] = [];
      for (const [itemIdStr, itemData] of Object.entries(itemStats)) {
        const itemId = parseInt(itemIdStr, 10);
        const meta = itemsMap[itemIdStr];
        if (!meta) continue;

        const countWith = itemData.countWith;
        const winsWith = itemData.winsWith;
        const winRateWith = countWith > 0 ? (winsWith / countWith) * 100 : 0;

        const countWithout = stats.matchCount - countWith;
        const winsWithout = stats.wins - winsWith;
        const winRateWithout = countWithout > 0 ? (winsWithout / countWithout) * 100 : 0;

        const advantage = winRateWith - winRateWithout;

        if (countWith >= 3 && countWithout >= 3 && advantage >= 5) {
          counterItems.push({
            id: itemId,
            name: meta.name,
            cost: meta.cost || 0,
            slotType: meta.item_slot_type,
            winRateWith: Math.round(winRateWith),
            winRateWithout: Math.round(winRateWithout),
            advantage: Math.round(advantage),
          });
        }
      }

      counterItems.sort((a, b) => b.advantage - a.advantage);

      const enemyName = heroesMap[String(enemyHeroId)]?.name || `Hero_${enemyHeroId}`;
      matchupList.push({
        enemyHeroId,
        enemyHeroName: enemyName,
        matchCount: stats.matchCount,
        winRate,
        bestBuildType,
        counterItems: counterItems.slice(0, 3),
      });
    }

    return matchupList.sort((a, b) => b.matchCount - a.matchCount);
  }

  private computeSkillCorrelations(
    players: MatchPlayer[],
    itemsMap: ItemsMap,
  ): SkillCorrelation[] {
    const playerPrimarySkills: Record<number, number> = {};
    const skillGroups: Record<number, MatchPlayer[]> = { 1: [], 2: [], 3: [], 4: [] };

    for (const p of players) {
      const skills = [...(p.skillUpgrades || [])].sort((a, b) => a.upgradeOrder - b.upgradeOrder);
      const earlySkills = skills.slice(0, 6);
      const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

      for (const upgrade of earlySkills) {
        const rawAbilityId = Number(upgrade.abilityId);
        const skillId = rawAbilityId > 4 ? mapAbilityToSkillNumber(p.heroId, rawAbilityId) : rawAbilityId;
        if (skillId >= 1 && skillId <= 4) {
          counts[skillId]++;
        }
      }

      let primarySkill = 1;
      let maxCount = -1;
      for (let s = 1; s <= 4; s++) {
        if (counts[s] > maxCount) {
          maxCount = counts[s];
          primarySkill = s;
        }
      }

      playerPrimarySkills[p.id] = primarySkill;
      skillGroups[primarySkill].push(p);
    }

    const correlations: SkillCorrelation[] = [];
    const skillNames = [
      'Skill 1 (Active)',
      'Skill 2 (Active)',
      'Skill 3 (Active)',
      'Skill 4 (Ultimate)',
    ];

    for (let s = 1; s <= 4; s++) {
      const groupS = skillGroups[s];
      const groupOther = players.filter((p) => playerPrimarySkills[p.id] !== s);

      if (groupS.length < 5 || groupOther.length < 5) {
        correlations.push({
          skillNumber: s,
          skillName: skillNames[s - 1],
          correlatedItems: [],
        });
        continue;
      }

      const itemCountsS: Record<number, number> = {};
      const itemCountsOther: Record<number, number> = {};

      for (const p of groupS) {
        const itemIds = new Set((p.itemPurchases || []).map((i) => Number(i.itemId)));
        for (const id of itemIds) {
          itemCountsS[id] = (itemCountsS[id] || 0) + 1;
        }
      }

      for (const p of groupOther) {
        const itemIds = new Set((p.itemPurchases || []).map((i) => Number(i.itemId)));
        for (const id of itemIds) {
          itemCountsOther[id] = (itemCountsOther[id] || 0) + 1;
        }
      }

      const correlatedItems: SkillCorrelation['correlatedItems'] = [];
      const allItemIds = new Set([
        ...Object.keys(itemCountsS).map(Number),
        ...Object.keys(itemCountsOther).map(Number),
      ]);

      for (const itemId of allItemIds) {
        const meta = itemsMap[String(itemId)];
        if (!meta) continue;

        const pickRateWith = (itemCountsS[itemId] || 0) / groupS.length;
        const pickRateWithout = (itemCountsOther[itemId] || 0) / groupOther.length;
        const correlationStrength = pickRateWith - pickRateWithout;

        if (pickRateWith >= 0.25 && correlationStrength >= 0.15) {
          correlatedItems.push({
            id: itemId,
            name: meta.name,
            cost: meta.cost || 0,
            slotType: meta.item_slot_type,
            pickRateWith: Math.round(pickRateWith * 100),
            pickRateWithout: Math.round(pickRateWithout * 100),
            correlationStrength: Math.round(correlationStrength * 100),
          });
        }
      }

      correlatedItems.sort((a, b) => b.correlationStrength - a.correlationStrength);

      correlations.push({
        skillNumber: s,
        skillName: skillNames[s - 1],
        correlatedItems: correlatedItems.slice(0, 5),
      });
    }

    return correlations;
  }

  private computeBuilds(players: MatchPlayer[], itemsMap: ItemsMap): HeroBuild[] {
    // ─── Step 1: Cluster players by dominant spend (weapon / spirit / vitality) ───
    const clusterPlayers = (buildType: BuildType) =>
      players.filter((p) => {
        const purchases = p.itemPurchases || [];
        let weaponSpend = 0;
        let spiritSpend = 0;
        let vitalitySpend = 0;
        for (const purchase of purchases) {
          const meta = itemsMap[String(purchase.itemId)];
          if (!meta) continue;
          const cost = meta.cost || 0;
          if (meta.item_slot_type === 'weapon') weaponSpend += cost;
          else if (meta.item_slot_type === 'spirit') spiritSpend += cost;
          else if (meta.item_slot_type === 'vitality') vitalitySpend += cost;
        }
        const dominant =
          weaponSpend >= spiritSpend && weaponSpend >= vitalitySpend
            ? 'weapon'
            : spiritSpend >= vitalitySpend
            ? 'spirit'
            : 'vitality';
        return dominant === buildType;
      });

    const clusters: BuildType[] = ['weapon', 'spirit', 'vitality'];
    const results: HeroBuild[] = [];

    for (const buildType of clusters) {
      const group = clusterPlayers(buildType);
      if (group.length < 10) continue; // не показываем кластер с малым кол-вом данных

      const build = this.computeClusterBuild(buildType, group, itemsMap);
      results.push(build);
    }

    return results;
  }

  private computeClusterBuild(
    buildType: BuildType,
    players: MatchPlayer[],
    itemsMap: ItemsMap,
  ): HeroBuild {
    const totalMatches = players.length;
    const wins = players.filter((p) => p.won).length;
    const winRate = Math.round((wins / totalMatches) * 100);
    const avgNetWorth = Math.round(
      players.reduce((sum, p) => sum + (p.netWorth || 0), 0) / totalMatches,
    );

    // ─── Step 2: Collect item data with timing and win info ───
    type ItemEntry = { count: number; wins: number; totalTime: number };
    const earlyItems: Record<number, ItemEntry> = {}; // < 480s (8 min)
    const midItems:   Record<number, ItemEntry> = {}; // 480–1200s
    const lateItems:  Record<number, ItemEntry> = {}; // > 1200s
    const allItemData: Record<number, ItemEntry> = {};

    const EARLY_CUTOFF = 480;
    const MID_CUTOFF = 1200;
    const actualAverageTimesByItem = this.computeActualAverageTimesByItem(players);

    // Track total buys vs final keeps to determine if an item is temporary or permanent
    const totalPurchasedCount = new Map<number, number>();
    const finalPurchasedCount = new Map<number, number>();

    for (const p of players) {
      const reconstructedPurchases = this.reconstructPurchases(
        p.itemPurchases || [],
        itemsMap,
        actualAverageTimesByItem,
      );

      // Get the set of items that were kept at the end of this match
      const finalItemIds = this.getEffectiveFinalItems(p.itemPurchases || []);

      for (const purchase of reconstructedPurchases) {
        const itemId = Number(purchase.itemId);
        const time = purchase.purchaseTimeS || 0;
        const won = p.won ? 1 : 0;
        const isFinal = finalItemIds.has(itemId);

        // Track finality
        totalPurchasedCount.set(itemId, (totalPurchasedCount.get(itemId) || 0) + 1);
        if (isFinal) {
          finalPurchasedCount.set(itemId, (finalPurchasedCount.get(itemId) || 0) + 1);
        }

        // Core/Situational items (allItemData) must represent final permanent items
        if (isFinal) {
          if (!allItemData[itemId]) allItemData[itemId] = { count: 0, wins: 0, totalTime: 0 };
          allItemData[itemId].count++;
          allItemData[itemId].wins += won;
          allItemData[itemId].totalTime += time;
        }

        // Phase items: early and mid can contain temporary items (like Extra Regen or Golden Goose Egg),
        // but late-game items must be part of the final permanent build.
        const isLate = time >= MID_CUTOFF;
        if (isLate) {
          if (isFinal) {
            if (!lateItems[itemId]) lateItems[itemId] = { count: 0, wins: 0, totalTime: 0 };
            lateItems[itemId].count++;
            lateItems[itemId].wins += won;
            lateItems[itemId].totalTime += time;
          }
        } else {
          const bucket = time < EARLY_CUTOFF ? earlyItems : midItems;
          if (!bucket[itemId]) bucket[itemId] = { count: 0, wins: 0, totalTime: 0 };
          bucket[itemId].count++;
          bucket[itemId].wins += won;
          bucket[itemId].totalTime += time;
        }
      }
    }

    // ─── Step 3: Score items with win-weighted formula ───
    const scoreItems = (
      bucket: Record<number, ItemEntry>,
      bucketTotalPlayers: number,
    ): PhaseItem[] => {
      return Object.entries(bucket)
        .map(([idStr, data]) => {
          const meta = itemsMap[idStr];
          if (!meta) return null;

          const allPickRate = data.count / bucketTotalPlayers; // 0–1
          const winPickRate = data.wins > 0 ? data.wins / wins : 0; // fraction of all winners who bought this

          // Win-weighted score: 65% win pick rate + 35% all pick rate, scaled 0-100
          const rawScore = winPickRate * 0.65 + allPickRate * 0.35;
          const score = Math.round(rawScore * 100);

          const totalBought = totalPurchasedCount.get(parseInt(idStr, 10)) || 1;
          const finalKept = finalPurchasedCount.get(parseInt(idStr, 10)) || 0;
          // If kept in at least 50% of matches where bought, treat as a permanent build item.
          // Starters like Extra Regen or Egg will fall below this threshold in high-rank games.
          const isPermanent = (finalKept / totalBought) >= 0.50;

          return {
            id: parseInt(idStr, 10),
            name: meta.name,
            cost: meta.cost || 0,
            slotType: meta.item_slot_type,
            score,
            avgPurchaseTimeS: Math.round(data.totalTime / data.count),
            isPermanent,
            componentItemIds: [...(this.itemComponentsMapCache?.[parseInt(idStr, 10)] || [])],
          } as PhaseItem;
        })
        .filter((item): item is PhaseItem => item !== null && item.score >= 10)
        .sort((a, b) => b.score - a.score);
    };

    const earlyPlayers  = players.filter((p) => (p.itemPurchases || []).some((i) => (i.purchaseTimeS || 0) < EARLY_CUTOFF)).length || totalMatches;
    const midPlayers    = players.filter((p) => (p.itemPurchases || []).some((i) => { const t = i.purchaseTimeS || 0; return t >= EARLY_CUTOFF && t < MID_CUTOFF; })).length || totalMatches;
    const latePlayers   = players.filter((p) => (p.itemPurchases || []).some((i) => (i.purchaseTimeS || 0) >= MID_CUTOFF)).length || totalMatches;

    const earlyScored = scoreItems(earlyItems, earlyPlayers);
    const midScored   = scoreItems(midItems,   midPlayers);
    const lateScored  = scoreItems(lateItems,  latePlayers);
    const allScored   = scoreItems(allItemData, totalMatches);

    // A build guide should place each item into one phase only.
    // If an item appears across multiple timing buckets, keep it in the strongest bucket,
    // breaking ties in favor of the earlier phase.
    const phasePriority = { early: 0, mid: 1, late: 2 } as const;
    const preferredPhaseByItem = new Map<number, keyof typeof phasePriority>();

    const registerPreferredPhase = (phase: keyof typeof phasePriority, items: PhaseItem[]) => {
      for (const item of items) {
        const existingPhase = preferredPhaseByItem.get(item.id);
        if (!existingPhase) {
          preferredPhaseByItem.set(item.id, phase);
          continue;
        }

        const existingItem =
          existingPhase === 'early'
            ? earlyScored.find((candidate) => candidate.id === item.id)
            : existingPhase === 'mid'
            ? midScored.find((candidate) => candidate.id === item.id)
            : lateScored.find((candidate) => candidate.id === item.id);

        const existingScore = existingItem?.score ?? -1;
        if (
          item.score > existingScore ||
          (item.score === existingScore && phasePriority[phase] < phasePriority[existingPhase])
        ) {
          preferredPhaseByItem.set(item.id, phase);
        }
      }
    };

    registerPreferredPhase('early', earlyScored);
    registerPreferredPhase('mid', midScored);
    registerPreferredPhase('late', lateScored);

    const uniquePhaseItems = (phase: keyof typeof phasePriority, items: PhaseItem[]) =>
      items
        .filter((item) => preferredPhaseByItem.get(item.id) === phase)
        .sort((a, b) => {
          if (a.avgPurchaseTimeS !== b.avgPurchaseTimeS) {
            return a.avgPurchaseTimeS - b.avgPurchaseTimeS;
          }
          return b.score - a.score;
        });

    // ─── Step 4: Core vs Situational from all-items ───
    const coreItems        = allScored.filter((i) => i.score >= 60).slice(0, MAX_CORE_ITEMS);
    const situationalItems = allScored.filter((i) => i.score >= 35 && i.score < 60).slice(0, MAX_SITUATIONAL_ITEMS);

    // ─── Step 5: Win-weighted skill order ───
    // skillSlots[pos][skillId] = { wins, total }
    const skillSlots: Record<number, Record<number, { wins: number; total: number }>> = {};

    for (const p of players) {
      const skills = [...(p.skillUpgrades || [])].sort((a, b) => a.upgradeOrder - b.upgradeOrder);
      for (const skillUpgrade of skills) {
        const pos = skillUpgrade.upgradeOrder;
        const rawAbilityId = Number(skillUpgrade.abilityId);
        const skillId = rawAbilityId > 4 ? mapAbilityToSkillNumber(p.heroId, rawAbilityId) : rawAbilityId;
        if (!skillSlots[pos]) skillSlots[pos] = {};
        if (!skillSlots[pos][skillId]) skillSlots[pos][skillId] = { wins: 0, total: 0 };
        skillSlots[pos][skillId].total++;
        if (p.won) skillSlots[pos][skillId].wins++;
      }
    }

    const skillsOrder: number[] = [];
    for (let pos = 0; pos < 16; pos++) {
      const slot = skillSlots[pos] || {};
      let bestSkill = skillsOrder[pos - 1] || 1;
      let bestScore = -1;

      for (const [skillIdStr, data] of Object.entries(slot)) {
        if (data.total === 0) continue;
        // Win-weighted: 60% win rate of this pick + 40% pick frequency
        const winRate_skill = data.wins / data.total;
        const pickFreq = data.total / totalMatches;
        const skillScore = winRate_skill * 0.6 + pickFreq * 0.4;
        if (skillScore > bestScore) {
          bestScore = skillScore;
          bestSkill = parseInt(skillIdStr, 10);
        }
      }
      skillsOrder.push(bestSkill);
    }
    const skillBuild = this.buildSkillActions(skillsOrder);

    const slicePhaseItems = (items: PhaseItem[], maxPermanent: number, maxTemporary: number) => {
      const permanent: PhaseItem[] = [];
      const temporary: PhaseItem[] = [];
      for (const item of items) {
        if (item.isPermanent) {
          if (permanent.length < maxPermanent) permanent.push(item);
        } else {
          if (temporary.length < maxTemporary) temporary.push(item);
        }
      }
      return [...permanent, ...temporary].sort((a, b) => a.avgPurchaseTimeS - b.avgPurchaseTimeS);
    };

    return {
      buildType,
      matchCount: totalMatches,
      winRate,
      avgNetWorth,
      skillsOrder,
      skillBuild,
      phases: {
        early: slicePhaseItems(uniquePhaseItems('early', earlyScored), 4, 2), // 4 permanent + 2 temporary (Extra Regen, Egg, etc.)
        mid:   slicePhaseItems(uniquePhaseItems('mid',   midScored),   6, 2), // 6 permanent + 2 temporary
        late:  slicePhaseItems(uniquePhaseItems('late',  lateScored),  6, 0), // 6 permanent + 0 temporary
      },
      coreItems,
      situationalItems,
    };
  }

  private computeActualAverageTimesByItem(players: MatchPlayer[]): Record<number, number> {
    const timings: Record<number, { total: number; count: number }> = {};

    for (const player of players) {
      for (const purchase of player.itemPurchases || []) {
        const itemId = Number(purchase.itemId);
        const purchaseTimeS = purchase.purchaseTimeS || 0;
        if (!timings[itemId]) {
          timings[itemId] = { total: 0, count: 0 };
        }
        timings[itemId].total += purchaseTimeS;
        timings[itemId].count += 1;
      }
    }

    return Object.entries(timings).reduce<Record<number, number>>((acc, [itemId, data]) => {
      acc[Number(itemId)] = Math.round(data.total / data.count);
      return acc;
    }, {});
  }

  private buildSkillActions(skillsOrder: number[]): SkillBuildAction[] {
    const upgradeCosts = [1, 2, 5];
    const seenBySkill = new Map<number, number>();
    const actions: SkillBuildAction[] = [];

    for (const skill of skillsOrder) {
      const normalizedSkill = Number(skill);
      if (!Number.isFinite(normalizedSkill) || normalizedSkill < 1 || normalizedSkill > 4) {
        continue;
      }

      const seenCount = seenBySkill.get(normalizedSkill) || 0;
      if (seenCount === 0) {
        actions.push({
          step: actions.length + 1,
          skill: normalizedSkill,
          action: 'UNLOCK',
          upgradeTier: 0,
          pointCost: 1,
        });
        seenBySkill.set(normalizedSkill, 1);
        continue;
      }

      const upgradeTier = seenCount;
      if (upgradeTier > upgradeCosts.length) {
        continue;
      }

      actions.push({
        step: actions.length + 1,
        skill: normalizedSkill,
        action: 'UPGRADE',
        upgradeTier,
        pointCost: upgradeCosts[upgradeTier - 1],
      });
      seenBySkill.set(normalizedSkill, seenCount + 1);
    }

    return actions;
  }

  /**
   * Returns the set of item IDs that represent the player's EFFECTIVE final build:
   *   - Excludes items explicitly sold during the match (soldTimeS > 0).
   *   - Excludes component/base items that were consumed into an upgrade present
   *     in the same purchase list (e.g. High-Velocity Rounds when Opening Rounds
   *     was also bought – they occupy the same slot).
   *
   * This is the correct input for win-rate item stats so that sold starters and
   * upgraded base items don't distort counter/synergy recommendations.
   */
  private getEffectiveFinalItems(purchases: MatchPlayerItem[]): Set<number> {
    // Step 1: drop items that were sold during the match.
    const held = purchases.filter((p) => !p.soldTimeS || p.soldTimeS === 0);
    const heldIds = new Set(held.map((p) => Number(p.itemId)));

    // Step 2: drop base items consumed into an upgrade that is also held.
    // The component map: parentItemId → [componentItemIds].
    // If component C is held AND its parent P is also held, C was consumed → exclude C.
    const recipeMap = this.itemComponentsMapCache || {};
    const consumed = new Set<number>();
    for (const parentId of heldIds) {
      for (const compId of (recipeMap[parentId] || [])) {
        if (heldIds.has(compId)) {
          consumed.add(compId);
        }
      }
    }

    return new Set([...heldIds].filter((id) => !consumed.has(id)));
  }

  private reconstructPurchases(
    rawPurchases: MatchPlayerItem[],
    itemsMap: ItemsMap,
    actualAverageTimesByItem: Record<number, number>,
  ): { itemId: number; purchaseTimeS: number }[] {
    const orderedRawPurchases = [...rawPurchases]
      .map((purchase) => ({
        itemId: Number(purchase.itemId),
        purchaseTimeS: purchase.purchaseTimeS || 0,
        soldTimeS: purchase.soldTimeS || 0,
      }))
      .sort((a, b) => a.purchaseTimeS - b.purchaseTimeS);

    const reconstructed: { itemId: number; purchaseTimeS: number }[] = [];
    const availablePriorItemIds = new Set<number>();

    for (const purchase of orderedRawPurchases) {
      const componentTimeline = this.buildComponentTimeline(
        purchase.itemId,
        purchase.purchaseTimeS,
        itemsMap,
        actualAverageTimesByItem,
        availablePriorItemIds,
        new Set<number>(),
      );

      reconstructed.push(...componentTimeline, {
        itemId: purchase.itemId,
        purchaseTimeS: purchase.purchaseTimeS,
      });

      componentTimeline.forEach((item) => availablePriorItemIds.add(item.itemId));
      availablePriorItemIds.add(purchase.itemId);
    }

    return reconstructed.sort((a, b) => {
      if (a.purchaseTimeS !== b.purchaseTimeS) {
        return a.purchaseTimeS - b.purchaseTimeS;
      }
      return a.itemId - b.itemId;
    });
  }

  private buildComponentTimeline(
    parentItemId: number,
    parentPurchaseTimeS: number,
    itemsMap: ItemsMap,
    actualAverageTimesByItem: Record<number, number>,
    availablePriorItemIds: Set<number>,
    visited: Set<number>,
  ): { itemId: number; purchaseTimeS: number }[] {
    const recipeMap = this.itemComponentsMapCache || {};
    const componentItemIds = recipeMap[parentItemId] || [];
    if (componentItemIds.length === 0 || visited.has(parentItemId)) {
      return [];
    }

    visited.add(parentItemId);
    const parentCost = itemsMap[String(parentItemId)]?.cost || 0;
    const result: { itemId: number; purchaseTimeS: number }[] = [];

    componentItemIds.forEach((componentItemId, index) => {
      if (availablePriorItemIds.has(componentItemId)) {
        return;
      }

      const componentCost = itemsMap[String(componentItemId)]?.cost || 0;
      const estimatedGapByCost = parentCost > 0 ? Math.round((componentCost / parentCost) * 90) : 45;
      const fallbackTime = Math.max(0, parentPurchaseTimeS - estimatedGapByCost - ((componentItemIds.length - index) * 15));
      const actualAverageTime = actualAverageTimesByItem[componentItemId];
      const estimatedPurchaseTimeS =
        actualAverageTime !== undefined && actualAverageTime < parentPurchaseTimeS
          ? actualAverageTime
          : Math.max(0, Math.min(parentPurchaseTimeS - 1, fallbackTime));

      result.push(
        ...this.buildComponentTimeline(
          componentItemId,
          estimatedPurchaseTimeS,
          itemsMap,
          actualAverageTimesByItem,
          availablePriorItemIds,
          new Set(visited),
        ),
      );
      result.push({
        itemId: componentItemId,
        purchaseTimeS: estimatedPurchaseTimeS,
      });
      availablePriorItemIds.add(componentItemId);
    });

    return result.sort((a, b) => {
      if (a.purchaseTimeS !== b.purchaseTimeS) {
        return a.purchaseTimeS - b.purchaseTimeS;
      }
      return a.itemId - b.itemId;
    });
  }

  async startCrawling() {
    if (this.isCrawling) {
      return;
    }

    this.isCrawling = true;
    this.activeRunId = await this.createCrawlerRun();
    this.progress = {
      isCrawling: true,
      current: 0,
      total: 0,
      currentHero: '',
      status: 'Starting crawl...',
    };
    await this.syncCrawlerState();

    void this.runCrawl().catch((err) => {
      this.logger.error('Crawl failed:', err);
      this.progress.status = `Failed: ${err.message}`;
      this.isCrawling = false;
      this.progress.isCrawling = false;
      void this.finalizeCrawlerRun('failed', err.message);
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledCrawl() {
    this.logger.log('Starting scheduled daily crawl for all heroes');
    await this.startCrawling();
  }

  private async runCrawl() {
    try {
      // 1. Get already-processed match IDs from DB
      this.progress.status = 'Loading processed match IDs from database...';
      const existingMatches = await this.matchRepo.find({ select: { matchId: true } });
      const processedIds = new Set(existingMatches.map((m) => m.matchId));
      this.logger.log(`Already have ${processedIds.size} matches in DB`);

      // 2. Paginate through high-rank matches
      this.progress.status = 'Fetching match list from API...';
      await this.syncCrawlerState();
      const newMatchIds = await this.fetchCandidateMatchIds(processedIds, MAX_CRAWL_MATCHES);

      this.progress.total = newMatchIds.length;
      this.logger.log(`Found ${newMatchIds.length} new matches to process`);
      await this.updateCrawlerRun({ discoveredMatches: newMatchIds.length, targetMatches: newMatchIds.length });
      await this.syncCrawlerState();

      // 3. Process each new match
      for (let i = 0; i < newMatchIds.length; i++) {
        const matchId = newMatchIds[i];
        this.progress.current = i + 1;
        this.progress.status = `Processing match ${i + 1}/${newMatchIds.length}: ${matchId}`;
        await this.updateCrawlerRun({ processedMatches: i, currentMatchId: matchId, statusMessage: this.progress.status });
        await this.syncCrawlerState(matchId);

        try {
          await this.processMatch(matchId);
        } catch (err) {
          this.logger.warn(`Failed to process match ${matchId}: ${(err as any).message}`);
          if ((err as any).response?.status === 429) {
            this.progress.status = 'Rate limited, waiting 60s...';
            await this.sleep(RATE_LIMIT_WAIT_MS);
            // Retry this match
            try {
              await this.processMatch(matchId);
            } catch (retryErr) {
              this.logger.warn(`Retry failed for match ${matchId}: ${(retryErr as any).message}`);
            }
          }
        }

        await this.sleep(REQUEST_DELAY_MS);
      }

      // 4. Trim old records per hero (keep max 1000)
      this.progress.status = 'Trimming old records...';
      await this.syncCrawlerState();
      await this.trimOldRecords();

      this.progress.status = 'Crawl finished successfully!';
      this.logger.log('Crawl completed');
      await this.finalizeCrawlerRun('completed');
    } catch (err) {
      this.logger.error('Crawl error:', err);
      this.progress.status = `Crawl aborted: ${(err as any).message}`;
      await this.finalizeCrawlerRun('failed', (err as any).message);
    } finally {
      this.isCrawling = false;
      this.progress.isCrawling = false;
      await this.syncCrawlerState();
    }
  }

  private async fetchCandidateMatchIds(processedIds: Set<number>, targetCount: number): Promise<number[]> {
    const newMatchIds: number[] = [];
    const seenMatchIds = new Set<number>();
    let maxMatchId: number | undefined;

    while (newMatchIds.length < targetCount) {
      try {
        const res = await axios.get(`${API_BASE}/v1/matches/metadata`, {
          ...getDeadlockApiRequestConfig(),
          params: {
            min_average_badge: MIN_BADGE,
            order_by: 'match_id',
            order_direction: 'desc',
            limit: Math.min(1000, targetCount - newMatchIds.length),
            ...(maxMatchId !== undefined ? { max_match_id: maxMatchId } : {}),
          },
        });
        const matches: any[] = res.data || [];

        if (matches.length === 0) {
          break;
        }

        let oldestMatchId: number | undefined;
        for (const match of matches) {
          const matchId = match?.match_id;
          if (typeof matchId !== 'number') {
            continue;
          }

          oldestMatchId = oldestMatchId === undefined ? matchId : Math.min(oldestMatchId, matchId);

          if (processedIds.has(matchId) || seenMatchIds.has(matchId)) {
            continue;
          }

          seenMatchIds.add(matchId);
          newMatchIds.push(matchId);

          if (newMatchIds.length >= targetCount) {
            break;
          }
        }

        if (oldestMatchId === undefined) {
          break;
        }

        const nextMaxMatchId = oldestMatchId - 1;
        if (maxMatchId !== undefined && nextMaxMatchId >= maxMatchId) {
          this.logger.warn(`Match pagination did not advance at max_match_id=${maxMatchId}, stopping discovery`);
          break;
        }

        maxMatchId = nextMaxMatchId;
        await this.sleep(REQUEST_DELAY_MS);
      } catch (err) {
        this.logger.warn(`Failed to fetch match list page before match_id ${maxMatchId ?? 'latest'}: ${(err as any).message}`);
        if ((err as any).response?.status === 429) {
          this.progress.status = 'Rate limited, waiting 60s...';
          await this.sleep(RATE_LIMIT_WAIT_MS);
          continue;
        }
        break;
      }
    }

    return newMatchIds;
  }

  private async processMatch(matchId: number) {
    const itemsMap = await this.loadItemsMap();
    const res = await axios.get(
      `${API_BASE}/v1/matches/${matchId}/metadata`,
      getDeadlockApiRequestConfig(),
    );
    const data = res.data;
    const matchInfo = data?.match_info;
    if (!matchInfo) return;

    const players: any[] = matchInfo.players || [];
    if (players.length === 0) return;

    const winningTeam = matchInfo.winning_team;
    const startTime = new Date((matchInfo.start_time || 0) * 1000);
    const durationS = matchInfo.duration_s || 0;
    const avgBadge = Math.max(
      matchInfo.average_badge_team0 || 0,
      matchInfo.average_badge_team1 || 0,
    );

    // Upsert match
    let match = await this.matchRepo.findOne({ where: { matchId } });
    if (!match) {
      match = this.matchRepo.create({
        matchId,
        startTime,
        durationS,
        averageBadge: avgBadge,
        winningTeam,
      });
      await this.matchRepo.save(match);
    }

    // Process each player
    for (const p of players) {
      const heroId = p.hero_id;
      if (!heroId) continue;

      const team = p.team;
      const won = team === winningTeam;

      // Extract item history from raw match metadata and separate ability upgrades.
      // `players[].items` contains timestamped events, including sold items.
      const rawItems: any[] = p.items || [];
      const buildItems: any[] = [];
      const skillItems: { abilityId: number; time: number }[] = [];

      for (const item of rawItems) {
        // Ability upgrade: identified by item_id matching a known hero ability
        // NOTE: imbued_ability_id is always 0 in the API — skills are detected by item_id
        if (isAbilityItem(heroId, item.item_id)) {
          skillItems.push({
            abilityId: item.item_id,
            time: item.game_time_s || 0,
          });
          continue;
        }

        // Regular item
        const mapped = itemsMap[String(item.item_id)];
        if (mapped) {
          buildItems.push({
            id: item.item_id,
            name: mapped.name,
            cost: mapped.cost,
            slotType: mapped.item_slot_type,
            purchaseTimeS: item.game_time_s || 0,
            soldTimeS: item.sold_time_s || 0,
            upgradeId: item.upgrade_id || 0,
            flags: item.flags || 0,
            imbuedAbilityId: item.imbued_ability_id || 0,
            upgradeInfo: item.upgrade_info || 0,
          });
        }
      }

      // Skills order: sort by time, take ability IDs, limit to 16
      const skillsOrder = skillItems
        .sort((a, b) => a.time - b.time)
        .map((s) => mapAbilityToSkillNumber(heroId, s.abilityId))
        .slice(0, 16);

      // Upsert match_player
      const existing = await this.matchPlayerRepo.findOne({
        where: { matchId, heroId },
        relations: {
          itemPurchases: true,
          skillUpgrades: true,
        },
      });

      let player = existing;
      if (existing) {
        existing.team = team;
        existing.won = won;
        existing.kills = p.kills || 0;
        existing.deaths = p.deaths || 0;
        existing.assists = p.assists || 0;
        existing.netWorth = p.net_worth || 0;
        player = await this.matchPlayerRepo.save(existing);
      } else {
        const mp = this.matchPlayerRepo.create({
          matchId,
          heroId,
          team,
          won,
          kills: p.kills || 0,
          deaths: p.deaths || 0,
          assists: p.assists || 0,
          netWorth: p.net_worth || 0,
        });
        player = await this.matchPlayerRepo.save(mp);
      }

      await this.matchPlayerItemRepo.delete({ matchPlayerId: player.id });
      await this.matchPlayerSkillUpgradeRepo.delete({ matchPlayerId: player.id });

      if (buildItems.length > 0) {
        await this.matchPlayerItemRepo.save(
          buildItems.map((item, index) =>
            this.matchPlayerItemRepo.create({
              matchPlayerId: player.id,
              itemId: item.id,
              purchaseTimeS: item.purchaseTimeS,
              soldTimeS: item.soldTimeS,
              upgradeId: item.upgradeId,
              flags: item.flags,
              imbuedAbilityId: item.imbuedAbilityId,
              upgradeInfo: item.upgradeInfo,
              slotOrder: index,
            }),
          ),
        );
      }

      if (skillsOrder.length > 0) {
        await this.matchPlayerSkillUpgradeRepo.save(
          skillItems
            .sort((a, b) => a.time - b.time)
            .slice(0, 16)
            .map((s, index) =>
              this.matchPlayerSkillUpgradeRepo.create({
                matchPlayerId: player.id,
                abilityId: mapAbilityToSkillNumber(heroId, s.abilityId),
                upgradeOrder: index,
                upgradeTimeS: s.time,
              }),
            ),
        );
      }
    }
  }

  private async trimOldRecords() {
    const heroCounts = await this.matchPlayerRepo
      .createQueryBuilder('mp')
      .select('mp.heroId', 'heroId')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('mp.heroId')
      .having('COUNT(*) > :max', { max: MAX_MATCHES_PER_HERO })
      .getRawMany();

    for (const row of heroCounts) {
      const heroId = row.heroId;
      const count = parseInt(row.cnt, 10);
      const toDelete = count - MAX_MATCHES_PER_HERO;

      // Get IDs of oldest records to delete
      const oldest = await this.matchPlayerRepo.find({
        where: { heroId },
        order: { crawledAt: 'ASC' },
        take: toDelete,
        select: { id: true },
      });

      if (oldest.length > 0) {
        await this.matchPlayerRepo.delete(oldest.map((o) => o.id));
        this.logger.log(`Trimmed ${oldest.length} old records for hero ${heroId}`);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async loadHeroesMap() {
    if (this.heroesMapCache) {
      return this.heroesMapCache;
    }

    const heroes = await this.heroRepo.find();
    this.heroesMapCache = heroes.reduce<Record<string, { hero_id: number; name: string }>>((acc, hero) => {
      acc[String(hero.heroId)] = { hero_id: hero.heroId, name: hero.name };
      return acc;
    }, {});
    return this.heroesMapCache;
  }

  private async loadItemsMap() {
    if (this.itemsMapCache) {
      return this.itemsMapCache;
    }

    const items = await this.itemRepo.find();
    this.itemsMapCache = items.reduce<
      Record<string, { name: string; class_name: string; item_slot_type: string; cost: number; item_tier: number }>
    >((acc, item) => {
      acc[String(item.itemId)] = {
        name: item.name,
        class_name: item.className,
        item_slot_type: item.itemSlotType,
        cost: item.cost,
        item_tier: item.itemTier,
      };
      return acc;
    }, {});
    return this.itemsMapCache;
  }

  private async loadItemComponentsMap() {
    if (this.itemComponentsMapCache) {
      return this.itemComponentsMapCache;
    }

    const itemComponents = await this.itemComponentRepo.find({
      order: { parentItemId: 'ASC', componentOrder: 'ASC' },
    });

    this.itemComponentsMapCache = itemComponents.reduce<Record<number, number[]>>((acc, row) => {
      if (!acc[row.parentItemId]) {
        acc[row.parentItemId] = [];
      }
      acc[row.parentItemId].push(Number(row.componentItemId));
      return acc;
    }, {});

    return this.itemComponentsMapCache;
  }

  private async syncCrawlerState(currentMatchId: number | null = null) {
    let state = await this.crawlerStateRepo.findOne({ where: { crawlerType: this.crawlerType } });
    if (!state) {
      state = this.crawlerStateRepo.create({ crawlerType: this.crawlerType });
    }

    state.isCrawling = this.progress.isCrawling;
    state.current = this.progress.current;
    state.total = this.progress.total;
    state.currentMatchId = currentMatchId;
    state.status = this.progress.status;
    state.lastError = this.progress.status.startsWith('Failed') || this.progress.status.startsWith('Crawl aborted')
      ? this.progress.status
      : null;
    if (!state.isCrawling && state.status === 'Crawl finished successfully!') {
      state.lastSuccessAt = new Date();
    }

    await this.crawlerStateRepo.save(state);
  }

  private async createCrawlerRun() {
    const run = this.crawlerRunRepo.create({
      crawlerType: this.crawlerType,
      status: 'running',
      targetMatches: 0,
      discoveredMatches: 0,
      processedMatches: 0,
      currentMatchId: null,
      statusMessage: this.progress.status,
      lastError: null,
      finishedAt: null,
    });
    const saved = await this.crawlerRunRepo.save(run);
    return saved.id;
  }

  private async updateCrawlerRun(partial: Partial<CrawlerRun>) {
    if (!this.activeRunId) {
      return;
    }

    await this.crawlerRunRepo.update({ id: this.activeRunId }, partial);
  }

  private async finalizeCrawlerRun(status: 'completed' | 'failed', lastError?: string) {
    if (!this.activeRunId) {
      return;
    }

    await this.crawlerRunRepo.update(
      { id: this.activeRunId },
      {
        status,
        processedMatches: this.progress.current,
        currentMatchId: null,
        statusMessage: this.progress.status,
        lastError: lastError || null,
        finishedAt: new Date(),
      },
    );
    this.activeRunId = null;
  }

  private async recoverCrawlerStateAfterRestart() {
    await this.crawlerRunRepo
      .createQueryBuilder()
      .update(CrawlerRun)
      .set({
        status: 'failed',
        lastError: 'Process restarted while crawler was running',
        finishedAt: new Date(),
      })
      .where('crawlerType = :crawlerType', { crawlerType: this.crawlerType })
      .andWhere('status = :status', { status: 'running' })
      .execute();

    let state = await this.crawlerStateRepo.findOne({ where: { crawlerType: this.crawlerType } });
    if (!state) {
      return;
    }

    state.isCrawling = false;
    state.currentMatchId = null;
    state.status = 'Idle';
    await this.crawlerStateRepo.save(state);
  }
}
