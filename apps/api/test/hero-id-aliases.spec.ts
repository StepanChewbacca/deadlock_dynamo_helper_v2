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

  it('preserves compatibility mappings used at API boundaries', () => {
    expect(GEP_TO_VALVE_ID[2]).toBe(64);
    expect(VALVE_TO_GEP_ID[64]).toBe(2);
  });

  it('resolves live Victor and Yamato ids to distinct Valve hero ids', () => {
    expect(resolveValveHeroIdFromGep(27)).toBe(66);
    expect(resolveValveHeroIdFromGep(16)).toBe(27);
    expect(resolveValveHeroIdFromGep(999)).toBe(999);
  });
});
