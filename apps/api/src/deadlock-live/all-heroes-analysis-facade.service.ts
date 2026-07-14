import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import {
  AllHeroesAnalysisService,
  RecommendBuildDto,
} from './all-heroes-analysis.service';
import { CrawlerRun } from './entities/crawler-run.entity';
import { CrawlerState } from './entities/crawler-state.entity';
import { Hero } from './entities/hero.entity';
import { ItemComponent } from './entities/item-component.entity';
import { Item } from './entities/item.entity';
import { Match } from './entities/match.entity';
import { MatchPlayerItem } from './entities/match-player-item.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { MatchPlayerSkillUpgrade } from './entities/match-player-skill-upgrade.entity';
import { RecentMatchCrawlerService } from './recent-match-crawler.service';

@Injectable()
export class AllHeroesAnalysisFacadeService {
  private readonly legacyAnalysisService: AllHeroesAnalysisService;

  constructor(
    @InjectRepository(Match)
    matchRepository: Repository<Match>,
    @InjectRepository(MatchPlayer)
    matchPlayerRepository: Repository<MatchPlayer>,
    @InjectRepository(MatchPlayerItem)
    matchPlayerItemRepository: Repository<MatchPlayerItem>,
    @InjectRepository(MatchPlayerSkillUpgrade)
    matchPlayerSkillUpgradeRepository: Repository<MatchPlayerSkillUpgrade>,
    @InjectRepository(Hero)
    heroRepository: Repository<Hero>,
    @InjectRepository(Item)
    itemRepository: Repository<Item>,
    @InjectRepository(ItemComponent)
    itemComponentRepository: Repository<ItemComponent>,
    @InjectRepository(CrawlerState)
    crawlerStateRepository: Repository<CrawlerState>,
    @InjectRepository(CrawlerRun)
    crawlerRunRepository: Repository<CrawlerRun>,
    private readonly recentMatchCrawlerService: RecentMatchCrawlerService,
  ) {
    this.legacyAnalysisService = new AllHeroesAnalysisService(
      matchRepository,
      createUnlimitedMatchPlayerRepository(matchPlayerRepository),
      matchPlayerItemRepository,
      matchPlayerSkillUpgradeRepository,
      heroRepository,
      itemRepository,
      itemComponentRepository,
      crawlerStateRepository,
      crawlerRunRepository,
    );
  }

  getProgress() {
    return this.recentMatchCrawlerService.getProgress();
  }

  async startCrawling(): Promise<void> {
    await this.recentMatchCrawlerService.startCrawling();
  }

  async getHeroesSummary() {
    return this.legacyAnalysisService.getHeroesSummary();
  }

  async getHeroBuilds(heroId: number) {
    return this.legacyAnalysisService.getHeroBuilds(heroId);
  }

  async recommendBuild(dto: RecommendBuildDto) {
    return this.legacyAnalysisService.recommendBuild(dto);
  }
}

export function createUnlimitedMatchPlayerRepository(
  repository: Repository<MatchPlayer>,
): Repository<MatchPlayer> {
  return new Proxy(repository, {
    get(target, property) {
      if (property === 'find') {
        return (options?: FindManyOptions<MatchPlayer>) => {
          if (!options || options.take === undefined) {
            return target.find(options);
          }

          const { take: _ignoredTake, ...unlimitedOptions } = options;
          return target.find(unlimitedOptions);
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
