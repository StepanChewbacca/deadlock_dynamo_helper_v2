import { Controller, Get } from '@nestjs/common';
import { RecentMatchesWindowService } from './recent-matches-window.service';

@Controller('deadlock/analysis/recent-matches')
export class RecentMatchesWindowController {
  constructor(private readonly recentMatchesWindowService: RecentMatchesWindowService) {}

  @Get('status')
  getStatus() {
    return this.recentMatchesWindowService.getStatus();
  }
}
