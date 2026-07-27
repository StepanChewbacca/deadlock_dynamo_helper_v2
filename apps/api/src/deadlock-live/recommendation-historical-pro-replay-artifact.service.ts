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
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION,
  type HeroBuildDecisionDatasetV3Row,
} from './hero-build-decision-dataset-v3.service';
import type {
  MatchTimelineObjectiveEvent,
  MatchTimelinePlayerSnapshot,
} from './match-timeline-collector.service';
import {
  generateRecommendationHistoricalCandidatesFromValidatedSnapshot,
  validateRecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationCandidateGeneratorSnapshotRegistry,
} from './recommendation-candidate-generator-snapshot';
import {
  createRecommendationHistoricalProReplayRow,
  DEFAULT_RECOMMENDATION_HISTORICAL_PRO_REPLAY_THRESHOLDS,
  RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION,
  RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION,
  type RecommendationHistoricalCatalogItem,
  type RecommendationHistoricalProReplayAudit,
  type RecommendationHistoricalProReplayThresholds,
} from './recommendation-historical-pro-replay';
import { buildRecommendationHistoricalShortHorizonOutcomes } from './recommendation-historical-pro-replay-outcomes';
import { RecommendationHistoricalProReplayAuditAccumulator } from './recommendation-historical-pro-replay-streaming-audit';
import { sha256StableJson } from './stable-json';

const SOURCE_DATASET_VERSION = 'CONTEXTUAL_V3_DECISION_DATASET_1';
const DEFAULT_SOURCE_DIRECTORY =
  '/app/apps/api/storage/build-decision-dataset-v3';
const DEFAULT_SNAPSHOT_REGISTRY_PATH =
  '/app/apps/api/storage/recommendation-candidate-generator-snapshots/registry.json';
const DEFAULT_TIMELINE_DIRECTORY =
  '/app/apps/api/storage/match-timeline-events-v1';
const DEFAULT_OUTPUT_DIRECTORY =
  '/app/apps/api/storage/recommendation-historical-pro-replay-v1';
const DATASET_FILE_NAME = 'dataset.ndjson';

export interface RecommendationHistoricalProReplayStartRequest {
  expectedSourceSha256?: string;
  expectedSnapshotRegistrySha256?: string;
  partitionCount?: number;
  snapshotStalenessS?: number;
  maxRows?: number;
  resume?: boolean;
  thresholds?: Partial<RecommendationHistoricalProReplayThresholds>;
}

export interface RecommendationHistoricalProReplayStatus {
  state: 'IDLE' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  phase:
    | 'PREPARING'
    | 'PARTITIONING'
    | 'REPLAYING'
    | 'FINALIZING'
    | 'COMPLETE';
  sourceRowCount: number;
  selectedSourceRowCount: number;
  processedPartitionCount: number;
  partitionCount: number;
  outputRowCount: number;
  excludedWithoutTimelineCount: number;
  excludedWithoutGeneratorSnapshotCount: number;
  outputDirectory: string;
  datasetPath: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  datasetAvailable: boolean;
  manifestAvailable: boolean;
  auditAvailable: boolean;
  auditPassed?: boolean;
}

export interface RecommendationHistoricalProReplayArtifactAudit
  extends RecommendationHistoricalProReplayAudit {
  source: {
    datasetVersion: string;
    expectedRowCount: number;
    scannedRowCount: number;
    selectedRowCount: number;
    excludedWithoutTimelineCount: number;
    excludedWithoutGeneratorSnapshotCount: number;
    invalidSourceRowCount: number;
  };
  snapshots: {
    registrySha256: string;
    snapshotCount: number;
    snapshotIds: string[];
  };
  build: {
    partitionCount: number;
    diagnosticMaxRows?: number;
    fullCorpus: boolean;
    resumeEnabled: boolean;
  };
  trainingArtifactEligible: boolean;
}

export interface RecommendationHistoricalProReplayArtifactManifest {
  schemaVersion: typeof RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION;
  replayVersion: typeof RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION;
  generatedAt: string;
  source: {
    kind: 'POSTGRESQL_CONTEXTUAL_V3_SNAPSHOT';
    datasetVersion: string;
    directory: string;
    fileName: string;
    sha256: string;
    byteLength: number;
    manifestRowCount: number;
    scannedRowCount: number;
    selectedRowCount: number;
  };
  candidateGeneratorSnapshots: {
    registryPath: string;
    registrySha256: string;
    snapshotCount: number;
    snapshotIds: string[];
    selectionRule: 'LATEST_TRAINING_WINDOW_END_STRICTLY_BEFORE_MATCH_START';
  };
  timelineSource: {
    directory: string;
    snapshotStalenessS: number;
    requiredForOutput: true;
  };
  artifact: {
    format: 'NDJSON';
    fileName: typeof DATASET_FILE_NAME;
    byteLength: number;
    sha256: string;
    rowCount: number;
  };
  build: {
    partitionCount: number;
    diagnosticMaxRows?: number;
    fullCorpus: boolean;
    resumeEnabled: boolean;
  };
  featureContract: {
    featureCutoff: 'DECISION_TIME_PRE_ACTION';
    observedActionInjectedIntoCandidates: false;
    v5_3UsedAsInput: false;
    userLiveUsedAsInput: false;
    shortHorizonTargets: ['3m', '5m', '10m'];
    finalOutcomeAuxiliaryOnly: true;
  };
  auditPassed: boolean;
  trainingArtifactEligible: boolean;
}

interface NormalizedOptions {
  expectedSourceSha256?: string;
  expectedSnapshotRegistrySha256?: string;
  partitionCount: number;
  snapshotStalenessS: number;
  maxRows?: number;
  resume: boolean;
  thresholds: RecommendationHistoricalProReplayThresholds;
}

interface BuildPaths {
  dataset: string;
  manifest: string;
  audit: string;
  work: string;
  checkpoint: string;
  sourceParts: string;
  outputParts: string;
  partStats: string;
}

interface BuildCheckpoint {
  sourceSha256: string;
  snapshotRegistrySha256: string;
  optionsHash: string;
  partitioningComplete: boolean;
  scannedRowCount: number;
  completedPartitions: number[];
  updatedAt: string;
}

interface SourceArtifact {
  datasetPath: string;
  datasetVersion: string;
  sha256: string;
  byteLength: number;
  rowCount: number;
}

interface SnapshotBundle {
  registrySha256: string;
  artifacts: RecommendationCandidateGeneratorSnapshotArtifact[];
}

interface TimelineData {
  available: boolean;
  snapshots: MatchTimelinePlayerSnapshot[];
  objectives: MatchTimelineObjectiveEvent[];
}

interface PartitionStats {
  partitionIndex: number;
  sourceRowCount: number;
  selectedRowCount: number;
  outputRowCount: number;
  excludedWithoutTimelineCount: number;
  excludedWithoutGeneratorSnapshotCount: number;
  invalidSourceRowCount: number;
}

@Injectable()
export class RecommendationHistoricalProReplayArtifactService
  implements OnModuleInit
{
  private readonly logger = new Logger(
    RecommendationHistoricalProReplayArtifactService.name,
  );
  private readonly sourceDirectory =
    process.env.DEADLOCK_RECOMMENDATION_HISTORICAL_PRO_REPLAY_SOURCE_DIR?.trim() ||
    DEFAULT_SOURCE_DIRECTORY;
  private readonly snapshotRegistryPath =
    process.env.DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_PATH?.trim() ||
    DEFAULT_SNAPSHOT_REGISTRY_PATH;
  private readonly timelineDirectory =
    process.env.DEADLOCK_TIMELINE_STORAGE_DIR?.trim() ||
    DEFAULT_TIMELINE_DIRECTORY;
  private readonly outputDirectory =
    process.env.DEADLOCK_RECOMMENDATION_HISTORICAL_PRO_REPLAY_DIR?.trim() ||
    DEFAULT_OUTPUT_DIRECTORY;
  private readonly paths = createPaths(this.outputDirectory);
  private status = this.idleStatus();
  private manifest?: RecommendationHistoricalProReplayArtifactManifest;
  private audit?: RecommendationHistoricalProReplayArtifactAudit;
  private runPromise: Promise<void> = Promise.resolve();

  async onModuleInit(): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
    this.manifest = await readJson<RecommendationHistoricalProReplayArtifactManifest>(
      this.paths.manifest,
    );
    this.audit = await readJson<RecommendationHistoricalProReplayArtifactAudit>(
      this.paths.audit,
    );
    if (
      this.manifest &&
      this.audit &&
      (await exists(this.paths.dataset))
    ) {
      this.status = {
        ...this.idleStatus(),
        state: 'COMPLETE',
        phase: 'COMPLETE',
        sourceRowCount: this.audit.source.scannedRowCount,
        selectedSourceRowCount: this.audit.source.selectedRowCount,
        outputRowCount: this.audit.rowCount,
        excludedWithoutTimelineCount:
          this.audit.source.excludedWithoutTimelineCount,
        excludedWithoutGeneratorSnapshotCount:
          this.audit.source.excludedWithoutGeneratorSnapshotCount,
        completedAt: this.manifest.generatedAt,
        datasetAvailable: true,
        manifestAvailable: true,
        auditAvailable: true,
        auditPassed: this.audit.passed,
      };
    }
  }

  async start(
    request: RecommendationHistoricalProReplayStartRequest = {},
  ): Promise<RecommendationHistoricalProReplayStatus> {
    if (this.status.state === 'RUNNING') {
      throw new Error('Recommendation historical pro replay is already running.');
    }
    const options = normalizeOptions(request);
    const startedAt = new Date().toISOString();
    this.status = {
      ...this.idleStatus(),
      state: 'RUNNING',
      phase: 'PREPARING',
      startedAt,
      partitionCount: options.partitionCount,
    };
    this.runPromise = this.run(options, startedAt);
    return this.getStatus();
  }

  async waitForIdle(): Promise<void> {
    await this.runPromise;
  }

  getStatus(): RecommendationHistoricalProReplayStatus {
    return clone(this.status);
  }

  getManifest():
    | RecommendationHistoricalProReplayArtifactManifest
    | undefined {
    return this.manifest ? clone(this.manifest) : undefined;
  }

  getAudit(): RecommendationHistoricalProReplayArtifactAudit | undefined {
    return this.audit ? clone(this.audit) : undefined;
  }

  private async run(
    options: NormalizedOptions,
    startedAt: string,
  ): Promise<void> {
    try {
      const source = await loadSourceArtifact(
        this.sourceDirectory,
        options.expectedSourceSha256,
      );
      const snapshots = await loadSnapshotBundle(
        this.snapshotRegistryPath,
        options.expectedSnapshotRegistrySha256,
      );
      const optionsHash = sha256StableJson({
        partitionCount: options.partitionCount,
        snapshotStalenessS: options.snapshotStalenessS,
        maxRows: options.maxRows,
        thresholds: options.thresholds,
      });
      let checkpoint = options.resume
        ? await readJson<BuildCheckpoint>(this.paths.checkpoint)
        : undefined;
      if (
        !checkpoint ||
        checkpoint.sourceSha256 !== source.sha256 ||
        checkpoint.snapshotRegistrySha256 !== snapshots.registrySha256 ||
        checkpoint.optionsHash !== optionsHash
      ) {
        await this.clearBuild();
        checkpoint = {
          sourceSha256: source.sha256,
          snapshotRegistrySha256: snapshots.registrySha256,
          optionsHash,
          partitioningComplete: false,
          scannedRowCount: 0,
          completedPartitions: [],
          updatedAt: new Date().toISOString(),
        };
        await atomicJson(this.paths.checkpoint, checkpoint);
      }

      await Promise.all([
        mkdir(this.paths.sourceParts, { recursive: true }),
        mkdir(this.paths.outputParts, { recursive: true }),
        mkdir(this.paths.partStats, { recursive: true }),
      ]);

      if (!checkpoint.partitioningComplete) {
        this.status = { ...this.status, phase: 'PARTITIONING' };
        checkpoint.scannedRowCount = await partitionSource({
          sourcePath: source.datasetPath,
          paths: this.paths,
          partitionCount: options.partitionCount,
          maxRows: options.maxRows,
          progress: (count) => {
            this.status = { ...this.status, sourceRowCount: count };
          },
        });
        checkpoint.partitioningComplete = true;
        checkpoint.updatedAt = new Date().toISOString();
        await atomicJson(this.paths.checkpoint, checkpoint);
      }

      this.status = {
        ...this.status,
        phase: 'REPLAYING',
        sourceRowCount: checkpoint.scannedRowCount,
        processedPartitionCount: checkpoint.completedPartitions.length,
      };
      const complete = new Set(checkpoint.completedPartitions);
      for (let index = 0; index < options.partitionCount; index += 1) {
        if (complete.has(index)) {
          continue;
        }
        const stats = await processPartition({
          index,
          paths: this.paths,
          snapshots: snapshots.artifacts,
          timelineDirectory: this.timelineDirectory,
          snapshotStalenessS: options.snapshotStalenessS,
        });
        await atomicJson(partStatsPath(this.paths, index), stats);
        checkpoint.completedPartitions.push(index);
        checkpoint.completedPartitions.sort((left, right) => left - right);
        checkpoint.updatedAt = new Date().toISOString();
        await atomicJson(this.paths.checkpoint, checkpoint);
        this.status = {
          ...this.status,
          processedPartitionCount: checkpoint.completedPartitions.length,
        };
      }

      this.status = { ...this.status, phase: 'FINALIZING' };
      await combineParts(this.paths, options.partitionCount);
      const totals = await loadPartitionTotals(
        this.paths,
        options.partitionCount,
      );
      const accumulator =
        new RecommendationHistoricalProReplayAuditAccumulator(
          options.thresholds,
        );
      for await (const value of ndjson(this.paths.dataset)) {
        accumulator.observe(
          value as ReturnType<
            typeof createRecommendationHistoricalProReplayRow
          >,
        );
      }
      const generatedAt = new Date().toISOString();
      const coreAudit = accumulator.finalize(generatedAt);
      const fullCorpus = options.maxRows === undefined;
      const sourceCountMatches =
        options.maxRows === undefined
          ? checkpoint.scannedRowCount === source.rowCount
          : checkpoint.scannedRowCount <= source.rowCount;
      const additionalReasons: string[] = [];
      if (!sourceCountMatches) {
        additionalReasons.push(
          'Scanned source row count does not match the source manifest.',
        );
      }
      if (totals.invalidSourceRowCount > 0) {
        additionalReasons.push('Replay source contains invalid rows.');
      }
      if (totals.outputRowCount === 0) {
        additionalReasons.push('Replay produced no timeline-backed rows.');
      }
      if (!fullCorpus) {
        additionalReasons.push(
          'Diagnostic maxRows was used; artifact is not eligible for training.',
        );
      }
      const reasons = [...coreAudit.reasons, ...additionalReasons];
      const trainingArtifactEligible =
        fullCorpus && reasons.length === 0;
      const audit: RecommendationHistoricalProReplayArtifactAudit = {
        ...coreAudit,
        passed: reasons.length === 0,
        reasons,
        source: {
          datasetVersion: source.datasetVersion,
          expectedRowCount: source.rowCount,
          scannedRowCount: checkpoint.scannedRowCount,
          selectedRowCount: totals.selectedRowCount,
          excludedWithoutTimelineCount:
            totals.excludedWithoutTimelineCount,
          excludedWithoutGeneratorSnapshotCount:
            totals.excludedWithoutGeneratorSnapshotCount,
          invalidSourceRowCount: totals.invalidSourceRowCount,
        },
        snapshots: {
          registrySha256: snapshots.registrySha256,
          snapshotCount: snapshots.artifacts.length,
          snapshotIds: snapshots.artifacts.map(
            (artifact) => artifact.snapshot.snapshotId,
          ),
        },
        build: {
          partitionCount: options.partitionCount,
          diagnosticMaxRows: options.maxRows,
          fullCorpus,
          resumeEnabled: options.resume,
        },
        trainingArtifactEligible,
      };
      const datasetStat = await stat(this.paths.dataset);
      const manifest: RecommendationHistoricalProReplayArtifactManifest = {
        schemaVersion:
          RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION,
        replayVersion: RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION,
        generatedAt,
        source: {
          kind: 'POSTGRESQL_CONTEXTUAL_V3_SNAPSHOT',
          datasetVersion: source.datasetVersion,
          directory: this.sourceDirectory,
          fileName: DATASET_FILE_NAME,
          sha256: source.sha256,
          byteLength: source.byteLength,
          manifestRowCount: source.rowCount,
          scannedRowCount: checkpoint.scannedRowCount,
          selectedRowCount: totals.selectedRowCount,
        },
        candidateGeneratorSnapshots: {
          registryPath: this.snapshotRegistryPath,
          registrySha256: snapshots.registrySha256,
          snapshotCount: snapshots.artifacts.length,
          snapshotIds: snapshots.artifacts.map(
            (artifact) => artifact.snapshot.snapshotId,
          ),
          selectionRule:
            'LATEST_TRAINING_WINDOW_END_STRICTLY_BEFORE_MATCH_START',
        },
        timelineSource: {
          directory: this.timelineDirectory,
          snapshotStalenessS: options.snapshotStalenessS,
          requiredForOutput: true,
        },
        artifact: {
          format: 'NDJSON',
          fileName: DATASET_FILE_NAME,
          byteLength: datasetStat.size,
          sha256: await hashFile(this.paths.dataset),
          rowCount: totals.outputRowCount,
        },
        build: {
          partitionCount: options.partitionCount,
          diagnosticMaxRows: options.maxRows,
          fullCorpus,
          resumeEnabled: options.resume,
        },
        featureContract: {
          featureCutoff: 'DECISION_TIME_PRE_ACTION',
          observedActionInjectedIntoCandidates: false,
          v5_3UsedAsInput: false,
          userLiveUsedAsInput: false,
          shortHorizonTargets: ['3m', '5m', '10m'],
          finalOutcomeAuxiliaryOnly: true,
        },
        auditPassed: audit.passed,
        trainingArtifactEligible,
      };

      await Promise.all([
        atomicJson(this.paths.audit, audit),
        atomicJson(this.paths.manifest, manifest),
      ]);
      this.audit = audit;
      this.manifest = manifest;
      this.status = {
        ...this.status,
        state: 'COMPLETE',
        phase: 'COMPLETE',
        completedAt: generatedAt,
        sourceRowCount: checkpoint.scannedRowCount,
        selectedSourceRowCount: totals.selectedRowCount,
        outputRowCount: totals.outputRowCount,
        excludedWithoutTimelineCount:
          totals.excludedWithoutTimelineCount,
        excludedWithoutGeneratorSnapshotCount:
          totals.excludedWithoutGeneratorSnapshotCount,
        datasetAvailable: true,
        manifestAvailable: true,
        auditAvailable: true,
        auditPassed: audit.passed,
      };
      await rm(this.paths.work, { recursive: true, force: true });
      this.logger.log(
        `Recommendation historical pro replay completed with ` +
          `${totals.outputRowCount} rows.`,
      );
    } catch (error) {
      const message = errorMessage(error);
      this.status = {
        ...this.status,
        state: 'FAILED',
        completedAt: new Date().toISOString(),
        error: message,
      };
      this.logger.error(
        `Recommendation historical pro replay failed: ${message}`,
      );
    }
  }

  private async clearBuild(): Promise<void> {
    await Promise.all([
      rm(this.paths.dataset, { force: true }),
      rm(`${this.paths.dataset}.partial`, { force: true }),
      rm(this.paths.manifest, { force: true }),
      rm(this.paths.audit, { force: true }),
      rm(this.paths.work, { recursive: true, force: true }),
    ]);
  }

  private idleStatus(): RecommendationHistoricalProReplayStatus {
    return {
      state: 'IDLE',
      phase: 'PREPARING',
      sourceRowCount: 0,
      selectedSourceRowCount: 0,
      processedPartitionCount: 0,
      partitionCount: 0,
      outputRowCount: 0,
      excludedWithoutTimelineCount: 0,
      excludedWithoutGeneratorSnapshotCount: 0,
      outputDirectory: this.outputDirectory,
      datasetPath: this.paths.dataset,
      datasetAvailable: false,
      manifestAvailable: false,
      auditAvailable: false,
    };
  }
}

async function loadSourceArtifact(
  directory: string,
  expectedSha256: string | undefined,
): Promise<SourceArtifact> {
  const manifest = await requiredJson<Record<string, unknown>>(
    join(directory, 'manifest.json'),
    'Contextual V3 source manifest',
  );
  const audit = await requiredJson<Record<string, unknown>>(
    join(directory, 'audit.json'),
    'Contextual V3 source audit',
  );
  if (
    manifest.datasetVersion !== SOURCE_DATASET_VERSION ||
    manifest.auditPassed !== true ||
    audit.passed !== true
  ) {
    throw new Error('Contextual V3 PostgreSQL snapshot did not pass audit.');
  }
  const artifact = record(manifest.artifact);
  const datasetPath = join(
    directory,
    text(artifact.fileName) ?? DATASET_FILE_NAME,
  );
  const manifestSha256 = requiredSha(
    artifact.sha256,
    'Contextual V3 artifact SHA-256',
  );
  const actualSha256 = await hashFile(datasetPath);
  if (actualSha256 !== manifestSha256) {
    throw new Error(
      `Contextual V3 artifact SHA-256 mismatch: ${actualSha256} versus ` +
        `${manifestSha256}.`,
    );
  }
  if (expectedSha256 && expectedSha256 !== actualSha256) {
    throw new Error(
      `Contextual V3 expected SHA-256 ${expectedSha256} does not match ` +
        `${actualSha256}.`,
    );
  }
  return {
    datasetPath,
    datasetVersion: SOURCE_DATASET_VERSION,
    sha256: actualSha256,
    byteLength: (await stat(datasetPath)).size,
    rowCount: positiveInteger(
      artifact.rowCount,
      'Contextual V3 artifact rowCount',
    ),
  };
}

async function loadSnapshotBundle(
  registryPath: string,
  expectedSha256: string | undefined,
): Promise<SnapshotBundle> {
  const raw = await readFile(registryPath, 'utf8');
  const registrySha256 = createHash('sha256').update(raw).digest('hex');
  if (expectedSha256 && expectedSha256 !== registrySha256) {
    throw new Error(
      `Candidate generator registry SHA-256 mismatch: ${registrySha256} ` +
        `versus ${expectedSha256}.`,
    );
  }
  const registry = JSON.parse(
    raw,
  ) as RecommendationCandidateGeneratorSnapshotRegistry;
  if (
    registry.schemaVersion !== 1 ||
    registry.registryVersion !==
      'RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_1' ||
    !Array.isArray(registry.snapshots) ||
    registry.snapshots.length === 0
  ) {
    throw new Error('Invalid candidate generator snapshot registry.');
  }

  const artifacts: RecommendationCandidateGeneratorSnapshotArtifact[] = [];
  const snapshotIds = new Set<string>();
  for (const entry of registry.snapshots) {
    if (
      basename(entry.fileName) !== entry.fileName ||
      entry.fileName.includes('..')
    ) {
      throw new Error('Snapshot registry fileName must be a local file name.');
    }
    const path = join(dirname(registryPath), entry.fileName);
    const artifactRaw = await readFile(path, 'utf8');
    const artifactSha256 = createHash('sha256')
      .update(artifactRaw)
      .digest('hex');
    if (artifactSha256 !== requiredSha(entry.artifactSha256, 'artifactSha256')) {
      throw new Error(
        `Candidate generator artifact ${entry.fileName} SHA-256 mismatch.`,
      );
    }
    const artifact = JSON.parse(
      artifactRaw,
    ) as RecommendationCandidateGeneratorSnapshotArtifact;
    validateRecommendationCandidateGeneratorSnapshotArtifact(artifact);
    if (
      artifact.snapshot.snapshotId !== entry.snapshotId ||
      artifact.snapshot.trainingWindowEnd !== entry.trainingWindowEnd
    ) {
      throw new Error(
        `Candidate generator registry metadata does not match ${entry.fileName}.`,
      );
    }
    if (snapshotIds.has(artifact.snapshot.snapshotId)) {
      throw new Error(
        `Candidate generator registry duplicates ${artifact.snapshot.snapshotId}.`,
      );
    }
    snapshotIds.add(artifact.snapshot.snapshotId);
    artifacts.push(artifact);
  }
  artifacts.sort(
    (left, right) =>
      Date.parse(left.snapshot.trainingWindowEnd) -
        Date.parse(right.snapshot.trainingWindowEnd) ||
      left.snapshot.snapshotId.localeCompare(right.snapshot.snapshotId),
  );
  return { registrySha256, artifacts };
}

async function partitionSource(input: {
  sourcePath: string;
  paths: BuildPaths;
  partitionCount: number;
  maxRows?: number;
  progress: (count: number) => void;
}): Promise<number> {
  await rm(input.paths.sourceParts, { recursive: true, force: true });
  await mkdir(input.paths.sourceParts, { recursive: true });
  const handles = new Map<number, FileHandle>();
  let count = 0;
  try {
    for await (const value of ndjson(input.sourcePath)) {
      if (input.maxRows !== undefined && count >= input.maxRows) {
        break;
      }
      const row = sourceRow(value, count + 1);
      const partition = partitionIndex(
        String(row.matchId),
        input.partitionCount,
      );
      let handle = handles.get(partition);
      if (!handle) {
        handle = await open(sourcePartPath(input.paths, partition), 'a');
        handles.set(partition, handle);
      }
      await handle.write(`${JSON.stringify(row)}\n`);
      count += 1;
      if (count % 50_000 === 0) {
        input.progress(count);
        await tick();
      }
    }
  } finally {
    await Promise.all([...handles.values()].map((handle) => handle.close()));
  }
  input.progress(count);
  return count;
}

async function processPartition(input: {
  index: number;
  paths: BuildPaths;
  snapshots: readonly RecommendationCandidateGeneratorSnapshotArtifact[];
  timelineDirectory: string;
  snapshotStalenessS: number;
}): Promise<PartitionStats> {
  const path = sourcePartPath(input.paths, input.index);
  const outputPath = outputPartPath(input.paths, input.index);
  const stats = emptyPartitionStats(input.index);
  if (!(await exists(path))) {
    await writeFile(outputPath, '', 'utf8');
    return stats;
  }

  const rows: HeroBuildDecisionDatasetV3Row[] = [];
  for await (const value of ndjson(path)) {
    try {
      rows.push(sourceRow(value, rows.length + 1));
    } catch {
      stats.invalidSourceRowCount += 1;
    }
  }
  rows.sort(compareSourceRows);
  stats.sourceRowCount = rows.length + stats.invalidSourceRowCount;
  const writer = await LineWriter.create(`${outputPath}.partial`);
  const catalogBySnapshotId = new Map<
    string,
    ReadonlyMap<number, RecommendationHistoricalCatalogItem>
  >();
  let timelineMatchId: number | undefined;
  let timeline: TimelineData = emptyTimeline();

  try {
    for (const row of rows) {
      const snapshot = selectValidatedCandidateGeneratorSnapshot(
        input.snapshots,
        row.matchStartTime,
      );
      if (!snapshot) {
        stats.excludedWithoutGeneratorSnapshotCount += 1;
        continue;
      }
      if (timelineMatchId !== row.matchId) {
        timelineMatchId = row.matchId;
        timeline = await loadTimeline(
          input.timelineDirectory,
          row.matchId,
        );
      }
      if (!timeline.available) {
        stats.excludedWithoutTimelineCount += 1;
        continue;
      }
      stats.selectedRowCount += 1;
      const candidates =
        generateRecommendationHistoricalCandidatesFromValidatedSnapshot({
          decision: row,
          artifact: snapshot,
        });
      let catalogItems = catalogBySnapshotId.get(
        snapshot.snapshot.snapshotId,
      );
      if (!catalogItems) {
        catalogItems = new Map(
          snapshot.catalog.items.map((item) => [
            item.itemId,
            clone(item),
          ]),
        );
        catalogBySnapshotId.set(
          snapshot.snapshot.snapshotId,
          catalogItems,
        );
      }
      const outcomes =
        buildRecommendationHistoricalShortHorizonOutcomes({
          decision: row,
          snapshots: timeline.snapshots,
          objectives: timeline.objectives,
          snapshotStalenessS: input.snapshotStalenessS,
        });
      const replayRow = createRecommendationHistoricalProReplayRow({
        decision: row,
        candidateActions: candidates,
        catalogItemsById: catalogItems,
        shortHorizonOutcomes: outcomes,
        generatorSnapshot: snapshot.snapshot,
      });
      await writer.write(replayRow);
      stats.outputRowCount += 1;
    }
    await writer.close();
    await rename(`${outputPath}.partial`, outputPath);
    return stats;
  } catch (error) {
    await writer.abort();
    await rm(`${outputPath}.partial`, { force: true });
    throw error;
  }
}

function selectValidatedCandidateGeneratorSnapshot(
  artifacts: readonly RecommendationCandidateGeneratorSnapshotArtifact[],
  matchStartTime: string,
): RecommendationCandidateGeneratorSnapshotArtifact | undefined {
  const matchTime = Date.parse(matchStartTime);
  if (!Number.isFinite(matchTime)) {
    throw new Error('Replay matchStartTime must be an ISO timestamp.');
  }
  let selected: RecommendationCandidateGeneratorSnapshotArtifact | undefined;
  for (const artifact of artifacts) {
    const trainingEnd = Date.parse(artifact.snapshot.trainingWindowEnd);
    if (trainingEnd >= matchTime) {
      break;
    }
    selected = artifact;
  }
  return selected;
}

async function loadTimeline(
  root: string,
  matchId: number,
): Promise<TimelineData> {
  const directory = join(root, String(matchId));
  const audit = await readJson<Record<string, unknown>>(
    join(directory, 'audit.json'),
  );
  const manifest = await readJson<Record<string, unknown>>(
    join(directory, 'manifest.json'),
  );
  if (!audit || audit.passed !== true || !manifest) {
    return emptyTimeline();
  }
  const snapshots: MatchTimelinePlayerSnapshot[] = [];
  const objectives: MatchTimelineObjectiveEvent[] = [];
  for await (const value of ndjson(
    join(directory, 'player-snapshots.ndjson'),
    true,
  )) {
    if (isRecord(value)) {
      snapshots.push(value as unknown as MatchTimelinePlayerSnapshot);
    }
  }
  for await (const value of ndjson(
    join(directory, 'objective-events.ndjson'),
    true,
  )) {
    if (isRecord(value)) {
      objectives.push(value as unknown as MatchTimelineObjectiveEvent);
    }
  }
  snapshots.sort(compareSnapshots);
  objectives.sort(
    (left, right) =>
      left.gameTimeS - right.gameTimeS ||
      left.objectiveEventId.localeCompare(right.objectiveEventId),
  );
  return {
    available: snapshots.length > 0,
    snapshots,
    objectives,
  };
}

async function combineParts(
  paths: BuildPaths,
  partitionCount: number,
): Promise<void> {
  const partial = `${paths.dataset}.partial`;
  await rm(partial, { force: true });
  const output = await open(partial, 'w');
  try {
    for (let index = 0; index < partitionCount; index += 1) {
      const path = outputPartPath(paths, index);
      if (!(await exists(path))) {
        continue;
      }
      for await (const chunk of createReadStream(path)) {
        await output.write(chunk as Buffer);
      }
    }
  } finally {
    await output.close();
  }
  await rm(paths.dataset, { force: true });
  await rename(partial, paths.dataset);
}

async function loadPartitionTotals(
  paths: BuildPaths,
  partitionCount: number,
): Promise<PartitionStats> {
  const total = emptyPartitionStats(-1);
  for (let index = 0; index < partitionCount; index += 1) {
    const value = await requiredJson<PartitionStats>(
      partStatsPath(paths, index),
      `Replay partition ${index} stats`,
    );
    total.sourceRowCount += value.sourceRowCount;
    total.selectedRowCount += value.selectedRowCount;
    total.outputRowCount += value.outputRowCount;
    total.excludedWithoutTimelineCount +=
      value.excludedWithoutTimelineCount;
    total.excludedWithoutGeneratorSnapshotCount +=
      value.excludedWithoutGeneratorSnapshotCount;
    total.invalidSourceRowCount += value.invalidSourceRowCount;
  }
  return total;
}

function sourceRow(
  value: unknown,
  line: number,
): HeroBuildDecisionDatasetV3Row {
  if (
    !isRecord(value) ||
    value.schemaVersion !==
      HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION ||
    typeof value.decisionId !== 'string' ||
    !Number.isSafeInteger(Number(value.matchId)) ||
    typeof value.matchStartTime !== 'string' ||
    !Number.isSafeInteger(Number(value.playerId)) ||
    !Number.isSafeInteger(Number(value.heroId)) ||
    !Number.isFinite(Number(value.gameTimeS)) ||
    typeof value.inventoryBeforeStateKey !== 'string' ||
    typeof value.actualActionKey !== 'string' ||
    !isRecord(value.outcomeLabel)
  ) {
    throw new Error(`Invalid Contextual V3 row at line ${line}.`);
  }
  return value as unknown as HeroBuildDecisionDatasetV3Row;
}

function compareSourceRows(
  left: HeroBuildDecisionDatasetV3Row,
  right: HeroBuildDecisionDatasetV3Row,
): number {
  return (
    left.matchId - right.matchId ||
    left.playerId - right.playerId ||
    left.gameTimeS - right.gameTimeS ||
    left.decisionId.localeCompare(right.decisionId)
  );
}

function compareSnapshots(
  left: MatchTimelinePlayerSnapshot,
  right: MatchTimelinePlayerSnapshot,
): number {
  return (
    left.gameTimeS - right.gameTimeS ||
    left.tick - right.tick ||
    left.snapshotId.localeCompare(right.snapshotId)
  );
}

function emptyTimeline(): TimelineData {
  return { available: false, snapshots: [], objectives: [] };
}

function emptyPartitionStats(index: number): PartitionStats {
  return {
    partitionIndex: index,
    sourceRowCount: 0,
    selectedRowCount: 0,
    outputRowCount: 0,
    excludedWithoutTimelineCount: 0,
    excludedWithoutGeneratorSnapshotCount: 0,
    invalidSourceRowCount: 0,
  };
}

function createPaths(outputDirectory: string): BuildPaths {
  const work = join(outputDirectory, 'work');
  return {
    dataset: join(outputDirectory, DATASET_FILE_NAME),
    manifest: join(outputDirectory, 'manifest.json'),
    audit: join(outputDirectory, 'audit.json'),
    work,
    checkpoint: join(work, 'checkpoint.json'),
    sourceParts: join(work, 'source-parts'),
    outputParts: join(work, 'output-parts'),
    partStats: join(work, 'part-stats'),
  };
}

function sourcePartPath(paths: BuildPaths, index: number): string {
  return join(
    paths.sourceParts,
    `part-${String(index).padStart(4, '0')}.ndjson`,
  );
}

function outputPartPath(paths: BuildPaths, index: number): string {
  return join(
    paths.outputParts,
    `part-${String(index).padStart(4, '0')}.ndjson`,
  );
}

function partStatsPath(paths: BuildPaths, index: number): string {
  return join(
    paths.partStats,
    `part-${String(index).padStart(4, '0')}.json`,
  );
}

function partitionIndex(value: string, count: number): number {
  return (
    createHash('sha256').update(value).digest().readUInt32BE(0) % count
  );
}

function normalizeOptions(
  request: RecommendationHistoricalProReplayStartRequest,
): NormalizedOptions {
  return {
    expectedSourceSha256: optionalSha(
      request.expectedSourceSha256,
      'expectedSourceSha256',
    ),
    expectedSnapshotRegistrySha256: optionalSha(
      request.expectedSnapshotRegistrySha256,
      'expectedSnapshotRegistrySha256',
    ),
    partitionCount: boundedInteger(
      request.partitionCount,
      64,
      2,
      256,
      'partitionCount',
    ),
    snapshotStalenessS: boundedInteger(
      request.snapshotStalenessS,
      120,
      0,
      3_600,
      'snapshotStalenessS',
    ),
    maxRows: optionalPositiveInteger(request.maxRows, 'maxRows'),
    resume: request.resume !== false,
    thresholds: {
      minimumTimelineCoverage: boundedFraction(
        request.thresholds?.minimumTimelineCoverage,
        DEFAULT_RECOMMENDATION_HISTORICAL_PRO_REPLAY_THRESHOLDS.minimumTimelineCoverage,
        'minimumTimelineCoverage',
      ),
      minimumCandidateMetadataCoverage: boundedFraction(
        request.thresholds?.minimumCandidateMetadataCoverage,
        DEFAULT_RECOMMENDATION_HISTORICAL_PRO_REPLAY_THRESHOLDS.minimumCandidateMetadataCoverage,
        'minimumCandidateMetadataCoverage',
      ),
      minimumObservedActionCandidateCoverage: boundedFraction(
        request.thresholds?.minimumObservedActionCandidateCoverage,
        DEFAULT_RECOMMENDATION_HISTORICAL_PRO_REPLAY_THRESHOLDS.minimumObservedActionCandidateCoverage,
        'minimumObservedActionCandidateCoverage',
      ),
    },
  };
}

async function* ndjson(
  path: string,
  optional = false,
): AsyncGenerator<unknown> {
  if (optional && !(await exists(path))) {
    return;
  }
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let line = 0;
  for await (const value of lines) {
    line += 1;
    if (!value.trim()) {
      continue;
    }
    try {
      yield JSON.parse(value) as unknown;
    } catch {
      throw new Error(`Invalid JSON in ${path} at line ${line}.`);
    }
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.partial`;
  await writeFile(
    partial,
    `${JSON.stringify(value, undefined, 2)}\n`,
    'utf8',
  );
  await rename(partial, path);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function requiredJson<T>(
  path: string,
  label: string,
): Promise<T> {
  const value = await readJson<T>(path);
  if (!value) {
    throw new Error(`${label} is unavailable at ${path}.`);
  }
  return value;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

class LineWriter {
  private buffer = '';

  private constructor(
    private readonly handle: FileHandle,
    private readonly path: string,
  ) {}

  static async create(path: string): Promise<LineWriter> {
    return new LineWriter(await open(path, 'w'), path);
  }

  async write(value: unknown): Promise<void> {
    this.buffer += `${JSON.stringify(value)}\n`;
    if (this.buffer.length >= 1024 * 1024) {
      await this.flush();
    }
  }

  async close(): Promise<void> {
    await this.flush();
    await this.handle.close();
  }

  async abort(): Promise<void> {
    this.buffer = '';
    await this.handle.close().catch(() => undefined);
    await rm(this.path, { force: true });
  }

  private async flush(): Promise<void> {
    if (!this.buffer) {
      return;
    }
    await this.handle.write(this.buffer);
    this.buffer = '';
  }
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
}

function requiredSha(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${name} is unavailable.`);
  }
  return value.toLowerCase();
}

function optionalSha(
  value: string | undefined,
  name: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${name} must be a SHA-256 digest.`);
  }
  return normalized;
}

function positiveInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function optionalPositiveInteger(
  value: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return positiveInteger(value, name);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (
    !Number.isSafeInteger(result) ||
    result < minimum ||
    result > maximum
  ) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return result;
}

function boundedFraction(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 0 || result > 1) {
    throw new Error(`${name} must be between zero and one.`);
  }
  return result;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
