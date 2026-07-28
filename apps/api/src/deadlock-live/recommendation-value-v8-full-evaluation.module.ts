import { Module } from '@nestjs/common';
import { RecommendationV6ShortOnlyBaselineExportController } from './recommendation-v6-short-only-dataset-v6-baseline.controller';
import { RecommendationV6ShortOnlyBaselineExportService } from './recommendation-v6-short-only-dataset-v6-baseline.service';
import { RecommendationValueV8FullEvaluationTrainingController } from './recommendation-value-v8-full-evaluation-training.controller';
import { RecommendationValueV8FullEvaluationTrainingService } from './recommendation-value-v8-full-evaluation-training.service';

@Module({
  controllers: [
    RecommendationV6ShortOnlyBaselineExportController,
    RecommendationValueV8FullEvaluationTrainingController,
  ],
  providers: [
    RecommendationV6ShortOnlyBaselineExportService,
    RecommendationValueV8FullEvaluationTrainingService,
  ],
  exports: [
    RecommendationV6ShortOnlyBaselineExportService,
    RecommendationValueV8FullEvaluationTrainingService,
  ],
})
export class RecommendationValueV8FullEvaluationModule {}
