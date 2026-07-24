from pathlib import Path


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label} occurrence, found {count}")
    return content.replace(old, new, 1)


def replace_between(
    content: str,
    start_marker: str,
    end_marker: str,
    replacement: str,
    label: str,
) -> str:
    start = content.find(start_marker)
    end = content.find(end_marker, start)
    if start < 0 or end < 0:
        raise RuntimeError(f"Could not locate {label}")
    return content[:start] + replacement + content[end:]


module_path = Path("apps/api/src/deadlock-live/deadlock-live.module.ts")
module = module_path.read_text()
module = replace_once(
    module,
    "import { RecommendationBehavioralV4TrainingController } from './recommendation-behavioral-v4-training.controller';\n",
    "import { RecommendationBehavioralV4TrainingController } from './recommendation-behavioral-v4-training.controller';\nimport { RecommendationPolicyV4EvaluationController } from './recommendation-policy-v4-evaluation.controller';\n",
    "policy controller import",
)
module = replace_once(
    module,
    "import { RecommendationBehavioralV4TrainingService } from './recommendation-behavioral-v4-training.service';\n",
    "import { RecommendationBehavioralV4TrainingService } from './recommendation-behavioral-v4-training.service';\nimport { RecommendationPolicyV4EvaluationService } from './recommendation-policy-v4-evaluation.service';\n",
    "policy service import",
)
module = replace_once(
    module,
    "    RecommendationBehavioralV4TrainingController,\n    RecommendationValueV4TrainingController,",
    "    RecommendationBehavioralV4TrainingController,\n    RecommendationPolicyV4EvaluationController,\n    RecommendationValueV4TrainingController,",
    "policy controller registration",
)
module = replace_once(
    module,
    "    RecommendationBehavioralV4TrainingService,\n    RecommendationValueV4TrainingService,\n    RecommendationOutcomeLinkerService,",
    "    RecommendationBehavioralV4TrainingService,\n    RecommendationValueV4TrainingService,\n    RecommendationPolicyV4EvaluationService,\n    RecommendationOutcomeLinkerService,",
    "policy provider registration",
)
module = replace_once(
    module,
    "    RecommendationBehavioralV4TrainingService,\n    RecommendationValueV4TrainingService,\n    HeroBuildRecommendationService,",
    "    RecommendationBehavioralV4TrainingService,\n    RecommendationValueV4TrainingService,\n    RecommendationPolicyV4EvaluationService,\n    HeroBuildRecommendationService,",
    "policy export registration",
)
module_path.write_text(module)

compose_path = Path("docker-compose.yml")
compose = compose_path.read_text()
compose = replace_once(
    compose,
    "      - DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR=${DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR:-/app/apps/api/storage/recommendation-value-v4-training}\n",
    "      - DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR=${DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR:-/app/apps/api/storage/recommendation-value-v4-training}\n      - DEADLOCK_RECOMMENDATION_POLICY_V4_DATASET_DIR=${DEADLOCK_RECOMMENDATION_POLICY_V4_DATASET_DIR:-/app/apps/api/storage/recommendation-decision-dataset-v4}\n      - DEADLOCK_RECOMMENDATION_POLICY_V4_BEHAVIORAL_DIR=${DEADLOCK_RECOMMENDATION_POLICY_V4_BEHAVIORAL_DIR:-/app/apps/api/storage/recommendation-behavioral-v4-training}\n      - DEADLOCK_RECOMMENDATION_POLICY_V4_VALUE_DIR=${DEADLOCK_RECOMMENDATION_POLICY_V4_VALUE_DIR:-/app/apps/api/storage/recommendation-value-v4-training}\n      - DEADLOCK_RECOMMENDATION_POLICY_V4_OUTPUT_DIR=${DEADLOCK_RECOMMENDATION_POLICY_V4_OUTPUT_DIR:-/app/apps/api/storage/recommendation-policy-v4-evaluation}\n",
    "policy environment block",
)
compose_path.write_text(compose)

service_path = Path(
    "apps/api/src/deadlock-live/recommendation-policy-v4-evaluation.service.ts"
)
service = service_path.read_text()
service = service.replace(
    "!Number.isSafeInteger(features.heroId)",
    "!Number.isSafeInteger(Number(features.heroId))",
)
service = replace_once(
    service,
    "      const manifest = await buildManifest({\n        generatedAt,\n        options,\n        paths: this.paths,\n        sources,\n        coverage,\n        auditPassed: audit.passed,\n        releaseGate,\n      });\n      await Promise.all([\n        atomicJson(this.paths.audit, audit),\n        atomicJson(this.paths.manifest, manifest),\n      ]);",
    "      await Promise.all([\n        atomicJson(this.paths.evaluation, evaluation),\n        atomicJson(this.paths.audit, audit),\n      ]);\n      const manifest = await buildManifest({\n        generatedAt,\n        options,\n        paths: this.paths,\n        sources,\n        datasetDirectory: this.datasetDirectory,\n        behavioralDirectory: this.behavioralDirectory,\n        valueDirectory: this.valueDirectory,\n        coverage,\n        auditPassed: audit.passed,\n        releaseGate,\n      });\n      await atomicJson(this.paths.manifest, manifest);",
    "artifact finalization",
)
service = replace_once(
    service,
    "      await atomicJson(this.paths.evaluation, evaluation);\n      await Promise.all([\n        atomicJson(this.paths.evaluation, evaluation),",
    "      await Promise.all([\n        atomicJson(this.paths.evaluation, evaluation),",
    "duplicate evaluation write",
)
release_gate = '''function buildReleaseGate(input: {
  estimators: RecommendationPolicyV4EstimatorSummary;
  bootstrap: RecommendationPolicyV4BootstrapSummary;
  coverage: Record<string, number>;
  diagnostics: Record<string, unknown>;
  behavioralReleaseGatePassed: boolean;
  valueReleaseGatePassed: boolean;
}): Record<string, unknown> {
  const blockers: string[] = [];
  const candidateCoverageRate = input.coverage.candidateCoverageRate ?? 0;
  const behaviorSupportRate = input.coverage.behaviorSupportRate ?? 0;
  const clippedWeightRate = toNumber(input.diagnostics.clippedWeightRate);
  const ipsSnipsAbsoluteDifference = toNumber(
    input.diagnostics.ipsSnipsAbsoluteDifference,
  );
  const drDeltaInterval = input.bootstrap.intervals.doublyRobustDelta;
  if (input.estimators.decisionCount < 200) {
    blockers.push('Evaluation contains fewer than 200 supported decisions.');
  }
  if (input.estimators.matchCount < 30) {
    blockers.push('Evaluation contains fewer than 30 held-out matches.');
  }
  if (candidateCoverageRate < 0.95) {
    blockers.push('Recorded candidate coverage is below 95%.');
  }
  if (behaviorSupportRate < 0.9) {
    blockers.push('Estimated behavior-policy support is below 90%.');
  }
  if (input.estimators.effectiveSampleSizeRatio < 0.2) {
    blockers.push('Importance-weight effective sample-size ratio is below 20%.');
  }
  if (clippedWeightRate > 0.1) {
    blockers.push('More than 10% of supported decisions require weight clipping.');
  }
  if (ipsSnipsAbsoluteDifference > 0.05) {
    blockers.push('IPS and SNIPS estimates differ by more than 0.05.');
  }
  if (!drDeltaInterval || drDeltaInterval.lower < 0) {
    blockers.push(
      'The match-bootstrap 95% lower bound for doubly robust delta is negative.',
    );
  }
  if (!input.behavioralReleaseGatePassed) {
    blockers.push('Behavioral V4 training release gate did not pass.');
  }
  if (!input.valueReleaseGatePassed) {
    blockers.push('Value V4 training release gate did not pass.');
  }
  return {
    name: 'SHADOW_READINESS_DIAGNOSTIC',
    productionRolloutAuthorized: false,
    minimumDecisionCount: 200,
    minimumMatchCount: 30,
    minimumCandidateCoverageRate: 0.95,
    minimumBehaviorSupportRate: 0.9,
    minimumEffectiveSampleSizeRatio: 0.2,
    maximumClippedWeightRate: 0.1,
    maximumIpsSnipsAbsoluteDifference: 0.05,
    minimumDoublyRobustDeltaLower95: 0,
    behavioralReleaseGatePassed: input.behavioralReleaseGatePassed,
    valueReleaseGatePassed: input.valueReleaseGatePassed,
    passed: blockers.length === 0,
    blockers,
    warnings: [
      'Passing this diagnostic gate does not authorize production rollout because historical propensities are estimated rather than logged.',
    ],
  };
}

'''
service = replace_between(
    service,
    "function buildReleaseGate(input: {",
    "async function buildManifest(input: {",
    release_gate,
    "release gate function",
)
service = replace_once(
    service,
    "  sources: SourceBundle;\n  coverage: Record<string, number>;",
    "  sources: SourceBundle;\n  datasetDirectory: string;\n  behavioralDirectory: string;\n  valueDirectory: string;\n  coverage: Record<string, number>;",
    "manifest directory inputs",
)
service = replace_once(
    service,
    "        directory: DEFAULT_DATASET_DIRECTORY,",
    "        directory: input.datasetDirectory,",
    "manifest dataset directory",
)
service = replace_once(
    service,
    "        directory: DEFAULT_BEHAVIORAL_DIRECTORY,",
    "        directory: input.behavioralDirectory,",
    "manifest behavioral directory",
)
service = replace_once(
    service,
    "        directory: DEFAULT_VALUE_DIRECTORY,",
    "        directory: input.valueDirectory,",
    "manifest value directory",
)
release_gate_reader = '''function readReleaseGatePassed(manifest: Record<string, unknown>): boolean {
  const direct = asRecord(manifest.releaseGate);
  const evaluationSummary = asRecord(manifest.evaluationSummary);
  const summarized = asRecord(evaluationSummary.releaseGate);
  return Boolean(direct.passed ?? summarized.passed);
}

'''
service = replace_between(
    service,
    "function readReleaseGatePassed(manifest: Record<string, unknown>): boolean {",
    "function readNestedString(",
    release_gate_reader,
    "release gate reader",
)
service = replace_between(
    service,
    "function isPositiveInteger(value: unknown): value is number {",
    "function isNonNegativeInteger(value: unknown): value is number {",
    "function isPositiveInteger(value: unknown): value is number {\n  return (\n    typeof value === 'number' &&\n    Number.isSafeInteger(value) &&\n    value > 0\n  );\n}\n\n",
    "positive integer guard",
)
service = replace_between(
    service,
    "function isNonNegativeInteger(value: unknown): value is number {",
    "function toNumber(value: unknown): number {",
    "function isNonNegativeInteger(value: unknown): value is number {\n  return (\n    typeof value === 'number' &&\n    Number.isSafeInteger(value) &&\n    value >= 0\n  );\n}\n\n",
    "non-negative integer guard",
)
service_path.write_text(service)
