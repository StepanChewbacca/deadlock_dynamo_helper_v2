#!/usr/bin/env python3
import json, sys

data = json.load(sys.stdin)

# Look at all keys for a few heroes
for hero in data[:5]:
    hid = hero.get('id')
    name = hero.get('name')
    print(f"\nID {hid} ({name}): top-level keys = {list(hero.keys())}")

    # Look for anything ability-related
    for key in hero.keys():
        val = hero[key]
        if isinstance(val, dict):
            print(f"  {key} sub-keys: {list(val.keys())[:10]}")
        elif isinstance(val, list):
            print(f"  {key} is list of length {len(val)}")
        elif isinstance(val, str) and len(val) < 200:
            print(f"  {key} = '{val}'")

# Now look for hero 64 (Drifter)
for hero in data:
    if hero.get('id') == 64:
        print(f"\n\nID 64 (Drifter) FULL:")
        print(json.dumps(hero, indent=2)[:3000])
        break
