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
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import type {
  RecommendationProDecisionDatasetV6ArtifactAudit,
  RecommendationProDecisionDatasetV6ArtifactManifest,
} from './recommendation-pro-decision-dataset-v6-artifact.service';
import {
  RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION,
  RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
  type RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';
import {
  predictRecommendationV6DatasetV6Baseline,
  rehydrateRecommendationV6FrozenShortOnlyModel,
  validateRecommendationV6FrozenShortOnlyModelArtifact,
  type RecommendationV6FrozenShortOnlyModelArtifact,
} from './recommendation-v6-short-only-dataset-v6-baseline';
import {
  RECOMMENDATION_V6_PRODUCTION_BASELINE_COMMIT,
  RECOMMENDATION_V6_SHORT_ONLY_BASELINE_VERSION,
  RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
  type RecommendationV6ShortOnlyBaselineManifest,
} from './recommendation-value-v8-full-evaluation';

const DEFAULT_DATASET_DIRECTORY =
  '/app/apps/api/storage/recommendation-pro-decision-dataset-v6-1';
const DEFAULT_MODEL_PATH =
  '/app/apps/api/storage/recommendation-value-v6-training/model.json';
const DEFAULT_OUTPUT_DIRECTORY =
  '/app/apps/api/storage/recommendation-v6-short-only-dataset-v6-baseline-1';
const PREDICTION_FILE_NAME = 'predictions.ndjson';

export interface RecommendationV6ShortOnlyBaselineExportStartRequest {
  expectedDatasetSha256?: string;
  expectedModelSha256?: string;
}

export interface RecommendationV6ShortOnlyBaselineExportStatus {
  state: 'IDLE' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  phase: 'PREPARING' | 'EXPORTING' | 'FINALIZING' | 'COMPLETE';
  sourceRowCount: number;
  tuningRowCount: number;
  futureTestRowCount: number;
  outputDirectory: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  manifestAvailable: boolean;
  auditAvailable: boolean;
}

export interface RecommendationV6ShortOnlyBaselineExportAudit {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION;
  baselineVersion: typeof RECOMMENDATION_V6_SHORT_ONLY_BASELINE_VERSION;
  generatedAt: string;
  passed: boolean;
  frozen: true;
  trainingPerformed: false;
  source: {
    productionCommit: typeof RECOMMENDATION_V6_PRODUCTION_BASELINE_COMMIT;
    modelPath: string;
    modelSha256: string;
    datasetSha256: string;
    splitDescriptorSha256: string;
    expectedDatasetRowCount: number;
    scannedDatasetRowCount: number;
  };
  configuration: {
    finalOutcomeWeight: 0;
    statePriorStrength: 10;
    actionPriorStrength: 0.1;
    minimumObservations: 10;
    actionResidualScale: number;
  };
  output: {
    fileName: typeof PREDICTION_FILE_NAME;
    sha256: string;
    byteLength: number;
    rowCount: number;
    tuningRowCount: number;
    futureTestRowCount: number;
  };
  adapter: {
    exactSerializedModelCounts: true;
    exactCandidateSet: true;
    exactDecisionAndSplitLineage: true;
    unavailableFeatureFamilies: readonly [
      'BUILD_TOTAL_COST',
      'BUILD_HIGHEST_TIER',
      'TEAM_ECONOMY',
      'ORIGINAL_V5_INTERACTION_KEYS',
    ];
  };
  reasons: string[];
}

@Injectable()
export class RecommendationV6ShortOnlyBaselineExportService
  implements OnModuleInit
{
  private readonly logger = new Logger(
    RecommendationV6ShortOnlyBaselineExportService.name,
  );
  private readonly datasetDirectory =
    process.env.DEADLOCK_RECOMMENDATION_V6_BASELINE_DATASET_DIR?.trim() ||
    DEFAULT_DATASET_DIRECTORY;
  private readonly modelPath =
    process.env.DEADLOCK_RECOMMENDATION_V6_BASELINE_MODEL_PATH?.trim() ||
    DEFAULT_MODEL_PATH;
  private readonly outputDirectory =
    process.env.DEADLOCK_RECOMMENDATION_V6_BASELINE_DIR?.trim() ||
    DEFAULT_OUTPUT_DIRECTORY;
  private readonly paths = {
    predictions: join(this.outputDirectory, PREDICTION_FILE_NAME),
    audit: join(this.outputDirectory, 'audit.json'),
    manifest: join(this.outputDirectory, 'manifest.json'),
  };
  private status = this.idleStatus();
  private manifest?: RecommendationV6ShortOnlyBaselineManifest;
  private audit?: RecommendationV6ShortOnlyBaselineExportAudit;
  private runPromise: Promise<void> = Promise.resolve();

  async onModuleInit(): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
    this.manifest = await readJson<RecommendationV6ShortOnlyBaselineManifest>(
      this.paths.manifest,
    );
    this.audit = await readJson<RecommendationV6ShortOnlyBaselineExportAudit>(
      this.paths.audit,
    );
    if (
      this.manifest &&
      this.audit &&
      (await exists(this.paths.predictions))
    ) {
      this.status = {
        ...this.idleStatus(),
        state: 'COMPLETE',
        phase: 'COMPLETE',
        sourceRowCount: this.audit.source.scannedDatasetRowCount,
        tuningRowCount: this.audit.output.tuningRowCount,
        futureTestRowCount: this.audit.output.futureTestRowCount,
        completedAt: this.manifest.generatedAt,
        manifestAvailable: true,
        auditAvailable: true,
      };
    }
  }

  async start(
    request: RecommendationV6ShortOnlyBaselineExportStartRequest = {},
  ): Promise<RecommendationV6ShortOnlyBaselineExportStatus> {
    if (this.status.state === 'RUNNING') {
      throw new Error('Frozen V6 baseline export is already running.');
    }
    const expectedDatasetSha256 = optionalSha(request.expectedDatasetSha256);
    const expectedModelSha256 = optionalSha(request.expectedModelSha256);
    this.status = {
      ...this.idleStatus(),
      state: 'RUNNING',
      phase: 'PREPARING',
      startedAt: new Date().toISOString(),
    };
    this.runPromise = this.run(expectedDatasetSha256, expectedModelSha256);
    return this.getStatus();
  }

  async waitForIdle(): Promise<void> {
    await this.runPromise;
  }

  getStatus(): RecommendationV6ShortOnlyBaselineExportStatus {
    return clone(this.status);
  }

  getManifest(): RecommendationV6ShortOnlyBaselineManifest | undefined {
    return this.manifest ? clone(this.manifest) : undefined;
  }

  getAudit(): RecommendationV6ShortOnlyBaselineExportAudit | undefined {
    return this.audit ? clone(this.audit) : undefined;
  }

  private async run(
    expectedDatasetSha256: string | undefined,
    expectedModelSha256: string | undefined,
  ): Promise<void> {
    try {
      const datasetManifest = await requiredJson<RecommendationProDecisionDatasetV6ArtifactManifest>(
        join(this.datasetDirectory, 'manifest.json'),
      );
      const datasetAudit = await requiredJson<RecommendationProDecisionDatasetV6ArtifactAudit>(
        join(this.datasetDirectory, 'audit.json'),
      );
      validateDataset(datasetManifest, datasetAudit);
      const datasetPath = join(
        this.datasetDirectory,
        datasetManifest.artifact.fileName,
      );
      const datasetSha256 = await verifiedHash(
        datasetPath,
        datasetManifest.artifact.sha256,
        expectedDatasetSha256,
        'Dataset V6',
      );
      const modelArtifact = await requiredJson<RecommendationV6FrozenShortOnlyModelArtifact>(
        this.modelPath,
      );
      validateRecommendationV6FrozenShortOnlyModelArtifact(modelArtifact);
      const modelSha256 = await hashFile(this.modelPath);
      if (expectedModelSha256 && expectedModelSha256 !== modelSha256) {
        throw new Error('Frozen V6 model expected SHA-256 mismatch.');
      }
      const model = rehydrateRecommendationV6FrozenShortOnlyModel(modelArtifact);

      await mkdir(this.outputDirectory, { recursive: true });
      await this.clearOutputs();
      this.manifest = undefined;
      this.audit = undefined;
      this.status = { ...this.status, phase: 'EXPORTING' };
      const partialPath = `${this.paths.predictions}.partial`;
      const writer = await LineWriter.create(partialPath);
      let sourceRowCount = 0;
      let tuningRowCount = 0;
      let futureTestRowCount = 0;
      try {
        for await (const value of ndjson(datasetPath)) {
          sourceRowCount += 1;
          const row = datasetRow(value, sourceRowCount);
          if (!isBaselineEligible(row)) {
            continue;
          }
          const prediction = predictRecommendationV6DatasetV6Baseline({
            artifact: modelArtifact,
            model,
            row,
            sourceModelSha256: modelSha256,
            sourceDatasetSha256: datasetSha256,
            splitDescriptorSha256: datasetManifest.splitDescriptor.sha256,
          });
          await writer.write(prediction);
          if (row.split === 'TUNING') {
            tuningRowCount += 1;
          } else {
            futureTestRowCount += 1;
          }
          if (sourceRowCount % 10_000 === 0) {
            this.status = {
              ...this.status,
              sourceRowCount,
              tuningRowCount,
              futureTestRowCount,
            };
            await tick();
          }
        }
        await writer.close();
        await rename(partialPath, this.paths.predictions);
      } catch (error) {
        await writer.abort();
        await rm(partialPath, { force: true });
        throw error;
      }
      if (sourceRowCount !== datasetManifest.artifact.rowCount) {
        throw new Error('Dataset V6 row count does not match its manifest.');
      }
      if (tuningRowCount === 0 || futureTestRowCount === 0) {
        throw new Error(
          'Frozen V6 baseline requires both TUNING and FUTURE_TEST rows.',
        );
      }

      this.status = {
        ...this.status,
        phase: 'FINALIZING',
        sourceRowCount,
        tuningRowCount,
        futureTestRowCount,
      };
      const generatedAt = new Date().toISOString();
      const predictionSha256 = await hashFile(this.paths.predictions);
      const predictionStat = await stat(this.paths.predictions);
      const rowCount = tuningRowCount + futureTestRowCount;
      const audit: RecommendationV6ShortOnlyBaselineExportAudit = {
        schemaVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
        baselineVersion: RECOMMENDATION_V6_SHORT_ONLY_BASELINE_VERSION,
        generatedAt,
        passed: true,
        frozen: true,
        trainingPerformed: false,
        source: {
          productionCommit: RECOMMENDATION_V6_PRODUCTION_BASELINE_COMMIT,
          modelPath: this.modelPath,
          modelSha256,
          datasetSha256,
          splitDescriptorSha256: datasetManifest.splitDescriptor.sha256,
          expectedDatasetRowCount: datasetManifest.artifact.rowCount,
          scannedDatasetRowCount: sourceRowCount,
        },
        configuration: {
          finalOutcomeWeight: 0,
          statePriorStrength: 10,
          actionPriorStrength: 0.1,
          minimumObservations: 10,
          actionResidualScale: modelArtifact.actionResidualScale,
        },
        output: {
          fileName: PREDICTION_FILE_NAME,
          sha256: predictionSha256,
          byteLength: predictionStat.size,
          rowCount,
          tuningRowCount,
          futureTestRowCount,
        },
        adapter: {
          exactSerializedModelCounts: true,
          exactCandidateSet: true,
          exactDecisionAndSplitLineage: true,
          unavailableFeatureFamilies: [
            'BUILD_TOTAL_COST',
            'BUILD_HIGHEST_TIER',
            'TEAM_ECONOMY',
            'ORIGINAL_V5_INTERACTION_KEYS',
          ],
        },
        reasons: [],
      };
      await atomicJson(this.paths.audit, audit);
      const manifest: RecommendationV6ShortOnlyBaselineManifest = {
        schemaVersion: RECOMMENDATION_VALUE_V8_FULL_EVALUATION_SCHEMA_VERSION,
        baselineVersion: RECOMMENDATION_V6_SHORT_ONLY_BASELINE_VERSION,
        productionCommit: RECOMMENDATION_V6_PRODUCTION_BASELINE_COMMIT,
        generatedAt,
        sourceModel: {
          modelVersion: 'RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1',
          sha256: modelSha256,
          configuration: {
            shortOnly: true,
            finalOutcomeWeight: 0,
            statePriorStrength: 10,
            actionPriorStrength: 0.1,
            minimumObservations: 10,
          },
        },
        sourceDataset: {
          datasetVersion: RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
          sha256: datasetSha256,
          splitDescriptorSha256: datasetManifest.splitDescriptor.sha256,
        },
        artifact: {
          format: 'NDJSON',
          fileName: PREDICTION_FILE_NAME,
          sha256: predictionSha256,
          byteLength: predictionStat.size,
          rowCount,
        },
        auditPassed: true,
        frozen: true,
      };
      await atomicJson(this.paths.manifest, manifest);
      this.audit = audit;
      this.manifest = manifest;
      this.status = {
        ...this.status,
        state: 'COMPLETE',
        phase: 'COMPLETE',
        completedAt: generatedAt,
        manifestAvailable: true,
        auditAvailable: true,
      };
      this.logger.log(
        `Frozen V6 short-only baseline exported ${rowCount} rows from model ` +
          `${modelSha256.slice(0, 12)}.`,
      );
    } catch (error) {
      const message = errorMessage(error);
      this.status = {
        ...this.status,
        state: 'FAILED',
        completedAt: new Date().toISOString(),
        error: message,
      };
      this.logger.error(`Frozen V6 baseline export failed: ${message}`);
    }
  }

  private async clearOutputs(): Promise<void> {
    await Promise.all([
      rm(this.paths.predictions, { force: true }),
      rm(`${this.paths.predictions}.partial`, { force: true }),
      rm(this.paths.audit, { force: true }),
      rm(this.paths.manifest, { force: true }),
    ]);
  }

  private idleStatus(): RecommendationV6ShortOnlyBaselineExportStatus {
    return {
      state: 'IDLE',
      phase: 'PREPARING',
      sourceRowCount: 0,
      tuningRowCount: 0,
      futureTestRowCount: 0,
      outputDirectory: this.outputDirectory,
      manifestAvailable: false,
      auditAvailable: false,
    };
  }
}

function validateDataset(
  manifest: RecommendationProDecisionDatasetV6ArtifactManifest,
  audit: RecommendationProDecisionDatasetV6ArtifactAudit,
): void {
  if (
    manifest.schemaVersion !==
      RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION ||
    manifest.datasetVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION ||
    manifest.auditPassed !== true ||
    manifest.trainingArtifactEligible !== true ||
    manifest.build.fullCorpus !== true ||
    manifest.featureContract.futureTestEligibleForSelection !== false ||
    manifest.featureContract.userLiveUsedAsInput !== false ||
    audit.passed !== true ||
    audit.trainingArtifactEligible !== true ||
    audit.build.fullCorpus !== true
  ) {
    throw new Error('Dataset V6 is not eligible for frozen V6 baseline export.');
  }
}

function isBaselineEligible(row: RecommendationProDecisionDatasetV6Row): boolean {
  return (
    row.split !== 'TRAIN' &&
    row.eligibility.stateModel &&
    row.eligibility.actionModel &&
    row.observedActionInCandidateSet &&
    row.candidates.length >= 2 &&
    row.candidates.every((candidate) => candidate.catalogMetadataAvailable) &&
    [
      row.shortHorizonOutcomes.threeMinutes,
      row.shortHorizonOutcomes.fiveMinutes,
      row.shortHorizonOutcomes.tenMinutes,
    ].some((value) => value !== undefined)
  );
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
    !Array.isArray(value.candidates)
  ) {
    throw new Error(`Invalid Dataset V6 row at line ${line}.`);
  }
  return value as unknown as RecommendationProDecisionDatasetV6Row;
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

function optionalSha(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('Expected SHA-256 is invalid.');
  }
  return value.toLowerCase();
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
  const partialPath = `${path}.partial`;
  await writeFile(partialPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(partialPath, path);
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
