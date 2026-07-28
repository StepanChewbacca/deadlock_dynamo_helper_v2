import {
  DEFAULT_RECOMMENDATION_DATASET_V6_THRESHOLDS,
  RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION,
  RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
  type RecommendationDatasetV6Split,
  type RecommendationDatasetV6Thresholds,
  type RecommendationProDecisionDatasetV6Audit,
  type RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';

export class RecommendationProDecisionDatasetV6AuditAccumulator {
  private readonly decisionIds = new Set<string>();
  private readonly matchIds = new Set<string>();
  private readonly matchSplits = new Map<
    string,
    Set<RecommendationDatasetV6Split>
  >();
  private readonly splitMinimumTime = new Map<RecommendationDatasetV6Split, number>();
  private readonly splitMaximumTime = new Map<RecommendationDatasetV6Split, number>();
  private readonly splitDistribution: Record<RecommendationDatasetV6Split, number> = {
    TRAIN: 0,
    TUNING: 0,
    FUTURE_TEST: 0,
  };
  private readonly catalogVersionDistribution: Record<string, number> = {};
  private readonly candidateGeneratorVersionDistribution: Record<string, number> = {};
  private readonly decisionSourceDistribution = {
    HISTORICAL_REPLAY: 0,
    LIVE_LOG: 0,
  };
  private decisionCount = 0;
  private candidateRowCount = 0;
  private duplicateDecisionCount = 0;
  private timelineJoinCount = 0;
  private shortHorizonDecisionCount = 0;
  private candidateWithMetadataCount = 0;
  private observedActionInCandidateSetCount = 0;

  constructor(
    private readonly thresholds: RecommendationDatasetV6Thresholds =
      DEFAULT_RECOMMENDATION_DATASET_V6_THRESHOLDS,
  ) {
    validateThresholds(thresholds);
  }

  observe(row: RecommendationProDecisionDatasetV6Row): void {
    validateRow(row);
    this.decisionCount += 1;
    if (this.decisionIds.has(row.decisionId)) {
      this.duplicateDecisionCount += 1;
    }
    this.decisionIds.add(row.decisionId);
    this.matchIds.add(row.matchId);

    const matchSplits = this.matchSplits.get(row.matchId) ?? new Set();
    matchSplits.add(row.split);
    this.matchSplits.set(row.matchId, matchSplits);

    const matchTime = Date.parse(row.matchStartTime);
    const minimumTime = this.splitMinimumTime.get(row.split);
    const maximumTime = this.splitMaximumTime.get(row.split);
    this.splitMinimumTime.set(
      row.split,
      minimumTime === undefined ? matchTime : Math.min(minimumTime, matchTime),
    );
    this.splitMaximumTime.set(
      row.split,
      maximumTime === undefined ? matchTime : Math.max(maximumTime, matchTime),
    );

    this.splitDistribution[row.split] += 1;
    increment(this.catalogVersionDistribution, row.versions.catalog);
    increment(
      this.candidateGeneratorVersionDistribution,
      row.versions.candidateGenerator,
    );
    this.decisionSourceDistribution[row.decisionSource] += 1;
    this.timelineJoinCount += row.state.timelineJoined ? 1 : 0;
    this.shortHorizonDecisionCount += hasShortHorizonOutcome(row) ? 1 : 0;
    this.observedActionInCandidateSetCount += row.observedActionInCandidateSet
      ? 1
      : 0;
    this.candidateRowCount += row.candidates.length;
    this.candidateWithMetadataCount += row.candidates.filter(
      (candidate) => candidate.catalogMetadataAvailable,
    ).length;
  }

  finalize(generatedAt = new Date().toISOString()): RecommendationProDecisionDatasetV6Audit {
    const chronologicalSplitOverlapCount = [...this.matchSplits.values()].filter(
      (splits) => splits.size > 1,
    ).length;
    const chronologicalSplitOrderViolationCount = this.splitOrderViolationCount();
    const timelineJoinCoverage = ratio(
      this.timelineJoinCount,
      this.decisionCount,
    );
    const shortHorizonCoverage = ratio(
      this.shortHorizonDecisionCount,
      this.decisionCount,
    );
    const candidateMetadataCoverage = ratio(
      this.candidateWithMetadataCount,
      this.candidateRowCount,
    );
    const observedActionInCandidateSetCoverage = ratio(
      this.observedActionInCandidateSetCount,
      this.decisionCount,
    );
    const reasons: string[] = [];

    if (this.decisionCount === 0) {
      reasons.push('Dataset contains no decisions.');
    }
    if (this.duplicateDecisionCount > 0) {
      reasons.push('Dataset contains duplicate decision IDs.');
    }
    if (timelineJoinCoverage < this.thresholds.minimumTimelineJoinCoverage) {
      reasons.push(
        `Timeline join coverage ${timelineJoinCoverage} is below ` +
          `${this.thresholds.minimumTimelineJoinCoverage}.`,
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
      observedActionInCandidateSetCoverage <
      this.thresholds.minimumObservedActionCandidateCoverage
    ) {
      reasons.push(
        `Observed-action candidate coverage ` +
          `${observedActionInCandidateSetCoverage} is below ` +
          `${this.thresholds.minimumObservedActionCandidateCoverage}.`,
      );
    }
    if (chronologicalSplitOverlapCount > 0) {
      reasons.push('A match appears in more than one chronological split.');
    }
    if (chronologicalSplitOrderViolationCount > 0) {
      reasons.push('Chronological split time ranges overlap or are out of order.');
    }

    return {
      schemaVersion: RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION,
      datasetVersion: RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
      generatedAt,
      passed: reasons.length === 0,
      decisionCount: this.decisionCount,
      matchCount: this.matchIds.size,
      candidateRowCount: this.candidateRowCount,
      duplicateDecisionCount: this.duplicateDecisionCount,
      timelineJoinCount: this.timelineJoinCount,
      timelineJoinCoverage,
      shortHorizonDecisionCount: this.shortHorizonDecisionCount,
      shortHorizonCoverage,
      candidateWithMetadataCount: this.candidateWithMetadataCount,
      candidateMetadataCoverage,
      observedActionInCandidateSetCount:
        this.observedActionInCandidateSetCount,
      observedActionInCandidateSetCoverage,
      chronologicalSplitOverlapCount,
      chronologicalSplitOrderViolationCount,
      splitDistribution: { ...this.splitDistribution },
      catalogVersionDistribution: sortRecord(
        this.catalogVersionDistribution,
      ),
      candidateGeneratorVersionDistribution: sortRecord(
        this.candidateGeneratorVersionDistribution,
      ),
      decisionSourceDistribution: { ...this.decisionSourceDistribution },
      thresholds: { ...this.thresholds },
      reasons,
    };
  }

  private splitOrderViolationCount(): number {
    let count = 0;
    const trainMax = this.splitMaximumTime.get('TRAIN');
    const tuningMin = this.splitMinimumTime.get('TUNING');
    const tuningMax = this.splitMaximumTime.get('TUNING');
    const futureTestMin = this.splitMinimumTime.get('FUTURE_TEST');
    if (trainMax !== undefined && tuningMin !== undefined && trainMax >= tuningMin) {
      count += 1;
    }
    if (
      tuningMax !== undefined &&
      futureTestMin !== undefined &&
      tuningMax >= futureTestMin
    ) {
      count += 1;
    }
    return count;
  }
}

function validateRow(row: RecommendationProDecisionDatasetV6Row): void {
  if (
    row.schemaVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION ||
    row.datasetVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION
  ) {
    throw new Error('Unsupported Recommendation Dataset V6 row.');
  }
  if (row.dataSource !== 'PRO_HISTORICAL') {
    throw new Error('Recommendation Dataset V6 contains a non-pro source.');
  }
  if (!Number.isFinite(Date.parse(row.matchStartTime))) {
    throw new Error('Recommendation Dataset V6 contains an invalid match time.');
  }
}

function validateThresholds(thresholds: RecommendationDatasetV6Thresholds): void {
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${name} must be between 0 and 1.`);
    }
  }
}

function hasShortHorizonOutcome(
  row: RecommendationProDecisionDatasetV6Row,
): boolean {
  return (
    row.shortHorizonOutcomes.threeMinutes !== undefined ||
    row.shortHorizonOutcomes.fiveMinutes !== undefined ||
    row.shortHorizonOutcomes.tenMinutes !== undefined
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}
