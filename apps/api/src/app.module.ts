import { Module } from '@nestjs/common';
import { DeadlockLiveModule } from './deadlock-live/deadlock-live.module';

@Module({
  imports: [DeadlockLiveModule],
})
export class AppModule {}
