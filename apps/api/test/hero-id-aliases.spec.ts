import {
  canonicalHeroId,
  GEP_TO_VALVE_ID,
  heroIdAliases,
  resolveValveHeroIdFromGep,
  VALVE_TO_GEP_ID,
} from '../src/deadlock-live/hero-id-aliases';

describe('hero id aliases', () => {
  it('normalizes legacy aliases to the active canonical hero id', () => {
    expect(canonicalHeroId(64)).toBe(2);
    expect(canonicalHeroId(76)).toBe(12);
  });

  it('keeps active canonical ids stable when legacy ids collide', () => {
    expect(canonicalHeroId(14)).toBe(14);
    expect(canonicalHeroId(72)).toBe(72);
  });

  it('returns all known ids for a hero and falls back for unknown ids', () => {
    expect(heroIdAliases(64)).toEqual([2, 64]);
    expect(heroIdAliases(999)).toEqual([999]);
  });

  it('keeps GEP mappings explicit instead of deriving them from legacy aliases', () => {
    expect(GEP_TO_VALVE_ID[16]).toBe(27);
    expect(GEP_TO_VALVE_ID[27]).toBe(66);
    expect(VALVE_TO_GEP_ID[27]).toBe(16);
    expect(VALVE_TO_GEP_ID[66]).toBe(27);
    expect(GEP_TO_VALVE_ID[2]).toBeUndefined();
    expect(GEP_TO_VALVE_ID[6]).toBeUndefined();
  });

  it('resolves live Victor and Yamato ids without remapping unrelated heroes', () => {
    expect(resolveValveHeroIdFromGep(27)).toBe(66);
    expect(resolveValveHeroIdFromGep(16)).toBe(27);
    expect(resolveValveHeroIdFromGep(2)).toBe(2);
    expect(resolveValveHeroIdFromGep(6)).toBe(6);
    expect(resolveValveHeroIdFromGep(72)).toBe(72);
    expect(resolveValveHeroIdFromGep(999)).toBe(999);
  });
});
