import { Controller, Get, NotFoundException, Param, ParseIntPipe } from '@nestjs/common';
import { MatchTimelineNormalizationService } from './match-timeline-normalization.service';
import { RecentMatchesWindowService } from './recent-matches-window.service';

@Controller('deadlock/analysis/recent-matches')
export class MatchTimelineNormalizationController {
  constructor(
    private readonly recentMatchesWindowService: RecentMatchesWindowService,
    private readonly matchTimelineNormalizationService: MatchTimelineNormalizationService,
  ) {}

  @Get(':matchId/timelines')
  getMatchTimelines(@Param('matchId', ParseIntPipe) matchId: number) {
    const match = this.recentMatchesWindowService.getMatch(matchId);
    if (!match) {
      throw new NotFoundException(`Match ${matchId} is not present in the seven-day memory window.`);
    }

    return this.matchTimelineNormalizationService.normalizeMatch(match);
  }

  @Get(':matchId/players/:playerId/timeline')
  getPlayerTimeline(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Param('playerId', ParseIntPipe) playerId: number,
  ) {
    const match = this.recentMatchesWindowService.getMatch(matchId);
    if (!match) {
      throw new NotFoundException(`Match ${matchId} is not present in the seven-day memory window.`);
    }

    const player = match.players.find((candidate) => candidate.id === playerId);
    if (!player) {
      throw new NotFoundException(`Player ${playerId} is not present in match ${matchId}.`);
    }

    return this.matchTimelineNormalizationService.normalizePlayer(player);
  }
}
