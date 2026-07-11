#!/usr/bin/env python3
import json, sys

data = json.load(sys.stdin)

# heroes we need signatures for
target_ids = {64, 65, 66, 69, 72, 76, 79, 80, 81}

for hero in data:
    hid = hero.get('id')
    if hid not in target_ids:
        continue
    sigs = hero.get('signatures', {})
    print(f"{hid}:  // {hero.get('name','?')}")
    for sig_id, sig_data in sigs.items():
        print(f"  {sig_id}: {sig_data.get('slot','?')},  // {sig_data.get('name','?')}")
    print()
