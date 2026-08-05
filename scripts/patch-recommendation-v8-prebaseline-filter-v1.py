#!/usr/bin/env python3

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    text = read(path)
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'Expected {expected} matches in {path}, found {count}')
    write(path, text.replace(old, new))


def replace_regex(path: str, pattern: str, replacement: str, expected: int = 1) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, flags=re.MULTILINE | re.DOTALL)
    if count != expected:
        raise RuntimeError(f'Expected {expected} regex matches in {path}, found {count}')
    write(path, updated)


def patch_candidate_generator() -> None:
    path = 'apps/api/src/deadlock-live/recommendation-candidate-generator-snapshot.ts'
    replace_exact(
        path,
        """export const RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_VERSION =
  'RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_1' as const;
""",
        """export const RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_VERSION =
  'RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_1' as const;
export const RECOMMENDATION_HISTORICAL_OFFLINE_CANDIDATE_LIMIT = 256;
""",
    )
    replace_exact(
        path,
        """  policy?: RecommendationPreparedHeroBuildPolicy;
  componentsByParent?: ReadonlyMap<number, number[]>;
}): RecommendationHistoricalCandidateInput[] {
""",
        """  policy?: RecommendationPreparedHeroBuildPolicy;
  componentsByParent?: ReadonlyMap<number, number[]>;
  historicalCandidateLimit?: number;
}): RecommendationHistoricalCandidateInput[] {
""",
    )
    replace_exact(
        path,
        """  const request = {
    heroId: input.decision.heroId,
    itemIds,
    gameTimeS: input.decision.gameTimeS,
    limit: input.generatorOptions.limit,
  };
""",
        """  const historicalCandidateLimit = normalizeHistoricalCandidateLimit(
    input.historicalCandidateLimit ??
      Math.max(
        input.generatorOptions.limit,
        RECOMMENDATION_HISTORICAL_OFFLINE_CANDIDATE_LIMIT,
      ),
  );
  const request = {
    heroId: input.decision.heroId,
    itemIds,
    gameTimeS: input.decision.gameTimeS,
    limit: historicalCandidateLimit,
  };
""",
    )
    replace_exact(
        path,
        """      maxBackoffStates: 1,
      limit: input.generatorOptions.limit,
""",
        """      maxBackoffStates: 1,
      limit: historicalCandidateLimit,
""",
    )
    replace_exact(
        path,
        """    candidateActionsFromRecommendationResponse(supportResponse),
    input.generatorOptions.limit,
  );
}

function mergeHistoricalCandidateActions(
""",
        """    candidateActionsFromRecommendationResponse(supportResponse),
    historicalCandidateLimit,
  );
}

function normalizeHistoricalCandidateLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 2 || value > 512) {
    throw new Error(
      'historicalCandidateLimit must be a safe integer between 2 and 512.',
    );
  }
  return value;
}

function mergeHistoricalCandidateActions(
""",
    )


def patch_replay_contract() -> None:
    path = 'apps/api/src/deadlock-live/recommendation-historical-pro-replay.ts'
    replace_exact(
        path,
        """export const RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION =
  'RECOMMENDATION_HISTORICAL_PRO_REPLAY_1' as const;
""",
        """export const RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION =
  'RECOMMENDATION_HISTORICAL_PRO_REPLAY_2' as const;
""",
    )
    replace_exact(
        path,
        '    minimumObservedActionCandidateCoverage: 0.99,',
        '    minimumObservedActionCandidateCoverage: 0.995,',
    )
    replace_exact(
        path,
        """      catalogMetadataAvailable: catalog !== undefined,
      catalog: catalog ? cloneCatalogItem(catalog) : undefined,
""",
        """      catalogMetadataAvailable: catalog !== undefined,
""",
    )
    replace_regex(
        path,
        r"\nfunction cloneCatalogItem\(\n  item: RecommendationHistoricalCatalogItem,\n\): RecommendationHistoricalCatalogItem \{\n.*?\n\}\n",
        '\n',
    )


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
    replace_exact(
        path,
        "decisionSnapshotSelection: 'LATEST_AT_OR_BEFORE_WITHIN_STALENESS',",
        "decisionSnapshotSelection: 'LATEST_AT_OR_BEFORE_ELSE_EARLIEST_AFTER_WITHIN_STALENESS',",
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


def patch_dataset_artifact() -> None:
    path = 'apps/api/src/deadlock-live/recommendation-pro-decision-dataset-v6-artifact.service.ts'
    replace_exact(
        path,
        """import {
  createRecommendationProDecisionDatasetV6Row,
""",
        """import { selectRecommendationDecisionTimelineSnapshot } from './recommendation-historical-pro-replay-outcomes';
import {
  createRecommendationProDecisionDatasetV6Row,
""",
    )
    replace_exact(
        path,
        "featureCutoff: 'LATEST_PLAYER_SNAPSHOT_AT_OR_BEFORE_DECISION';",
        "featureCutoff: 'LATEST_AT_OR_BEFORE_ELSE_EARLIEST_AFTER_WITHIN_STALENESS';",
    )
    replace_exact(
        path,
        "featureCutoff: 'DECISION_TIME_PRE_ACTION';",
        "featureCutoff: 'DECISION_TIME_WITH_FUTURE_SNAPSHOT_FALLBACK';",
    )
    replace_exact(
        path,
        """    terminalOutcomeBackfill: true;
    shortHorizonTargets: ['3m', '5m', '10m'];
""",
        """    terminalOutcomeBackfill: true;
    futureSnapshotFallbackAllowed: true;
    maximumFutureSnapshotLagS: 300;
    shortHorizonTargets: ['3m', '5m', '10m'];
""",
    )
    replace_exact(
        path,
        "featureCutoff: 'LATEST_PLAYER_SNAPSHOT_AT_OR_BEFORE_DECISION',",
        "featureCutoff: 'LATEST_AT_OR_BEFORE_ELSE_EARLIEST_AFTER_WITHIN_STALENESS',",
    )
    replace_exact(
        path,
        "featureCutoff: 'DECISION_TIME_PRE_ACTION',",
        "featureCutoff: 'DECISION_TIME_WITH_FUTURE_SNAPSHOT_FALLBACK',",
    )
    replace_exact(
        path,
        """          terminalOutcomeBackfill: true,
          shortHorizonTargets: ['3m', '5m', '10m'],
""",
        """          terminalOutcomeBackfill: true,
          futureSnapshotFallbackAllowed: true,
          maximumFutureSnapshotLagS: 300,
          shortHorizonTargets: ['3m', '5m', '10m'],
""",
    )
    replace_regex(
        path,
        r"function selectDecisionTimelineSnapshot\(input: \{\n  replayRow: RecommendationHistoricalProReplayRow;\n  snapshots: readonly MatchTimelinePlayerSnapshot\[\];\n  stalenessS: number;\n\}\): MatchTimelinePlayerSnapshot \| undefined \{\n.*?\n\}\n\nfunction validateReplaySnapshotLineage",
        """function selectDecisionTimelineSnapshot(input: {
  replayRow: RecommendationHistoricalProReplayRow;
  snapshots: readonly MatchTimelinePlayerSnapshot[];
  stalenessS: number;
}): MatchTimelinePlayerSnapshot | undefined {
  const matchId = Number(input.replayRow.matchId);
  if (!Number.isSafeInteger(matchId)) {
    return undefined;
  }
  return selectRecommendationDecisionTimelineSnapshot({
    matchId,
    heroId: input.replayRow.heroId,
    team: input.replayRow.team,
    gameTimeS: input.replayRow.decisionGameTimeS,
    snapshots: input.snapshots,
    snapshotStalenessS: input.stalenessS,
  });
}

function validateReplaySnapshotLineage""",
    )


def patch_dataset_contract() -> None:
    path = 'apps/api/src/deadlock-live/recommendation-pro-decision-dataset-v6.ts'
    replace_exact(
        path,
        """export const RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION =
  'RECOMMENDATION_PRO_DECISION_DATASET_V6_1' as const;
export const RECOMMENDATION_STATE_FEATURE_VERSION_V6 =
  'RECOMMENDATION_STATE_FEATURES_V6_1' as const;
""",
        """export const RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION =
  'RECOMMENDATION_PRO_DECISION_DATASET_V6_2' as const;
export const RECOMMENDATION_STATE_FEATURE_VERSION_V6 =
  'RECOMMENDATION_STATE_FEATURES_V6_2_FUTURE_TIMELINE_FALLBACK' as const;
""",
    )
    replace_exact(
        path,
        """  timelineJoined: boolean;
  timelineSnapshotLagS?: number;
""",
        """  timelineJoined: boolean;
  timelineSnapshotGameTimeS?: number;
  timelineSnapshotLagS?: number;
  timelineSnapshotFutureFallback?: boolean;
""",
    )
    replace_exact(
        path,
        """            timelineSnapshotLagS:
              replayRow.decisionGameTimeS - snapshot.gameTimeS,
            kills: snapshot.kills,
""",
        """            timelineSnapshotGameTimeS: snapshot.gameTimeS,
            timelineSnapshotLagS:
              replayRow.decisionGameTimeS - snapshot.gameTimeS,
            timelineSnapshotFutureFallback:
              snapshot.gameTimeS > replayRow.decisionGameTimeS,
            kills: snapshot.kills,
""",
    )
    replace_exact(
        path,
        "const metadata = input.candidate.catalog;",
        """const metadata =
    input.candidate.catalog ??
    input.catalogItemsById.get(input.candidate.itemId);""",
    )
    replace_exact(
        path,
        """  if (snapshot.gameTimeS > row.decisionGameTimeS) {
    throw new Error('Decision timeline snapshot occurs after the decision.');
  }
""",
        """  if (!Number.isFinite(snapshot.gameTimeS)) {
    throw new Error('Decision timeline snapshot game time is invalid.');
  }
""",
    )


def patch_behavioral() -> None:
    path = 'apps/api/src/deadlock-live/recommendation-behavioral-v5.ts'
    replace_exact(
        path,
        """export const RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V5_FEATURES_1' as const;
""",
        """export const RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V5_FEATURES_2_FUTURE_TIMELINE_FALLBACK' as const;
""",
    )
    replace_exact(
        path,
        """  const timeBucket = Math.floor(row.state.gameTimeS / 300);

  add('bias');
""",
        """  const timeBucket = Math.floor(row.state.gameTimeS / 300);

  add('bias');
  add(
    'timeline-future-fallback',
    row.state.timelineSnapshotFutureFallback === true ? 1 : 0,
  );
  add(
    'timeline-snapshot-lag',
    bounded(row.state.timelineSnapshotLagS ?? 0, -300, 300) / 300,
  );
""",
    )


def disable_retired_workflows() -> None:
    current = 'recommendation-v8-prebaseline-filter-v1.yml'
    workflow_root = ROOT / '.github/workflows'
    for path in workflow_root.glob('recommendation-v8-*.yml'):
        if path.name == current:
            continue
        text = path.read_text(encoding='utf-8')
        if not re.search(r'^on:\n', text, flags=re.MULTILINE):
            continue
        updated, count = re.subn(
            r'^on:\n.*?(?=^permissions:)',
            'on:\n  workflow_dispatch:\n\n',
            text,
            count=1,
            flags=re.MULTILINE | re.DOTALL,
        )
        if count == 1:
            path.write_text(updated, encoding='utf-8')


def main() -> None:
    patch_candidate_generator()
    patch_replay_contract()
    patch_replay_artifact()
    patch_dataset_artifact()
    patch_dataset_contract()
    patch_behavioral()
    disable_retired_workflows()


if __name__ == '__main__':
    main()
