import {
  buildHistoricalCatalogBackfillPlan,
  normalizeHistoricalCatalogImportLimit,
} from '../src/deadlock-live/historical-catalog-backfill.service';

describe('HistoricalCatalogBackfillService helpers', () => {
  it('selects missing versions newest first and returns a cursor', () => {
    expect(buildHistoricalCatalogBackfillPlan([100, 200, 300, 400], [400], undefined, 2)).toEqual({
      clientVersions: [300, 200],
      nextBeforeClientVersion: 200,
      remainingAfterBatch: 1,
      hasMore: true,
    });
  });

  it('continues below an exclusive client version cursor', () => {
    expect(buildHistoricalCatalogBackfillPlan([100, 200, 300, 400], [400], 200, 5)).toEqual({
      clientVersions: [100],
      nextBeforeClientVersion: 100,
      remainingAfterBatch: 0,
      hasMore: false,
    });
  });

  it('caps batch size to the safe maximum', () => {
    expect(normalizeHistoricalCatalogImportLimit(500)).toBe(25);
    expect(normalizeHistoricalCatalogImportLimit(0)).toBe(5);
  });
});
