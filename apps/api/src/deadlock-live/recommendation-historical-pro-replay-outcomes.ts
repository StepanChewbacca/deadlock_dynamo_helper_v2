import type { HeroBuildDecisionDatasetV3Row } from './hero-build-decision-dataset-v3.service';
import type {
  MatchTimelineObjectiveEvent,
  MatchTimelinePlayerSnapshot,
} from './match-timeline-collector.service';
import type { RecommendationHistoricalShortHorizonOutcome } from './recommendation-historical-pro-replay';

export const RECOMMENDATION_SHORT_HORIZON_SNAPSHOT_STALENESS_S = 120;

const HORIZONS = [
  { horizon: '3m' as const, seconds: 180 },
  { horizon: '5m' as const, seconds: 300 },
  { horizon: '10m' as const, seconds: 600 },
];

export interface RecommendationHistoricalOutcomeDeltas {
  killsDelta: number;
  deathsDelta: number;
  assistsDelta: number;
  netWorthDelta: number;
  heroDamageDelta: number;
  enemyObjectiveLossCount: number;
  ownObjectiveLossCount: number;
  survived: boolean;
}

export function buildRecommendationHistoricalShortHorizonOutcomes(input: {
  decision: HeroBuildDecisionDatasetV3Row;
  snapshots: readonly MatchTimelinePlayerSnapshot[];
  objectives: readonly MatchTimelineObjectiveEvent[];
  snapshotStalenessS?: number;
}): RecommendationHistoricalShortHorizonOutcome[] {
  const snapshotStalenessS =
    input.snapshotStalenessS ??
    RECOMMENDATION_SHORT_HORIZON_SNAPSHOT_STALENESS_S;
  if (
    !Number.isFinite(snapshotStalenessS) ||
    snapshotStalenessS < 0 ||
    snapshotStalenessS > 3_600
  ) {
    throw new Error('snapshotStalenessS must be between 0 and 3600.');
  }

  const playerSnapshots = selectDecisionPlayerSnapshots(
    input.decision,
    input.snapshots,
  );
  const baseline = latestAtOrBefore(
    playerSnapshots,
    input.decision.gameTimeS,
  );
  const ownTeamId = liveTeam(input.decision.team);

  return HORIZONS.map(({ horizon, seconds }) => {
    const upper = input.decision.gameTimeS + seconds;
    const target = latestInWindow(
      playerSnapshots,
      input.decision.gameTimeS,
      upper,
    );
    const baselineFresh =
      baseline !== undefined &&
      input.decision.gameTimeS - baseline.gameTimeS <= snapshotStalenessS;
    const targetFresh =
      target !== undefined && upper - target.gameTimeS <= snapshotStalenessS;

    if (!baseline || !target || !baselineFresh || !targetFresh) {
      return {
        horizon,
        complete: false,
        snapshotGameTimeS: target?.gameTimeS,
      };
    }

    const events = input.objectives.filter(
      (event) =>
        event.matchId === input.decision.matchId &&
        event.gameTimeS > input.decision.gameTimeS &&
        event.gameTimeS <= upper,
    );
    const ownObjectiveLossCount =
      ownTeamId === undefined
        ? 0
        : events.filter((event) => event.teamId === ownTeamId).length;
    const enemyObjectiveLossCount =
      ownTeamId === undefined
        ? 0
        : events.filter(
            (event) =>
              event.teamId !== undefined && event.teamId !== ownTeamId,
          ).length;
    const deltas: RecommendationHistoricalOutcomeDeltas = {
      killsDelta: target.kills - baseline.kills,
      deathsDelta: target.deaths - baseline.deaths,
      assistsDelta: target.assists - baseline.assists,
      netWorthDelta: target.netWorth - baseline.netWorth,
      heroDamageDelta: target.heroDamage - baseline.heroDamage,
      enemyObjectiveLossCount,
      ownObjectiveLossCount,
      survived: target.deaths === baseline.deaths,
    };
    return {
      horizon,
      complete: true,
      utility: recommendationShortHorizonUtility(deltas),
      snapshotGameTimeS: target.gameTimeS,
    };
  });
}

export function recommendationShortHorizonUtility(
  deltas: RecommendationHistoricalOutcomeDeltas,
): number {
  const killParticipationDelta =
    deltas.killsDelta + deltas.assistsDelta;
  return clamp(
    deltas.killsDelta * 0.12 +
      deltas.assistsDelta * 0.05 +
      killParticipationDelta * 0.04 -
      deltas.deathsDelta * 0.18 +
      deltas.netWorthDelta / 10_000 +
      deltas.heroDamageDelta / 25_000 +
      deltas.enemyObjectiveLossCount * 0.12 -
      deltas.ownObjectiveLossCount * 0.12 +
      (deltas.survived ? 0.05 : 0),
    -1,
    1,
  );
}

function selectDecisionPlayerSnapshots(
  decision: HeroBuildDecisionDatasetV3Row,
  snapshots: readonly MatchTimelinePlayerSnapshot[],
): MatchTimelinePlayerSnapshot[] {
  const matchSnapshots = snapshots.filter(
    (snapshot) => snapshot.matchId === decision.matchId,
  );
  const playerId = String(decision.playerId);
  const exact = matchSnapshots.filter(
    (snapshot) => snapshot.steamId === playerId,
  );
  const result =
    exact.length > 0
      ? exact
      : matchSnapshots.filter(
          (snapshot) =>
            snapshot.heroId === decision.heroId &&
            (liveTeam(decision.team) === undefined ||
              snapshot.teamId === liveTeam(decision.team)),
        );
  return [...result].sort(compareSnapshots);
}

function latestAtOrBefore(
  snapshots: readonly MatchTimelinePlayerSnapshot[],
  gameTimeS: number,
): MatchTimelinePlayerSnapshot | undefined {
  let result: MatchTimelinePlayerSnapshot | undefined;
  for (const snapshot of snapshots) {
    if (snapshot.gameTimeS > gameTimeS) {
      break;
    }
    result = snapshot;
  }
  return result;
}

function latestInWindow(
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
}

function compareSnapshots(
  left: MatchTimelinePlayerSnapshot,
  right: MatchTimelinePlayerSnapshot,
): number {
  return (
    left.gameTimeS - right.gameTimeS ||
    left.tick - right.tick ||
    left.snapshotId.localeCompare(right.snapshotId)
  );
}

function liveTeam(team: number): number | undefined {
  if (team === 0) {
    return 2;
  }
  if (team === 1) {
    return 3;
  }
  return Number.isSafeInteger(team) && team > 0 ? team : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
