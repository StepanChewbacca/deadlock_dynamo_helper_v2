from pathlib import Path


def replace_once(content: str, old: str, new: str, label: str) -> str:
    if content.count(old) != 1:
        raise RuntimeError(f"Expected exactly one {label} occurrence, found {content.count(old)}")
    return content.replace(old, new, 1)


module_path = Path("apps/api/src/deadlock-live/deadlock-live.module.ts")
module = module_path.read_text()
module = replace_once(
    module,
    "import { RecommendationDecisionDatasetV4Controller } from './recommendation-decision-dataset-v4.controller';",
    "import { RecommendationBehavioralV4TrainingController } from './recommendation-behavioral-v4-training.controller';\nimport { RecommendationDecisionDatasetV4Controller } from './recommendation-decision-dataset-v4.controller';",
    "dataset controller import",
)
module = replace_once(
    module,
    "import { RecommendationDecisionDatasetV4Service } from './recommendation-decision-dataset-v4.service';",
    "import { RecommendationBehavioralV4TrainingService } from './recommendation-behavioral-v4-training.service';\nimport { RecommendationDecisionDatasetV4Service } from './recommendation-decision-dataset-v4.service';",
    "dataset service import",
)
module = replace_once(
    module,
    "    RecommendationDecisionDatasetV4Controller,\n    RecommendationDecisionTelemetryController,",
    "    RecommendationBehavioralV4TrainingController,\n    RecommendationDecisionDatasetV4Controller,\n    RecommendationDecisionTelemetryController,",
    "controller registration",
)
module = replace_once(
    module,
    "    RecommendationDecisionTelemetryService,\n    RecommendationDecisionDatasetV4Service,",
    "    RecommendationDecisionTelemetryService,\n    RecommendationDecisionDatasetV4Service,\n    RecommendationBehavioralV4TrainingService,",
    "provider registration",
)
module = replace_once(
    module,
    "    RecommendationDecisionTelemetryService,\n    RecommendationDecisionDatasetV4Service,\n    HeroBuildRecommendationService,",
    "    RecommendationDecisionTelemetryService,\n    RecommendationDecisionDatasetV4Service,\n    RecommendationBehavioralV4TrainingService,\n    HeroBuildRecommendationService,",
    "service export",
)
module_path.write_text(module)

compose_path = Path("docker-compose.yml")
compose = compose_path.read_text()
compose = replace_once(
    compose,
    "      - DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR=${DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR:-/app/apps/api/storage/recommendation-decision-dataset-v4}\n",
    "      - DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR=${DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR:-/app/apps/api/storage/recommendation-decision-dataset-v4}\n      - DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_SOURCE_DIR=${DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_SOURCE_DIR:-/app/apps/api/storage/recommendation-decision-dataset-v4}\n      - DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR=${DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR:-/app/apps/api/storage/recommendation-behavioral-v4-training}\n",
    "dataset V4 environment line",
)
compose_path.write_text(compose)

service_path = Path(
    "apps/api/src/deadlock-live/recommendation-behavioral-v4-training.service.ts"
)
service = service_path.read_text()
service = replace_once(
    service,
    "        sourceManifest,\n        sourceSha256,",
    "        sourceManifest,\n        sourceDirectory: this.sourceDirectory,\n        sourceSha256,",
    "manifest source call",
)
service = replace_once(
    service,
    "  sourceManifest: RecommendationDecisionDatasetV4Manifest;\n  sourceSha256: string;",
    "  sourceManifest: RecommendationDecisionDatasetV4Manifest;\n  sourceDirectory: string;\n  sourceSha256: string;",
    "manifest source input",
)
service = replace_once(
    service,
    "      directory: DEFAULT_SOURCE_DIRECTORY,",
    "      directory: input.sourceDirectory,",
    "manifest source directory",
)
service = replace_once(
    service,
    "    Number.isSafeInteger(value.heroId) &&",
    "    Number.isSafeInteger(Number(value.heroId)) &&",
    "source hero validation",
)
service_path.write_text(service)

test_path = Path("apps/api/test/recommendation-behavioral-v4-training.spec.ts")
test = test_path.read_text()
test = replace_once(
    test,
    "async function readNdjson(path: string): Promise<Record<string, any>[]> {",
    "async function readNdjson(\n  path: string,\n): Promise<Array<{ decisionId: string; matchId: string } & Record<string, unknown>>> {",
    "NDJSON helper return type",
)
test = replace_once(
    test,
    ".map((line) => JSON.parse(line) as Record<string, any>);",
    ".map(\n      (line) =>\n        JSON.parse(line) as { decisionId: string; matchId: string } &\n          Record<string, unknown>,\n    );",
    "NDJSON helper cast",
)
test_path.write_text(test)
