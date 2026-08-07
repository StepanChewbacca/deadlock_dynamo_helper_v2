from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1))


def write_file(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


OUTCOMES = "apps/api/src/deadlock-live/recommendation-historical-pro-replay-outcomes.ts"
replace_once(
    OUTCOMES,
    """  objectives: readonly MatchTimelineObjectiveEvent[];\n  snapshotStalenessS?: number;\n}): RecommendationHistoricalShortHorizonOutcome[] {""",
    """  objectives: readonly MatchTimelineObjectiveEvent[];\n  matchEndGameTimeS?: number;\n  snapshotStalenessS?: number;\n}): RecommendationHistoricalShortHorizonOutcome[] {""",
)
replace_once(
    OUTCOMES,
    """  const ownTeamId = liveTeam(input.decision.team);\n\n  return HORIZONS.map(({ horizon, seconds }) => {\n    const upper = input.decision.gameTimeS + seconds;""",
    """  const ownTeamId = liveTeam(input.decision.team);\n  const matchEndGameTimeS = normalizeMatchEndGameTimeS(\n    input.matchEndGameTimeS,\n    input.decision.gameTimeS,\n  );\n\n  return HORIZONS.map(({ horizon, seconds }) => {\n    const upper = input.decision.gameTimeS + seconds;\n    if (\n      matchEndGameTimeS !== undefined &&\n      matchEndGameTimeS <= upper\n    ) {\n      return {\n        horizon,\n        complete: true,\n        utility: input.decision.outcomeLabel.playerWon ? 1 : -1,\n        outcomeSource: 'TERMINAL_FINAL_OUTCOME',\n        terminalGameTimeS: matchEndGameTimeS,\n      };\n    }""",
)
replace_once(
    OUTCOMES,
    """      utility: recommendationShortHorizonUtility(deltas),\n      snapshotGameTimeS: target.gameTimeS,""",
    """      utility: recommendationShortHorizonUtility(deltas),\n      outcomeSource: 'TIMELINE_SNAPSHOT',\n      snapshotGameTimeS: target.gameTimeS,""",
)
replace_once(
    OUTCOMES,
    """function normalizeSnapshotStaleness(value: number | undefined): number {""",
    """function normalizeMatchEndGameTimeS(\n  value: number | undefined,\n  decisionGameTimeS: number,\n): number | undefined {\n  if (value === undefined) {\n    return undefined;\n  }\n  if (!Number.isFinite(value) || value < decisionGameTimeS) {\n    return undefined;\n  }\n  return value;\n}\n\nfunction normalizeSnapshotStaleness(value: number | undefined): number {""",
)

REPLAY = "apps/api/src/deadlock-live/recommendation-historical-pro-replay.ts"
replace_once(
    REPLAY,
    """  utility?: number;\n  snapshotGameTimeS?: number;\n}""",
    """  utility?: number;\n  outcomeSource?: 'TIMELINE_SNAPSHOT' | 'TERMINAL_FINAL_OUTCOME';\n  snapshotGameTimeS?: number;\n  terminalGameTimeS?: number;\n}""",
)
replace_once(
    REPLAY,
    """    timelineRowCount +=\n      row.timeline?.decisionSnapshotJoined ??\n      row.shortHorizonOutcomes.some((outcome) => outcome.complete)\n        ? 1\n        : 0;""",
    """    const timelineOrTerminalOutcomeAvailable =\n      row.timeline?.decisionSnapshotJoined === true ||\n      row.shortHorizonOutcomes.some((outcome) => outcome.complete);\n    timelineRowCount += timelineOrTerminalOutcomeAvailable ? 1 : 0;""",
)
replace_once(
    REPLAY,
    """    if (outcome.snapshotGameTimeS !== undefined) {\n      nonNegativeFiniteNumber(\n        outcome.snapshotGameTimeS,\n        `${outcome.horizon} snapshotGameTimeS`,\n      );\n    }\n    byHorizon.set(outcome.horizon, { ...outcome });""",
    """    if (outcome.snapshotGameTimeS !== undefined) {\n      nonNegativeFiniteNumber(\n        outcome.snapshotGameTimeS,\n        `${outcome.horizon} snapshotGameTimeS`,\n      );\n    }\n    if (outcome.terminalGameTimeS !== undefined) {\n      nonNegativeFiniteNumber(\n        outcome.terminalGameTimeS,\n        `${outcome.horizon} terminalGameTimeS`,\n      );\n    }\n    if (outcome.outcomeSource === 'TERMINAL_FINAL_OUTCOME') {\n      if (\n        !outcome.complete ||\n        outcome.utility === undefined ||\n        outcome.terminalGameTimeS === undefined\n      ) {\n        throw new Error(\n          `Terminal ${outcome.horizon} outcome requires utility and terminalGameTimeS.`,\n        );\n      }\n      if (outcome.snapshotGameTimeS !== undefined) {\n        throw new Error(\n          `Terminal ${outcome.horizon} outcome must not include snapshotGameTimeS.`,\n        );\n      }\n    }\n    if (\n      outcome.outcomeSource === 'TIMELINE_SNAPSHOT' &&\n      outcome.complete &&\n      outcome.snapshotGameTimeS === undefined\n    ) {\n      throw new Error(\n        `Timeline ${outcome.horizon} outcome requires snapshotGameTimeS.`,\n      );\n    }\n    byHorizon.set(outcome.horizon, { ...outcome });""",
)

STREAMING_REPLAY = "apps/api/src/deadlock-live/recommendation-historical-pro-replay-streaming-audit.ts"
replace_once(
    STREAMING_REPLAY,
    """    const decisionTimelineJoined =\n      row.timeline?.decisionSnapshotJoined ??\n      row.shortHorizonOutcomes.some((outcome) => outcome.complete);\n    this.timelineRowCount += decisionTimelineJoined ? 1 : 0;""",
    """    const timelineOrTerminalOutcomeAvailable =\n      row.timeline?.decisionSnapshotJoined === true ||\n      row.shortHorizonOutcomes.some((outcome) => outcome.complete);\n    this.timelineRowCount += timelineOrTerminalOutcomeAvailable ? 1 : 0;""",
)

ARTIFACT = "apps/api/src/deadlock-live/recommendation-historical-pro-replay-artifact.service.ts"
replace_once(
    ARTIFACT,
    """    horizonSnapshotSelection: 'NEAREST_AFTER_DECISION_WITHIN_STALENESS';\n    requiredForOutput: true;""",
    """    horizonSnapshotSelection: 'NEAREST_AFTER_DECISION_WITHIN_STALENESS';\n    terminalOutcomeSelection: 'FINAL_OUTCOME_WHEN_MATCH_END_PRECEDES_HORIZON';\n    requiredForOutput: true;""",
)
replace_once(
    ARTIFACT,
    """    finalOutcomeAuxiliaryOnly: true;\n  };""",
    """    finalOutcomeAuxiliaryOnly: false;\n    terminalOutcomeBackfill: true;\n  };""",
)
replace_once(
    ARTIFACT,
    """interface TimelineData {\n  available: boolean;\n  snapshots: MatchTimelinePlayerSnapshot[];\n  objectives: MatchTimelineObjectiveEvent[];\n}""",
    """interface TimelineData {\n  available: boolean;\n  snapshots: MatchTimelinePlayerSnapshot[];\n  objectives: MatchTimelineObjectiveEvent[];\n  matchEndGameTimeS?: number;\n}""",
)
replace_once(
    ARTIFACT,
    """        timelineJoinContract: 'DECISION_JOIN_SEPARATE_FROM_HORIZON_COMPLETENESS_V2',\n        timelineCacheVersion:""",
    """        timelineJoinContract: 'DECISION_OR_CONFIRMED_TERMINAL_OUTCOME_V3',\n        terminalOutcomeContract: 'FINAL_WIN_LOSS_AFTER_CONFIRMED_MATCH_END_V1',\n        timelineCacheVersion:""",
)
replace_once(
    ARTIFACT,
    """          horizonSnapshotSelection:\n            'NEAREST_AFTER_DECISION_WITHIN_STALENESS',\n          requiredForOutput: true,""",
    """          horizonSnapshotSelection:\n            'NEAREST_AFTER_DECISION_WITHIN_STALENESS',\n          terminalOutcomeSelection:\n            'FINAL_OUTCOME_WHEN_MATCH_END_PRECEDES_HORIZON',\n          requiredForOutput: true,""",
)
replace_once(
    ARTIFACT,
    """          finalOutcomeAuxiliaryOnly: true,\n        },""",
    """          finalOutcomeAuxiliaryOnly: false,\n          terminalOutcomeBackfill: true,\n        },""",
)
replace_once(
    ARTIFACT,
    """          objectives: timeline.objectives,\n          snapshotStalenessS: input.snapshotStalenessS,""",
    """          objectives: timeline.objectives,\n          matchEndGameTimeS: timeline.matchEndGameTimeS,\n          snapshotStalenessS: input.snapshotStalenessS,""",
)
replace_once(
    ARTIFACT,
    """  return {\n    available: snapshots.length > 0,\n    snapshots,\n    objectives,\n  };\n}""",
    """  const manifestMatchEndGameTimeS = Number(manifest.matchEndGameTimeS);\n  const inferredMatchEndGameTimeS = snapshots.reduce(\n    (maximum, snapshot) => Math.max(maximum, snapshot.gameTimeS),\n    0,\n  );\n  const matchEndGameTimeS =\n    Number.isFinite(manifestMatchEndGameTimeS) && manifestMatchEndGameTimeS > 0\n      ? manifestMatchEndGameTimeS\n      : inferredMatchEndGameTimeS > 0\n        ? inferredMatchEndGameTimeS\n        : undefined;\n  return {\n    available: snapshots.length > 0,\n    snapshots,\n    objectives,\n    matchEndGameTimeS,\n  };\n}""",
)
replace_once(
    ARTIFACT,
    """function emptyTimeline(): TimelineData {\n  return { available: false, snapshots: [], objectives: [] };\n}""",
    """function emptyTimeline(): TimelineData {\n  return {\n    available: false,\n    snapshots: [],\n    objectives: [],\n    matchEndGameTimeS: undefined,\n  };\n}""",
)

CACHE = "apps/api/src/deadlock-live/recommendation-historical-postgres-timeline-cache.service.ts"
replace_once(
    CACHE,
    """export interface RecommendationHistoricalPostgresTimelineData {\n  snapshots: MatchTimelinePlayerSnapshot[];\n  objectives: MatchTimelineObjectiveEvent[];\n}""",
    """export interface RecommendationHistoricalPostgresTimelineData {\n  snapshots: MatchTimelinePlayerSnapshot[];\n  objectives: MatchTimelineObjectiveEvent[];\n  matchEndGameTimeS?: number;\n}""",
)
replace_once(
    CACHE,
    """        rawMetadataFetchedAt: input.fetchedAt,\n        artifacts: {""",
    """        rawMetadataFetchedAt: input.fetchedAt,\n        matchEndGameTimeS: input.timeline.matchEndGameTimeS,\n        artifacts: {""",
)
replace_once(
    CACHE,
    """        source: 'POSTGRESQL_RAW_MATCH_METADATA',\n        playerSnapshotCount: input.timeline.snapshots.length,""",
    """        source: 'POSTGRESQL_RAW_MATCH_METADATA',\n        matchEndGameTimeS: input.timeline.matchEndGameTimeS,\n        playerSnapshotCount: input.timeline.snapshots.length,""",
)
replace_once(
    CACHE,
    """  return {\n    snapshots: deduplicateSnapshots(snapshots),\n    objectives: objectives.sort(""",
    """  const deduplicatedSnapshots = deduplicateSnapshots(snapshots);\n  const explicitMatchEndGameTimeS = nonNegativeFiniteNumber(\n    matchInfo?.duration_s ??\n      matchInfo?.duration_sec ??\n      matchInfo?.match_duration_s ??\n      matchInfo?.match_duration_sec,\n  );\n  const inferredMatchEndGameTimeS = deduplicatedSnapshots.reduce(\n    (maximum, snapshot) => Math.max(maximum, snapshot.gameTimeS),\n    0,\n  );\n\n  return {\n    snapshots: deduplicatedSnapshots,\n    objectives: objectives.sort(""",
)
replace_once(
    CACHE,
    """        left.objectiveEventId.localeCompare(right.objectiveEventId),\n    ),\n  };\n}""",
    """        left.objectiveEventId.localeCompare(right.objectiveEventId),\n    ),\n    matchEndGameTimeS:\n      explicitMatchEndGameTimeS ??\n      (inferredMatchEndGameTimeS > 0\n        ? inferredMatchEndGameTimeS\n        : undefined),\n  };\n}""",
)

DATASET = "apps/api/src/deadlock-live/recommendation-pro-decision-dataset-v6.ts"
replace_once(
    DATASET,
    """  observedActionInCandidateSet: boolean;\n  shortHorizonOutcomes: {""",
    """  observedActionInCandidateSet: boolean;\n  terminalOutcomeApplied: boolean;\n  shortHorizonOutcomes: {""",
)
replace_once(
    DATASET,
    """    observedActionInCandidateSet: replayRow.observedAction.inCandidateSet,\n    shortHorizonOutcomes: horizonOutcomes(replayRow),""",
    """    observedActionInCandidateSet: replayRow.observedAction.inCandidateSet,\n    terminalOutcomeApplied: replayRow.shortHorizonOutcomes.some(\n      (outcome) =>\n        outcome.complete &&\n        outcome.outcomeSource === 'TERMINAL_FINAL_OUTCOME',\n    ),\n    shortHorizonOutcomes: horizonOutcomes(replayRow),""",
)
replace_once(
    DATASET,
    """    timelineJoinCount += row.state.timelineJoined ? 1 : 0;\n    shortHorizonDecisionCount += hasShortHorizonOutcome(row) ? 1 : 0;""",
    """    timelineJoinCount +=\n      row.state.timelineJoined || row.terminalOutcomeApplied ? 1 : 0;\n    shortHorizonDecisionCount += hasShortHorizonOutcome(row) ? 1 : 0;""",
)
replace_once(
    DATASET,
    """      `Timeline join coverage ${timelineJoinCoverage} is below ` +""",
    """      `Timeline join or confirmed terminal outcome coverage ${timelineJoinCoverage} is below ` +""",
)

DATASET_STREAMING = "apps/api/src/deadlock-live/recommendation-pro-decision-dataset-v6-streaming-audit.ts"
replace_once(
    DATASET_STREAMING,
    """    this.timelineJoinCount += row.state.timelineJoined ? 1 : 0;\n    this.shortHorizonDecisionCount += hasShortHorizonOutcome(row) ? 1 : 0;""",
    """    this.timelineJoinCount +=\n      row.state.timelineJoined || row.terminalOutcomeApplied ? 1 : 0;\n    this.shortHorizonDecisionCount += hasShortHorizonOutcome(row) ? 1 : 0;""",
)
replace_once(
    DATASET_STREAMING,
    """        `Timeline join coverage ${timelineJoinCoverage} is below ` +""",
    """        `Timeline join or confirmed terminal outcome coverage ${timelineJoinCoverage} is below ` +""",
)

write_file(
    "apps/api/test/recommendation-historical-pro-replay-terminal-outcomes.spec.ts",
    """import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import type { MatchTimelinePlayerSnapshot } from '../src/deadlock-live/match-timeline-collector.service';
import { buildRecommendationHistoricalShortHorizonOutcomes } from '../src/deadlock-live/recommendation-historical-pro-replay-outcomes';

describe('Recommendation historical terminal outcomes', () => {
  it.each([
    [true, 1],
    [false, -1],
  ])('uses final %s outcome when the match ends before every horizon', (playerWon, expectedUtility) => {
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision: decision(playerWon),
      snapshots: [snapshot(1_790), snapshot(1_920)],
      objectives: [],
      matchEndGameTimeS: 1_920,
      snapshotStalenessS: 300,
    });

    expect(outcomes).toEqual([
      terminal('3m', expectedUtility),
      terminal('5m', expectedUtility),
      terminal('10m', expectedUtility),
    ]);
  });

  it('keeps a missing horizon incomplete when match end is not confirmed', () => {
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision: decision(true),
      snapshots: [snapshot(1_790)],
      objectives: [],
      snapshotStalenessS: 30,
    });

    expect(outcomes.every((outcome) => !outcome.complete)).toBe(true);
  });
});

function terminal(horizon: '3m' | '5m' | '10m', utility: number) {
  return {
    horizon,
    complete: true,
    utility,
    outcomeSource: 'TERMINAL_FINAL_OUTCOME',
    terminalGameTimeS: 1_920,
  };
}

function decision(playerWon: boolean): HeroBuildDecisionDatasetV3Row {
  return {
    schemaVersion: 1,
    decisionId: 'decision-terminal',
    matchId: 100,
    matchStartTime: '2026-07-10T12:00:00.000Z',
    playerId: 200,
    heroId: 1,
    team: 0,
    gameTimeS: 1_800,
    phase: 'LATE',
    inventoryBeforeStateKey: '1001x1',
    inventoryAfterStateKey: '1001x1|1002x1',
    previousActionKeys: ['BUY:1001'],
    buildPrefixKey: 'BUY:1001',
    alliedHeroIds: [1, 2, 3, 4, 5, 6],
    enemyHeroIds: [7, 8, 9, 10, 11, 12],
    actualActionType: 'BUY',
    actualItemId: 1002,
    actualActionKey: 'BUY:1002',
    outcomeLabel: { playerWon },
  };
}

function snapshot(gameTimeS: number): MatchTimelinePlayerSnapshot {
  return {
    schemaVersion: 1,
    timelineVersion: 'MATCH_TIMELINE_V1',
    snapshotId: `snapshot-${gameTimeS}`,
    sourceEventId: `event-${gameTimeS}`,
    matchId: 100,
    gameTimeS,
    tick: gameTimeS * 60,
    steamId: '200',
    heroId: 1,
    teamId: 2,
    kills: 1,
    deaths: 0,
    assists: 2,
    netWorth: 5_000,
    heroDamage: 3_000,
    receivedAt: '2026-07-10T12:00:00.000Z',
  };
}
""",
)

print("Applied Recommendation V8 terminal outcome patch v1.")
