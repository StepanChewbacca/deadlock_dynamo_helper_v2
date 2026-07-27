import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  RecommendationDecisionTelemetryService,
  type RecordRecommendationDecisionInput,
  type RecordRecommendationDecisionSupersededInput,
  type RecordRecommendationObservedActionInput,
} from './recommendation-decision-telemetry.service';
import type { RecommendationExperimentMetadata } from './recommendation-value-v6-live.service';

const DEFAULT_OUTPUT_DIRECTORY =
  '/app/apps/api/storage/recommendation-value-v6-live-telemetry';
const EVENT_LOG_FILE = 'events.ndjson';

interface RecommendationValueV6TelemetryResponse {
  recommendationExperiment?: RecommendationExperimentMetadata;
}

@Injectable()
export class RecommendationValueV6TelemetryService extends RecommendationDecisionTelemetryService {
  private readonly v6OutputDirectory =
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_TELEMETRY_DIR?.trim() ||
    DEFAULT_OUTPUT_DIRECTORY;
  private readonly v6EventLogPath = join(
    this.v6OutputDirectory,
    EVENT_LOG_FILE,
  );
  private readonly v6DecisionIds = new Set<string>();
  private v6WriteQueue: Promise<void> = Promise.resolve();

  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    await mkdir(this.v6OutputDirectory, { recursive: true });
    await appendFile(this.v6EventLogPath, '', 'utf8');
  }

  override recordDecision(input: RecordRecommendationDecisionInput): string {
    const experiment = (
      input.recommendation as RecommendationValueV6TelemetryResponse
    ).recommendationExperiment;
    if (experiment?.source !== 'VALUE_V6_CANARY') {
      return super.recordDecision(input);
    }

    const decisionId = randomUUID();
    this.v6DecisionIds.add(decisionId);
    this.appendV6Event({
      schemaVersion: 1,
      eventId: randomUUID(),
      eventType: 'V6_DECISION_SERVED',
      occurredAt: new Date().toISOString(),
      decisionId,
      matchId: input.context.matchId,
      localIdentityReference: stableIdentityReference(input.context.steamId),
      heroId: input.context.heroId,
      teamId: input.context.teamId,
      gameTimeSeconds: input.context.gameTimeS,
      timeBucket: input.context.timeBucket,
      inventoryStateKey: input.context.inventoryStateKey,
      candidateActionKeys: [
        input.recommendation.action.actionKey,
        ...input.recommendation.alternatives.map(
          (action) => action.actionKey,
        ),
      ],
      displayedActionKeys: [
        input.recommendation.action.actionKey,
        ...input.recommendation.alternatives.map(
          (action) => action.actionKey,
        ),
      ],
      candidateId: experiment.candidateId,
      modelVersion: experiment.modelVersion,
      modelSha256: experiment.modelSha256,
      topSeparation: experiment.topSeparation,
      supportedCandidateCount: experiment.supportedCandidateCount,
      fallbackReason: experiment.fallbackReason,
      rolloutMode: 'CANARY',
      rolloutScope: 'ALL_USERS',
      dataSource: 'USER_LIVE',
      eligibleForProModelTraining: false,
      elapsedMs: input.elapsedMs,
    });
    return decisionId;
  }

  override recordObservedAction(
    input: RecordRecommendationObservedActionInput,
  ): void {
    if (!this.v6DecisionIds.has(input.decisionId)) {
      super.recordObservedAction(input);
      return;
    }

    this.appendV6Event({
      schemaVersion: 1,
      eventId: randomUUID(),
      eventType: 'V6_ACTION_OBSERVED',
      occurredAt: new Date().toISOString(),
      decisionId: input.decisionId,
      matchId: input.matchId,
      localIdentityReference: stableIdentityReference(input.steamId),
      heroId: input.heroId,
      teamId: input.teamId,
      observedActionKeys: [...input.observedActionKeys],
      observedInventoryStateKey: input.observedInventoryStateKey,
      observedAtGameTimeS: input.observedAtGameTimeS,
      reconstructionConfidence: input.reconstructionConfidence,
      dataSource: 'USER_LIVE',
      eligibleForProModelTraining: false,
    });
    this.v6DecisionIds.delete(input.decisionId);
  }

  override recordDecisionSuperseded(
    input: RecordRecommendationDecisionSupersededInput,
  ): void {
    if (!this.v6DecisionIds.has(input.decisionId)) {
      super.recordDecisionSuperseded(input);
      return;
    }

    this.appendV6Event({
      schemaVersion: 1,
      eventId: randomUUID(),
      eventType: 'V6_DECISION_SUPERSEDED',
      occurredAt: new Date().toISOString(),
      decisionId: input.decisionId,
      matchId: input.matchId,
      localIdentityReference: stableIdentityReference(input.steamId),
      traversalKey: input.traversalKey,
      reason: input.reason,
      dataSource: 'USER_LIVE',
      eligibleForProModelTraining: false,
    });
    this.v6DecisionIds.delete(input.decisionId);
  }

  async waitForV6TelemetryIdle(): Promise<void> {
    await this.v6WriteQueue;
  }

  private appendV6Event(event: Record<string, unknown>): void {
    this.v6WriteQueue = this.v6WriteQueue.then(() =>
      appendFile(this.v6EventLogPath, `${JSON.stringify(event)}\n`, 'utf8'),
    );
  }
}

function stableIdentityReference(steamId: string): string {
  return createHash('sha256').update(steamId).digest('hex').slice(0, 24);
}
