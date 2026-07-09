import { Module } from '@nestjs/common';
import { LiveMatchStateService } from './live-match-state.service';
import { RawEventLogService } from './raw-event-log.service';
import { RecentLiveEventsService } from './recent-live-events.service';
import { LiveIngestController } from './live-ingest.controller';
import { DebugPageController } from './debug-page.controller';
import { HeroAnalysisService } from './hero-analysis.service';
import { HeroAnalysisController } from './hero-analysis.controller';

@Module({
  controllers: [LiveIngestController, DebugPageController, HeroAnalysisController],
  providers: [LiveMatchStateService, RawEventLogService, RecentLiveEventsService, HeroAnalysisService],
  exports: [LiveMatchStateService, RawEventLogService, RecentLiveEventsService, HeroAnalysisService],
})
export class DeadlockLiveModule {}
