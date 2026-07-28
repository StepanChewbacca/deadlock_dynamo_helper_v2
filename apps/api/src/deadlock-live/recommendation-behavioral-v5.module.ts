import { Module } from '@nestjs/common';
import { RecommendationBehavioralV5TrainingController } from './recommendation-behavioral-v5-training.controller';
import { RecommendationBehavioralV5TrainingService } from './recommendation-behavioral-v5-training.service';

@Module({
  controllers: [RecommendationBehavioralV5TrainingController],
  providers: [RecommendationBehavioralV5TrainingService],
  exports: [RecommendationBehavioralV5TrainingService],
})
export class RecommendationBehavioralV5Module {}
