from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    if old not in source:
        raise RuntimeError(f'Expected block was not found in {path}')
    target.write_text(source.replace(old, new, 1))


controller_path = Path('apps/api/src/deadlock-live/hero-build-recommendation.controller.ts')
controller = controller_path.read_text()
import_marker = "import type { HeroBuildContextualRecommendationRequest } from './contextual-hero-build-recommendation.service';\n"
if import_marker not in controller:
    raise RuntimeError('Controller import marker was not found')
controller = controller.replace(
    import_marker,
    import_marker + "import { deriveContextualV3PreviousActionKeys } from './contextual-v3-live-context';\n",
    1,
)
helper_marker = '\n\nexport function deriveContextualV3PreviousActionKeys('
helper_index = controller.find(helper_marker)
if helper_index < 0:
    raise RuntimeError('Controller helper block was not found')
controller_path.write_text(controller[:helper_index].rstrip() + '\n')

replace(
    'apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts',
    "import { deriveContextualV3PreviousActionKeys } from './hero-build-recommendation.controller';\n",
    "import { deriveContextualV3PreviousActionKeys } from './contextual-v3-live-context';\n",
)

replace(
    'apps/api/src/deadlock-live/hero-build-contextual-v3-live.service.ts',
    'normalizeContextualV3RosterHeroIdsForTest',
    'normalizeContextualV3RosterHeroIds',
)
# Replace remaining occurrences in the same service.
service_path = Path('apps/api/src/deadlock-live/hero-build-contextual-v3-live.service.ts')
service_path.write_text(
    service_path.read_text().replace(
        'normalizeContextualV3RosterHeroIdsForTest',
        'normalizeContextualV3RosterHeroIds',
    )
)

test_path = Path('apps/api/test/hero-build-contextual-v3-live.spec.ts')
test = test_path.read_text()
test = test.replace(
    'normalizeContextualV3RosterHeroIdsForTest',
    'normalizeContextualV3RosterHeroIds',
)
test = test.replace(
    "import { deriveContextualV3PreviousActionKeys } from '../src/deadlock-live/hero-build-recommendation.controller';",
    "import { deriveContextualV3PreviousActionKeys } from '../src/deadlock-live/contextual-v3-live-context';",
)
test = test.replace(
    """      [
        [100, 200],
        [300],
""",
    """      [
        [],
        [100, 200],
        [300],
""",
    1,
)
test = test.replace(
    """        [
          [100],
          [100],
""",
    """        [
          [],
          [100],
          [100],
""",
    1,
)
insert_marker = """  it('canonicalizes roster hero aliases before model lookup', () => {
"""
new_test = """  it('treats the first non-empty snapshot as a safe mid-match baseline', () => {
    expect(
      deriveContextualV3PreviousActionKeys(
        [
          [100, 200],
          [100, 200, 300],
        ],
        () => [],
      ),
    ).toEqual(['BUY:300']);
  });

"""
if insert_marker not in test:
    raise RuntimeError('Live helper test insertion marker was not found')
test_path.write_text(test.replace(insert_marker, new_test + insert_marker, 1))
