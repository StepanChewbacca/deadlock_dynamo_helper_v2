import json

with open('/tmp/items.json') as f:
    items = json.load(f)

with open('/tmp/heroes.json') as f:
    heroes = json.load(f)

# Build class_name -> item_id map
class_to_id = {}
for item in items:
    cn = item.get('class_name')
    if cn and item.get('id'):
        class_to_id[cn] = item['id']

# Also build by name matching for items that may not have exact class_name match
name_to_id = {}
for item in items:
    name = item.get('name', '')
    if name:
        name_to_id[name.lower()] = item['id']

# Print ability items found
print("=== Ability items found in /items ===")
for item in items:
    cn = item.get('class_name', '')
    if cn.startswith('ability_') and 'melee' not in cn and 'mantle' not in cn and 'jump' not in cn and 'slide' not in cn and 'zip' not in cn and 'climb' not in cn and 'innate' not in cn and 'dash' not in cn and 'sprint' not in cn and 'parry' not in cn:
        print(f"  {item['id']}: class_name={cn}, name={item.get('name','')}")

print("\n=== Heroes and their signature abilities ===")
for h in heroes:
    hid = h['id']
    name = h['name']
    sigs = []
    for i in range(1, 5):
        key = f'signature{i}'
        if key in h.get('items', {}):
            sig_cn = h['items'][key]
            sig_id = class_to_id.get(sig_cn, 'NOT_FOUND')
            sigs.append((i, sig_cn, sig_id))
    has_all = all(s[2] != 'NOT_FOUND' for s in sigs)
    status = "OK" if has_all else "MISSING"
    print(f"  {hid}: {name} [{status}]")
    for slot, cn, sid in sigs:
        print(f"    sig{slot}: class_name={cn} -> item_id={sid}")
    if not has_all:
        # Try to find by name
        for slot, cn, sid in sigs:
            if sid == 'NOT_FOUND':
                # Try extracting from class_name
                parts = cn.split('_')
                search_term = cn
                for item in items:
                    item_cn = item.get('class_name', '')
                    if cn in item_cn or item_cn in cn:
                        print(f"      -> partial match: {item['id']} {item_cn} {item.get('name','')}")
                # Also try by name guess
                for item in items:
                    item_name = item.get('name', '').lower()
                    if 'ability' in item_name and any(p in item_name for p in cn.split('_') if len(p) > 3):
                        print(f"      -> name match: {item['id']} {item.get('class_name','')} {item.get('name','')}")
    print()

# Print all signature class_names not found
print("\n=== All signature class_names NOT found in items ===")
for h in heroes:
    for i in range(1, 5):
        key = f'signature{i}'
        if key in h.get('items', {}):
            sig_cn = h['items'][key]
            if sig_cn not in class_to_id:
                print(f"  Hero {h['id']} ({h['name']}): {sig_cn}")
