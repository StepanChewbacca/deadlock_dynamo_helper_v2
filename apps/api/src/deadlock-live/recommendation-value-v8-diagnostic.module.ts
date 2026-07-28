import { Module } from '@nestjs/common';
import { RecommendationValueV8DiagnosticTrainingController } from './recommendation-value-v8-diagnostic-training.controller';
import { RecommendationValueV8DiagnosticTrainingService } from './recommendation-value-v8-diagnostic-training.service';

@Module({
  controllers: [RecommendationValueV8DiagnosticTrainingController],
  providers: [RecommendationValueV8DiagnosticTrainingService],
  exports: [RecommendationValueV8DiagnosticTrainingService],
})
export class RecommendationValueV8DiagnosticModule {}
