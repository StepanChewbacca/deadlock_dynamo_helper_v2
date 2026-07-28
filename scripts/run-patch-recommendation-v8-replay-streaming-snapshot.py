from pathlib import Path

replay_path = Path(
    'apps/api/src/deadlock-live/recommendation-historical-pro-replay-artifact.service.ts'
)
replay = replay_path.read_text()

import_old = '''import {
  generateRecommendationHistoricalCandidatesFromPreparedPolicy,'''
import_new = '''import {
  candidateGeneratorCatalogPayload,
  generateRecommendationHistoricalCandidatesFromPreparedPolicy,'''

if import_new not in replay:
    if replay.count(import_old) != 1:
        raise SystemExit(
            f'Expected one candidate snapshot import anchor, found {replay.count(import_old)}'
        )
    replay = replay.replace(import_old, import_new, 1)

hash_old = '''  const actualCatalogSha256 = sha256StableJson({
    version: metadata.catalog.version,
    items: metadata.catalog.items,
  });'''
hash_new = '''  const actualCatalogSha256 = sha256StableJson(
    candidateGeneratorCatalogPayload({
      ...metadata,
      policies: [],
    }),
  );'''

if hash_new not in replay:
    if replay.count(hash_old) != 1:
        raise SystemExit(
            f'Expected one raw catalog hash block, found {replay.count(hash_old)}'
        )
    replay = replay.replace(hash_old, hash_new, 1)

replay_path.write_text(replay)

test_path = Path(
    'apps/api/test/recommendation-historical-pro-replay-artifact.spec.ts'
)
test = test_path.read_text()
helper_old = '''function catalogItem(itemId: number): RecommendationHistoricalCatalogItem {
  return {
    itemId,
    name: `Item ${itemId}`,
    cost: 1_250,
    tier: 2,
    slotType: 'WEAPON',
    itemType: 'UPGRADE',
    isActiveItem: false,
    activationType: 'PASSIVE',
    tags: ['DAMAGE'],
    componentItemIds: [],
  };
}'''
helper_new = '''function catalogItem(itemId: number): RecommendationHistoricalCatalogItem {
  if (itemId === 1002) {
    return {
      itemId,
      cost: 1_250,
      tier: 2,
      slotType: 'WEAPON',
      tags: [],
      componentItemIds: [],
    };
  }
  return {
    itemId,
    name: `Item ${itemId}`,
    cost: 1_250,
    tier: 2,
    slotType: 'WEAPON',
    itemType: 'UPGRADE',
    isActiveItem: false,
    activationType: 'PASSIVE',
    tags: ['DAMAGE'],
    componentItemIds: [],
  };
}'''

if helper_new not in test:
    if test.count(helper_old) != 1:
        raise SystemExit(
            f'Expected one catalog test helper, found {test.count(helper_old)}'
        )
    test = test.replace(helper_old, helper_new, 1)

test_path.write_text(test)
