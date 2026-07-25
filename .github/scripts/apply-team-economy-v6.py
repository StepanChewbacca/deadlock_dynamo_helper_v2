from __future__ import annotations

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding="utf-8")
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one target, found {count}")
    file_path.write_text(content.replace(old, new), encoding="utf-8")


def replace_count(path: str, old: str, new: str, expected: int) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding="utf-8")
    count = content.count(old)
    if count != expected:
        raise RuntimeError(f"{path}: expected {expected} targets, found {count}")
    file_path.write_text(content.replace(old, new), encoding="utf-8")


DATASET_SERVICE = "apps/api/src/deadlock-live/recommendation-decision-dataset-v5.service.ts"
DATASET_TEST = "apps/api/test/recommendation-decision-dataset-v5.spec.ts"
VALUE_SERVICE = "apps/api/src/deadlock-live/recommendation-value-v6-training.service.ts"
VALUE_TEST = "apps/api/test/recommendation-value-v6-training.spec.ts"
DATASET_DOC = "docs/recommendation-dataset-v5.md"
VALUE_DOC = "docs/recommendation-value-v6.md"

replace_once(
    DATASET_SERVICE,
    """export const RECOMMENDATION_DECISION_DATASET_V5_SCHEMA_VERSION = 2;
export const RECOMMENDATION_DECISION_DATASET_V5_VERSION =
  'RECOMMENDATION_DECISION_DATASET_V5_2' as const;""",
    """export const RECOMMENDATION_DECISION_DATASET_V5_SCHEMA_VERSION = 3;
export const RECOMMENDATION_DECISION_DATASET_V5_VERSION =
  'RECOMMENDATION_DECISION_DATASET_V5_3' as const;""",
)

replace_once(
    DATASET_SERVICE,
    """  const snapshots = playerSnapshots(input.timeline.snapshots, input.row);
  const baseline = atOrBefore(snapshots, input.row.gameTimeS);
  const windows = Object.fromEntries(""",
    """  const snapshots = playerSnapshots(input.timeline.snapshots, input.row);
  const baseline = atOrBefore(snapshots, input.row.gameTimeS);
  const teamEconomy = teamEconomyFeature(
    input.timeline.snapshots,
    input.row,
    input.row.gameTimeS,
    input.snapshotStalenessS,
  );
  const windows = Object.fromEntries(""",
)

replace_once(
    DATASET_SERVICE,
    """        playerTimelineSnapshot: snapshotFeature(
          baseline,
          input.row.gameTimeS,
          input.snapshotStalenessS,
        ),
      },""",
    """        playerTimelineSnapshot: snapshotFeature(
          baseline,
          input.row.gameTimeS,
          input.snapshotStalenessS,
        ),
        teamEconomy,
      },""",
)

replace_once(
    DATASET_SERVICE,
    """          futureTimelineUsedAsInputFeature: false,
          horizonWindowLowerBoundExclusive: true,""",
    """          futureTimelineUsedAsInputFeature: false,
          teamEconomySnapshotsAtOrBeforeDecisionOnly: true,
          horizonWindowLowerBoundExclusive: true,""",
)

replace_once(
    DATASET_SERVICE,
    """          trajectoryFields: [
            'fullPreviousActionKeys',
            'decisionIndex',
            'nextObservedActionKey',
            'timeToNextObservedActionS',
          ],
          shortHorizonTargets: ['3m', '5m', '10m'],""",
    """          trajectoryFields: [
            'fullPreviousActionKeys',
            'decisionIndex',
            'nextObservedActionKey',
            'timeToNextObservedActionS',
          ],
          stateFeatures: [
            'playerTimelineSnapshot',
            'teamEconomy',
            'inventory',
            'candidateActions',
          ],
          shortHorizonTargets: ['3m', '5m', '10m'],""",
)

team_helpers = r"""
function teamEconomyFeature(
  snapshots: readonly MatchTimelinePlayerSnapshot[],
  row: RecommendationDecisionDatasetV4Row,
  decisionTime: number,
  staleAfter: number,
): Record<string, unknown> {
  const ownTeamId = liveTeam(row.teamId);
  if (ownTeamId === undefined) {
    return {
      available: false,
      decisionGameTimeS: decisionTime,
      unavailableReason: 'MISSING_PLAYER_TEAM_ID',
    };
  }

  const latest = latestPlayerSnapshotsAtOrBefore(snapshots, decisionTime);
  const teamSnapshots = latest.filter(
    (snapshot) => snapshot.teamId !== undefined,
  );
  const fresh = teamSnapshots.filter(
    (snapshot) => decisionTime - snapshot.gameTimeS <= staleAfter,
  );
  const own = fresh.filter((snapshot) => snapshot.teamId === ownTeamId);
  const enemy = fresh.filter((snapshot) => snapshot.teamId !== ownTeamId);
  const expectedOwnTeamPlayerCount = new Set(row.alliedHeroIds).size;
  const expectedEnemyTeamPlayerCount = new Set(row.enemyHeroIds).size;

  if (own.length === 0 || enemy.length === 0) {
    return {
      available: false,
      decisionGameTimeS: decisionTime,
      snapshotStalenessS: staleAfter,
      ownTeamId,
      freshPlayerCount: fresh.length,
      stalePlayerCount: teamSnapshots.length - fresh.length,
      ownTeamPlayerCount: own.length,
      enemyTeamPlayerCount: enemy.length,
      expectedOwnTeamPlayerCount,
      expectedEnemyTeamPlayerCount,
      unavailableReason:
        own.length === 0
          ? 'MISSING_OWN_TEAM_SNAPSHOT_AT_DECISION'
          : 'MISSING_ENEMY_TEAM_SNAPSHOT_AT_DECISION',
    };
  }

  const ownSummary = teamEconomySummary(own);
  const enemySummary = teamEconomySummary(enemy);
  const player =
    own.find((snapshot) => snapshot.steamId === row.steamId) ??
    own.find((snapshot) => snapshot.heroId === row.heroId);
  const sortedOwn = [...own].sort(
    (left, right) =>
      right.netWorth - left.netWorth ||
      left.heroId - right.heroId ||
      left.steamId.localeCompare(right.steamId),
  );
  const playerRank = player
    ? sortedOwn.findIndex(
        (snapshot) =>
          snapshot.steamId === player.steamId &&
          snapshot.heroId === player.heroId,
      ) + 1
    : undefined;
  const netWorthDelta = ownSummary.netWorth - enemySummary.netWorth;
  const combinedNetWorth = ownSummary.netWorth + enemySummary.netWorth;

  return {
    available: true,
    decisionGameTimeS: decisionTime,
    snapshotStalenessS: staleAfter,
    ownTeamId,
    enemyTeamIds: [
      ...new Set(
        enemy
          .map((snapshot) => snapshot.teamId)
          .filter((teamId): teamId is number => teamId !== undefined),
      ),
    ].sort((left, right) => left - right),
    freshPlayerCount: fresh.length,
    stalePlayerCount: teamSnapshots.length - fresh.length,
    expectedOwnTeamPlayerCount,
    expectedEnemyTeamPlayerCount,
    completeOwnTeam:
      expectedOwnTeamPlayerCount > 0 &&
      own.length >= expectedOwnTeamPlayerCount,
    completeEnemyTeam:
      expectedEnemyTeamPlayerCount > 0 &&
      enemy.length >= expectedEnemyTeamPlayerCount,
    ownTeam: ownSummary,
    enemyTeam: enemySummary,
    netWorthDelta,
    relativeNetWorthDelta:
      combinedNetWorth > 0 ? netWorthDelta / combinedNetWorth : 0,
    playerNetWorth: player?.netWorth,
    playerNetWorthShare:
      player && ownSummary.netWorth > 0
        ? player.netWorth / ownSummary.netWorth
        : undefined,
    playerNetWorthRankInTeam: playerRank && playerRank > 0 ? playerRank : undefined,
  };
}

function latestPlayerSnapshotsAtOrBefore(
  snapshots: readonly MatchTimelinePlayerSnapshot[],
  decisionTime: number,
): MatchTimelinePlayerSnapshot[] {
  const latest = new Map<string, MatchTimelinePlayerSnapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.gameTimeS > decisionTime) {
      break;
    }
    const key = snapshot.steamId
      ? `STEAM:${snapshot.steamId}`
      : `HERO:${snapshot.teamId ?? 'UNKNOWN'}:${snapshot.heroId}`;
    const existing = latest.get(key);
    if (!existing || compareSnapshots(existing, snapshot) <= 0) {
      latest.set(key, snapshot);
    }
  }
  return [...latest.values()].sort(compareSnapshots);
}

function teamEconomySummary(
  snapshots: readonly MatchTimelinePlayerSnapshot[],
): {
  playerCount: number;
  netWorth: number;
  averageNetWorth: number;
  highestNetWorth: number;
  lowestNetWorth: number;
} {
  const values = snapshots.map((snapshot) => snapshot.netWorth);
  const netWorth = values.reduce((sum, value) => sum + value, 0);
  return {
    playerCount: snapshots.length,
    netWorth,
    averageNetWorth: snapshots.length > 0 ? netWorth / snapshots.length : 0,
    highestNetWorth: values.length > 0 ? Math.max(...values) : 0,
    lowestNetWorth: values.length > 0 ? Math.min(...values) : 0,
  };
}

"""

replace_once(
    DATASET_SERVICE,
    """function itemAndBuildFeatures(
  row: RecommendationDecisionDatasetV4Row,""",
    team_helpers
    + """function itemAndBuildFeatures(
  row: RecommendationDecisionDatasetV4Row,""",
)

replace_once(
    VALUE_SERVICE,
    """  const inventory = record(features.inventory);
  const timeline = record(state.playerTimelineSnapshot);
  const stateKeys = uniqueStrings([""",
    """  const inventory = record(features.inventory);
  const timeline = record(state.playerTimelineSnapshot);
  const teamEconomy = record(state.teamEconomy);
  const teamEconomyBand =
    teamEconomy.available === true
      ? classifyRecommendationValueV6TeamEconomy(
          numeric(teamEconomy.relativeNetWorthDelta),
        )
      : undefined;
  const stateKeys = uniqueStrings([""",
)

replace_once(
    VALUE_SERVICE,
    """    timeline.available === true
      ? `TIMELINE_KDA:${heroId}|${bucket(
          numeric(timeline.kills) + numeric(timeline.assists) - numeric(timeline.deaths),
          2,
        )}`
      : undefined,
    ...numbers(state.alliedHeroIds).map(""",
    """    timeline.available === true
      ? `TIMELINE_KDA:${heroId}|${bucket(
          numeric(timeline.kills) + numeric(timeline.assists) - numeric(timeline.deaths),
          2,
        )}`
      : undefined,
    teamEconomyBand
      ? `TEAM_ECONOMY_BAND:${heroId}|${teamEconomyBand}`
      : undefined,
    teamEconomy.available === true
      ? `TEAM_NET_WORTH_DELTA:${heroId}|${bucket(
          numeric(teamEconomy.netWorthDelta),
          5_000,
        )}`
      : undefined,
    teamEconomy.available === true
      ? `TEAM_RELATIVE_NET_WORTH_DELTA:${heroId}|${bucket(
          numeric(teamEconomy.relativeNetWorthDelta) * 100,
          5,
        )}`
      : undefined,
    numeric(teamEconomy.playerNetWorthRankInTeam) > 0
      ? `PLAYER_TEAM_NET_WORTH_RANK:${heroId}|${numeric(
          teamEconomy.playerNetWorthRankInTeam,
        )}`
      : undefined,
    teamEconomy.available === true
      ? `PLAYER_TEAM_NET_WORTH_SHARE:${heroId}|${bucket(
          numeric(teamEconomy.playerNetWorthShare) * 100,
          10,
        )}`
      : undefined,
    ...numbers(state.alliedHeroIds).map(""",
)

replace_count(
    VALUE_SERVICE,
    """      previousTail,
      actionKey:""",
    """      previousTail,
      teamEconomyBand,
      actionKey:""",
    2,
)

replace_once(
    VALUE_SERVICE,
    """  previousTail: string;
  actionKey: string;
  feature: Record<string, unknown>;""",
    """  previousTail: string;
  teamEconomyBand?: string;
  actionKey: string;
  feature: Record<string, unknown>;""",
)

replace_once(
    VALUE_SERVICE,
    """    `HERO_TIME_PREVIOUS_ACTION:${input.heroId}|${input.timeBucket}|${input.previousTail}|${input.actionKey}`,
    text(item.slotType)""",
    """    `HERO_TIME_PREVIOUS_ACTION:${input.heroId}|${input.timeBucket}|${input.previousTail}|${input.actionKey}`,
    input.teamEconomyBand
      ? `HERO_TEAM_ECONOMY_ACTION:${input.heroId}|${input.teamEconomyBand}|${input.actionKey}`
      : undefined,
    input.teamEconomyBand && text(item.slotType)
      ? `HERO_TEAM_ECONOMY_SLOT:${input.heroId}|${input.teamEconomyBand}|${text(
          item.slotType,
        )}`
      : undefined,
    text(item.slotType)""",
)

economy_classifier = r"""
export function classifyRecommendationValueV6TeamEconomy(
  relativeNetWorthDelta: number,
): 'FAR_BEHIND' | 'BEHIND' | 'EVEN' | 'AHEAD' | 'FAR_AHEAD' {
  if (!Number.isFinite(relativeNetWorthDelta)) {
    throw new Error('Team relative net-worth delta must be finite.');
  }
  if (relativeNetWorthDelta <= -0.15) {
    return 'FAR_BEHIND';
  }
  if (relativeNetWorthDelta < -0.05) {
    return 'BEHIND';
  }
  if (relativeNetWorthDelta <= 0.05) {
    return 'EVEN';
  }
  if (relativeNetWorthDelta < 0.15) {
    return 'AHEAD';
  }
  return 'FAR_AHEAD';
}

"""

replace_once(
    VALUE_SERVICE,
    """function predictCandidates(
  model: RecommendationValueV6Model,""",
    economy_classifier
    + """function predictCandidates(
  model: RecommendationValueV6Model,""",
)

replace_once(
    DATASET_TEST,
    """    expect(first.shortHorizonOutcomes.windows['3m']).toMatchObject({""",
    """    expect(first.stateBeforeAction.teamEconomy).toMatchObject({
      available: true,
      ownTeamId: 2,
      ownTeam: {
        playerCount: 2,
        netWorth: 2500,
        averageNetWorth: 1250,
        highestNetWorth: 1500,
        lowestNetWorth: 1000,
      },
      enemyTeam: {
        playerCount: 2,
        netWorth: 4500,
        averageNetWorth: 2250,
        highestNetWorth: 2500,
        lowestNetWorth: 2000,
      },
      netWorthDelta: -2000,
      playerNetWorth: 1000,
      playerNetWorthShare: 0.4,
      playerNetWorthRankInTeam: 2,
      completeOwnTeam: true,
      completeEnemyTeam: true,
    });
    expect(first.stateBeforeAction.teamEconomy.relativeNetWorthDelta).toBeCloseTo(
      -2000 / 7000,
    );
    expect(first.shortHorizonOutcomes.windows['3m']).toMatchObject({""",
)

replace_once(
    DATASET_TEST,
    """        futureTimelineUsedAsInputFeature: false,
        horizonWindowLowerBoundExclusive: true,""",
    """        futureTimelineUsedAsInputFeature: false,
        teamEconomySnapshotsAtOrBeforeDecisionOnly: true,
        horizonWindowLowerBoundExclusive: true,""",
)

replace_once(
    DATASET_TEST,
    """  snapshots: MatchTimelinePlayerSnapshot[] = [
    createSnapshot(95, 1, 0, 1, 1000),
    createSnapshot(275, 2, 1, 3, 2700),
    createSnapshot(395, 3, 1, 4, 3900),
    createSnapshot(695, 4, 2, 5, 7000),
  ],""",
    """  snapshots: MatchTimelinePlayerSnapshot[] = [
    createSnapshot(95, 1, 0, 1, 1000),
    createSnapshot(95, 0, 0, 1, 1500, {
      steamId: 'ally-1',
      heroId: 16,
      teamId: 2,
    }),
    createSnapshot(95, 1, 0, 0, 2000, {
      steamId: 'enemy-1',
      heroId: 20,
      teamId: 3,
    }),
    createSnapshot(95, 2, 0, 0, 2500, {
      steamId: 'enemy-2',
      heroId: 21,
      teamId: 3,
    }),
    createSnapshot(215, 1, 0, 2, 2000),
    createSnapshot(215, 0, 0, 2, 2600, {
      steamId: 'ally-1',
      heroId: 16,
      teamId: 2,
    }),
    createSnapshot(215, 1, 0, 1, 3200, {
      steamId: 'enemy-1',
      heroId: 20,
      teamId: 3,
    }),
    createSnapshot(215, 2, 0, 1, 3600, {
      steamId: 'enemy-2',
      heroId: 21,
      teamId: 3,
    }),
    createSnapshot(275, 2, 1, 3, 2700),
    createSnapshot(395, 3, 1, 4, 3900),
    createSnapshot(695, 4, 2, 5, 7000),
  ],""",
)

replace_once(
    DATASET_TEST,
    """function createSnapshot(gameTimeS: number, kills: number, deaths: number, assists: number, netWorth: number): MatchTimelinePlayerSnapshot {
  return {
    schemaVersion: MATCH_TIMELINE_SCHEMA_VERSION,
    timelineVersion: MATCH_TIMELINE_VERSION,
    snapshotId: `${gameTimeS}`.padEnd(64, '0'),
    sourceEventId: `${gameTimeS}`.padEnd(64, '1'),
    matchId: 100,
    gameTimeS,
    tick: gameTimeS,
    steamId: '7656119',
    heroId: 15,
    teamId: 2,
    kills,
    deaths,
    assists,
    netWorth,
    heroDamage: netWorth * 2,
    receivedAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + gameTimeS * 1000).toISOString(),
  };
}""",
    """function createSnapshot(
  gameTimeS: number,
  kills: number,
  deaths: number,
  assists: number,
  netWorth: number,
  overrides: {
    steamId?: string;
    heroId?: number;
    teamId?: number;
  } = {},
): MatchTimelinePlayerSnapshot {
  const steamId = overrides.steamId ?? '7656119';
  const heroId = overrides.heroId ?? 15;
  const teamId = overrides.teamId ?? 2;
  const identity = `${gameTimeS}:${steamId}:${heroId}:${teamId}`;
  return {
    schemaVersion: MATCH_TIMELINE_SCHEMA_VERSION,
    timelineVersion: MATCH_TIMELINE_VERSION,
    snapshotId: createHash('sha256').update(`snapshot:${identity}`).digest('hex'),
    sourceEventId: createHash('sha256').update(`event:${identity}`).digest('hex'),
    matchId: 100,
    gameTimeS,
    tick: gameTimeS,
    steamId,
    heroId,
    teamId,
    kills,
    deaths,
    assists,
    netWorth,
    heroDamage: netWorth * 2,
    receivedAt: new Date(
      Date.parse('2026-01-01T00:00:00.000Z') + gameTimeS * 1000,
    ).toISOString(),
  };
}""",
)

replace_once(
    VALUE_TEST,
    """import { RecommendationValueV6TrainingService } from '../src/deadlock-live/recommendation-value-v6-training.service';""",
    """import {
  RecommendationValueV6TrainingService,
  prepareRecommendationValueV6Row,
} from '../src/deadlock-live/recommendation-value-v6-training.service';""",
)

replace_count(VALUE_TEST, "schemaVersion: 2,", "schemaVersion: 3,", 2)

replace_once(
    VALUE_TEST,
    """      playerTimelineSnapshot: {
        available: true,
        kills: 2,
        deaths: 1,
        assists: 3,
        netWorth: 5000,
      },
    },""",
    """      playerTimelineSnapshot: {
        available: true,
        kills: 2,
        deaths: 1,
        assists: 3,
        netWorth: 5000,
      },
      teamEconomy: {
        available: true,
        netWorthDelta: positive ? 5000 : -5000,
        relativeNetWorthDelta: positive ? 0.1 : -0.1,
        playerNetWorthShare: 0.25,
        playerNetWorthRankInTeam: positive ? 1 : 4,
      },
    },""",
)

replace_once(
    VALUE_TEST,
    """  async function writeSource(rows: Record<string, unknown>[]): Promise<string> {""",
    """  it('adds team-economy state and action interactions', () => {
    const prepared = prepareRecommendationValueV6Row(
      datasetRow(100, 'BUY:GOOD'),
      { finalOutcomeWeight: 0.25 },
    );

    expect(prepared?.stateKeys).toContain('TEAM_ECONOMY_BAND:15|AHEAD');
    expect(prepared?.stateKeys).toContain('PLAYER_TEAM_NET_WORTH_RANK:15|1');
    expect(
      prepared?.candidateActions.find(
        (candidate) => candidate.actionKey === 'BUY:GOOD',
      )?.actionKeys,
    ).toContain('HERO_TEAM_ECONOMY_ACTION:15|AHEAD|BUY:GOOD');
    expect(
      prepared?.candidateActions.find(
        (candidate) => candidate.actionKey === 'BUY:GOOD',
      )?.actionKeys,
    ).toContain('HERO_TEAM_ECONOMY_SLOT:15|AHEAD|vitality');
  });

  async function writeSource(rows: Record<string, unknown>[]): Promise<string> {""",
)

replace_once(
    DATASET_DOC,
    "`RECOMMENDATION_DECISION_DATASET_V5_2` enriches Recommendation Dataset V4 decisions with build trajectory, item catalog, recipe, and bounded post-decision outcomes.",
    "`RECOMMENDATION_DECISION_DATASET_V5_3` enriches Recommendation Dataset V4 decisions with build trajectory, item catalog, recipe, fresh team-economy state, and bounded post-decision outcomes.",
)

replace_once(
    DATASET_DOC,
    """- input state uses only a player snapshot at or before `t`;
- the 3, 5, and 10 minute targets use snapshots in `(t, t + horizon]` and require a snapshot no more than `snapshotStalenessS` before the exact horizon boundary;""",
    """- input state uses only player snapshots at or before `t`;
- team economy uses the latest fresh snapshot per player at or before `t`, split into the player's team and the opposing team;
- the 3, 5, and 10 minute targets use snapshots in `(t, t + horizon]` and require a snapshot no more than `snapshotStalenessS` before the exact horizon boundary;""",
)

replace_once(
    DATASET_DOC,
    "## Build",
    """## Team economy

Each row may include `stateBeforeAction.teamEconomy` with:

- own-team and enemy-team total, average, highest, and lowest net worth;
- absolute and relative team net-worth delta;
- the player's share of team net worth;
- the player's net-worth rank inside the team;
- fresh and stale snapshot counts plus team coverage diagnostics.

The feature is unavailable unless at least one fresh snapshot exists for both teams. Future snapshots are never used.

## Build""",
)

replace_count(VALUE_DOC, "Dataset V5.2", "Dataset V5.3", 2)
replace_once(
    VALUE_DOC,
    "- item, trajectory, inventory, matchup, and timeline state keys;",
    "- item, trajectory, inventory, matchup, timeline, and team-economy state keys;",
)
replace_once(
    VALUE_DOC,
    "- `datasetVersion` equals `RECOMMENDATION_DECISION_DATASET_V5_2`;",
    "- `datasetVersion` equals `RECOMMENDATION_DECISION_DATASET_V5_3`;",
)
replace_once(
    VALUE_DOC,
    "Future timeline values are targets only and are never state or action features.",
    """Future timeline values are targets only and are never state or action features.

Fresh decision-time team economy is used as context. Value V6 buckets relative team net-worth delta into `FAR_BEHIND`, `BEHIND`, `EVEN`, `AHEAD`, and `FAR_AHEAD`, and learns both state effects and economy-conditioned action/category effects.""",
)
