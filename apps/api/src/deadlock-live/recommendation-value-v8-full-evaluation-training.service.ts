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
import type {
  RecommendationBehavioralV5PropensityRow,
} from './recommendation-behavioral-v5-training.service';
import type {
  RecommendationProDecisionDatasetV6ArtifactAudit,
  RecommendationProDecisionDatasetV6ArtifactManifest,
} from './recommendation-pro-decision-dataset-v6-artifact.service';
import {
  RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
  type RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';
import {
  createRecommendationValueV8ActionModel,
  createRecommendationValueV8StateModel,
  predictRecommendationValueV8CandidateSet,
  predictRecommendationValueV8State,
  recommendationValueV8Targets,
  trainRecommendationValueV8ActionDecision,
  trainRecommendationValueV8StateDecision,
  RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION,
  RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
  RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION,
  type RecommendationValueV8ActionModel,
  type RecommendationValueV8ActionTrainingOptions,
  type RecommendationValueV8HorizonValues,
  type RecommendationValueV8StateModel,
  type RecommendationValueV8StateTrainingOptions,
} from './recommendation-value-v8-diagnostic';
import type {
  RecommendationValueV8DiagnosticTrainingAudit,
  RecommendationValueV8DiagnosticTrainingManifest,
} from './recommendation-value-v8-diagnostic-training.service';
import {
  buildRecommendationValueV8ReleaseGate,
  createRecommendationValueV8EvaluationAccumulator,
  evaluateRecommendationValueV8Decision,
  finalizeRecommendationValueV8Evaluation,
  selectRecommendationValueV8Configuration,
  validateRecommendationV6ShortOnlyBaselineManifest,
  validateRecommendationV6ShortOnlyBaselineRow,
  RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
  RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION,
  type RecommendationV6ShortOnlyBaselineManifest,
  type RecommendationV6ShortOnlyBaselineRow,
  type RecommendationValueV8Configuration,
  type RecommendationValueV8DecisionEvaluation,
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

const DATASET_FILE_NAME = 'dataset.ndjson';
const PROPENSITY_FILE_NAME = 'propensities.ndjson';
const BASELINE_FILE_NAME = 'predictions.ndjson';
const PREDICTION_FILE_NAME = 'predictions.ndjson';

export interface RecommendationValueV8FullEvaluationStartRequest {
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
    | 'TRAINING_STATE'
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
    fullTrainingRecommended: true;
    futureTestUsed: false;
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
    actionModelTrainSplitOnly: true;
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
    manifestPath: string;
    manifestSha256: string;
    manifest: RecommendationValueV8DiagnosticTrainingManifest;
    audit: RecommendationValueV8DiagnosticTrainingAudit;
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
  trainRows: RecommendationProDecisionDatasetV6Row[];
  tuningRows: RecommendationProDecisionDatasetV6Row[];
  futureTestRows: RecommendationProDecisionDatasetV6Row[];
  duplicateDatasetDecisionCount: number;
  missingBehavioralPropensityCount: number;
  missingBaselineCount: number;
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
      totalPasses: options.stateEpochs + options.actionEpochs + 2,
      startedAt,
      options,
    };
    this.runPromise = this.run(options, startedAt);
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
    startedAt: string,
  ): Promise<void> {
    try {
      const sources = await this.loadSources(options);
      await this.clearOutputs();
      this.manifest = undefined;
      this.audit = undefined;
      this.evaluation = undefined;
      this.model = undefined;

      const index = await buildSourceIndex(sources);
      const summary = await collectSourceSummary(sources, index);
      validateSourceSummary(summary, index);
      this.status = {
        ...this.status,
        sourceRowCount: summary.sourceRowCount,
        trainDecisionCount: summary.trainRows.length,
        tuningDecisionCount: summary.tuningRows.length,
        futureTestDecisionCount: summary.futureTestRows.length,
      };

      const stateModel = createRecommendationValueV8StateModel(
        options.hashDimension,
      );
      let currentPass = 0;
      for (let epoch = 0; epoch < options.stateEpochs; epoch += 1) {
        currentPass += 1;
        this.status = {
          ...this.status,
          phase: 'TRAINING_STATE',
          currentPass,
        };
        for (const row of summary.trainRows) {
          if (row.eligibility.stateModel) {
            trainRecommendationValueV8StateDecision(stateModel, row, options.state);
          }
        }
        await tick();
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
        for (const row of summary.trainRows) {
          if (!isActionEligible(row)) {
            continue;
          }
          const propensity = requiredPropensity(index, row);
          const statePrediction = predictRecommendationValueV8State(
            stateModel,
            row,
            options.state.maximumAbsolutePrediction,
          );
          trainRecommendationValueV8ActionDecision(
            actionModel,
            row,
            statePrediction,
            propensity.observedActionProbability,
            options.action,
          );
        }
        await tick();
      }

      currentPass += 1;
      this.status = {
        ...this.status,
        phase: 'SELECTING',
        currentPass,
      };
      const tuningSelection = evaluateTuningConfigurations({
        rows: summary.tuningRows,
        stateModel,
        actionModel,
        index,
        sources,
        options,
      });

      currentPass += 1;
      this.status = {
        ...this.status,
        phase: 'EVALUATING_FUTURE_TEST',
        currentPass,
      };
      const predictionWriter = await LineWriter.create(
        `${this.paths.predictions}.partial`,
      );
      const futureAccumulator = createRecommendationValueV8EvaluationAccumulator(
        'FUTURE_TEST',
      );
      let predictionRowCount = 0;
      try {
        for (const row of summary.futureTestRows) {
          const decision = evaluateRow({
            row,
            stateModel,
            actionModel,
            configuration: tuningSelection.selected.configuration,
            index,
            sources,
            options,
          });
          await predictionWriter.write(decision);
          predictionRowCount += 1;
          observeDecision(futureAccumulator, decision);
        }
        await predictionWriter.close();
        await rename(
          `${this.paths.predictions}.partial`,
          this.paths.predictions,
        );
      } catch (error) {
        await predictionWriter.abort();
        await rm(`${this.paths.predictions}.partial`, { force: true });
        throw error;
      }
      const futureMetrics = finalizeRecommendationValueV8Evaluation(
        futureAccumulator,
        options.cohortMinimumDecisions,
        options.criticalCohortRmseTolerance,
      );
      const releaseGate = buildRecommendationValueV8ReleaseGate(
        sources.diagnostic.audit.gate,
        futureMetrics,
        options.releaseThresholds,
      );

      this.status = {
        ...this.status,
        phase: 'FINALIZING',
      };
      const generatedAt = new Date().toISOString();
      const modelArtifact = buildModelArtifact({
        generatedAt,
        sources,
        stateModel,
        actionModel,
        selection: tuningSelection,
        options,
      });
      const evaluation = {
        schemaVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
        evaluationVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION,
        generatedAt,
        selectedOn: 'TUNING_ONLY',
        tuning: tuningSelection,
        futureTest: {
          evaluationPassCount: 1,
          metrics: futureMetrics,
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
          fullTrainingRecommended: true,
          futureTestUsed: false,
        },
        split: {
          descriptorSha256: sources.dataset.splitDescriptorSha256,
          trainDecisionCount: summary.trainRows.length,
          tuningDecisionCount: summary.tuningRows.length,
          futureTestDecisionCount: summary.futureTestRows.length,
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
          predictionRowCount,
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
          actionModelTrainSplitOnly: true,
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
        selectedConfiguration: tuningSelection.selected.configuration,
        artifacts: {
          predictions: {
            format: 'NDJSON',
            fileName: PREDICTION_FILE_NAME,
            sha256: predictionSha256,
            byteLength: (await stat(this.paths.predictions)).size,
            rowCount: predictionRowCount,
          },
          model: {
            format: 'JSON',
            fileName: 'model.json',
            sha256: modelSha256,
            byteLength: (await stat(this.paths.model)).size,
          },
          evaluation: {
            format: 'JSON',
            fileName: 'evaluation.json',
            sha256: evaluationSha256,
            byteLength: (await stat(this.paths.evaluation)).size,
          },
          audit: {
            format: 'JSON',
            fileName: 'audit.json',
            sha256: await hashFile(this.paths.audit),
            byteLength: (await stat(this.paths.audit)).size,
          },
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
        predictionRowCount,
        manifestAvailable: true,
        auditAvailable: true,
        evaluationAvailable: true,
        modelAvailable: true,
        releaseGatePassed: releaseGate.passed,
        passiveShadowAuthorized,
        randomizedCanaryAuthorized: false,
      };
      this.logger.log(
        `Recommendation Value V8 full evaluation completed with ${predictionRowCount} ` +
          `future-test predictions; release gate ${releaseGate.passed ? 'PASS' : 'FAIL'}.`,
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
      datasetManifest.datasetVersion !==
        RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION ||
      datasetManifest.auditPassed !== true ||
      datasetManifest.trainingArtifactEligible !== true ||
      datasetAudit.passed !== true ||
      datasetAudit.trainingArtifactEligible !== true
    ) {
      throw new Error('Recommendation Dataset V6 is not eligible for Value V8 full evaluation.');
    }
    const datasetPath = join(
      this.datasetDirectory,
      datasetManifest.artifact.fileName || DATASET_FILE_NAME,
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
    if (
      behavioralManifest.trainingArtifactEligible !== true ||
      behavioralAudit.trainingArtifactEligible !== true
    ) {
      throw new Error('Behavioral V5 is not eligible for Value V8 full evaluation.');
    }
    const behavioralArtifacts = record(behavioralManifest.artifacts);
    const propensityDescriptor = record(behavioralArtifacts.propensities);
    const propensityPath = join(
      this.behavioralDirectory,
      text(propensityDescriptor.fileName) || PROPENSITY_FILE_NAME,
    );
    const propensitySha256 = await verifiedHash(
      propensityPath,
      requiredSha(propensityDescriptor.sha256, 'Behavioral propensity SHA-256'),
      options.expectedBehavioralPropensitySha256,
      'Behavioral V5 propensities',
    );

    const diagnosticManifestPath = join(
      this.diagnosticDirectory,
      'manifest.json',
    );
    const diagnosticManifest = await requiredJson<RecommendationValueV8DiagnosticTrainingManifest>(
      diagnosticManifestPath,
    );
    const diagnosticAudit = await requiredJson<RecommendationValueV8DiagnosticTrainingAudit>(
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
      diagnosticAudit.passed !== true ||
      diagnosticAudit.gate.passed !== true ||
      diagnosticAudit.gate.fullTrainingRecommended !== true ||
      diagnosticManifest.fullTrainingRecommended !== true ||
      diagnosticManifest.source.datasetSha256 !== datasetSha256 ||
      diagnosticManifest.source.behavioralPropensitySha256 !== propensitySha256
    ) {
      throw new Error('Value V8 real-data diagnostic did not authorize full training.');
    }

    const baselineManifestPath = join(this.baselineDirectory, 'manifest.json');
    const baselineManifest = await requiredJson<RecommendationV6ShortOnlyBaselineManifest>(
      baselineManifestPath,
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
      propensities: {
        path: propensityPath,
        sha256: propensitySha256,
      },
      diagnostic: {
        manifestPath: diagnosticManifestPath,
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

function evaluateTuningConfigurations(input: {
  rows: readonly RecommendationProDecisionDatasetV6Row[];
  stateModel: RecommendationValueV8StateModel;
  actionModel: RecommendationValueV8ActionModel;
  index: SourceIndex;
  sources: LoadedSources;
  options: RecommendationValueV8FullEvaluationOptions;
}): RecommendationValueV8Selection {
  const candidates = input.options.actionScales.flatMap((actionScale) =>
    input.options.policyTemperatures.map((policyTemperature) => {
      const configuration = { actionScale, policyTemperature };
      const accumulator = createRecommendationValueV8EvaluationAccumulator(
        'TUNING',
      );
      for (const row of input.rows) {
        const decision = evaluateRow({
          row,
          stateModel: input.stateModel,
          actionModel: input.actionModel,
          configuration,
          index: input.index,
          sources: input.sources,
          options: input.options,
        });
        observeDecision(accumulator, decision);
      }
      return finalizeRecommendationValueV8Evaluation(
        accumulator,
        input.options.cohortMinimumDecisions,
        input.options.criticalCohortRmseTolerance,
      );
    }),
  );
  return selectRecommendationValueV8Configuration(
    candidates.map((metrics, index) => ({
      configuration: {
        actionScale:
          input.options.actionScales[
            Math.floor(index / input.options.policyTemperatures.length)
          ],
        policyTemperature:
          input.options.policyTemperatures[
            index % input.options.policyTemperatures.length
          ],
      },
      metrics,
    })),
  );
}

function evaluateRow(input: {
  row: RecommendationProDecisionDatasetV6Row;
  stateModel: RecommendationValueV8StateModel;
  actionModel: RecommendationValueV8ActionModel;
  configuration: RecommendationValueV8Configuration;
  index: SourceIndex;
  sources: LoadedSources;
  options: RecommendationValueV8FullEvaluationOptions;
}): RecommendationValueV8DecisionEvaluation {
  const propensity = requiredPropensity(input.index, input.row);
  const baseline = requiredBaseline(input.index, input.row);
  validateRecommendationV6ShortOnlyBaselineRow(
    baseline,
    input.row,
    input.sources.baseline.manifest.sourceModel.sha256,
    input.sources.dataset.sha256,
    input.sources.dataset.splitDescriptorSha256,
  );
  const statePrediction = predictRecommendationValueV8State(
    input.stateModel,
    input.row,
    input.options.state.maximumAbsolutePrediction,
  );
  const candidatePrediction = predictRecommendationValueV8CandidateSet(
    input.actionModel,
    input.row,
    input.options.action.maximumAbsoluteResidual,
  );
  return evaluateRecommendationValueV8Decision({
    row: input.row,
    statePrediction,
    candidatePrediction,
    behavioralPropensity: propensity,
    baseline,
    options: {
      configuration: input.configuration,
      maximumImportanceWeight: input.options.action.maximumImportanceWeight,
      cohortMinimumDecisions: input.options.cohortMinimumDecisions,
      criticalCohortRmseTolerance:
        input.options.criticalCohortRmseTolerance,
    },
  });
}

function observeDecision(
  accumulator: ReturnType<typeof createRecommendationValueV8EvaluationAccumulator>,
  decision: RecommendationValueV8DecisionEvaluation,
): void {
  const fn = (globalThis as unknown as {
    __recommendationValueV8Observe?: (
      value: typeof accumulator,
      row: RecommendationValueV8DecisionEvaluation,
    ) => void;
  }).__recommendationValueV8Observe;
  if (fn) {
    fn(accumulator, decision);
    return;
  }
  // The core exports a stable observer in the compiled module. This fallback is
  // intentionally unreachable and prevents silently producing partial metrics.
  throw new Error('Recommendation Value V8 evaluation observer is unavailable.');
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

async function collectSourceSummary(
  sources: LoadedSources,
  index: SourceIndex,
): Promise<SourceSummary> {
  const trainRows: RecommendationProDecisionDatasetV6Row[] = [];
  const tuningRows: RecommendationProDecisionDatasetV6Row[] = [];
  const futureTestRows: RecommendationProDecisionDatasetV6Row[] = [];
  const decisionIds = new Set<string>();
  let sourceRowCount = 0;
  let duplicateDatasetDecisionCount = 0;
  let missingBehavioralPropensityCount = 0;
  let missingBaselineCount = 0;
  for await (const value of ndjson(sources.dataset.path)) {
    const row = value as RecommendationProDecisionDatasetV6Row;
    sourceRowCount += 1;
    if (decisionIds.has(row.decisionId)) {
      duplicateDatasetDecisionCount += 1;
    }
    decisionIds.add(row.decisionId);
    if (isActionEligible(row) && !index.propensities.has(row.decisionId)) {
      missingBehavioralPropensityCount += 1;
    }
    if (
      row.split !== 'TRAIN' &&
      isEvaluationEligible(row) &&
      !index.baselines.has(row.decisionId)
    ) {
      missingBaselineCount += 1;
    }
    if (row.split === 'TRAIN' && isTrainEligible(row)) {
      trainRows.push(row);
    } else if (row.split === 'TUNING' && isEvaluationEligible(row)) {
      tuningRows.push(row);
    } else if (
      row.split === 'FUTURE_TEST' &&
      isEvaluationEligible(row)
    ) {
      futureTestRows.push(row);
    }
  }
  return {
    sourceRowCount,
    trainRows,
    tuningRows,
    futureTestRows,
    duplicateDatasetDecisionCount,
    missingBehavioralPropensityCount,
    missingBaselineCount,
  };
}

function validateSourceSummary(summary: SourceSummary, index: SourceIndex): void {
  const reasons = structuralReasons(summary, index);
  if (summary.trainRows.length === 0) {
    reasons.push('No eligible TRAIN decisions are available.');
  }
  if (summary.tuningRows.length === 0) {
    reasons.push('No eligible TUNING decisions are available.');
  }
  if (summary.futureTestRows.length === 0) {
    reasons.push('No eligible FUTURE_TEST decisions are available.');
  }
  if (reasons.length > 0) {
    throw new Error(`Value V8 full evaluation source validation failed: ${reasons.join(' ')}`);
  }
}

function structuralReasons(summary: SourceSummary, index: SourceIndex): string[] {
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
    reasons.push('Eligible Value V8 decisions are missing Behavioral V5 propensities.');
  }
  if (summary.missingBaselineCount > 0) {
    reasons.push('Evaluation decisions are missing frozen V6 baseline predictions.');
  }
  return reasons;
}

function requiredPropensity(
  index: SourceIndex,
  row: RecommendationProDecisionDatasetV6Row,
): RecommendationBehavioralV5PropensityRow {
  const propensity = index.propensities.get(row.decisionId);
  if (!propensity) {
    throw new Error(`Behavioral V5 propensity is missing for ${row.decisionId}.`);
  }
  if (
    propensity.matchId !== row.matchId ||
    propensity.split !== row.split ||
    propensity.observedActionKey !== row.observedActionKey ||
    propensity.sourceDatasetSha256.length !== 64
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
    Object.keys(recommendationValueV8Targets(row)).length > 0
  );
}

function isEvaluationEligible(
  row: RecommendationProDecisionDatasetV6Row,
): boolean {
  return isTrainEligible(row);
}

function buildModelArtifact(input: {
  generatedAt: string;
  sources: LoadedSources;
  stateModel: RecommendationValueV8StateModel;
  actionModel: RecommendationValueV8ActionModel;
  selection: RecommendationValueV8Selection;
  options: RecommendationValueV8FullEvaluationOptions;
}): Record<string, unknown> {
  return {
    schemaVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
    evaluationVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_VERSION,
    generatedAt: input.generatedAt,
    stateModelVersion: RECOMMENDATION_VALUE_V8_STATE_MODEL_VERSION,
    actionModelVersion: RECOMMENDATION_VALUE_V8_ACTION_MODEL_VERSION,
    featureVersion: RECOMMENDATION_VALUE_V8_FEATURE_VERSION,
    source: {
      datasetSha256: input.sources.dataset.sha256,
      behavioralPropensitySha256: input.sources.propensities.sha256,
      diagnosticManifestSha256: input.sources.diagnostic.manifestSha256,
      baselineSha256: input.sources.baseline.sha256,
    },
    selectedConfiguration: input.selection.selected.configuration,
    selectedOn: 'TUNING_ONLY',
    options: input.options,
    stateModel: input.stateModel,
    actionModel: input.actionModel,
  };
}

function normalizeOptions(
  request: RecommendationValueV8FullEvaluationStartRequest,
): RecommendationValueV8FullEvaluationOptions {
  const stateEpochs = integer(request.stateEpochs, 3, 1, 20, 'stateEpochs');
  const actionEpochs = integer(request.actionEpochs, 3, 1, 20, 'actionEpochs');
  const hashDimension = integer(
    request.hashDimension,
    16_384,
    256,
    262_144,
    'hashDimension',
  );
  const state = {
    learningRate: finite(request.stateLearningRate, 0.03, 1e-6, 1),
    l2: finite(request.stateL2, 1e-5, 0, 1),
    maximumAbsolutePrediction: finite(
      request.maximumAbsolutePrediction,
      1,
      0.01,
      10,
    ),
  };
  const action = {
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
  };
  return {
    stateEpochs,
    actionEpochs,
    hashDimension,
    state,
    action,
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
  if (value === undefined) {
    return undefined;
  }
  return requiredSha(value, 'Expected SHA-256');
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
