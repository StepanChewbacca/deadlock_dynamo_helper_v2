import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RECOMMENDATION_DECISION_DATASET_V5_VERSION } from '../src/deadlock-live/recommendation-decision-dataset-v5.service';
import { RECOMMENDATION_VALUE_V6_MODEL_VERSION } from '../src/deadlock-live/recommendation-value-v6-model';
import { RecommendationValueV6TrainingService } from '../src/deadlock-live/recommendation-value-v6-training.service';

jest.setTimeout(30_000);

describe('Recommendation Value V6 training', () => {
  let sourceDirectory = '';
  let outputDirectory = '';

  beforeEach(async () => {
    sourceDirectory = await mkdtemp(join(tmpdir(), 'deadlock-value-v6-source-'));
    outputDirectory = await mkdtemp(join(tmpdir(), 'deadlock-value-v6-output-'));
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_SOURCE_DIR = sourceDirectory;
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_TRAINING_DIR = outputDirectory;
  });

  afterEach(async () => {
    delete process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_SOURCE_DIR;
    delete process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_TRAINING_DIR;
    await Promise.all([
      rm(sourceDirectory, { recursive: true, force: true }),
      rm(outputDirectory, { recursive: true, force: true }),
    ]);
  });

  it('trains, tunes, evaluates, and persists an offline-only advantage model', async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      datasetRow(index + 1, index % 2 === 0 ? 'BUY:1' : 'BUY:2'),
    );
    const sourceSha256 = await writeSource(rows, sourceDirectory);
    const service = new RecommendationValueV6TrainingService();
    await service.onModuleInit();

    await service.start({
      expectedSourceSha256: sourceSha256,
      minimumObservations: 1,
      statePriorStrength: 1,
      actionPriorStrength: 1,
      actionResidualScales: [0, 1, 2],
      bootstrapSamples: 100,
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      phase: 'COMPLETE',
      sourceRowCount: 12,
      eligibleSourceRowCount: 12,
      sourceMatchCount: 12,
      modelAvailable: true,
      evaluationAvailable: true,
      auditAvailable: true,
      manifestAvailable: true,
    });
    expect(service.getAudit()).toMatchObject({
      passed: true,
      split: {
        overlapCount: 0,
        equalTotalWeightPerMatch: true,
      },
      causalSafety: {
        productionRolloutAllowed: false,
        freshChronologicalHoldoutRequired: true,
      },
    });
    expect(service.getEvaluation()).toMatchObject({
      modelVersion: RECOMMENDATION_VALUE_V6_MODEL_VERSION,
      releaseGate: { productionRolloutAllowed: false },
      test: {
        bootstrap: { sampleCount: 100 },
      },
    });
    expect(service.getModel()).toMatchObject({
      modelVersion: RECOMMENDATION_VALUE_V6_MODEL_VERSION,
    });
    const predictionLines = (await readFile(
      join(outputDirectory, 'prediction-evaluation.ndjson'),
      'utf8',
    ))
      .trim()
      .split('\n');
    expect(predictionLines.length).toBeGreaterThan(0);
  });
});

function datasetRow(matchNumber: number, actionKey: string): Record<string, unknown> {
  const won = actionKey === 'BUY:1';
  const itemId = Number(actionKey.split(':')[1]);
  const candidates = [1, 2].map((candidateItemId) => ({
    actionKey: `BUY:${candidateItemId}`,
    actionType: 'BUY',
    itemId: candidateItemId,
  }));
  const catalogCandidates = [1, 2].map((candidateItemId) => ({
    actionKey: `BUY:${candidateItemId}`,
    actionType: 'BUY',
    item: {
      itemId: candidateItemId,
      cost: candidateItemId * 500,
      tier: candidateItemId,
      slotType: 'weapon',
    },
    interactionKeys: [
      `HERO_ITEM:1:${candidateItemId}`,
      `ENEMY_ITEM:2:${candidateItemId}`,
    ],
  }));
  return {
    schemaVersion: 2,
    datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
    decisionId: `decision-${matchNumber}`,
    identity: {
      matchId: String(matchNumber),
      steamId: `player-${matchNumber}`,
      heroId: 1,
      teamId: 2,
      decisionGameTimeS: 300,
      decisionOccurredAt: new Date(
        Date.parse('2026-01-01T00:00:00.000Z') + matchNumber * 60_000,
      ).toISOString(),
    },
    stateBeforeAction: {
      heroId: 1,
      teamId: 2,
      gameTimeS: 300,
      timeBucket: 2,
      inventoryStateKey: 'EMPTY',
      itemIds: [],
      alliedHeroIds: [1, 3],
      enemyHeroIds: [2, 4],
      candidateActions: candidates,
      playerTimelineSnapshot: {
        available: true,
        fresh: true,
        netWorth: 2000,
        kills: 1,
        deaths: 0,
        assists: 2,
        level: 5,
      },
    },
    observedAction: {
      actionKey,
      actionType: 'BUY',
      itemId,
    },
    trajectory: {
      decisionIndex: 2,
      fullPreviousActionKeys: ['BUY:9', 'SELL:9'],
    },
    itemAndBuildFeatures: {
      available: true,
      inventory: {
        itemCount: 0,
        totalCost: 0,
        highestTier: 0,
        slotCounts: {},
      },
      observedAction: catalogCandidates.find(
        (candidate) => candidate.actionKey === actionKey,
      ),
      candidates: catalogCandidates,
      recipeProgress: [],
      distanceToNextPowerSpikeCost: 1000,
    },
    shortHorizonOutcomes: {
      sourceAvailable: true,
      windows: {
        '3m': {
          available: true,
          survived: won,
          netWorthDelta: won ? 2500 : 500,
          heroDamageDelta: won ? 4000 : 500,
          killParticipationDelta: won ? 2 : 0,
          ownObjectiveLossCount: won ? 0 : 1,
          enemyObjectiveLossCount: won ? 1 : 0,
        },
        '5m': { available: false },
        '10m': { available: false },
      },
    },
    finalOutcome: {
      available: true,
      conflicting: false,
      playerWon: won,
      auxiliaryTargetOnly: true,
    },
    trainingEligibility: {
      exactAction: true,
      finalOutcome: true,
      shortHorizon3m: true,
      shortHorizon5m: false,
      shortHorizon10m: false,
    },
  };
}

async function writeSource(
  rows: Record<string, unknown>[],
  directory: string,
): Promise<string> {
  const content = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const sha256 = createHash('sha256').update(content).digest('hex');
  await writeFile(join(directory, 'dataset.ndjson'), content, 'utf8');
  await writeFile(
    join(directory, 'manifest.json'),
    `${JSON.stringify({
      schemaVersion: 2,
      datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
      auditPassed: true,
      artifact: {
        fileName: 'dataset.ndjson',
        sha256,
        byteLength: Buffer.byteLength(content),
        rowCount: rows.length,
      },
    })}\n`,
    'utf8',
  );
  await writeFile(
    join(directory, 'audit.json'),
    `${JSON.stringify({
      passed: true,
      rows: { rowCount: rows.length },
    })}\n`,
    'utf8',
  );
  return sha256;
}
