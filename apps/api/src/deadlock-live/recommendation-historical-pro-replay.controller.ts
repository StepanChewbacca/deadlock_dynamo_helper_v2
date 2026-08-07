import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import type { RecommendationHistoricalProReplayStartRequest } from './recommendation-historical-pro-replay-artifact.service';
import { RecommendationHistoricalProReplayFacadeService } from './recommendation-historical-pro-replay-facade.service';

@Controller('deadlock/analysis/recommendation-historical-pro-replay')
export class RecommendationHistoricalProReplayController {
  constructor(
    private readonly replayService: RecommendationHistoricalProReplayFacadeService,
  ) {}

  @Post('start')
  @HttpCode(202)
  async start(
    @Body() request: RecommendationHistoricalProReplayStartRequest = {},
  ) {
    try {
      return await this.replayService.start(request);
    } catch (error) {
      throw new ConflictException(errorMessage(error));
    }
  }

  @Get('status')
  getStatus() {
    return this.replayService.getStatus();
  }

  @Get('manifest')
  getManifest() {
    const manifest = this.replayService.getManifest();
    if (!manifest) {
      throw new NotFoundException(
        'No completed historical pro replay manifest is available.',
      );
    }
    return manifest;
  }

  @Get('audit')
  getAudit() {
    const audit = this.replayService.getAudit();
    if (!audit) {
      throw new NotFoundException(
        'No completed historical pro replay audit is available.',
      );
    }
    return audit;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
