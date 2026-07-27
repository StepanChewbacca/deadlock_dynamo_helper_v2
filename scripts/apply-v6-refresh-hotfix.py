#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one occurrence, found {count}: {old!r}')
    file_path.write_text(source.replace(old, new, 1))


replace_once(
    'apps/api/src/deadlock-live/hero-build-transition-aggregation.service.ts',
    '  async ensureReady(): Promise<void> {\n',
    '  async ensureReady(_heroId?: number): Promise<void> {\n',
)

replace_once(
    'apps/api/src/deadlock-live/hero-build-recommendation.service.ts',
    '    await this.heroBuildTransitionAggregationService.ensureReady();\n',
    '    await this.heroBuildTransitionAggregationService.ensureReady(request.heroId);\n',
)

replace_once(
    'apps/api/src/deadlock-live/deadlock-live.module.ts',
    '      provide: HeroBuildTransitionAggregationService,\n      useExisting: LazyBuildTransitionAggregationService,\n',
    '      provide: HeroBuildTransitionAggregationService,\n      useExisting: LiveHeroBuildPolicyService,\n',
)

replace_once(
    'apps/api/src/deadlock-live/live-hero-build-policy.service.ts',
    '  RECENT_MATCH_QUERY_BATCH_SIZE,\n  RECENT_MATCH_TARGET_COUNT,\n  RecentMatchSnapshot,\n',
    '  RECENT_MATCH_QUERY_BATCH_SIZE,\n  RecentMatchSnapshot,\n',
)

replace_once(
    'apps/api/src/deadlock-live/live-hero-build-policy.service.ts',
    'const LIVE_HERO_POLICY_TTL_MS = 5 * 60_000;\nconst LIVE_HERO_POLICY_YIELD_INTERVAL = 25;\n',
    'const LIVE_HERO_POLICY_TTL_MS = 5 * 60_000;\nconst LIVE_HERO_POLICY_TARGET_PLAYER_COUNT = 5_000;\nconst LIVE_HERO_POLICY_YIELD_INTERVAL = 25;\n',
)

replace_once(
    'apps/api/src/deadlock-live/live-hero-build-policy.service.ts',
    '        .take(RECENT_MATCH_TARGET_COUNT)\n',
    '        .take(LIVE_HERO_POLICY_TARGET_PLAYER_COUNT)\n',
)

replace_once(
    'apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts',
    'export const LIVE_BUILD_RECOMMENDATION_MAX_TRACKED_MATCHES = 32;\n',
    'export const LIVE_BUILD_RECOMMENDATION_MAX_TRACKED_MATCHES = 32;\nexport const LIVE_BUILD_RECOMMENDATION_TIMEOUT_MS = 30_000;\n',
)

replace_once(
    'apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts',
    '        const recommendation = await this.heroBuildRecommendationService.recommend(\n          recommendationRequest,\n        );\n',
    '        const recommendation = await withTimeout(\n          this.heroBuildRecommendationService.recommend(recommendationRequest),\n          LIVE_BUILD_RECOMMENDATION_TIMEOUT_MS,\n        );\n',
)

replace_once(
    'apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts',
    '        this.logger.warn(\n          `Live build recommendation traversal failed for match ${input.matchId}: ${message}`,\n        );\n',
    '        if (message === createRecommendationTimeoutMessage()) {\n          runtime.desiredInput = undefined;\n          runtime.lastAttemptedKey = undefined;\n        }\n        this.logger.warn(\n          `Live build recommendation traversal failed for match ${input.matchId}: ${message}`,\n        );\n',
)

replace_once(
    'apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts',
    '\n\nfunction sameNumberArrays(left: readonly number[], right: readonly number[]): boolean {\n',
    '''\n\nfunction createRecommendationTimeoutMessage(): string {\n  return `Recommendation Value V6 candidate generation timed out after ${LIVE_BUILD_RECOMMENDATION_TIMEOUT_MS} ms.`;\n}\n\nfunction withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {\n  return new Promise<T>((resolve, reject) => {\n    const timer = setTimeout(() => {\n      reject(new Error(createRecommendationTimeoutMessage()));\n    }, timeoutMs);\n\n    promise.then(\n      (value) => {\n        clearTimeout(timer);\n        resolve(value);\n      },\n      (error: unknown) => {\n        clearTimeout(timer);\n        reject(error);\n      },\n    );\n  });\n}\n\nfunction sameNumberArrays(left: readonly number[], right: readonly number[]): boolean {\n''',
)
