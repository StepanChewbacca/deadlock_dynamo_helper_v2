import { Module } from '@nestjs/common';
import { RecommendationValueV6TrainingController } from './recommendation-value-v6-training.controller';
import { RecommendationValueV6TrainingService } from './recommendation-value-v6-training.service';

@Module({
  controllers: [RecommendationValueV6TrainingController],
  providers: [RecommendationValueV6TrainingService],
  exports: [RecommendationValueV6TrainingService],
})
export class RecommendationValueV6Module {}
