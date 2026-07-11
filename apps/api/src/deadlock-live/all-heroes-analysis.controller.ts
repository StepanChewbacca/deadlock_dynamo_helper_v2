import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { AllHeroesAnalysisService, RecommendBuildDto } from './all-heroes-analysis.service';
import {
  ResolvePendingRulesetsDto,
  RulesetResolverService,
} from './ruleset-resolver.service';
import { SituationalRecommendationDto, SituationalRecommendationService } from './situational-recommendation.service';
import { StoredMatchReprocessingService } from './stored-match-reprocessing.service';

@Controller('deadlock/analysis')
export class AllHeroesAnalysisController {
  constructor(
    private readonly service: AllHeroesAnalysisService,
    private readonly situationalRecommendationService: SituationalRecommendationService,
    private readonly storedMatchReprocessingService: StoredMatchReprocessingService,
    private readonly rulesetResolverService: RulesetResolverService,
  ) {}

  @Get('heroes')
  async getHeroesSummary() {
    return this.service.getHeroesSummary();
  }

  @Get('hero/:heroId')
  async getHeroBuilds(@Param('heroId', ParseIntPipe) heroId: number) {
    return this.service.getHeroBuilds(heroId);
  }

  @Get('crawl/progress')
  getCrawlProgress() {
    return this.service.getProgress();
  }

  @Post('crawl/start')
  startCrawl() {
    this.service.startCrawling();
    return { success: true, message: 'Background crawl initiated.' };
  }

  @Post('raw-matches/rulesets/resolve-pending')
  async resolvePendingRulesets(@Body() dto: ResolvePendingRulesetsDto) {
    return this.rulesetResolverService.resolvePending(dto ?? {});
  }

  @Get('raw-matches/:matchId/ruleset')
  async getStoredMatchRuleset(@Param('matchId', ParseIntPipe) matchId: number) {
    return this.rulesetResolverService.getLatestForMatch(matchId);
  }

  @Post('raw-matches/:matchId/ruleset/resolve')
  async resolveStoredMatchRuleset(@Param('matchId', ParseIntPipe) matchId: number) {
    return this.rulesetResolverService.resolveLatestForMatch(matchId);
  }

  @Post('raw-matches/:matchId/reprocess')
  async reprocessStoredMatch(@Param('matchId', ParseIntPipe) matchId: number) {
    return this.storedMatchReprocessingService.reprocess(matchId);
  }

  @Post('recommend')
  async recommendBuild(@Body() dto: RecommendBuildDto) {
    return this.service.recommendBuild(dto);
  }

  @Post('situational/recommend')
  async recommendSituational(@Body() dto: SituationalRecommendationDto) {
    return this.situationalRecommendationService.recommend(dto);
  }
}
