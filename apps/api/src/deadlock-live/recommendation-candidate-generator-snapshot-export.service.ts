import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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
import { Repository } from 'typeorm';
import {
  HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION,
  type HeroBuildDecisionDatasetV3Row,
} from './hero-build-decision-dataset-v3.service';
import { ItemCatalogItem } from './entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './entities/item-catalog-recipe.entity';
import {
  getCatalogContentVersionId,
  ItemCatalogVersion,
} from './entities/item-catalog-version.entity';
import {
  createRecommendationCandidateGeneratorSnapshotArtifactFromNormalizedPolicies,
  RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_VERSION,
  type RecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationCandidateGeneratorSnapshotRegistry,
  type RecommendationCandidateGeneratorSnapshotRegistryEntry,
} from './recommendation-candidate-generator-snapshot';
import { RecommendationCandidateGeneratorPolicyAccumulator } from './recommendation-candidate-generator-policy-accumulator';
import type { RecommendationHistoricalCatalogItem } from './recommendation-historical-pro-replay';

const SOURCE_DATASET_VERSION = 'CONTEXTUAL_V3_DECISION_DATASET_1';
const DEFAULT_SOURCE_DIRECTORY =
  '/app/apps/api/storage/build-decision-dataset-v3';
const DEFAULT_OUTPUT_DIRECTORY =
  '/app/apps/api/storage/recommendation-candidate-generator-snapshots';
const REGISTRY_FILE_NAME = 'registry.json';

export interface RecommendationCandidateGeneratorSnapshotExportRequest {
  snapshotId: string;
  generatorVersion: string;
  policyVersion: string;
  catalogVersionId: number;
  trainingWindowStart: string;
  trainingWindowEnd: string;
  expectedSourceSha256?: string;
}

export interface RecommendationCandidateGeneratorSnapshotExportStatus {
  state: 'IDLE' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  phase: 'PREPARING' | 'AGGREGATING' | 'CATALOG' | 'WRITING' | 'COMPLETE';
  snapshotId?: string;
  sourceRowCount: number;
  selectedRowCount: number;
  excludedBeforeWindowCount: number;
  excludedAfterWindowCount: number;
  invalidSourceRowCount: number;
  heroCount: number;
  stateCount: number;
  actionOptionCount: number;
  catalogItemCount: number;
  catalogRecipeCount: number;
  outputDirectory: string;
  artifactPath?: string;
  registryPath: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface RecommendationCandidateGeneratorSnapshotExportAudit {
  schemaVersion: 1;
  auditVersion: 'RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_EXPORT_AUDIT_1';
  generatedAt: string;
  passed: boolean;
  snapshotId: string;
  source: {
    kind: 'POSTGRESQL_CONTEXTUAL_V3_SNAPSHOT';
    datasetVersion: string;
    directory: string;
    sha256: string;
    byteLength: number;
    manifestRowCount: number;
    scannedRowCount: number;
    selectedRowCount: number;
    excludedBeforeWindowCount: number;
    excludedAfterWindowCount: number;
    invalidSourceRowCount: number;
  };
  trainingWindow: {
    start: string;
    end: string;
  };
  policy: {
    heroCount: number;
    playerCount: number;
    stateCount: number;
    transitionCount: number;
    actionOptionCount: number;
    policySha256: string;
  };
  catalog: {
    requestedCatalogVersionId: number;
    contentCatalogVersionId: number;
    clientVersion: string;
    itemCount: number;
    recipeCount: number;
    catalogSha256: string;
  };
  artifact: {
    fileName: string;
    byteLength: number;
    sha256: string;
    artifactVersion: typeof RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_VERSION;
  };
  provenance: {
    dataSource: 'PRO_HISTORICAL';
    userLiveUsedAsInput: false;
    v5_3UsedAsInput: false;
  };
  reasons: string[];
}

interface SourceArtifact {
  datasetPath: string;
  sha256: string;
  byteLength: number;
  rowCount: number;
}

interface SourceSelectionSummary {
  scannedRowCount: number;
  selectedRowCount: number;
  excludedBeforeWindowCount: number;
  excludedAfterWindowCount: number;
  invalidSourceRowCount: number;
}

interface CatalogSnapshot {
  requestedCatalogVersionId: number;
  contentCatalogVersionId: number;
  clientVersion: string;
  items: RecommendationHistoricalCatalogItem[];
  recipeCount: number;
}

@Injectable()
export class RecommendationCandidateGeneratorSnapshotExportService
  implements OnModuleInit
{
  private readonly logger = new Logger(
    RecommendationCandidateGeneratorSnapshotExportService.name,
  );
  private readonly sourceDirectory =
    process.env.DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SOURCE_DIR?.trim() ||
    DEFAULT_SOURCE_DIRECTORY;
  private readonly outputDirectory =
    process.env.DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_DIR?.trim() ||
    DEFAULT_OUTPUT_DIRECTORY;
  private readonly registryPath = join(
    this.outputDirectory,
    REGISTRY_FILE_NAME,
  );
  private status = this.idleStatus();
  private runPromise: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(ItemCatalogVersion)
    private readonly catalogVersionRepository: Repository<ItemCatalogVersion>,
    @InjectRepository(ItemCatalogItem)
    private readonly catalogItemRepository: Repository<ItemCatalogItem>,
    @InjectRepository(ItemCatalogRecipe)
    private readonly catalogRecipeRepository: Repository<ItemCatalogRecipe>,
  ) {}

  async onModuleInit(): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
  }

  async start(
    request: RecommendationCandidateGeneratorSnapshotExportRequest,
  ): Promise<RecommendationCandidateGeneratorSnapshotExportStatus> {
    if (this.status.state === 'RUNNING') {
      throw new Error('Candidate generator snapshot export is already running.');
    }
    const normalized = normalizeRequest(request);
    const startedAt = new Date().toISOString();
    this.status = {
      ...this.idleStatus(),
      state: 'RUNNING',
      phase: 'PREPARING',
      snapshotId: normalized.snapshotId,
      startedAt,
      artifactPath: this.artifactPath(normalized.snapshotId),
    };
    this.runPromise = this.run(normalized, startedAt);
    return this.getStatus();
  }

  async waitForIdle(): Promise<void> {
    await this.runPromise;
  }

  getStatus(): RecommendationCandidateGeneratorSnapshotExportStatus {
    return clone(this.status);
  }

  async getRegistry(): Promise<RecommendationCandidateGeneratorSnapshotRegistry> {
    return (
      (await readJson<RecommendationCandidateGeneratorSnapshotRegistry>(
        this.registryPath,
      )) ?? emptyRegistry()
    );
  }

  private async run(
    request: RecommendationCandidateGeneratorSnapshotExportRequest,
    startedAt: string,
  ): Promise<void> {
    try {
      const source = await loadSourceArtifact(
        this.sourceDirectory,
        request.expectedSourceSha256,
      );
      const accumulator = new RecommendationCandidateGeneratorPolicyAccumulator();
      this.status = { ...this.status, phase: 'AGGREGATING' };
      const selection = await aggregateSourceRows({
        source,
        trainingWindowStart: request.trainingWindowStart,
        trainingWindowEnd: request.trainingWindowEnd,
        accumulator,
        progress: (summary) => {
          this.status = {
            ...this.status,
            sourceRowCount: summary.scannedRowCount,
            selectedRowCount: summary.selectedRowCount,
            excludedBeforeWindowCount: summary.excludedBeforeWindowCount,
            excludedAfterWindowCount: summary.excludedAfterWindowCount,
            invalidSourceRowCount: summary.invalidSourceRowCount,
          };
        },
      });
      const built = accumulator.build();
      accumulator.release();
      this.status = {
        ...this.status,
        heroCount: built.summary.heroCount,
        stateCount: built.summary.stateCount,
        actionOptionCount: built.summary.actionOptionCount,
        phase: 'CATALOG',
      };
      const catalog = await this.loadCatalog(request.catalogVersionId);
      this.status = {
        ...this.status,
        catalogItemCount: catalog.items.length,
        catalogRecipeCount: catalog.recipeCount,
        phase: 'WRITING',
      };

      const artifact =
        createRecommendationCandidateGeneratorSnapshotArtifactFromNormalizedPolicies({
        snapshot: {
          snapshotId: request.snapshotId,
          generatorVersion: request.generatorVersion,
          policyVersion: request.policyVersion,
          catalogVersion: catalog.clientVersion,
          trainingWindowStart: request.trainingWindowStart,
          trainingWindowEnd: request.trainingWindowEnd,
        },
        policies: built.policies,
        catalog: {
          version: catalog.clientVersion,
          items: catalog.items,
        },
      });
      const artifactPath = this.artifactPath(request.snapshotId);
      const artifactWrite = await writeCandidateSnapshotPartial(
        artifactPath,
        artifact,
      );
      const artifactSha256 = artifactWrite.sha256;
      const audit = buildAudit({
        generatedAt: new Date().toISOString(),
        request,
        source,
        selection,
        summary: built.summary,
        catalog,
        artifact,
        artifactFileName: basename(artifactPath),
        artifactByteLength: artifactWrite.byteLength,
        artifactSha256,
      });
      if (!audit.passed) {
        await rm(artifactWrite.partialPath, { force: true });
        throw new Error(
          `Candidate generator snapshot audit failed: ${audit.reasons.join(' ')}`,
        );
      }

      await rename(artifactWrite.partialPath, artifactPath);
      await atomicJson(this.auditPath(request.snapshotId), audit);
      await this.appendRegistryEntry({
        fileName: basename(artifactPath),
        artifactSha256,
        snapshotId: request.snapshotId,
        trainingWindowEnd: request.trainingWindowEnd,
      });

      const completedAt = new Date().toISOString();
      this.status = {
        ...this.status,
        state: 'COMPLETE',
        phase: 'COMPLETE',
        completedAt,
        artifactPath,
      };
      this.logger.log(
        `Exported candidate generator snapshot ${request.snapshotId} with ` +
          `${built.summary.heroCount} heroes and ${selection.selectedRowCount} rows.`,
      );
    } catch (error) {
      const message = errorMessage(error);
      this.status = {
        ...this.status,
        state: 'FAILED',
        completedAt: new Date().toISOString(),
        error: message,
      };
      this.logger.error(`Candidate generator snapshot export failed: ${message}`);
    }
  }

  private async loadCatalog(catalogVersionId: number): Promise<CatalogSnapshot> {
    const version = await this.catalogVersionRepository.findOne({
      where: { id: catalogVersionId },
    });
    if (!version) {
      throw new Error(`No item catalog exists with id ${catalogVersionId}.`);
    }
    const contentCatalogVersionId = getCatalogContentVersionId(version);
    const [items, recipes] = await Promise.all([
      this.catalogItemRepository.find({
        where: { catalogVersionId: contentCatalogVersionId },
        order: { itemId: 'ASC' },
      }),
      this.catalogRecipeRepository.find({
        where: { catalogVersionId: contentCatalogVersionId },
        order: { parentItemId: 'ASC', componentOrder: 'ASC' },
      }),
    ]);
    if (items.length === 0) {
      throw new Error(
        `Catalog ${catalogVersionId} has no immutable item content.`,
      );
    }
    const componentsByParent = new Map<number, number[]>();
    for (const recipe of recipes) {
      const parentItemId = Number(recipe.parentItemId);
      const componentItemId = Number(recipe.componentItemId);
      if (
        !Number.isSafeInteger(parentItemId) ||
        parentItemId <= 0 ||
        !Number.isSafeInteger(componentItemId) ||
        componentItemId <= 0
      ) {
        throw new Error('Catalog recipe contains an invalid item ID.');
      }
      const components = componentsByParent.get(parentItemId) ?? [];
      components.push(componentItemId);
      componentsByParent.set(parentItemId, components);
    }
    return {
      requestedCatalogVersionId: catalogVersionId,
      contentCatalogVersionId,
      clientVersion: String(version.clientVersion),
      items: items.map((item) => catalogItem(item, componentsByParent)),
      recipeCount: recipes.length,
    };
  }

  private async appendRegistryEntry(
    entry: RecommendationCandidateGeneratorSnapshotRegistryEntry,
  ): Promise<void> {
    const registry = await this.getRegistry();
    const duplicate = registry.snapshots.find(
      (value) => value.snapshotId === entry.snapshotId,
    );
    if (duplicate) {
      if (
        duplicate.fileName === entry.fileName &&
        duplicate.artifactSha256 === entry.artifactSha256 &&
        duplicate.trainingWindowEnd === entry.trainingWindowEnd
      ) {
        return;
      }
      throw new Error(
        `Candidate generator snapshot ID ${entry.snapshotId} already exists.`,
      );
    }
    const updated: RecommendationCandidateGeneratorSnapshotRegistry = {
      schemaVersion: 1,
      registryVersion:
        'RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_1',
      generatedAt: new Date().toISOString(),
      snapshots: [...registry.snapshots, { ...entry }].sort(
        (left, right) =>
          Date.parse(left.trainingWindowEnd) -
            Date.parse(right.trainingWindowEnd) ||
          left.snapshotId.localeCompare(right.snapshotId),
      ),
    };
    await atomicJson(this.registryPath, updated);
  }

  private artifactPath(snapshotId: string): string {
    return join(this.outputDirectory, `${snapshotId}.json`);
  }

  private auditPath(snapshotId: string): string {
    return join(this.outputDirectory, `${snapshotId}.audit.json`);
  }

  private idleStatus(): RecommendationCandidateGeneratorSnapshotExportStatus {
    return {
      state: 'IDLE',
      phase: 'PREPARING',
      sourceRowCount: 0,
      selectedRowCount: 0,
      excludedBeforeWindowCount: 0,
      excludedAfterWindowCount: 0,
      invalidSourceRowCount: 0,
      heroCount: 0,
      stateCount: 0,
      actionOptionCount: 0,
      catalogItemCount: 0,
      catalogRecipeCount: 0,
      outputDirectory: this.outputDirectory,
      registryPath: this.registryPath,
    };
  }
}

async function loadSourceArtifact(
  directory: string,
  expectedSha256: string | undefined,
): Promise<SourceArtifact> {
  const [manifest, audit] = await Promise.all([
    requiredJson<Record<string, unknown>>(
      join(directory, 'manifest.json'),
      'Contextual V3 source manifest',
    ),
    requiredJson<Record<string, unknown>>(
      join(directory, 'audit.json'),
      'Contextual V3 source audit',
    ),
  ]);
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
    text(artifact.fileName) ?? 'dataset.ndjson',
  );
  const manifestSha256 = requiredSha(
    artifact.sha256,
    'Contextual V3 artifact SHA-256',
  );
  const actualSha256 = await hashFile(datasetPath);
  if (actualSha256 !== manifestSha256) {
    throw new Error('Contextual V3 source artifact SHA-256 mismatch.');
  }
  if (expectedSha256 && expectedSha256 !== actualSha256) {
    throw new Error(
      `Expected source SHA-256 ${expectedSha256} does not match ${actualSha256}.`,
    );
  }
  return {
    datasetPath,
    sha256: actualSha256,
    byteLength: (await stat(datasetPath)).size,
    rowCount: positiveInteger(artifact.rowCount, 'source rowCount'),
  };
}

async function aggregateSourceRows(input: {
  source: SourceArtifact;
  trainingWindowStart: string;
  trainingWindowEnd: string;
  accumulator: RecommendationCandidateGeneratorPolicyAccumulator;
  progress: (summary: SourceSelectionSummary) => void;
}): Promise<SourceSelectionSummary> {
  const start = Date.parse(input.trainingWindowStart);
  const end = Date.parse(input.trainingWindowEnd);
  const summary: SourceSelectionSummary = {
    scannedRowCount: 0,
    selectedRowCount: 0,
    excludedBeforeWindowCount: 0,
    excludedAfterWindowCount: 0,
    invalidSourceRowCount: 0,
  };
  for await (const value of ndjson(input.source.datasetPath)) {
    summary.scannedRowCount += 1;
    let row: HeroBuildDecisionDatasetV3Row;
    try {
      row = sourceRow(value, summary.scannedRowCount);
    } catch {
      summary.invalidSourceRowCount += 1;
      continue;
    }
    const matchTime = Date.parse(row.matchStartTime);
    if (matchTime < start) {
      summary.excludedBeforeWindowCount += 1;
    } else if (matchTime > end) {
      summary.excludedAfterWindowCount += 1;
    } else {
      input.accumulator.observe(row);
      summary.selectedRowCount += 1;
    }
    if (summary.scannedRowCount % 50_000 === 0) {
      input.progress(summary);
      await tick();
    }
  }
  input.progress(summary);
  return summary;
}

function buildAudit(input: {
  generatedAt: string;
  request: RecommendationCandidateGeneratorSnapshotExportRequest;
  source: SourceArtifact;
  selection: SourceSelectionSummary;
  summary: ReturnType<RecommendationCandidateGeneratorPolicyAccumulator['build']>['summary'];
  catalog: CatalogSnapshot;
  artifact: RecommendationCandidateGeneratorSnapshotArtifact;
  artifactFileName: string;
  artifactByteLength: number;
  artifactSha256: string;
}): RecommendationCandidateGeneratorSnapshotExportAudit {
  const reasons: string[] = [];
  if (input.selection.scannedRowCount !== input.source.rowCount) {
    reasons.push('Scanned source row count does not match the source manifest.');
  }
  if (input.selection.invalidSourceRowCount > 0) {
    reasons.push('Source contains invalid Contextual V3 rows.');
  }
  if (input.selection.selectedRowCount === 0) {
    reasons.push('Training window contains no decisions.');
  }
  if (input.summary.heroCount === 0 || input.summary.stateCount === 0) {
    reasons.push('Training window produced no candidate generator policy states.');
  }
  if (input.catalog.items.length === 0) {
    reasons.push('Catalog snapshot contains no items.');
  }
  return {
    schemaVersion: 1,
    auditVersion:
      'RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_EXPORT_AUDIT_1',
    generatedAt: input.generatedAt,
    passed: reasons.length === 0,
    snapshotId: input.request.snapshotId,
    source: {
      kind: 'POSTGRESQL_CONTEXTUAL_V3_SNAPSHOT',
      datasetVersion: SOURCE_DATASET_VERSION,
      directory: '',
      sha256: input.source.sha256,
      byteLength: input.source.byteLength,
      manifestRowCount: input.source.rowCount,
      scannedRowCount: input.selection.scannedRowCount,
      selectedRowCount: input.selection.selectedRowCount,
      excludedBeforeWindowCount: input.selection.excludedBeforeWindowCount,
      excludedAfterWindowCount: input.selection.excludedAfterWindowCount,
      invalidSourceRowCount: input.selection.invalidSourceRowCount,
    },
    trainingWindow: {
      start: input.request.trainingWindowStart,
      end: input.request.trainingWindowEnd,
    },
    policy: {
      heroCount: input.summary.heroCount,
      playerCount: input.summary.playerCount,
      stateCount: input.summary.stateCount,
      transitionCount: input.summary.transitionCount,
      actionOptionCount: input.summary.actionOptionCount,
      policySha256: input.artifact.snapshot.policySha256,
    },
    catalog: {
      requestedCatalogVersionId: input.catalog.requestedCatalogVersionId,
      contentCatalogVersionId: input.catalog.contentCatalogVersionId,
      clientVersion: input.catalog.clientVersion,
      itemCount: input.catalog.items.length,
      recipeCount: input.catalog.recipeCount,
      catalogSha256: input.artifact.snapshot.catalogSha256,
    },
    artifact: {
      fileName: input.artifactFileName,
      byteLength: input.artifactByteLength,
      sha256: input.artifactSha256,
      artifactVersion: input.artifact.artifactVersion,
    },
    provenance: {
      dataSource: 'PRO_HISTORICAL',
      userLiveUsedAsInput: false,
      v5_3UsedAsInput: false,
    },
    reasons,
  };
}

function catalogItem(
  item: ItemCatalogItem,
  componentsByParent: ReadonlyMap<number, number[]>,
): RecommendationHistoricalCatalogItem {
  const itemId = Number(item.itemId);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw new Error('Catalog item contains an invalid item ID.');
  }
  return {
    itemId,
    name: item.name,
    cost: nonNegativeInteger(item.cost),
    tier: nonNegativeInteger(item.tier),
    slotType: item.slotType || 'unknown',
    itemType: item.itemType || undefined,
    isActiveItem: item.isActiveItem,
    activationType: item.activationType || undefined,
    tags: extractTags(item.rawPayload),
    componentItemIds: [...(componentsByParent.get(itemId) ?? [])],
  };
}

function extractTags(value: Record<string, unknown>): string[] {
  const candidates = [value.tags, value.item_tags, value.itemTags];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return [
        ...new Set(
          candidate
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      ].sort();
    }
  }
  return [];
}

function normalizeRequest(
  request: RecommendationCandidateGeneratorSnapshotExportRequest,
): RecommendationCandidateGeneratorSnapshotExportRequest {
  const snapshotId = safeIdentifier(request.snapshotId, 'snapshotId');
  const generatorVersion = requiredText(
    request.generatorVersion,
    'generatorVersion',
  );
  const policyVersion = requiredText(request.policyVersion, 'policyVersion');
  const catalogVersionId = positiveInteger(
    request.catalogVersionId,
    'catalogVersionId',
  );
  const trainingWindowStart = requiredTimestamp(
    request.trainingWindowStart,
    'trainingWindowStart',
  );
  const trainingWindowEnd = requiredTimestamp(
    request.trainingWindowEnd,
    'trainingWindowEnd',
  );
  if (Date.parse(trainingWindowEnd) <= Date.parse(trainingWindowStart)) {
    throw new Error('trainingWindowEnd must follow trainingWindowStart.');
  }
  return {
    snapshotId,
    generatorVersion,
    policyVersion,
    catalogVersionId,
    trainingWindowStart,
    trainingWindowEnd,
    expectedSourceSha256: optionalSha(
      request.expectedSourceSha256,
      'expectedSourceSha256',
    ),
  };
}

function sourceRow(
  value: unknown,
  line: number,
): HeroBuildDecisionDatasetV3Row {
  if (
    !isRecord(value) ||
    value.schemaVersion !== HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION ||
    typeof value.decisionId !== 'string' ||
    !Number.isSafeInteger(Number(value.matchId)) ||
    typeof value.matchStartTime !== 'string' ||
    !Number.isFinite(Date.parse(value.matchStartTime)) ||
    !Number.isSafeInteger(Number(value.playerId)) ||
    !Number.isSafeInteger(Number(value.heroId)) ||
    !Number.isFinite(Number(value.gameTimeS)) ||
    typeof value.inventoryBeforeStateKey !== 'string' ||
    typeof value.inventoryAfterStateKey !== 'string' ||
    typeof value.actualActionKey !== 'string' ||
    !Number.isSafeInteger(Number(value.actualItemId))
  ) {
    throw new Error(`Invalid Contextual V3 row at line ${line}.`);
  }
  return value as unknown as HeroBuildDecisionDatasetV3Row;
}

function emptyRegistry(): RecommendationCandidateGeneratorSnapshotRegistry {
  return {
    schemaVersion: 1,
    registryVersion:
      'RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_1',
    generatedAt: new Date(0).toISOString(),
    snapshots: [],
  };
}

async function* ndjson(path: string): AsyncGenerator<unknown> {
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

const SNAPSHOT_STREAM_BUFFER_LIMIT_BYTES = 1024 * 1024;

async function writeCandidateSnapshotPartial(
  path: string,
  artifact: RecommendationCandidateGeneratorSnapshotArtifact,
): Promise<{ partialPath: string; byteLength: number; sha256: string }> {
  const partialPath = `${path}.partial`;
  await rm(partialPath, { force: true });
  const handle = await open(partialPath, 'w');
  const writer = new BufferedHashedSnapshotWriter(handle);
  try {
    await writer.append(
      `{"schemaVersion":${artifact.schemaVersion},` +
        `"artifactVersion":${JSON.stringify(artifact.artifactVersion)},` +
        `"snapshot":${JSON.stringify(artifact.snapshot)},` +
        `"generatorOptions":${JSON.stringify(artifact.generatorOptions)},` +
        '"policies":[',
    );
    for (
      let policyIndex = 0;
      policyIndex < artifact.policies.length;
      policyIndex += 1
    ) {
      const policy = artifact.policies[policyIndex];
      if (policyIndex > 0) {
        await writer.append(',');
      }
      await writer.append(
        `{"heroId":${policy.heroId},` +
          `"playerCount":${policy.playerCount},` +
          `"stateCount":${policy.stateCount},` +
          `"transitionCount":${policy.transitionCount},` +
          '"states":[',
      );
      for (
        let stateIndex = 0;
        stateIndex < policy.states.length;
        stateIndex += 1
      ) {
        if (stateIndex > 0) {
          await writer.append(',');
        }
        await writer.append(JSON.stringify(policy.states[stateIndex]));
      }
      await writer.append(']}');
    }
    await writer.append(`],"catalog":${JSON.stringify(artifact.catalog)}}\n`);
    const descriptor = await writer.close();
    return { partialPath, ...descriptor };
  } catch (error) {
    await writer.abort();
    await rm(partialPath, { force: true });
    throw error;
  }
}

class BufferedHashedSnapshotWriter {
  private buffer = '';
  private readonly hash = createHash('sha256');
  private byteLength = 0;
  private closed = false;

  constructor(private readonly handle: FileHandle) {}

  async append(value: string): Promise<void> {
    if (this.closed) {
      throw new Error('Candidate snapshot writer is already closed.');
    }
    this.buffer += value;
    if (Buffer.byteLength(this.buffer) >= SNAPSHOT_STREAM_BUFFER_LIMIT_BYTES) {
      await this.flush();
    }
  }

  async close(): Promise<{ byteLength: number; sha256: string }> {
    if (this.closed) {
      throw new Error('Candidate snapshot writer is already closed.');
    }
    await this.flush();
    await this.handle.sync();
    await this.handle.close();
    this.closed = true;
    return {
      byteLength: this.byteLength,
      sha256: this.hash.digest('hex'),
    };
  }

  async abort(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.handle.close().catch(() => undefined);
  }

  private async flush(): Promise<void> {
    if (!this.buffer) {
      return;
    }
    const value = Buffer.from(this.buffer, 'utf8');
    this.buffer = '';
    let offset = 0;
    while (offset < value.length) {
      const { bytesWritten } = await this.handle.write(
        value,
        offset,
        value.length - offset,
        null,
      );
      if (bytesWritten <= 0) {
        throw new Error('Candidate snapshot writer made no progress.');
      }
      offset += bytesWritten;
    }
    this.hash.update(value);
    this.byteLength += value.length;
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const partial = `${path}.partial`;
  await writeFile(partial, content, 'utf8');
  await rename(partial, path);
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await atomicWrite(path, `${JSON.stringify(value, undefined, 2)}\n`);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function requiredJson<T>(path: string, name: string): Promise<T> {
  const value = await readJson<T>(path);
  if (!value) {
    throw new Error(`${name} is unavailable at ${path}.`);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredText(value: unknown, name: string): string {
  const result = text(value);
  if (!result) {
    throw new Error(`${name} is required.`);
  }
  return result;
}

function safeIdentifier(value: unknown, name: string): string {
  const result = requiredText(value, name);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(result)) {
    throw new Error(`${name} contains unsupported characters.`);
  }
  return result;
}

function requiredTimestamp(value: unknown, name: string): string {
  const result = requiredText(value, name);
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error(`${name} must be an ISO timestamp.`);
  }
  return new Date(result).toISOString();
}

function requiredSha(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${name} is unavailable.`);
  }
  return value.toLowerCase();
}

function optionalSha(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const result = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new Error(`${name} must be a SHA-256 digest.`);
  }
  return result;
}

function positiveInteger(value: unknown, name: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return result;
}

function nonNegativeInteger(value: unknown): number {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
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
