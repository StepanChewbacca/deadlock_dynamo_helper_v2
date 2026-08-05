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


def main() -> None:
    legacy.patch_candidate_generator()
    legacy.patch_replay_contract()
    patch_replay_artifact()
    legacy.patch_dataset_artifact()
    legacy.patch_dataset_contract()
    legacy.patch_behavioral()
    legacy.disable_retired_workflows()


if __name__ == '__main__':
    main()
