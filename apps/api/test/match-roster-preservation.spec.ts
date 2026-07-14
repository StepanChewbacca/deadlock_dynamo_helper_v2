import { RawMatchMetadata } from '../src/deadlock-live/entities/raw-match-metadata.entity';
import {
  countValidUniquePlayerHeroes,
  selectBestRawMatchMetadata,
} from '../src/deadlock-live/raw-match-metadata.service';
import { shouldPruneMissingMatchPlayers } from '../src/deadlock-live/stored-match-reprocessing.service';

describe('match roster preservation', () => {
  it('counts only valid unique player hero ids', () => {
    expect(
      countValidUniquePlayerHeroes({
        match_info: {
          players: [
            { hero_id: 1 },
            { hero_id: '2' },
            { hero_id: 2 },
            { hero_id: 0 },
            { hero_id: -1 },
            {},
            null,
          ],
        },
      }),
    ).toBe(2);
  });

  it('prefers an older complete snapshot over a newer incomplete snapshot', () => {
    const newerIncomplete = createRawMetadata(2, 11);
    const olderComplete = createRawMetadata(1, 12);

    expect(selectBestRawMatchMetadata([newerIncomplete, olderComplete])?.id).toBe(1);
  });

  it('preserves repository order when snapshots have equal completeness', () => {
    const newest = createRawMetadata(3, 12);
    const older = createRawMetadata(2, 12);

    expect(selectBestRawMatchMetadata([newest, older])?.id).toBe(3);
  });

  it('does not prune a complete stored roster from an incomplete snapshot', () => {
    expect(shouldPruneMissingMatchPlayers(12, 11)).toBe(false);
  });

  it('allows pruning when the incoming snapshot is at least as complete', () => {
    expect(shouldPruneMissingMatchPlayers(11, 12)).toBe(true);
    expect(shouldPruneMissingMatchPlayers(12, 12)).toBe(true);
  });
});

function createRawMetadata(id: number, playerCount: number): RawMatchMetadata {
  return Object.assign(new RawMatchMetadata(), {
    id,
    matchId: 93405163,
    fetchedAt: new Date(`2026-07-12T${String(id).padStart(2, '0')}:00:00.000Z`),
    payload: {
      match_info: {
        players: Array.from({ length: playerCount }, (_, index) => ({
          hero_id: index + 1,
        })),
      },
    },
  });
}
