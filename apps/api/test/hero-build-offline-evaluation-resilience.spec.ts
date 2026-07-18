import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { CanonicalBuildSequenceService } from '../src/deadlock-live/canonical-build-sequence.service';
import { MatchPlayerItem } from '../src/deadlock-live/entities/match-player-item.entity';
import { MatchPlayer } from '../src/deadlock-live/entities/match-player.entity';
import { Match } from '../src/deadlock-live/entities/match.entity';
import { HERO_BUILD_OFFLINE_EVALUATION_MODEL_VERSION } from '../src/deadlock-live/hero-build-offline-evaluation.model';
import {
  HERO_BUILD_OFFLINE_EVALUATION_CHECKPOINT_SCHEMA_VERSION,
  HeroBuildOfflineEvaluationResilientService,
  isTransientDatabaseError,
} from '../src/deadlock-live/hero-build-offline-evaluation-resilient.service';
import { InventoryTimelineReplayService } from '../src/deadlock-live/inventory-timeline-replay.service';
import { MatchTimelineNormalizationService } from '../src/deadlock-live/match-timeline-normalization.service';
import { RecipeAwareTimelineReconciliationService } from '../src/deadlock-live/recipe-aware-timeline-reconciliation.service';

describe('resilient offline build evaluation', () => {
  it('recognizes transient PostgreSQL failures', () => {
    expect(
      isTransientDatabaseError(
        new Error('Connection terminated unexpectedly'),
      ),
    ).toBe(true);
    expect(isTransientDatabaseError({ code: '57P01' })).toBe(true);
    expect(isTransientDatabaseError(new Error('invalid column'))).toBe(false);
  });

  it('automatically resumes a durable checkpoint and persists the report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deadlock-evaluation-'));
    const previousStorageDirectory =
      process.env.DEADLOCK_BUILD_EVALUATION_STORAGE_DIR;
    const previousAutoResume = process.env.DEADLOCK_BUILD_EVALUATION_AUTO_RESUME;
    process.env.DEADLOCK_BUILD_EVALUATION_STORAGE_DIR = directory;
    process.env.DEADLOCK_BUILD_EVALUATION_AUTO_RESUME = 'true';

    try {
      const checkpointPath = join(directory, 'checkpoint.json');
      const reportPath = join(directory, 'report.json');
      await writeFile(
        checkpointPath,
        JSON.stringify(createCompletedHeroCheckpoint()),
        'utf8',
      );

      const recipeService = {
        refreshRecipes: jest.fn(async () => 0),
        getComponentItemIds: jest.fn(() => []),
      } as unknown as RecipeAwareTimelineReconciliationService;
      const service = new HeroBuildOfflineEvaluationResilientService(
        {} as Repository<Match>,
        {} as Repository<MatchPlayer>,
        {} as Repository<MatchPlayerItem>,
        {} as MatchTimelineNormalizationService,
        {} as InventoryTimelineReplayService,
        {} as CanonicalBuildSequenceService,
        recipeService,
      );

      await service.onModuleInit();
      await waitForEvaluation(service);

      const status = service.getStatus();
      expect(status.state).toBe('COMPLETE');
      expect(status.reportAvailable).toBe(true);
      expect(status.resumedFromCheckpoint).toBe(true);
      expect(status.processedHeroCount).toBe(1);
      expect(service.getReport()?.split.selectedMatchCount).toBe(2);
      expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({
        modelVersion: HERO_BUILD_OFFLINE_EVALUATION_MODEL_VERSION,
      });
      await expect(access(checkpointPath)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      restoreEnvironmentValue(
        'DEADLOCK_BUILD_EVALUATION_STORAGE_DIR',
        previousStorageDirectory,
      );
      restoreEnvironmentValue(
        'DEADLOCK_BUILD_EVALUATION_AUTO_RESUME',
        previousAutoResume,
      );
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function createCompletedHeroCheckpoint() {
  const comparison = createEmptyComparison();
  return {
    schemaVersion: HERO_BUILD_OFFLINE_EVALUATION_CHECKPOINT_SCHEMA_VERSION,
    modelVersion: HERO_BUILD_OFFLINE_EVALUATION_MODEL_VERSION,
    savedAt: '2026-07-17T04:00:00.000Z',
    startedAt: '2026-07-17T03:00:00.000Z',
    options: {
      trainFraction: 0.5,
      maxMatches: 2,
      errorExampleLimit: 10,
    },
    split: {
      selected: [
        { matchId: 1, startTime: '2026-07-01T00:00:00.000Z' },
        { matchId: 2, startTime: '2026-07-02T00:00:00.000Z' },
      ],
      train: [{ matchId: 1, startTime: '2026-07-01T00:00:00.000Z' }],
      test: [{ matchId: 2, startTime: '2026-07-02T00:00:00.000Z' }],
    },
    heroIds: [72],
    nextHeroIndex: 1,
    training: {
      sourcePlayerCount: 0,
      includedPlayerCount: 0,
      excludedPlayerCount: 0,
      heroCount: 0,
      stateCount: 0,
      transitionCount: 0,
      actionOptionCount: 0,
      matchupHeroCount: 0,
      matchupStateCount: 0,
      matchupActionCount: 0,
      matchupObservationCount: 0,
    },
    sourceTestPlayerCount: 0,
    evaluatedPlayerCount: 0,
    excludedTestPlayerCount: 0,
    evaluatedStepCount: 0,
    overall: comparison,
    byHero: [{ heroId: 72, comparison }],
    byPhase: ['EARLY', 'MID', 'LATE'].map((phase) => ({
      phase,
      comparison,
    })),
    byHeroPhase: [],
    byOutcome: ['WIN', 'LOSS'].map((outcome) => ({
      outcome,
      comparison,
    })),
    errorExamples: [],
    peakRssMb: 100,
  };
}

function createEmptyComparison() {
  const metrics = {
    sampleCount: 0,
    coveredCount: 0,
    coverage: 0,
    coveragePercent: 0,
    top1Count: 0,
    top1Accuracy: 0,
    top1AccuracyPercent: 0,
    top1AccuracyWhenCovered: 0,
    top1AccuracyWhenCoveredPercent: 0,
    top3Count: 0,
    top3Accuracy: 0,
    top3AccuracyPercent: 0,
    top3AccuracyWhenCovered: 0,
    top3AccuracyWhenCoveredPercent: 0,
    exactModeCount: 0,
    backoffModeCount: 0,
    noMatchCount: 0,
  };
  return {
    baseline: { ...metrics },
    contextual: { ...metrics },
    coverageDeltaPercentagePoints: 0,
    top1DeltaPercentagePoints: 0,
    top3DeltaPercentagePoints: 0,
    changedTop1Count: 0,
    contextualImprovedCount: 0,
    contextualWorsenedCount: 0,
    bothTop1CorrectCount: 0,
    bothTop1WrongCount: 0,
  };
}

async function waitForEvaluation(
  service: HeroBuildOfflineEvaluationResilientService,
): Promise<void> {
  const deadline = Date.now() + 3_000;

  while (Date.now() < deadline) {
    if (service.getStatus().state !== 'RUNNING') {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(
    `Resilient offline evaluation did not complete in time. Current state: ${service.getStatus().state}`,
  );
}

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
