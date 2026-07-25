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
  RecommendationValueV6TrainingService,
  type RecommendationValueV6TrainingStartRequest,
} from './recommendation-value-v6-training.service';

export class StartRecommendationValueV6TrainingDto {
  trainFraction?: number;
  tuningFraction?: number;
  statePriorStrength?: number;
  actionPriorStrength?: number;
  minimumObservations?: number;
  maximumAbsoluteStateResidual?: number;
  maximumAbsoluteActionResidual?: number;
  actionResidualScales?: number[];
  finalOutcomeWeight?: number;
  shortHorizonWeight?: number;
  bootstrapSamples?: number;
  expectedSourceSha256?: string;
}

@Controller('deadlock/analysis/recommendation-value-v6-training')
export class RecommendationValueV6TrainingController {
  constructor(
    private readonly trainingService: RecommendationValueV6TrainingService,
  ) {}

  @Post('start')
  @HttpCode(202)
  async start(@Body() dto: StartRecommendationValueV6TrainingDto) {
    try {
      return await this.trainingService.start(parseRequest(dto ?? {}));
    } catch (error) {
      throw new BadRequestException(errorMessage(error));
    }
  }

  @Get('status')
  getStatus() {
    return this.trainingService.getStatus();
  }

  @Get('manifest')
  getManifest() {
    this.assertNotRunning();
    const value = this.trainingService.getManifest();
    if (!value) {
      throw new NotFoundException(
        'No completed Recommendation Value V6 training manifest is available.',
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
        'No completed Recommendation Value V6 training audit is available.',
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
        'No completed Recommendation Value V6 evaluation is available.',
      );
    }
    return value;
  }

  @Get('model')
  getModel() {
    this.assertNotRunning();
    const value = this.trainingService.getModel();
    if (!value) {
      throw new NotFoundException(
        'No completed Recommendation Value V6 model is available.',
      );
    }
    return value;
  }

  private assertNotRunning(): void {
    if (this.trainingService.getStatus().state === 'RUNNING') {
      throw new ConflictException(
        'Recommendation Value V6 training is still running.',
      );
    }
  }
}

function parseRequest(
  dto: StartRecommendationValueV6TrainingDto,
): RecommendationValueV6TrainingStartRequest {
  return {
    trainFraction: dto.trainFraction,
    tuningFraction: dto.tuningFraction,
    statePriorStrength: dto.statePriorStrength,
    actionPriorStrength: dto.actionPriorStrength,
    minimumObservations: dto.minimumObservations,
    maximumAbsoluteStateResidual: dto.maximumAbsoluteStateResidual,
    maximumAbsoluteActionResidual: dto.maximumAbsoluteActionResidual,
    actionResidualScales: dto.actionResidualScales,
    finalOutcomeWeight: dto.finalOutcomeWeight,
    shortHorizonWeight: dto.shortHorizonWeight,
    bootstrapSamples: dto.bootstrapSamples,
    expectedSourceSha256: dto.expectedSourceSha256,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
