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
      const registry = await this.snapshotService.getRegistry();
      if (
        registry.snapshots.some(
          (snapshot) => snapshot.snapshotId === request.snapshotId?.trim(),
        )
      ) {
        throw new Error(
          `Candidate generator snapshot ID ${request.snapshotId} already exists.`,
        );
      }
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
