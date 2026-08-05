#!/usr/bin/env python3

from pathlib import Path


def replace_exact(
    path: Path,
    old: str,
    new: str,
    expected_count: int = 1,
) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected_count:
        raise RuntimeError(
            f"Expected {expected_count} matches in {path}, found {count}"
        )
    path.write_text(text.replace(old, new), encoding="utf-8")


def patch_replay_artifact_service() -> None:
    path = Path(
        "apps/api/src/deadlock-live/"
        "recommendation-historical-pro-replay-artifact.service.ts"
    )
    replace_exact(
        path,
        """      const completeOutcomeAvailable = outcomes.some(
        (outcome) => outcome.complete && outcome.utility !== undefined,
      );
      if (!decisionTimelineJoined && !completeOutcomeAvailable) {
        stats.excludedWithoutTimelineCount += 1;
        continue;
      }
      stats.selectedRowCount += 1;
""",
        """      stats.selectedRowCount += 1;
""",
    )
    replace_exact(
        path,
        "'LATEST_AT_OR_BEFORE_WITHIN_STALENESS'",
        "'LATEST_AT_OR_BEFORE_ELSE_EARLIEST_AFTER_WITHIN_STALENESS'",
        2,
    )
    replace_exact(
        path,
        "'DECISION_TIME_PRE_ACTION'",
        "'DECISION_TIME_WITH_FUTURE_SNAPSHOT_FALLBACK'",
        2,
    )


def patch_outcomes() -> None:
    path = Path(
        "apps/api/src/deadlock-live/"
        "recommendation-historical-pro-replay-outcomes.ts"
    )
    replace_exact(
        path,
        """  const baseline = latestAtOrBefore(
    playerSnapshots,
    input.decision.gameTimeS,
  );
""",
        """  const baseline = selectRecommendationDecisionTimelineSnapshot({
    matchId: input.decision.matchId,
    heroId: input.decision.heroId,
    team: input.decision.team,
    gameTimeS: input.decision.gameTimeS,
    snapshots: input.snapshots,
    snapshotStalenessS,
  });
""",
    )
    replace_exact(
        path,
        """    const target = nearestToHorizonAfterDecision(
      playerSnapshots,
      input.decision.gameTimeS,
      upper,
      snapshotStalenessS,
    );
""",
        """    const target = nearestToHorizonAfterDecision(
      playerSnapshots,
      input.decision.gameTimeS,
      upper,
      snapshotStalenessS,
      baseline?.gameTimeS,
    );
""",
    )
    replace_exact(
        path,
        """    const baselineFresh =
      baseline !== undefined &&
      input.decision.gameTimeS - baseline.gameTimeS <= snapshotStalenessS;
""",
        """    const baselineFresh =
      baseline !== undefined &&
      Math.abs(input.decision.gameTimeS - baseline.gameTimeS) <=
        snapshotStalenessS;
""",
    )
    replace_exact(
        path,
        """export function hasFreshRecommendationDecisionTimelineSnapshot(input: {
  decision: HeroBuildDecisionDatasetV3Row;
  snapshots: readonly MatchTimelinePlayerSnapshot[];
  snapshotStalenessS?: number;
}): boolean {
  const snapshotStalenessS = normalizeSnapshotStaleness(
    input.snapshotStalenessS,
  );
  const playerSnapshots = selectDecisionPlayerSnapshots(
    input.decision,
    input.snapshots,
  );
  const baseline = latestAtOrBefore(
    playerSnapshots,
    input.decision.gameTimeS,
  );
  return (
    baseline !== undefined &&
    input.decision.gameTimeS - baseline.gameTimeS <= snapshotStalenessS
  );
}
""",
        """export function hasFreshRecommendationDecisionTimelineSnapshot(input: {
  decision: HeroBuildDecisionDatasetV3Row;
  snapshots: readonly MatchTimelinePlayerSnapshot[];
  snapshotStalenessS?: number;
}): boolean {
  return (
    selectRecommendationDecisionTimelineSnapshot({
      matchId: input.decision.matchId,
      heroId: input.decision.heroId,
      team: input.decision.team,
      gameTimeS: input.decision.gameTimeS,
      snapshots: input.snapshots,
      snapshotStalenessS: input.snapshotStalenessS,
    }) !== undefined
  );
}

export function selectRecommendationDecisionTimelineSnapshot(input: {
  matchId: number;
  heroId: number;
  team: number;
  gameTimeS: number;
  snapshots: readonly MatchTimelinePlayerSnapshot[];
  snapshotStalenessS?: number;
}): MatchTimelinePlayerSnapshot | undefined {
  const snapshotStalenessS = normalizeSnapshotStaleness(
    input.snapshotStalenessS,
  );
  const playerSnapshots = selectDecisionPlayerSnapshots(input, input.snapshots);
  const baseline = latestAtOrBefore(playerSnapshots, input.gameTimeS);
  if (
    baseline !== undefined &&
    input.gameTimeS - baseline.gameTimeS <= snapshotStalenessS
  ) {
    return { ...baseline };
  }
  const future = earliestAfter(playerSnapshots, input.gameTimeS);
  if (
    future !== undefined &&
    future.gameTimeS - input.gameTimeS <= snapshotStalenessS
  ) {
    return { ...future };
  }
  return undefined;
}
""",
    )
    replace_exact(
        path,
        """function selectDecisionPlayerSnapshots(
  decision: HeroBuildDecisionDatasetV3Row,
""",
        """function selectDecisionPlayerSnapshots(
  decision: Pick<
    HeroBuildDecisionDatasetV3Row,
    'matchId' | 'heroId' | 'team'
  >,
""",
    )
    replace_exact(
        path,
        """function nearestToHorizonAfterDecision(
""",
        """function earliestAfter(
  snapshots: readonly MatchTimelinePlayerSnapshot[],
  gameTimeS: number,
): MatchTimelinePlayerSnapshot | undefined {
  return snapshots.find((snapshot) => snapshot.gameTimeS > gameTimeS);
}

function nearestToHorizonAfterDecision(
""",
    )
    replace_exact(
        path,
        """  snapshotStalenessS: number,
): MatchTimelinePlayerSnapshot | undefined {
""",
        """  snapshotStalenessS: number,
  baselineGameTimeS?: number,
): MatchTimelinePlayerSnapshot | undefined {
""",
    )
    replace_exact(
        path,
        """    if (snapshot.gameTimeS <= decisionGameTimeS) {
""",
        """    if (
      snapshot.gameTimeS <=
      Math.max(decisionGameTimeS, baselineGameTimeS ?? decisionGameTimeS)
    ) {
""",
    )


def patch_dataset_artifact_service() -> None:
    path = Path(
        "apps/api/src/deadlock-live/"
        "recommendation-pro-decision-dataset-v6-artifact.service.ts"
    )
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
        "'LATEST_PLAYER_SNAPSHOT_AT_OR_BEFORE_DECISION'",
        "'LATEST_AT_OR_BEFORE_ELSE_EARLIEST_AFTER_WITHIN_STALENESS'",
        2,
    )
    replace_exact(
        path,
        "'DECISION_TIME_PRE_ACTION'",
        "'DECISION_TIME_WITH_FUTURE_SNAPSHOT_FALLBACK'",
        2,
    )
    replace_exact(
        path,
        """function selectDecisionTimelineSnapshot(input: {
  replayRow: RecommendationHistoricalProReplayRow;
  snapshots: readonly MatchTimelinePlayerSnapshot[];
  stalenessS: number;
}): MatchTimelinePlayerSnapshot | undefined {
  let selected: MatchTimelinePlayerSnapshot | undefined;
  for (const snapshot of input.snapshots) {
    if (snapshot.gameTimeS > input.replayRow.decisionGameTimeS) {
      break;
    }
    if (
      String(snapshot.matchId) !== input.replayRow.matchId ||
      snapshot.steamId !== input.replayRow.playerId ||
      snapshot.heroId !== input.replayRow.heroId
    ) {
      continue;
    }
    selected = snapshot;
  }
  if (
    !selected ||
    input.replayRow.decisionGameTimeS - selected.gameTimeS > input.stalenessS
  ) {
    return undefined;
  }
  return clone(selected);
}
""",
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
""",
    )


def patch_dataset_contract() -> None:
    path = Path(
        "apps/api/src/deadlock-live/recommendation-pro-decision-dataset-v6.ts"
    )
    replace_exact(
        path,
        """  timelineJoined: boolean;
  timelineSnapshotLagS?: number;
""",
        """  timelineJoined: boolean;
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
        """            timelineSnapshotLagS:
              replayRow.decisionGameTimeS - snapshot.gameTimeS,
            timelineSnapshotFutureFallback:
              snapshot.gameTimeS > replayRow.decisionGameTimeS,
            kills: snapshot.kills,
""",
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


def patch_replay_artifact_test() -> None:
    path = Path(
        "apps/api/test/recommendation-historical-pro-replay-artifact.spec.ts"
    )
    replace_exact(
        path,
        "it('excludes decisions before the first leak-free timeline snapshot'",
        "it('uses the earliest future snapshot when no earlier snapshot exists'",
    )
    replace_exact(
        path,
        """      selectedSourceRowCount: 0,
      outputRowCount: 0,
      excludedWithoutTimelineCount: 1,
      auditPassed: false,
""",
        """      selectedSourceRowCount: 1,
      outputRowCount: 1,
      excludedWithoutTimelineCount: 0,
      auditPassed: true,
""",
    )
    replace_exact(
        path,
        """        selectedRowCount: 0,
      },
      artifact: {
        rowCount: 0,
      },
      auditPassed: false,
      trainingArtifactEligible: false,
""",
        """        selectedRowCount: 1,
      },
      artifact: {
        rowCount: 1,
      },
      auditPassed: true,
      trainingArtifactEligible: true,
""",
    )
    replace_exact(
        path,
        """      passed: false,
      rowCount: 0,
      source: {
        scannedRowCount: 1,
        selectedRowCount: 0,
        excludedWithoutTimelineCount: 1,
      },
      trainingArtifactEligible: false,
""",
        """      passed: true,
      rowCount: 1,
      coverage: {
        timelineCoverage: 1,
      },
      source: {
        scannedRowCount: 1,
        selectedRowCount: 1,
        excludedWithoutTimelineCount: 0,
      },
      trainingArtifactEligible: true,
""",
    )


def patch_outcome_test() -> None:
    path = Path(
        "apps/api/test/"
        "recommendation-historical-pro-replay-terminal-outcomes.spec.ts"
    )
    replace_exact(
        path,
        """import { buildRecommendationHistoricalShortHorizonOutcomes } from '../src/deadlock-live/recommendation-historical-pro-replay-outcomes';
""",
        """import {
  buildRecommendationHistoricalShortHorizonOutcomes,
  selectRecommendationDecisionTimelineSnapshot,
} from '../src/deadlock-live/recommendation-historical-pro-replay-outcomes';
""",
    )
    replace_exact(
        path,
        """  it('keeps a missing horizon incomplete when match end is not confirmed', () => {
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision: decision(true),
      snapshots: [snapshot(1_790)],
      objectives: [],
      snapshotStalenessS: 30,
    });

    expect(outcomes.every((outcome) => !outcome.complete)).toBe(true);
  });
""",
        """  it('keeps a missing horizon incomplete when match end is not confirmed', () => {
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision: decision(true),
      snapshots: [snapshot(1_790)],
      objectives: [],
      snapshotStalenessS: 30,
    });

    expect(outcomes.every((outcome) => !outcome.complete)).toBe(true);
  });

  it('uses the earliest future snapshot when no earlier snapshot exists', () => {
    const earlyDecision = {
      ...decision(true),
      decisionId: 'decision-future-fallback',
      gameTimeS: 120,
      phase: 'EARLY' as const,
    };
    const snapshots = [snapshot(180), snapshot(360), snapshot(720)];
    const selected = selectRecommendationDecisionTimelineSnapshot({
      matchId: earlyDecision.matchId,
      heroId: earlyDecision.heroId,
      team: earlyDecision.team,
      gameTimeS: earlyDecision.gameTimeS,
      snapshots,
      snapshotStalenessS: 300,
    });

    expect(selected?.gameTimeS).toBe(180);
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision: earlyDecision,
      snapshots,
      objectives: [],
      matchEndGameTimeS: 1_800,
      snapshotStalenessS: 300,
    });
    expect(outcomes.every((outcome) => outcome.complete)).toBe(true);
  });
""",
    )


def patch_dataset_test() -> None:
    path = Path(
        "apps/api/test/recommendation-pro-decision-dataset-v6.spec.ts"
    )
    replace_exact(
        path,
        """        timelineJoined: true,
        timelineSnapshotLagS: 5,
        netWorth: 5_000,
""",
        """        timelineJoined: true,
        timelineSnapshotLagS: 5,
        timelineSnapshotFutureFallback: false,
        netWorth: 5_000,
""",
    )
    replace_exact(
        path,
        """  it('passes the Dataset V6 gates for complete non-overlapping rows', () => {
""",
        """  it('marks a future timeline snapshot fallback explicitly', () => {
    const replay = replayRow({
      decisionId: 'decision-future-fallback',
      matchId: '101',
      matchStartTime: '2026-07-01T00:00:00.000Z',
    });
    const row = createRecommendationProDecisionDatasetV6Row({
      replayRow: replay,
      split: 'TRAIN',
      catalogItemsById: catalog(),
      decisionTimelineSnapshot: snapshot(101, 360),
    });

    expect(row.state).toMatchObject({
      timelineJoined: true,
      timelineSnapshotLagS: -60,
      timelineSnapshotFutureFallback: true,
      netWorth: 5_000,
    });
  });

  it('passes the Dataset V6 gates for complete non-overlapping rows', () => {
""",
    )


def main() -> None:
    patch_replay_artifact_service()
    patch_outcomes()
    patch_dataset_artifact_service()
    patch_dataset_contract()
    patch_replay_artifact_test()
    patch_outcome_test()
    patch_dataset_test()


if __name__ == "__main__":
    main()
