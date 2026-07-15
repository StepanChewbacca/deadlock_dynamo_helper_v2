import {
  isAbilityItem,
  mapAbilityToSkillNumber,
  UNKNOWN_SKILL_SLOT,
} from '../src/deadlock-live/hero-abilities';

describe('hero-abilities', () => {
  it('maps official hero IDs to correct ability slots from API signatures', () => {
    // Kelvin (12) - sig1=ability_ice_grenade(18921423), sig4=ability_ice_dome(3826390464)
    expect(mapAbilityToSkillNumber(12, 18921423)).toBe(1);
    expect(mapAbilityToSkillNumber(12, 3826390464)).toBe(4);
    // Haze (13) - sig1=ability_sleep_dagger(2948410412), sig4=ability_bullet_flurry(731943444)
    expect(mapAbilityToSkillNumber(13, 2948410412)).toBe(1);
    expect(mapAbilityToSkillNumber(13, 731943444)).toBe(4);
    // Seven (2) - sig1=citadel_ability_lightning_ball(1065103387)
    expect(mapAbilityToSkillNumber(2, 1065103387)).toBe(1);
    // Viscous (35) - sig1=viscous_goo_grenade(3247040238)
    expect(mapAbilityToSkillNumber(35, 3247040238)).toBe(1);
  });

  it('maps newly added hero IDs to their own distinct abilities', () => {
    // Drifter (64) - separate hero with own ability IDs
    expect(mapAbilityToSkillNumber(64, 3120550633)).toBe(1);
    expect(mapAbilityToSkillNumber(64, 1168182161)).toBe(4);
    // Graves (76) - separate hero with own ability IDs
    expect(mapAbilityToSkillNumber(76, 3214055642)).toBe(1);
    expect(mapAbilityToSkillNumber(76, 4110547059)).toBe(4);
    // Celeste (81) - own abilities, not same as Shiv
    expect(mapAbilityToSkillNumber(81, 3443575800)).toBe(1);
    expect(isAbilityItem(80, 515791019)).toBe(true);
  });

  it('returns the unknown marker instead of silently using skill one', () => {
    expect(mapAbilityToSkillNumber(12, 999999999)).toBe(UNKNOWN_SKILL_SLOT);
    expect(mapAbilityToSkillNumber(99, 12345)).toBe(UNKNOWN_SKILL_SLOT);
  });
});
