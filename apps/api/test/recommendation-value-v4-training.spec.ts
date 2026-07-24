import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepareRecommendationValueV4Row,
  RECOMMENDATION_VALUE_V4_MODEL_VERSION,
  RecommendationValueV4TrainingService,
  selectRecommendationValueV4ChronologicalSplit,
} from '../src/deadlock-live/recommendation-value-v4-training.service';
import {
  RECOMMENDATION_DECISION_DATASET_V4_VERSION,
  type RecommendationDecisionDatasetV4Row,
} from '../src/deadlock-live/recommendation-decision-dataset-v4.service';

describe('recommendation value v4 training', () => {
  let sourceDirectory = '';
  let outputDirectory = '';

  beforeEach(async () => {
    sourceDirectory = await mkdtemp(
      join(tmpdir(), 'deadlock-value-v4-source-'),
    );
    outputDirectory = await mkdtemp(
      join(tmpdir(), 'deadlock-value-v4-output-'),
    );
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V4_SOURCE_DIR =
      sourceDirectory;
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR =
      outputDirectory;
  });

  afterEach(async () => {
    delete process.env.DEADLOCK_RECOMMENDATION_VALUE_V4_SOURCE_DIR;
    delete process.env.DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR;
    await Promise.all([
      rm(sourceDirectory, { recursive: true, force: true }),
      rm(outputDirectory, { recursive: true, force: true }),
    ]);
  });

  it('trains on outcome-eligible rows and restores completed artifacts', async () => {
    const rows = createSourceRows();
    const sourceSha256 = await writeSourceArtifacts(rows, sourceDirectory, 10);
    const service = new RecommendationValueV4TrainingService();
    await service.onModuleInit();

    await service.start({
      trainFraction: 0.6,
      priorStrength: 2,
      minContextObservations: 1,
      calibrationBinCount: 5,
      expectedSourceSha256: sourceSha256,
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      phase: 'COMPLETE',
      sourceRowCount: 11,
      eligibleSourceRowCount: 10,
      excludedSourceRowCount: 1,
      sourceMatchCount: 5,
      trainMatchCount: 3,
      validationMatchCount: 2,
      trainRowCount: 6,
      validationRowCount: 4,
      manifestAvailable: true,
      auditAvailable: true,
      evaluationAvailable: true,
      modelAvailable: true,
    });

    const trainRows = await readNdjson(join(outputDirectory, 'train.ndjson'));
    const validationRows = await readNdjson(
      join(outputDirectory, 'validation.ndjson'),
    );
    expect(trainRows).toHaveLength(6);
    expect(validationRows).toHaveLength(4);
    expect(
      [...trainRows, ...validationRows].some(
        (row) => row.decisionId === 'excluded-decision',
      ),
    ).toBe(false);
    expect(new Set(trainRows.map((row) => row.matchId))).toEqual(
      new Set(['match-1', 'match-2', 'match-3']),
    );
    expect(new Set(validationRows.map((row) => row.matchId))).toEqual(
      new Set(['match-4', 'match-5']),
    );

    const model = JSON.parse(
      await readFile(join(outputDirectory, 'model.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(model).toMatchObject({
      modelVersion: RECOMMENDATION_VALUE_V4_MODEL_VERSION,
      modelKind: 'OBSERVATIONAL_WIN_PROBABILITY',
      target: 'PLAYER_WON',
      causalInterpretationAllowed: false,
    });

    const evaluation = JSON.parse(
      await readFile(join(outputDirectory, 'evaluation.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(evaluation).toMatchObject({
      modelVersion: RECOMMENDATION_VALUE_V4_MODEL_VERSION,
      validationDecisionCount: 4,
      validationMatchCount: 2,
      interpretation: {
        causal: false,
      },
      releaseGate: {
        passed: false,
      },
    });

    const audit = JSON.parse(
      await readFile(join(outputDirectory, 'audit.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(audit).toMatchObject({
      passed: true,
      source: {
        actualSha256: sourceSha256,
        sourceRowCount: 11,
        eligibleSourceRowCount: 10,
        excludedSourceRowCount: 1,
        duplicateEligibleDecisionCount: 0,
        conflictingEligibleMatchOutcomeCount: 0,
      },
      leakage: {
        forbiddenFieldsPresent: [],
        causalInterpretationAllowed: false,
      },
    });

    const manifest = JSON.parse(
      await readFile(join(outputDirectory, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      modelVersion: RECOMMENDATION_VALUE_V4_MODEL_VERSION,
      source: {
        artifactSha256: sourceSha256,
        sourceRowCount: 11,
        outcomeEligibleRowCount: 10,
      },
      split: {
        trainMatchCount: 3,
        validationMatchCount: 2,
        trainRowCount: 6,
        validationRowCount: 4,
      },
      training: {
        modelKind: 'OBSERVATIONAL_WIN_PROBABILITY',
        causalInterpretationAllowed: false,
      },
    });

    const restored = new RecommendationValueV4TrainingService();
    await restored.onModuleInit();
    expect(restored.getStatus()).toMatchObject({
      state: 'COMPLETE',
      trainRowCount: 6,
      validationRowCount: 4,
      modelAvailable: true,
    });
  });

  it('fails safely when the expected source hash does not match', async () => {
    await writeSourceArtifacts(createSourceRows(), sourceDirectory, 10);
    const service = new RecommendationValueV4TrainingService();
    await service.onModuleInit();

    await service.start({ expectedSourceSha256: '0'.repeat(64) });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'FAILED',
      error: expect.stringContaining('Source SHA-256 mismatch'),
    });
  });

  it('allows opposite player outcomes within the same eligible match', async () => {
    const rows = createSourceRows();
    rows.push(
      createRow({
        decisionId: 'opponent-decision',
        matchId: 'match-1',
        steamId: 'steam-opponent',
        occurredAt: '2026-01-01T00:04:00.000Z',
        actionKey: 'BUY:3',
        playerWon: false,
      }),
    );
    await writeSourceArtifacts(rows, sourceDirectory, 11);
    const service = new RecommendationValueV4TrainingService();
    await service.onModuleInit();

    await service.start({ trainFraction: 0.6 });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      eligibleSourceRowCount: 11,
      sourceMatchCount: 5,
    });
  });

  it('rejects conflicting outcomes for one player within one eligible match', async () => {
    const rows = createSourceRows();
    rows[1] = {
      ...rows[1],
      outcomeLabel: {
        ...rows[1].outcomeLabel,
        playerWon: !rows[0].outcomeLabel.playerWon,
      },
    };
    await writeSourceArtifacts(rows, sourceDirectory, 10);
    const service = new RecommendationValueV4TrainingService();
    await service.onModuleInit();

    await service.start({ trainFraction: 0.6 });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'FAILED',
      error: expect.stringContaining('conflicting outcomes for one player within a match'),
    });
  });

  it('uses deterministic chronological match-level splitting', () => {
    const split = selectRecommendationValueV4ChronologicalSplit(
      [
        {
          matchId: 'match-c',
          firstDecisionOccurredAt: '2026-01-03T00:00:00.000Z',
        },
        {
          matchId: 'match-a',
          firstDecisionOccurredAt: '2026-01-01T00:00:00.000Z',
        },
        {
          matchId: 'match-b',
          firstDecisionOccurredAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      2 / 3,
    );

    expect(split.train.map((value) => value.matchId)).toEqual([
      'match-a',
      'match-b',
    ]);
    expect(split.validation.map((value) => value.matchId)).toEqual([
      'match-c',
    ]);
  });

  it('prepares action-conditioned features without outcome leakage', () => {
    const prepared = prepareRecommendationValueV4Row(
      createRow({
        decisionId: 'prepare-decision',
        matchId: 'prepare-match',
        occurredAt: '2026-01-01T00:00:00.000Z',
        actionKey: 'BUY:2',
        playerWon: true,
      }),
    );

    expect(prepared.features.actionKey).toBe('BUY:2');
    expect(prepared.target).toEqual({ playerWon: true });
    expect(prepared.features).not.toHaveProperty('playerWon');
    expect(prepared.features).not.toHaveProperty('outcomeLabel');
    expect(prepared.features).not.toHaveProperty('servedActionKey');
    expect(prepared.features).not.toHaveProperty('candidateActions');
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
      generatedAt: '2026-01-10T00:00:00.000Z',
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
      generatedAt: '2026-01-10T00:00:00.000Z',
      passed: true,
      source: {
        eventCount: rows.length * 3,
        decisionEventCount: rows.length,
        observedActionEventCount: outcomeEligibleCount,
        supersededEventCount: 0,
        matchOutcomeEventCount: 5,
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
  for (let matchIndex = 1; matchIndex <= 5; matchIndex += 1) {
    const playerWon = matchIndex % 2 === 1;
    for (let decisionIndex = 1; decisionIndex <= 2; decisionIndex += 1) {
      rows.push(
        createRow({
          decisionId: `decision-${matchIndex}-${decisionIndex}`,
          matchId: `match-${matchIndex}`,
          occurredAt: `2026-01-0${matchIndex}T00:0${decisionIndex}:00.000Z`,
          actionKey: decisionIndex === 1 ? 'BUY:1' : 'BUY:2',
          playerWon,
          inventoryStateKey: decisionIndex === 1 ? 'EMPTY' : '1x1',
          previousActionKeys: decisionIndex === 1 ? [] : ['BUY:1'],
        }),
      );
    }
  }
  rows.push({
    ...createRow({
      decisionId: 'excluded-decision',
      matchId: 'match-5',
      occurredAt: '2026-01-05T00:03:00.000Z',
      actionKey: 'BUY:3',
      playerWon: true,
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
  actionKey: string;
  playerWon: boolean;
  steamId?: string;
  inventoryStateKey?: string;
  previousActionKeys?: string[];
}): RecommendationDecisionDatasetV4Row {
  return {
    schemaVersion: 1,
    datasetVersion: RECOMMENDATION_DECISION_DATASET_V4_VERSION,
    decisionId: input.decisionId,
    decisionOccurredAt: input.occurredAt,
    matchId: input.matchId,
    steamId: input.steamId ?? `steam-${input.matchId}`,
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
    servedActionKey: 'BUY:1',
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
      observedActionKeys: [input.actionKey],
      reconstructionConfidence: 'EXACT_SINGLE_ACTION',
      exactActionKey: input.actionKey,
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

async function readNdjson(
  path: string,
): Promise<Array<{ decisionId: string; matchId: string } & Record<string, unknown>>> {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as { decisionId: string; matchId: string } &
          Record<string, unknown>,
    );
}
