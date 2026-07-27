import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  recommendationEligibilityForSource,
  type RecommendationDatasetEligibility,
} from './recommendation-data-provenance';

const SCHEMA_VERSION = 1;
const DEFAULT_OUTPUT_DIRECTORY =
  '/app/apps/api/storage/recommendation-user-runtime-telemetry';
const EVENT_LOG_FILE_NAME = 'events.ndjson';

export type RecommendationUserLiveRolloutMode =
  | 'SHADOW'
  | 'CANARY'
  | 'PRODUCTION';

export interface RecommendationUserLiveCandidateScore {
  actionKey: string;
  score: number;
  rank: number;
  supported: boolean;
}

export interface RecommendationUserLiveDecisionInput {
  decisionId?: string;
  matchId: string;
  playerSlot: number;
  gameTimeSeconds: number;
  candidateGeneratorVersion: string;
  catalogVersion: string;
  stateFeatureVersion: string;
  baselineModelVersion: string;
  challengerModelVersion?: string;
  policyVersion: string;
  rolloutMode: RecommendationUserLiveRolloutMode;
  candidateActionKeys: string[];
  baselineRanking: RecommendationUserLiveCandidateScore[];
  challengerRanking?: RecommendationUserLiveCandidateScore[];
  displayedActionKeys: string[];
  fallbackReason?: string;
  elapsedMs: number;
}

export interface RecommendationUserLiveDecisionEvent
  extends RecommendationUserLiveDecisionInput {
  schemaVersion: typeof SCHEMA_VERSION;
  eventId: string;
  decisionId: string;
  occurredAt: string;
  dataSource: 'USER_LIVE';
  eligibility: RecommendationDatasetEligibility;
}

export interface RecommendationUserLiveTelemetryStatus {
  state: 'READY' | 'DEGRADED';
  schemaVersion: number;
  outputDirectory: string;
  eventLogPath: string;
  eventCount: number;
  writeErrorCount: number;
  lastEventAt?: string;
  lastWriteErrorAt?: string;
  lastWriteError?: string;
}

@Injectable()
export class RecommendationUserLiveTelemetryService implements OnModuleInit {
  private readonly logger = new Logger(
    RecommendationUserLiveTelemetryService.name,
  );
  private readonly outputDirectory =
    process.env.DEADLOCK_RECOMMENDATION_USER_RUNTIME_TELEMETRY_DIR?.trim() ||
    DEFAULT_OUTPUT_DIRECTORY;
  private readonly eventLogPath = join(
    this.outputDirectory,
    EVENT_LOG_FILE_NAME,
  );
  private writeQueue: Promise<void> = Promise.resolve();
  private eventCount = 0;
  private writeErrorCount = 0;
  private lastEventAt?: string;
  private lastWriteErrorAt?: string;
  private lastWriteError?: string;

  async onModuleInit(): Promise<void> {
    await mkdir(this.outputDirectory, { recursive: true });
    await appendFile(this.eventLogPath, '', 'utf8');
    await this.replayPersistedEvents();
    this.logger.log(
      `User runtime recommendation telemetry ready at ${this.eventLogPath}.`,
    );
  }

  getStatus(): RecommendationUserLiveTelemetryStatus {
    return {
      state: this.writeErrorCount === 0 ? 'READY' : 'DEGRADED',
      schemaVersion: SCHEMA_VERSION,
      outputDirectory: this.outputDirectory,
      eventLogPath: this.eventLogPath,
      eventCount: this.eventCount,
      writeErrorCount: this.writeErrorCount,
      lastEventAt: this.lastEventAt,
      lastWriteErrorAt: this.lastWriteErrorAt,
      lastWriteError: this.lastWriteError,
    };
  }

  recordDecision(
    input: RecommendationUserLiveDecisionInput,
  ): RecommendationUserLiveDecisionEvent {
    const event = createRecommendationUserLiveDecisionEvent(input);
    this.eventCount += 1;
    this.lastEventAt = event.occurredAt;
    const serialized = `${JSON.stringify(event)}\n`;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(this.outputDirectory, { recursive: true });
        await appendFile(this.eventLogPath, serialized, 'utf8');
      })
      .catch((error: unknown) => {
        const message = getErrorMessage(error);
        this.writeErrorCount += 1;
        this.lastWriteErrorAt = new Date().toISOString();
        this.lastWriteError = message;
        this.logger.error(
          `User runtime recommendation telemetry append failed: ${message}`,
        );
      });
    return clone(event);
  }

  async waitForIdle(): Promise<void> {
    await this.writeQueue;
    if (this.lastWriteError) {
      throw new Error(
        `User runtime recommendation telemetry write failed: ${this.lastWriteError}`,
      );
    }
  }

  private async replayPersistedEvents(): Promise<void> {
    const lines = createInterface({
      input: createReadStream(this.eventLogPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const value = JSON.parse(line) as unknown;
        if (isUserLiveDecisionEvent(value)) {
          this.eventCount += 1;
          this.lastEventAt = value.occurredAt;
        }
      } catch (error) {
        this.logger.warn(
          `Ignored invalid user runtime telemetry line: ${getErrorMessage(error)}`,
        );
      }
    }
  }
}

export function createRecommendationUserLiveDecisionEvent(
  input: RecommendationUserLiveDecisionInput,
): RecommendationUserLiveDecisionEvent {
  validateDecisionInput(input);
  const candidates = uniqueActionKeys(input.candidateActionKeys);
  const candidateSet = new Set(candidates);
  validateRanking(input.baselineRanking, candidateSet, 'baselineRanking');
  if (input.challengerRanking) {
    validateRanking(input.challengerRanking, candidateSet, 'challengerRanking');
  }
  for (const actionKey of input.displayedActionKeys) {
    if (!candidateSet.has(actionKey)) {
      throw new Error(
        `Displayed action ${actionKey} is outside the recorded candidate set.`,
      );
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    eventId: randomUUID(),
    decisionId: input.decisionId?.trim() || randomUUID(),
    occurredAt: new Date().toISOString(),
    dataSource: 'USER_LIVE',
    eligibility: recommendationEligibilityForSource('USER_LIVE'),
    matchId: input.matchId,
    playerSlot: input.playerSlot,
    gameTimeSeconds: Math.floor(input.gameTimeSeconds),
    candidateGeneratorVersion: input.candidateGeneratorVersion,
    catalogVersion: input.catalogVersion,
    stateFeatureVersion: input.stateFeatureVersion,
    baselineModelVersion: input.baselineModelVersion,
    challengerModelVersion: input.challengerModelVersion,
    policyVersion: input.policyVersion,
    rolloutMode: input.rolloutMode,
    candidateActionKeys: candidates,
    baselineRanking: cloneRanking(input.baselineRanking),
    challengerRanking: input.challengerRanking
      ? cloneRanking(input.challengerRanking)
      : undefined,
    displayedActionKeys: [...input.displayedActionKeys],
    fallbackReason: input.fallbackReason,
    elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
  };
}

function validateDecisionInput(input: RecommendationUserLiveDecisionInput): void {
  if (!input.matchId.trim()) {
    throw new Error('matchId is required.');
  }
  if (!Number.isSafeInteger(input.playerSlot) || input.playerSlot < 0) {
    throw new Error('playerSlot must be a non-negative safe integer.');
  }
  if (!Number.isFinite(input.gameTimeSeconds) || input.gameTimeSeconds < 0) {
    throw new Error('gameTimeSeconds must be finite and non-negative.');
  }
  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs < 0) {
    throw new Error('elapsedMs must be finite and non-negative.');
  }
  const requiredVersions = [
    input.candidateGeneratorVersion,
    input.catalogVersion,
    input.stateFeatureVersion,
    input.baselineModelVersion,
    input.policyVersion,
  ];
  if (requiredVersions.some((value) => !value.trim())) {
    throw new Error('Every required recommendation version must be present.');
  }
  if (input.candidateActionKeys.length === 0) {
    throw new Error('candidateActionKeys must not be empty.');
  }
}

function validateRanking(
  ranking: RecommendationUserLiveCandidateScore[],
  candidateSet: ReadonlySet<string>,
  name: string,
): void {
  const actionKeys = new Set<string>();
  for (const candidate of ranking) {
    if (!candidateSet.has(candidate.actionKey)) {
      throw new Error(
        `${name} action ${candidate.actionKey} is outside the candidate set.`,
      );
    }
    if (actionKeys.has(candidate.actionKey)) {
      throw new Error(`${name} contains duplicate action ${candidate.actionKey}.`);
    }
    if (!Number.isFinite(candidate.score)) {
      throw new Error(`${name} contains a non-finite score.`);
    }
    if (!Number.isSafeInteger(candidate.rank) || candidate.rank <= 0) {
      throw new Error(`${name} contains an invalid rank.`);
    }
    actionKeys.add(candidate.actionKey);
  }
}

function uniqueActionKeys(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cloneRanking(
  ranking: readonly RecommendationUserLiveCandidateScore[],
): RecommendationUserLiveCandidateScore[] {
  return ranking.map((candidate) => ({ ...candidate }));
}

function isUserLiveDecisionEvent(
  value: unknown,
): value is RecommendationUserLiveDecisionEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).schemaVersion === SCHEMA_VERSION &&
    (value as Record<string, unknown>).dataSource === 'USER_LIVE' &&
    typeof (value as Record<string, unknown>).eventId === 'string' &&
    typeof (value as Record<string, unknown>).decisionId === 'string' &&
    typeof (value as Record<string, unknown>).occurredAt === 'string'
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
