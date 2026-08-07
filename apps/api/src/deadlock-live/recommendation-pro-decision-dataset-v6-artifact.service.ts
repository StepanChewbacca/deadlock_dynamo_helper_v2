import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { GzipNdjsonWriter } from './gzip-ndjson';
import type { MatchTimelinePlayerSnapshot } from './match-timeline-collector.service';
import {
  validateRecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationCandidateGeneratorSnapshotRegistry,
} from './recommendation-candidate-generator-snapshot';
import {
  RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION,
  RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION,
  type RecommendationHistoricalCatalogItem,
  type RecommendationHistoricalProReplayRow,
} from './recommendation-historical-pro-replay';
import { selectRecommendationDecisionTimelineSnapshot } from './recommendation-historical-pro-replay-outcomes';
import {
  createRecommendationProDecisionDatasetV6Row,
  DEFAULT_RECOMMENDATION_DATASET_V6_THRESHOLDS,
  RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION,
  RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
  RECOMMENDATION_STATE_FEATURE_VERSION_V6,
  type RecommendationDatasetV6Split,
  type RecommendationDatasetV6Thresholds,
  type RecommendationProDecisionDatasetV6Audit,
} from './recommendation-pro-decision-dataset-v6';
import { RecommendationProDecisionDatasetV6AuditAccumulator } from './recommendation-pro-decision-dataset-v6-streaming-audit';
import { sha256StableJson } from './stable-json';

const DEFAULT_REPLAY_DIRECTORY =
  '/app/apps/api/storage/recommendation-historical-pro-replay-v1';
const DEFAULT_SNAPSHOT_REGISTRY_PATH =
  '/app/apps/api/storage/recommendation-candidate-generator-snapshots/registry.json';
const DEFAULT_TIMELINE_DIRECTORY =
  '/app/apps/api/storage/match-timeline-events-v1';
const DEFAULT_OUTPUT_DIRECTORY =
  '/app/apps/api/storage/recommendation-pro-decision-dataset-v6-1';
const DATASET_FILE_NAME = 'dataset.ndjson';
const SPLIT_DESCRIPTOR_VERSION =
  'RECOMMENDATION_DATASET_V6_CHRONOLOGICAL_SPLIT_1' as const;

export interface RecommendationProDecisionDatasetV6StartRequest {
  tuningStart: string;
  futureTestStart: string;
  expectedReplaySha256?: string;
  expectedSnapshotRegistrySha256?: string;
  decisionSnapshotStalenessS?: number;
  maxRows?: number;
  thresholds?: Partial<RecommendationDatasetV6Thresholds>;
}

export interface RecommendationProDecisionDatasetV6Status {
  state: 'IDLE' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  phase: 'PREPARING' | 'BUILDING' | 'FINALIZING' | 'COMPLETE';
  sourceRowCount: number;
  outputRowCount: number;
  timelineJoinedRowCount: number;
  missingTimelineRowCount: number;
  outputDirectory: string;
  datasetPath: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  datasetAvailable: boolean;
  manifestAvailable: boolean;
  auditAvailable: boolean;
  auditPassed?: boolean;
  trainingArtifactEligible?: boolean;
}

export interface RecommendationDatasetV6SplitDescriptor {
  version: typeof SPLIT_DESCRIPTOR_VERSION;
  timeField: 'matchStartTime';
  assignmentUnit: 'MATCH';
  tuningStart: string;
  futureTestStart: string;
  rule: {
    train: 'matchStartTime < tuningStart';
    tuning: 'tuningStart <= matchStartTime < futureTestStart';
    futureTest: 'matchStartTime >= futureTestStart';
  };
}

export interface RecommendationProDecisionDatasetV6ArtifactAudit
  extends RecommendationProDecisionDatasetV6Audit {
  source: {
    replayVersion: string;
    expectedRowCount: number;
    scannedRowCount: number;
    invalidRowCount: number;
    replaySha256: string;
  };
  timeline: {
    directory: string;
    decisionSnapshotStalenessS: number;
    joinedRowCount: number;
    missingRowCount: number;
  };
  snapshots: {
    registrySha256: string;
    snapshotCount: number;
    snapshotIds: string[];
  };
  splitDescriptor: RecommendationDatasetV6SplitDescriptor & {
    sha256: string;
  };
  build: {
    fullCorpus: boolean;
    diagnosticMaxRows?: number;
  };
  trainingArtifactEligible: boolean;
}

export interface RecommendationProDecisionDatasetV6ArtifactManifest {
  schemaVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION;
  datasetVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION;
  generatedAt: string;
  source: {
    kind: 'HISTORICAL_REPLAY';
    replayVersion: typeof RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION;
    directory: string;
    fileName: string;
    sha256: string;
    byteLength: number;
    manifestRowCount: number;
    scannedRowCount: number;
  };
  candidateGeneratorSnapshots: {
    registryPath: string;
    registrySha256: string;
    snapshotCount: number;
    snapshotIds: string[];
  };
  timelineSource: {
    directory: string;
    decisionSnapshotStalenessS: number;
    featureCutoff: 'LATEST_AT_OR_BEFORE_ELSE_EARLIEST_AFTER_WITHIN_STALENESS';
  };
  splitDescriptor: RecommendationDatasetV6SplitDescriptor & {
    sha256: string;
  };
  artifact: {
    format: 'NDJSON';
    compression: 'GZIP';
    fileName: typeof DATASET_FILE_NAME;
    byteLength: number;
    uncompressedByteLength: number;
    sha256: string;
    rowCount: number;
  };
  build: {
    fullCorpus: boolean;
    diagnosticMaxRows?: number;
  };
  featureContract: {
    featureCutoff: 'DECISION_TIME_WITH_FUTURE_SNAPSHOT_FALLBACK';
    stateFeatureVersion: typeof RECOMMENDATION_STATE_FEATURE_VERSION_V6;
    decisionSource: 'HISTORICAL_REPLAY';
    candidateSpecificFeatures: true;
    observedActionInjectedIntoCandidates: false;
    currentGoldAvailable: false;
    netWorthUsedAsCurrentGold: false;
    v5_3UsedAsInput: false;
    userLiveUsedAsInput: false;
    futureTestEligibleForSelection: false;
    finalOutcomeAuxiliary: false;
    terminalOutcomeBackfill: true;
    futureSnapshotFallbackAllowed: true;
    maximumFutureSnapshotLagS: 300;
    shortHorizonTargets: ['3m', '5m', '10m'];
  };
  auditPassed: boolean;
  trainingArtifactEligible: boolean;
}

interface NormalizedOptions {
  tuningStart: string;
  futureTestStart: string;
  expectedReplaySha256?: string;
  expectedSnapshotRegistrySha256?: string;
  decisionSnapshotStalenessS: number;
  maxRows?: number;
  thresholds: RecommendationDatasetV6Thresholds;
}

interface ReplaySourceArtifact {
  datasetPath: string;
  sha256: string;
  byteLength: number;
  rowCount: number;
}

interface SnapshotCatalogBundle {
  registrySha256: string;
  artifactsBySnapshotId: ReadonlyMap<
    string,
    RecommendationCandidateGeneratorSnapshotArtifact
  >;
}

interface TimelineCache {
  matchId?: string;
  snapshots: MatchTimelinePlayerSnapshot[];
}

@Injectable()
export class RecommendationProDecisionDatasetV6ArtifactService
  implements OnModuleInit
{
  private readonly logger = new Logger(
    RecommendationProDecisionDatasetV6ArtifactService.name,
  );
  private readonly replayDirectory =
    process.env.DEADLOCK_RECOMMENDATION_DATASET_V6_REPLAY_DIR?.trim() ||
    DEFAULT_REPLAY_DIRECTORY;
  private readonly snapshotRegistryPath =
    process.env.DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_PATH?.trim() ||
    DEFAULT_SNAPSHOT_REGISTRY_PATH;
  private readonly timelineDirectory =
    process.env.DEADLOCK_TIMELINE_STORAGE_DIR?.trim() ||
    DEFAULT_TIMELINE_DIRECTORY;
  private readonly outputDirectory =
    process.env.DEADLOCK_RECOMMENDATION_DATASET_V6_DIR?.trim() ||
    DEFAULT_OUTPUT_DIRECTORY;
  private readonly datasetPath = join(this.outputDirectory, DATASET_FILE_NAME);
  private readonly manifestPath = join(this.outputDirectory, 'manifest.json');
  private readonly auditPath = join(this.outputDirectory, 'audit.json');
  private status = this.idleStatus();
  private manifest?: RecommendationProDecisionDatasetV6ArtifactManifest;
  private audit?: RecommendationProDecisionDatasetV6ArtifactAudit;
  private runPromise: Promise<void> = Promise.resolve();

  async onModuleInit(): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
    this.manifest = await readJson<RecommendationProDecisionDatasetV6ArtifactManifest>(
      this.manifestPath,
    );
    this.audit = await readJson<RecommendationProDecisionDatasetV6ArtifactAudit>(
      this.auditPath,
    );
    if (
      this.manifest &&
      this.audit &&
      (await exists(this.datasetPath))
    ) {
      this.status = {
        ...this.idleStatus(),
        state: 'COMPLETE',
        phase: 'COMPLETE',
        sourceRowCount: this.audit.source.scannedRowCount,
        outputRowCount: this.audit.decisionCount,
        timelineJoinedRowCount: this.audit.timeline.joinedRowCount,
        missingTimelineRowCount: this.audit.timeline.missingRowCount,
        completedAt: this.manifest.generatedAt,
        datasetAvailable: true,
        manifestAvailable: true,
        auditAvailable: true,
        auditPassed: this.audit.passed,
        trainingArtifactEligible: this.audit.trainingArtifactEligible,
      };
    }
  }

  async start(
    request: RecommendationProDecisionDatasetV6StartRequest,
  ): Promise<RecommendationProDecisionDatasetV6Status> {
    if (this.status.state === 'RUNNING') {
      throw new Error('Recommendation Dataset V6 build is already running.');
    }
    const options = normalizeOptions(request);
    const startedAt = new Date().toISOString();
    this.status = {
      ...this.idleStatus(),
      state: 'RUNNING',
      phase: 'PREPARING',
      startedAt,
    };
    this.runPromise = this.run(options, startedAt);
    return this.getStatus();
  }

  async waitForIdle(): Promise<void> {
    await this.runPromise;
  }

  getStatus(): RecommendationProDecisionDatasetV6Status {
    return clone(this.status);
  }

  getManifest(): RecommendationProDecisionDatasetV6ArtifactManifest | undefined {
    return this.manifest ? clone(this.manifest) : undefined;
  }

  getAudit(): RecommendationProDecisionDatasetV6ArtifactAudit | undefined {
    return this.audit ? clone(this.audit) : undefined;
  }

  private async run(
    options: NormalizedOptions,
    startedAt: string,
  ): Promise<void> {
    const partialDatasetPath = `${this.datasetPath}.partial`;
    try {
      const source = await loadReplaySource(
        this.replayDirectory,
        options.expectedReplaySha256,
      );
      const snapshots = await loadSnapshotCatalogBundle(
        this.snapshotRegistryPath,
        options.expectedSnapshotRegistrySha256,
      );
      const splitDescriptor = createSplitDescriptor(options);
      const splitDescriptorSha256 = sha256StableJson(splitDescriptor);
      await Promise.all([
        rm(this.datasetPath, { force: true }),
        rm(partialDatasetPath, { force: true }),
        rm(this.manifestPath, { force: true }),
        rm(this.auditPath, { force: true }),
      ]);

      this.status = { ...this.status, phase: 'BUILDING' };
      const writer = await GzipNdjsonWriter.create(partialDatasetPath);
      const accumulator =
        new RecommendationProDecisionDatasetV6AuditAccumulator(
          options.thresholds,
        );
      const timelineCache: TimelineCache = { snapshots: [] };
      let scannedRowCount = 0;
      let outputRowCount = 0;
      let invalidRowCount = 0;
      let timelineJoinedRowCount = 0;
      let missingTimelineRowCount = 0;
      let uncompressedByteLength = 0;

      try {
        for await (const value of ndjson(source.datasetPath)) {
          if (
            options.maxRows !== undefined &&
            scannedRowCount >= options.maxRows
          ) {
            break;
          }
          scannedRowCount += 1;
          let replayRow: RecommendationHistoricalProReplayRow;
          try {
            replayRow = replaySourceRow(value, scannedRowCount);
          } catch {
            invalidRowCount += 1;
            continue;
          }

          const snapshotArtifact = snapshots.artifactsBySnapshotId.get(
            replayRow.generatorSnapshot.snapshotId,
          );
          if (!snapshotArtifact) {
            throw new Error(
              `Missing immutable candidate generator snapshot ` +
                `${replayRow.generatorSnapshot.snapshotId}.`,
            );
          }
          validateReplaySnapshotLineage(replayRow, snapshotArtifact);
          const catalogItemsById = new Map<
            number,
            RecommendationHistoricalCatalogItem
          >(
            snapshotArtifact.catalog.items.map((item) => [
              item.itemId,
              clone(item),
            ]),
          );

          if (timelineCache.matchId !== replayRow.matchId) {
            timelineCache.matchId = replayRow.matchId;
            timelineCache.snapshots = await loadTimelineSnapshots(
              this.timelineDirectory,
              replayRow.matchId,
            );
          }
          const decisionTimelineSnapshot = selectDecisionTimelineSnapshot({
            replayRow,
            snapshots: timelineCache.snapshots,
            stalenessS: options.decisionSnapshotStalenessS,
          });
          if (decisionTimelineSnapshot) {
            timelineJoinedRowCount += 1;
          } else {
            missingTimelineRowCount += 1;
          }

          const row = createRecommendationProDecisionDatasetV6Row({
            replayRow,
            split: assignSplit(replayRow.matchStartTime, splitDescriptor),
            catalogItemsById,
            decisionTimelineSnapshot,
          });
          accumulator.observe(row);
          await writer.write(row);
          outputRowCount += 1;
          if (outputRowCount % 50_000 === 0) {
            this.status = {
              ...this.status,
              sourceRowCount: scannedRowCount,
              outputRowCount,
              timelineJoinedRowCount,
              missingTimelineRowCount,
            };
            await tick();
          }
        }
        await writer.close();
        uncompressedByteLength = writer.uncompressedByteLength;
      } catch (error) {
        await writer.abort();
        throw error;
      }

      this.status = {
        ...this.status,
        phase: 'FINALIZING',
        sourceRowCount: scannedRowCount,
        outputRowCount,
        timelineJoinedRowCount,
        missingTimelineRowCount,
      };
      await rename(partialDatasetPath, this.datasetPath);
      const generatedAt = new Date().toISOString();
      const coreAudit = accumulator.finalize(generatedAt);
      const fullCorpus = options.maxRows === undefined;
      const sourceCountMatches = fullCorpus
        ? scannedRowCount === source.rowCount
        : scannedRowCount <= source.rowCount;
      const additionalReasons: string[] = [];
      if (!sourceCountMatches) {
        additionalReasons.push(
          'Scanned replay row count does not match the source manifest.',
        );
      }
      if (invalidRowCount > 0) {
        additionalReasons.push('Historical replay contains invalid rows.');
      }
      if (outputRowCount === 0) {
        additionalReasons.push('Dataset V6 produced no rows.');
      }
      if (!fullCorpus) {
        additionalReasons.push(
          'Diagnostic maxRows was used; artifact is not eligible for training.',
        );
      }
      const reasons = [...coreAudit.reasons, ...additionalReasons];
      const trainingArtifactEligible = fullCorpus && reasons.length === 0;
      const audit: RecommendationProDecisionDatasetV6ArtifactAudit = {
        ...coreAudit,
        passed: reasons.length === 0,
        reasons,
        source: {
          replayVersion: RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION,
          expectedRowCount: source.rowCount,
          scannedRowCount,
          invalidRowCount,
          replaySha256: source.sha256,
        },
        timeline: {
          directory: this.timelineDirectory,
          decisionSnapshotStalenessS: options.decisionSnapshotStalenessS,
          joinedRowCount: timelineJoinedRowCount,
          missingRowCount: missingTimelineRowCount,
        },
        snapshots: {
          registrySha256: snapshots.registrySha256,
          snapshotCount: snapshots.artifactsBySnapshotId.size,
          snapshotIds: [...snapshots.artifactsBySnapshotId.keys()].sort(),
        },
        splitDescriptor: {
          ...splitDescriptor,
          sha256: splitDescriptorSha256,
        },
        build: {
          fullCorpus,
          diagnosticMaxRows: options.maxRows,
        },
        trainingArtifactEligible,
      };
      const datasetStat = await stat(this.datasetPath);
      const manifest: RecommendationProDecisionDatasetV6ArtifactManifest = {
        schemaVersion: RECOMMENDATION_PRO_DECISION_DATASET_V6_SCHEMA_VERSION,
        datasetVersion: RECOMMENDATION_PRO_DECISION_DATASET_V6_VERSION,
        generatedAt,
        source: {
          kind: 'HISTORICAL_REPLAY',
          replayVersion: RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION,
          directory: this.replayDirectory,
          fileName: DATASET_FILE_NAME,
          sha256: source.sha256,
          byteLength: source.byteLength,
          manifestRowCount: source.rowCount,
          scannedRowCount,
        },
        candidateGeneratorSnapshots: {
          registryPath: this.snapshotRegistryPath,
          registrySha256: snapshots.registrySha256,
          snapshotCount: snapshots.artifactsBySnapshotId.size,
          snapshotIds: [...snapshots.artifactsBySnapshotId.keys()].sort(),
        },
        timelineSource: {
          directory: this.timelineDirectory,
          decisionSnapshotStalenessS: options.decisionSnapshotStalenessS,
          featureCutoff: 'LATEST_AT_OR_BEFORE_ELSE_EARLIEST_AFTER_WITHIN_STALENESS',
        },
        splitDescriptor: {
          ...splitDescriptor,
          sha256: splitDescriptorSha256,
        },
        artifact: {
          format: 'NDJSON',
          compression: 'GZIP',
          fileName: DATASET_FILE_NAME,
          byteLength: datasetStat.size,
          uncompressedByteLength,
          sha256: await hashFile(this.datasetPath),
          rowCount: outputRowCount,
        },
        build: {
          fullCorpus,
          diagnosticMaxRows: options.maxRows,
        },
        featureContract: {
          featureCutoff: 'DECISION_TIME_WITH_FUTURE_SNAPSHOT_FALLBACK',
          stateFeatureVersion: RECOMMENDATION_STATE_FEATURE_VERSION_V6,
          decisionSource: 'HISTORICAL_REPLAY',
          candidateSpecificFeatures: true,
          observedActionInjectedIntoCandidates: false,
          currentGoldAvailable: false,
          netWorthUsedAsCurrentGold: false,
          v5_3UsedAsInput: false,
          userLiveUsedAsInput: false,
          futureTestEligibleForSelection: false,
          finalOutcomeAuxiliary: false,
          terminalOutcomeBackfill: true,
          futureSnapshotFallbackAllowed: true,
          maximumFutureSnapshotLagS: 300,
          shortHorizonTargets: ['3m', '5m', '10m'],
        },
        auditPassed: audit.passed,
        trainingArtifactEligible,
      };

      await Promise.all([
        atomicJson(this.auditPath, audit),
        atomicJson(this.manifestPath, manifest),
      ]);
      this.audit = audit;
      this.manifest = manifest;
      this.status = {
        ...this.status,
        state: 'COMPLETE',
        phase: 'COMPLETE',
        sourceRowCount: scannedRowCount,
        outputRowCount,
        timelineJoinedRowCount,
        missingTimelineRowCount,
        completedAt: generatedAt,
        datasetAvailable: true,
        manifestAvailable: true,
        auditAvailable: true,
        auditPassed: audit.passed,
        trainingArtifactEligible,
      };
      this.logger.log(
        `Recommendation Dataset V6 completed with ${outputRowCount} rows.`,
      );
    } catch (error) {
      await rm(partialDatasetPath, { force: true });
      const message = errorMessage(error);
      this.status = {
        ...this.status,
        state: 'FAILED',
        completedAt: new Date().toISOString(),
        error: message,
      };
      this.logger.error(`Recommendation Dataset V6 failed: ${message}`);
    }
  }

  private idleStatus(): RecommendationProDecisionDatasetV6Status {
    return {
      state: 'IDLE',
      phase: 'PREPARING',
      sourceRowCount: 0,
      outputRowCount: 0,
      timelineJoinedRowCount: 0,
      missingTimelineRowCount: 0,
      outputDirectory: this.outputDirectory,
      datasetPath: this.datasetPath,
      datasetAvailable: false,
      manifestAvailable: false,
      auditAvailable: false,
    };
  }
}

async function loadReplaySource(
  directory: string,
  expectedSha256: string | undefined,
): Promise<ReplaySourceArtifact> {
  const manifest = await requiredJson<Record<string, unknown>>(
    join(directory, 'manifest.json'),
    'Historical replay manifest',
  );
  const audit = await requiredJson<Record<string, unknown>>(
    join(directory, 'audit.json'),
    'Historical replay audit',
  );
  if (
    manifest.replayVersion !== RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION ||
    manifest.auditPassed !== true ||
    manifest.trainingArtifactEligible !== true ||
    audit.passed !== true ||
    audit.trainingArtifactEligible !== true
  ) {
    throw new Error(
      'Historical replay is not eligible as a Dataset V6 source.',
    );
  }
  const artifact = requiredRecord(manifest.artifact, 'Historical replay artifact');
  const fileName = requiredText(artifact.fileName, 'Historical replay fileName');
  if (basename(fileName) !== fileName || fileName.includes('..')) {
    throw new Error('Historical replay fileName must be local.');
  }
  const datasetPath = join(directory, fileName);
  const manifestSha256 = requiredSha(
    artifact.sha256,
    'Historical replay artifact SHA-256',
  );
  const actualSha256 = await hashFile(datasetPath);
  if (actualSha256 !== manifestSha256) {
    throw new Error('Historical replay artifact SHA-256 mismatch.');
  }
  if (expectedSha256 && expectedSha256 !== actualSha256) {
    throw new Error(
      `Expected replay SHA-256 ${expectedSha256} does not match ` +
        `${actualSha256}.`,
    );
  }
  return {
    datasetPath,
    sha256: actualSha256,
    byteLength: (await stat(datasetPath)).size,
    rowCount: positiveInteger(
      artifact.rowCount,
      'Historical replay artifact rowCount',
    ),
  };
}

async function loadSnapshotCatalogBundle(
  registryPath: string,
  expectedSha256: string | undefined,
): Promise<SnapshotCatalogBundle> {
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

  const artifactsBySnapshotId = new Map<
    string,
    RecommendationCandidateGeneratorSnapshotArtifact
  >();
  for (const entry of registry.snapshots) {
    if (
      basename(entry.fileName) !== entry.fileName ||
      entry.fileName.includes('..')
    ) {
      throw new Error('Snapshot registry fileName must be local.');
    }
    const artifactRaw = await readFile(
      join(dirname(registryPath), entry.fileName),
      'utf8',
    );
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
    if (artifactsBySnapshotId.has(artifact.snapshot.snapshotId)) {
      throw new Error(
        `Candidate generator registry duplicates ${artifact.snapshot.snapshotId}.`,
      );
    }
    artifactsBySnapshotId.set(artifact.snapshot.snapshotId, artifact);
  }
  return { registrySha256, artifactsBySnapshotId };
}

async function loadTimelineSnapshots(
  root: string,
  matchId: string,
): Promise<MatchTimelinePlayerSnapshot[]> {
  const directory = join(root, matchId);
  const audit = await readJson<Record<string, unknown>>(
    join(directory, 'audit.json'),
  );
  if (!audit || audit.passed !== true) {
    return [];
  }
  const snapshots: MatchTimelinePlayerSnapshot[] = [];
  for await (const value of ndjson(
    join(directory, 'player-snapshots.ndjson'),
    true,
  )) {
    if (isRecord(value)) {
      snapshots.push(value as unknown as MatchTimelinePlayerSnapshot);
    }
  }
  snapshots.sort(
    (left, right) =>
      left.gameTimeS - right.gameTimeS ||
      left.tick - right.tick ||
      left.snapshotId.localeCompare(right.snapshotId),
  );
  return snapshots;
}

function selectDecisionTimelineSnapshot(input: {
  replayRow: RecommendationHistoricalProReplayRow;
  snapshots: readonly MatchTimelinePlayerSnapshot[];
  stalenessS: number;
}): MatchTimelinePlayerSnapshot | undefined {
  const matchId = Number(input.replayRow.matchId);
  if (!Number.isSafeInteger(matchId)) {
    return undefined;
  }
  return selectRecommendationDecisionTimelineSnapshot({
    matchId,
    heroId: input.replayRow.heroId,
    team: input.replayRow.team,
    gameTimeS: input.replayRow.decisionGameTimeS,
    snapshots: input.snapshots,
    snapshotStalenessS: input.stalenessS,
  });
}

function validateReplaySnapshotLineage(
  row: RecommendationHistoricalProReplayRow,
  artifact: RecommendationCandidateGeneratorSnapshotArtifact,
): void {
  const expected = row.generatorSnapshot;
  const actual = artifact.snapshot;
  if (
    expected.snapshotId !== actual.snapshotId ||
    expected.generatorVersion !== actual.generatorVersion ||
    expected.policyVersion !== actual.policyVersion ||
    expected.policySha256 !== actual.policySha256 ||
    expected.catalogVersion !== actual.catalogVersion ||
    expected.catalogSha256 !== actual.catalogSha256 ||
    expected.trainingWindowStart !== actual.trainingWindowStart ||
    expected.trainingWindowEnd !== actual.trainingWindowEnd
  ) {
    throw new Error(
      `Replay snapshot lineage does not match immutable artifact ` +
        `${actual.snapshotId}.`,
    );
  }
}

function replaySourceRow(
  value: unknown,
  line: number,
): RecommendationHistoricalProReplayRow {
  if (
    !isRecord(value) ||
    value.schemaVersion !== RECOMMENDATION_HISTORICAL_PRO_REPLAY_SCHEMA_VERSION ||
    value.replayVersion !== RECOMMENDATION_HISTORICAL_PRO_REPLAY_VERSION ||
    value.dataSource !== 'PRO_HISTORICAL' ||
    typeof value.decisionId !== 'string' ||
    typeof value.matchId !== 'string' ||
    typeof value.matchStartTime !== 'string' ||
    typeof value.playerId !== 'string' ||
    !Array.isArray(value.candidates) ||
    !isRecord(value.generatorSnapshot)
  ) {
    throw new Error(`Invalid historical replay row at line ${line}.`);
  }
  return value as unknown as RecommendationHistoricalProReplayRow;
}

function createSplitDescriptor(
  options: Pick<NormalizedOptions, 'tuningStart' | 'futureTestStart'>,
): RecommendationDatasetV6SplitDescriptor {
  return {
    version: SPLIT_DESCRIPTOR_VERSION,
    timeField: 'matchStartTime',
    assignmentUnit: 'MATCH',
    tuningStart: options.tuningStart,
    futureTestStart: options.futureTestStart,
    rule: {
      train: 'matchStartTime < tuningStart',
      tuning: 'tuningStart <= matchStartTime < futureTestStart',
      futureTest: 'matchStartTime >= futureTestStart',
    },
  };
}

function assignSplit(
  matchStartTime: string,
  descriptor: RecommendationDatasetV6SplitDescriptor,
): RecommendationDatasetV6Split {
  const matchTime = requiredTimestamp(matchStartTime, 'matchStartTime');
  if (matchTime < Date.parse(descriptor.tuningStart)) {
    return 'TRAIN';
  }
  if (matchTime < Date.parse(descriptor.futureTestStart)) {
    return 'TUNING';
  }
  return 'FUTURE_TEST';
}

function normalizeOptions(
  request: RecommendationProDecisionDatasetV6StartRequest,
): NormalizedOptions {
  const tuningStart = requiredIso(request.tuningStart, 'tuningStart');
  const futureTestStart = requiredIso(
    request.futureTestStart,
    'futureTestStart',
  );
  if (Date.parse(tuningStart) >= Date.parse(futureTestStart)) {
    throw new Error('tuningStart must be earlier than futureTestStart.');
  }
  return {
    tuningStart,
    futureTestStart,
    expectedReplaySha256: optionalSha(
      request.expectedReplaySha256,
      'expectedReplaySha256',
    ),
    expectedSnapshotRegistrySha256: optionalSha(
      request.expectedSnapshotRegistrySha256,
      'expectedSnapshotRegistrySha256',
    ),
    decisionSnapshotStalenessS: boundedInteger(
      request.decisionSnapshotStalenessS,
      120,
      0,
      3_600,
      'decisionSnapshotStalenessS',
    ),
    maxRows: optionalPositiveInteger(request.maxRows, 'maxRows'),
    thresholds: {
      minimumTimelineJoinCoverage: boundedFraction(
        request.thresholds?.minimumTimelineJoinCoverage,
        DEFAULT_RECOMMENDATION_DATASET_V6_THRESHOLDS.minimumTimelineJoinCoverage,
        'minimumTimelineJoinCoverage',
      ),
      minimumCandidateMetadataCoverage: boundedFraction(
        request.thresholds?.minimumCandidateMetadataCoverage,
        DEFAULT_RECOMMENDATION_DATASET_V6_THRESHOLDS.minimumCandidateMetadataCoverage,
        'minimumCandidateMetadataCoverage',
      ),
      minimumObservedActionCandidateCoverage: boundedFraction(
        request.thresholds?.minimumObservedActionCandidateCoverage,
        DEFAULT_RECOMMENDATION_DATASET_V6_THRESHOLDS.minimumObservedActionCandidateCoverage,
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

async function requiredJson<T>(path: string, label: string): Promise<T> {
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

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function requiredSha(value: unknown, label: string): string {
  const result = requiredText(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new Error(`${label} must be a SHA-256 value.`);
  }
  return result;
}

function optionalSha(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : requiredSha(value, label);
}

function positiveInteger(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return result;
}

function optionalPositiveInteger(
  value: number | undefined,
  label: string,
): number | undefined {
  return value === undefined ? undefined : positiveInteger(value, label);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return result;
}

function boundedFraction(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 0 || result > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
  return result;
}

function requiredIso(value: string, label: string): string {
  requiredTimestamp(value, label);
  return new Date(value).toISOString();
}

function requiredTimestamp(value: string, label: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
