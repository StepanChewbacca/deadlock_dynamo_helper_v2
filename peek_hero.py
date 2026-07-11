#!/usr/bin/env python3
import json, sys

data = json.load(sys.stdin)
for hero in data:
    hid = hero.get('id')
    if hid in (1, 13, 64):  # Infernus, Haze, and Drifter
        print(f"ID {hid}: {hero.get('name','?')}")
        sigs = hero.get('signatures', {})
        print(f"  signatures keys: {list(sigs.keys())}")
        for sig_id, sig_data in sigs.items():
            print(f"    {sig_id}: {json.dumps(sig_data, indent=6)}")
        print()
        if hid == 64:
            break
