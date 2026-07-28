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
  RecommendationValueV8FullEvaluationTrainingService,
  type RecommendationValueV8FullEvaluationStartRequest,
} from './recommendation-value-v8-full-evaluation-training.service';

@Controller('deadlock/analysis/recommendation-value-v8-full-evaluation')
export class RecommendationValueV8FullEvaluationTrainingController {
  constructor(
    private readonly trainingService:
      RecommendationValueV8FullEvaluationTrainingService,
  ) {}

  @Post('start')
  @HttpCode(202)
  async start(
    @Body() request: RecommendationValueV8FullEvaluationStartRequest = {},
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
        'No completed Recommendation Value V8 full model is available.',
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
        'No completed Recommendation Value V8 full evaluation is available.',
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
        'No completed Recommendation Value V8 full audit is available.',
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
        'No completed Recommendation Value V8 full manifest is available.',
      );
    }
    return value;
  }

  private assertNotRunning(): void {
    if (this.trainingService.getStatus().state === 'RUNNING') {
      throw new ConflictException(
        'Recommendation Value V8 full evaluation is still running.',
      );
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
