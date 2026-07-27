import { Controller, Get } from '@nestjs/common';
import { RecommendationUserLiveTelemetryService } from './recommendation-user-live-telemetry.service';

@Controller('deadlock/analysis/recommendation-user-runtime-telemetry')
export class RecommendationUserLiveTelemetryController {
  constructor(
    private readonly telemetryService: RecommendationUserLiveTelemetryService,
  ) {}

  @Get('status')
  getStatus() {
    return this.telemetryService.getStatus();
  }
}
