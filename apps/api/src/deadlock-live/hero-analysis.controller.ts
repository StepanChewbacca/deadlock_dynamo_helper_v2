import { Controller, Get, Post } from '@nestjs/common';
import { HeroAnalysisService } from './hero-analysis.service';

@Controller('deadlock/analysis')
export class HeroAnalysisController {
  constructor(private readonly heroAnalysisService: HeroAnalysisService) {}

  @Get('dynamo')
  getDynamoBuilds() {
    return this.heroAnalysisService.getBuilds();
  }

  @Get('dynamo/progress')
  getCrawlProgress() {
    return this.heroAnalysisService.getProgress();
  }

  @Post('dynamo/crawl')
  startCrawl() {
    this.heroAnalysisService.startCrawling();
    return {
      success: true,
      message: 'Background crawl initiated.',
    };
  }
}
