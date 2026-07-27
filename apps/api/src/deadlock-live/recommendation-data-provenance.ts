export type RecommendationDataSource =
  | 'PRO_HISTORICAL'
  | 'PRO_FUTURE_HOLDOUT'
  | 'USER_LIVE';

export type RecommendationDatasetPurpose =
  | 'PRO_BEHAVIOR_TRAIN'
  | 'PRO_VALUE_TRAIN'
  | 'PRO_MODEL_SELECTION'
  | 'PRO_CALIBRATION'
  | 'PRO_TEST'
  | 'PRO_OPE'
  | 'USER_RUNTIME_EVALUATION';

export interface RecommendationDatasetEligibility {
  eligibleForProBehaviorTraining: boolean;
  eligibleForProValueTraining: boolean;
  eligibleForProModelSelection: boolean;
  eligibleForProCalibration: boolean;
  eligibleForProTest: boolean;
  eligibleForProOpe: boolean;
  eligibleForRuntimeEvaluation: boolean;
}

export type RecommendationDataSourceCounts = Partial<
  Record<RecommendationDataSource, number>
>;

export type TrustedRecommendationIngestionKind =
  | 'HISTORICAL_PRO_CRAWLER'
  | 'FUTURE_PRO_HOLDOUT_CRAWLER'
  | 'LOCAL_CLIENT';

const PRO_SOURCES = new Set<RecommendationDataSource>([
  'PRO_HISTORICAL',
  'PRO_FUTURE_HOLDOUT',
]);

const ELIGIBILITY_BY_SOURCE: Readonly<
  Record<RecommendationDataSource, RecommendationDatasetEligibility>
> = {
  PRO_HISTORICAL: {
    eligibleForProBehaviorTraining: true,
    eligibleForProValueTraining: true,
    eligibleForProModelSelection: true,
    eligibleForProCalibration: true,
    eligibleForProTest: false,
    eligibleForProOpe: true,
    eligibleForRuntimeEvaluation: false,
  },
  PRO_FUTURE_HOLDOUT: {
    eligibleForProBehaviorTraining: false,
    eligibleForProValueTraining: false,
    eligibleForProModelSelection: false,
    eligibleForProCalibration: false,
    eligibleForProTest: true,
    eligibleForProOpe: true,
    eligibleForRuntimeEvaluation: false,
  },
  USER_LIVE: {
    eligibleForProBehaviorTraining: false,
    eligibleForProValueTraining: false,
    eligibleForProModelSelection: false,
    eligibleForProCalibration: false,
    eligibleForProTest: false,
    eligibleForProOpe: false,
    eligibleForRuntimeEvaluation: true,
  },
};

export function parseRecommendationDataSource(
  value: unknown,
): RecommendationDataSource {
  if (
    value === 'PRO_HISTORICAL' ||
    value === 'PRO_FUTURE_HOLDOUT' ||
    value === 'USER_LIVE'
  ) {
    return value;
  }
  throw new Error(`Unsupported recommendation data source: ${String(value)}`);
}

export function recommendationEligibilityForSource(
  source: RecommendationDataSource,
): RecommendationDatasetEligibility {
  return { ...ELIGIBILITY_BY_SOURCE[source] };
}

export function isProRecommendationDataSource(
  source: RecommendationDataSource,
): boolean {
  return PRO_SOURCES.has(source);
}

export function assertRecommendationSourceEligible(
  source: RecommendationDataSource,
  purpose: RecommendationDatasetPurpose,
): void {
  const eligibility = ELIGIBILITY_BY_SOURCE[source];
  const allowed = eligibilityForPurpose(eligibility, purpose);

  if (!allowed) {
    throw new Error(
      `Recommendation source ${source} is not eligible for ${purpose}.`,
    );
  }
}

export function assertRecommendationArtifactSources(input: {
  sourceCounts: RecommendationDataSourceCounts;
  artifactName: string;
  purpose: RecommendationDatasetPurpose;
}): void {
  assertNonNegativeSourceCounts(input.sourceCounts, input.artifactName);

  for (const source of allRecommendationDataSources()) {
    const rowCount = input.sourceCounts[source] ?? 0;
    if (rowCount <= 0) {
      continue;
    }
    try {
      assertRecommendationSourceEligible(source, input.purpose);
    } catch {
      throw new Error(
        `${input.artifactName} contains ${rowCount} ${source} rows that are ` +
          `not eligible for ${input.purpose}.`,
      );
    }
  }
}

export function assertNoUserLiveContamination(input: {
  sourceCounts: RecommendationDataSourceCounts;
  artifactName: string;
}): void {
  assertNonNegativeSourceCounts(input.sourceCounts, input.artifactName);
  const userLiveCount = input.sourceCounts.USER_LIVE ?? 0;
  if (userLiveCount > 0) {
    throw new Error(
      `${input.artifactName} contains ${userLiveCount} USER_LIVE rows. ` +
        'User runtime data must never enter a pro-model artifact.',
    );
  }
}

export function resolveTrustedRecommendationDataSource(input: {
  ingestionKind: TrustedRecommendationIngestionKind;
}): RecommendationDataSource {
  if (input.ingestionKind === 'HISTORICAL_PRO_CRAWLER') {
    return 'PRO_HISTORICAL';
  }
  if (input.ingestionKind === 'FUTURE_PRO_HOLDOUT_CRAWLER') {
    return 'PRO_FUTURE_HOLDOUT';
  }
  return 'USER_LIVE';
}

export function allRecommendationDataSources(): RecommendationDataSource[] {
  return ['PRO_HISTORICAL', 'PRO_FUTURE_HOLDOUT', 'USER_LIVE'];
}

function eligibilityForPurpose(
  eligibility: RecommendationDatasetEligibility,
  purpose: RecommendationDatasetPurpose,
): boolean {
  if (purpose === 'PRO_BEHAVIOR_TRAIN') {
    return eligibility.eligibleForProBehaviorTraining;
  }
  if (purpose === 'PRO_VALUE_TRAIN') {
    return eligibility.eligibleForProValueTraining;
  }
  if (purpose === 'PRO_MODEL_SELECTION') {
    return eligibility.eligibleForProModelSelection;
  }
  if (purpose === 'PRO_CALIBRATION') {
    return eligibility.eligibleForProCalibration;
  }
  if (purpose === 'PRO_TEST') {
    return eligibility.eligibleForProTest;
  }
  if (purpose === 'PRO_OPE') {
    return eligibility.eligibleForProOpe;
  }
  return eligibility.eligibleForRuntimeEvaluation;
}

function assertNonNegativeSourceCounts(
  sourceCounts: RecommendationDataSourceCounts,
  artifactName: string,
): void {
  for (const source of allRecommendationDataSources()) {
    const rowCount = sourceCounts[source] ?? 0;
    if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
      throw new Error(
        `${artifactName} has invalid ${source} row count: ${String(rowCount)}.`,
      );
    }
  }
}
