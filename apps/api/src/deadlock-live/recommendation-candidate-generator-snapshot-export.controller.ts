import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
} from '@nestjs/common';
import {
  RecommendationCandidateGeneratorSnapshotExportService,
  type RecommendationCandidateGeneratorSnapshotExportRequest,
} from './recommendation-candidate-generator-snapshot-export.service';

@Controller('deadlock/analysis/recommendation-candidate-generator-snapshots')
export class RecommendationCandidateGeneratorSnapshotExportController {
  constructor(
    private readonly snapshotService: RecommendationCandidateGeneratorSnapshotExportService,
  ) {}

  @Post('start')
  @HttpCode(202)
  async start(
    @Body() request: RecommendationCandidateGeneratorSnapshotExportRequest,
  ) {
    try {
      return await this.snapshotService.start(request);
    } catch (error) {
      throw new ConflictException(errorMessage(error));
    }
  }

  @Get('status')
  getStatus() {
    return this.snapshotService.getStatus();
  }

  @Get('registry')
  async getRegistry() {
    return this.snapshotService.getRegistry();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
