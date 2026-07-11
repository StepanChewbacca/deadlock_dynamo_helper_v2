#!/usr/bin/env python3
import json, sys

data = json.load(sys.stdin)

# Find the ability items we need for the missing heroes
ability_names = [
    "drifter_blood_blast", "drifter_shadow_mark", "ability_drifter_hunger", "drifter_darkness",
    "ability_priest_flashbang", "ability_priest_knockback", "ability_priest_beartrap", "ability_priest_weaponswap",
    "ability_frank_shocktarget2", "ability_frank_selfzap", "ability_frank_painaura", "ability_frank_revive",
    "ability_doorman_bomb", "ability_doorman_doorway", "ability_doorman_luggage_cart", "ability_doorman_hotel",
    "ability_punkgoat_ult", "ability_punkgoat_goatflip", "ability_punkgoat_blasted", "ability_punkgoat_tether",
    "ability_necro_hauntingskull", "ability_necro_zombiewall", "ability_necro_fear", "ability_necro_gravestone",
    "ability_familiar_ability02", "ability_familiar_attach", "ability_familiar_helpinghands", "ability_familiar_ability01",
    "ability_werewolf_unloadgun", "ability_werewolf_kickflip", "ability_werewolf_netshot", "ability_werewolf_transformation",
    "ability_unicorn_radiantblast", "ability_unicorn_prismaticguard", "ability_unicorn_luminousstrike", "ability_unicorn_dazzlingorb",
    # existing hero ability names to verify our mapping
    "ability_incendiary_projectile", "ability_flame_dash", "ability_afterburn", "ability_fire_bomb",
]

# Print first 5 items to see the structure
for i, item in enumerate(data[:5]):
    print(f"Item {i}: id={item.get('id')}, name={item.get('name')}, class={item.get('class_name')}")
