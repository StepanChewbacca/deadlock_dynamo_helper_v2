import { getCatalogContentVersionId } from '../src/deadlock-live/entities/item-catalog-version.entity';

describe('item catalog content resolution', () => {
  it('uses the catalog itself for canonical content', () => {
    expect(
      getCatalogContentVersionId({
        id: 10,
        contentCatalogVersionId: undefined as unknown as number,
      }),
    ).toBe(10);
  });

  it('uses the shared canonical catalog for duplicate content', () => {
    expect(
      getCatalogContentVersionId({
        id: 11,
        contentCatalogVersionId: 10,
      }),
    ).toBe(10);
  });
});
