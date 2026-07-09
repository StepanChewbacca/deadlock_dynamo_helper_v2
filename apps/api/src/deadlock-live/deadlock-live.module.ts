import { Module } from '@nestjs/common';
import { LiveMatchStateService } from './live-match-state.service';

@Module({
  providers: [LiveMatchStateService],
  exports: [LiveMatchStateService],
})
export class DeadlockLiveModule {}
