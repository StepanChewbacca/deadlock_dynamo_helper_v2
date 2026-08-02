import {
  assertNoUserLiveContamination,
  assertRecommendationArtifactSources,
  type RecommendationDataSourceCounts,
} from './recommendation-data-provenance';
import {
  DEFAULT_RECOMMENDATION_HISTORICAL_PRO_REPLAY_THRESHOLDS,
  RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION,
  RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION,
  type RecommendationHistoricalProReplayAudit,
  type RecommendationHistoricalProReplayRow,
  type RecommendationHistoricalProReplayThresholds,
} from './recommendation-historical-pro-replay';

export class RecommendationHistoricalProReplayAuditAccumulator {
  private readonly decisionIds = new Set<string>();
  private rowCount = 0;
  private duplicateDecisionIdCount = 0;
  private emptyCandidateSetCount = 0;
  private nonDeterministicCandidateOrderCount = 0;
  private snapshotLeakageCount = 0;
  private timelineRowCount = 0;
  private candidateCount = 0;
  private candidateWithMetadataCount = 0;
  private observedActionInCandidateSetCount = 0;
  private stateModelEligibleCount = 0;
  private behavioralModelEligibleCount = 0;
  private actionModelEligibleCount = 0;

  constructor(
    private readonly thresholds:
      RecommendationHistoricalProReplayThresholds =
        DEFAULT_RECOMMENDATION_HISTORICAL_PRO_REPLAY_THRESHOLDS,
  ) {
    validateThresholds(thresholds);
  }

  observe(row: RecommendationHistoricalProReplayRow): void {
    if (
      row.schemaVersion !==
        RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION ||
      row.replayVersion !== RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION ||
      row.dataSource !== 'PRO_HISTORICAL'
    ) {
      throw new Error('Invalid Recommendation Historical Pro Replay row.');
    }
    this.rowCount += 1;
    if (this.decisionIds.has(row.decisionId)) {
      this.duplicateDecisionIdCount += 1;
    }
    this.decisionIds.add(row.decisionId);
    this.emptyCandidateSetCount += row.candidates.length === 0 ? 1 : 0;
    this.nonDeterministicCandidateOrderCount +=
      isDeterministicCandidateOrder(row) ? 0 : 1;
    this.snapshotLeakageCount +=
      Date.parse(row.generatorSnapshot.trainingWindowEnd) <
      Date.parse(row.matchStartTime)
        ? 0
        : 1;
    const decisionTimelineJoined =
      row.timeline?.decisionSnapshotJoined ??
      row.shortHorizonOutcomes.some((outcome) => outcome.complete);
    this.timelineRowCount += decisionTimelineJoined ? 1 : 0;
    this.candidateCount += row.candidates.length;
    this.candidateWithMetadataCount += row.candidates.filter(
      (candidate) => candidate.catalogMetadataAvailable,
    ).length;
    this.observedActionInCandidateSetCount += row.observedAction.inCandidateSet
      ? 1
      : 0;
    this.stateModelEligibleCount += row.eligibility.stateModel ? 1 : 0;
    this.behavioralModelEligibleCount += row.eligibility.behavioralModel
      ? 1
      : 0;
    this.actionModelEligibleCount += row.eligibility.actionModel ? 1 : 0;
  }

  finalize(
    generatedAt = new Date().toISOString(),
  ): RecommendationHistoricalProReplayAudit {
    const sourceCounts: RecommendationDataSourceCounts = {
      PRO_HISTORICAL: this.rowCount,
      PRO_FUTURE_HOLDOUT: 0,
      USER_LIVE: 0,
    };
    assertNoUserLiveContamination({
      artifactName: 'Recommendation Historical Pro Replay',
      sourceCounts,
    });
    assertRecommendationArtifactSources({
      artifactName: 'Recommendation Historical Pro Replay',
      purpose: 'PRO_VALUE_TRAIN',
      sourceCounts,
    });

    const timelineCoverage = ratio(this.timelineRowCount, this.rowCount);
    const candidateMetadataCoverage = ratio(
      this.candidateWithMetadataCount,
      this.candidateCount,
    );
    const observedActionCandidateCoverage = ratio(
      this.observedActionInCandidateSetCount,
      this.rowCount,
    );
    const reasons: string[] = [];

    if (this.rowCount === 0) {
      reasons.push('Replay contains no rows.');
    }
    if (this.duplicateDecisionIdCount > 0) {
      reasons.push('Replay contains duplicate decision IDs.');
    }
    if (this.emptyCandidateSetCount > 0) {
      reasons.push('Replay contains empty candidate sets.');
    }
    if (this.nonDeterministicCandidateOrderCount > 0) {
      reasons.push('Replay contains non-deterministic candidate ordering.');
    }
    if (this.snapshotLeakageCount > 0) {
      reasons.push('A generator snapshot overlaps or follows a replay decision.');
    }
    if (timelineCoverage < this.thresholds.minimumTimelineCoverage) {
      reasons.push(
        `Timeline coverage ${timelineCoverage} is below ` +
          `${this.thresholds.minimumTimelineCoverage}.`,
      );
    }
    if (
      candidateMetadataCoverage <
      this.thresholds.minimumCandidateMetadataCoverage
    ) {
      reasons.push(
        `Candidate metadata coverage ${candidateMetadataCoverage} is below ` +
          `${this.thresholds.minimumCandidateMetadataCoverage}.`,
      );
    }
    if (
      observedActionCandidateCoverage <
      this.thresholds.minimumObservedActionCandidateCoverage
    ) {
      reasons.push(
        `Observed-action candidate coverage ` +
          `${observedActionCandidateCoverage} is below ` +
          `${this.thresholds.minimumObservedActionCandidateCoverage}.`,
      );
    }

    return {
      schemaVersion: RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION,
      replayVersion: RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION,
      generatedAt,
      passed: reasons.length === 0,
      rowCount: this.rowCount,
      sourceCounts,
      integrity: {
        duplicateDecisionIdCount: this.duplicateDecisionIdCount,
        emptyCandidateSetCount: this.emptyCandidateSetCount,
        nonDeterministicCandidateOrderCount:
          this.nonDeterministicCandidateOrderCount,
        observedActionInjectedCount: 0,
        snapshotLeakageCount: this.snapshotLeakageCount,
      },
      coverage: {
        timelineRowCount: this.timelineRowCount,
        timelineCoverage,
        candidateCount: this.candidateCount,
        candidateWithMetadataCount: this.candidateWithMetadataCount,
        candidateMetadataCoverage,
        observedActionInCandidateSetCount:
          this.observedActionInCandidateSetCount,
        observedActionCandidateCoverage,
        stateModelEligibleCount: this.stateModelEligibleCount,
        behavioralModelEligibleCount: this.behavioralModelEligibleCount,
        actionModelEligibleCount: this.actionModelEligibleCount,
      },
      thresholds: { ...this.thresholds },
      reasons,
    };
  }
}

function isDeterministicCandidateOrder(
  row: RecommendationHistoricalProReplayRow,
): boolean {
  const keys = new Set<string>();
  for (let index = 0; index < row.candidates.length; index += 1) {
    const candidate = row.candidates[index];
    if (candidate.rank !== index + 1 || keys.has(candidate.actionKey)) {
      return false;
    }
    keys.add(candidate.actionKey);
  }
  return true;
}

function validateThresholds(
  value: RecommendationHistoricalProReplayThresholds,
): void {
  for (const [name, threshold] of Object.entries(value)) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error(`${name} must be between zero and one.`);
    }
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
