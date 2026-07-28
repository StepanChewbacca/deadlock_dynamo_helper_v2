import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { RecommendationValueV8PassiveShadowService } from './recommendation-value-v8-passive-shadow.service';

interface ActivateRecommendationValueV8PassiveShadowKillSwitchRequest {
  reason?: string;
}

@Controller('deadlock/analysis/recommendation-value-v8/passive-shadow')
export class RecommendationValueV8PassiveShadowController {
  constructor(
    private readonly shadowService: RecommendationValueV8PassiveShadowService,
  ) {}

  @Get('status')
  getStatus() {
    return this.shadowService.getStatus();
  }

  @Post('kill-switch')
  @HttpCode(200)
  activateKillSwitch(
    @Body() request: ActivateRecommendationValueV8PassiveShadowKillSwitchRequest = {},
  ) {
    return this.shadowService.activateKillSwitch(
      request.reason?.trim() || 'MANUAL_KILL_SWITCH',
    );
  }
}
