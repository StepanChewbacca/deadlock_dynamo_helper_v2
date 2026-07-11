import {
  normalizeCatalogItem,
  normalizeClientVersions,
  selectClientVersions,
} from '../src/deadlock-live/item-catalog-import.service';

describe('ItemCatalogImportService helpers', () => {
  it('normalizes and sorts client versions', () => {
    expect(normalizeClientVersions([7000, '6518', 7000, -1, 'bad'])).toEqual([
      6518,
      7000,
    ]);
  });

  it('selects the latest version by default and supports explicit backfills', () => {
    const available = [6000, 6100, 6200, 6300];

    expect(selectClientVersions(available, {})).toEqual([6300]);
    expect(selectClientVersions(available, { maxVersions: 2 })).toEqual([6200, 6300]);
    expect(selectClientVersions(available, { importAll: true })).toEqual(available);
    expect(selectClientVersions(available, { clientVersions: [6100, 6300] })).toEqual([
      6100,
      6300,
    ]);
  });

  it('preserves raw item payload and recipe component references', () => {
    const raw = {
      id: 2064029594,
      name: 'Opening Rounds',
      class_name: 'upgrade_pristine_emblem',
      item_slot_type: 'weapon',
      cost: 4250,
      item_tier: 3,
      type: 'upgrade',
      shopable: true,
      disabled: false,
      is_active_item: false,
      component_items: ['upgrade_high_velocity_mag'],
    };

    expect(normalizeCatalogItem(raw)).toEqual({
      itemId: 2064029594,
      name: 'Opening Rounds',
      className: 'upgrade_pristine_emblem',
      itemType: 'upgrade',
      slotType: 'weapon',
      cost: 4250,
      tier: 3,
      shopable: true,
      disabled: false,
      active: true,
      isActiveItem: false,
      activationType: undefined,
      componentReferences: ['upgrade_high_velocity_mag'],
      rawPayload: raw,
    });
  });
});
