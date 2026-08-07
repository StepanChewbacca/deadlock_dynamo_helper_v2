import { Injectable, Logger } from '@nestjs/common';
import {
  RecommendationHistoricalProReplayArtifactService,
  type RecommendationHistoricalProReplayArtifactAudit,
  type RecommendationHistoricalProReplayArtifactManifest,
  type RecommendationHistoricalProReplayStartRequest,
  type RecommendationHistoricalProReplayStatus,
} from './recommendation-historical-pro-replay-artifact.service';
import { RecommendationHistoricalPostgresTimelineCacheService } from './recommendation-historical-postgres-timeline-cache.service';

@Injectable()
export class RecommendationHistoricalProReplayFacadeService {
  private readonly logger = new Logger(
    RecommendationHistoricalProReplayFacadeService.name,
  );
  private preparationStatus?: RecommendationHistoricalProReplayStatus;
  private delegated = false;
  private runPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly timelineCacheService: RecommendationHistoricalPostgresTimelineCacheService,
    private readonly replayService: RecommendationHistoricalProReplayArtifactService,
  ) {}

  async start(
    request: RecommendationHistoricalProReplayStartRequest = {},
  ): Promise<RecommendationHistoricalProReplayStatus> {
    if (
      this.preparationStatus?.state === 'RUNNING' ||
      this.replayService.getStatus().state === 'RUNNING'
    ) {
      throw new Error('Recommendation historical pro replay is already running.');
    }

    const startedAt = new Date().toISOString();
    this.delegated = false;
    this.preparationStatus = {
      ...this.replayService.getStatus(),
      state: 'RUNNING',
      phase: 'PREPARING',
      startedAt,
      completedAt: undefined,
      error: undefined,
      auditPassed: undefined,
    };
    this.runPromise = this.run(request, startedAt);
    return this.getStatus();
  }

  async waitForIdle(): Promise<void> {
    await this.runPromise;
  }

  getStatus(): RecommendationHistoricalProReplayStatus {
    if (this.delegated) {
      return this.replayService.getStatus();
    }
    return this.preparationStatus
      ? clone(this.preparationStatus)
      : this.replayService.getStatus();
  }

  getManifest(): RecommendationHistoricalProReplayArtifactManifest | undefined {
    return this.replayService.getManifest();
  }

  getAudit(): RecommendationHistoricalProReplayArtifactAudit | undefined {
    return this.replayService.getAudit();
  }

  private async run(
    request: RecommendationHistoricalProReplayStartRequest,
    startedAt: string,
  ): Promise<void> {
    try {
      const cache = await this.timelineCacheService.ensureCache((progress) => {
        if (progress.processedMatchCount % 1_000 === 0) {
          this.logger.log(
            `PostgreSQL timeline cache processed ${progress.processedMatchCount} ` +
              `matches and exported ${progress.exportedMatchCount}.`,
          );
        }
      });
      this.logger.log(
        `Historical replay will use ${cache.artifact.matchCount} PostgreSQL ` +
          `timeline-backed matches.`,
      );
      await this.replayService.start(request);
      this.delegated = true;
      await this.replayService.waitForIdle();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.preparationStatus = {
        ...this.replayService.getStatus(),
        state: 'FAILED',
        phase: 'PREPARING',
        startedAt,
        completedAt: new Date().toISOString(),
        error: message,
        auditPassed: false,
      };
      this.delegated = false;
      this.logger.error(
        `Recommendation historical replay preparation failed: ${message}`,
      );
    }
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
