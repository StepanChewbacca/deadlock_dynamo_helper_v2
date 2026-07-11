import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AllHeroesAnalysisService } from './all-heroes-analysis.service';
import { HeroAnalysisService } from './hero-analysis.service';
import { CrawlerRun } from './entities/crawler-run.entity';
import { CrawlerState } from './entities/crawler-state.entity';
import { Hero } from './entities/hero.entity';
import { Item } from './entities/item.entity';
import { Match } from './entities/match.entity';
import { MatchPlayer } from './entities/match-player.entity';

@Injectable()
export class IngestStatusService {
  constructor(
    @InjectRepository(Match)
    private readonly matchRepo: Repository<Match>,
    @InjectRepository(MatchPlayer)
    private readonly matchPlayerRepo: Repository<MatchPlayer>,
    @InjectRepository(Hero)
    private readonly heroRepo: Repository<Hero>,
    @InjectRepository(Item)
    private readonly itemRepo: Repository<Item>,
    @InjectRepository(CrawlerState)
    private readonly crawlerStateRepo: Repository<CrawlerState>,
    @InjectRepository(CrawlerRun)
    private readonly crawlerRunRepo: Repository<CrawlerRun>,
    private readonly heroAnalysisService: HeroAnalysisService,
    private readonly allHeroesAnalysisService: AllHeroesAnalysisService,
  ) {}

  async getStatus() {
    const [matchesTotal, matchPlayersTotal, heroesTotal, itemsTotal, crawlerStates, latestRuns] = await Promise.all([
      this.matchRepo.count(),
      this.matchPlayerRepo.count(),
      this.heroRepo.count(),
      this.itemRepo.count(),
      this.crawlerStateRepo.find({ order: { crawlerType: 'ASC' } }),
      this.crawlerRunRepo.find({ order: { startedAt: 'DESC' }, take: 5 }),
    ]);

    return {
      matchesTotal,
      matchPlayersTotal,
      heroesTotal,
      itemsTotal,
      crawlerStates,
      latestRuns,
      liveProgress: {
        dynamo: this.heroAnalysisService.getProgress(),
        allHeroes: this.allHeroesAnalysisService.getProgress(),
      },
    };
  }
}
