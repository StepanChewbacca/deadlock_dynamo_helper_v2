import { Module } from '@nestjs/common';
import { LiveMatchStateService } from './live-match-state.service';
import { RawEventLogService } from './raw-event-log.service';
import { RecentLiveEventsService } from './recent-live-events.service';
import { LiveIngestController } from './live-ingest.controller';
import { DebugPageController } from './debug-page.controller';

@Module({
  controllers: [LiveIngestController, DebugPageController],
  providers: [LiveMatchStateService, RawEventLogService, RecentLiveEventsService],
  exports: [LiveMatchStateService, RawEventLogService, RecentLiveEventsService],
})
export class DeadlockLiveModule {}
