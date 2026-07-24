from pathlib import Path


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label} occurrence, found {count}")
    return content.replace(old, new, 1)


def replace_in_section(
    content: str,
    start_marker: str,
    end_marker: str,
    old: str,
    new: str,
    label: str,
) -> str:
    start = content.find(start_marker)
    end = content.find(end_marker, start)
    if start < 0 or end < 0:
        raise RuntimeError(f"Could not find {label} section")
    section = content[start:end]
    count = section.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label} occurrence, found {count}")
    return content[:start] + section.replace(old, new, 1) + content[end:]


module_path = Path("apps/api/src/deadlock-live/deadlock-live.module.ts")
module = module_path.read_text()
module = replace_once(
    module,
    "import { RecommendationDecisionDatasetV4Controller } from './recommendation-decision-dataset-v4.controller';\n",
    "import { RecommendationDecisionDatasetV4HistoricalBootstrapController } from './recommendation-decision-dataset-v4-historical-bootstrap.controller';\n"
    "import { RecommendationDecisionDatasetV4Controller } from './recommendation-decision-dataset-v4.controller';\n",
    "historical bootstrap controller import",
)
module = replace_once(
    module,
    "import { RecommendationDecisionDatasetV4Service } from './recommendation-decision-dataset-v4.service';\n",
    "import { RecommendationDecisionDatasetV4HistoricalBootstrapService } from './recommendation-decision-dataset-v4-historical-bootstrap.service';\n"
    "import { RecommendationDecisionDatasetV4Service } from './recommendation-decision-dataset-v4.service';\n",
    "historical bootstrap service import",
)
module = replace_once(
    module,
    "    RecommendationValueV4TrainingController,\n    RecommendationDecisionDatasetV4Controller,\n",
    "    RecommendationValueV4TrainingController,\n"
    "    RecommendationDecisionDatasetV4HistoricalBootstrapController,\n"
    "    RecommendationDecisionDatasetV4Controller,\n",
    "historical bootstrap controller registration",
)
module = replace_in_section(
    module,
    "  providers: [",
    "  exports: [",
    "    RecommendationDecisionDatasetV4Service,\n    RecommendationBehavioralV4TrainingService,\n",
    "    RecommendationDecisionDatasetV4Service,\n"
    "    RecommendationDecisionDatasetV4HistoricalBootstrapService,\n"
    "    RecommendationBehavioralV4TrainingService,\n",
    "historical bootstrap provider registration",
)
module = replace_in_section(
    module,
    "  exports: [",
    "]\n})",
    "    RecommendationDecisionDatasetV4Service,\n    RecommendationBehavioralV4TrainingService,\n",
    "    RecommendationDecisionDatasetV4Service,\n"
    "    RecommendationDecisionDatasetV4HistoricalBootstrapService,\n"
    "    RecommendationBehavioralV4TrainingService,\n",
    "historical bootstrap export registration",
)
module_path.write_text(module)

compose_path = Path("docker-compose.yml")
compose = compose_path.read_text()
compose = replace_once(
    compose,
    "      - DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR=${DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR:-/app/apps/api/storage/recommendation-decision-dataset-v4}\n",
    "      - DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR=${DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR:-/app/apps/api/storage/recommendation-decision-dataset-v4}\n"
    "      - DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_TRAINING_DIR=${DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_TRAINING_DIR:-/app/apps/api/storage/contextual-v3-training}\n"
    "      - DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_CANDIDATE_DIR=${DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_CANDIDATE_DIR:-/app/apps/api/storage/contextual-v3-candidate-evaluation-v2}\n"
    "      - DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_OUTPUT_DIR=${DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_OUTPUT_DIR:-/app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap}\n",
    "historical bootstrap compose environment",
)
compose_path.write_text(compose)
