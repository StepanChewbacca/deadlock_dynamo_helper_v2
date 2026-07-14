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

  it('keeps non-acquisition actions even when the item was purchased earlier', () => {
    expect(
      selectUniqueBuildRowIndexes([
        { action: 'BUY', itemName: 'Grit' },
        { action: 'SELL', itemName: 'Grit' },
      ]),
    ).toEqual([0, 1]);
  });
});
