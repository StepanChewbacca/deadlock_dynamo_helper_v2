import { Module } from '@nestjs/common';
import { RecommendationValueV8FullEvaluationTrainingController } from './recommendation-value-v8-full-evaluation-training.controller';
import { RecommendationValueV8FullEvaluationTrainingService } from './recommendation-value-v8-full-evaluation-training.service';

@Module({
  controllers: [RecommendationValueV8FullEvaluationTrainingController],
  providers: [RecommendationValueV8FullEvaluationTrainingService],
  exports: [RecommendationValueV8FullEvaluationTrainingService],
})
export class RecommendationValueV8FullEvaluationModule {}
