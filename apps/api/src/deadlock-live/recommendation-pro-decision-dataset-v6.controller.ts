import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import {
  RecommendationProDecisionDatasetV6ArtifactService,
  type RecommendationProDecisionDatasetV6StartRequest,
} from './recommendation-pro-decision-dataset-v6-artifact.service';

@Controller('deadlock/analysis/recommendation-pro-decision-dataset-v6')
export class RecommendationProDecisionDatasetV6Controller {
  constructor(
    private readonly datasetService: RecommendationProDecisionDatasetV6ArtifactService,
  ) {}

  @Post('start')
  @HttpCode(202)
  async start(@Body() request: RecommendationProDecisionDatasetV6StartRequest) {
    try {
      return await this.datasetService.start(request);
    } catch (error) {
      throw new ConflictException(errorMessage(error));
    }
  }

  @Get('status')
  getStatus() {
    return this.datasetService.getStatus();
  }

  @Get('manifest')
  getManifest() {
    const manifest = this.datasetService.getManifest();
    if (!manifest) {
      throw new NotFoundException(
        'No completed Recommendation Dataset V6 manifest is available.',
      );
    }
    return manifest;
  }

  @Get('audit')
  getAudit() {
    const audit = this.datasetService.getAudit();
    if (!audit) {
      throw new NotFoundException(
        'No completed Recommendation Dataset V6 audit is available.',
      );
    }
    return audit;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
