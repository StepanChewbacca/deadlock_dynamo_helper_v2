import { selectUniqueBuildRowIndexes } from './live-build-desktop-dedup';

describe('desktop full build item deduplication', () => {
  it('keeps only the first BUY or UPGRADE for each item', () => {
    expect(
      selectUniqueBuildRowIndexes([
        { action: 'BUY', itemName: 'Grit' },
        { action: 'UPGRADE', itemName: 'Reactive Barrier' },
        { action: 'UPGRADE', itemName: 'Indomitable' },
        { action: 'BUY', itemName: 'Grit' },
        { action: 'UPGRADE', itemName: 'Reactive Barrier' },
        { action: 'UPGRADE', itemName: 'Indomitable' },
      ]),
    ).toEqual([0, 1, 2]);
  });

  it('normalizes item name casing and whitespace', () => {
    expect(
      selectUniqueBuildRowIndexes([
        { action: 'BUY', itemName: 'Spirit Resilience' },
        { action: 'buy', itemName: '  spirit   resilience  ' },
      ]),
    ).toEqual([0]);
  });

  it('removes an immediate BUY followed by SELL of the same item', () => {
    expect(
      selectUniqueBuildRowIndexes([
        { action: 'UPGRADE', itemName: 'Boundless Spirit' },
        { action: 'BUY', itemName: 'Bullet Lifesteal' },
        { action: 'SELL', itemName: 'Bullet Lifesteal' },
      ]),
    ).toEqual([0]);
  });

  it('allows the item to be acquired later after an immediate reversal', () => {
    expect(
      selectUniqueBuildRowIndexes([
        { action: 'BUY', itemName: 'Bullet Lifesteal' },
        { action: 'SELL', itemName: 'Bullet Lifesteal' },
        { action: 'BUY', itemName: 'Bullet Lifesteal' },
      ]),
    ).toEqual([2]);
  });

  it('keeps a non-immediate SELL action', () => {
    expect(
      selectUniqueBuildRowIndexes([
        { action: 'BUY', itemName: 'Grit' },
        { action: 'BUY', itemName: 'Bullet Lifesteal' },
        { action: 'SELL', itemName: 'Grit' },
      ]),
    ).toEqual([0, 1, 2]);
  });
});
