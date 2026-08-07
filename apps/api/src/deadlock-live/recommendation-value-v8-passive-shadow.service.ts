import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { MinimalMatchState, MinimalPlayerState } from '@deadlock-live-probe/shared';
import { createHash, randomUUID } from 'node:crypto';
import { open, appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { In, Repository } from 'typeorm';
import { ItemCatalogItem } from './entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './entities/item-catalog-recipe.entity';
import {
  getCatalogContentVersionId,
  ItemCatalogVersion,
} from './entities/item-catalog-version.entity';
import { getHeroBuildEvaluationPhase } from './hero-build-offline-evaluation.service';
import { createInventoryStateKeyFromItemIds } from './hero-build-transition-aggregation.service';
import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationDatasetV6StateFeatures,
} from './recommendation-pro-decision-dataset-v6';
import {
  buildRecommendationValueV8PassiveShadowGate,
  createRecommendationValueV8PassiveShadowAccumulator,
  finalizeRecommendationValueV8PassiveShadowMetrics,
  observeRecommendationValueV8PassiveShadow,
  predictRecommendationValueV8Runtime,
  validateRecommendationValueV8PassiveShadowAuthorization,
  RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_SCHEMA_VERSION,
  RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_VERSION,
  type RecommendationValueV8PassiveShadowAccumulator,
  type RecommendationValueV8PassiveShadowAuthorizationAudit,
  type RecommendationValueV8PassiveShadowAuthorizationManifest,
  type RecommendationValueV8PassiveShadowGate,
  type RecommendationValueV8PassiveShadowMetrics,
  type RecommendationValueV8PassiveShadowThresholds,
  type RecommendationValueV8RuntimeModelArtifact,
} from './recommendation-value-v8-passive-shadow';
import {
  RecommendationDecisionTelemetryService,
  type RecommendationDecisionServedEvent,
  type RecommendationTelemetryCandidateAction,
} from './recommendation-decision-telemetry.service';

const DEFAULT_ARTIFACT_DIRECTORY =
  '/app/apps/api/storage/recommendation-value-v8-full-evaluation-1';
const DEFAULT_OUTPUT_DIRECTORY =
  '/app/apps/api/storage/recommendation-value-v8-passive-shadow-1';
const EVENT_FILE_NAME = 'events.ndjson';
const EVENT_TAIL_BYTES = 4 * 1024 * 1024;
const DECISION_EVENT_RETRY_COUNT = 10;
const DECISION_EVENT_RETRY_DELAY_MS = 10;
const MAX_REPLAYED_LATENCY_SAMPLES = 200_000;

export interface RecommendationValueV8PassiveShadowScheduleInput {
  decisionId: string;
  state: MinimalMatchState;
  localPlayer: MinimalPlayerState;
  previousActionKeys: string[];
  displayedActionKeys: string[];
}

export interface RecommendationValueV8PassiveShadowCandidateLogScore {
  actionKey: string;
  score: number;
  rank: number;
  supported: boolean;
}

export interface RecommendationValueV8PassiveShadowEvent {
  schemaVersion: typeof RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_SCHEMA_VERSION;
  shadowVersion: typeof RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_VERSION;
  eventId: string;
  occurredAt: string;
  decisionId: string;
  matchId: string;
  steamId: string;
  gameTimeSeconds: number;
  rolloutMode: 'SHADOW';
  candidateGeneratorVersion: string;
  catalogVersion: string;
  catalogArtifactSha256?: string;
  stateFeatureVersion: string;
  baselineModelVersion: string;
  baselineModelSha256?: string;
  challengerModelVersion: string;
  challengerModelSha256: string;
  policyVersion: string;
  candidateActionKeys: string[];
  baselineScores: RecommendationValueV8PassiveShadowCandidateLogScore[];
  challengerScores: RecommendationValueV8PassiveShadowCandidateLogScore[];
  displayedActionKeys: string[];
  latencyMs: number;
  heapUsedBytes: number;
  candidateCoverage: number;
  missingFeature: boolean;
  candidateSeparation: number;
  changedTop1: boolean;
  fallbackReason?: string;
  criticalError: boolean;
  randomizedCanaryAuthorized: false;
}

export interface RecommendationValueV8PassiveShadowStatus {
  state: 'DISABLED' | 'KILLED' | 'BLOCKED' | 'READY' | 'DEGRADED';
  enabledRequested: boolean;
  killSwitchActive: boolean;
  releaseAuthorized: boolean;
  randomizedCanaryAuthorized: false;
  artifactDirectory: string;
  outputDirectory: string;
  eventLogPath: string;
  modelSha256?: string;
  modelGeneratedAt?: string;
  inFlight: number;
  maximumInFlight: number;
  scheduledCount: number;
  sampledOutCount: number;
  capacityFallbackCount: number;
  writeErrorCount: number;
  lastErrorAt?: string;
  lastError?: string;
  metrics: RecommendationValueV8PassiveShadowMetrics;
  gate: RecommendationValueV8PassiveShadowGate;
}

interface CatalogSnapshot {
  version: string;
  artifactSha256?: string;
  itemsById: Map<number, ItemCatalogItem>;
  componentsByParentId: Map<number, number[]>;
}

@Injectable()
export class RecommendationValueV8PassiveShadowService implements OnModuleInit {
  private readonly logger = new Logger(
    RecommendationValueV8PassiveShadowService.name,
  );
  private readonly artifactDirectory =
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_ARTIFACT_DIR?.trim() ||
    DEFAULT_ARTIFACT_DIRECTORY;
  private readonly outputDirectory =
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_DIR?.trim() ||
    DEFAULT_OUTPUT_DIRECTORY;
  private readonly eventLogPath = join(this.outputDirectory, EVENT_FILE_NAME);
  private readonly enabledRequested = readBooleanEnvironmentValue(
    'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_ENABLED',
    false,
  );
  private killSwitchActive = readBooleanEnvironmentValue(
    'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_KILL_SWITCH',
    false,
  );
  private readonly sampleRate = readBoundedNumberEnvironmentValue(
    'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_SAMPLE_RATE',
    1,
    0,
    1,
  );
  private readonly maximumInFlight = readBoundedIntegerEnvironmentValue(
    'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_MAX_IN_FLIGHT',
    2,
    1,
    32,
  );
  private readonly thresholds = readThresholds();
  private readonly expectedModelSha256 = optionalSha(
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_EXPECTED_MODEL_SHA256,
  );
  private accumulator: RecommendationValueV8PassiveShadowAccumulator =
    createRecommendationValueV8PassiveShadowAccumulator();
  private model?: RecommendationValueV8RuntimeModelArtifact;
  private modelSha256?: string;
  private modelGeneratedAt?: string;
  private releaseAuthorized = false;
  private state: RecommendationValueV8PassiveShadowStatus['state'] = 'DISABLED';
  private inFlight = 0;
  private scheduledCount = 0;
  private sampledOutCount = 0;
  private capacityFallbackCount = 0;
  private writeErrorCount = 0;
  private lastErrorAt?: string;
  private lastError?: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly telemetryService: RecommendationDecisionTelemetryService,
    @InjectRepository(ItemCatalogVersion)
    private readonly catalogVersionRepository: Repository<ItemCatalogVersion>,
    @InjectRepository(ItemCatalogItem)
    private readonly catalogItemRepository: Repository<ItemCatalogItem>,
    @InjectRepository(ItemCatalogRecipe)
    private readonly catalogRecipeRepository: Repository<ItemCatalogRecipe>,
  ) {}

  async onModuleInit(): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
    await appendFile(this.eventLogPath, '', 'utf8');
    await this.replayPersistedEvents();
    if (!this.enabledRequested) {
      this.state = 'DISABLED';
      return;
    }
    if (this.killSwitchActive) {
      this.state = 'KILLED';
      return;
    }
    try {
      await this.loadAuthorizedModel();
      this.state = 'READY';
      this.logger.log(
        `Recommendation Value V8 passive shadow ready with model ${this.modelSha256}.`,
      );
    } catch (error) {
      this.recordServiceError(error);
      this.state = 'BLOCKED';
      this.logger.error(
        `Recommendation Value V8 passive shadow blocked: ${errorMessage(error)}`,
      );
    }
  }

  getStatus(): RecommendationValueV8PassiveShadowStatus {
    const metrics = finalizeRecommendationValueV8PassiveShadowMetrics(
      this.accumulator,
    );
    return {
      state: this.state,
      enabledRequested: this.enabledRequested,
      killSwitchActive: this.killSwitchActive,
      releaseAuthorized: this.releaseAuthorized,
      randomizedCanaryAuthorized: false,
      artifactDirectory: this.artifactDirectory,
      outputDirectory: this.outputDirectory,
      eventLogPath: this.eventLogPath,
      modelSha256: this.modelSha256,
      modelGeneratedAt: this.modelGeneratedAt,
      inFlight: this.inFlight,
      maximumInFlight: this.maximumInFlight,
      scheduledCount: this.scheduledCount,
      sampledOutCount: this.sampledOutCount,
      capacityFallbackCount: this.capacityFallbackCount,
      writeErrorCount: this.writeErrorCount,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      metrics,
      gate: buildRecommendationValueV8PassiveShadowGate(
        metrics,
        this.thresholds,
      ),
    };
  }

  activateKillSwitch(
    reason = 'MANUAL_KILL_SWITCH',
  ): RecommendationValueV8PassiveShadowStatus {
    this.killSwitchActive = true;
    this.state = 'KILLED';
    this.lastErrorAt = new Date().toISOString();
    this.lastError = reason;
    this.logger.warn(`Value V8 passive shadow killed: ${reason}.`);
    return this.getStatus();
  }

  schedule(input: RecommendationValueV8PassiveShadowScheduleInput): void {
    if (
      this.state !== 'READY' ||
      !this.releaseAuthorized ||
      this.killSwitchActive ||
      !this.model ||
      !this.modelSha256
    ) {
      return;
    }
    if (!deterministicallySample(input.decisionId, this.sampleRate)) {
      this.sampledOutCount += 1;
      return;
    }
    if (this.inFlight >= this.maximumInFlight) {
      this.capacityFallbackCount += 1;
      void this.recordFallback(input, 'SHADOW_CAPACITY_LIMIT', false);
      return;
    }
    this.inFlight += 1;
    this.scheduledCount += 1;
    void this.evaluate(cloneScheduleInput(input)).finally(() => {
      this.inFlight -= 1;
    });
  }

  async waitForIdle(): Promise<void> {
    while (this.inFlight > 0) {
      await delay(5);
    }
    await this.writeQueue;
  }

  private async loadAuthorizedModel(): Promise<void> {
    const manifestPath = join(this.artifactDirectory, 'manifest.json');
    const auditPath = join(this.artifactDirectory, 'audit.json');
    const modelPath = join(this.artifactDirectory, 'model.json');
    const [manifest, audit, model] = await Promise.all([
      requiredJson<RecommendationValueV8PassiveShadowAuthorizationManifest>(
        manifestPath,
      ),
      requiredJson<RecommendationValueV8PassiveShadowAuthorizationAudit>(
        auditPath,
      ),
      requiredJson<RecommendationValueV8RuntimeModelArtifact>(modelPath),
    ]);
    const modelSha256 = await hashFile(modelPath);
    if (
      this.expectedModelSha256 &&
      this.expectedModelSha256 !== modelSha256
    ) {
      throw new Error('Value V8 passive shadow expected model SHA-256 mismatch.');
    }
    validateRecommendationValueV8PassiveShadowAuthorization({
      manifest,
      audit,
      model,
      modelSha256,
    });
    this.model = model;
    this.modelSha256 = modelSha256;
    this.modelGeneratedAt = model.generatedAt;
    this.releaseAuthorized = true;
  }

  private async evaluate(
    input: RecommendationValueV8PassiveShadowScheduleInput,
  ): Promise<void> {
    const startedAt = process.hrtime.bigint();
    try {
      const decision = await this.findServedDecision(input.decisionId);
      const catalog = await this.loadCatalogSnapshot(
        decision.candidateActions,
        input.localPlayer,
      );
      const row = buildRuntimeRow(input, decision, catalog);
      if (row.candidates.length < 2) {
        throw new Error(
          'Shadow candidate set has fewer than two supported item actions.',
        );
      }
      const prediction = predictRecommendationValueV8Runtime({
        row,
        model: requiredModel(this.model),
      });
      const baselineScores = decision.candidateActions.map((candidate, index) => ({
        actionKey: candidate.actionKey,
        score: candidate.score,
        rank: index + 1,
        supported: candidate.itemId !== undefined,
      }));
      const challengerScores = prediction.candidateScores.map((candidate) => ({
        actionKey: candidate.actionKey,
        score: candidate.score,
        rank: candidate.rank,
        supported: candidate.supported,
      }));
      const expectedCandidateCount = baselineScores.filter(
        (candidate) => candidate.supported,
      ).length;
      const missingFeature = row.candidates.some(
        (candidate) => !candidate.catalogMetadataAvailable,
      );
      const event = this.createEvent({
        input,
        decision,
        catalog,
        baselineScores,
        challengerScores,
        latencyMs: elapsedMilliseconds(startedAt),
        expectedCandidateCount,
        candidateSeparation: prediction.candidateSeparation,
        missingFeature,
        fallbackReason: undefined,
        criticalError: false,
      });
      await this.persistEvent(event);
    } catch (error) {
      await this.recordFallback(input, errorMessage(error), true, startedAt);
    }
  }

  private createEvent(input: {
    input: RecommendationValueV8PassiveShadowScheduleInput;
    decision?: RecommendationDecisionServedEvent;
    catalog?: CatalogSnapshot;
    baselineScores: RecommendationValueV8PassiveShadowCandidateLogScore[];
    challengerScores: RecommendationValueV8PassiveShadowCandidateLogScore[];
    latencyMs: number;
    expectedCandidateCount: number;
    candidateSeparation: number;
    missingFeature: boolean;
    fallbackReason?: string;
    criticalError: boolean;
  }): RecommendationValueV8PassiveShadowEvent {
    const baselineTopActionKey = input.baselineScores[0]?.actionKey;
    const challengerTopActionKey = input.challengerScores[0]?.actionKey;
    return {
      schemaVersion: RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_SCHEMA_VERSION,
      shadowVersion: RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_VERSION,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      decisionId: input.input.decisionId,
      matchId: input.input.state.matchId,
      steamId: input.input.localPlayer.steamId,
      gameTimeSeconds: normalizeGameTime(input.input.state.gameTimeSec),
      rolloutMode: 'SHADOW',
      candidateGeneratorVersion:
        input.decision?.candidateSetPolicy ?? 'UNKNOWN',
      catalogVersion: input.catalog?.version ?? 'UNKNOWN',
      catalogArtifactSha256: input.catalog?.artifactSha256,
      stateFeatureVersion: 'RECOMMENDATION_VALUE_V8_FEATURES_1',
      baselineModelVersion:
        input.decision?.modelVersion ??
        input.decision?.recommendationModel ??
        'UNKNOWN',
      baselineModelSha256: input.decision?.modelSha256,
      challengerModelVersion: 'RECOMMENDATION_VALUE_V8_FULL_EVALUATION_1',
      challengerModelSha256: requiredSha(this.modelSha256),
      policyVersion: input.decision?.candidateSetPolicy ?? 'UNKNOWN',
      candidateActionKeys: input.baselineScores.map(
        (candidate) => candidate.actionKey,
      ),
      baselineScores: input.baselineScores,
      challengerScores: input.challengerScores,
      displayedActionKeys: [...input.input.displayedActionKeys],
      latencyMs: input.latencyMs,
      heapUsedBytes: process.memoryUsage().heapUsed,
      candidateCoverage: ratio(
        input.challengerScores.length,
        input.expectedCandidateCount,
      ),
      missingFeature: input.missingFeature,
      candidateSeparation: input.candidateSeparation,
      changedTop1:
        baselineTopActionKey !== undefined &&
        challengerTopActionKey !== undefined &&
        baselineTopActionKey !== challengerTopActionKey,
      fallbackReason: input.fallbackReason,
      criticalError: input.criticalError,
      randomizedCanaryAuthorized: false,
    };
  }

  private async recordFallback(
    input: RecommendationValueV8PassiveShadowScheduleInput,
    reason: string,
    criticalError: boolean,
    startedAt = process.hrtime.bigint(),
  ): Promise<void> {
    this.recordServiceError(reason);
    const event = this.createEvent({
      input,
      baselineScores: [],
      challengerScores: [],
      latencyMs: elapsedMilliseconds(startedAt),
      expectedCandidateCount: 0,
      candidateSeparation: 0,
      missingFeature: true,
      fallbackReason: reason,
      criticalError,
    });
    await this.persistEvent(event);
  }

  private async persistEvent(
    event: RecommendationValueV8PassiveShadowEvent,
  ): Promise<void> {
    const line = `${JSON.stringify(event)}\n`;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await appendFile(this.eventLogPath, line, 'utf8');
        this.observePersistedEvent(event);
      })
      .catch((error: unknown) => {
        this.writeErrorCount += 1;
        this.recordServiceError(error);
        this.state = 'DEGRADED';
      });
    await this.writeQueue;
  }

  private observePersistedEvent(
    event: RecommendationValueV8PassiveShadowEvent,
  ): void {
    observeRecommendationValueV8PassiveShadow(this.accumulator, {
      decisionId: event.decisionId,
      matchId: event.matchId,
      expectedCandidateCount: event.candidateActionKeys.length,
      scoredCandidateCount: event.challengerScores.length,
      missingFeature: event.missingFeature,
      fallback: event.fallbackReason !== undefined,
      criticalError: event.criticalError,
      latencyMs: event.latencyMs,
      heapUsedBytes: event.heapUsedBytes,
      candidateSeparation: event.candidateSeparation,
      changedTop1: event.changedTop1,
      catalogVersion: event.catalogVersion,
      modelSha256: event.challengerModelSha256,
    });
  }

  private async replayPersistedEvents(): Promise<void> {
    const raw = await readFile(this.eventLogPath, 'utf8');
    if (!raw.trim()) return;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as RecommendationValueV8PassiveShadowEvent;
        if (
          event.schemaVersion !==
            RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_SCHEMA_VERSION ||
          event.shadowVersion !== RECOMMENDATION_VALUE_V8_PASSIVE_SHADOW_VERSION
        ) {
          continue;
        }
        this.observePersistedEvent(event);
        if (
          this.accumulator.latencySamplesMs.length >
          MAX_REPLAYED_LATENCY_SAMPLES
        ) {
          this.accumulator.latencySamplesMs.length =
            MAX_REPLAYED_LATENCY_SAMPLES;
        }
      } catch {
        this.writeErrorCount += 1;
      }
    }
  }

  private async findServedDecision(
    decisionId: string,
  ): Promise<RecommendationDecisionServedEvent> {
    const eventLogPath = this.telemetryService.getStatus().eventLogPath;
    for (let attempt = 0; attempt < DECISION_EVENT_RETRY_COUNT; attempt += 1) {
      const value = await findDecisionInTail(eventLogPath, decisionId);
      if (value) return value;
      await delay(DECISION_EVENT_RETRY_DELAY_MS);
    }
    throw new Error(`Decision telemetry ${decisionId} was not persisted in time.`);
  }

  private async loadCatalogSnapshot(
    candidates: readonly RecommendationTelemetryCandidateAction[],
    localPlayer: MinimalPlayerState,
  ): Promise<CatalogSnapshot> {
    const catalog =
      (await this.catalogVersionRepository.findOne({
        where: { isCurrent: true },
        order: { clientVersion: 'DESC' },
      })) ??
      (await this.catalogVersionRepository.findOne({
        order: { importedAt: 'DESC' },
      }));
    if (!catalog) {
      throw new Error('No live item catalog is available for passive shadow.');
    }
    const catalogVersionId = getCatalogContentVersionId(catalog);
    const candidateItemIds = candidates
      .map((candidate) => candidate.itemId)
      .filter(
        (itemId): itemId is number =>
          Number.isSafeInteger(itemId) && Number(itemId) > 0,
      );
    const inventoryItemIds = localPlayer.items
      .map((item) => Number(item.id))
      .filter((itemId) => Number.isSafeInteger(itemId) && itemId > 0);
    const itemIds = [...new Set([...candidateItemIds, ...inventoryItemIds])];
    const [items, recipes] = await Promise.all([
      itemIds.length === 0
        ? Promise.resolve([])
        : this.catalogItemRepository.find({
            where: {
              catalogVersionId,
              itemId: In(itemIds),
            },
          }),
      candidateItemIds.length === 0
        ? Promise.resolve([])
        : this.catalogRecipeRepository.find({
            where: {
              catalogVersionId,
              parentItemId: In(candidateItemIds),
            },
            order: { parentItemId: 'ASC', componentOrder: 'ASC' },
          }),
    ]);
    const componentsByParentId = new Map<number, number[]>();
    for (const recipe of recipes) {
      const parentItemId = Number(recipe.parentItemId);
      const values = componentsByParentId.get(parentItemId) ?? [];
      values.push(Number(recipe.componentItemId));
      componentsByParentId.set(parentItemId, values);
    }
    return {
      version: String(catalog.clientVersion),
      artifactSha256: normalizeCatalogHash(catalog.payloadHash),
      itemsById: new Map(items.map((item) => [Number(item.itemId), item])),
      componentsByParentId,
    };
  }

  private recordServiceError(error: unknown): void {
    this.lastErrorAt = new Date().toISOString();
    this.lastError = errorMessage(error);
  }
}

function buildRuntimeRow(
  input: RecommendationValueV8PassiveShadowScheduleInput,
  decision: RecommendationDecisionServedEvent,
  catalog: CatalogSnapshot,
): {
  state: RecommendationDatasetV6StateFeatures;
  candidates: RecommendationDatasetV6CandidateFeatures[];
} {
  const itemIds = input.localPlayer.items
    .map((item) => Number(item.id))
    .filter((itemId) => Number.isSafeInteger(itemId) && itemId > 0);
  const inventoryCounts = countValues(itemIds);
  const inventoryTagCounts = buildInventoryTagCounts(
    inventoryCounts,
    catalog.itemsById,
  );
  const state: RecommendationDatasetV6StateFeatures = {
    heroId: Number(input.localPlayer.heroId),
    team: input.localPlayer.teamId ?? 0,
    phase: getHeroBuildEvaluationPhase(
      normalizeGameTime(input.state.gameTimeSec),
    ),
    gameTimeS: normalizeGameTime(input.state.gameTimeSec),
    inventoryStateKey: createInventoryStateKeyFromItemIds(itemIds),
    inventoryItemCounts: [...inventoryCounts.entries()]
      .map(([itemId, count]) => ({ itemId, count }))
      .sort((left, right) => left.itemId - right.itemId),
    previousActionKeys: [...input.previousActionKeys],
    alliedHeroIds: heroIdsForTeam(
      input.state,
      input.localPlayer.teamId,
      true,
    ),
    enemyHeroIds: heroIdsForTeam(
      input.state,
      input.localPlayer.teamId,
      false,
    ),
    inventoryTagCounts,
    timelineJoined: true,
    kills: input.localPlayer.kills,
    deaths: input.localPlayer.deaths,
    assists: input.localPlayer.assists,
    netWorth: input.localPlayer.souls,
    heroDamage: input.localPlayer.heroDamage,
    health: input.localPlayer.health,
    maxHealth: input.localPlayer.maxHealth,
    level: input.localPlayer.level,
  };
  const uniqueCandidates = new Map<
    string,
    RecommendationTelemetryCandidateAction
  >();
  for (const candidate of decision.candidateActions) {
    if (
      !uniqueCandidates.has(candidate.actionKey) &&
      Number.isSafeInteger(candidate.itemId) &&
      Number(candidate.itemId) > 0
    ) {
      uniqueCandidates.set(candidate.actionKey, candidate);
    }
  }
  const candidates = [...uniqueCandidates.values()].map((candidate, index) =>
    buildCandidate({
      candidate,
      rank: index + 1,
      state,
      inventoryCounts,
      catalog,
    }),
  );
  return { state, candidates };
}

function buildCandidate(input: {
  candidate: RecommendationTelemetryCandidateAction;
  rank: number;
  state: RecommendationDatasetV6StateFeatures;
  inventoryCounts: ReadonlyMap<number, number>;
  catalog: CatalogSnapshot;
}): RecommendationDatasetV6CandidateFeatures {
  const itemId = Number(input.candidate.itemId);
  const metadata = input.catalog.itemsById.get(itemId);
  const componentItemIds = [
    ...(input.catalog.componentsByParentId.get(itemId) ?? []),
  ];
  const ownedComponentCount = countOwnedComponents(
    componentItemIds,
    input.inventoryCounts,
  );
  const tags = metadata ? extractItemTags(metadata.rawPayload) : [];
  const requiredComponentCount = componentItemIds.length;
  const currentNetWorth = input.state.netWorth;
  const cost = metadata?.cost;
  return {
    actionKey: input.candidate.actionKey,
    actionType: normalizeActionType(input.candidate),
    itemId,
    rank: input.rank,
    generatorScore: input.candidate.score,
    historicalCount: input.candidate.historicalCount,
    historicalProbability: input.candidate.historicalProbability,
    confidence: input.candidate.confidence,
    predictedStateKey: input.candidate.predictedStateKey,
    catalogMetadataAvailable: metadata !== undefined,
    cost,
    tier: metadata?.tier,
    slotType: metadata?.slotType,
    itemType: metadata?.itemType,
    isActiveItem: metadata?.isActiveItem,
    activationType: metadata?.activationType,
    tags,
    componentItemIds,
    requiredComponentCount,
    ownedComponentCount,
    missingComponentCount: Math.max(
      0,
      requiredComponentCount - ownedComponentCount,
    ),
    hasAnyOwnedComponent: ownedComponentCount > 0,
    hasCompleteRecipeComponents:
      requiredComponentCount > 0 &&
      ownedComponentCount >= requiredComponentCount,
    alreadyOwnedCount: input.inventoryCounts.get(itemId) ?? 0,
    sameSlotOwnedItemCount: metadata
      ? countSameSlotItems(
          metadata.slotType,
          input.inventoryCounts,
          input.catalog.itemsById,
        )
      : 0,
    inventoryTagOverlapCount: tags.reduce(
      (sum, tag) => sum + (input.state.inventoryTagCounts[tag] ?? 0),
      0,
    ),
    previousActionCount: input.state.previousActionKeys.filter(
      (actionKey) => actionKey === input.candidate.actionKey,
    ).length,
    currentNetWorth,
    costToNetWorthRatio:
      cost !== undefined &&
      currentNetWorth !== undefined &&
      currentNetWorth > 0
        ? cost / currentNetWorth
        : undefined,
  };
}

async function findDecisionInTail(
  path: string,
  decisionId: string,
): Promise<RecommendationDecisionServedEvent | undefined> {
  const value = await stat(path).catch(() => undefined);
  if (!value || value.size <= 0) return undefined;
  const start = Math.max(0, value.size - EVENT_TAIL_BYTES);
  const length = value.size - start;
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const lines = buffer.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.includes(decisionId) || !line.trim()) continue;
      try {
        const event = JSON.parse(line) as RecommendationDecisionServedEvent;
        if (
          event.eventType === 'DECISION_SERVED' &&
          event.decisionId === decisionId
        ) {
          return event;
        }
      } catch {
        continue;
      }
    }
    return undefined;
  } finally {
    await handle.close();
  }
}

function heroIdsForTeam(
  state: MinimalMatchState,
  teamId: number | undefined,
  allied: boolean,
): number[] {
  return Object.values(state.playersBySteamId)
    .filter((player) =>
      allied ? player.teamId === teamId : player.teamId !== teamId,
    )
    .map((player) => Number(player.heroId))
    .filter((heroId) => Number.isSafeInteger(heroId) && heroId > 0)
    .sort((left, right) => left - right);
}

function buildInventoryTagCounts(
  inventoryCounts: ReadonlyMap<number, number>,
  itemsById: ReadonlyMap<number, ItemCatalogItem>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [itemId, count] of inventoryCounts) {
    const item = itemsById.get(itemId);
    if (!item) continue;
    for (const tag of extractItemTags(item.rawPayload)) {
      result[tag] = (result[tag] ?? 0) + count;
    }
  }
  return result;
}

function extractItemTags(payload: Record<string, unknown>): string[] {
  const values = [payload.tags, payload.item_tags, payload.itemTags];
  const result = new Set<string>();
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const tag of value) {
        if (typeof tag === 'string' && tag.trim()) {
          result.add(tag.trim().toUpperCase());
        }
      }
    } else if (value && typeof value === 'object') {
      for (const [key, enabled] of Object.entries(value)) {
        if (enabled && key.trim()) result.add(key.trim().toUpperCase());
      }
    }
  }
  return [...result].sort();
}

function countOwnedComponents(
  componentItemIds: readonly number[],
  inventoryCounts: ReadonlyMap<number, number>,
): number {
  const remaining = new Map(inventoryCounts);
  let result = 0;
  for (const componentItemId of componentItemIds) {
    const count = remaining.get(componentItemId) ?? 0;
    if (count <= 0) continue;
    result += 1;
    remaining.set(componentItemId, count - 1);
  }
  return result;
}

function countSameSlotItems(
  slotType: string,
  inventoryCounts: ReadonlyMap<number, number>,
  itemsById: ReadonlyMap<number, ItemCatalogItem>,
): number {
  let result = 0;
  for (const [itemId, count] of inventoryCounts) {
    if (itemsById.get(itemId)?.slotType === slotType) result += count;
  }
  return result;
}

function countValues(values: readonly number[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function normalizeActionType(
  candidate: RecommendationTelemetryCandidateAction,
): RecommendationDatasetV6CandidateFeatures['actionType'] {
  const source = candidate.sourceActionType;
  if (source === 'REBUY') return 'REBUY';
  if (candidate.actionType === 'UPGRADE') return 'UPGRADE';
  if (candidate.actionType === 'SELL') return 'SELL';
  return 'BUY';
}

function normalizeGameTime(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 0;
}

function normalizeCatalogHash(value: string): string | undefined {
  return /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}

function deterministicallySample(decisionId: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const hash = createHash('sha256').update(decisionId).digest().readUInt32BE(0);
  return hash / 0xffffffff < rate;
}

function readThresholds(): RecommendationValueV8PassiveShadowThresholds {
  return {
    minimumMatchCount: readBoundedIntegerEnvironmentValue(
      'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_MIN_MATCHES',
      1_000,
      1,
      10_000_000,
    ),
    minimumDecisionCount: readBoundedIntegerEnvironmentValue(
      'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_MIN_DECISIONS',
      100_000,
      1,
      100_000_000,
    ),
    minimumCandidateCoverage: readBoundedNumberEnvironmentValue(
      'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_MIN_CANDIDATE_COVERAGE',
      0.99,
      0,
      1,
    ),
    maximumFallbackRate: readBoundedNumberEnvironmentValue(
      'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_MAX_FALLBACK_RATE',
      0.005,
      0,
      1,
    ),
    maximumCriticalErrorCount: readBoundedIntegerEnvironmentValue(
      'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_MAX_CRITICAL_ERRORS',
      0,
      0,
      1_000_000,
    ),
    maximumZeroSeparationRate: readBoundedNumberEnvironmentValue(
      'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_MAX_ZERO_SEPARATION_RATE',
      0.05,
      0,
      1,
    ),
    maximumP95LatencyMs: readBoundedNumberEnvironmentValue(
      'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_MAX_P95_LATENCY_MS',
      100,
      1,
      60_000,
    ),
  };
}

function readBooleanEnvironmentValue(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

function readBoundedNumberEnvironmentValue(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function readBoundedIntegerEnvironmentValue(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

async function requiredJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function requiredModel(
  value: RecommendationValueV8RuntimeModelArtifact | undefined,
): RecommendationValueV8RuntimeModelArtifact {
  if (!value) throw new Error('Value V8 passive shadow model is unavailable.');
  return value;
}

function requiredSha(value: string | undefined): string {
  if (!value) throw new Error('Value V8 passive shadow model SHA is unavailable.');
  return value;
}

function optionalSha(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('Expected Value V8 passive shadow SHA-256 is invalid.');
  }
  return normalized;
}

function elapsedMilliseconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

function cloneScheduleInput(
  input: RecommendationValueV8PassiveShadowScheduleInput,
): RecommendationValueV8PassiveShadowScheduleInput {
  return JSON.parse(
    JSON.stringify(input),
  ) as RecommendationValueV8PassiveShadowScheduleInput;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
