import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  FileHandle,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { CanonicalBuildStep } from './canonical-build-sequence.service';
import {
  HeroBuildOfflineEvaluationDataLoaderService,
  HeroBuildOfflineLoadedHeroSample,
  chunkValues,
  isEvaluableBuildSequence,
} from './hero-build-offline-evaluation-data-loader.service';
import {
  HeroBuildEvaluationPhase,
  getHeroBuildEvaluationPhase,
} from './hero-build-offline-evaluation.service';

export const HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION = 1;
export const HERO_BUILD_DECISION_DATASET_V3_DEFAULT_MAX_MATCHES = 13_000;
export const HERO_BUILD_DECISION_DATASET_V3_MAX_MATCHES = 13_000;
export const HERO_BUILD_DECISION_DATASET_V3_DEFAULT_BATCH_SIZE = 100;
export const HERO_BUILD_DECISION_DATASET_V3_MIN_BATCH_SIZE = 10;
export const HERO_BUILD_DECISION_DATASET_V3_MAX_BATCH_SIZE = 500;
export const HERO_BUILD_DECISION_DATASET_V3_PERSISTENCE_MODE =
  'CHECKPOINT_PER_HERO' as const;

const DEFAULT_STORAGE_DIRECTORY =
  '/app/apps/api/storage/build-decision-dataset-v3';
const STORAGE_DIRECTORY_ENV = 'DEADLOCK_BUILD_DECISION_DATASET_V3_STORAGE_DIR';
const AUTO_RESUME_ENV = 'DEADLOCK_BUILD_DECISION_DATASET_V3_AUTO_RESUME';
const NDJSON_BUFFER_LIMIT_BYTES = 1024 * 1024;

export type HeroBuildDecisionDatasetV3RunState =
  | 'IDLE'
  | 'RUNNING'
  | 'COMPLETE'
  | 'FAILED';

export type HeroBuildDecisionDatasetV3ProgressPhase =
  | 'PREPARING'
  | 'EXTRACTING'
  | 'FINALIZING'
  | 'COMPLETE';

export type HeroBuildDecisionActionType = 'BUY' | 'REBUY' | 'UPGRADE';

export interface HeroBuildDecisionDatasetV3StartRequest {
  maxMatches?: number;
  batchSize?: number;
  includeSellActions?: boolean;
}

export interface HeroBuildDecisionDatasetV3Options {
  maxMatches: number;
  batchSize: number;
  includeSellActions: boolean;
}

export interface HeroBuildDecisionDatasetV3Row {
  schemaVersion: typeof HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION;
  decisionId: string;
  matchId: number;
  matchStartTime: string;
  playerId: number;
  heroId: number;
  team: number;
  gameTimeS: number;
  phase: HeroBuildEvaluationPhase;
  inventoryBeforeStateKey: string;
  inventoryAfterStateKey: string;
  previousActionKeys: string[];
  buildPrefixKey: string;
  alliedHeroIds: number[];
  enemyHeroIds: number[];
  actualActionType: HeroBuildDecisionActionType | 'SELL';
  actualItemId: number;
  actualActionKey: string;
  outcomeLabel: {
    playerWon: boolean;
  };
}

export interface HeroBuildDecisionDatasetV3AuditBucket {
  rowCount: number;
}

export interface HeroBuildDecisionDatasetV3HeroAuditBucket
  extends HeroBuildDecisionDatasetV3AuditBucket {
  playerCount: number;
  excludedSequenceCount: number;
}

export interface HeroBuildDecisionDatasetV3Audit {
  schemaVersion: typeof HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION;
  generatedAt: string;
  passed: boolean;
  source: {
    selectedMatchCount: number;
    matchCountWithRows: number;
    playerCountWithRows: number;
    sourcePlayerCount: number;
    includedPlayerCount: number;
    excludedSequenceCount: number;
    excludedSellActionCount: number;
    sourceWindowLastRefreshedAt?: string;
  };
  decisions: {
    rowCount: number;
    duplicateDecisionCount: number;
    invalidItemIdCount: number;
    nonMonotonicGameTimeCount: number;
    emptyInventoryBeforeCount: number;
  };
  roster: {
    alliedHeroCountHistogram: Record<string, number>;
    enemyHeroCountHistogram: Record<string, number>;
    rowsWithIncompleteAlliedRoster: number;
    rowsWithIncompleteEnemyRoster: number;
  };
  byHero: Record<string, HeroBuildDecisionDatasetV3HeroAuditBucket>;
  byPhase: Record<HeroBuildEvaluationPhase, HeroBuildDecisionDatasetV3AuditBucket>;
  byActionType: Record<string, HeroBuildDecisionDatasetV3AuditBucket>;
  leakageAudit: {
    featureFields: string[];
    labelFields: string[];
    forbiddenFutureFields: string[];
    forbiddenFutureFieldsPresent: string[];
    candidateSetMaterialized: false;
    buildArchetypeMaterialized: false;
  };
  warnings: string[];
}

export interface HeroBuildDecisionDatasetV3Manifest {
  schemaVersion: typeof HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION;
  datasetVersion: 'CONTEXTUAL_V3_DECISION_DATASET_1';
  generatedAt: string;
  target: 'OBSERVED_NEXT_ITEM_ACTION';
  heroIdNamespace: 'VALVE_API';
  rowOrder: 'HERO_ID_MATCH_TIME_DECISION_SEQUENCE';
  options: HeroBuildDecisionDatasetV3Options;
  source: {
    selectedMatchCount: number;
    selectedWindowStartTime?: string;
    selectedWindowEndTime?: string;
    sourceWindowLastRefreshedAt?: string;
    descriptorSha256: string;
  };
  artifact: {
    format: 'NDJSON';
    fileName: string;
    byteLength: number;
    sha256: string;
    rowCount: number;
  };
  featureContract: {
    featureCutoff: 'DECISION_TIME';
    features: string[];
    outcomeLabels: string[];
    excludedFutureFields: string[];
    candidateSetMaterialized: false;
    buildArchetypeMaterialized: false;
  };
  auditPassed: boolean;
  warnings: string[];
}

export interface HeroBuildDecisionDatasetV3Status {
  state: HeroBuildDecisionDatasetV3RunState;
  phase: HeroBuildDecisionDatasetV3ProgressPhase;
  totalMatchCount: number;
  totalHeroCount: number;
  processedHeroCount: number;
  processedMatchCount: number;
  rowCount: number;
  excludedSequenceCount: number;
  excludedSellActionCount: number;
  currentHeroId?: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  options?: HeroBuildDecisionDatasetV3Options;
  datasetAvailable: boolean;
  manifestAvailable: boolean;
  auditAvailable: boolean;
  checkpointAvailable: boolean;
  resumedFromCheckpoint: boolean;
  persistenceMode: typeof HERO_BUILD_DECISION_DATASET_V3_PERSISTENCE_MODE;
  storageDirectory: string;
  datasetPath: string;
}

interface PersistedDescriptor {
  matchId: number;
  startTime: string;
}

interface MutableAuditState {
  selectedMatchCount: number;
  sourcePlayerCount: number;
  includedPlayerCount: number;
  excludedSequenceCount: number;
  excludedSellActionCount: number;
  rowCount: number;
  duplicateDecisionCount: number;
  invalidItemIdCount: number;
  nonMonotonicGameTimeCount: number;
  emptyInventoryBeforeCount: number;
  rowsWithIncompleteAlliedRoster: number;
  rowsWithIncompleteEnemyRoster: number;
  matchIdsWithRows: number[];
  playerKeysWithRows: string[];
  alliedHeroCountHistogram: Record<string, number>;
  enemyHeroCountHistogram: Record<string, number>;
  byHero: Record<string, HeroBuildDecisionDatasetV3HeroAuditBucket>;
  byPhase: Record<HeroBuildEvaluationPhase, HeroBuildDecisionDatasetV3AuditBucket>;
  byActionType: Record<string, HeroBuildDecisionDatasetV3AuditBucket>;
}

interface HeroBuildDecisionDatasetV3Checkpoint {
  schemaVersion: typeof HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION;
  startedAt: string;
  options: HeroBuildDecisionDatasetV3Options;
  sourceWindowLastRefreshedAt?: string;
  descriptors: PersistedDescriptor[];
  heroIds: number[];
  nextHeroIndex: number;
  datasetByteLength: number;
  audit: MutableAuditState;
}

@Injectable()
export class HeroBuildDecisionDatasetV3Service implements OnModuleInit {
  private readonly logger = new Logger(HeroBuildDecisionDatasetV3Service.name);
  private readonly storageDirectory =
    process.env[STORAGE_DIRECTORY_ENV]?.trim() || DEFAULT_STORAGE_DIRECTORY;
  private readonly autoResume = readBooleanEnvironmentValue(AUTO_RESUME_ENV, true);
  private readonly datasetPath = join(this.storageDirectory, 'dataset.ndjson');
  private readonly partialDatasetPath = join(
    this.storageDirectory,
    'dataset.ndjson.partial',
  );
  private readonly checkpointPath = join(this.storageDirectory, 'checkpoint.json');
  private readonly manifestPath = join(this.storageDirectory, 'manifest.json');
  private readonly auditPath = join(this.storageDirectory, 'audit.json');

  private status: HeroBuildDecisionDatasetV3Status = this.createIdleStatus();
  private manifest?: HeroBuildDecisionDatasetV3Manifest;
  private audit?: HeroBuildDecisionDatasetV3Audit;

  constructor(
    private readonly dataLoader: HeroBuildOfflineEvaluationDataLoaderService,
  ) {}

  async onModuleInit(): Promise<void> {
    await mkdir(this.storageDirectory, { recursive: true });
    this.manifest = await this.readJson<HeroBuildDecisionDatasetV3Manifest>(
      this.manifestPath,
    );
    this.audit = await this.readJson<HeroBuildDecisionDatasetV3Audit>(
      this.auditPath,
    );
    const checkpoint =
      await this.readJson<HeroBuildDecisionDatasetV3Checkpoint>(
        this.checkpointPath,
      );
    if (this.autoResume && isCheckpoint(checkpoint)) {
      this.status = this.createRunningStatus(checkpoint, true);
      void this.run(checkpoint);
      return;
    }
    if (this.manifest && this.audit) {
      this.status = {
        ...this.createIdleStatus(),
        state: 'COMPLETE',
        phase: 'COMPLETE',
        totalMatchCount: this.manifest.source.selectedMatchCount,
        rowCount: this.manifest.artifact.rowCount,
        completedAt: this.manifest.generatedAt,
        options: { ...this.manifest.options },
        datasetAvailable: true,
        manifestAvailable: true,
        auditAvailable: true,
      };
    }
  }

  getStatus(): HeroBuildDecisionDatasetV3Status {
    return { ...this.status, options: cloneOptions(this.status.options) };
  }

  getManifest(): HeroBuildDecisionDatasetV3Manifest | undefined {
    return this.manifest ? cloneManifest(this.manifest) : undefined;
  }

  getAudit(): HeroBuildDecisionDatasetV3Audit | undefined {
    return this.audit ? cloneAudit(this.audit) : undefined;
  }

  async start(
    request: HeroBuildDecisionDatasetV3StartRequest = {},
  ): Promise<HeroBuildDecisionDatasetV3Status> {
    if (this.status.state === 'RUNNING') {
      throw new Error('Contextual V3 decision dataset extraction is already running.');
    }
    const options = normalizeOptions(request);
    await mkdir(this.storageDirectory, { recursive: true });
    const loaded = await this.dataLoader.loadMatchDescriptors(options.maxMatches);
    const descriptors = loaded.descriptors
      .map((descriptor) => ({
        matchId: descriptor.matchId,
        startTime: descriptor.startTime.toISOString(),
      }))
      .sort(compareDescriptors);
    if (descriptors.length === 0) {
      throw new Error('No valid matches are available for V3 decision dataset extraction.');
    }
    const heroIds = await this.dataLoader.collectHeroIds(
      loaded.descriptors,
      options.batchSize,
    );
    if (heroIds.length === 0) {
      throw new Error('No valid heroes are available for V3 decision dataset extraction.');
    }
    await Promise.all([
      rm(this.datasetPath, { force: true }),
      rm(this.partialDatasetPath, { force: true }),
      rm(this.manifestPath, { force: true }),
      rm(this.auditPath, { force: true }),
      rm(this.checkpointPath, { force: true }),
    ]);
    await writeFile(this.partialDatasetPath, '', 'utf8');
    this.manifest = undefined;
    this.audit = undefined;
    const checkpoint: HeroBuildDecisionDatasetV3Checkpoint = {
      schemaVersion: HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION,
      startedAt: new Date().toISOString(),
      options,
      sourceWindowLastRefreshedAt:
        loaded.sourceLastRefreshedAt?.toISOString(),
      descriptors,
      heroIds,
      nextHeroIndex: 0,
      datasetByteLength: 0,
      audit: createEmptyAuditState(descriptors.length),
    };
    await this.persistCheckpoint(checkpoint);
    this.status = this.createRunningStatus(checkpoint, false);
    void this.run(checkpoint);
    return this.getStatus();
  }

  private async run(
    initialCheckpoint: HeroBuildDecisionDatasetV3Checkpoint,
  ): Promise<void> {
    let checkpoint = cloneCheckpoint(initialCheckpoint);
    try {
      await mkdir(this.storageDirectory, { recursive: true });
      await ensureFile(this.partialDatasetPath);
      await truncate(this.partialDatasetPath, checkpoint.datasetByteLength);
      const matchIdsWithRows = new Set(checkpoint.audit.matchIdsWithRows);
      const playerKeysWithRows = new Set(checkpoint.audit.playerKeysWithRows);

      for (
        let heroIndex = checkpoint.nextHeroIndex;
        heroIndex < checkpoint.heroIds.length;
        heroIndex += 1
      ) {
        const heroId = checkpoint.heroIds[heroIndex];
        const heroTemporaryPath = join(
          this.storageDirectory,
          `hero-${heroId}.ndjson.tmp`,
        );
        await rm(heroTemporaryPath, { force: true });
        const writer = await BufferedNdjsonWriter.create(heroTemporaryPath);
        const heroDecisionIds = new Set<string>();
        const heroAudit = getOrCreateHeroBucket(checkpoint.audit.byHero, heroId);
        let heroIncludedPlayerCount = 0;
        let heroExcludedSequenceCount = 0;

        this.status = {
          ...this.status,
          phase: 'EXTRACTING',
          currentHeroId: heroId,
          processedHeroCount: heroIndex,
          processedMatchCount: 0,
        };

        try {
          const descriptorBatches = chunkValues(
            checkpoint.descriptors,
            checkpoint.options.batchSize,
          );
          for (
            let batchIndex = 0;
            batchIndex < descriptorBatches.length;
            batchIndex += 1
          ) {
            const descriptorBatch = descriptorBatches[batchIndex].map(
              (descriptor) => ({
                matchId: descriptor.matchId,
                startTime: new Date(descriptor.startTime),
              }),
            );
            const loaded = await this.dataLoader.loadHeroBatch(
              heroId,
              descriptorBatch,
              checkpoint.options.batchSize,
              `V3 decision dataset hero ${heroId}, batch ${batchIndex + 1}`,
            );
            checkpoint.audit.sourcePlayerCount += loaded.sourcePlayerCount;

            for (const sample of loaded.samples.sort(compareSamples)) {
              if (!isEvaluableBuildSequence(sample.sequence)) {
                checkpoint.audit.excludedSequenceCount += 1;
                heroExcludedSequenceCount += 1;
                continue;
              }
              checkpoint.audit.includedPlayerCount += 1;
              heroIncludedPlayerCount += 1;
              const rows = createHeroBuildDecisionRows(
                sample,
                checkpoint.options.includeSellActions,
              );
              checkpoint.audit.excludedSellActionCount += rows.excludedSellActionCount;
              checkpoint.audit.nonMonotonicGameTimeCount +=
                rows.nonMonotonicGameTimeCount;

              if (rows.rows.length > 0) {
                matchIdsWithRows.add(sample.descriptor.matchId);
                playerKeysWithRows.add(
                  `${sample.descriptor.matchId}:${sample.player.id}`,
                );
              }

              for (const row of rows.rows) {
                if (heroDecisionIds.has(row.decisionId)) {
                  checkpoint.audit.duplicateDecisionCount += 1;
                } else {
                  heroDecisionIds.add(row.decisionId);
                }
                applyRowAudit(checkpoint.audit, row);
                await writer.write(row);
              }
            }

            this.status = {
              ...this.status,
              processedMatchCount: Math.min(
                checkpoint.descriptors.length,
                (batchIndex + 1) * checkpoint.options.batchSize,
              ),
              rowCount: checkpoint.audit.rowCount,
              excludedSequenceCount: checkpoint.audit.excludedSequenceCount,
              excludedSellActionCount:
                checkpoint.audit.excludedSellActionCount,
            };
            await yieldToEventLoop();
          }
        } finally {
          await writer.close();
        }

        heroAudit.playerCount += heroIncludedPlayerCount;
        heroAudit.excludedSequenceCount += heroExcludedSequenceCount;
        await pipeline(
          createReadStream(heroTemporaryPath),
          createWriteStream(this.partialDatasetPath, { flags: 'a' }),
        );
        await rm(heroTemporaryPath, { force: true });
        const partialStat = await stat(this.partialDatasetPath);
        checkpoint = {
          ...checkpoint,
          nextHeroIndex: heroIndex + 1,
          datasetByteLength: partialStat.size,
          audit: {
            ...checkpoint.audit,
            matchIdsWithRows: [...matchIdsWithRows].sort((a, b) => a - b),
            playerKeysWithRows: [...playerKeysWithRows].sort(),
          },
        };
        await this.persistCheckpoint(checkpoint);
        this.status = {
          ...this.status,
          processedHeroCount: heroIndex + 1,
          currentHeroId: undefined,
          rowCount: checkpoint.audit.rowCount,
          checkpointAvailable: true,
        };
        await yieldToEventLoop();
      }

      this.status = { ...this.status, phase: 'FINALIZING' };
      await rm(this.datasetPath, { force: true });
      await rename(this.partialDatasetPath, this.datasetPath);
      const artifactStat = await stat(this.datasetPath);
      const artifactSha256 = await hashFile(this.datasetPath);
      const generatedAt = new Date().toISOString();
      const audit = createAudit(
        checkpoint,
        generatedAt,
        checkpoint.sourceWindowLastRefreshedAt,
      );
      const manifest = createManifest(
        checkpoint,
        generatedAt,
        artifactStat.size,
        artifactSha256,
        audit,
      );
      await Promise.all([
        this.writeJsonAtomically(this.auditPath, audit),
        this.writeJsonAtomically(this.manifestPath, manifest),
      ]);
      await rm(this.checkpointPath, { force: true });
      this.audit = audit;
      this.manifest = manifest;
      this.status = {
        ...this.status,
        state: 'COMPLETE',
        phase: 'COMPLETE',
        processedHeroCount: checkpoint.heroIds.length,
        processedMatchCount: checkpoint.descriptors.length,
        currentHeroId: undefined,
        completedAt: generatedAt,
        datasetAvailable: true,
        manifestAvailable: true,
        auditAvailable: true,
        checkpointAvailable: false,
        error: undefined,
      };
      this.logger.log(
        `Contextual V3 decision dataset completed with ${audit.decisions.rowCount} rows. ` +
          `Audit decision: ${audit.passed ? 'PASS' : 'FAIL'}.`,
      );
    } catch (error) {
      const message = getErrorMessage(error);
      this.status = {
        ...this.status,
        state: 'FAILED',
        error: message,
        completedAt: new Date().toISOString(),
        checkpointAvailable: true,
      };
      this.logger.error(`Contextual V3 decision dataset failed: ${message}`);
    }
  }

  private createIdleStatus(): HeroBuildDecisionDatasetV3Status {
    return {
      state: 'IDLE',
      phase: 'PREPARING',
      totalMatchCount: 0,
      totalHeroCount: 0,
      processedHeroCount: 0,
      processedMatchCount: 0,
      rowCount: 0,
      excludedSequenceCount: 0,
      excludedSellActionCount: 0,
      datasetAvailable: false,
      manifestAvailable: false,
      auditAvailable: false,
      checkpointAvailable: false,
      resumedFromCheckpoint: false,
      persistenceMode: HERO_BUILD_DECISION_DATASET_V3_PERSISTENCE_MODE,
      storageDirectory: this.storageDirectory,
      datasetPath: this.datasetPath,
    };
  }

  private createRunningStatus(
    checkpoint: HeroBuildDecisionDatasetV3Checkpoint,
    resumedFromCheckpoint: boolean,
  ): HeroBuildDecisionDatasetV3Status {
    return {
      ...this.createIdleStatus(),
      state: 'RUNNING',
      phase: checkpoint.nextHeroIndex > 0 ? 'EXTRACTING' : 'PREPARING',
      totalMatchCount: checkpoint.descriptors.length,
      totalHeroCount: checkpoint.heroIds.length,
      processedHeroCount: checkpoint.nextHeroIndex,
      rowCount: checkpoint.audit.rowCount,
      excludedSequenceCount: checkpoint.audit.excludedSequenceCount,
      excludedSellActionCount: checkpoint.audit.excludedSellActionCount,
      startedAt: checkpoint.startedAt,
      options: { ...checkpoint.options },
      checkpointAvailable: true,
      resumedFromCheckpoint,
    };
  }

  private async persistCheckpoint(
    checkpoint: HeroBuildDecisionDatasetV3Checkpoint,
  ): Promise<void> {
    await this.writeJsonAtomically(this.checkpointPath, checkpoint);
  }

  private async writeJsonAtomically(path: string, value: unknown): Promise<void> {
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(value, undefined, 2), 'utf8');
    await rename(temporaryPath, path);
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return undefined;
      }
      this.logger.warn(`Failed to read ${path}: ${getErrorMessage(error)}`);
      return undefined;
    }
  }
}

export function createHeroBuildDecisionRows(
  sample: HeroBuildOfflineLoadedHeroSample,
  includeSellActions: boolean,
): {
  rows: HeroBuildDecisionDatasetV3Row[];
  excludedSellActionCount: number;
  nonMonotonicGameTimeCount: number;
} {
  const rows: HeroBuildDecisionDatasetV3Row[] = [];
  const previousActionKeys: string[] = [];
  let excludedSellActionCount = 0;
  let nonMonotonicGameTimeCount = 0;
  let previousGameTimeS = Number.NEGATIVE_INFINITY;

  for (const step of sample.sequence.steps) {
    if (step.gameTimeS < previousGameTimeS) {
      nonMonotonicGameTimeCount += 1;
    }
    previousGameTimeS = Math.max(previousGameTimeS, step.gameTimeS);
    if (step.actionType === 'SELL' && !includeSellActions) {
      excludedSellActionCount += 1;
      previousActionKeys.push(step.actionKey);
      continue;
    }
    rows.push(createDecisionRow(sample, step, previousActionKeys));
    previousActionKeys.push(step.actionKey);
  }

  return { rows, excludedSellActionCount, nonMonotonicGameTimeCount };
}

function createDecisionRow(
  sample: HeroBuildOfflineLoadedHeroSample,
  step: CanonicalBuildStep,
  previousActionKeys: readonly string[],
): HeroBuildDecisionDatasetV3Row {
  return {
    schemaVersion: HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION,
    decisionId: `${sample.descriptor.matchId}:${sample.player.id}:${step.sequence}`,
    matchId: sample.descriptor.matchId,
    matchStartTime: sample.descriptor.startTime.toISOString(),
    playerId: sample.player.id,
    heroId: sample.sequence.heroId,
    team: sample.player.team,
    gameTimeS: step.gameTimeS,
    phase: getHeroBuildEvaluationPhase(step.gameTimeS),
    inventoryBeforeStateKey: step.beforeStateKey,
    inventoryAfterStateKey: step.afterStateKey,
    previousActionKeys: [...previousActionKeys],
    buildPrefixKey:
      previousActionKeys.length > 0 ? previousActionKeys.join('>') : 'EMPTY',
    alliedHeroIds: [...sample.alliedHeroIds],
    enemyHeroIds: [...sample.enemyHeroIds],
    actualActionType: step.actionType,
    actualItemId: step.itemId,
    actualActionKey: step.actionKey,
    outcomeLabel: {
      playerWon: sample.player.won,
    },
  };
}

function applyRowAudit(
  audit: MutableAuditState,
  row: HeroBuildDecisionDatasetV3Row,
): void {
  audit.rowCount += 1;
  if (!Number.isSafeInteger(row.actualItemId) || row.actualItemId <= 0) {
    audit.invalidItemIdCount += 1;
  }
  if (row.inventoryBeforeStateKey === 'EMPTY') {
    audit.emptyInventoryBeforeCount += 1;
  }
  if (row.alliedHeroIds.length < 5) {
    audit.rowsWithIncompleteAlliedRoster += 1;
  }
  if (row.enemyHeroIds.length < 6) {
    audit.rowsWithIncompleteEnemyRoster += 1;
  }
  incrementRecord(audit.alliedHeroCountHistogram, String(row.alliedHeroIds.length));
  incrementRecord(audit.enemyHeroCountHistogram, String(row.enemyHeroIds.length));
  getOrCreateBucket(audit.byPhase, row.phase).rowCount += 1;
  getOrCreateBucket(audit.byActionType, row.actualActionType).rowCount += 1;
  getOrCreateHeroBucket(audit.byHero, row.heroId).rowCount += 1;
}

function createAudit(
  checkpoint: HeroBuildDecisionDatasetV3Checkpoint,
  generatedAt: string,
  sourceWindowLastRefreshedAt?: string,
): HeroBuildDecisionDatasetV3Audit {
  const mutable = checkpoint.audit;
  const forbiddenFutureFields = [
    'kills',
    'deaths',
    'assists',
    'netWorth',
    'finalKills',
    'finalDeaths',
    'finalAssists',
    'finalNetWorth',
  ];
  const featureFields = [
    'heroId',
    'team',
    'gameTimeS',
    'phase',
    'inventoryBeforeStateKey',
    'previousActionKeys',
    'buildPrefixKey',
    'alliedHeroIds',
    'enemyHeroIds',
  ];
  const warnings: string[] = [];
  if (mutable.excludedSequenceCount > 0) {
    warnings.push(
      `${mutable.excludedSequenceCount} player sequences were excluded because replay diagnostics were present or no canonical steps were available.`,
    );
  }
  if (mutable.rowsWithIncompleteAlliedRoster > 0) {
    warnings.push(
      `${mutable.rowsWithIncompleteAlliedRoster} rows have fewer than five allied heroes in the stored roster.`,
    );
  }
  if (mutable.rowsWithIncompleteEnemyRoster > 0) {
    warnings.push(
      `${mutable.rowsWithIncompleteEnemyRoster} rows have fewer than six enemy heroes in the stored roster.`,
    );
  }
  warnings.push(
    'Candidate sets are intentionally not materialized in this extraction stage.',
  );
  warnings.push(
    'Build archetypes are intentionally not assigned; buildPrefixKey is an observed history key, not an archetype label.',
  );
  const passed =
    mutable.rowCount > 0 &&
    mutable.duplicateDecisionCount === 0 &&
    mutable.invalidItemIdCount === 0 &&
    mutable.nonMonotonicGameTimeCount === 0;

  return {
    schemaVersion: HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION,
    generatedAt,
    passed,
    source: {
      selectedMatchCount: mutable.selectedMatchCount,
      matchCountWithRows: mutable.matchIdsWithRows.length,
      playerCountWithRows: mutable.playerKeysWithRows.length,
      sourcePlayerCount: mutable.sourcePlayerCount,
      includedPlayerCount: mutable.includedPlayerCount,
      excludedSequenceCount: mutable.excludedSequenceCount,
      excludedSellActionCount: mutable.excludedSellActionCount,
      sourceWindowLastRefreshedAt,
    },
    decisions: {
      rowCount: mutable.rowCount,
      duplicateDecisionCount: mutable.duplicateDecisionCount,
      invalidItemIdCount: mutable.invalidItemIdCount,
      nonMonotonicGameTimeCount: mutable.nonMonotonicGameTimeCount,
      emptyInventoryBeforeCount: mutable.emptyInventoryBeforeCount,
    },
    roster: {
      alliedHeroCountHistogram: { ...mutable.alliedHeroCountHistogram },
      enemyHeroCountHistogram: { ...mutable.enemyHeroCountHistogram },
      rowsWithIncompleteAlliedRoster: mutable.rowsWithIncompleteAlliedRoster,
      rowsWithIncompleteEnemyRoster: mutable.rowsWithIncompleteEnemyRoster,
    },
    byHero: cloneRecord(mutable.byHero),
    byPhase: cloneRecord(mutable.byPhase),
    byActionType: cloneRecord(mutable.byActionType),
    leakageAudit: {
      featureFields,
      labelFields: ['outcomeLabel.playerWon'],
      forbiddenFutureFields,
      forbiddenFutureFieldsPresent: featureFields.filter((field) =>
        forbiddenFutureFields.includes(field),
      ),
      candidateSetMaterialized: false,
      buildArchetypeMaterialized: false,
    },
    warnings,
  };
}

function createManifest(
  checkpoint: HeroBuildDecisionDatasetV3Checkpoint,
  generatedAt: string,
  byteLength: number,
  sha256: string,
  audit: HeroBuildDecisionDatasetV3Audit,
): HeroBuildDecisionDatasetV3Manifest {
  const descriptorTimes = checkpoint.descriptors
    .map((descriptor) => new Date(descriptor.startTime).getTime())
    .filter(Number.isFinite);
  return {
    schemaVersion: HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION,
    datasetVersion: 'CONTEXTUAL_V3_DECISION_DATASET_1',
    generatedAt,
    target: 'OBSERVED_NEXT_ITEM_ACTION',
    heroIdNamespace: 'VALVE_API',
    rowOrder: 'HERO_ID_MATCH_TIME_DECISION_SEQUENCE',
    options: { ...checkpoint.options },
    source: {
      selectedMatchCount: checkpoint.descriptors.length,
      selectedWindowStartTime:
        descriptorTimes.length > 0
          ? new Date(Math.min(...descriptorTimes)).toISOString()
          : undefined,
      selectedWindowEndTime:
        descriptorTimes.length > 0
          ? new Date(Math.max(...descriptorTimes)).toISOString()
          : undefined,
      sourceWindowLastRefreshedAt: checkpoint.sourceWindowLastRefreshedAt,
      descriptorSha256: hashText(
        checkpoint.descriptors
          .map((descriptor) => `${descriptor.matchId}:${descriptor.startTime}`)
          .join('\n'),
      ),
    },
    artifact: {
      format: 'NDJSON',
      fileName: 'dataset.ndjson',
      byteLength,
      sha256,
      rowCount: audit.decisions.rowCount,
    },
    featureContract: {
      featureCutoff: 'DECISION_TIME',
      features: [...audit.leakageAudit.featureFields],
      outcomeLabels: [...audit.leakageAudit.labelFields],
      excludedFutureFields: [...audit.leakageAudit.forbiddenFutureFields],
      candidateSetMaterialized: false,
      buildArchetypeMaterialized: false,
    },
    auditPassed: audit.passed,
    warnings: [...audit.warnings],
  };
}

function createEmptyAuditState(selectedMatchCount: number): MutableAuditState {
  return {
    selectedMatchCount,
    sourcePlayerCount: 0,
    includedPlayerCount: 0,
    excludedSequenceCount: 0,
    excludedSellActionCount: 0,
    rowCount: 0,
    duplicateDecisionCount: 0,
    invalidItemIdCount: 0,
    nonMonotonicGameTimeCount: 0,
    emptyInventoryBeforeCount: 0,
    rowsWithIncompleteAlliedRoster: 0,
    rowsWithIncompleteEnemyRoster: 0,
    matchIdsWithRows: [],
    playerKeysWithRows: [],
    alliedHeroCountHistogram: {},
    enemyHeroCountHistogram: {},
    byHero: {},
    byPhase: {
      EARLY: { rowCount: 0 },
      MID: { rowCount: 0 },
      LATE: { rowCount: 0 },
    },
    byActionType: {},
  };
}

function normalizeOptions(
  request: HeroBuildDecisionDatasetV3StartRequest,
): HeroBuildDecisionDatasetV3Options {
  return {
    maxMatches: readBoundedInteger(
      request.maxMatches,
      HERO_BUILD_DECISION_DATASET_V3_DEFAULT_MAX_MATCHES,
      1,
      HERO_BUILD_DECISION_DATASET_V3_MAX_MATCHES,
      'maxMatches',
    ),
    batchSize: readBoundedInteger(
      request.batchSize,
      HERO_BUILD_DECISION_DATASET_V3_DEFAULT_BATCH_SIZE,
      HERO_BUILD_DECISION_DATASET_V3_MIN_BATCH_SIZE,
      HERO_BUILD_DECISION_DATASET_V3_MAX_BATCH_SIZE,
      'batchSize',
    ),
    includeSellActions: request.includeSellActions ?? false,
  };
}

function readBoundedInteger(
  value: number | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  fieldName: string,
): number {
  const resolved = value ?? defaultValue;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(
      `${fieldName} must be a safe integer from ${minimum} to ${maximum}.`,
    );
  }
  return resolved;
}

class BufferedNdjsonWriter {
  private buffer = '';

  private constructor(private readonly handle: FileHandle) {}

  static async create(path: string): Promise<BufferedNdjsonWriter> {
    return new BufferedNdjsonWriter(await open(path, 'w'));
  }

  async write(row: HeroBuildDecisionDatasetV3Row): Promise<void> {
    this.buffer += `${JSON.stringify(row)}\n`;
    if (Buffer.byteLength(this.buffer) >= NDJSON_BUFFER_LIMIT_BYTES) {
      await this.flush();
    }
  }

  async close(): Promise<void> {
    await this.flush();
    await this.handle.close();
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }
    const value = this.buffer;
    this.buffer = '';
    await this.handle.write(value);
  }
}

function getOrCreateBucket<T extends HeroBuildDecisionDatasetV3AuditBucket>(
  record: Record<string, T>,
  key: string,
): T {
  const existing = record[key];
  if (existing) {
    return existing;
  }
  const created = { rowCount: 0 } as T;
  record[key] = created;
  return created;
}

function getOrCreateHeroBucket(
  record: Record<string, HeroBuildDecisionDatasetV3HeroAuditBucket>,
  heroId: number,
): HeroBuildDecisionDatasetV3HeroAuditBucket {
  const key = String(heroId);
  const existing = record[key];
  if (existing) {
    return existing;
  }
  const created = {
    rowCount: 0,
    playerCount: 0,
    excludedSequenceCount: 0,
  };
  record[key] = created;
  return created;
}

function incrementRecord(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function compareDescriptors(left: PersistedDescriptor, right: PersistedDescriptor): number {
  return (
    new Date(left.startTime).getTime() - new Date(right.startTime).getTime() ||
    left.matchId - right.matchId
  );
}

function compareSamples(
  left: HeroBuildOfflineLoadedHeroSample,
  right: HeroBuildOfflineLoadedHeroSample,
): number {
  return (
    left.descriptor.startTime.getTime() - right.descriptor.startTime.getTime() ||
    left.descriptor.matchId - right.descriptor.matchId ||
    left.player.id - right.player.id
  );
}

function cloneOptions(
  options: HeroBuildDecisionDatasetV3Options | undefined,
): HeroBuildDecisionDatasetV3Options | undefined {
  return options ? { ...options } : undefined;
}

function cloneManifest(
  manifest: HeroBuildDecisionDatasetV3Manifest,
): HeroBuildDecisionDatasetV3Manifest {
  return JSON.parse(JSON.stringify(manifest)) as HeroBuildDecisionDatasetV3Manifest;
}

function cloneAudit(
  audit: HeroBuildDecisionDatasetV3Audit,
): HeroBuildDecisionDatasetV3Audit {
  return JSON.parse(JSON.stringify(audit)) as HeroBuildDecisionDatasetV3Audit;
}

function cloneCheckpoint(
  checkpoint: HeroBuildDecisionDatasetV3Checkpoint,
): HeroBuildDecisionDatasetV3Checkpoint {
  return JSON.parse(JSON.stringify(checkpoint)) as HeroBuildDecisionDatasetV3Checkpoint;
}

function cloneRecord<T>(record: Record<string, T>): Record<string, T> {
  return JSON.parse(JSON.stringify(record)) as Record<string, T>;
}

function isCheckpoint(
  value: HeroBuildDecisionDatasetV3Checkpoint | undefined,
): value is HeroBuildDecisionDatasetV3Checkpoint {
  return (
    value?.schemaVersion === HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION &&
    Array.isArray(value.descriptors) &&
    Array.isArray(value.heroIds) &&
    Number.isSafeInteger(value.nextHeroIndex) &&
    Number.isSafeInteger(value.datasetByteLength) &&
    typeof value.startedAt === 'string' &&
    typeof value.audit === 'object'
  );
}

async function ensureFile(path: string): Promise<void> {
  const handle = await open(path, 'a');
  await handle.close();
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function readBooleanEnvironmentValue(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }
  return value !== 'false' && value !== '0' && value !== 'no';
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
