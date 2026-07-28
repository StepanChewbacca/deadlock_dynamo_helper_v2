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
  RecommendationBehavioralV5TrainingService,
  type RecommendationBehavioralV5TrainingStartRequest,
} from './recommendation-behavioral-v5-training.service';

@Controller('deadlock/analysis/recommendation-behavioral-v5-training')
export class RecommendationBehavioralV5TrainingController {
  constructor(
    private readonly trainingService: RecommendationBehavioralV5TrainingService,
  ) {}

  @Post('start')
  @HttpCode(202)
  async start(
    @Body() request: RecommendationBehavioralV5TrainingStartRequest = {},
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

  @Get('manifest')
  getManifest() {
    this.assertNotRunning();
    const manifest = this.trainingService.getManifest();
    if (!manifest) {
      throw new NotFoundException(
        'No completed Recommendation Behavioral V5 manifest is available.',
      );
    }
    return manifest;
  }

  @Get('audit')
  getAudit() {
    this.assertNotRunning();
    const audit = this.trainingService.getAudit();
    if (!audit) {
      throw new NotFoundException(
        'No completed Recommendation Behavioral V5 audit is available.',
      );
    }
    return audit;
  }

  @Get('evaluation')
  getEvaluation() {
    this.assertNotRunning();
    const evaluation = this.trainingService.getEvaluation();
    if (!evaluation) {
      throw new NotFoundException(
        'No completed Recommendation Behavioral V5 evaluation is available.',
      );
    }
    return evaluation;
  }

  @Get('model')
  getModel() {
    this.assertNotRunning();
    const model = this.trainingService.getModel();
    if (!model) {
      throw new NotFoundException(
        'No completed Recommendation Behavioral V5 model is available.',
      );
    }
    return model;
  }

  private assertNotRunning(): void {
    if (this.trainingService.getStatus().state === 'RUNNING') {
      throw new ConflictException(
        'Recommendation Behavioral V5 training is still running.',
      );
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
