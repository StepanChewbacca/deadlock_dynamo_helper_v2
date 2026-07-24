from pathlib import Path


def replace_once(content: str, old: str, new: str, label: str) -> str:
    if content.count(old) != 1:
        raise RuntimeError(
            f"Expected exactly one {label} occurrence, found {content.count(old)}"
        )
    return content.replace(old, new, 1)


module_path = Path("apps/api/src/deadlock-live/deadlock-live.module.ts")
module = module_path.read_text()
module = replace_once(
    module,
    "import { RecommendationDecisionDatasetV4Controller } from './recommendation-decision-dataset-v4.controller';",
    "import { RecommendationValueV4TrainingController } from './recommendation-value-v4-training.controller';\nimport { RecommendationDecisionDatasetV4Controller } from './recommendation-decision-dataset-v4.controller';",
    "value controller import",
)
module = replace_once(
    module,
    "import { RecommendationDecisionDatasetV4Service } from './recommendation-decision-dataset-v4.service';",
    "import { RecommendationValueV4TrainingService } from './recommendation-value-v4-training.service';\nimport { RecommendationDecisionDatasetV4Service } from './recommendation-decision-dataset-v4.service';",
    "value service import",
)
module = replace_once(
    module,
    "    RecommendationBehavioralV4TrainingController,\n    RecommendationDecisionDatasetV4Controller,",
    "    RecommendationBehavioralV4TrainingController,\n    RecommendationValueV4TrainingController,\n    RecommendationDecisionDatasetV4Controller,",
    "value controller registration",
)
module = replace_once(
    module,
    "    RecommendationDecisionDatasetV4Service,\n    RecommendationBehavioralV4TrainingService,\n    RecommendationOutcomeLinkerService,",
    "    RecommendationDecisionDatasetV4Service,\n    RecommendationBehavioralV4TrainingService,\n    RecommendationValueV4TrainingService,\n    RecommendationOutcomeLinkerService,",
    "value provider registration",
)
module = replace_once(
    module,
    "    RecommendationDecisionDatasetV4Service,\n    RecommendationBehavioralV4TrainingService,\n    HeroBuildRecommendationService,",
    "    RecommendationDecisionDatasetV4Service,\n    RecommendationBehavioralV4TrainingService,\n    RecommendationValueV4TrainingService,\n    HeroBuildRecommendationService,",
    "value service export",
)
module_path.write_text(module)

compose_path = Path("docker-compose.yml")
compose = compose_path.read_text()
compose = replace_once(
    compose,
    "      - DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR=${DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR:-/app/apps/api/storage/recommendation-behavioral-v4-training}\n",
    "      - DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR=${DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR:-/app/apps/api/storage/recommendation-behavioral-v4-training}\n      - DEADLOCK_RECOMMENDATION_VALUE_V4_SOURCE_DIR=${DEADLOCK_RECOMMENDATION_VALUE_V4_SOURCE_DIR:-/app/apps/api/storage/recommendation-decision-dataset-v4}\n      - DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR=${DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR:-/app/apps/api/storage/recommendation-value-v4-training}\n",
    "behavioral V4 environment line",
)
compose_path.write_text(compose)

service_path = Path(
    "apps/api/src/deadlock-live/recommendation-value-v4-training.service.ts"
)
service = service_path.read_text()
service = replace_once(
    service,
    "      const outcome = row.outcomeLabel.playerWon;",
    "      const outcome = Boolean(row.outcomeLabel.playerWon);",
    "eligible match outcome normalization",
)
service_path.write_text(service)
