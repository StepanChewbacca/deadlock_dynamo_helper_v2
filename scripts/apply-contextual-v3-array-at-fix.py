from pathlib import Path

path = Path('apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts')
source = path.read_text()
old = "const previousSnapshot = runtime.inventorySnapshots.at(-1);"
new = "const previousSnapshot = runtime.inventorySnapshots[runtime.inventorySnapshots.length - 1];"
if old not in source:
    raise RuntimeError('Expected Array.at usage was not found')
path.write_text(source.replace(old, new, 1))
