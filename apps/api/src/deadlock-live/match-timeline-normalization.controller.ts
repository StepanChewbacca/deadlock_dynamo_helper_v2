import { Controller, Get, NotFoundException, Param, ParseIntPipe } from '@nestjs/common';
import { MatchTimelineNormalizationService } from './match-timeline-normalization.service';
import { RecentMatchSnapshot, RecentMatchesWindowService } from './recent-matches-window.service';

@Controller('deadlock/analysis/recent-matches')
export class MatchTimelineNormalizationController {
  constructor(
    private readonly recentMatchesWindowService: RecentMatchesWindowService,
    private readonly matchTimelineNormalizationService: MatchTimelineNormalizationService,
  ) {}

  @Get(':matchId/timelines')
  async getMatchTimelines(@Param('matchId', ParseIntPipe) matchId: number) {
    const match = await this.getReadyMatch(matchId);
    return this.matchTimelineNormalizationService.normalizeMatch(match);
  }

  @Get(':matchId/players/:playerId/timeline')
  async getPlayerTimeline(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Param('playerId', ParseIntPipe) playerId: number,
  ) {
    const match = await this.getReadyMatch(matchId);
    const player = match.players.find((candidate) => candidate.id === playerId);
    if (!player) {
      throw new NotFoundException(`Player ${playerId} is not present in match ${matchId}.`);
    }

    return this.matchTimelineNormalizationService.normalizePlayer(player);
  }

  private async getReadyMatch(matchId: number): Promise<RecentMatchSnapshot> {
    let match = this.recentMatchesWindowService.getMatch(matchId);
    const status = this.recentMatchesWindowService.getStatus();

    if (!match && !status.lastRefreshedAt) {
      await this.recentMatchesWindowService.refresh();
      match = this.recentMatchesWindowService.getMatch(matchId);
    }

    if (!match) {
      throw new NotFoundException(`Match ${matchId} is not present in the seven-day memory window.`);
    }

    return match;
  }
}
