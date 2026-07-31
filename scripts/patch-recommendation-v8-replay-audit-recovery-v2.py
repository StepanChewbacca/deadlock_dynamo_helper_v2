from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one patch anchor, found {count}')
    path.write_text(text.replace(old, new, 1))


artifact_path = Path(
    'apps/api/src/deadlock-live/recommendation-historical-pro-replay-artifact.service.ts'
)
replace_once(
    artifact_path,
    """import { buildRecommendationHistoricalShortHorizonOutcomes } from './recommendation-historical-pro-replay-outcomes';""",
    """import {
  buildRecommendationHistoricalShortHorizonOutcomes,
  hasFreshRecommendationDecisionTimelineSnapshot,
} from './recommendation-historical-pro-replay-outcomes';
import { RECOMMENDATION_HISTORICAL_POSTGRES_TIMELINE_CACHE_VERSION } from './recommendation-historical-postgres-timeline-cache.service';""",
)
replace_once(
    artifact_path,
    """  timelineSource: {
    directory: string;
    snapshotStalenessS: number;
    requiredForOutput: true;
  };""",
    """  timelineSource: {
    source: 'POSTGRESQL_RAW_MATCH_METADATA_CACHE';
    cacheVersion: typeof RECOMMENDATION_HISTORICAL_POSTGRES_TIMELINE_CACHE_VERSION;
    directory: string;
    snapshotStalenessS: number;
    decisionSnapshotSelection: 'LATEST_AT_OR_BEFORE_WITHIN_STALENESS';
    horizonSnapshotSelection: 'NEAREST_AFTER_DECISION_WITHIN_STALENESS';
    requiredForOutput: true;
  };""",
)
replace_once(
    artifact_path,
    """        partitionStrategy: 'HERO_ID_HASH_V2',""",
    """        partitionStrategy: 'MATCH_ID_HASH_V3',
        candidateSupportStrategy: 'STATE_PRIMARY_PLUS_HERO_SUPPORT_UNION_V2',
        timelineJoinContract: 'DECISION_JOIN_SEPARATE_FROM_HORIZON_COMPLETENESS_V2',
        timelineCacheVersion:
          RECOMMENDATION_HISTORICAL_POSTGRES_TIMELINE_CACHE_VERSION,""",
)
replace_once(
    artifact_path,
    """      const outcomes =
        buildRecommendationHistoricalShortHorizonOutcomes({
          decision: row,
          snapshots: timeline.snapshots,
          objectives: timeline.objectives,
          snapshotStalenessS: input.snapshotStalenessS,
        });
      const replayRow = createRecommendationHistoricalProReplayRow({
        decision: row,
        candidateActions: candidates,""",
    """      const decisionTimelineJoined =
        hasFreshRecommendationDecisionTimelineSnapshot({
          decision: row,
          snapshots: timeline.snapshots,
          snapshotStalenessS: input.snapshotStalenessS,
        });
      const outcomes =
        buildRecommendationHistoricalShortHorizonOutcomes({
          decision: row,
          snapshots: timeline.snapshots,
          objectives: timeline.objectives,
          snapshotStalenessS: input.snapshotStalenessS,
        });
      const replayRow = createRecommendationHistoricalProReplayRow({
        decision: row,
        decisionTimelineJoined,
        candidateActions: candidates,""",
)
replace_once(
    artifact_path,
    """          directory: this.timelineDirectory,
          snapshotStalenessS: options.snapshotStalenessS,
          requiredForOutput: true,""",
    """          source: 'POSTGRESQL_RAW_MATCH_METADATA_CACHE',
          cacheVersion:
            RECOMMENDATION_HISTORICAL_POSTGRES_TIMELINE_CACHE_VERSION,
          directory: this.timelineDirectory,
          snapshotStalenessS: options.snapshotStalenessS,
          decisionSnapshotSelection:
            'LATEST_AT_OR_BEFORE_WITHIN_STALENESS',
          horizonSnapshotSelection:
            'NEAREST_AFTER_DECISION_WITHIN_STALENESS',
          requiredForOutput: true,""",
)
replace_once(
    artifact_path,
    """      const partition = partitionIndex(
        String(row.heroId),
        input.partitionCount,
      );""",
    """      const partition = partitionIndex(
        String(row.matchId),
        input.partitionCount,
      );""",
)
replace_once(
    artifact_path,
    """      120,
      0,
      3_600,
      'snapshotStalenessS',""",
    """      300,
      0,
      3_600,
      'snapshotStalenessS',""",
)

outcomes_path = Path(
    'apps/api/src/deadlock-live/recommendation-historical-pro-replay-outcomes.ts'
)
replace_once(
    outcomes_path,
    """export const RECOMMENDATION_SHORT_HORIZON_SNAPSHOT_STALENESS_S = 120;""",
    """export const RECOMMENDATION_SHORT_HORIZON_SNAPSHOT_STALENESS_S = 300;""",
)
replace_once(
    outcomes_path,
    """  const snapshotStalenessS =
    input.snapshotStalenessS ??
    RECOMMENDATION_SHORT_HORIZON_SNAPSHOT_STALENESS_S;
  if (
    !Number.isFinite(snapshotStalenessS) ||
    snapshotStalenessS < 0 ||
    snapshotStalenessS > 3_600
  ) {
    throw new Error('snapshotStalenessS must be between 0 and 3600.');
  }

  const playerSnapshots = selectDecisionPlayerSnapshots(""",
    """  const snapshotStalenessS = normalizeSnapshotStaleness(
    input.snapshotStalenessS,
  );

  const playerSnapshots = selectDecisionPlayerSnapshots(""",
)
replace_once(
    outcomes_path,
    """    const target = latestInWindow(
      playerSnapshots,
      input.decision.gameTimeS,
      upper,
    );""",
    """    const target = nearestToHorizonAfterDecision(
      playerSnapshots,
      input.decision.gameTimeS,
      upper,
      snapshotStalenessS,
    );""",
)
replace_once(
    outcomes_path,
    """    const targetFresh =
      target !== undefined && upper - target.gameTimeS <= snapshotStalenessS;""",
    """    const targetFresh =
      target !== undefined &&
      Math.abs(upper - target.gameTimeS) <= snapshotStalenessS;""",
)
replace_once(
    outcomes_path,
    """export function recommendationShortHorizonUtility(""",
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

export function recommendationShortHorizonUtility(""",
)
replace_once(
    outcomes_path,
    """function latestInWindow(
  snapshots: readonly MatchTimelinePlayerSnapshot[],
  lowerExclusive: number,
  upperInclusive: number,
): MatchTimelinePlayerSnapshot | undefined {
  let result: MatchTimelinePlayerSnapshot | undefined;
  for (const snapshot of snapshots) {
    if (snapshot.gameTimeS <= lowerExclusive) {
      continue;
    }
    if (snapshot.gameTimeS > upperInclusive) {
      break;
    }
    result = snapshot;
  }
  return result;
}""",
    """function nearestToHorizonAfterDecision(
  snapshots: readonly MatchTimelinePlayerSnapshot[],
  decisionGameTimeS: number,
  horizonGameTimeS: number,
  snapshotStalenessS: number,
): MatchTimelinePlayerSnapshot | undefined {
  let result: MatchTimelinePlayerSnapshot | undefined;
  let resultDistance = Number.POSITIVE_INFINITY;
  const latestAllowed = horizonGameTimeS + snapshotStalenessS;
  for (const snapshot of snapshots) {
    if (snapshot.gameTimeS <= decisionGameTimeS) {
      continue;
    }
    if (snapshot.gameTimeS > latestAllowed) {
      break;
    }
    const distance = Math.abs(snapshot.gameTimeS - horizonGameTimeS);
    if (
      distance < resultDistance ||
      (distance === resultDistance &&
        result !== undefined &&
        snapshot.gameTimeS < result.gameTimeS)
    ) {
      result = snapshot;
      resultDistance = distance;
    }
  }
  return result;
}

function normalizeSnapshotStaleness(value: number | undefined): number {
  const result =
    value ?? RECOMMENDATION_SHORT_HORIZON_SNAPSHOT_STALENESS_S;
  if (!Number.isFinite(result) || result < 0 || result > 3_600) {
    throw new Error('snapshotStalenessS must be between 0 and 3600.');
  }
  return result;
}""",
)

replay_path = Path(
    'apps/api/src/deadlock-live/recommendation-historical-pro-replay.ts'
)
replace_once(
    replay_path,
    """  state: {
    inventoryBeforeStateKey: string;""",
    """  timeline: {
    decisionSnapshotJoined: boolean;
  };
  state: {
    inventoryBeforeStateKey: string;""",
)
replace_once(
    replay_path,
    """  decision: HeroBuildDecisionDatasetV3Row;
  candidateActions: RecommendationHistoricalCandidateInput[];""",
    """  decision: HeroBuildDecisionDatasetV3Row;
  decisionTimelineJoined?: boolean;
  candidateActions: RecommendationHistoricalCandidateInput[];""",
)
replace_once(
    replay_path,
    """  const completeOutcomeAvailable = normalizedOutcomes.some(
    (outcome) => outcome.complete && outcome.utility !== undefined,
  );""",
    """  const completeOutcomeAvailable = normalizedOutcomes.some(
    (outcome) => outcome.complete && outcome.utility !== undefined,
  );
  const decisionTimelineJoined =
    input.decisionTimelineJoined ?? completeOutcomeAvailable;""",
)
replace_once(
    replay_path,
    """  if (!completeOutcomeAvailable) {
    exclusionReasons.push('MISSING_COMPLETE_SHORT_HORIZON_OUTCOME');
  }""",
    """  if (!decisionTimelineJoined) {
    exclusionReasons.push('MISSING_DECISION_TIMELINE_SNAPSHOT');
  }
  if (!completeOutcomeAvailable) {
    exclusionReasons.push('MISSING_COMPLETE_SHORT_HORIZON_OUTCOME');
  }""",
)
replace_once(
    replay_path,
    """    phase: input.decision.phase,
    state: {""",
    """    phase: input.decision.phase,
    timeline: {
      decisionSnapshotJoined,
    },
    state: {""",
)
replace_once(
    replay_path,
    """    timelineRowCount += row.shortHorizonOutcomes.some(
      (outcome) => outcome.complete,
    )
      ? 1
      : 0;""",
    """    timelineRowCount += row.timeline.decisionSnapshotJoined ? 1 : 0;""",
)
replace_once(
    replay_path,
    """    actionKey: action.actionKey,
    actionType: action.sourceActionType,""",
    """    actionKey: `${action.sourceActionType}:${action.itemId}`,
    actionType: action.sourceActionType,""",
)

snapshot_path = Path(
    'apps/api/src/deadlock-live/recommendation-candidate-generator-snapshot.ts'
)
replace_once(
    snapshot_path,
    """  parsedStates: Array<{
    state: HeroBuildPolicyState;
    itemCounts: ReadonlyMap<number, number>;
  }>;
}""",
    """  parsedStates: Array<{
    state: HeroBuildPolicyState;
    itemCounts: ReadonlyMap<number, number>;
  }>;
  supportPolicy: HeroBuildPolicy;
  supportParsedStates: Array<{
    state: HeroBuildPolicyState;
    itemCounts: ReadonlyMap<number, number>;
  }>;
}""",
)
replace_once(
    snapshot_path,
    """  return {
    heroId: value.heroId,
    policy,
    parsedStates,
  };""",
    """  const support = buildHistoricalSupportPolicy(value);
  return {
    heroId: value.heroId,
    policy,
    parsedStates,
    supportPolicy: support.policy,
    supportParsedStates: support.parsedStates,
  };""",
)
replace_once(
    snapshot_path,
    """  const response = recommendFromPolicy(
    {
      heroId: input.decision.heroId,
      itemIds,
      gameTimeS: input.decision.gameTimeS,
      limit: input.generatorOptions.limit,
    },
    input.decision.inventoryBeforeStateKey,
    input.policy.policy,
    input.policy.parsedStates,
    (parentItemId) => componentsByParent.get(parentItemId) ?? [],
    normalizeGeneratorOptions(input.generatorOptions),
  );
  return candidateActionsFromRecommendationResponse(response);
}""",
    """  const request = {
    heroId: input.decision.heroId,
    itemIds,
    gameTimeS: input.decision.gameTimeS,
    limit: input.generatorOptions.limit,
  };
  const recipeResolver = (parentItemId: number): readonly number[] =>
    componentsByParent.get(parentItemId) ?? [];
  const response = recommendFromPolicy(
    request,
    input.decision.inventoryBeforeStateKey,
    input.policy.policy,
    input.policy.parsedStates,
    recipeResolver,
    normalizeGeneratorOptions(input.generatorOptions),
  );
  const supportResponse = recommendFromPolicy(
    request,
    input.decision.inventoryBeforeStateKey,
    input.policy.supportPolicy,
    input.policy.supportParsedStates,
    recipeResolver,
    {
      minExactObservations: 1,
      maxBackoffDistance: 64,
      maxBackoffStates: 1,
      limit: input.generatorOptions.limit,
    },
  );
  return mergeHistoricalCandidateActions(
    candidateActionsFromRecommendationResponse(response),
    candidateActionsFromRecommendationResponse(supportResponse),
    input.generatorOptions.limit,
  );
}

function mergeHistoricalCandidateActions(
  primary: readonly RecommendationHistoricalCandidateInput[],
  support: readonly RecommendationHistoricalCandidateInput[],
  limit: number,
): RecommendationHistoricalCandidateInput[] {
  const unique = new Map<string, RecommendationHistoricalCandidateInput>();
  for (const candidate of [...primary, ...support]) {
    const actionKey = `${candidate.actionType}:${candidate.itemId}`;
    if (unique.has(actionKey)) {
      continue;
    }
    unique.set(actionKey, {
      ...candidate,
      actionKey,
      rank: unique.size + 1,
    });
    if (unique.size >= limit) {
      break;
    }
  }
  return [...unique.values()];
}

function buildHistoricalSupportPolicy(
  value: RecommendationSerializedHeroBuildPolicy,
): {
  policy: HeroBuildPolicy;
  parsedStates: Array<{
    state: HeroBuildPolicyState;
    itemCounts: ReadonlyMap<number, number>;
  }>;
} {
  const aggregates = new Map<
    string,
    {
      actionType: HeroBuildPolicyNextAction['actionType'];
      itemId: number;
      actionKey: string;
      count: number;
      totalGameTimeS: number;
      afterStateCounts: Map<string, number>;
    }
  >();
  let observationCount = 0;
  let transitionCount = 0;

  for (const state of value.states) {
    observationCount += state.observationCount;
    for (const action of state.nextActions) {
      const key = `${action.actionType}:${action.itemId}`;
      const aggregate = aggregates.get(key) ?? {
        actionType: action.actionType,
        itemId: action.itemId,
        actionKey: key,
        count: 0,
        totalGameTimeS: 0,
        afterStateCounts: new Map<string, number>(),
      };
      aggregate.count += action.count;
      aggregate.totalGameTimeS += action.averageGameTimeS * action.count;
      transitionCount += action.count;
      for (const afterState of action.afterStates) {
        aggregate.afterStateCounts.set(
          afterState.afterStateKey,
          (aggregate.afterStateCounts.get(afterState.afterStateKey) ?? 0) +
            afterState.count,
        );
      }
      aggregates.set(key, aggregate);
    }
  }

  const nextActions = [...aggregates.values()]
    .map((aggregate): HeroBuildPolicyNextAction => ({
      actionType: aggregate.actionType,
      itemId: aggregate.itemId,
      actionKey: aggregate.actionKey,
      count: aggregate.count,
      probability:
        transitionCount > 0 ? aggregate.count / transitionCount : 0,
      averageGameTimeS:
        aggregate.count > 0
          ? aggregate.totalGameTimeS / aggregate.count
          : 0,
      afterStates: [...aggregate.afterStateCounts.entries()]
        .map(([afterStateKey, count]) => ({
          afterStateKey,
          count,
          probability:
            aggregate.count > 0 ? count / aggregate.count : 0,
        }))
        .sort(
          (left, right) =>
            right.count - left.count ||
            left.afterStateKey.localeCompare(right.afterStateKey),
        ),
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.actionKey.localeCompare(right.actionKey),
    );
  const state: HeroBuildPolicyState = {
    heroId: value.heroId,
    stateKey: 'EMPTY',
    observationCount: Math.max(1, observationCount),
    nextActionCount: nextActions.length,
    nextActions,
  };
  return {
    policy: {
      heroId: value.heroId,
      playerCount: value.playerCount,
      stateCount: 1,
      transitionCount,
      statesByKey: new Map([[state.stateKey, state]]),
    },
    parsedStates: [{ state, itemCounts: new Map<number, number>() }],
  };
}""",
)

pipeline_path = Path('scripts/run-recommendation-v8-pipeline.mjs')
replace_once(
    pipeline_path,
    """async function runStage({ name, startPath, statusPath, body }) {
  console.log(`${name}: starting.`);
  await post(startPath, body);
  const deadline = Date.now() + config.pipelineTimeoutMs;
  let previousPhase;

  while (Date.now() < deadline) {""",
    """async function runStage({ name, startPath, statusPath, body }) {
  const deadline = Date.now() + config.pipelineTimeoutMs;
  let status = await get(statusPath);
  let previousPhase;

  if (status.state === 'COMPLETE') {
    console.log(`${name}: already COMPLETE/${status.phase}.`);
    return status;
  }

  if (status.state === 'RUNNING') {
    console.log(`${name}: resuming ${status.state}/${status.phase}.`);
  } else {
    console.log(`${name}: starting.`);
    try {
      await post(startPath, body);
    } catch (error) {
      const afterStart = await get(statusPath);
      if (!['RUNNING', 'COMPLETE'].includes(afterStart.state)) {
        throw error;
      }
      status = afterStart;
      console.warn(
        `${name}: start request failed after the server accepted the stage; ` +
          `continuing from ${status.state}/${status.phase}.`,
      );
    }
  }

  while (Date.now() < deadline) {""",
)

test_path = Path(
    'apps/api/test/recommendation-historical-replay-audit-recovery-v2.spec.ts'
)
test_path.write_text(
    """import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import type { MatchTimelinePlayerSnapshot } from '../src/deadlock-live/match-timeline-collector.service';
import {
  createRecommendationCandidateGeneratorSnapshotArtifact,
  generateRecommendationHistoricalCandidatesFromSnapshot,
} from '../src/deadlock-live/recommendation-candidate-generator-snapshot';
import {
  buildRecommendationHistoricalShortHorizonOutcomes,
  hasFreshRecommendationDecisionTimelineSnapshot,
} from '../src/deadlock-live/recommendation-historical-pro-replay-outcomes';
import {
  buildRecommendationHistoricalProReplayAudit,
  createRecommendationHistoricalProReplayRow,
} from '../src/deadlock-live/recommendation-historical-pro-replay';

describe('Recommendation historical replay audit recovery v2', () => {
  it('preserves REBUY action identity and adds hero-level support candidates', () => {
    const decision = sourceDecision();
    const artifact = createRecommendationCandidateGeneratorSnapshotArtifact({
      snapshot: {
        snapshotId: 'support-v2',
        generatorVersion: 'RECOMMENDATION_CANDIDATE_GENERATOR_V6_2_SUPPORT_UNION',
        policyVersion: 'RECOMMENDATION_CANDIDATE_POLICY_V6_2_SUPPORT_UNION',
        catalogVersion: 'test-catalog',
        trainingWindowStart: '2026-06-01T00:00:00.000Z',
        trainingWindowEnd: '2026-07-01T00:00:00.000Z',
      },
      generatorOptions: {
        minExactObservations: 3,
        maxBackoffDistance: 4,
        maxBackoffStates: 64,
        limit: 100,
      },
      policies: [
        {
          heroId: 1,
          playerCount: 10,
          stateCount: 2,
          transitionCount: 20,
          states: [
            {
              stateKey: '1001x1',
              observationCount: 10,
              nextActionCount: 1,
              nextActions: [
                {
                  actionType: 'BUY',
                  itemId: 1003,
                  actionKey: 'BUY:1003',
                  count: 10,
                  probability: 1,
                  averageGameTimeS: 300,
                  afterStates: [
                    {
                      afterStateKey: '1001x1|1003x1',
                      count: 10,
                      probability: 1,
                    },
                  ],
                },
              ],
            },
            {
              stateKey: 'EMPTY',
              observationCount: 10,
              nextActionCount: 1,
              nextActions: [
                {
                  actionType: 'REBUY',
                  itemId: 1002,
                  actionKey: 'REBUY:1002',
                  count: 10,
                  probability: 1,
                  averageGameTimeS: 600,
                  afterStates: [
                    {
                      afterStateKey: '1002x1',
                      count: 10,
                      probability: 1,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      catalog: {
        version: 'test-catalog',
        items: [catalogItem(1001), catalogItem(1002), catalogItem(1003)],
      },
    });

    const candidates = generateRecommendationHistoricalCandidatesFromSnapshot({
      decision,
      artifact,
    });

    expect(candidates.map((candidate) => candidate.actionKey)).toContain(
      'REBUY:1002',
    );
    expect(candidates.map((candidate) => candidate.actionKey)).toContain(
      'BUY:1003',
    );
  });

  it('separates decision timeline join from short-horizon completeness', () => {
    const decision = sourceDecision();
    const snapshots = [
      timelineSnapshot(299),
      timelineSnapshot(850),
    ];
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision,
      snapshots,
      objectives: [],
      snapshotStalenessS: 300,
    });
    expect(
      hasFreshRecommendationDecisionTimelineSnapshot({
        decision,
        snapshots,
        snapshotStalenessS: 300,
      }),
    ).toBe(true);

    const row = createRecommendationHistoricalProReplayRow({
      decision,
      decisionTimelineJoined: true,
      candidateActions: [
        {
          actionKey: 'REBUY:1002',
          actionType: 'REBUY',
          itemId: 1002,
          rank: 1,
          score: 1,
          historicalCount: 10,
          historicalProbability: 1,
          confidence: 1,
          predictedStateKey: '1001x1|1002x1',
        },
      ],
      catalogItemsById: new Map([
        [1002, catalogItem(1002)],
      ]),
      shortHorizonOutcomes: outcomes.map((outcome) => ({
        ...outcome,
        complete: false,
        utility: undefined,
      })),
      generatorSnapshot: {
        snapshotId: 'support-v2',
        generatorVersion: 'RECOMMENDATION_CANDIDATE_GENERATOR_V6_2_SUPPORT_UNION',
        policyVersion: 'RECOMMENDATION_CANDIDATE_POLICY_V6_2_SUPPORT_UNION',
        policySha256: 'a'.repeat(64),
        catalogVersion: 'test-catalog',
        catalogSha256: 'b'.repeat(64),
        trainingWindowStart: '2026-06-01T00:00:00.000Z',
        trainingWindowEnd: '2026-07-01T00:00:00.000Z',
      },
    });
    const audit = buildRecommendationHistoricalProReplayAudit([row], {
      minimumTimelineCoverage: 1,
      minimumCandidateMetadataCoverage: 1,
      minimumObservedActionCandidateCoverage: 1,
    });

    expect(audit.coverage.timelineCoverage).toBe(1);
    expect(row.eligibility.stateModel).toBe(false);
  });

  it('uses the nearest post-decision snapshot around a horizon', () => {
    const decision = sourceDecision();
    const outcomes = buildRecommendationHistoricalShortHorizonOutcomes({
      decision,
      snapshots: [
        timelineSnapshot(299),
        timelineSnapshot(650),
        timelineSnapshot(850),
      ],
      objectives: [],
      snapshotStalenessS: 300,
    });

    expect(outcomes.find((outcome) => outcome.horizon === '5m')).toMatchObject({
      complete: true,
      snapshotGameTimeS: 650,
    });
  });
});

function sourceDecision(): HeroBuildDecisionDatasetV3Row {
  return {
    schemaVersion: 1,
    decisionId: '100:200:2',
    matchId: 100,
    matchStartTime: '2026-07-10T12:00:00.000Z',
    playerId: 200,
    heroId: 1,
    team: 0,
    gameTimeS: 300,
    phase: 'EARLY',
    inventoryBeforeStateKey: '1001x1',
    inventoryAfterStateKey: '1001x1|1002x1',
    previousActionKeys: ['BUY:1001'],
    buildPrefixKey: 'BUY:1001',
    alliedHeroIds: [1, 2, 3, 4, 5, 6],
    enemyHeroIds: [7, 8, 9, 10, 11, 12],
    actualActionType: 'REBUY',
    actualItemId: 1002,
    actualActionKey: 'REBUY:1002',
    outcomeLabel: { playerWon: true },
  };
}

function timelineSnapshot(gameTimeS: number): MatchTimelinePlayerSnapshot {
  return {
    schemaVersion: 1,
    timelineVersion: 'MATCH_TIMELINE_V1',
    snapshotId: `snapshot-${gameTimeS}`,
    sourceEventId: `event-${gameTimeS}`,
    matchId: 100,
    gameTimeS,
    tick: Math.round(gameTimeS * 60),
    steamId: '200',
    heroId: 1,
    teamId: 2,
    kills: 1,
    deaths: 0,
    assists: 1,
    netWorth: 5_000 + gameTimeS,
    heroDamage: 2_000 + gameTimeS,
    receivedAt: '2026-07-10T13:00:00.000Z',
  };
}

function catalogItem(itemId: number) {
  return {
    itemId,
    name: `Item ${itemId}`,
    cost: 500,
    tier: 1,
    slotType: 'WEAPON',
    tags: [],
    componentItemIds: [],
  };
}
"""
)
