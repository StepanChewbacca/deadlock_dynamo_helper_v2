import { Module } from '@nestjs/common';
import { RecommendationHistoricalProReplayArtifactService } from './recommendation-historical-pro-replay-artifact.service';
import { RecommendationHistoricalProReplayController } from './recommendation-historical-pro-replay.controller';

@Module({
  controllers: [RecommendationHistoricalProReplayController],
  providers: [RecommendationHistoricalProReplayArtifactService],
  exports: [RecommendationHistoricalProReplayArtifactService],
})
export class RecommendationHistoricalProReplayModule {}
