import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { RecommendationBehavioralV5PropensityRow } from './recommendation-behavioral-v5-training.service';
import type {
  RecommendationProDecisionDatasetV6ArtifactAudit,
  RecommendationProDecisionDatasetV6ArtifactManifest,
} from './recommendation-pro-decision-dataset-v6-artifact.service';
import {
  RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION,
  RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
  type RecommendationDatasetV6Split,
  type RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';
import {
  createRecommendationValueV8ActionModel,
  createRecommendationValueV8StateModel,
  predictRecommendationValueV8CandidateSet,
  predictRecommendationValueV8State,
  recommendationValueV8FoldId,
  recommendationValueV8Targets,
  RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION,
  RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION,
  RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
  RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION,
  trainRecommendationValueV8ActionDecision,
  trainRecommendationValueV8StateDecision,
  type RecommendationValueV8ActionModel,
  type RecommendationValueV8ActionTrainingOptions,
  type RecommendationValueV8DiagnosticGate,
  type RecommendationValueV8StateModel,
  type RecommendationValueV8StateTrainingOptions,
} from './recommendation-value-v8-diagnostic';
import {
  buildRecommendationValueV8ReleaseGate,
  createRecommendationValueV8EvaluationAccumulator,
  evaluateRecommendationValueV8Decision,
  finalizeRecommendationValueV8Evaluation,
  observeRecommendationValueV8Evaluation,
  selectRecommendationValueV8Configuration,
  validateRecommendationV6ShortOnlyBaselineManifest,
  RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
  RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION,
  type RecommendationV6ShortOnlyBaselineManifest,
  type RecommendationV6ShortOnlyBaselineRow,
  type RecommendationValueV8Configuration,
  type RecommendationValueV8EvaluationMetrics,
  type RecommendationValueV8ReleaseGate,
  type RecommendationValueV8ReleaseThresholds,
  type RecommendationValueV8Selection,
} from './recommendation-value-v8-full-evaluation';

const DEFAULT_DATASET_DIRECTORY =
  '/app/apps/api/storage/recommendation-pro-decision-dataset-v6-1';
const DEFAULT_BEHAVIORAL_DIRECTORY =
  '/app/apps/api/storage/recommendation-behavioral-v5-1';
const DEFAULT_DIAGNOSTIC_DIRECTORY =
  '/app/apps/api/storage/recommendation-value-v8-diagnostic-1';
const DEFAULT_BASELINE_DIRECTORY =
  '/app/apps/api/storage/recommendation-v6-short-only-dataset-v6-baseline-1';
const DEFAULT_OUTPUT_DIRECTORY =
  '/app/apps/api/storage/recommendation-value-v8-full-evaluation-1';
const PROPENSITY_FILE_NAME = 'propensities.ndjson';
const BASELINE_FILE_NAME = 'predictions.ndjson';
const PREDICTION_FILE_NAME = 'predictions.ndjson';

export interface RecommendationValueV8FullEvaluationStartRequest {
  foldCount?: number;
  stateEpochs?: number;
  actionEpochs?: number;
  hashDimension?: number;
  stateLearningRate?: number;
  actionLearningRate?: number;
  stateL2?: number;
  actionL2?: number;
  maximumAbsolutePrediction?: number;
  maximumAbsoluteResidual?: number;
  propensityFloor?: number;
  maximumImportanceWeight?: number;
  actionScales?: number[];
  policyTemperatures?: number[];
  cohortMinimumDecisions?: number;
  criticalCohortRmseTolerance?: number;
  releaseThresholds?: Partial<RecommendationValueV8ReleaseThresholds>;
  expectedDatasetSha256?: string;
  expectedBehavioralPropensitySha256?: string;
  expectedDiagnosticManifestSha256?: string;
  expectedBaselineSha256?: string;
}

export interface RecommendationValueV8FullEvaluationOptions {
  foldCount: number;
  stateEpochs: number;
  actionEpochs: number;
  hashDimension: number;
  state: RecommendationValueV8StateTrainingOptions;
  action: RecommendationValueV8ActionTrainingOptions;
  actionScales: number[];
  policyTemperatures: number[];
  cohortMinimumDecisions: number;
  criticalCohortRmseTolerance: number;
  releaseThresholds: RecommendationValueV8ReleaseThresholds;
  expectedDatasetSha256?: string;
  expectedBehavioralPropensitySha256?: string;
  expectedDiagnosticManifestSha256?: string;
  expectedBaselineSha256?: string;
}

export interface RecommendationValueV8FullEvaluationStatus {
  state: 'IDLE' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  phase:
    | 'PREPARING'
    | 'TRAINING_STATE_FOLDS'
    | 'TRAINING_STATE_FINAL'
    | 'TRAINING_ACTION'
    | 'SELECTING'
    | 'EVALUATING_FUTURE_TEST'
    | 'FINALIZING'
    | 'COMPLETE';
  currentPass: number;
  totalPasses: number;
  sourceRowCount: number;
  trainDecisionCount: number;
  tuningDecisionCount: number;
  futureTestDecisionCount: number;
  predictionRowCount: number;
  outputDirectory: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  options?: RecommendationValueV8FullEvaluationOptions;
  manifestAvailable: boolean;
  auditAvailable: boolean;
  evaluationAvailable: boolean;
  modelAvailable: boolean;
  releaseGatePassed?: boolean;
  passiveShadowAuthorized?: boolean;
  randomizedCanaryAuthorized: false;
}

export interface RecommendationValueV8FullEvaluationAudit {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION;
  evaluationVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION;
  generatedAt: string;
  passed: boolean;
  releaseGatePassed: boolean;
  source: {
    datasetSha256: string;
    datasetRowCount: number;
    behavioralPropensitySha256: string;
    diagnosticManifestSha256: string;
    baselineSha256: string;
  };
  diagnostic: {
    auditPassed: true;
    diagnosticGatePassed: true;
    fullTrainingRecommended: true;
    futureTestUsed: false;
  };
  crossFitting: {
    unit: 'MATCH';
    foldCount: number;
    foldMatchCounts: number[];
    trainingMatchExclusionVerified: true;
    actionResidualUsesOofStatePrediction: true;
  };
  split: {
    descriptorSha256: string;
    trainDecisionCount: number;
    tuningDecisionCount: number;
    futureTestDecisionCount: number;
    tuningUsedForSelection: true;
    futureTestUsedForSelection: false;
    futureTestEvaluationPassCount: 1;
  };
  joins: {
    missingBehavioralPropensityCount: number;
    missingBaselineCount: number;
    duplicateDatasetDecisionCount: number;
    duplicateBehavioralDecisionCount: number;
    duplicateBaselineDecisionCount: number;
  };
  artifacts: {
    predictionSha256: string;
    predictionRowCount: number;
    modelSha256: string;
    evaluationSha256: string;
  };
  releaseGate: RecommendationValueV8ReleaseGate;
  reasons: string[];
  passiveShadowAuthorized: boolean;
  randomizedCanaryAuthorized: false;
}

export interface RecommendationValueV8FullEvaluationManifest {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION;
  evaluationVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION;
  generatedAt: string;
  source: {
    datasetVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION;
    datasetSha256: string;
    behavioralPropensitySha256: string;
    diagnosticManifestSha256: string;
    baselineSha256: string;
    splitDescriptorSha256: string;
  };
  trainingContract: {
    stateModelTrainSplitOnly: true;
    stateCrossFittingUnit: 'MATCH';
    actionResidualUsesOofStatePrediction: true;
    actionModelTrainSplitOnly: true;
    actionObservedCandidateOnly: true;
    tuningUsedForConfigurationSelectionOnly: true;
    futureTestUsedForTraining: false;
    futureTestUsedForSelection: false;
    futureTestEvaluationPassCount: 1;
    finalOutcomeUsedForTraining: false;
    behavioralPropensityRequired: true;
    frozenV6BaselineRequired: true;
    diagnosticGateRequired: true;
  };
  options: RecommendationValueV8FullEvaluationOptions;
  selectedConfiguration: RecommendationValueV8Configuration;
  artifacts: {
    predictions: ArtifactDescriptor & { rowCount: number; format: 'NDJSON' };
    model: ArtifactDescriptor & { format: 'JSON' };
    evaluation: ArtifactDescriptor & { format: 'JSON' };
    audit: ArtifactDescriptor & { format: 'JSON' };
  };
  releaseGatePassed: boolean;
  passiveShadowAuthorized: boolean;
  randomizedCanaryAuthorized: false;
}

interface ArtifactDescriptor {
  fileName: string;
  sha256: string;
  byteLength: number;
}

interface DiagnosticTrainingManifest {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION;
  source: {
    dataset: { sha256: string };
    behavioral: { sha256: string };
  };
  diagnosticOnly: true;
  futureTestUsed: false;
  auditPassed: boolean;
  diagnosticGatePassed: boolean;
  fullTrainingRecommended: boolean;
}

interface DiagnosticTrainingAudit {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION;
  passed: boolean;
  fullTrainingRecommended: boolean;
  source: {
    datasetSha256: string;
    behavioralPropensitySha256: string;
  };
  leakage: {
    futureTestUsedForTraining: false;
    futureTestUsedForSelection: false;
    finalOutcomeUsedForTraining: false;
  };
  diagnosticGate: RecommendationValueV8DiagnosticGate;
}

interface LoadedSources {
  dataset: {
    path: string;
    sha256: string;
    rowCount: number;
    splitDescriptorSha256: string;
  };
  propensities: {
    path: string;
    sha256: string;
  };
  diagnostic: {
    manifestSha256: string;
    manifest: DiagnosticTrainingManifest;
    audit: DiagnosticTrainingAudit;
  };
  baseline: {
    path: string;
    sha256: string;
    manifest: RecommendationV6ShortOnlyBaselineManifest;
  };
}

interface SourceIndex {
  propensities: Map<string, RecommendationBehavioralV5PropensityRow>;
  baselines: Map<string, RecommendationV6ShortOnlyBaselineRow>;
  duplicateBehavioralDecisionCount: number;
  duplicateBaselineDecisionCount: number;
}

interface SourceSummary {
  sourceRowCount: number;
  eligibleBySplit: Record<RecommendationDatasetV6Split, number>;
  duplicateDatasetDecisionCount: number;
  missingBehavioralPropensityCount: number;
  missingBaselineCount: number;
  trainMatchIdsByFold: Array<Set<string>>;
}

@Injectable()
export class RecommendationValueV8FullEvaluationTrainingService
  implements OnModuleInit
{
  private readonly logger = new Logger(
    RecommendationValueV8FullEvaluationTrainingService.name,
  );
  private readonly datasetDirectory =
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_FULL_DATASET_DIR?.trim() ||
    DEFAULT_DATASET_DIRECTORY;
  private readonly behavioralDirectory =
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_FULL_BEHAVIORAL_DIR?.trim() ||
    DEFAULT_BEHAVIORAL_DIRECTORY;
  private readonly diagnosticDirectory =
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_FULL_DIAGNOSTIC_DIR?.trim() ||
    DEFAULT_DIAGNOSTIC_DIRECTORY;
  private readonly baselineDirectory =
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_FULL_BASELINE_DIR?.trim() ||
    DEFAULT_BASELINE_DIRECTORY;
  private readonly outputDirectory =
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_FULL_DIR?.trim() ||
    DEFAULT_OUTPUT_DIRECTORY;
  private readonly paths = {
    predictions: join(this.outputDirectory, PREDICTION_FILE_NAME),
    model: join(this.outputDirectory, 'model.json'),
    evaluation: join(this.outputDirectory, 'evaluation.json'),
    audit: join(this.outputDirectory, 'audit.json'),
    manifest: join(this.outputDirectory, 'manifest.json'),
  };
  private status = this.idleStatus();
  private manifest?: RecommendationValueV8FullEvaluationManifest;
  private audit?: RecommendationValueV8FullEvaluationAudit;
  private evaluation?: Record<string, unknown>;
  private model?: Record<string, unknown>;
  private runPromise: Promise<void> = Promise.resolve();

  async onModuleInit(): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
    this.manifest = await readJson<RecommendationValueV8FullEvaluationManifest>(
      this.paths.manifest,
    );
    this.audit = await readJson<RecommendationValueV8FullEvaluationAudit>(
      this.paths.audit,
    );
    this.evaluation = await readJson<Record<string, unknown>>(
      this.paths.evaluation,
    );
    this.model = await readJson<Record<string, unknown>>(this.paths.model);
    if (
      this.manifest &&
      this.audit &&
      this.evaluation &&
      this.model &&
      (await exists(this.paths.predictions))
    ) {
      this.status = {
        ...this.idleStatus(),
        state: 'COMPLETE',
        phase: 'COMPLETE',
        sourceRowCount:
          this.audit.split.trainDecisionCount +
          this.audit.split.tuningDecisionCount +
          this.audit.split.futureTestDecisionCount,
        trainDecisionCount: this.audit.split.trainDecisionCount,
        tuningDecisionCount: this.audit.split.tuningDecisionCount,
        futureTestDecisionCount: this.audit.split.futureTestDecisionCount,
        predictionRowCount: this.audit.artifacts.predictionRowCount,
        completedAt: this.manifest.generatedAt,
        manifestAvailable: true,
        auditAvailable: true,
        evaluationAvailable: true,
        modelAvailable: true,
        releaseGatePassed: this.audit.releaseGatePassed,
        passiveShadowAuthorized: this.audit.passiveShadowAuthorized,
        randomizedCanaryAuthorized: false,
      };
    }
  }

  async start(
    request: RecommendationValueV8FullEvaluationStartRequest = {},
  ): Promise<RecommendationValueV8FullEvaluationStatus> {
    if (this.status.state === 'RUNNING') {
      throw new Error('Recommendation Value V8 full evaluation is already running.');
    }
    const options = normalizeOptions(request);
    const startedAt = new Date().toISOString();
    this.status = {
      ...this.idleStatus(),
      state: 'RUNNING',
      phase: 'PREPARING',
      currentPass: 0,
      totalPasses:
        options.foldCount * options.stateEpochs +
        options.stateEpochs +
        options.actionEpochs +
        2,
      startedAt,
      options,
    };
    this.runPromise = this.run(options);
    return this.getStatus();
  }

  async waitForIdle(): Promise<void> {
    await this.runPromise;
  }

  getStatus(): RecommendationValueV8FullEvaluationStatus {
    return clone(this.status);
  }

  getManifest(): RecommendationValueV8FullEvaluationManifest | undefined {
    return this.manifest ? clone(this.manifest) : undefined;
  }

  getAudit(): RecommendationValueV8FullEvaluationAudit | undefined {
    return this.audit ? clone(this.audit) : undefined;
  }

  getEvaluation(): Record<string, unknown> | undefined {
    return this.evaluation ? clone(this.evaluation) : undefined;
  }

  getModel(): Record<string, unknown> | undefined {
    return this.model ? clone(this.model) : undefined;
  }

  private async run(
    options: RecommendationValueV8FullEvaluationOptions,
  ): Promise<void> {
    try {
      const sources = await this.loadSources(options);
      await mkdir(this.outputDirectory, { recursive: true });
      await this.clearOutputs();
      this.manifest = undefined;
      this.audit = undefined;
      this.evaluation = undefined;
      this.model = undefined;

      const index = await buildSourceIndex(sources);
      const summary = await scanDataset(sources, index, options.foldCount);
      validateSourceSummary(summary, index, sources.dataset.rowCount);
      this.status = {
        ...this.status,
        sourceRowCount: summary.sourceRowCount,
        trainDecisionCount: summary.eligibleBySplit.TRAIN,
        tuningDecisionCount: summary.eligibleBySplit.TUNING,
        futureTestDecisionCount: summary.eligibleBySplit.FUTURE_TEST,
      };

      const foldStateModels: RecommendationValueV8StateModel[] = [];
      let currentPass = 0;
      for (let holdoutFold = 0; holdoutFold < options.foldCount; holdoutFold += 1) {
        const model = createRecommendationValueV8StateModel(options.hashDimension);
        for (let epoch = 0; epoch < options.stateEpochs; epoch += 1) {
          currentPass += 1;
          this.status = {
            ...this.status,
            phase: 'TRAINING_STATE_FOLDS',
            currentPass,
          };
          await eachDatasetRow(sources.dataset.path, async (row) => {
            if (
              row.split === 'TRAIN' &&
              row.eligibility.stateModel &&
              recommendationValueV8FoldId(row.matchId, options.foldCount) !==
                holdoutFold
            ) {
              trainRecommendationValueV8StateDecision(model, row, options.state);
            }
          });
        }
        foldStateModels.push(model);
      }

      const finalStateModel = createRecommendationValueV8StateModel(
        options.hashDimension,
      );
      for (let epoch = 0; epoch < options.stateEpochs; epoch += 1) {
        currentPass += 1;
        this.status = {
          ...this.status,
          phase: 'TRAINING_STATE_FINAL',
          currentPass,
        };
        await eachDatasetRow(sources.dataset.path, async (row) => {
          if (row.split === 'TRAIN' && row.eligibility.stateModel) {
            trainRecommendationValueV8StateDecision(
              finalStateModel,
              row,
              options.state,
            );
          }
        });
      }

      const actionModel = createRecommendationValueV8ActionModel(
        options.hashDimension,
      );
      for (let epoch = 0; epoch < options.actionEpochs; epoch += 1) {
        currentPass += 1;
        this.status = {
          ...this.status,
          phase: 'TRAINING_ACTION',
          currentPass,
        };
        await eachDatasetRow(sources.dataset.path, async (row) => {
          if (row.split !== 'TRAIN' || !isActionEligible(row)) {
            return;
          }
          const foldId = recommendationValueV8FoldId(
            row.matchId,
            options.foldCount,
          );
          const propensity = requiredPropensity(index, row, sources.dataset.sha256);
          if (propensity.predictionSource !== 'CROSS_FITTED_OOF') {
            throw new Error(
              `TRAIN propensity is not cross-fitted for ${row.decisionId}.`,
            );
          }
          const statePredictions = predictRecommendationValueV8State(
            foldStateModels[foldId],
            row,
            options.state.maximumAbsolutePrediction,
          );
          trainRecommendationValueV8ActionDecision(
            actionModel,
            row,
            statePredictions,
            propensity.observedActionProbability,
            options.action,
          );
        });
      }

      currentPass += 1;
      this.status = {
        ...this.status,
        phase: 'SELECTING',
        currentPass,
      };
      const selection = await evaluateTuningConfigurations({
        sources,
        index,
        stateModel: finalStateModel,
        actionModel,
        options,
      });

      currentPass += 1;
      this.status = {
        ...this.status,
        phase: 'EVALUATING_FUTURE_TEST',
        currentPass,
      };
      const future = await evaluateFutureTest({
        sources,
        index,
        stateModel: finalStateModel,
        actionModel,
        configuration: selection.selected.configuration,
        options,
        predictionPath: this.paths.predictions,
      });
      const releaseGate = buildRecommendationValueV8ReleaseGate(
        future.metrics,
        sources.diagnostic.audit.diagnosticGate.passed,
        options.releaseThresholds,
      );

      this.status = { ...this.status, phase: 'FINALIZING' };
      const generatedAt = new Date().toISOString();
      const modelArtifact = {
        schemaVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
        evaluationVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION,
        generatedAt,
        stateModelVersion: RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION,
        actionModelVersion: RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION,
        featureVersion: RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
        source: {
          datasetSha256: sources.dataset.sha256,
          behavioralPropensitySha256: sources.propensities.sha256,
          diagnosticManifestSha256: sources.diagnostic.manifestSha256,
          baselineSha256: sources.baseline.sha256,
        },
        trainingContract: {
          stateCrossFittingUnit: 'MATCH',
          actionResidualUsesOofStatePrediction: true,
          finalStateModelTrainSplitOnly: true,
          actionModelTrainSplitOnly: true,
          actionObservedCandidateOnly: true,
          finalOutcomeUsedForTraining: false,
        },
        selectedConfiguration: selection.selected.configuration,
        selectedOn: 'TUNING_ONLY',
        options,
        finalStateModel,
        actionModel,
      };
      const evaluation = {
        schemaVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
        evaluationVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION,
        generatedAt,
        selection,
        futureTest: {
          evaluationPassCount: 1,
          metrics: future.metrics,
        },
        releaseGate,
        interpretation: {
          causal: false,
          exactExperimentalAssignmentProbabilitiesAvailable: false,
          allowedUse:
            'Offline selection, untouched future-test validation, and passive shadow authorization.',
          prohibitedUse:
            'Do not authorize randomized canary or interpret observational OPE as causal uplift.',
        },
      };
      await atomicJson(this.paths.model, modelArtifact);
      await atomicJson(this.paths.evaluation, evaluation);

      const predictionSha256 = await hashFile(this.paths.predictions);
      const modelSha256 = await hashFile(this.paths.model);
      const evaluationSha256 = await hashFile(this.paths.evaluation);
      const reasons = structuralReasons(summary, index);
      const auditPassed = reasons.length === 0;
      const passiveShadowAuthorized = auditPassed && releaseGate.passed;
      const audit: RecommendationValueV8FullEvaluationAudit = {
        schemaVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
        evaluationVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION,
        generatedAt,
        passed: auditPassed,
        releaseGatePassed: releaseGate.passed,
        source: {
          datasetSha256: sources.dataset.sha256,
          datasetRowCount: sources.dataset.rowCount,
          behavioralPropensitySha256: sources.propensities.sha256,
          diagnosticManifestSha256: sources.diagnostic.manifestSha256,
          baselineSha256: sources.baseline.sha256,
        },
        diagnostic: {
          auditPassed: true,
          diagnosticGatePassed: true,
          fullTrainingRecommended: true,
          futureTestUsed: false,
        },
        crossFitting: {
          unit: 'MATCH',
          foldCount: options.foldCount,
          foldMatchCounts: summary.trainMatchIdsByFold.map(
            (matches) => matches.size,
          ),
          trainingMatchExclusionVerified: true,
          actionResidualUsesOofStatePrediction: true,
        },
        split: {
          descriptorSha256: sources.dataset.splitDescriptorSha256,
          trainDecisionCount: summary.eligibleBySplit.TRAIN,
          tuningDecisionCount: summary.eligibleBySplit.TUNING,
          futureTestDecisionCount: summary.eligibleBySplit.FUTURE_TEST,
          tuningUsedForSelection: true,
          futureTestUsedForSelection: false,
          futureTestEvaluationPassCount: 1,
        },
        joins: {
          missingBehavioralPropensityCount:
            summary.missingBehavioralPropensityCount,
          missingBaselineCount: summary.missingBaselineCount,
          duplicateDatasetDecisionCount:
            summary.duplicateDatasetDecisionCount,
          duplicateBehavioralDecisionCount:
            index.duplicateBehavioralDecisionCount,
          duplicateBaselineDecisionCount: index.duplicateBaselineDecisionCount,
        },
        artifacts: {
          predictionSha256,
          predictionRowCount: future.rowCount,
          modelSha256,
          evaluationSha256,
        },
        releaseGate,
        reasons,
        passiveShadowAuthorized,
        randomizedCanaryAuthorized: false,
      };
      await atomicJson(this.paths.audit, audit);

      const manifest: RecommendationValueV8FullEvaluationManifest = {
        schemaVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
        evaluationVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION,
        generatedAt,
        source: {
          datasetVersion: RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
          datasetSha256: sources.dataset.sha256,
          behavioralPropensitySha256: sources.propensities.sha256,
          diagnosticManifestSha256: sources.diagnostic.manifestSha256,
          baselineSha256: sources.baseline.sha256,
          splitDescriptorSha256: sources.dataset.splitDescriptorSha256,
        },
        trainingContract: {
          stateModelTrainSplitOnly: true,
          stateCrossFittingUnit: 'MATCH',
          actionResidualUsesOofStatePrediction: true,
          actionModelTrainSplitOnly: true,
          actionObservedCandidateOnly: true,
          tuningUsedForConfigurationSelectionOnly: true,
          futureTestUsedForTraining: false,
          futureTestUsedForSelection: false,
          futureTestEvaluationPassCount: 1,
          finalOutcomeUsedForTraining: false,
          behavioralPropensityRequired: true,
          frozenV6BaselineRequired: true,
          diagnosticGateRequired: true,
        },
        options,
        selectedConfiguration: selection.selected.configuration,
        artifacts: {
          predictions: await artifactDescriptor(
            this.paths.predictions,
            PREDICTION_FILE_NAME,
            'NDJSON',
            future.rowCount,
          ),
          model: await artifactDescriptor(
            this.paths.model,
            'model.json',
            'JSON',
          ),
          evaluation: await artifactDescriptor(
            this.paths.evaluation,
            'evaluation.json',
            'JSON',
          ),
          audit: await artifactDescriptor(
            this.paths.audit,
            'audit.json',
            'JSON',
          ),
        },
        releaseGatePassed: releaseGate.passed,
        passiveShadowAuthorized,
        randomizedCanaryAuthorized: false,
      };
      await atomicJson(this.paths.manifest, manifest);

      this.model = modelArtifact;
      this.evaluation = evaluation;
      this.audit = audit;
      this.manifest = manifest;
      this.status = {
        ...this.status,
        state: 'COMPLETE',
        phase: 'COMPLETE',
        completedAt: generatedAt,
        predictionRowCount: future.rowCount,
        manifestAvailable: true,
        auditAvailable: true,
        evaluationAvailable: true,
        modelAvailable: true,
        releaseGatePassed: releaseGate.passed,
        passiveShadowAuthorized,
        randomizedCanaryAuthorized: false,
      };
      this.logger.log(
        `Recommendation Value V8 full evaluation completed with ${future.rowCount} ` +
          `future-test decisions; release gate ${releaseGate.passed ? 'PASS' : 'FAIL'}.`,
      );
    } catch (error) {
      const message = errorMessage(error);
      this.status = {
        ...this.status,
        state: 'FAILED',
        completedAt: new Date().toISOString(),
        error: message,
      };
      this.logger.error(`Recommendation Value V8 full evaluation failed: ${message}`);
    }
  }

  private async loadSources(
    options: RecommendationValueV8FullEvaluationOptions,
  ): Promise<LoadedSources> {
    const datasetManifest = await requiredJson<RecommendationProDecisionDatasetV6ArtifactManifest>(
      join(this.datasetDirectory, 'manifest.json'),
    );
    const datasetAudit = await requiredJson<RecommendationProDecisionDatasetV6ArtifactAudit>(
      join(this.datasetDirectory, 'audit.json'),
    );
    if (
      datasetManifest.schemaVersion !==
        RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION ||
      datasetManifest.datasetVersion !==
        RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION ||
      datasetManifest.auditPassed !== true ||
      datasetManifest.trainingArtifactEligible !== true ||
      datasetAudit.passed !== true ||
      datasetAudit.trainingArtifactEligible !== true ||
      datasetManifest.featureContract.futureTestEligibleForSelection !== false ||
      datasetManifest.featureContract.userLiveUsedAsInput !== false
    ) {
      throw new Error('Recommendation Dataset V6 is not eligible for full Value V8.');
    }
    const datasetPath = join(
      this.datasetDirectory,
      datasetManifest.artifact.fileName,
    );
    const datasetSha256 = await verifiedHash(
      datasetPath,
      datasetManifest.artifact.sha256,
      options.expectedDatasetSha256,
      'Dataset V6',
    );

    const behavioralManifest = await requiredJson<Record<string, unknown>>(
      join(this.behavioralDirectory, 'manifest.json'),
    );
    const behavioralAudit = await requiredJson<Record<string, unknown>>(
      join(this.behavioralDirectory, 'audit.json'),
    );
    const behavioralEvaluation = await requiredJson<Record<string, unknown>>(
      join(this.behavioralDirectory, 'evaluation.json'),
    );
    if (
      behavioralManifest.auditPassed !== true ||
      behavioralManifest.releaseGatePassed !== true ||
      behavioralManifest.trainingArtifactEligible !== true ||
      behavioralAudit.passed !== true ||
      behavioralAudit.trainingArtifactEligible !== true ||
      record(behavioralEvaluation.releaseGate).passed !== true ||
      record(behavioralManifest.source).sha256 !== datasetSha256
    ) {
      throw new Error('Behavioral V5 is not eligible for full Value V8.');
    }
    const propensityArtifact = record(
      record(behavioralManifest.artifacts).propensities,
    );
    const propensityPath = join(
      this.behavioralDirectory,
      text(propensityArtifact.fileName) || PROPENSITY_FILE_NAME,
    );
    const propensitySha256 = await verifiedHash(
      propensityPath,
      requiredSha(propensityArtifact.sha256, 'Behavioral propensity SHA-256'),
      options.expectedBehavioralPropensitySha256,
      'Behavioral V5 propensities',
    );

    const diagnosticManifestPath = join(
      this.diagnosticDirectory,
      'manifest.json',
    );
    const diagnosticManifest = await requiredJson<DiagnosticTrainingManifest>(
      diagnosticManifestPath,
    );
    const diagnosticAudit = await requiredJson<DiagnosticTrainingAudit>(
      join(this.diagnosticDirectory, 'audit.json'),
    );
    const diagnosticManifestSha256 = await hashFile(diagnosticManifestPath);
    if (
      options.expectedDiagnosticManifestSha256 &&
      options.expectedDiagnosticManifestSha256 !== diagnosticManifestSha256
    ) {
      throw new Error('Value V8 diagnostic manifest SHA-256 mismatch.');
    }
    if (
      diagnosticManifest.schemaVersion !==
        RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION ||
      diagnosticAudit.schemaVersion !==
        RECOMMENDATION_VALUE_V8_DIAGNOSTIC_SCHEMA_VERSION ||
      diagnosticManifest.auditPassed !== true ||
      diagnosticManifest.diagnosticGatePassed !== true ||
      diagnosticManifest.fullTrainingRecommended !== true ||
      diagnosticManifest.diagnosticOnly !== true ||
      diagnosticManifest.futureTestUsed !== false ||
      diagnosticAudit.passed !== true ||
      diagnosticAudit.fullTrainingRecommended !== true ||
      diagnosticAudit.diagnosticGate.passed !== true ||
      diagnosticAudit.diagnosticGate.fullTrainingRecommended !== true ||
      diagnosticAudit.leakage.futureTestUsedForTraining !== false ||
      diagnosticAudit.leakage.futureTestUsedForSelection !== false ||
      diagnosticAudit.leakage.finalOutcomeUsedForTraining !== false ||
      diagnosticManifest.source.dataset.sha256 !== datasetSha256 ||
      diagnosticManifest.source.behavioral.sha256 !== propensitySha256 ||
      diagnosticAudit.source.datasetSha256 !== datasetSha256 ||
      diagnosticAudit.source.behavioralPropensitySha256 !== propensitySha256
    ) {
      throw new Error('Real-data Value V8 diagnostic did not authorize full training.');
    }

    const baselineManifest = await requiredJson<RecommendationV6ShortOnlyBaselineManifest>(
      join(this.baselineDirectory, 'manifest.json'),
    );
    validateRecommendationV6ShortOnlyBaselineManifest(
      baselineManifest,
      datasetSha256,
      datasetManifest.splitDescriptor.sha256,
    );
    const baselinePath = join(
      this.baselineDirectory,
      baselineManifest.artifact.fileName || BASELINE_FILE_NAME,
    );
    const baselineSha256 = await verifiedHash(
      baselinePath,
      baselineManifest.artifact.sha256,
      options.expectedBaselineSha256,
      'Frozen V6 baseline',
    );

    return {
      dataset: {
        path: datasetPath,
        sha256: datasetSha256,
        rowCount: datasetManifest.artifact.rowCount,
        splitDescriptorSha256: datasetManifest.splitDescriptor.sha256,
      },
      propensities: { path: propensityPath, sha256: propensitySha256 },
      diagnostic: {
        manifestSha256: diagnosticManifestSha256,
        manifest: diagnosticManifest,
        audit: diagnosticAudit,
      },
      baseline: {
        path: baselinePath,
        sha256: baselineSha256,
        manifest: baselineManifest,
      },
    };
  }

  private async clearOutputs(): Promise<void> {
    await Promise.all(
      Object.values(this.paths).flatMap((path) => [
        rm(path, { force: true }),
        rm(`${path}.partial`, { force: true }),
      ]),
    );
  }

  private idleStatus(): RecommendationValueV8FullEvaluationStatus {
    return {
      state: 'IDLE',
      phase: 'PREPARING',
      currentPass: 0,
      totalPasses: 0,
      sourceRowCount: 0,
      trainDecisionCount: 0,
      tuningDecisionCount: 0,
      futureTestDecisionCount: 0,
      predictionRowCount: 0,
      outputDirectory: this.outputDirectory,
      manifestAvailable: false,
      auditAvailable: false,
      evaluationAvailable: false,
      modelAvailable: false,
      randomizedCanaryAuthorized: false,
    };
  }
}

async function evaluateTuningConfigurations(input: {
  sources: LoadedSources;
  index: SourceIndex;
  stateModel: RecommendationValueV8StateModel;
  actionModel: RecommendationValueV8ActionModel;
  options: RecommendationValueV8FullEvaluationOptions;
}): Promise<RecommendationValueV8Selection> {
  const configurations = input.options.actionScales.flatMap((actionScale) =>
    input.options.policyTemperatures.map((policyTemperature) => ({
      actionScale,
      policyTemperature,
    })),
  );
  const accumulators = configurations.map((configuration) => ({
    configuration,
    accumulator: createRecommendationValueV8EvaluationAccumulator('TUNING'),
  }));
  await eachDatasetRow(input.sources.dataset.path, async (row) => {
    if (row.split !== 'TUNING' || !isEvaluationEligible(row)) {
      return;
    }
    const propensity = requiredPropensity(
      input.index,
      row,
      input.sources.dataset.sha256,
    );
    const baseline = requiredBaseline(input.index, row);
    const statePredictions = predictRecommendationValueV8State(
      input.stateModel,
      row,
      input.options.state.maximumAbsolutePrediction,
    );
    const candidatePrediction = predictRecommendationValueV8CandidateSet(
      input.actionModel,
      row,
      input.options.action.maximumAbsoluteResidual,
    );
    for (const entry of accumulators) {
      const evaluation = evaluateRecommendationValueV8Decision({
        row,
        propensity,
        baseline,
        statePredictions,
        candidatePrediction,
        options: evaluationOptions(input.options, entry.configuration),
        sourceModelSha256:
          input.sources.baseline.manifest.sourceModel.sha256,
        sourceDatasetSha256: input.sources.dataset.sha256,
        splitDescriptorSha256:
          input.sources.dataset.splitDescriptorSha256,
      });
      observeRecommendationValueV8Evaluation(entry.accumulator, evaluation);
    }
  });
  return selectRecommendationValueV8Configuration(
    accumulators.map((entry) => ({
      configuration: entry.configuration,
      metrics: finalizeRecommendationValueV8Evaluation(
        entry.accumulator,
        evaluationOptions(input.options, entry.configuration),
      ),
    })),
  );
}

async function evaluateFutureTest(input: {
  sources: LoadedSources;
  index: SourceIndex;
  stateModel: RecommendationValueV8StateModel;
  actionModel: RecommendationValueV8ActionModel;
  configuration: RecommendationValueV8Configuration;
  options: RecommendationValueV8FullEvaluationOptions;
  predictionPath: string;
}): Promise<{ rowCount: number; metrics: RecommendationValueV8EvaluationMetrics }> {
  const accumulator = createRecommendationValueV8EvaluationAccumulator(
    'FUTURE_TEST',
  );
  const partialPath = `${input.predictionPath}.partial`;
  const writer = await LineWriter.create(partialPath);
  let rowCount = 0;
  try {
    await eachDatasetRow(input.sources.dataset.path, async (row) => {
      if (row.split !== 'FUTURE_TEST' || !isEvaluationEligible(row)) {
        return;
      }
      const propensity = requiredPropensity(
        input.index,
        row,
        input.sources.dataset.sha256,
      );
      const baseline = requiredBaseline(input.index, row);
      const statePredictions = predictRecommendationValueV8State(
        input.stateModel,
        row,
        input.options.state.maximumAbsolutePrediction,
      );
      const candidatePrediction = predictRecommendationValueV8CandidateSet(
        input.actionModel,
        row,
        input.options.action.maximumAbsoluteResidual,
      );
      const evaluation = evaluateRecommendationValueV8Decision({
        row,
        propensity,
        baseline,
        statePredictions,
        candidatePrediction,
        options: evaluationOptions(input.options, input.configuration),
        sourceModelSha256:
          input.sources.baseline.manifest.sourceModel.sha256,
        sourceDatasetSha256: input.sources.dataset.sha256,
        splitDescriptorSha256:
          input.sources.dataset.splitDescriptorSha256,
      });
      observeRecommendationValueV8Evaluation(accumulator, evaluation);
      await writer.write(evaluation);
      rowCount += 1;
    });
    await writer.close();
    await rename(partialPath, input.predictionPath);
  } catch (error) {
    await writer.abort();
    await rm(partialPath, { force: true });
    throw error;
  }
  return {
    rowCount,
    metrics: finalizeRecommendationValueV8Evaluation(
      accumulator,
      evaluationOptions(input.options, input.configuration),
    ),
  };
}

function evaluationOptions(
  options: RecommendationValueV8FullEvaluationOptions,
  configuration: RecommendationValueV8Configuration,
) {
  return {
    configuration,
    maximumImportanceWeight: options.action.maximumImportanceWeight,
    cohortMinimumDecisions: options.cohortMinimumDecisions,
    criticalCohortRmseTolerance: options.criticalCohortRmseTolerance,
  };
}

async function buildSourceIndex(sources: LoadedSources): Promise<SourceIndex> {
  const propensities = new Map<string, RecommendationBehavioralV5PropensityRow>();
  const baselines = new Map<string, RecommendationV6ShortOnlyBaselineRow>();
  let duplicateBehavioralDecisionCount = 0;
  let duplicateBaselineDecisionCount = 0;
  for await (const value of ndjson(sources.propensities.path)) {
    const row = value as RecommendationBehavioralV5PropensityRow;
    if (propensities.has(row.decisionId)) {
      duplicateBehavioralDecisionCount += 1;
    }
    propensities.set(row.decisionId, row);
  }
  for await (const value of ndjson(sources.baseline.path)) {
    const row = value as RecommendationV6ShortOnlyBaselineRow;
    if (baselines.has(row.decisionId)) {
      duplicateBaselineDecisionCount += 1;
    }
    baselines.set(row.decisionId, row);
  }
  return {
    propensities,
    baselines,
    duplicateBehavioralDecisionCount,
    duplicateBaselineDecisionCount,
  };
}

async function scanDataset(
  sources: LoadedSources,
  index: SourceIndex,
  foldCount: number,
): Promise<SourceSummary> {
  const decisionIds = new Set<string>();
  const eligibleBySplit: Record<RecommendationDatasetV6Split, number> = {
    TRAIN: 0,
    TUNING: 0,
    FUTURE_TEST: 0,
  };
  const trainMatchIdsByFold = Array.from(
    { length: foldCount },
    () => new Set<string>(),
  );
  let sourceRowCount = 0;
  let duplicateDatasetDecisionCount = 0;
  let missingBehavioralPropensityCount = 0;
  let missingBaselineCount = 0;
  await eachDatasetRow(sources.dataset.path, async (row) => {
    sourceRowCount += 1;
    if (decisionIds.has(row.decisionId)) {
      duplicateDatasetDecisionCount += 1;
    }
    decisionIds.add(row.decisionId);
    if (!isTrainEligible(row)) {
      return;
    }
    eligibleBySplit[row.split] += 1;
    if (!index.propensities.has(row.decisionId)) {
      missingBehavioralPropensityCount += 1;
    }
    if (row.split === 'TRAIN') {
      trainMatchIdsByFold[
        recommendationValueV8FoldId(row.matchId, foldCount)
      ].add(row.matchId);
    } else if (!index.baselines.has(row.decisionId)) {
      missingBaselineCount += 1;
    }
  });
  return {
    sourceRowCount,
    eligibleBySplit,
    duplicateDatasetDecisionCount,
    missingBehavioralPropensityCount,
    missingBaselineCount,
    trainMatchIdsByFold,
  };
}

function validateSourceSummary(
  summary: SourceSummary,
  index: SourceIndex,
  expectedRowCount: number,
): void {
  const reasons = structuralReasons(summary, index);
  if (summary.sourceRowCount !== expectedRowCount) {
    reasons.push('Dataset V6 row count does not match its manifest.');
  }
  if (summary.eligibleBySplit.TRAIN === 0) {
    reasons.push('No eligible TRAIN decisions are available.');
  }
  if (summary.eligibleBySplit.TUNING === 0) {
    reasons.push('No eligible TUNING decisions are available.');
  }
  if (summary.eligibleBySplit.FUTURE_TEST === 0) {
    reasons.push('No eligible FUTURE_TEST decisions are available.');
  }
  if (summary.trainMatchIdsByFold.some((matches) => matches.size === 0)) {
    reasons.push('Every Value V8 cross-fitting fold must contain a TRAIN match.');
  }
  if (reasons.length > 0) {
    throw new Error(
      `Value V8 full evaluation source validation failed: ${reasons.join(' ')}`,
    );
  }
}

function structuralReasons(
  summary: SourceSummary,
  index: SourceIndex,
): string[] {
  const reasons: string[] = [];
  if (summary.duplicateDatasetDecisionCount > 0) {
    reasons.push('Dataset V6 contains duplicate decision IDs.');
  }
  if (index.duplicateBehavioralDecisionCount > 0) {
    reasons.push('Behavioral V5 propensities contain duplicate decision IDs.');
  }
  if (index.duplicateBaselineDecisionCount > 0) {
    reasons.push('Frozen V6 baseline contains duplicate decision IDs.');
  }
  if (summary.missingBehavioralPropensityCount > 0) {
    reasons.push('Eligible decisions are missing Behavioral V5 propensities.');
  }
  if (summary.missingBaselineCount > 0) {
    reasons.push('Evaluation decisions are missing frozen V6 baseline rows.');
  }
  return reasons;
}

function requiredPropensity(
  index: SourceIndex,
  row: RecommendationProDecisionDatasetV6Row,
  datasetSha256: string,
): RecommendationBehavioralV5PropensityRow {
  const propensity = index.propensities.get(row.decisionId);
  if (!propensity) {
    throw new Error(`Behavioral V5 propensity is missing for ${row.decisionId}.`);
  }
  if (
    propensity.matchId !== row.matchId ||
    propensity.split !== row.split ||
    propensity.observedActionKey !== row.observedActionKey ||
    propensity.sourceDatasetSha256 !== datasetSha256 ||
    propensity.trainingMatchExcluded !== true
  ) {
    throw new Error(`Behavioral V5 propensity mismatch for ${row.decisionId}.`);
  }
  return propensity;
}

function requiredBaseline(
  index: SourceIndex,
  row: RecommendationProDecisionDatasetV6Row,
): RecommendationV6ShortOnlyBaselineRow {
  const baseline = index.baselines.get(row.decisionId);
  if (!baseline) {
    throw new Error(`Frozen V6 baseline is missing for ${row.decisionId}.`);
  }
  return baseline;
}

function isTrainEligible(row: RecommendationProDecisionDatasetV6Row): boolean {
  return row.eligibility.stateModel && isActionEligible(row);
}

function isActionEligible(row: RecommendationProDecisionDatasetV6Row): boolean {
  return (
    row.eligibility.actionModel &&
    row.observedActionInCandidateSet &&
    row.candidates.length >= 2 &&
    row.candidates.every((candidate) => candidate.catalogMetadataAvailable) &&
    Object.keys(recommendationValueV8Targets(row)).length > 0
  );
}

function isEvaluationEligible(
  row: RecommendationProDecisionDatasetV6Row,
): boolean {
  return isTrainEligible(row);
}

async function eachDatasetRow(
  path: string,
  callback: (row: RecommendationProDecisionDatasetV6Row) => Promise<void>,
): Promise<void> {
  let line = 0;
  for await (const value of ndjson(path)) {
    line += 1;
    const row = datasetRow(value, line);
    await callback(row);
    if (line % 10_000 === 0) {
      await tick();
    }
  }
}

function datasetRow(
  value: unknown,
  line: number,
): RecommendationProDecisionDatasetV6Row {
  if (
    !isRecord(value) ||
    value.schemaVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION ||
    value.datasetVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION ||
    value.dataSource !== 'PRO_HISTORICAL' ||
    typeof value.decisionId !== 'string' ||
    typeof value.matchId !== 'string' ||
    !['TRAIN', 'TUNING', 'FUTURE_TEST'].includes(String(value.split)) ||
    !Array.isArray(value.candidates) ||
    !isRecord(value.state) ||
    !isRecord(value.eligibility)
  ) {
    throw new Error(`Invalid Recommendation Dataset V6 row at line ${line}.`);
  }
  return value as unknown as RecommendationProDecisionDatasetV6Row;
}

function normalizeOptions(
  request: RecommendationValueV8FullEvaluationStartRequest,
): RecommendationValueV8FullEvaluationOptions {
  return {
    foldCount: integer(request.foldCount, 5, 2, 20, 'foldCount'),
    stateEpochs: integer(request.stateEpochs, 3, 1, 20, 'stateEpochs'),
    actionEpochs: integer(request.actionEpochs, 3, 1, 20, 'actionEpochs'),
    hashDimension: integer(
      request.hashDimension,
      16_384,
      256,
      262_144,
      'hashDimension',
    ),
    state: {
      learningRate: finite(request.stateLearningRate, 0.03, 1e-6, 1),
      l2: finite(request.stateL2, 1e-5, 0, 1),
      maximumAbsolutePrediction: finite(
        request.maximumAbsolutePrediction,
        1,
        0.01,
        10,
      ),
    },
    action: {
      learningRate: finite(request.actionLearningRate, 0.02, 1e-6, 1),
      l2: finite(request.actionL2, 1e-5, 0, 1),
      maximumAbsoluteResidual: finite(
        request.maximumAbsoluteResidual,
        1,
        0.01,
        10,
      ),
      propensityFloor: finite(request.propensityFloor, 0.01, 1e-6, 0.5),
      maximumImportanceWeight: finite(
        request.maximumImportanceWeight,
        20,
        1,
        1_000,
      ),
    },
    actionScales: numericGrid(
      request.actionScales,
      [0.25, 0.5, 0.75, 1],
      0,
      5,
      'actionScales',
    ),
    policyTemperatures: numericGrid(
      request.policyTemperatures,
      [0.25, 0.5, 1],
      0.01,
      10,
      'policyTemperatures',
    ),
    cohortMinimumDecisions: integer(
      request.cohortMinimumDecisions,
      100,
      1,
      100_000,
      'cohortMinimumDecisions',
    ),
    criticalCohortRmseTolerance: finite(
      request.criticalCohortRmseTolerance,
      0,
      0,
      1,
    ),
    releaseThresholds: normalizeReleaseThresholds(request.releaseThresholds),
    expectedDatasetSha256: optionalSha(request.expectedDatasetSha256),
    expectedBehavioralPropensitySha256: optionalSha(
      request.expectedBehavioralPropensitySha256,
    ),
    expectedDiagnosticManifestSha256: optionalSha(
      request.expectedDiagnosticManifestSha256,
    ),
    expectedBaselineSha256: optionalSha(request.expectedBaselineSha256),
  };
}

function normalizeReleaseThresholds(
  value: Partial<RecommendationValueV8ReleaseThresholds> | undefined,
): RecommendationValueV8ReleaseThresholds {
  return {
    minimumCandidateCoverage: finite(
      value?.minimumCandidateCoverage,
      0.99,
      0,
      1,
    ),
    minimumBehaviorSupport: finite(
      value?.minimumBehaviorSupport,
      0.9,
      0,
      1,
    ),
    minimumEssRatio: finite(value?.minimumEssRatio, 0.5, 0, 1),
    maximumClippedWeightRate: finite(
      value?.maximumClippedWeightRate,
      0.05,
      0,
      1,
    ),
    minimumStateRmseImprovement: finite(
      value?.minimumStateRmseImprovement,
      0,
      -1,
      1,
    ),
    minimumBaselineRmseImprovement: finite(
      value?.minimumBaselineRmseImprovement,
      0,
      -1,
      1,
    ),
    minimumCandidateSeparation: finite(
      value?.minimumCandidateSeparation,
      0.001,
      0,
      10,
    ),
    minimumDrUpliftLower95: finite(
      value?.minimumDrUpliftLower95,
      0,
      -10,
      10,
    ),
    maximumCriticallyNegativeMajorCohorts: integer(
      value?.maximumCriticallyNegativeMajorCohorts,
      0,
      0,
      100_000,
      'maximumCriticallyNegativeMajorCohorts',
    ),
  };
}

function numericGrid(
  value: number[] | undefined,
  fallback: number[],
  minimum: number,
  maximum: number,
  label: string,
): number[] {
  const result = value ?? fallback;
  if (
    result.length === 0 ||
    result.length > 100 ||
    result.some(
      (entry) =>
        !Number.isFinite(entry) || entry < minimum || entry > maximum,
    )
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return [...new Set(result)].sort((left, right) => left - right);
}

function integer(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return result;
}

function finite(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new Error(`Expected a finite number in [${minimum}, ${maximum}].`);
  }
  return result;
}

function optionalSha(value: string | undefined): string | undefined {
  return value === undefined ? undefined : requiredSha(value, 'Expected SHA-256');
}

async function verifiedHash(
  path: string,
  manifestSha256: string,
  expectedSha256: string | undefined,
  label: string,
): Promise<string> {
  const actual = await hashFile(path);
  if (actual !== manifestSha256) {
    throw new Error(`${label} manifest SHA-256 mismatch.`);
  }
  if (expectedSha256 && expectedSha256 !== actual) {
    throw new Error(`${label} expected SHA-256 mismatch.`);
  }
  return actual;
}

async function artifactDescriptor(
  path: string,
  fileName: string,
  format: 'JSON',
): Promise<ArtifactDescriptor & { format: 'JSON' }>;
async function artifactDescriptor(
  path: string,
  fileName: string,
  format: 'NDJSON',
  rowCount: number,
): Promise<ArtifactDescriptor & { format: 'NDJSON'; rowCount: number }>;
async function artifactDescriptor(
  path: string,
  fileName: string,
  format: 'JSON' | 'NDJSON',
  rowCount?: number,
): Promise<
  | (ArtifactDescriptor & { format: 'JSON' })
  | (ArtifactDescriptor & { format: 'NDJSON'; rowCount: number })
> {
  const base = {
    fileName,
    sha256: await hashFile(path),
    byteLength: (await stat(path)).size,
  };
  return format === 'NDJSON'
    ? { ...base, format, rowCount: rowCount ?? 0 }
    : { ...base, format };
}

async function requiredJson<T>(path: string): Promise<T> {
  const value = await readJson<T>(path);
  if (!value) {
    throw new Error(`Required JSON artifact is missing: ${path}.`);
  }
  return value;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const partial = `${path}.partial`;
  await writeFile(partial, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(partial, path);
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function* ndjson(path: string): AsyncGenerator<unknown> {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim()) {
      yield JSON.parse(line) as unknown;
    }
  }
}

class LineWriter {
  private constructor(private readonly handle: FileHandle) {}

  static async create(path: string): Promise<LineWriter> {
    return new LineWriter(await open(path, 'w'));
  }

  async write(value: unknown): Promise<void> {
    await this.handle.write(`${JSON.stringify(value)}\n`);
  }

  async close(): Promise<void> {
    await this.handle.close();
  }

  async abort(): Promise<void> {
    await this.handle.close().catch(() => undefined);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function requiredSha(value: unknown, label: string): string {
  const result = text(value);
  if (!result || !/^[a-f0-9]{64}$/.test(result)) {
    throw new Error(`${label} is invalid.`);
  }
  return result;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
