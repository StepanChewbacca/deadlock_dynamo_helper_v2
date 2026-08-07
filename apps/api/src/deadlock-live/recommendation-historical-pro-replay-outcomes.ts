import type { HeroBuildDecisionDatasetV3Row } from './hero-build-decision-dataset-v3.service';
import type {
  MatchTimelineObjectiveEvent,
  MatchTimelinePlayerSnapshot,
} from './match-timeline-collector.service';
import type { RecommendationHistoricalShortHorizonOutcome } from './recommendation-historical-pro-replay';

export const RECOMMENDATION_SHORT_HORIZON_SNAPSHOT_STALENESS_S = 300;

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
  matchEndGameTimeS?: number;
  snapshotStalenessS?: number;
}): RecommendationHistoricalShortHorizonOutcome[] {
  const snapshotStalenessS = normalizeSnapshotStaleness(
    input.snapshotStalenessS,
  );
  const playerSnapshots = selectDecisionPlayerSnapshots(
    input.decision,
    input.snapshots,
  );
  const baseline = selectSnapshotAroundDecision(
    playerSnapshots,
    input.decision.gameTimeS,
    snapshotStalenessS,
  );
  const ownTeamId = liveTeam(input.decision.team);
  const matchEndGameTimeS = normalizeMatchEndGameTimeS(
    input.matchEndGameTimeS,
    input.decision.gameTimeS,
  );

  return HORIZONS.map(({ horizon, seconds }) => {
    const upper = input.decision.gameTimeS + seconds;
    if (
      matchEndGameTimeS !== undefined &&
      matchEndGameTimeS <= upper
    ) {
      return {
        horizon,
        complete: true,
        utility: input.decision.outcomeLabel.playerWon ? 1 : -1,
        outcomeSource: 'TERMINAL_FINAL_OUTCOME',
        terminalGameTimeS: matchEndGameTimeS,
      };
    }

    const target = nearestToHorizonAfterBaseline(
      playerSnapshots,
      input.decision.gameTimeS,
      upper,
      snapshotStalenessS,
      baseline?.gameTimeS,
    );
    const baselineFresh =
      baseline !== undefined &&
      Math.abs(input.decision.gameTimeS - baseline.gameTimeS) <=
        snapshotStalenessS;
    const targetFresh =
      target !== undefined &&
      Math.abs(upper - target.gameTimeS) <= snapshotStalenessS;

    if (!baseline || !target || !baselineFresh || !targetFresh) {
      return {
        horizon,
        complete: false,
        snapshotGameTimeS: target?.gameTimeS,
      };
    }

    const effectiveBaselineGameTimeS = Math.max(
      input.decision.gameTimeS,
      baseline.gameTimeS,
    );
    const events = input.objectives.filter(
      (event) =>
        event.matchId === input.decision.matchId &&
        event.gameTimeS > effectiveBaselineGameTimeS &&
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
      outcomeSource: 'TIMELINE_SNAPSHOT',
      snapshotGameTimeS: target.gameTimeS,
    };
  });
}

export function hasFreshRecommendationDecisionTimelineSnapshot(input: {
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
  const selected = selectSnapshotAroundDecision(
    playerSnapshots,
    input.gameTimeS,
    snapshotStalenessS,
  );
  return selected ? { ...selected } : undefined;
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
  decision: Pick<HeroBuildDecisionDatasetV3Row, 'matchId' | 'heroId' | 'team'>,
  snapshots: readonly MatchTimelinePlayerSnapshot[],
): MatchTimelinePlayerSnapshot[] {
  const matchSnapshots = snapshots.filter(
    (snapshot) => snapshot.matchId === decision.matchId,
  );
  const expectedTeamId = liveTeam(decision.team);
  const exact = matchSnapshots.filter(
    (snapshot) =>
      snapshot.heroId === decision.heroId &&
      (expectedTeamId === undefined || snapshot.teamId === expectedTeamId),
  );
  const result =
    exact.length > 0
      ? exact
      : matchSnapshots.filter(
          (snapshot) => snapshot.heroId === decision.heroId,
        );
  return [...result].sort(compareSnapshots);
}

function selectSnapshotAroundDecision(
  snapshots: readonly MatchTimelinePlayerSnapshot[],
  gameTimeS: number,
  snapshotStalenessS: number,
): MatchTimelinePlayerSnapshot | undefined {
  const baseline = latestAtOrBefore(snapshots, gameTimeS);
  if (
    baseline !== undefined &&
    gameTimeS - baseline.gameTimeS <= snapshotStalenessS
  ) {
    return baseline;
  }
  const future = earliestAfter(snapshots, gameTimeS);
  if (
    future !== undefined &&
    future.gameTimeS - gameTimeS <= snapshotStalenessS
  ) {
    return future;
  }
  return undefined;
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

function earliestAfter(
  snapshots: readonly MatchTimelinePlayerSnapshot[],
  gameTimeS: number,
): MatchTimelinePlayerSnapshot | undefined {
  return snapshots.find((snapshot) => snapshot.gameTimeS > gameTimeS);
}

function nearestToHorizonAfterBaseline(
  snapshots: readonly MatchTimelinePlayerSnapshot[],
  decisionGameTimeS: number,
  horizonGameTimeS: number,
  snapshotStalenessS: number,
  baselineGameTimeS?: number,
): MatchTimelinePlayerSnapshot | undefined {
  let result: MatchTimelinePlayerSnapshot | undefined;
  let resultDistance = Number.POSITIVE_INFINITY;
  const lowerExclusive = Math.max(
    decisionGameTimeS,
    baselineGameTimeS ?? decisionGameTimeS,
  );
  const latestAllowed = horizonGameTimeS + snapshotStalenessS;
  for (const snapshot of snapshots) {
    if (snapshot.gameTimeS <= lowerExclusive) {
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

function normalizeMatchEndGameTimeS(
  value: number | undefined,
  decisionGameTimeS: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < decisionGameTimeS) {
    return undefined;
  }
  return value;
}

function normalizeSnapshotStaleness(value: number | undefined): number {
  const result =
    value ?? RECOMMENDATION_SHORT_HORIZON_SNAPSHOT_STALENESS_S;
  if (!Number.isFinite(result) || result < 0 || result > 3_600) {
    throw new Error('snapshotStalenessS must be between 0 and 3600.');
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
