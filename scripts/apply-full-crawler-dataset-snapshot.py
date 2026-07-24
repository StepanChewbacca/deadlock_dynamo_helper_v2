from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one occurrence in {path}, found {count}: {old[:80]!r}")
    file_path.write_text(text.replace(old, new, 1))


service = "apps/api/src/deadlock-live/hero-build-decision-dataset-v3.service.ts"
loader = "apps/api/src/deadlock-live/hero-build-offline-evaluation-data-loader.service.ts"
controller = "apps/api/src/deadlock-live/hero-build-decision-dataset-v3.controller.ts"

replace_once(
    service,
    "export const HERO_BUILD_DECISION_DATASET_V3_DEFAULT_MAX_MATCHES = 13_000;\nexport const HERO_BUILD_DECISION_DATASET_V3_MAX_MATCHES = 13_000;",
    "export const HERO_BUILD_DECISION_DATASET_V3_MAX_MATCHES = 1_000_000;",
)
replace_once(
    service,
    "export interface HeroBuildDecisionDatasetV3Options {\n  maxMatches: number;",
    "export interface HeroBuildDecisionDatasetV3Options {\n  maxMatches?: number;",
)
replace_once(
    service,
    "  source: {\n    selectedMatchCount: number;\n    matchCountWithRows: number;",
    "  source: {\n    totalAvailableMatchCount: number;\n    selectedMatchCount: number;\n    excludedByLimitMatchCount: number;\n    snapshotCrawledAt?: string;\n    matchCountWithRows: number;",
)
replace_once(
    service,
    "  source: {\n    selectedMatchCount: number;\n    selectedWindowStartTime: string;",
    "  source: {\n    totalAvailableMatchCount: number;\n    selectedMatchCount: number;\n    excludedByLimitMatchCount: number;\n    snapshotCrawledAt?: string;\n    selectedWindowStartTime: string;",
)
replace_once(
    service,
    "  sourceWindowLastRefreshedAt?: string;\n  descriptors: PersistedDescriptor[];",
    "  sourceWindowLastRefreshedAt?: string;\n  sourceSnapshotCrawledAt?: string;\n  totalAvailableMatchCount: number;\n  descriptors: PersistedDescriptor[];",
)
replace_once(
    service,
    "      sourceWindowLastRefreshedAt:\n        loaded.sourceLastRefreshedAt?.toISOString(),\n      descriptors,",
    "      sourceWindowLastRefreshedAt:\n        loaded.sourceLastRefreshedAt?.toISOString(),\n      sourceSnapshotCrawledAt:\n        loaded.sourceSnapshotCrawledAt?.toISOString(),\n      totalAvailableMatchCount: loaded.totalAvailableMatchCount,\n      descriptors,",
)
replace_once(
    service,
    "  const warnings = [\n    'Candidate sets are intentionally not materialized in this extraction stage.',\n    'Build archetypes are intentionally not assigned; buildPrefixKey is observed history, not an archetype label.',\n  ];",
    "  const warnings = [\n    'Candidate sets are intentionally not materialized in this extraction stage.',\n    'Build archetypes are intentionally not assigned; buildPrefixKey is observed history, not an archetype label.',\n  ];\n  if (checkpoint.descriptors.length < checkpoint.totalAvailableMatchCount) {\n    warnings.push(\n      `${checkpoint.totalAvailableMatchCount - checkpoint.descriptors.length} matches were excluded by the explicit maxMatches request.`,\n    );\n  }",
)
replace_once(
    service,
    "    source: {\n      selectedMatchCount: state.selectedMatchCount,\n      matchCountWithRows: state.matchIdsWithRows.length,",
    "    source: {\n      totalAvailableMatchCount: checkpoint.totalAvailableMatchCount,\n      selectedMatchCount: state.selectedMatchCount,\n      excludedByLimitMatchCount: Math.max(\n        0,\n        checkpoint.totalAvailableMatchCount - checkpoint.descriptors.length,\n      ),\n      snapshotCrawledAt: checkpoint.sourceSnapshotCrawledAt,\n      matchCountWithRows: state.matchIdsWithRows.length,",
)
replace_once(
    service,
    "    source: {\n      selectedMatchCount: checkpoint.descriptors.length,\n      selectedWindowStartTime: checkpoint.descriptors[0].startTime,",
    "    source: {\n      totalAvailableMatchCount: checkpoint.totalAvailableMatchCount,\n      selectedMatchCount: checkpoint.descriptors.length,\n      excludedByLimitMatchCount: Math.max(\n        0,\n        checkpoint.totalAvailableMatchCount - checkpoint.descriptors.length,\n      ),\n      snapshotCrawledAt: checkpoint.sourceSnapshotCrawledAt,\n      selectedWindowStartTime: checkpoint.descriptors[0].startTime,",
)
replace_once(
    service,
    "function normalizeOptions(\n  request: HeroBuildDecisionDatasetV3StartRequest,\n): HeroBuildDecisionDatasetV3Options {\n  return {\n    maxMatches: boundedInteger(\n      request.maxMatches,\n      HERO_BUILD_DECISION_DATASET_V3_DEFAULT_MAX_MATCHES,\n      1,\n      HERO_BUILD_DECISION_DATASET_V3_MAX_MATCHES,\n      'maxMatches',\n    ),",
    "export function normalizeHeroBuildDecisionDatasetV3Options(\n  request: HeroBuildDecisionDatasetV3StartRequest,\n): HeroBuildDecisionDatasetV3Options {\n  return {\n    maxMatches: optionalBoundedInteger(\n      request.maxMatches,\n      1,\n      HERO_BUILD_DECISION_DATASET_V3_MAX_MATCHES,\n      'maxMatches',\n    ),",
)
replace_once(
    service,
    "    const options = normalizeOptions(request);",
    "    const options = normalizeHeroBuildDecisionDatasetV3Options(request);",
)
replace_once(
    service,
    "function boundedInteger(\n  value: number | undefined,",
    "function optionalBoundedInteger(\n  value: number | undefined,\n  minimum: number,\n  maximum: number,\n  fieldName: string,\n): number | undefined {\n  if (value === undefined) {\n    return undefined;\n  }\n  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {\n    throw new Error(\n      `${fieldName} must be a safe integer from ${minimum} to ${maximum}.`,\n    );\n  }\n  return value;\n}\n\nfunction boundedInteger(\n  value: number | undefined,",
)

replace_once(
    loader,
    "export interface HeroBuildOfflineLoadedDescriptors {\n  descriptors: HeroBuildOfflineEvaluationMatchDescriptor[];\n  sourceLastRefreshedAt?: Date;\n}",
    "export interface HeroBuildOfflineLoadedDescriptors {\n  descriptors: HeroBuildOfflineEvaluationMatchDescriptor[];\n  totalAvailableMatchCount: number;\n  sourceLastRefreshedAt?: Date;\n  sourceSnapshotCrawledAt?: Date;\n}",
)
replace_once(
    loader,
    "  async loadMatchDescriptors(\n    maxMatches: number,\n  ): Promise<HeroBuildOfflineLoadedDescriptors> {\n    const matches = await this.withDatabaseRetry(\n      'loading match descriptors',\n      () =>\n        this.matchRepository.find({\n          order: { startTime: 'DESC', matchId: 'DESC' },\n          take: maxMatches,\n        }),\n    );",
    "  async loadMatchDescriptors(\n    maxMatches?: number,\n  ): Promise<HeroBuildOfflineLoadedDescriptors> {\n    const [matches, totalAvailableMatchCount] = await this.withDatabaseRetry(\n      'loading immutable match descriptor snapshot',\n      () =>\n        Promise.all([\n          this.matchRepository.find({\n            order: { startTime: 'DESC', matchId: 'DESC' },\n            ...(maxMatches === undefined ? {} : { take: maxMatches }),\n          }),\n          this.matchRepository.count(),\n        ]),\n    );",
)
replace_once(
    loader,
    "    return {\n      descriptors,\n      sourceLastRefreshedAt:\n        refreshedTimes.length > 0\n          ? new Date(Math.max(...refreshedTimes))\n          : undefined,\n    };",
    "    const sourceSnapshotCrawledAt =\n      refreshedTimes.length > 0\n        ? new Date(Math.max(...refreshedTimes))\n        : undefined;\n    return {\n      descriptors,\n      totalAvailableMatchCount,\n      sourceLastRefreshedAt: sourceSnapshotCrawledAt,\n      sourceSnapshotCrawledAt,\n    };",
)

replace_once(
    controller,
    "  HERO_BUILD_DECISION_DATASET_V3_DEFAULT_MAX_MATCHES,\n  HERO_BUILD_DECISION_DATASET_V3_MAX_BATCH_SIZE,",
    "  HERO_BUILD_DECISION_DATASET_V3_MAX_BATCH_SIZE,",
)
replace_once(
    controller,
    "    maxMatches: parseInteger(\n      dto.maxMatches,\n      'maxMatches',\n      HERO_BUILD_DECISION_DATASET_V3_DEFAULT_MAX_MATCHES,\n      1,\n      HERO_BUILD_DECISION_DATASET_V3_MAX_MATCHES,\n    ),",
    "    maxMatches: parseOptionalInteger(\n      dto.maxMatches,\n      'maxMatches',\n      1,\n      HERO_BUILD_DECISION_DATASET_V3_MAX_MATCHES,\n    ),",
)
replace_once(
    controller,
    "function parseInteger(\n  value: unknown,",
    "function parseOptionalInteger(\n  value: unknown,\n  fieldName: string,\n  minimum: number,\n  maximum: number,\n): number | undefined {\n  if (value === undefined) {\n    return undefined;\n  }\n  if (\n    typeof value !== 'number' ||\n    !Number.isSafeInteger(value) ||\n    value < minimum ||\n    value > maximum\n  ) {\n    throw new BadRequestException(\n      `${fieldName} must be a safe integer from ${minimum} to ${maximum}.`,\n    );\n  }\n  return value;\n}\n\nfunction parseInteger(\n  value: unknown,",
)

Path("apps/api/test/hero-build-decision-dataset-v3-full-corpus.spec.ts").write_text(
    """import {\n  HERO_BUILD_DECISION_DATASET_V3_MAX_MATCHES,\n  normalizeHeroBuildDecisionDatasetV3Options,\n} from '../src/deadlock-live/hero-build-decision-dataset-v3.service';\n\ndescribe('Contextual V3 full-corpus snapshot options', () => {\n  it('uses the full immutable database snapshot when maxMatches is omitted', () => {\n    expect(normalizeHeroBuildDecisionDatasetV3Options({})).toEqual({\n      maxMatches: undefined,\n      batchSize: 100,\n      includeSellActions: false,\n    });\n  });\n\n  it('keeps an explicit smoke-test limit bounded', () => {\n    expect(\n      normalizeHeroBuildDecisionDatasetV3Options({ maxMatches: 25 }),\n    ).toMatchObject({ maxMatches: 25 });\n    expect(() =>\n      normalizeHeroBuildDecisionDatasetV3Options({\n        maxMatches: HERO_BUILD_DECISION_DATASET_V3_MAX_MATCHES + 1,\n      }),\n    ).toThrow('maxMatches must be a safe integer');\n  });\n});\n"""
)

Path("docs/full-crawler-dataset-snapshots.md").write_text(
    """# Full crawler dataset snapshots\n\nContextual dataset extraction uses every match available at start time when `maxMatches` is omitted. The selected descriptors are persisted in the checkpoint before row extraction, so crawler writes that arrive later cannot change an active run.\n\nThe manifest records:\n\n- total matches available when the snapshot was created\n- selected match count\n- matches excluded by an explicit smoke-test limit\n- maximum crawler timestamp inside the selected snapshot\n- chronological source window\n- descriptor SHA-256\n\n`maxMatches` remains optional for smoke tests and operational diagnostics. Production extraction must omit it. The hard-coded 13,000-match limit is removed.\n\nA new production snapshot should be built after enough crawler growth or a material game patch. Existing artifacts remain immutable and are referenced by SHA-256 from downstream training jobs.\n"""
)
