import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import {
  RecommendationV6ShortOnlyBaselineExportService,
  type RecommendationV6ShortOnlyBaselineExportStartRequest,
} from './recommendation-v6-short-only-dataset-v6-baseline.service';

@Controller('deadlock/analysis/recommendation-v6-short-only-dataset-v6-baseline')
export class RecommendationV6ShortOnlyBaselineExportController {
  constructor(
    private readonly exportService: RecommendationV6ShortOnlyBaselineExportService,
  ) {}

  @Post('start')
  @HttpCode(202)
  async start(
    @Body() request: RecommendationV6ShortOnlyBaselineExportStartRequest = {},
  ) {
    try {
      return await this.exportService.start(request);
    } catch (error) {
      throw new BadRequestException(errorMessage(error));
    }
  }

  @Get('status')
  getStatus() {
    return this.exportService.getStatus();
  }

  @Get('manifest')
  getManifest() {
    this.assertNotRunning();
    const value = this.exportService.getManifest();
    if (!value) {
      throw new NotFoundException(
        'No completed frozen V6 Dataset V6 baseline manifest is available.',
      );
    }
    return value;
  }

  @Get('audit')
  getAudit() {
    this.assertNotRunning();
    const value = this.exportService.getAudit();
    if (!value) {
      throw new NotFoundException(
        'No completed frozen V6 Dataset V6 baseline audit is available.',
      );
    }
    return value;
  }

  private assertNotRunning(): void {
    if (this.exportService.getStatus().state === 'RUNNING') {
      throw new ConflictException('Frozen V6 baseline export is still running.');
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
