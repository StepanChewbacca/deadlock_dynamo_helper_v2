import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RecommendationValueV5TrainingService,
  prepareRecommendationValueV5Row,
} from '../src/deadlock-live/recommendation-value-v5-training.service';
import {
  RECOMMENDATION_VALUE_V5_MODEL_VERSION,
} from '../src/deadlock-live/recommendation-value-v5-model';
import {
  RECOMMENDATION_DECISION_DATASET_V4_VERSION,
  type RecommendationDecisionDatasetV4Row,
} from '../src/deadlock-live/recommendation-decision-dataset-v4.service';

jest.setTimeout(30_000);

describe('recommendation value v5 training', () => {
  let sourceDirectory = '';
  let outputDirectory = '';

  beforeEach(async () => {
    sourceDirectory = await mkdtemp(
      join(tmpdir(), 'deadlock-value-v5-source-'),
    );
    outputDirectory = await mkdtemp(
      join(tmpdir(), 'deadlock-value-v5-output-'),
    );
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V5_SOURCE_DIR =
      sourceDirectory;
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V5_TRAINING_DIR =
      outputDirectory;
  });

  afterEach(async () => {
    delete process.env.DEADLOCK_RECOMMENDATION_VALUE_V5_SOURCE_DIR;
    delete process.env.DEADLOCK_RECOMMENDATION_VALUE_V5_TRAINING_DIR;
    await Promise.all([
      rm(sourceDirectory, { recursive: true, force: true }),
      rm(outputDirectory, { recursive: true, force: true }),
    ]);
  });

  it('trains with equal total weight per match and untouched test evaluation', async () => {
    const rows = createSourceRows();
    const sourceSha256 = await writeSourceArtifacts(
      rows,
      sourceDirectory,
      rows.length - 1,
    );
    const service = new RecommendationValueV5TrainingService();
    await service.onModuleInit();

    await service.start({
      trainFraction: 0.6,
      tuningFraction: 0.2,
      statePriorStrength: 0.5,
      actionPriorStrength: 0.5,
      minimumEffectiveObservations: 0.5,
      actionResidualScales: [0, 0.5, 1],
      expectedSourceSha256: sourceSha256,
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      phase: 'COMPLETE',
      sourceRowCount: 31,
      eligibleSourceRowCount: 30,
      excludedSourceRowCount: 1,
      sourceMatchCount: 10,
      trainMatchCount: 6,
      tuningMatchCount: 2,
      testMatchCount: 2,
      trainRowCount: 18,
      tuningRowCount: 6,
      testRowCount: 6,
      manifestAvailable: true,
      auditAvailable: true,
      evaluationAvailable: true,
      modelAvailable: true,
    });

    const model = JSON.parse(
      await readFile(join(outputDirectory, 'model.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(model).toMatchObject({
      modelVersion: RECOMMENDATION_VALUE_V5_MODEL_VERSION,
      modelKind: 'OBSERVATIONAL_WIN_PROBABILITY',
      causalInterpretationAllowed: false,
      weighting: 'EQUAL_TOTAL_WEIGHT_PER_MATCH',
      combination: 'STATE_PLUS_TUNED_ACTION_LOGIT_RESIDUAL',
      actionResidualScale: expect.any(Number),
      counts: {
        version: RECOMMENDATION_VALUE_V5_MODEL_VERSION,
        state: expect.any(Object),
        action: expect.any(Object),
      },
    });

    const evaluation = JSON.parse(
      await readFile(join(outputDirectory, 'evaluation.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(evaluation).toMatchObject({
      modelVersion: RECOMMENDATION_VALUE_V5_MODEL_VERSION,
      split: 'UNTOUCHED_CHRONOLOGICAL_TEST',
      tuning: {
        matchCount: 2,
        decisionCount: 6,
        selection: {
          actionResidualScale: expect.any(Number),
        },
      },
      test: {
        matchCount: 2,
        decisionCount: 6,
        stateOnly: { totalWeight: 2 },
        actionConditioned: { totalWeight: 2 },
      },
      interpretation: { causal: false },
    });

    const audit = JSON.parse(
      await readFile(join(outputDirectory, 'audit.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(audit).toMatchObject({
      passed: true,
      source: {
        actualSha256: sourceSha256,
        sourceRowCount: 31,
        eligibleSourceRowCount: 30,
        excludedSourceRowCount: 1,
        duplicateEligibleDecisionCount: 0,
      },
      split: {
        trainMatchCount: 6,
        tuningMatchCount: 2,
        testMatchCount: 2,
        overlapCount: 0,
      },
      weighting: {
        trainTotalWeight: 6,
        tuningTotalWeight: 2,
        testTotalWeight: 2,
      },
      leakage: {
        outcomeFieldUsedAsFeature: false,
        testUsedForTuning: false,
        actionResidualScaleSelectedOn: 'TUNING_ONLY',
        causalInterpretationAllowed: false,
      },
    });

    const predictions = await readNdjson(
      join(outputDirectory, 'prediction-evaluation.ndjson'),
    );
    expect(predictions).toHaveLength(6);
    expect(
      predictions.reduce(
        (sum, row) => sum + Number(row.matchWeight),
        0,
      ),
    ).toBeCloseTo(2);

    const restored = new RecommendationValueV5TrainingService();
    await restored.onModuleInit();
    expect(restored.getStatus()).toMatchObject({
      state: 'COMPLETE',
      trainMatchCount: 6,
      tuningMatchCount: 2,
      testMatchCount: 2,
      modelAvailable: true,
    });
  });

  it('fails safely when the expected source hash does not match', async () => {
    const rows = createSourceRows();
    await writeSourceArtifacts(rows, sourceDirectory, rows.length - 1);
    const service = new RecommendationValueV5TrainingService();
    await service.onModuleInit();

    await service.start({ expectedSourceSha256: '0'.repeat(64) });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'FAILED',
      error: expect.stringContaining('Source SHA-256 mismatch'),
    });
  });

  it('prepares separate state and action contexts without outcome leakage', () => {
    const row = createRow({
      decisionId: 'prepare-decision',
      matchId: 'prepare-match',
      occurredAt: '2026-01-01T00:00:00.000Z',
      servedActionKey: 'BUY:2',
      playerWon: true,
    });
    const prepared = prepareRecommendationValueV5Row(row);

    expect(prepared.playerWon).toBe(true);
    expect(prepared.stateKeys.some((key) => key.includes('BUY:2'))).toBe(false);
    expect(prepared.actionKeys.every((key) => key.includes('BUY:2'))).toBe(true);
    expect(prepared.stateKeys.some((key) => key.startsWith('HERO_TIME:'))).toBe(
      true,
    );
    expect(prepared).not.toHaveProperty('outcomeLabel');
    expect(prepared).not.toHaveProperty('candidateActions');
  });
});

async function writeSourceArtifacts(
  rows: RecommendationDecisionDatasetV4Row[],
  directory: string,
  outcomeEligibleCount: number,
): Promise<string> {
  const datasetContent = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const sourceSha256 = createHash('sha256')
    .update(datasetContent)
    .digest('hex');
  await writeFile(join(directory, 'dataset.ndjson'), datasetContent, 'utf8');
  await writeFile(
    join(directory, 'manifest.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      datasetVersion: RECOMMENDATION_DECISION_DATASET_V4_VERSION,
      generatedAt: '2026-01-20T00:00:00.000Z',
      source: {
        telemetrySchemaVersion: 1,
        eventLogPath: '/tmp/events.ndjson',
        byteLength: 1,
        sha256: '1'.repeat(64),
        eventCount: rows.length * 3,
      },
      artifact: {
        format: 'NDJSON',
        fileName: 'dataset.ndjson',
        byteLength: Buffer.byteLength(datasetContent, 'utf8'),
        sha256: sourceSha256,
        rowCount: rows.length,
      },
      featureContract: {
        featureCutoff: 'DECISION_SERVED_TIME',
        featureFields: [],
        labelFields: [],
        exactActionEligibility: 'test',
        outcomeEligibility: 'test',
      },
      auditPassed: true,
      warnings: [],
    })}\n`,
    'utf8',
  );
  await writeFile(
    join(directory, 'audit.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      datasetVersion: RECOMMENDATION_DECISION_DATASET_V4_VERSION,
      generatedAt: '2026-01-20T00:00:00.000Z',
      passed: true,
      source: {
        eventCount: rows.length * 3,
        decisionEventCount: rows.length,
        observedActionEventCount: outcomeEligibleCount,
        supersededEventCount: 0,
        matchOutcomeEventCount: 10,
        modelErrorEventCount: 0,
        invalidLineCount: 0,
        duplicateEventIdCount: 0,
      },
      integrity: {
        duplicateDecisionIdCount: 0,
        orphanObservedActionCount: 0,
        orphanSupersededDecisionCount: 0,
        conflictingOutcomeKeyCount: 0,
      },
      rows: {
        rowCount: rows.length,
        exactSingleActionCount: outcomeEligibleCount,
        multiActionIntervalCount: 0,
        ambiguousActionIntervalCount: 0,
        unresolvedActionCount: 0,
        missingObservedActionCount: rows.length - outcomeEligibleCount,
        supersededDecisionCount: 0,
        rowsWithOutcomeCount: outcomeEligibleCount,
        exactActionEligibleCount: outcomeEligibleCount,
        outcomeEligibleCount,
      },
      exclusionReasonCounts: { MISSING_MATCH_OUTCOME: 1 },
      warnings: [],
    })}\n`,
    'utf8',
  );
  return sourceSha256;
}

function createSourceRows(): RecommendationDecisionDatasetV4Row[] {
  const rows: RecommendationDecisionDatasetV4Row[] = [];
  for (let matchIndex = 1; matchIndex <= 10; matchIndex += 1) {
    const playerWon = matchIndex % 2 === 1;
    const servedActionKey = playerWon ? 'BUY:1' : 'BUY:2';
    for (let decisionIndex = 1; decisionIndex <= 3; decisionIndex += 1) {
      rows.push(
        createRow({
          decisionId: `decision-${matchIndex}-${decisionIndex}`,
          matchId: `match-${matchIndex}`,
          occurredAt: `2026-01-${String(matchIndex).padStart(2, '0')}T00:0${decisionIndex}:00.000Z`,
          servedActionKey,
          playerWon,
          inventoryStateKey: decisionIndex === 1 ? 'EMPTY' : '1x1',
          previousActionKeys:
            decisionIndex === 1 ? [] : [servedActionKey],
        }),
      );
    }
  }
  rows.push({
    ...createRow({
      decisionId: 'excluded-decision',
      matchId: 'match-10',
      occurredAt: '2026-01-10T00:05:00.000Z',
      servedActionKey: 'BUY:3',
      playerWon: false,
    }),
    outcomeLabel: {
      available: false,
      conflicting: false,
    },
    trainingEligibility: {
      exactAction: true,
      outcome: false,
      actionExclusionReasons: [],
      outcomeExclusionReasons: ['MISSING_MATCH_OUTCOME'],
    },
  });
  return rows;
}

function createRow(input: {
  decisionId: string;
  matchId: string;
  occurredAt: string;
  servedActionKey: string;
  playerWon: boolean;
  inventoryStateKey?: string;
  previousActionKeys?: string[];
}): RecommendationDecisionDatasetV4Row {
  return {
    schemaVersion: 1,
    datasetVersion: RECOMMENDATION_DECISION_DATASET_V4_VERSION,
    decisionId: input.decisionId,
    decisionOccurredAt: input.occurredAt,
    matchId: input.matchId,
    steamId: `steam-${input.matchId}`,
    heroId: 72,
    teamId: 1,
    itemIds: input.inventoryStateKey === '1x1' ? [1] : [],
    alliedHeroIds: [2, 3, 4, 5, 6],
    enemyHeroIds: [11, 12, 13, 14, 15, 16],
    previousActionKeys: input.previousActionKeys ?? [],
    inventoryStateKey: input.inventoryStateKey ?? 'EMPTY',
    gameTimeS: 120,
    timeBucket: 1,
    traversalKey: `${input.matchId}:${input.decisionId}`,
    recommendationModel: 'CONTEXTUAL_V3',
    modelVersion: 'TEST_MODEL',
    modelSha256: 'a'.repeat(64),
    candidateSetPolicy: 'TEST_POLICY',
    candidateLimit: 16,
    buildArchetypeId: 'TEST_ARCHETYPE',
    servedActionKey: input.servedActionKey,
    candidateActions: ['BUY:1', 'BUY:2', 'BUY:3'].map(
      (actionKey, index) => ({
        actionKey,
        actionType: 'BUY',
        itemId: Number(actionKey.split(':')[1]),
        score: 1 - index * 0.1,
        confidence: 0.7,
        historicalCount: 100 - index,
        historicalProbability: 0.5,
        predictedStateKey: `${index + 1}x1`,
        matchupSignals: [],
      }),
    ),
    elapsedMs: 5,
    observedLabel: {
      observedActionKeys: [input.servedActionKey],
      reconstructionConfidence: 'EXACT_SINGLE_ACTION',
      exactActionKey: input.servedActionKey,
      observedInventoryStateKey: '1x1',
      observedAtGameTimeS: 125,
      observationDelayS: 5,
    },
    lifecycle: {
      superseded: false,
      supersedeReasons: [],
      duplicateDecisionCount: 0,
      observedEventCount: 1,
    },
    outcomeLabel: {
      available: true,
      conflicting: false,
      playerWon: input.playerWon,
      source: 'MANUAL',
    },
    trainingEligibility: {
      exactAction: true,
      outcome: true,
      actionExclusionReasons: [],
      outcomeExclusionReasons: [],
    },
  };
}

async function readNdjson(path: string): Promise<Record<string, unknown>[]> {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
