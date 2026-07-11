import { Controller, Get, Post, Param, ParseIntPipe, Body } from '@nestjs/common';
import { AllHeroesAnalysisService, RecommendBuildDto } from './all-heroes-analysis.service';
import { SituationalRecommendationDto, SituationalRecommendationService } from './situational-recommendation.service';

@Controller('deadlock/analysis')
export class AllHeroesAnalysisController {
  constructor(
    private readonly service: AllHeroesAnalysisService,
    private readonly situationalRecommendationService: SituationalRecommendationService,
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
  @Post('recommend')
  async recommendBuild(@Body() dto: RecommendBuildDto) {
    return this.service.recommendBuild(dto);
  }

  @Post('situational/recommend')
  async recommendSituational(@Body() dto: SituationalRecommendationDto) {
    return this.situationalRecommendationService.recommend(dto);
  }
}
