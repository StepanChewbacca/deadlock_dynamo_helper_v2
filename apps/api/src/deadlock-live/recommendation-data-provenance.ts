export type RecommendationDataSource =
  | 'PRO_HISTORICAL'
  | 'PRO_LIVE'
  | 'USER_LIVE';

export type RecommendationDatasetPurpose =
  | 'PRO_BEHAVIOR_TRAIN'
  | 'PRO_VALUE_TRAIN'
  | 'PRO_MODEL_SELECTION'
  | 'PRO_TEST'
  | 'PRO_OPE'
  | 'USER_RUNTIME_EVALUATION';

export interface RecommendationDatasetEligibility {
  eligibleForProBehaviorTraining: boolean;
  eligibleForProValueTraining: boolean;
  eligibleForProModelSelection: boolean;
  eligibleForProTest: boolean;
  eligibleForProOpe: boolean;
  eligibleForRuntimeEvaluation: boolean;
}

const PRO_SOURCES = new Set<RecommendationDataSource>([
  'PRO_HISTORICAL',
  'PRO_LIVE',
]);

const ELIGIBILITY_BY_SOURCE: Record<
  RecommendationDataSource,
  RecommendationDatasetEligibility
> = {
  PRO_HISTORICAL: {
    eligibleForProBehaviorTraining: true,
    eligibleForProValueTraining: true,
    eligibleForProModelSelection: true,
    eligibleForProTest: true,
    eligibleForProOpe: true,
    eligibleForRuntimeEvaluation: false,
  },
  PRO_LIVE: {
    eligibleForProBehaviorTraining: true,
    eligibleForProValueTraining: true,
    eligibleForProModelSelection: true,
    eligibleForProTest: true,
    eligibleForProOpe: true,
    eligibleForRuntimeEvaluation: false,
  },
  USER_LIVE: {
    eligibleForProBehaviorTraining: false,
    eligibleForProValueTraining: false,
    eligibleForProModelSelection: false,
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
    value === 'PRO_LIVE' ||
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
  const allowed =
    purpose === 'PRO_BEHAVIOR_TRAIN'
      ? eligibility.eligibleForProBehaviorTraining
      : purpose === 'PRO_VALUE_TRAIN'
        ? eligibility.eligibleForProValueTraining
        : purpose === 'PRO_MODEL_SELECTION'
          ? eligibility.eligibleForProModelSelection
          : purpose === 'PRO_TEST'
            ? eligibility.eligibleForProTest
            : purpose === 'PRO_OPE'
              ? eligibility.eligibleForProOpe
              : eligibility.eligibleForRuntimeEvaluation;

  if (!allowed) {
    throw new Error(
      `Recommendation source ${source} is not eligible for ${purpose}.`,
    );
  }
}

export function assertNoUserLiveContamination(input: {
  sourceCounts: Partial<Record<RecommendationDataSource, number>>;
  artifactName: string;
}): void {
  const userLiveCount = input.sourceCounts.USER_LIVE ?? 0;
  if (userLiveCount > 0) {
    throw new Error(
      `${input.artifactName} contains ${userLiveCount} USER_LIVE rows. ` +
        'User runtime data must never enter a pro-model artifact.',
    );
  }
}

export function resolveTrustedRecommendationDataSource(input: {
  ingestionKind: 'HISTORICAL_PRO_CRAWLER' | 'LIVE_PRO_CRAWLER' | 'LOCAL_CLIENT';
}): RecommendationDataSource {
  if (input.ingestionKind === 'HISTORICAL_PRO_CRAWLER') {
    return 'PRO_HISTORICAL';
  }
  if (input.ingestionKind === 'LIVE_PRO_CRAWLER') {
    return 'PRO_LIVE';
  }
  return 'USER_LIVE';
}
