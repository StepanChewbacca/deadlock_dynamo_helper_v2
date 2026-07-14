import { FindManyOptions, Repository } from 'typeorm';
import { createUnlimitedMatchPlayerRepository } from '../src/deadlock-live/all-heroes-analysis-facade.service';
import { MatchPlayer } from '../src/deadlock-live/entities/match-player.entity';

describe('all heroes analysis facade', () => {
  it('removes legacy per-hero take limits while preserving the query', async () => {
    const find = jest.fn(async () => [] as MatchPlayer[]);
    const repository = { find } as unknown as Repository<MatchPlayer>;
    const unlimitedRepository = createUnlimitedMatchPlayerRepository(repository);
    const options: FindManyOptions<MatchPlayer> = {
      where: { heroId: 11 },
      order: { crawledAt: 'DESC' },
      take: 1_000,
    };

    await unlimitedRepository.find(options);

    expect(find).toHaveBeenCalledWith({
      where: { heroId: 11 },
      order: { crawledAt: 'DESC' },
    });
  });
});
