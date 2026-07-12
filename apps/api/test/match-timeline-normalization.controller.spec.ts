import { NotFoundException } from '@nestjs/common';
import { MatchTimelineNormalizationController } from '../src/deadlock-live/match-timeline-normalization.controller';
import { MatchTimelineNormalizationService } from '../src/deadlock-live/match-timeline-normalization.service';
import {
  RecentMatchSnapshot,
  RecentMatchesWindowService,
} from '../src/deadlock-live/recent-matches-window.service';

describe('MatchTimelineNormalizationController', () => {
  const match: RecentMatchSnapshot = {
    matchId: 91825430,
    startTime: new Date('2026-07-10T13:07:49.000Z'),
    durationS: 2400,
    averageBadge: 116,
    winningTeam: 0,
    players: [],
  };

  it('waits for the initial memory window refresh before returning a timeline', async () => {
    let ready = false;
    const recentMatchesWindowService = {
      getMatch: jest.fn(() => (ready ? match : undefined)),
      getStatus: jest.fn(() => ({ lastRefreshedAt: ready ? new Date() : undefined })),
      refresh: jest.fn(async () => {
        ready = true;
        return {};
      }),
    } as unknown as RecentMatchesWindowService;
    const matchTimelineNormalizationService = {
      normalizeMatch: jest.fn(() => ({ matchId: match.matchId })),
    } as unknown as MatchTimelineNormalizationService;
    const controller = new MatchTimelineNormalizationController(
      recentMatchesWindowService,
      matchTimelineNormalizationService,
    );

    await expect(controller.getMatchTimelines(match.matchId)).resolves.toEqual({
      matchId: match.matchId,
    });
    expect(recentMatchesWindowService.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not run an extra refresh for a genuinely absent match after initialization', async () => {
    const recentMatchesWindowService = {
      getMatch: jest.fn(() => undefined),
      getStatus: jest.fn(() => ({ lastRefreshedAt: new Date() })),
      refresh: jest.fn(),
    } as unknown as RecentMatchesWindowService;
    const matchTimelineNormalizationService = {} as MatchTimelineNormalizationService;
    const controller = new MatchTimelineNormalizationController(
      recentMatchesWindowService,
      matchTimelineNormalizationService,
    );

    await expect(controller.getMatchTimelines(match.matchId)).rejects.toBeInstanceOf(NotFoundException);
    expect(recentMatchesWindowService.refresh).not.toHaveBeenCalled();
  });
});
