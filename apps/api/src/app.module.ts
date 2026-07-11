import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './database/data-source';
import { DeadlockLiveModule } from './deadlock-live/deadlock-live.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      ...databaseOptions,
      migrationsRun: process.env.DB_RUN_MIGRATIONS === 'true',
    }),
    DeadlockLiveModule,
  ],
})
export class AppModule {}
