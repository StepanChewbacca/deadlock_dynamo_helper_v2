export const HERO_ID_ALIASES: Readonly<Record<number, readonly number[]>> = {
  1: [1, 14],
  2: [2, 64],
  3: [3],
  4: [4],
  6: [6, 72],
  7: [7],
  8: [8, 69],
  10: [10],
  11: [11],
  12: [12, 76],
  13: [13],
  14: [14],
  15: [15, 80],
  16: [16, 27],
  17: [17, 79],
  18: [18],
  19: [19, 81],
  20: [20, 65],
  25: [25],
  27: [27, 66],
  31: [31, 50],
  35: [35, 60],
  50: [50],
  52: [52],
  58: [58],
  60: [60],
  63: [63],
  67: [67],
  72: [72],
  77: [77],
};

const HERO_ALIAS_TO_CANONICAL_ID: Readonly<Record<number, number>> = Object.freeze(
  Object.entries(HERO_ID_ALIASES).reduce<Record<number, number>>(
    (aliasesById, [canonicalId, aliases]) => {
      for (const alias of aliases) {
        aliasesById[alias] = Number(canonicalId);
      }
      return aliasesById;
    },
    {},
  ),
);

export function canonicalHeroId(heroId: number): number {
  return HERO_ALIAS_TO_CANONICAL_ID[heroId] ?? heroId;
}

export function heroIdAliases(heroId: number): readonly number[] {
  const canonicalId = canonicalHeroId(heroId);
  return HERO_ID_ALIASES[canonicalId] ?? [heroId];
}

export const GEP_TO_VALVE_ID: Readonly<Record<number, number>> = Object.freeze(
  Object.fromEntries(
    Object.entries(HERO_ID_ALIASES).map(([canonicalId, aliases]) => [
      Number(canonicalId),
      aliases[aliases.length - 1],
    ]),
  ),
);

export const VALVE_TO_GEP_ID: Readonly<Record<number, number>> =
  HERO_ALIAS_TO_CANONICAL_ID;

export function resolveValveHeroIdFromGep(heroId: number): number {
  return GEP_TO_VALVE_ID[heroId] ?? heroId;
}
