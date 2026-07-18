import type { Repository } from 'typeorm';
import { HeroBuildOfflineEvaluationDataLoaderService } from '../src/deadlock-live/hero-build-offline-evaluation-data-loader.service';
import type { CanonicalBuildSequenceService } from '../src/deadlock-live/canonical-build-sequence.service';
import type { Hero } from '../src/deadlock-live/entities/hero.entity';
import type { MatchPlayerItem } from '../src/deadlock-live/entities/match-player-item.entity';
import type { MatchPlayer } from '../src/deadlock-live/entities/match-player.entity';
import type { Match } from '../src/deadlock-live/entities/match.entity';
import type { InventoryTimelineReplayService } from '../src/deadlock-live/inventory-timeline-replay.service';
import type { MatchTimelineNormalizationService } from '../src/deadlock-live/match-timeline-normalization.service';

describe('HeroBuildOfflineEvaluationDataLoaderService', () => {
  it('uses the reference hero catalog without reading evaluation-window rosters', async () => {
    const matchRepository = {
      find: jest.fn(),
    } as unknown as Repository<Match>;
    const matchPlayerRepository = {
      find: jest.fn(),
    } as unknown as Repository<MatchPlayer>;
    const matchPlayerItemRepository = {
      find: jest.fn(),
    } as unknown as Repository<MatchPlayerItem>;
    const heroRepository = {
      find: jest.fn(async () => [
        { heroId: 27 },
        { heroId: 16 },
        { heroId: 16 },
        { heroId: 0 },
      ]),
    } as unknown as Repository<Hero>;
    const service = new HeroBuildOfflineEvaluationDataLoaderService(
      matchRepository,
      matchPlayerRepository,
      matchPlayerItemRepository,
      heroRepository,
      {} as MatchTimelineNormalizationService,
      {} as InventoryTimelineReplayService,
      {} as CanonicalBuildSequenceService,
    );

    const heroIds = await service.collectHeroIds(
      [
        {
          matchId: 1,
          startTime: new Date('2026-07-18T00:00:00.000Z'),
        },
      ],
      100,
    );

    expect(heroIds).toEqual([16, 27]);
    expect(heroRepository.find).toHaveBeenCalledWith({
      order: { heroId: 'ASC' },
    });
    expect(matchPlayerRepository.find).not.toHaveBeenCalled();
  });
});
