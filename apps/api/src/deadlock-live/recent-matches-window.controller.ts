import { Controller, Get, Post } from '@nestjs/common';
import { RecentMatchRosterRepairService } from './recent-match-roster-repair.service';
import { RecentMatchesWindowService } from './recent-matches-window.service';

@Controller('deadlock/analysis/recent-matches')
export class RecentMatchesWindowController {
  constructor(
    private readonly recentMatchesWindowService: RecentMatchesWindowService,
    private readonly recentMatchRosterRepairService: RecentMatchRosterRepairService,
  ) {}

  @Get('status')
  getStatus() {
    return this.recentMatchesWindowService.getStatus();
  }

  @Get('roster-repair/status')
  getRosterRepairStatus() {
    return this.recentMatchRosterRepairService.getStatus();
  }

  @Post('roster-repair/start')
  startRosterRepair() {
    return this.recentMatchRosterRepairService.start();
  }
}
