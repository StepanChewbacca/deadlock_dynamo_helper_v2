import type {
  HeroBuildRecommendationAction,
  HeroBuildRecommendationResponse,
} from './hero-build-recommendation.service';

export const HERO_BUILD_DEFAULT_MIN_ALTERNATIVE_HISTORICAL_COUNT = 3;
export const HERO_BUILD_DEFAULT_MIN_ALTERNATIVE_CONFIDENCE = 0.01;
export const HERO_BUILD_MAX_MIN_ALTERNATIVE_HISTORICAL_COUNT = 1_000_000;

export interface HeroBuildAlternativeFilterOptions {
  limit: number;
  minHistoricalCount: number;
  minConfidence: number;
}

export interface HeroBuildAlternativeFilterSummary {
  minimumHistoricalCount: number;
  minimumConfidence: number;
  availableCount: number;
  returnedCount: number;
  filteredCount: number;
}

export type HeroBuildRecommendationWithAlternativeFilter = HeroBuildRecommendationResponse & {
  alternativeFilter: HeroBuildAlternativeFilterSummary;
};

export function filterHeroBuildRecommendationAlternatives(
  response: HeroBuildRecommendationResponse,
  options: HeroBuildAlternativeFilterOptions,
): HeroBuildRecommendationWithAlternativeFilter {
  const availableCount = response.alternatives.length;
  const maximumAlternativeCount = Math.max(0, options.limit - 1);
  const alternatives = response.alternatives
    .filter((action) => isAlternativeEligible(action, options))
    .slice(0, maximumAlternativeCount)
    .map((action) => ({ ...action }));

  return {
    ...response,
    action: { ...response.action },
    alternatives,
    alternativeFilter: {
      minimumHistoricalCount: options.minHistoricalCount,
      minimumConfidence: options.minConfidence,
      availableCount,
      returnedCount: alternatives.length,
      filteredCount: availableCount - alternatives.length,
    },
  };
}

function isAlternativeEligible(
  action: HeroBuildRecommendationAction,
  options: HeroBuildAlternativeFilterOptions,
): boolean {
  return (
    action.historicalCount >= options.minHistoricalCount &&
    action.confidence >= options.minConfidence
  );
}
