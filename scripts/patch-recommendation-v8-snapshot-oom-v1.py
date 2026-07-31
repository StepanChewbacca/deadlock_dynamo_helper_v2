from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    content = file.read_text()
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one anchor in {path}, found {count}")
    file.write_text(content.replace(old, new, 1))


replace_once(
    "apps/api/src/deadlock-live/recommendation-candidate-generator-policy-accumulator.ts",
    """  build(): {\n""",
    """  release(): void {\n    this.heroesById.clear();\n    this.rowCount = 0;\n  }\n\n  build(): {\n""",
)

replace_once(
    "apps/api/src/deadlock-live/recommendation-candidate-generator-snapshot.ts",
    """  const normalizedPolicies = normalizePolicies(artifact.policies);\n  if (normalizedPolicies.length === 0) {\n    throw new Error('Candidate generator snapshot contains no hero policies.');\n  }\n  const heroIds = new Set<number>();\n  for (const policy of normalizedPolicies) {\n""",
    """  const policies = artifact.policies;\n  if (policies.length === 0) {\n    throw new Error('Candidate generator snapshot contains no hero policies.');\n  }\n  const heroIds = new Set<number>();\n  for (const policy of policies) {\n""",
)

replace_once(
    "apps/api/src/deadlock-live/recommendation-candidate-generator-snapshot.ts",
    """  const actualPolicySha256 = sha256StableJson(\n    candidateGeneratorPolicyPayload(artifact),\n  );\n""",
    """  const actualPolicySha256 = sha256StableJson({\n    generatorOptions: artifact.generatorOptions,\n    policies: artifact.policies,\n  });\n""",
)

old_create = """export function createRecommendationCandidateGeneratorSnapshotArtifact(input: {\n  snapshot: Omit<\n    RecommendationFrozenCandidateGeneratorSnapshot,\n    'policySha256' | 'catalogSha256'\n  >;\n  generatorOptions?: Partial<HeroBuildRecommendationOptions>;\n  policies: RecommendationSerializedHeroBuildPolicy[];\n  catalog: RecommendationCandidateGeneratorSnapshotArtifact['catalog'];\n}): RecommendationCandidateGeneratorSnapshotArtifact {\n  const artifact = {\n    schemaVersion:\n      RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_SCHEMA_VERSION,\n    artifactVersion: RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_VERSION,\n    snapshot: {\n      ...input.snapshot,\n      policySha256: '',\n      catalogSha256: '',\n    },\n    generatorOptions: normalizeGeneratorOptions({\n      minExactObservations:\n        input.generatorOptions?.minExactObservations ??\n        HERO_BUILD_MIN_EXACT_OBSERVATIONS,\n      maxBackoffDistance:\n        input.generatorOptions?.maxBackoffDistance ??\n        HERO_BUILD_MAX_BACKOFF_DISTANCE,\n      maxBackoffStates:\n        input.generatorOptions?.maxBackoffStates ??\n        HERO_BUILD_MAX_BACKOFF_STATES,\n      limit: input.generatorOptions?.limit ?? 100,\n    }),\n    policies: normalizePolicies(input.policies),\n    catalog: {\n      version: input.catalog.version,\n      items: normalizeCatalogItems(input.catalog.items),\n    },\n  } satisfies RecommendationCandidateGeneratorSnapshotArtifact;\n  artifact.snapshot.policySha256 = sha256StableJson(\n    candidateGeneratorPolicyPayload(artifact),\n  );\n  artifact.snapshot.catalogSha256 = sha256StableJson(\n    candidateGeneratorCatalogPayload(artifact),\n  );\n  validateRecommendationCandidateGeneratorSnapshotArtifact(artifact);\n  return artifact;\n}\n"""

new_create = """export function createRecommendationCandidateGeneratorSnapshotArtifact(input: {\n  snapshot: Omit<\n    RecommendationFrozenCandidateGeneratorSnapshot,\n    'policySha256' | 'catalogSha256'\n  >;\n  generatorOptions?: Partial<HeroBuildRecommendationOptions>;\n  policies: RecommendationSerializedHeroBuildPolicy[];\n  catalog: RecommendationCandidateGeneratorSnapshotArtifact['catalog'];\n}): RecommendationCandidateGeneratorSnapshotArtifact {\n  return createRecommendationCandidateGeneratorSnapshotArtifactFromNormalizedPolicies({\n    ...input,\n    policies: normalizePolicies(input.policies),\n  });\n}\n\nexport function createRecommendationCandidateGeneratorSnapshotArtifactFromNormalizedPolicies(input: {\n  snapshot: Omit<\n    RecommendationFrozenCandidateGeneratorSnapshot,\n    'policySha256' | 'catalogSha256'\n  >;\n  generatorOptions?: Partial<HeroBuildRecommendationOptions>;\n  policies: RecommendationSerializedHeroBuildPolicy[];\n  catalog: RecommendationCandidateGeneratorSnapshotArtifact['catalog'];\n}): RecommendationCandidateGeneratorSnapshotArtifact {\n  const artifact = {\n    schemaVersion:\n      RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_SCHEMA_VERSION,\n    artifactVersion: RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_VERSION,\n    snapshot: {\n      ...input.snapshot,\n      policySha256: '',\n      catalogSha256: '',\n    },\n    generatorOptions: normalizeGeneratorOptions({\n      minExactObservations:\n        input.generatorOptions?.minExactObservations ??\n        HERO_BUILD_MIN_EXACT_OBSERVATIONS,\n      maxBackoffDistance:\n        input.generatorOptions?.maxBackoffDistance ??\n        HERO_BUILD_MAX_BACKOFF_DISTANCE,\n      maxBackoffStates:\n        input.generatorOptions?.maxBackoffStates ??\n        HERO_BUILD_MAX_BACKOFF_STATES,\n      limit: input.generatorOptions?.limit ?? 100,\n    }),\n    policies: input.policies,\n    catalog: {\n      version: input.catalog.version,\n      items: normalizeCatalogItems(input.catalog.items),\n    },\n  } satisfies RecommendationCandidateGeneratorSnapshotArtifact;\n  artifact.snapshot.policySha256 = sha256StableJson({\n    generatorOptions: artifact.generatorOptions,\n    policies: artifact.policies,\n  });\n  artifact.snapshot.catalogSha256 = sha256StableJson(\n    candidateGeneratorCatalogPayload(artifact),\n  );\n  validateRecommendationCandidateGeneratorSnapshotArtifact(artifact);\n  return artifact;\n}\n"""

replace_once(
    "apps/api/src/deadlock-live/recommendation-candidate-generator-snapshot.ts",
    old_create,
    new_create,
)

replace_once(
    "apps/api/src/deadlock-live/recommendation-candidate-generator-snapshot-export.service.ts",
    """  createRecommendationCandidateGeneratorSnapshotArtifact,\n""",
    """  createRecommendationCandidateGeneratorSnapshotArtifactFromNormalizedPolicies,\n""",
)

replace_once(
    "apps/api/src/deadlock-live/recommendation-candidate-generator-snapshot-export.service.ts",
    """      const built = accumulator.build();\n      this.status = {\n""",
    """      const built = accumulator.build();\n      accumulator.release();\n      this.status = {\n""",
)

replace_once(
    "apps/api/src/deadlock-live/recommendation-candidate-generator-snapshot-export.service.ts",
    """      const artifact = createRecommendationCandidateGeneratorSnapshotArtifact({\n""",
    """      const artifact =\n        createRecommendationCandidateGeneratorSnapshotArtifactFromNormalizedPolicies({\n""",
)

spec = Path("apps/api/test/recommendation-candidate-generator-snapshot-memory.spec.ts")
spec.write_text(
    """import {\n  createRecommendationCandidateGeneratorSnapshotArtifactFromNormalizedPolicies,\n  validateRecommendationCandidateGeneratorSnapshotArtifact,\n  type RecommendationSerializedHeroBuildPolicy,\n} from '../src/deadlock-live/recommendation-candidate-generator-snapshot';\n\ndescribe('Recommendation candidate snapshot memory contract', () => {\n  it('reuses an already-normalized policy graph without cloning it', () => {\n    const policies: RecommendationSerializedHeroBuildPolicy[] = [\n      {\n        heroId: 1,\n        playerCount: 1,\n        stateCount: 1,\n        transitionCount: 1,\n        states: [\n          {\n            stateKey: 'EMPTY',\n            observationCount: 1,\n            nextActionCount: 1,\n            nextActions: [\n              {\n                actionType: 'BUY',\n                itemId: 1001,\n                actionKey: 'BUY:1001',\n                count: 1,\n                probability: 1,\n                averageGameTimeS: 300,\n                afterStates: [\n                  {\n                    afterStateKey: '1001x1',\n                    count: 1,\n                    probability: 1,\n                  },\n                ],\n              },\n            ],\n          },\n        ],\n      },\n    ];\n    const artifact =\n      createRecommendationCandidateGeneratorSnapshotArtifactFromNormalizedPolicies({\n        snapshot: {\n          snapshotId: 'memory-test',\n          generatorVersion: 'generator-test',\n          policyVersion: 'policy-test',\n          catalogVersion: 'catalog-test',\n          trainingWindowStart: '2026-07-01T00:00:00.000Z',\n          trainingWindowEnd: '2026-07-02T00:00:00.000Z',\n        },\n        policies,\n        catalog: {\n          version: 'catalog-test',\n          items: [\n            {\n              itemId: 1001,\n              cost: 500,\n              tier: 1,\n              slotType: 'WEAPON',\n              tags: [],\n              componentItemIds: [],\n            },\n          ],\n        },\n      });\n\n    expect(artifact.policies).toBe(policies);\n    expect(artifact.snapshot.policySha256).toMatch(/^[a-f0-9]{64}$/);\n    validateRecommendationCandidateGeneratorSnapshotArtifact(artifact);\n  });\n});\n"""
)
