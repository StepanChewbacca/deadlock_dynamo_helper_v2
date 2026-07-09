import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

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
  private readonly storageDir = path.resolve(process.cwd(), 'storage/deadlock-live');
  private readonly cachePath = path.join(this.storageDir, 'dynamo-matches.json');
  private readonly itemsMapPath = path.resolve(process.cwd(), 'src/deadlock-live/items-map.json');

  private itemsMap: Record<string, { name: string; class_name: string; item_slot_type: string; cost: number; item_tier: number }> = {};
  private cachedMatches: Record<number, DynamoMatchData> = {};
  private processedMatchIds = new Set<number>();
  private isCrawling = false;
  private crawlProgress = { current: 0, target: 200, status: 'Idle' };

  onModuleInit() {
    // 1. Create storage directory if it doesn't exist
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    // 2. Load static items mapping
    try {
      if (fs.existsSync(this.itemsMapPath)) {
        this.itemsMap = JSON.parse(fs.readFileSync(this.itemsMapPath, 'utf8'));
        this.logger.log(`Loaded ${Object.keys(this.itemsMap).length} items from mapping`);
      } else {
        this.logger.warn(`Items map not found at ${this.itemsMapPath}. Item details will fall back to raw IDs.`);
      }
    } catch (err) {
      this.logger.error('Failed to load items map:', err);
    }

    // 3. Load crawled matches from local disk
    try {
      if (fs.existsSync(this.cachePath)) {
        const list: DynamoMatchData[] = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
        list.forEach(m => {
          this.cachedMatches[m.matchId] = m;
          this.processedMatchIds.add(m.matchId);
        });
        this.logger.log(`Loaded ${list.length} cached Dynamo matches from disk.`);
        this.crawlProgress.current = list.length;
      }
    } catch (err) {
      this.logger.error('Failed to load cached matches from disk:', err);
    }
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

    // Start background processing so endpoint returns immediately
    void this.runCrawlLoop().catch(err => {
      this.logger.error('Error in crawl background loop:', err);
      this.isCrawling = false;
      this.crawlProgress.status = `Failed: ${err.message}`;
    });
  }

  private async runCrawlLoop() {
    try {
      this.crawlProgress.status = 'Fetching recently parsed matches from deadlock-api.com...';
      const recentRes = await axios.get('https://api.deadlock-api.com/v1/matches/recently-fetched');
      const recentMatches: any[] = recentRes.data || [];

      // Filter matches with high badge ranks (average rank >= 60)
      const highRankMatches = recentMatches.filter(
        m => m.average_badge_team0 >= 60 || m.average_badge_team1 >= 60
      );

      this.logger.log(`Found ${highRankMatches.length} high-rank matches out of ${recentMatches.length} recently fetched.`);

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
        await this.processMatchId(match.match_id, match.average_badge_team0 || 60);
        // Sleep brief 100ms to be kind to the api
        await new Promise(r => setTimeout(r, 100));
      }

      // 2. If we need more matches, extract active players of high-rank games and query their history
      if (Object.keys(this.cachedMatches).length < this.crawlProgress.target) {
        this.crawlProgress.status = 'Expanding match discovery via high-rank player match histories...';
        const dynamoMatches = Object.values(this.cachedMatches);
        
        const playerAccounts: number[] = [];
        const scannedAccounts = new Set<number>();
        for (const dm of dynamoMatches) {
          if (scannedAccounts.size > 40 || Object.keys(this.cachedMatches).length >= this.crawlProgress.target) {
            break;
          }
          try {
            const metaRes = await axios.get(`https://api.deadlock-api.com/v1/matches/${dm.matchId}/metadata`);
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

          try {
            const historyRes = await axios.get(`https://api.deadlock-api.com/v1/players/${accountId}/match-history`);
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
    } catch (err) {
      this.logger.error('Error crawling matches:', err);
      this.crawlProgress.status = `Crawl aborted: ${(err as any).message}`;
    } finally {
      this.isCrawling = false;
      this.crawlProgress.current = Object.keys(this.cachedMatches).length;
      this.saveCacheToDisk();
    }
  }

  private async processMatchId(matchId: number, badge: number): Promise<boolean> {
    if (this.processedMatchIds.has(matchId)) {
      return false;
    }
    this.processedMatchIds.add(matchId);

    try {
      const res = await axios.get(`https://api.deadlock-api.com/v1/matches/${matchId}/metadata`);
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

      // Extract items and map their properties using items-map.json
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

      this.cachedMatches[matchId] = matchData;
      this.crawlProgress.current = Object.keys(this.cachedMatches).length;
      
      // Auto-save progress every 10 matches
      if (Object.keys(this.cachedMatches).length % 10 === 0) {
        this.saveCacheToDisk();
      }

      this.logger.log(`Logged Dynamo match: ${matchId} | Badge: ${badge} | Win: ${win}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to process match ${matchId}: ${(err as any).message}`);
      return false;
    }
  }

  private saveCacheToDisk() {
    try {
      const list = Object.values(this.cachedMatches);
      fs.writeFileSync(this.cachePath, JSON.stringify(list, null, 2), 'utf8');
      this.logger.log(`Saved ${list.length} matches to disk cache at ${this.cachePath}`);
    } catch (err) {
      this.logger.error('Failed to save matches cache to disk:', err);
    }
  }
}
