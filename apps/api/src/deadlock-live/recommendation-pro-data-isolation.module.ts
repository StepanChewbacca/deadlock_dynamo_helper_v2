import { Module } from '@nestjs/common';
import { RecommendationUserLiveTelemetryController } from './recommendation-user-live-telemetry.controller';
import { RecommendationUserLiveTelemetryService } from './recommendation-user-live-telemetry.service';

@Module({
  controllers: [RecommendationUserLiveTelemetryController],
  providers: [RecommendationUserLiveTelemetryService],
  exports: [RecommendationUserLiveTelemetryService],
})
export class RecommendationProDataIsolationModule {}
