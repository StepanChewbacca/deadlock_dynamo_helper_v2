#!/usr/bin/env python3

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
LEGACY_PATH = ROOT / 'scripts/patch-recommendation-v8-prebaseline-filter-v1.py'

spec = spec_from_file_location('recommendation_v8_patch_legacy', LEGACY_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError('Unable to load Recommendation V8 patch helpers.')
legacy = module_from_spec(spec)
spec.loader.exec_module(legacy)


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'Expected {expected} matches in {path}, found {count}')
    target.write_text(text.replace(old, new), encoding='utf-8')


def replace_regex(path: str, pattern: str, replacement: str, expected: int = 1) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    updated, count = re.subn(pattern, replacement, text, flags=re.MULTILINE | re.DOTALL)
    if count != expected:
        raise RuntimeError(f'Expected {expected} regex matches in {path}, found {count}')
    target.write_text(updated, encoding='utf-8')


def replace_all(path: Path, old: str, new: str) -> int:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count > 0:
        path.write_text(text.replace(old, new), encoding='utf-8')
    return count


def patch_replay_artifact() -> None:
    path = 'apps/api/src/deadlock-live/recommendation-historical-pro-replay-artifact.service.ts'
    replace_exact(
        path,
        "decisionSnapshotSelection: 'LATEST_AT_OR_BEFORE_WITHIN_STALENESS';",
        "decisionSnapshotSelection: 'LATEST_AT_OR_BEFORE_ELSE_EARLIEST_AFTER_WITHIN_STALENESS';",
    )
    replace_exact(
        path,
        "featureCutoff: 'DECISION_TIME_PRE_ACTION';",
        "featureCutoff: 'DECISION_TIME_WITH_FUTURE_SNAPSHOT_FALLBACK';",
    )
    replace_exact(
        path,
        """    terminalOutcomeBackfill: true;
  };
""",
        """    terminalOutcomeBackfill: true;
    historicalOfflineCandidateLimit: 256;
    compactCandidateCatalogReferences: true;
    futureSnapshotFallbackAllowed: true;
  };
""",
    )
    replace_exact(
        path,
        "candidateSupportStrategy: 'STATE_PRIMARY_PLUS_HERO_SUPPORT_UNION_V2',",
        "candidateSupportStrategy: 'STATE_PRIMARY_PLUS_HERO_SUPPORT_UNION_V3_LIMIT_256',",
    )
    replace_exact(
        path,
        "timelineJoinContract: 'DECISION_OR_CONFIRMED_TERMINAL_OUTCOME_V3',",
        "timelineJoinContract: 'DECISION_FUTURE_FALLBACK_OR_CONFIRMED_TERMINAL_V4',",
    )
    replace_regex(
        path,
        r"decisionSnapshotSelection:\s*\n\s*'LATEST_AT_OR_BEFORE_WITHIN_STALENESS',",
        "decisionSnapshotSelection:\n            'LATEST_AT_OR_BEFORE_ELSE_EARLIEST_AFTER_WITHIN_STALENESS',",
    )
    replace_exact(
        path,
        "featureCutoff: 'DECISION_TIME_PRE_ACTION',",
        "featureCutoff: 'DECISION_TIME_WITH_FUTURE_SNAPSHOT_FALLBACK',",
    )
    replace_exact(
        path,
        """          terminalOutcomeBackfill: true,
        },
""",
        """          terminalOutcomeBackfill: true,
          historicalOfflineCandidateLimit: 256,
          compactCandidateCatalogReferences: true,
          futureSnapshotFallbackAllowed: true,
        },
""",
    )


def patch_evaluation_dataset_lineage() -> None:
    path = 'apps/api/src/deadlock-live/recommendation-value-v8-full-evaluation.ts'
    replace_exact(
        path,
        """import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationDatasetV6Split,
  RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';
""",
        """import {
  RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
  type RecommendationDatasetV6CandidateFeatures,
  type RecommendationDatasetV6Split,
  type RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';
""",
    )
    replace_exact(
        path,
        "datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_1';",
        'datasetVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION;',
    )
    replace_exact(
        path,
        """manifest.sourceDataset.datasetVersion !==
      'RECOMMENDATION_PRO_DECISION_DATASET_V6_1' ||""",
        """manifest.sourceDataset.datasetVersion !==
      RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION ||""",
    )


def patch_test_contracts() -> None:
    test_root = ROOT / 'apps/api/test'
    replacements = {
        'RECOMMENDATION_HISTORICAL_PRO_REPLAY_1':
            'RECOMMENDATION_HISTORICAL_PRO_REPLAY_2',
        'RECOMMENDATION_PRO_DECISION_DATASET_V6_1':
            'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
        'RECOMMENDATION_STATE_FEATURES_V6_1':
            'RECOMMENDATION_STATE_FEATURES_V6_2_FUTURE_TIMELINE_FALLBACK',
    }
    replacement_count = 0
    for path in test_root.glob('*.ts'):
        for old, new in replacements.items():
            replacement_count += replace_all(path, old, new)
    if replacement_count == 0:
        raise RuntimeError('Expected stale Recommendation V8 test version fixtures.')

    replay_artifact_test = test_root / 'recommendation-historical-pro-replay-artifact.spec.ts'
    replace_all(
        replay_artifact_test,
        "it('excludes decisions before the first leak-free timeline snapshot', async () => {",
        "it('excludes decisions when the first future timeline snapshot exceeds staleness', async () => {",
    )
    text = replay_artifact_test.read_text(encoding='utf-8')
    marker = """      partitionCount: 2,
      resume: false,
"""
    marker_count = text.count(marker)
    if marker_count == 0:
        raise RuntimeError('Expected replay artifact start options in regression test.')
    replay_artifact_test.write_text(
        text.replace(
            marker,
            """      partitionCount: 2,
      snapshotStalenessS: 100,
      resume: false,
""",
        ),
        encoding='utf-8',
    )


def main() -> None:
    legacy.patch_candidate_generator()
    legacy.patch_replay_contract()
    patch_replay_artifact()
    legacy.patch_dataset_artifact()
    legacy.patch_dataset_contract()
    legacy.patch_behavioral()
    patch_evaluation_dataset_lineage()
    patch_test_contracts()


if __name__ == '__main__':
    main()
