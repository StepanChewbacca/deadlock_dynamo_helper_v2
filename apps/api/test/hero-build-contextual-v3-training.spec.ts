import {
  assignArchetype,
  deriveArchetypeSignature,
  parseInventoryItemIds,
  selectChronologicalSplit,
} from '../src/deadlock-live/hero-build-contextual-v3-training.service';

describe('Contextual V3 training helpers', () => {
  it('creates a chronological match-level 85/15 split', () => {
    const split = selectChronologicalSplit(
      [
        { matchId: 3, startTime: '2026-07-03T00:00:00.000Z' },
        { matchId: 1, startTime: '2026-07-01T00:00:00.000Z' },
        { matchId: 4, startTime: '2026-07-04T00:00:00.000Z' },
        { matchId: 2, startTime: '2026-07-02T00:00:00.000Z' },
        { matchId: 5, startTime: '2026-07-05T00:00:00.000Z' },
        { matchId: 6, startTime: '2026-07-06T00:00:00.000Z' },
        { matchId: 7, startTime: '2026-07-07T00:00:00.000Z' },
        { matchId: 8, startTime: '2026-07-08T00:00:00.000Z' },
        { matchId: 9, startTime: '2026-07-09T00:00:00.000Z' },
        { matchId: 10, startTime: '2026-07-10T00:00:00.000Z' },
      ],
      0.85,
    );

    expect(split.train.map((value) => value.matchId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(split.validation.map((value) => value.matchId)).toEqual([9, 10]);
    expect(
      split.train.some((train) =>
        split.validation.some((validation) => validation.matchId === train.matchId),
      ),
    ).toBe(false);
  });

  it('limits archetype signatures to the first four actions', () => {
    expect(
      deriveArchetypeSignature([
        'BUY:1',
        'BUY:2',
        'UPGRADE:3',
        'BUY:4',
        'BUY:5',
      ]),
    ).toBe('BUY:1>BUY:2>UPGRADE:3>BUY:4');
  });

  it('assigns an archetype only from the observed prefix', () => {
    const definitions = {
      '11': [
        {
          id: 'H11-A1',
          heroId: 11,
          rank: 1,
          signature: 'BUY:1>BUY:2>BUY:3>BUY:4',
          actionKeys: ['BUY:1', 'BUY:2', 'BUY:3', 'BUY:4'],
          playerCount: 500,
        },
        {
          id: 'H11-A2',
          heroId: 11,
          rank: 2,
          signature: 'BUY:9>BUY:8>BUY:7>BUY:6',
          actionKeys: ['BUY:9', 'BUY:8', 'BUY:7', 'BUY:6'],
          playerCount: 300,
        },
      ],
    };

    expect(assignArchetype(11, [], definitions)).toBe('UNKNOWN');
    expect(assignArchetype(11, ['BUY:1'], definitions)).toBe('H11-A1');
    expect(assignArchetype(11, ['BUY:9', 'BUY:8'], definitions)).toBe('H11-A2');
    expect(assignArchetype(11, ['BUY:100'], definitions)).toBe('OTHER');
  });

  it('parses canonical inventory state keys', () => {
    expect([...parseInventoryItemIds('EMPTY')]).toEqual([]);
    expect([...parseInventoryItemIds('100x1|200x2|300x1')]).toEqual([
      100,
      200,
      300,
    ]);
  });
});
