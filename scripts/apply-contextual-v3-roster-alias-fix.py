from pathlib import Path

path = Path('apps/api/src/deadlock-live/hero-build-contextual-v3-live.service.ts')
source = path.read_text()
old_import = "import type { HeroBuildContextualRecommendationRequest } from './contextual-hero-build-recommendation.service';\n"
new_import = old_import + "import { canonicalHeroId } from './hero-id-aliases';\n"
if old_import not in source:
    raise RuntimeError('Expected contextual request import was not found')
source = source.replace(old_import, new_import, 1)
old = """function normalizeHeroIds(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))]
    .sort((left, right) => left - right);
}
"""
new = """function normalizeHeroIds(values: readonly number[]): number[] {
  return [
    ...new Set(
      values
        .filter((value) => Number.isSafeInteger(value) && value > 0)
        .map((value) => canonicalHeroId(value)),
    ),
  ].sort((left, right) => left - right);
}
"""
if old not in source:
    raise RuntimeError('Expected normalizeHeroIds helper was not found')
path.write_text(source.replace(old, new, 1))

test_path = Path('apps/api/test/hero-build-contextual-v3-live.spec.ts')
test_source = test_path.read_text()
marker = """  it('ignores duplicate inventory snapshots', () => {
"""
addition = """  it('canonicalizes roster hero aliases before model lookup', () => {
    expect(
      normalizeContextualV3RosterHeroIdsForTest([64, 2, 76, 12]),
    ).toEqual([2, 12]);
  });

"""
if marker not in test_source:
    raise RuntimeError('Expected live helper test marker was not found')
# Test through a small exported helper to avoid constructing repositories.
test_path.write_text(test_source.replace(marker, addition + marker, 1))

# Export a narrow helper used by the focused unit test.
source = path.read_text()
old_signature = "function normalizeHeroIds(values: readonly number[]): number[] {"
new_signature = "export function normalizeContextualV3RosterHeroIdsForTest(\n  values: readonly number[],\n): number[] {"
if old_signature not in source:
    raise RuntimeError('Expected normalize helper signature was not found')
source = source.replace(old_signature, new_signature, 1)
source = source.replace(
    'const alliedHeroIds = normalizeHeroIds(request.alliedHeroIds ?? []);',
    'const alliedHeroIds = normalizeContextualV3RosterHeroIdsForTest(\n      request.alliedHeroIds ?? [],\n    );',
    1,
)
source = source.replace(
    'const enemyHeroIds = normalizeHeroIds(request.enemyHeroIds ?? []);',
    'const enemyHeroIds = normalizeContextualV3RosterHeroIdsForTest(\n      request.enemyHeroIds ?? [],\n    );',
    1,
)
path.write_text(source)

test_source = test_path.read_text()
test_source = test_source.replace(
    """  getContextualV3Phase,
} from '../src/deadlock-live/hero-build-contextual-v3-live.service';
""",
    """  getContextualV3Phase,
  normalizeContextualV3RosterHeroIdsForTest,
} from '../src/deadlock-live/hero-build-contextual-v3-live.service';
""",
    1,
)
test_path.write_text(test_source)
