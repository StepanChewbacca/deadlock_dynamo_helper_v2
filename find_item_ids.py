#!/usr/bin/env python3
import json, sys

data = json.load(sys.stdin)

targets = {1, 64, 65, 66, 69, 72, 76, 79, 80, 81}

for hero in data:
    hid = hero.get('id')
    if hid not in targets:
        continue

    name = hero.get('name')
    items = hero.get('items', {})

    print(f"ID {hid} ({name}):")
    print(f"  items = {json.dumps(items, indent=4)}")

    # Also look at any other fields that might have ability IDs
    for key, val in hero.items():
        if isinstance(val, dict):
            if any(x in key.lower() for x in ['ability', 'skill', 'signature']):
                print(f"  {key}: {json.dumps(val, indent=4)[:500]}")

    print()
