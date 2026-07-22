from pathlib import Path

path = Path('apps/api/src/deadlock-live/hero-build-contextual-v3-candidate-evaluation.service.ts')
source = path.read_text()
old = """    const itemIds = new Set(
      items
        .map((item) => Number(item.itemId))
        .filter((itemId) => Number.isSafeInteger(itemId) && itemId > 0),
    );
    const componentsByParent = new Map<number, Set<number>>();
    for (const component of components) {
      const parentItemId = Number(component.parentItemId);
      const componentItemId = Number(component.componentItemId);
      if (
        !Number.isSafeInteger(parentItemId) ||
        parentItemId <= 0 ||
        !Number.isSafeInteger(componentItemId) ||
        componentItemId <= 0 ||
        parentItemId === componentItemId
      ) {
        continue;
      }
"""
new = """    const itemIds = new Set(
      items
        .filter((item) => Number(item.cost) > 0)
        .map((item) => Number(item.itemId))
        .filter((itemId) => Number.isSafeInteger(itemId) && itemId > 0),
    );
    const componentsByParent = new Map<number, Set<number>>();
    for (const component of components) {
      const parentItemId = Number(component.parentItemId);
      const componentItemId = Number(component.componentItemId);
      if (!itemIds.has(parentItemId) || !itemIds.has(componentItemId)) {
        continue;
      }
"""
if old not in source:
    raise RuntimeError('Expected catalog block was not found')
path.write_text(source.replace(old, new))
