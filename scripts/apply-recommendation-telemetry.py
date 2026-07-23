from pathlib import Path
import textwrap

ROOT = Path(__file__).resolve().parents[1]


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")


def replace_exact(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    if old not in source:
        raise SystemExit(f"Expected text was not found in {path}: {old[:120]!r}")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


def replace_all(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    if old not in source:
        raise SystemExit(f"Expected text was not found in {path}: {old!r}")
    target.write_text(source.replace(old, new), encoding="utf-8")


write(
    "apps/api/src/deadlock-live/recommendation-decision-telemetry.service.ts",
    r'''
    import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
    import { randomUUID } from 'node:crypto';
    import { createReadStream } from 'node:fs';
    import { appendFile, mkdir } from 'node:fs/promises';
    import { join } from 'node:path';
    import { createInterface } from 'node:readline';
    import type {
      HeroBuildRecommendationAction,
      HeroBuildRecommendationResponse,
    } from './hero-build-recommendation.service';

    const SCHEMA_VERSION = 1;
    const DEFAULT_OUTPUT_DIR =
      '/app/apps/api/storage/recommendation-decision-telemetry';
    const EVENT_LOG_FILE = 'events.ndjson';

    export type RecommendationDecisionTelemetryEventType =
      | 'DECISION_SERVED'
      | 'DECISION_SUPERSEDED'
      | 'ACTION_OBSERVED'
      | 'MODEL_ERROR'
      | 'MATCH_OUTCOME';

    export type RecommendationActionReconstructionConfidence =
      | 'EXACT_SINGLE_ACTION'
      | 'MULTI_ACTION_INTERVAL'
      | 'UNRESOLVED';

    export type RecommendationDecisionSupersedeReason =
      | 'NEW_DECISION_SERVED'
      | 'RUNTIME_EVICTED';

    export type RecommendationOutcomeSource =
      | 'HISTORICAL_MATCH_PLAYER'
      | 'MANUAL';

    export interface RecommendationDecisionTelemetryContext {
      matchId: string;
      steamId: string;
      heroId: number;
      teamId?: number;
      itemIds: number[];
      alliedHeroIds: number[];
      enemyHeroIds: number[];
      previousActionKeys: string[];
      inventoryStateKey: string;
      gameTimeS: number;
      timeBucket: number;
      traversalKey: string;
    }

    export interface RecommendationOutcomeContext {
      matchId: string;
      steamId: string;
      heroId: number;
      teamId?: number;
    }

    export interface RecommendationTelemetryMatchupSignal {
      heroId: number;
      direction: 'POSITIVE' | 'NEGATIVE';
      scoreContribution: number;
      contextualPurchaseLiftPercent: number;
      observationCount: number;
    }

    export interface RecommendationTelemetryCandidateAction {
      actionKey: string;
      actionType: HeroBuildRecommendationAction['type'];
      sourceActionType?: HeroBuildRecommendationAction['sourceActionType'];
      itemId?: number;
      score: number;
      confidence: number;
      historicalCount: number;
      historicalProbability: number;
      predictedStateKey: string;
      matchupSignals: RecommendationTelemetryMatchupSignal[];
    }

    interface RecommendationTelemetryBaseEvent {
      schemaVersion: number;
      eventId: string;
      eventType: RecommendationDecisionTelemetryEventType;
      occurredAt: string;
    }

    export interface RecommendationDecisionServedEvent
      extends RecommendationTelemetryBaseEvent,
        RecommendationDecisionTelemetryContext {
      eventType: 'DECISION_SERVED';
      decisionId: string;
      recommendationModel: string;
      modelVersion?: string;
      modelSha256?: string;
      candidateSetPolicy?: string;
      candidateLimit?: number;
      buildArchetypeId?: string;
      servedActionKey: string;
      candidateActions: RecommendationTelemetryCandidateAction[];
      elapsedMs: number;
    }

    export interface RecommendationDecisionSupersededEvent
      extends RecommendationTelemetryBaseEvent {
      eventType: 'DECISION_SUPERSEDED';
      decisionId: string;
      matchId: string;
      steamId: string;
      traversalKey: string;
      reason: RecommendationDecisionSupersedeReason;
    }

    export interface RecommendationActionObservedEvent
      extends RecommendationTelemetryBaseEvent,
        RecommendationOutcomeContext {
      eventType: 'ACTION_OBSERVED';
      decisionId: string;
      observedActionKeys: string[];
      observedInventoryStateKey: string;
      observedAtGameTimeS: number;
      reconstructionConfidence: RecommendationActionReconstructionConfidence;
    }

    export interface RecommendationModelErrorEvent
      extends RecommendationTelemetryBaseEvent,
        RecommendationDecisionTelemetryContext {
      eventType: 'MODEL_ERROR';
      error: string;
      elapsedMs: number;
    }

    export interface RecommendationMatchOutcomeEvent
      extends RecommendationTelemetryBaseEvent,
        RecommendationOutcomeContext {
      eventType: 'MATCH_OUTCOME';
      playerWon: boolean;
      source: RecommendationOutcomeSource;
    }

    export type RecommendationDecisionTelemetryEvent =
      | RecommendationDecisionServedEvent
      | RecommendationDecisionSupersededEvent
      | RecommendationActionObservedEvent
      | RecommendationModelErrorEvent
      | RecommendationMatchOutcomeEvent;

    export interface RecommendationDecisionTelemetryStatus {
      state: 'READY' | 'DEGRADED';
      schemaVersion: number;
      outputDirectory: string;
      eventLogPath: string;
      eventCount: number;
      decisionCount: number;
      supersededDecisionCount: number;
      observedActionCount: number;
      modelErrorCount: number;
      matchOutcomeCount: number;
      pendingOutcomeCount: number;
      writeErrorCount: number;
      lastEventAt?: string;
      lastWriteErrorAt?: string;
      lastWriteError?: string;
    }

    export interface RecordRecommendationDecisionInput {
      context: RecommendationDecisionTelemetryContext;
      recommendation: HeroBuildRecommendationResponse;
      elapsedMs: number;
    }

    export interface RecordRecommendationObservedActionInput
      extends RecommendationOutcomeContext {
      decisionId: string;
      observedActionKeys: string[];
      observedInventoryStateKey: string;
      observedAtGameTimeS: number;
      reconstructionConfidence: RecommendationActionReconstructionConfidence;
    }

    export interface RecordRecommendationDecisionSupersededInput {
      decisionId: string;
      matchId: string;
      steamId: string;
      traversalKey: string;
      reason: RecommendationDecisionSupersedeReason;
    }

    export interface RecordRecommendationModelErrorInput {
      context: RecommendationDecisionTelemetryContext;
      error: unknown;
      elapsedMs: number;
    }

    export interface RecordRecommendationMatchOutcomeInput
      extends RecommendationOutcomeContext {
      playerWon: boolean;
      source: RecommendationOutcomeSource;
    }

    @Injectable()
    export class RecommendationDecisionTelemetryService implements OnModuleInit {
      private readonly logger = new Logger(
        RecommendationDecisionTelemetryService.name,
      );
      private readonly outputDirectory =
        process.env.DEADLOCK_RECOMMENDATION_TELEMETRY_DIR?.trim() ||
        DEFAULT_OUTPUT_DIR;
      private readonly eventLogPath = join(
        this.outputDirectory,
        EVENT_LOG_FILE,
      );
      private readonly counts: Record<
        RecommendationDecisionTelemetryEventType,
        number
      > = {
        DECISION_SERVED: 0,
        DECISION_SUPERSEDED: 0,
        ACTION_OBSERVED: 0,
        MODEL_ERROR: 0,
        MATCH_OUTCOME: 0,
      };
      private readonly pendingOutcomeContexts = new Map<
        string,
        RecommendationOutcomeContext
      >();
      private readonly resolvedOutcomeKeys = new Set<string>();
      private writeQueue: Promise<void> = Promise.resolve();
      private eventCount = 0;
      private writeErrorCount = 0;
      private lastEventAt?: string;
      private lastWriteErrorAt?: string;
      private lastWriteError?: string;

      async onModuleInit(): Promise<void> {
        await mkdir(this.outputDirectory, { recursive: true });
        await this.replayPersistedEvents();
        this.logger.log(
          `Recommendation telemetry ready at ${this.eventLogPath} with ${this.eventCount} persisted events.`,
        );
      }

      getStatus(): RecommendationDecisionTelemetryStatus {
        return {
          state: this.writeErrorCount === 0 ? 'READY' : 'DEGRADED',
          schemaVersion: SCHEMA_VERSION,
          outputDirectory: this.outputDirectory,
          eventLogPath: this.eventLogPath,
          eventCount: this.eventCount,
          decisionCount: this.counts.DECISION_SERVED,
          supersededDecisionCount: this.counts.DECISION_SUPERSEDED,
          observedActionCount: this.counts.ACTION_OBSERVED,
          modelErrorCount: this.counts.MODEL_ERROR,
          matchOutcomeCount: this.counts.MATCH_OUTCOME,
          pendingOutcomeCount: this.pendingOutcomeContexts.size,
          writeErrorCount: this.writeErrorCount,
          lastEventAt: this.lastEventAt,
          lastWriteErrorAt: this.lastWriteErrorAt,
          lastWriteError: this.lastWriteError,
        };
      }

      getPendingOutcomeContexts(
        limit = 64,
      ): RecommendationOutcomeContext[] {
        const normalizedLimit = Number.isSafeInteger(limit) && limit > 0
          ? Math.min(limit, 512)
          : 64;
        return [...this.pendingOutcomeContexts.values()]
          .slice(0, normalizedLimit)
          .map((context) => cloneOutcomeContext(context));
      }

      recordDecision(input: RecordRecommendationDecisionInput): string {
        const decisionId = randomUUID();
        const contextual = input.recommendation as HeroBuildRecommendationResponse & {
          recommendationModel?: string;
          modelVersion?: string;
          modelSha256?: string;
          candidateSetPolicy?: string;
          candidateLimit?: number;
          buildArchetypeId?: string;
        };
        const event: RecommendationDecisionServedEvent = {
          schemaVersion: SCHEMA_VERSION,
          eventId: randomUUID(),
          eventType: 'DECISION_SERVED',
          occurredAt: new Date().toISOString(),
          decisionId,
          ...cloneDecisionContext(input.context),
          recommendationModel: contextual.recommendationModel ?? 'UNKNOWN',
          modelVersion: contextual.modelVersion,
          modelSha256: contextual.modelSha256,
          candidateSetPolicy: contextual.candidateSetPolicy,
          candidateLimit: contextual.candidateLimit,
          buildArchetypeId: contextual.buildArchetypeId,
          servedActionKey: input.recommendation.action.actionKey,
          candidateActions: [
            input.recommendation.action,
            ...input.recommendation.alternatives,
          ].map(serializeCandidateAction),
          elapsedMs: normalizeElapsedMs(input.elapsedMs),
        };
        this.appendEvent(event);
        return decisionId;
      }

      recordObservedAction(
        input: RecordRecommendationObservedActionInput,
      ): void {
        this.appendEvent({
          schemaVersion: SCHEMA_VERSION,
          eventId: randomUUID(),
          eventType: 'ACTION_OBSERVED',
          occurredAt: new Date().toISOString(),
          decisionId: input.decisionId,
          ...cloneOutcomeContext(input),
          observedActionKeys: [...input.observedActionKeys],
          observedInventoryStateKey: input.observedInventoryStateKey,
          observedAtGameTimeS: normalizeGameTime(input.observedAtGameTimeS),
          reconstructionConfidence: input.reconstructionConfidence,
        });
      }

      recordDecisionSuperseded(
        input: RecordRecommendationDecisionSupersededInput,
      ): void {
        this.appendEvent({
          schemaVersion: SCHEMA_VERSION,
          eventId: randomUUID(),
          eventType: 'DECISION_SUPERSEDED',
          occurredAt: new Date().toISOString(),
          decisionId: input.decisionId,
          matchId: input.matchId,
          steamId: input.steamId,
          traversalKey: input.traversalKey,
          reason: input.reason,
        });
      }

      recordModelError(input: RecordRecommendationModelErrorInput): void {
        this.appendEvent({
          schemaVersion: SCHEMA_VERSION,
          eventId: randomUUID(),
          eventType: 'MODEL_ERROR',
          occurredAt: new Date().toISOString(),
          ...cloneDecisionContext(input.context),
          error: getErrorMessage(input.error),
          elapsedMs: normalizeElapsedMs(input.elapsedMs),
        });
      }

      recordMatchOutcome(
        input: RecordRecommendationMatchOutcomeInput,
      ): boolean {
        const outcomeKey = createOutcomeKey(input);
        if (this.resolvedOutcomeKeys.has(outcomeKey)) {
          return false;
        }
        this.appendEvent({
          schemaVersion: SCHEMA_VERSION,
          eventId: randomUUID(),
          eventType: 'MATCH_OUTCOME',
          occurredAt: new Date().toISOString(),
          ...cloneOutcomeContext(input),
          playerWon: input.playerWon,
          source: input.source,
        });
        return true;
      }

      async waitForIdle(): Promise<void> {
        await this.writeQueue;
      }

      private appendEvent(event: RecommendationDecisionTelemetryEvent): void {
        this.applyEvent(event);
        const serialized = `${JSON.stringify(event)}\n`;
        this.writeQueue = this.writeQueue
          .then(() => appendFile(this.eventLogPath, serialized, 'utf8'))
          .catch((error: unknown) => {
            const message = getErrorMessage(error);
            this.writeErrorCount += 1;
            this.lastWriteErrorAt = new Date().toISOString();
            this.lastWriteError = message;
            this.logger.error(
              `Recommendation telemetry append failed: ${message}`,
            );
          });
      }

      private applyEvent(event: RecommendationDecisionTelemetryEvent): void {
        this.eventCount += 1;
        this.counts[event.eventType] += 1;
        this.lastEventAt = event.occurredAt;

        if (event.eventType === 'MATCH_OUTCOME') {
          const key = createOutcomeKey(event);
          this.resolvedOutcomeKeys.add(key);
          this.pendingOutcomeContexts.delete(key);
          return;
        }

        if (event.eventType === 'DECISION_SERVED') {
          const key = createOutcomeKey(event);
          if (!this.resolvedOutcomeKeys.has(key)) {
            this.pendingOutcomeContexts.set(
              key,
              cloneOutcomeContext(event),
            );
          }
        }
      }

      private async replayPersistedEvents(): Promise<void> {
        try {
          const lines = createInterface({
            input: createReadStream(this.eventLogPath, { encoding: 'utf8' }),
            crlfDelay: Infinity,
          });
          for await (const line of lines) {
            if (!line.trim()) {
              continue;
            }
            try {
              const event = JSON.parse(line) as unknown;
              if (isTelemetryEvent(event)) {
                this.applyEvent(event);
              }
            } catch (error) {
              this.logger.warn(
                `Ignored invalid recommendation telemetry line: ${getErrorMessage(error)}`,
              );
            }
          }
        } catch (error) {
          if (isErrorWithCode(error) && error.code === 'ENOENT') {
            return;
          }
          throw error;
        }
      }
    }

    function serializeCandidateAction(
      action: HeroBuildRecommendationAction,
    ): RecommendationTelemetryCandidateAction {
      return {
        actionKey: action.actionKey,
        actionType: action.type,
        sourceActionType: action.sourceActionType,
        itemId: action.itemId,
        score: finiteOrZero(action.score),
        confidence: finiteOrZero(action.confidence),
        historicalCount: Number.isSafeInteger(action.historicalCount)
          ? action.historicalCount
          : 0,
        historicalProbability: finiteOrZero(action.historicalProbability),
        predictedStateKey: action.predictedStateKey,
        matchupSignals: (action.matchupSignals ?? []).map((signal) => ({
          heroId: signal.heroId,
          direction: signal.direction,
          scoreContribution: finiteOrZero(signal.scoreContribution),
          contextualPurchaseLiftPercent: finiteOrZero(
            signal.contextualPurchaseLiftPercent,
          ),
          observationCount: Number.isSafeInteger(signal.observationCount)
            ? signal.observationCount
            : 0,
        })),
      };
    }

    function cloneDecisionContext(
      context: RecommendationDecisionTelemetryContext,
    ): RecommendationDecisionTelemetryContext {
      return {
        matchId: context.matchId,
        steamId: context.steamId,
        heroId: context.heroId,
        teamId: context.teamId,
        itemIds: [...context.itemIds],
        alliedHeroIds: [...context.alliedHeroIds],
        enemyHeroIds: [...context.enemyHeroIds],
        previousActionKeys: [...context.previousActionKeys],
        inventoryStateKey: context.inventoryStateKey,
        gameTimeS: normalizeGameTime(context.gameTimeS),
        timeBucket: Number.isSafeInteger(context.timeBucket)
          ? Math.max(0, context.timeBucket)
          : 0,
        traversalKey: context.traversalKey,
      };
    }

    function cloneOutcomeContext(
      context: RecommendationOutcomeContext,
    ): RecommendationOutcomeContext {
      return {
        matchId: context.matchId,
        steamId: context.steamId,
        heroId: context.heroId,
        teamId: context.teamId,
      };
    }

    function createOutcomeKey(context: RecommendationOutcomeContext): string {
      return `${context.matchId}:${context.steamId}:${context.heroId}`;
    }

    function isTelemetryEvent(
      value: unknown,
    ): value is RecommendationDecisionTelemetryEvent {
      if (!isRecord(value)) {
        return false;
      }
      return (
        value.schemaVersion === SCHEMA_VERSION &&
        typeof value.eventId === 'string' &&
        typeof value.occurredAt === 'string' &&
        [
          'DECISION_SERVED',
          'DECISION_SUPERSEDED',
          'ACTION_OBSERVED',
          'MODEL_ERROR',
          'MATCH_OUTCOME',
        ].includes(String(value.eventType))
      );
    }

    function normalizeGameTime(value: number): number {
      return Number.isFinite(value)
        ? Math.max(0, Math.floor(value))
        : 0;
    }

    function normalizeElapsedMs(value: number): number {
      return Number.isFinite(value)
        ? Math.max(0, Math.round(value))
        : 0;
    }

    function finiteOrZero(value: number): number {
      return Number.isFinite(value) ? value : 0;
    }

    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === 'object' && value !== null;
    }

    function isErrorWithCode(
      value: unknown,
    ): value is Error & { code: string } {
      return value instanceof Error && 'code' in value;
    }

    function getErrorMessage(error: unknown): string {
      return error instanceof Error ? error.message : String(error);
    }
    ''',
)

write(
    "apps/api/src/deadlock-live/recommendation-decision-telemetry.controller.ts",
    r'''
    import {
      BadRequestException,
      Body,
      Controller,
      Get,
      HttpCode,
      Post,
    } from '@nestjs/common';
    import { RecommendationDecisionTelemetryService } from './recommendation-decision-telemetry.service';

    export class RecordRecommendationMatchOutcomeDto {
      matchId!: string;
      steamId!: string;
      heroId!: number;
      teamId?: number;
      playerWon!: boolean;
    }

    @Controller('deadlock/analysis/recommendation-telemetry')
    export class RecommendationDecisionTelemetryController {
      constructor(
        private readonly telemetryService:
          RecommendationDecisionTelemetryService,
      ) {}

      @Get('status')
      getStatus() {
        return this.telemetryService.getStatus();
      }

      @Post('outcome')
      @HttpCode(200)
      recordOutcome(@Body() dto: RecordRecommendationMatchOutcomeDto) {
        validateOutcomeRequest(dto);
        const recorded = this.telemetryService.recordMatchOutcome({
          matchId: dto.matchId.trim(),
          steamId: dto.steamId.trim(),
          heroId: dto.heroId,
          teamId: dto.teamId,
          playerWon: dto.playerWon,
          source: 'MANUAL',
        });
        return {
          recorded,
          status: this.telemetryService.getStatus(),
        };
      }
    }

    function validateOutcomeRequest(
      dto: RecordRecommendationMatchOutcomeDto,
    ): void {
      if (typeof dto?.matchId !== 'string' || !dto.matchId.trim()) {
        throw new BadRequestException('matchId must be a non-empty string.');
      }
      if (typeof dto.steamId !== 'string' || !dto.steamId.trim()) {
        throw new BadRequestException('steamId must be a non-empty string.');
      }
      if (!Number.isSafeInteger(dto.heroId) || dto.heroId <= 0) {
        throw new BadRequestException(
          'heroId must be a positive safe integer.',
        );
      }
      if (
        dto.teamId !== undefined &&
        (!Number.isSafeInteger(dto.teamId) || dto.teamId < 0)
      ) {
        throw new BadRequestException(
          'teamId must be a non-negative safe integer.',
        );
      }
      if (typeof dto.playerWon !== 'boolean') {
        throw new BadRequestException('playerWon must be a boolean.');
      }
    }
    ''',
)

write(
    "apps/api/src/deadlock-live/recommendation-outcome-linker.service.ts",
    r'''
    import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
    import { Interval } from '@nestjs/schedule';
    import { InjectRepository } from '@nestjs/typeorm';
    import { In, Repository } from 'typeorm';
    import { MatchPlayer } from './entities/match-player.entity';
    import { heroIdAliases } from './hero-id-aliases';
    import { RecommendationDecisionTelemetryService } from './recommendation-decision-telemetry.service';

    const OUTCOME_LINK_INTERVAL_MS = 60_000;
    const OUTCOME_LINK_BATCH_SIZE = 64;

    @Injectable()
    export class RecommendationOutcomeLinkerService implements OnModuleInit {
      private readonly logger = new Logger(
        RecommendationOutcomeLinkerService.name,
      );
      private running = false;

      constructor(
        private readonly telemetryService:
          RecommendationDecisionTelemetryService,
        @InjectRepository(MatchPlayer)
        private readonly matchPlayerRepository: Repository<MatchPlayer>,
      ) {}

      onModuleInit(): void {
        void this.linkPendingOutcomes();
      }

      @Interval(OUTCOME_LINK_INTERVAL_MS)
      async linkPendingOutcomes(): Promise<void> {
        if (this.running) {
          return;
        }
        this.running = true;
        let linkedCount = 0;
        try {
          const contexts = this.telemetryService.getPendingOutcomeContexts(
            OUTCOME_LINK_BATCH_SIZE,
          );
          for (const context of contexts) {
            const matchId = Number(context.matchId);
            if (!Number.isSafeInteger(matchId) || matchId <= 0) {
              continue;
            }
            const player = await this.matchPlayerRepository.findOne({
              where: {
                matchId,
                heroId: In([...heroIdAliases(context.heroId)]),
              },
            });
            if (!player) {
              continue;
            }
            const recorded = this.telemetryService.recordMatchOutcome({
              ...context,
              playerWon: player.won,
              source: 'HISTORICAL_MATCH_PLAYER',
            });
            linkedCount += recorded ? 1 : 0;
          }
          if (linkedCount > 0) {
            this.logger.log(
              `Linked ${linkedCount} recommendation telemetry outcome(s).`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Recommendation outcome linking failed: ${getErrorMessage(error)}`,
          );
        } finally {
          this.running = false;
        }
      }
    }

    function getErrorMessage(error: unknown): string {
      return error instanceof Error ? error.message : String(error);
    }
    ''',
)

write(
    "apps/api/test/recommendation-decision-telemetry.spec.ts",
    r'''
    import { mkdtemp, readFile, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import type { Repository } from 'typeorm';
    import { MatchPlayer } from '../src/deadlock-live/entities/match-player.entity';
    import { RecommendationDecisionTelemetryService } from '../src/deadlock-live/recommendation-decision-telemetry.service';
    import { RecommendationOutcomeLinkerService } from '../src/deadlock-live/recommendation-outcome-linker.service';
    import type { HeroBuildRecommendationResponse } from '../src/deadlock-live/hero-build-recommendation.service';

    describe('recommendation decision telemetry', () => {
      let outputDirectory = '';

      beforeEach(async () => {
        outputDirectory = await mkdtemp(
          join(tmpdir(), 'deadlock-recommendation-telemetry-'),
        );
        process.env.DEADLOCK_RECOMMENDATION_TELEMETRY_DIR =
          outputDirectory;
      });

      afterEach(async () => {
        delete process.env.DEADLOCK_RECOMMENDATION_TELEMETRY_DIR;
        await rm(outputDirectory, { recursive: true, force: true });
      });

      it('persists decisions, observed actions, and match outcomes', async () => {
        const service = new RecommendationDecisionTelemetryService();
        await service.onModuleInit();
        const context = createContext();
        const decisionId = service.recordDecision({
          context,
          recommendation: createRecommendation(),
          elapsedMs: 12.4,
        });
        service.recordObservedAction({
          decisionId,
          matchId: context.matchId,
          steamId: context.steamId,
          heroId: context.heroId,
          teamId: context.teamId,
          observedActionKeys: ['BUY:999'],
          observedInventoryStateKey: '100x1|999x1',
          observedAtGameTimeS: 25,
          reconstructionConfidence: 'EXACT_SINGLE_ACTION',
        });
        expect(
          service.recordMatchOutcome({
            matchId: context.matchId,
            steamId: context.steamId,
            heroId: context.heroId,
            teamId: context.teamId,
            playerWon: true,
            source: 'MANUAL',
          }),
        ).toBe(true);
        expect(
          service.recordMatchOutcome({
            matchId: context.matchId,
            steamId: context.steamId,
            heroId: context.heroId,
            teamId: context.teamId,
            playerWon: true,
            source: 'MANUAL',
          }),
        ).toBe(false);
        await service.waitForIdle();

        const lines = (
          await readFile(join(outputDirectory, 'events.ndjson'), 'utf8')
        )
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(lines.map((line) => line.eventType)).toEqual([
          'DECISION_SERVED',
          'ACTION_OBSERVED',
          'MATCH_OUTCOME',
        ]);
        expect(lines[0]).toMatchObject({
          decisionId,
          servedActionKey: 'BUY:999',
          recommendationModel: 'CONTEXTUAL_V3',
        });
        expect(lines[0].candidateActions).toEqual([
          expect.objectContaining({
            actionKey: 'BUY:999',
            matchupSignals: [
              expect.objectContaining({
                contextualPurchaseLiftPercent: 3.2,
              }),
            ],
          }),
        ]);
        expect(service.getStatus()).toMatchObject({
          state: 'READY',
          eventCount: 3,
          decisionCount: 1,
          observedActionCount: 1,
          matchOutcomeCount: 1,
          pendingOutcomeCount: 0,
          writeErrorCount: 0,
        });

        const replayed = new RecommendationDecisionTelemetryService();
        await replayed.onModuleInit();
        expect(replayed.getStatus()).toMatchObject({
          eventCount: 3,
          decisionCount: 1,
          observedActionCount: 1,
          matchOutcomeCount: 1,
          pendingOutcomeCount: 0,
        });
      });

      it('automatically links an unresolved decision to stored match data', async () => {
        const service = new RecommendationDecisionTelemetryService();
        await service.onModuleInit();
        service.recordDecision({
          context: createContext(),
          recommendation: createRecommendation(),
          elapsedMs: 4,
        });
        const findOne = jest.fn(async () => ({ won: false }));
        const linker = new RecommendationOutcomeLinkerService(
          service,
          { findOne } as unknown as Repository<MatchPlayer>,
        );

        await linker.linkPendingOutcomes();
        await service.waitForIdle();

        expect(findOne).toHaveBeenCalledTimes(1);
        expect(service.getStatus()).toMatchObject({
          matchOutcomeCount: 1,
          pendingOutcomeCount: 0,
        });
        const content = await readFile(
          join(outputDirectory, 'events.ndjson'),
          'utf8',
        );
        expect(content).toContain('"source":"HISTORICAL_MATCH_PLAYER"');
        expect(content).toContain('"playerWon":false');
      });
    });

    function createContext() {
      return {
        matchId: '12345',
        steamId: 'steam-local',
        heroId: 72,
        teamId: 1,
        itemIds: [100],
        alliedHeroIds: [2, 3, 4, 5, 6],
        enemyHeroIds: [13, 14, 15, 16, 17],
        previousActionKeys: ['BUY:100'],
        inventoryStateKey: '100x1',
        gameTimeS: 20,
        timeBucket: 0,
        traversalKey: '12345:steam-local:72:100x1',
      };
    }

    function createRecommendation(): HeroBuildRecommendationResponse {
      return {
        mode: 'BACKOFF',
        heroId: 72,
        requestedStateKey: '100x1',
        gameTimeS: 20,
        matchedStateKey: '100x1',
        stateDistance: 0,
        missingItemCount: 0,
        extraItemCount: 0,
        matchedBySubset: true,
        observationCount: 80,
        candidateStateCount: 128,
        action: {
          type: 'BUY',
          sourceActionType: 'BUY',
          itemId: 999,
          actionKey: 'BUY:999',
          historicalCount: 50,
          historicalProbability: 0.5,
          averageGameTimeS: 20,
          matchedStateKey: '100x1',
          matchedStateObservationCount: 80,
          stateDistance: 0,
          missingItemCount: 0,
          extraItemCount: 0,
          matchedBySubset: true,
          currentOwnedCount: 0,
          observedOwnedCountLimit: 1,
          matchupSignals: [
            {
              heroId: 13,
              direction: 'POSITIVE',
              scoreContribution: 0.02,
              contextualPurchaseLiftPercent: 3.2,
              observationCount: 90,
            },
          ],
          predictedStateKey: '100x1|999x1',
          score: 0.7,
          confidence: 0.7,
        },
        alternatives: [],
        recommendationModel: 'CONTEXTUAL_V3',
        modelVersion: 'TEST_MODEL',
        modelSha256: 'test-sha',
        candidateSetPolicy: 'TEST_POLICY',
        candidateLimit: 128,
        buildArchetypeId: 'TEST_ARCHETYPE',
      } as HeroBuildRecommendationResponse;
    }
    ''',
)

write(
    "docs/recommendation-decision-telemetry.md",
    r'''
    # Recommendation decision telemetry

    The live model writes append-only NDJSON telemetry to:

    ```text
    /app/apps/api/storage/recommendation-decision-telemetry/events.ndjson
    ```

    Override the directory with `DEADLOCK_RECOMMENDATION_TELEMETRY_DIR`.

    ## Event lifecycle

    Each usable live recommendation is persisted as `DECISION_SERVED`. The next
    detected inventory transition is linked through `ACTION_OBSERVED`. A decision
    replaced by a newer time bucket before an action is marked
    `DECISION_SUPERSEDED`. Model failures are recorded as `MODEL_ERROR`.

    `RecommendationOutcomeLinkerService` periodically resolves pending decisions
    against stored `match_players` rows and appends `MATCH_OUTCOME`. Outcomes may
    also be supplied manually through:

    ```text
    POST /deadlock/analysis/recommendation-telemetry/outcome
    ```

    Status is available at:

    ```text
    GET /deadlock/analysis/recommendation-telemetry/status
    ```

    Telemetry is never used as a synchronous dependency of live inference. A
    storage failure marks telemetry `DEGRADED` and increments `writeErrorCount`,
    while the recommendation request remains model-only.

    Matchup percentages are named `contextualPurchaseLiftPercent`. They describe
    modelled historical purchase-pattern influence, not win probability or causal
    counter effectiveness.
    ''',
)

module_path = "apps/api/src/deadlock-live/deadlock-live.module.ts"
replace_exact(
    module_path,
    "import { RecentMatchesWindowService } from './recent-matches-window.service';\n",
    "import { RecentMatchesWindowService } from './recent-matches-window.service';\n"
    "import { RecommendationDecisionTelemetryController } from './recommendation-decision-telemetry.controller';\n"
    "import { RecommendationDecisionTelemetryService } from './recommendation-decision-telemetry.service';\n"
    "import { RecommendationOutcomeLinkerService } from './recommendation-outcome-linker.service';\n",
)
replace_exact(
    module_path,
    "    HeroBuildContextualV3LiveController,\n    SkillBuildAnalysisController,\n",
    "    HeroBuildContextualV3LiveController,\n"
    "    RecommendationDecisionTelemetryController,\n"
    "    SkillBuildAnalysisController,\n",
)
replace_exact(
    module_path,
    "    HeroBuildContextualV3LiveService,\n    {\n      provide: HeroBuildOfflineEvaluationService,\n",
    "    HeroBuildContextualV3LiveService,\n"
    "    RecommendationDecisionTelemetryService,\n"
    "    RecommendationOutcomeLinkerService,\n"
    "    {\n      provide: HeroBuildOfflineEvaluationService,\n",
)
replace_exact(
    module_path,
    "    HeroBuildContextualV3LiveService,\n    HeroBuildRecommendationService,\n",
    "    HeroBuildContextualV3LiveService,\n"
    "    RecommendationDecisionTelemetryService,\n"
    "    HeroBuildRecommendationService,\n",
)

traversal_path = "apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts"
replace_exact(
    traversal_path,
    "import { Injectable, Logger } from '@nestjs/common';",
    "import { Injectable, Logger, Optional } from '@nestjs/common';",
)
replace_exact(
    traversal_path,
    "  HERO_BUILD_MAX_RECOMMENDATION_LIMIT,\n  HeroBuildRecommendationService,\n",
    "  HERO_BUILD_MAX_RECOMMENDATION_LIMIT,\n"
    "  HeroBuildRecommendationResponse,\n"
    "  HeroBuildRecommendationService,\n",
)
replace_exact(
    traversal_path,
    "import { RecipeAwareTimelineReconciliationService } from './recipe-aware-timeline-reconciliation.service';\n",
    "import { RecipeAwareTimelineReconciliationService } from './recipe-aware-timeline-reconciliation.service';\n"
    "import { RecommendationDecisionTelemetryService } from './recommendation-decision-telemetry.service';\n",
)
replace_exact(
    traversal_path,
    "  heroId: number;\n  itemIds: number[];\n",
    "  heroId: number;\n  teamId?: number;\n  itemIds: number[];\n",
)
replace_exact(
    traversal_path,
    "  heroId?: number;\n  itemIds: number[];\n",
    "  heroId?: number;\n  teamId?: number;\n  itemIds: number[];\n",
)
replace_exact(
    traversal_path,
    "  traversalKey?: string;\n  isStale: boolean;\n",
    "  traversalKey?: string;\n  decisionId?: string;\n  isStale: boolean;\n",
)
replace_exact(
    traversal_path,
    "  inventorySnapshots: number[][];\n  snapshot: LiveBuildRecommendationTraversalSnapshot;\n",
    "  inventorySnapshots: number[][];\n"
    "  pendingDecisionId?: string;\n"
    "  pendingDecisionTraversalKey?: string;\n"
    "  snapshot: LiveBuildRecommendationTraversalSnapshot;\n",
)
replace_exact(
    traversal_path,
    "    private readonly recipeAwareTimelineReconciliationService:\n      RecipeAwareTimelineReconciliationService,\n  ) {}",
    "    private readonly recipeAwareTimelineReconciliationService:\n"
    "      RecipeAwareTimelineReconciliationService,\n"
    "    @Optional()\n"
    "    private readonly recommendationDecisionTelemetryService?:\n"
    "      RecommendationDecisionTelemetryService,\n"
    "  ) {}",
)
replace_exact(
    traversal_path,
    "    const previousSnapshot = runtime.inventorySnapshots[runtime.inventorySnapshots.length - 1];\n"
    "    if (!previousSnapshot || !sameNumberArrays(previousSnapshot, currentItemIds)) {\n"
    "      runtime.inventorySnapshots.push(currentItemIds);\n"
    "      if (runtime.inventorySnapshots.length > 128) {\n"
    "        runtime.inventorySnapshots.shift();\n"
    "      }\n"
    "    }",
    "    const previousSnapshot =\n"
    "      runtime.inventorySnapshots[runtime.inventorySnapshots.length - 1];\n"
    "    const inventoryChanged = Boolean(\n"
    "      previousSnapshot &&\n"
    "        !sameNumberArrays(previousSnapshot, currentItemIds),\n"
    "    );\n"
    "    if (inventoryChanged && previousSnapshot) {\n"
    "      this.recordObservedAction(\n"
    "        runtime,\n"
    "        state,\n"
    "        localPlayer,\n"
    "        previousSnapshot,\n"
    "        currentItemIds,\n"
    "      );\n"
    "    }\n"
    "    if (!previousSnapshot || inventoryChanged) {\n"
    "      runtime.inventorySnapshots.push(currentItemIds);\n"
    "      if (runtime.inventorySnapshots.length > 128) {\n"
    "        runtime.inventorySnapshots.shift();\n"
    "      }\n"
    "    }",
)
replace_exact(
    traversal_path,
    "    const inventoryChanged =\n      runtime.snapshot.inventoryStateKey !== undefined &&\n      runtime.snapshot.inventoryStateKey !== input.inventoryStateKey;\n    const optimisticRecommendation =\n      inventoryChanged && runtime.snapshot.recommendation\n",
    "    const recommendationInventoryChanged =\n"
    "      runtime.snapshot.inventoryStateKey !== undefined &&\n"
    "      runtime.snapshot.inventoryStateKey !== input.inventoryStateKey;\n"
    "    const optimisticRecommendation =\n"
    "      recommendationInventoryChanged && runtime.snapshot.recommendation\n",
)
replace_exact(
    traversal_path,
    "      heroId: input.heroId,\n      itemIds: [...input.itemIds],\n",
    "      heroId: input.heroId,\n      teamId: input.teamId,\n      itemIds: [...input.itemIds],\n",
)
replace_exact(
    traversal_path,
    "      const input = runtime.desiredInput;\n      runtime.lastAttemptedKey = input.traversalKey;\n",
    "      const input = runtime.desiredInput;\n"
    "      const startedAt = Date.now();\n"
    "      runtime.lastAttemptedKey = input.traversalKey;\n",
)
replace_exact(
    traversal_path,
    "        runtime.resolvedKey = input.traversalKey;\n        runtime.snapshot = {",
    "        const decisionId = this.recordServedDecision(\n"
    "          runtime,\n"
    "          input,\n"
    "          recommendation,\n"
    "          Date.now() - startedAt,\n"
    "        );\n"
    "        runtime.resolvedKey = input.traversalKey;\n"
    "        runtime.snapshot = {",
)
replace_exact(
    traversal_path,
    "          heroId: input.heroId,\n          itemIds: [...input.itemIds],\n",
    "          heroId: input.heroId,\n"
    "          teamId: input.teamId,\n"
    "          itemIds: [...input.itemIds],\n",
)
replace_exact(
    traversal_path,
    "          traversalKey: input.traversalKey,\n          isStale: false,\n",
    "          traversalKey: input.traversalKey,\n"
    "          decisionId,\n"
    "          isStale: false,\n",
)
replace_exact(
    traversal_path,
    "        runtime.snapshot = {\n          ...runtime.snapshot,\n          state: 'ERROR',\n",
    "        this.recommendationDecisionTelemetryService?.recordModelError({\n"
    "          context: input,\n"
    "          error,\n"
    "          elapsedMs: Date.now() - startedAt,\n"
    "        });\n"
    "        runtime.snapshot = {\n"
    "          ...runtime.snapshot,\n"
    "          state: 'ERROR',\n",
)
replace_exact(
    traversal_path,
    "  private evictOldRuntimes(): void {",
    r'''  private recordObservedAction(
    runtime: TraversalRuntime,
    state: MinimalMatchState,
    localPlayer: MinimalPlayerState,
    previousItemIds: readonly number[],
    currentItemIds: readonly number[],
  ): void {
    const decisionId = runtime.pendingDecisionId;
    const telemetry = this.recommendationDecisionTelemetryService;
    if (!decisionId || !telemetry) {
      return;
    }
    const observedActionKeys = deriveContextualV3PreviousActionKeys(
      [previousItemIds, currentItemIds],
      (parentItemId) =>
        this.recipeAwareTimelineReconciliationService.getComponentItemIds(
          parentItemId,
        ),
    );
    telemetry.recordObservedAction({
      decisionId,
      matchId: state.matchId,
      steamId: localPlayer.steamId,
      heroId: Number(localPlayer.heroId),
      teamId: normalizeTeamId(localPlayer.teamId),
      observedActionKeys,
      observedInventoryStateKey:
        createInventoryStateKeyFromItemIds(currentItemIds),
      observedAtGameTimeS: normalizeGameTime(state.gameTimeSec),
      reconstructionConfidence:
        observedActionKeys.length === 1
          ? 'EXACT_SINGLE_ACTION'
          : observedActionKeys.length > 1
            ? 'MULTI_ACTION_INTERVAL'
            : 'UNRESOLVED',
    });
    runtime.pendingDecisionId = undefined;
    runtime.pendingDecisionTraversalKey = undefined;
  }

  private recordServedDecision(
    runtime: TraversalRuntime,
    input: LiveBuildRecommendationTraversalInput,
    recommendation: HeroBuildRecommendationResponse,
    elapsedMs: number,
  ): string | undefined {
    const telemetry = this.recommendationDecisionTelemetryService;
    if (!telemetry) {
      return undefined;
    }
    if (
      runtime.pendingDecisionId &&
      runtime.pendingDecisionTraversalKey &&
      runtime.pendingDecisionTraversalKey !== input.traversalKey
    ) {
      telemetry.recordDecisionSuperseded({
        decisionId: runtime.pendingDecisionId,
        matchId: input.matchId,
        steamId: input.steamId,
        traversalKey: runtime.pendingDecisionTraversalKey,
        reason: 'NEW_DECISION_SERVED',
      });
    }
    const decisionId = telemetry.recordDecision({
      context: input,
      recommendation,
      elapsedMs,
    });
    runtime.pendingDecisionId = decisionId;
    runtime.pendingDecisionTraversalKey = input.traversalKey;
    return decisionId;
  }

  private supersedePendingDecision(
    runtime: TraversalRuntime,
    reason: 'RUNTIME_EVICTED',
  ): void {
    if (
      !runtime.pendingDecisionId ||
      !runtime.pendingDecisionTraversalKey ||
      !this.recommendationDecisionTelemetryService
    ) {
      return;
    }
    this.recommendationDecisionTelemetryService.recordDecisionSuperseded({
      decisionId: runtime.pendingDecisionId,
      matchId: runtime.matchId,
      steamId: runtime.snapshot.steamId ?? '',
      traversalKey: runtime.pendingDecisionTraversalKey,
      reason,
    });
    runtime.pendingDecisionId = undefined;
    runtime.pendingDecisionTraversalKey = undefined;
  }

  private evictOldRuntimes(): void {''',
)
replace_exact(
    traversal_path,
    "      if (runtime) {\n        this.runtimes.delete(runtime.matchId);\n      }",
    "      if (runtime) {\n"
    "        this.supersedePendingDecision(runtime, 'RUNTIME_EVICTED');\n"
    "        this.runtimes.delete(runtime.matchId);\n"
    "      }",
)
replace_exact(
    traversal_path,
    "  const heroId = Number(localPlayer.heroId);\n  const itemIds = localPlayer.items\n",
    "  const heroId = Number(localPlayer.heroId);\n"
    "  const teamId = normalizeTeamId(localPlayer.teamId);\n"
    "  const itemIds = localPlayer.items\n",
)
replace_exact(
    traversal_path,
    "    heroId,\n    itemIds,\n",
    "    heroId,\n    teamId,\n    itemIds,\n",
)
replace_exact(
    traversal_path,
    "function formatGameTime(value: number): string {",
    r'''function normalizeGameTime(value: number | undefined): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.floor(Number(value)))
    : 0;
}

function normalizeTeamId(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function formatGameTime(value: number): string {''',
)

# Rename the misleading matchup percentage across the API, tests, and client.
for root in [ROOT / "apps", ROOT / "docs"]:
    if not root.exists():
        continue
    for path in root.rglob("*"):
        if path.is_file() and path.suffix in {".ts", ".md"}:
            source = path.read_text(encoding="utf-8")
            if "modelLiftPercent" in source:
                path.write_text(
                    source.replace(
                        "modelLiftPercent",
                        "contextualPurchaseLiftPercent",
                    ),
                    encoding="utf-8",
                )

replace_all(
    "apps/overwolf-client/src/live-build-recommendation-ui.ts",
    "% model lift",
    "% purchase-pattern lift",
)
replace_all(
    "apps/overwolf-client/src/live-build-desktop-table-ui.ts",
    "% (",
    "% purchase lift (",
)
replace_exact(
    "apps/overwolf-client/src/live-build-desktop-table-ui.ts",
    "  title.textContent = 'Full build';\n",
    "  title.textContent = 'Projected model path';\n",
)
replace_exact(
    "apps/overwolf-client/src/live-build-desktop-table-ui.ts",
    "  meta.textContent = 'Early / Mid / Late';\n",
    "  meta.textContent = 'Synthetic 90-second rollout steps';\n",
)
replace_exact(
    "apps/overwolf-client/src/live-build-recommendation-poller.ts",
    "  traversalKey?: string;\n  isStale: boolean;\n",
    "  traversalKey?: string;\n  decisionId?: string;\n  isStale: boolean;\n",
)

replace_all(
    "apps/overwolf-client/package.json",
    '"version": "0.1.12"',
    '"version": "0.1.13"',
)
replace_all(
    "apps/overwolf-client/public/manifest.json",
    '"version": "0.1.12"',
    '"version": "0.1.13"',
)
replace_exact(
    "apps/overwolf-client/src/desktop-version.ts",
    "const APP_VERSION = '0.1.12';\nconst APP_BUILD = '022';",
    "const APP_VERSION = '0.1.13';\nconst APP_BUILD = '023';",
)

# Add traversal integration coverage without making telemetry mandatory in unit harnesses.
traversal_test = "apps/api/test/live-build-recommendation-traversal.spec.ts"
replace_exact(
    traversal_test,
    "  it('waits without invoking the recommender when no local player is available', async () => {",
    r'''  it('links a served decision to the next observed inventory action', async () => {
    const telemetry = {
      recordDecision: jest.fn(() => 'decision-1'),
      recordObservedAction: jest.fn(),
      recordDecisionSuperseded: jest.fn(),
      recordModelError: jest.fn(),
    };
    const harness = createHarness(createRecommendMock(), telemetry);

    harness.service.observeState(createState(10, [100]));
    await harness.service.waitForIdle('match-1');
    harness.service.observeState(createState(20, [100, 999]));

    expect(telemetry.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          matchId: 'match-1',
          steamId: 'local',
          teamId: 1,
        }),
      }),
    );
    expect(telemetry.recordObservedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionId: 'decision-1',
        observedActionKeys: ['BUY:999'],
        reconstructionConfidence: 'EXACT_SINGLE_ACTION',
      }),
    );
    await harness.service.waitForIdle('match-1');
  });

  it('waits without invoking the recommender when no local player is available', async () => {''',
)
replace_exact(
    traversal_test,
    "function createHarness(recommend = createRecommendMock()) {",
    "function createHarness(\n"
    "  recommend = createRecommendMock(),\n"
    "  telemetry?: {\n"
    "    recordDecision: jest.Mock;\n"
    "    recordObservedAction: jest.Mock;\n"
    "    recordDecisionSuperseded: jest.Mock;\n"
    "    recordModelError: jest.Mock;\n"
    "  },\n"
    ") {",
)
replace_exact(
    traversal_test,
    "    { getComponentItemIds: jest.fn(() => []) } as never,\n  );",
    "    { getComponentItemIds: jest.fn(() => []) } as never,\n"
    "    telemetry as never,\n"
    "  );",
)
replace_exact(
    traversal_test,
    "    expect(input.itemIds).toEqual([100, 200, 200]);\n",
    "    expect(input.teamId).toBe(1);\n"
    "    expect(input.itemIds).toEqual([100, 200, 200]);\n",
)

# Remove temporary patch machinery from the resulting commit.
(ROOT / "scripts/apply-recommendation-telemetry.py").unlink(missing_ok=True)
(ROOT / ".github/workflows/apply-recommendation-telemetry.yml").unlink(missing_ok=True)
