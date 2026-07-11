#!/usr/bin/env python3
import json, sys

# Load items data
items_data = json.load(sys.stdin)

# Build class_name → numeric ID map
name_to_id = {}
for item in items_data:
    cname = item.get('class_name', '')
    name_to_id[cname] = item.get('id')

# Hero ID → [signature1, signature2, signature3, signature4] class names
# from the heroes API (we hardcode what we saw)
hero_abilities = {
    64: ["drifter_blood_blast", "drifter_shadow_mark", "ability_drifter_hunger", "drifter_darkness"],
    65: ["ability_priest_flashbang", "ability_priest_knockback", "ability_priest_beartrap", "ability_priest_weaponswap"],
    66: ["ability_frank_shocktarget2", "ability_frank_selfzap", "ability_frank_painaura", "ability_frank_revive"],
    69: ["ability_doorman_bomb", "ability_doorman_doorway", "ability_doorman_luggage_cart", "ability_doorman_hotel"],
    72: ["ability_punkgoat_ult", "ability_punkgoat_goatflip", "ability_punkgoat_blasted", "ability_punkgoat_tether"],
    76: ["ability_necro_hauntingskull", "ability_necro_zombiewall", "ability_necro_fear", "ability_necro_gravestone"],
    79: ["ability_familiar_ability02", "ability_familiar_attach", "ability_familiar_helpinghands", "ability_familiar_ability01"],
    80: ["ability_werewolf_unloadgun", "ability_werewolf_kickflip", "ability_werewolf_netshot", "ability_werewolf_transformation"],
    81: ["ability_unicorn_radiantblast", "ability_unicorn_prismaticguard", "ability_unicorn_luminousstrike", "ability_unicorn_dazzlingorb"],
}

# Also verify existing heroes' ability IDs
existing_abilities = {
    1: ["ability_incendiary_projectile", "ability_flame_dash", "ability_afterburn", "ability_fire_bomb"],
}

print("// MISSING HEROES - add these to HERO_ABILITY_MAP")
for hid, sigs in hero_abilities.items():
    print(f"  {hid}: {{")
    for i, sname in enumerate(sigs, 1):
        nid = name_to_id.get(sname)
        if nid:
            print(f"    {nid}: {i},")
        else:
            print(f"    // MISSING: {sname} not found in items API")
    print("  },")

print()
print("// VERIFY existing heroes")
for hid, sigs in existing_abilities.items():
    print(f"  Hero {hid}:")
    for i, sname in enumerate(sigs, 1):
        nid = name_to_id.get(sname)
        if nid:
            print(f"    {sname} → {nid}")
        else:
            print(f"    {sname} → NOT FOUND")
