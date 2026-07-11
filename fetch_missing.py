#!/usr/bin/env python3
import json, sys

data = json.load(sys.stdin)
missing_names = ['billy', 'celeste', 'doorman', 'drifter', 'graves', 'rem', 'silver', 'venator', 'victor', 'apollo', 'paige', 'mina', 'sinclair', 'vyper']

for hero in data:
    name = hero.get('name', '').lower().replace(' ', '').replace('the', '')
    hid = hero.get('id', '?')
    for m in missing_names:
        if m in name:
            sigs = hero.get('signatures', {})
            print(f"ID {hid}: {hero.get('name','?')} (class={hero.get('className','')})")
            for sig_id, sig_data in sigs.items():
                print(f"  sig {sig_id}: slot={sig_data.get('slot','?')}, name={sig_data.get('name','?')}")
            print()
