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
  RecommendationValueV8DiagnosticTrainingService,
  type RecommendationValueV8DiagnosticTrainingStartRequest,
} from './recommendation-value-v8-diagnostic-training.service';

@Controller('deadlock/analysis/recommendation-value-v8-diagnostic')
export class RecommendationValueV8DiagnosticTrainingController {
  constructor(
    private readonly trainingService:
      RecommendationValueV8DiagnosticTrainingService,
  ) {}

  @Post('start')
  @HttpCode(202)
  async start(
    @Body() request: RecommendationValueV8DiagnosticTrainingStartRequest = {},
  ) {
    try {
      return await this.trainingService.start(request);
    } catch (error) {
      throw new BadRequestException(errorMessage(error));
    }
  }

  @Get('status')
  getStatus() {
    return this.trainingService.getStatus();
  }

  @Get('model')
  getModel() {
    this.assertNotRunning();
    const value = this.trainingService.getModel();
    if (!value) {
      throw new NotFoundException(
        'No completed Recommendation Value V8 diagnostic model is available.',
      );
    }
    return value;
  }

  @Get('evaluation')
  getEvaluation() {
    this.assertNotRunning();
    const value = this.trainingService.getEvaluation();
    if (!value) {
      throw new NotFoundException(
        'No completed Recommendation Value V8 diagnostic evaluation is available.',
      );
    }
    return value;
  }

  @Get('audit')
  getAudit() {
    this.assertNotRunning();
    const value = this.trainingService.getAudit();
    if (!value) {
      throw new NotFoundException(
        'No completed Recommendation Value V8 diagnostic audit is available.',
      );
    }
    return value;
  }

  @Get('manifest')
  getManifest() {
    this.assertNotRunning();
    const value = this.trainingService.getManifest();
    if (!value) {
      throw new NotFoundException(
        'No completed Recommendation Value V8 diagnostic manifest is available.',
      );
    }
    return value;
  }

  private assertNotRunning(): void {
    if (this.trainingService.getStatus().state === 'RUNNING') {
      throw new ConflictException(
        'Recommendation Value V8 diagnostic is still running.',
      );
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
