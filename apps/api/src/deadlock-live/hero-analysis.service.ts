import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';
import { CrawlerRun } from './entities/crawler-run.entity';
import { CrawlerState } from './entities/crawler-state.entity';
import { Item } from './entities/item.entity';
import { Match } from './entities/match.entity';
import { MatchPlayerItem } from './entities/match-player-item.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { MatchPlayerSkillUpgrade } from './entities/match-player-skill-upgrade.entity';
import { getDeadlockApiRequestConfig } from './deadlock-api-request';

export interface DynamoMatchData {
  matchId: number;
  averageBadge: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  netWorth: number;
  items: {
    id: number;
    name: string;
    className: string;
    slotType: string;
    cost: number;
    buyTimeS: number;
  }[];
  skillsOrder: number[];
}

@Injectable()
export class HeroAnalysisService implements OnModuleInit {
  private readonly logger = new Logger(HeroAnalysisService.name);
  private readonly crawlerType = 'dynamo';

  private itemsMap: Record<string, { name: string; class_name: string; item_slot_type: string; cost: number; item_tier: number }> = {};
  private cachedMatches: Record<number, DynamoMatchData> = {};
  private processedMatchIds = new Set<number>();
  private isCrawling = false;
  private crawlProgress = { current: 0, target: 200, status: 'Idle' };
  private activeRunId: number | null = null;

  constructor(
    @InjectRepository(Match)
    private readonly matchRepo: Repository<Match>,
    @InjectRepository(MatchPlayer)
    private readonly matchPlayerRepo: Repository<MatchPlayer>,
    @InjectRepository(MatchPlayerItem)
    private readonly matchPlayerItemRepo: Repository<MatchPlayerItem>,
    @InjectRepository(MatchPlayerSkillUpgrade)
    private readonly matchPlayerSkillUpgradeRepo: Repository<MatchPlayerSkillUpgrade>,
    @InjectRepository(Item)
    private readonly itemRepo: Repository<Item>,
    @InjectRepository(CrawlerState)
    private readonly crawlerStateRepo: Repository<CrawlerState>,
    @InjectRepository(CrawlerRun)
    private readonly crawlerRunRepo: Repository<CrawlerRun>,
  ) {}

  async onModuleInit() {
    await this.refreshItemsMap();
    await this.refreshCachedMatchesFromDb();
    await this.recoverCrawlerStateAfterRestart();
  }

  public getProgress() {
    return {
      ...this.crawlProgress,
      isCrawling: this.isCrawling,
    };
  }

  public getBuilds() {
    const matchesList = Object.values(this.cachedMatches);
    if (matchesList.length === 0) {
      return {
        totalMatches: 0,
        builds: [],
      };
    }

    // Group matches into 3 build categories: Support/Utility, Spirit/Singularity, Weapon DPS
    const supportMatches: DynamoMatchData[] = [];
    const spiritMatches: DynamoMatchData[] = [];
    const weaponMatches: DynamoMatchData[] = [];

    matchesList.forEach(m => {
      let supportScore = 0;
      let spiritCount = 0;
      let weaponCount = 0;

      m.items.forEach(item => {
        const cls = item.className.toLowerCase();
        if (
          cls.includes('aura') ||
          cls.includes('locket') ||
          cls.includes('rescue') ||
          cls.includes('nova') ||
          cls.includes('stimpak') ||
          cls.includes('heal') ||
          cls.includes('barrier') ||
          cls.includes('shield')
        ) {
          supportScore++;
        }

        if (item.slotType === 'spirit') {
          spiritCount++;
        } else if (item.slotType === 'weapon') {
          weaponCount++;
        }
      });

      if (supportScore >= 2) {
        supportMatches.push(m);
      } else if (weaponCount > spiritCount) {
        weaponMatches.push(m);
      } else {
        spiritMatches.push(m);
      }
    });

    const calculateBuildDetails = (group: DynamoMatchData[], name: string, description: string) => {
      const total = group.length;
      if (total === 0) {
        return { name, description, matchesCount: 0, winRate: 0, earlyGame: [], midGame: [], lateGame: [] };
      }

      const wins = group.filter(m => m.win).length;
      const winRate = Math.round((wins / total) * 100);

      // Collect item occurrences per phase
      const earlyCounts: Record<string, { id: number; name: string; slotType: string; cost: number; count: number }> = {};
      const midCounts: Record<string, { id: number; name: string; slotType: string; cost: number; count: number }> = {};
      const lateCounts: Record<string, { id: number; name: string; slotType: string; cost: number; count: number }> = {};

      group.forEach(m => {
        const seenInMatch = new Set<string>();
        m.items.forEach(item => {
          // Categorize by timing
          let dest = lateCounts;
          let phase = 'late';
          if (item.buyTimeS <= 600) {
            dest = earlyCounts;
            phase = 'early';
          } else if (item.buyTimeS <= 1200) {
            dest = midCounts;
            phase = 'mid';
          }

          const seenKey = `${item.className}_${phase}`;
          if (seenInMatch.has(seenKey)) {
            return;
          }
          seenInMatch.add(seenKey);

          if (!dest[item.className]) {
            dest[item.className] = {
              id: item.id,
              name: item.name,
              slotType: item.slotType,
              cost: item.cost,
              count: 0,
            };
          }
          dest[item.className].count++;
        });
      });

      const compilePhase = (countsObj: typeof earlyCounts) => {
        return Object.values(countsObj)
          .map(i => ({
            id: i.id,
            name: i.name,
            slotType: i.slotType,
            cost: i.cost,
            popularity: Math.round((i.count / total) * 100),
          }))
          .sort((a, b) => b.popularity - a.popularity)
          .slice(0, 6); // Top 6 items per phase
      };

      // Compute consensus skill leveling order (mode for each step from 0 to 15)
      const skillsOrder: number[] = [];
      for (let step = 0; step < 16; step++) {
        const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
        group.forEach(m => {
          const val = m.skillsOrder?.[step];
          if (val === 1 || val === 2 || val === 3 || val === 4) {
            counts[val]++;
          }
        });
        let bestVal = 1;
        let maxCount = -1;
        for (const [k, v] of Object.entries(counts)) {
          if (v > maxCount) {
            maxCount = v;
            bestVal = parseInt(k, 10);
          }
        }
        skillsOrder.push(maxCount > 0 ? bestVal : (skillsOrder[step - 1] || 1));
      }

      return {
        name,
        description,
        matchesCount: total,
        winRate,
        earlyGame: compilePhase(earlyCounts),
        midGame: compilePhase(midCounts),
        lateGame: compilePhase(lateCounts),
        skillsOrder,
      };
    };

    return {
      totalMatches: matchesList.length,
      builds: [
        calculateBuildDetails(supportMatches, 'Support & Team Utility', 'Focuses on healing, saving allies, active team barriers, and cooldown resets. Strongest in coordinated high-rank team fights.'),
        calculateBuildDetails(spiritMatches, 'Spirit & Ultimate Singularity', 'Maximizes range, duration, and damage of Singularity. Focuses on tech stats and area crowd control.'),
        calculateBuildDetails(weaponMatches, 'Weapon Carry / Gun DPS', 'Maximizes weapon fire-rate, mobility, and gun damage. Designed for lane dominance and high direct gun pressure.'),
      ],
    };
  }

  public async startCrawling() {
    if (this.isCrawling) {
      return;
    }

    this.isCrawling = true;
    this.crawlProgress.status = 'Starting match crawl...';
    this.activeRunId = await this.createCrawlerRun();
    await this.syncCrawlerState();

    // Start background processing so endpoint returns immediately
    void this.runCrawlLoop().catch(err => {
      this.logger.error('Error in crawl background loop:', err);
      this.isCrawling = false;
      this.crawlProgress.status = `Failed: ${err.message}`;
      void this.finalizeCrawlerRun('failed', err.message);
    });
  }

  private async runCrawlLoop() {
    try {
      this.crawlProgress.status = 'Fetching recently parsed matches from deadlock-api.com...';
      await this.syncCrawlerState();
      const recentRes = await axios.get(
        'https://api.deadlock-api.com/v1/matches/recently-fetched',
        getDeadlockApiRequestConfig(),
      );
      const recentMatches: any[] = recentRes.data || [];

      // Filter matches with high badge ranks (average rank >= 60)
      const highRankMatches = recentMatches.filter(
        m => m.average_badge_team0 >= 60 || m.average_badge_team1 >= 60
      );

      this.logger.log(`Found ${highRankMatches.length} high-rank matches out of ${recentMatches.length} recently fetched.`);
      await this.updateCrawlerRun({
        targetMatches: this.crawlProgress.target,
        discoveredMatches: highRankMatches.length,
        statusMessage: this.crawlProgress.status,
      });

      // 1. Process recently-fetched high-rank matches directly
      for (let i = 0; i < highRankMatches.length; i++) {
        if (Object.keys(this.cachedMatches).length >= this.crawlProgress.target) {
          break;
        }

        const match = highRankMatches[i];
        if (this.processedMatchIds.has(match.match_id)) {
          continue;
        }

        this.crawlProgress.status = `Inspecting match metadata (${i + 1}/${highRankMatches.length}): Match ID ${match.match_id}`;
        await this.updateCrawlerRun({
          processedMatches: this.crawlProgress.current,
          currentMatchId: match.match_id,
          statusMessage: this.crawlProgress.status,
        });
        await this.syncCrawlerState(match.match_id);
        await this.processMatchId(match.match_id, match.average_badge_team0 || 60);
        // Sleep brief 100ms to be kind to the api
        await new Promise(r => setTimeout(r, 100));
      }

      // 2. If we need more matches, extract active players of high-rank games and query their history
      if (Object.keys(this.cachedMatches).length < this.crawlProgress.target) {
        this.crawlProgress.status = 'Expanding match discovery via high-rank player match histories...';
        await this.syncCrawlerState();
        const dynamoMatches = Object.values(this.cachedMatches);
        
        const playerAccounts: number[] = [];
        const scannedAccounts = new Set<number>();
        for (const dm of dynamoMatches) {
          if (scannedAccounts.size > 40 || Object.keys(this.cachedMatches).length >= this.crawlProgress.target) {
            break;
          }
          try {
            const metaRes = await axios.get(
              `https://api.deadlock-api.com/v1/matches/${dm.matchId}/metadata`,
              getDeadlockApiRequestConfig(),
            );
            const players = metaRes.data?.match_info?.players || [];
            players.forEach((p: any) => {
              if (p.account_id && !scannedAccounts.has(p.account_id)) {
                scannedAccounts.add(p.account_id);
                playerAccounts.push(p.account_id);
              }
            });
          } catch {}
        }

        this.logger.log(`Discovered ${playerAccounts.length} candidate player accounts for history crawling.`);

        // Now, crawl each player's match history to discover more Dynamo matches
        for (let idx = 0; idx < playerAccounts.length; idx++) {
          if (Object.keys(this.cachedMatches).length >= this.crawlProgress.target) {
            break;
          }

          const accountId = playerAccounts[idx];
          this.crawlProgress.status = `Crawling player history (${idx + 1}/${playerAccounts.length}): Player ${accountId}`;
          await this.syncCrawlerState();

          try {
            const historyRes = await axios.get(
              `https://api.deadlock-api.com/v1/players/${accountId}/match-history`,
              getDeadlockApiRequestConfig(),
            );
            const historyMatches: any[] = historyRes.data || [];

            // Filter out already processed matches
            const newHistoryMatches = historyMatches.filter(hm => !this.processedMatchIds.has(hm.match_id));

            for (const hm of newHistoryMatches) {
              if (Object.keys(this.cachedMatches).length >= this.crawlProgress.target) {
                break;
              }

              await this.processMatchId(hm.match_id, hm.average_badge || 65);
              await new Promise(r => setTimeout(r, 100)); // sleep 100ms
            }
          } catch (err) {
            this.logger.warn(`Failed to fetch history for player ${accountId}: ${(err as any).message}`);
          }
        }
      }

      this.crawlProgress.status = 'Crawl finished successfully!';
      await this.finalizeCrawlerRun('completed');
    } catch (err) {
      this.logger.error('Error crawling matches:', err);
      this.crawlProgress.status = `Crawl aborted: ${(err as any).message}`;
      await this.finalizeCrawlerRun('failed', (err as any).message);
    } finally {
      this.isCrawling = false;
      this.crawlProgress.current = Object.keys(this.cachedMatches).length;
      await this.syncCrawlerState();
    }
  }

  private async processMatchId(matchId: number, badge: number): Promise<boolean> {
    if (this.processedMatchIds.has(matchId)) {
      return false;
    }
    this.processedMatchIds.add(matchId);

    try {
      const res = await axios.get(
        `https://api.deadlock-api.com/v1/matches/${matchId}/metadata`,
        getDeadlockApiRequestConfig(),
      );
      const matchInfo = res.data?.match_info;
      if (!matchInfo) {
        return false;
      }

      const players: any[] = matchInfo.players || [];
      const dynamoPlayer = players.find(p => p.hero_id === 11);

      if (!dynamoPlayer) {
        return false; // Dynamo was not in this match
      }

      // Check if winning team matches Dynamo's team
      const winningTeam = matchInfo.winning_team;
      const dynamoTeam = dynamoPlayer.team;
      const win = winningTeam === dynamoTeam;

      await this.refreshItemsMap();

      // Extract items and map their properties using items table
      const itemsList: any[] = dynamoPlayer.items || [];
      const mappedItems: any[] = [];
      itemsList.forEach(item => {
        if (item.sold_time_s !== 0) return;
        const mapped = this.itemsMap[item.item_id];
        if (mapped) {
          mappedItems.push({
            id: item.item_id,
            name: mapped.name,
            className: mapped.class_name,
            slotType: mapped.item_slot_type,
            cost: mapped.cost,
            buyTimeS: item.game_time_s || 0,
          });
        }
      });

      // Extract abilities level-up path (chronological order)
      const dynamoAbilities = [3760705623, 492030745, 2031714424, 249410288];
      const skillPath = itemsList
        .filter(item => dynamoAbilities.includes(item.item_id))
        .sort((a, b) => (a.game_time_s || 0) - (b.game_time_s || 0))
        .map(item => {
          if (item.item_id === 3760705623) return 1; // Kinetic Pulse
          if (item.item_id === 492030745) return 2;  // Rejuvenating Aurora
          if (item.item_id === 2031714424) return 3; // Quantum Entanglement
          return 4; // Singularity
        });

      const matchData: DynamoMatchData = {
        matchId,
        averageBadge: badge,
        win,
        kills: dynamoPlayer.kills || 0,
        deaths: dynamoPlayer.deaths || 0,
        assists: dynamoPlayer.assists || 0,
        netWorth: dynamoPlayer.net_worth || 0,
        items: mappedItems,
        skillsOrder: skillPath,
      };

      await this.upsertDynamoMatch(matchData, winningTeam, dynamoTeam, matchInfo.start_time || 0, matchInfo.duration_s || 0);
      this.cachedMatches[matchId] = matchData;
      this.crawlProgress.current = Object.keys(this.cachedMatches).length;
      await this.updateCrawlerRun({
        processedMatches: this.crawlProgress.current,
        currentMatchId: matchId,
        statusMessage: this.crawlProgress.status,
      });

      this.logger.log(`Logged Dynamo match: ${matchId} | Badge: ${badge} | Win: ${win}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to process match ${matchId}: ${(err as any).message}`);
      return false;
    }
  }

  private async refreshItemsMap() {
    if (Object.keys(this.itemsMap).length > 0) {
      return;
    }

    const items = await this.itemRepo.find();
    this.itemsMap = items.reduce<
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
  }

  private async refreshCachedMatchesFromDb() {
    const players = await this.matchPlayerRepo
      .createQueryBuilder('mp')
      .leftJoinAndSelect('mp.match', 'match')
      .leftJoinAndSelect('mp.itemPurchases', 'itemPurchases')
      .leftJoinAndSelect('mp.skillUpgrades', 'skillUpgrades')
      .where('mp.heroId = :heroId', { heroId: 11 })
      .orderBy('mp.crawledAt', 'DESC')
      .getMany();

    this.cachedMatches = {};
    this.processedMatchIds.clear();

    for (const player of players) {
      const match = (player as any).match as Match | undefined;
      if (!match) {
        continue;
      }

      this.cachedMatches[match.matchId] = {
        matchId: match.matchId,
        averageBadge: match.averageBadge || 0,
        win: player.won,
        kills: player.kills || 0,
        deaths: player.deaths || 0,
        assists: player.assists || 0,
        netWorth: player.netWorth || 0,
        items: (player.itemPurchases || []).map((purchase) => {
          const item = this.itemsMap[String(purchase.itemId)];
          return {
            id: Number(purchase.itemId),
            name: item?.name || `Item_${purchase.itemId}`,
            className: item?.class_name || `item_${purchase.itemId}`,
            slotType: item?.item_slot_type || 'unknown',
            cost: item?.cost || 0,
            buyTimeS: purchase.purchaseTimeS || 0,
          };
        }),
        skillsOrder: [...(player.skillUpgrades || [])]
          .sort((a, b) => a.upgradeOrder - b.upgradeOrder)
          .map((skill) => Number(skill.abilityId)),
      };
      this.processedMatchIds.add(match.matchId);
    }

    this.crawlProgress.current = Object.keys(this.cachedMatches).length;
    this.logger.log(`Loaded ${players.length} Dynamo matches from PostgreSQL.`);
  }

  private async upsertDynamoMatch(
    matchData: DynamoMatchData,
    winningTeam: number,
    dynamoTeam: number,
    startTimeUnix: number,
    durationS: number,
  ) {
    let match = await this.matchRepo.findOne({ where: { matchId: matchData.matchId } });
    if (!match) {
      match = this.matchRepo.create({
        matchId: matchData.matchId,
        startTime: new Date(startTimeUnix * 1000),
        durationS,
        averageBadge: matchData.averageBadge,
        winningTeam,
      });
      await this.matchRepo.save(match);
    }

    let player = await this.matchPlayerRepo.findOne({
      where: { matchId: matchData.matchId, heroId: 11 },
    });

    if (!player) {
      player = this.matchPlayerRepo.create({
        matchId: matchData.matchId,
        heroId: 11,
      });
    }

    player.team = dynamoTeam;
    player.won = matchData.win;
    player.kills = matchData.kills;
    player.deaths = matchData.deaths;
    player.assists = matchData.assists;
    player.netWorth = matchData.netWorth;
    player = await this.matchPlayerRepo.save(player);

    await this.matchPlayerItemRepo.delete({ matchPlayerId: player.id });
    await this.matchPlayerSkillUpgradeRepo.delete({ matchPlayerId: player.id });

    if (matchData.items.length > 0) {
      await this.matchPlayerItemRepo.save(
        matchData.items.map((item, index) =>
          this.matchPlayerItemRepo.create({
            matchPlayerId: player.id,
            itemId: item.id,
            purchaseTimeS: item.buyTimeS,
            soldTimeS: null,
            slotOrder: index,
          }),
        ),
      );
    }

    if (matchData.skillsOrder.length > 0) {
      await this.matchPlayerSkillUpgradeRepo.save(
        matchData.skillsOrder.map((abilityId, index) =>
          this.matchPlayerSkillUpgradeRepo.create({
            matchPlayerId: player.id,
            abilityId,
            upgradeOrder: index,
            upgradeTimeS: null,
          }),
        ),
      );
    }
  }

  private async syncCrawlerState(currentMatchId: number | null = null) {
    let state = await this.crawlerStateRepo.findOne({ where: { crawlerType: this.crawlerType } });
    if (!state) {
      state = this.crawlerStateRepo.create({ crawlerType: this.crawlerType });
    }

    state.isCrawling = this.isCrawling;
    state.current = this.crawlProgress.current;
    state.total = this.crawlProgress.target;
    state.currentMatchId = currentMatchId;
    state.status = this.crawlProgress.status;
    state.lastError = this.crawlProgress.status.startsWith('Failed') || this.crawlProgress.status.startsWith('Crawl aborted')
      ? this.crawlProgress.status
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
      targetMatches: this.crawlProgress.target,
      discoveredMatches: 0,
      processedMatches: 0,
      currentMatchId: null,
      statusMessage: this.crawlProgress.status,
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
        processedMatches: this.crawlProgress.current,
        currentMatchId: null,
        statusMessage: this.crawlProgress.status,
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
