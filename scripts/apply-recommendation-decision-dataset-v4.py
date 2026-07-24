from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    content = path.read_text()
    if old not in content:
        raise RuntimeError(f"Expected text was not found in {path}: {old!r}")
    path.write_text(content.replace(old, new, 1))


module_path = Path("apps/api/src/deadlock-live/deadlock-live.module.ts")
replace_once(
    module_path,
    "import { RecommendationDecisionTelemetryController } from './recommendation-decision-telemetry.controller';",
    "import { RecommendationDecisionDatasetV4Controller } from './recommendation-decision-dataset-v4.controller';\n"
    "import { RecommendationDecisionTelemetryController } from './recommendation-decision-telemetry.controller';",
)
replace_once(
    module_path,
    "import { RecommendationDecisionTelemetryService } from './recommendation-decision-telemetry.service';",
    "import { RecommendationDecisionDatasetV4Service } from './recommendation-decision-dataset-v4.service';\n"
    "import { RecommendationDecisionTelemetryService } from './recommendation-decision-telemetry.service';",
)
replace_once(
    module_path,
    "    RecommendationDecisionTelemetryController,",
    "    RecommendationDecisionDatasetV4Controller,\n"
    "    RecommendationDecisionTelemetryController,",
)
replace_once(
    module_path,
    "    RecommendationDecisionTelemetryService,\n    RecommendationOutcomeLinkerService,",
    "    RecommendationDecisionTelemetryService,\n"
    "    RecommendationDecisionDatasetV4Service,\n"
    "    RecommendationOutcomeLinkerService,",
)
replace_once(
    module_path,
    "    RecommendationDecisionTelemetryService,\n    HeroBuildRecommendationService,",
    "    RecommendationDecisionTelemetryService,\n"
    "    RecommendationDecisionDatasetV4Service,\n"
    "    HeroBuildRecommendationService,",
)

docker_compose_path = Path("docker-compose.yml")
replace_once(
    docker_compose_path,
    "      - DEADLOCK_RECOMMENDATION_TELEMETRY_DIR=${DEADLOCK_RECOMMENDATION_TELEMETRY_DIR:-/app/apps/api/storage/recommendation-decision-telemetry}",
    "      - DEADLOCK_RECOMMENDATION_TELEMETRY_DIR=${DEADLOCK_RECOMMENDATION_TELEMETRY_DIR:-/app/apps/api/storage/recommendation-decision-telemetry}\n"
    "      - DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR=${DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR:-/app/apps/api/storage/recommendation-decision-dataset-v4}",
)
