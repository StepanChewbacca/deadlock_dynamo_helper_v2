#!/usr/bin/env python3
import json, sys

data = json.load(sys.stdin)
for i, hero in enumerate(data[:3]):
    print(f"=== Hero {i} ===")
    print(json.dumps(hero, indent=2)[:2000])
    print()
