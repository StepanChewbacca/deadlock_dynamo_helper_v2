import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OverwolfLiveBatchDto } from '@deadlock-live-probe/shared';
import { LiveMatchStateService } from './live-match-state.service';
import { RawEventLogService } from './raw-event-log.service';
import { RecentLiveEventsService } from './recent-live-events.service';

@Controller('deadlock/live')
export class LiveIngestController {
  constructor(
    private readonly rawEventLogService: RawEventLogService,
    private readonly liveMatchStateService: LiveMatchStateService,
    private readonly recentLiveEventsService: RecentLiveEventsService,
  ) {}

  @Post('events')
  async ingestEvents(@Body() batch: OverwolfLiveBatchDto): Promise<{ ok: true }> {
    await this.rawEventLogService.appendEvents(batch.events);
    this.recentLiveEventsService.append(batch.events);
    this.liveMatchStateService.applyBatch(batch);
    return { ok: true };
  }

  @Get('states')
  getStates() {
    return this.liveMatchStateService.getAllStates();
  }

  @Get('matches/:matchId/state')
  getState(@Param('matchId') matchId: string) {
    return this.liveMatchStateService.getState(matchId);
  }

  @Get('events/recent')
  getRecentEvents() {
    return this.recentLiveEventsService.getRecent();
  }
}
