import { InventoryItem, RecipeDefinition } from '../../src';

export const MATCH_93314383_ITEMS = {
  extraRegen: {
    itemId: 2829638276,
    className: 'upgrade_endurance',
    name: 'Extra Regen',
    enhanced: false,
  },
  highVelocityRounds: {
    itemId: 3077079169,
    className: 'upgrade_high_velocity_mag',
    name: 'High-Velocity Rounds',
    enhanced: false,
  },
  openingRounds: {
    itemId: 2064029594,
    className: 'upgrade_pristine_emblem',
    name: 'Opening Rounds',
    enhanced: false,
  },
  kineticDash: {
    itemId: 3977876567,
    className: 'upgrade_kinetic_sash',
    name: 'Kinetic Dash',
    enhanced: false,
  },
} satisfies Record<string, InventoryItem>;

export const MATCH_93314383_RECIPES: RecipeDefinition[] = [
  {
    parentItemId: MATCH_93314383_ITEMS.openingRounds.itemId,
    componentItemIds: [MATCH_93314383_ITEMS.highVelocityRounds.itemId],
  },
];

export const MATCH_93314383_SNAPSHOTS: Array<{ gameTimeSec: number; items: InventoryItem[] }> = [
  { gameTimeSec: 15, items: [] },
  { gameTimeSec: 168, items: [MATCH_93314383_ITEMS.extraRegen] },
  {
    gameTimeSec: 301,
    items: [MATCH_93314383_ITEMS.extraRegen, MATCH_93314383_ITEMS.highVelocityRounds],
  },
  {
    gameTimeSec: 302,
    items: [MATCH_93314383_ITEMS.extraRegen, MATCH_93314383_ITEMS.openingRounds],
  },
  {
    gameTimeSec: 350,
    items: [
      MATCH_93314383_ITEMS.extraRegen,
      MATCH_93314383_ITEMS.openingRounds,
      MATCH_93314383_ITEMS.kineticDash,
    ],
  },
  {
    gameTimeSec: 351,
    items: [MATCH_93314383_ITEMS.extraRegen, MATCH_93314383_ITEMS.openingRounds],
  },
  {
    gameTimeSec: 386,
    items: [
      MATCH_93314383_ITEMS.extraRegen,
      MATCH_93314383_ITEMS.openingRounds,
      MATCH_93314383_ITEMS.kineticDash,
    ],
  },
];
