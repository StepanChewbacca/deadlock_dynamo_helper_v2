import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepareRecommendationBehavioralV4Row,
  RECOMMENDATION_BEHAVIORAL_V4_MODEL_VERSION,
  RecommendationBehavioralV4TrainingService,
  selectRecommendationBehavioralV4ChronologicalSplit,
} from '../src/deadlock-live/recommendation-behavioral-v4-training.service';
import {
  RECOMMENDATION_DECISION_DATASET_V4_VERSION,
  type RecommendationDecisionDatasetV4Row,
} from '../src/deadlock-live/recommendation-decision-dataset-v4.service';

describe('recommendation behavioral v4 training', () => {
  let sourceDirectory = '';
  let outputDirectory = '';

  beforeEach(async () => {
    sourceDirectory = await mkdtemp(
      join(tmpdir(), 'deadlock-behavioral-v4-source-'),
    );
    outputDirectory = await mkdtemp(
      join(tmpdir(), 'deadlock-behavioral-v4-output-'),
    );
    process.env.DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_SOURCE_DIR =
      sourceDirectory;
    process.env.DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR =
      outputDirectory;
  });

  afterEach(async () => {
    delete process.env.DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_SOURCE_DIR;
    delete process.env.DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR;
    await Promise.all([
      rm(sourceDirectory, { recursive: true, force: true }),
      rm(outputDirectory, { recursive: true, force: true }),
    ]);
  });

  it('trains only on exact-action eligible rows and restores artifacts', async () => {
    const rows = createSourceRows();
    const sourceSha256 = await writeSourceArtifacts(rows, sourceDirectory);
    const service = new RecommendationBehavioralV4TrainingService();
    await service.onModuleInit();

    await service.start({
      trainFraction: 0.5,
      smoothing: 1,
      minContextObservations: 1,
      maxCandidateActions: 16,
      expectedSourceSha256: sourceSha256,
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      phase: 'COMPLETE',
      sourceRowCount: 9,
      eligibleSourceRowCount: 8,
      excludedSourceRowCount: 1,
      sourceMatchCount: 4,
      trainMatchCount: 2,
      validationMatchCount: 2,
      trainRowCount: 4,
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
    expect(trainRows).toHaveLength(4);
    expect(validationRows).toHaveLength(4);
    expect(
      [...trainRows, ...validationRows].some(
        (row) => row.decisionId === 'excluded-decision',
      ),
    ).toBe(false);
    expect(new Set(trainRows.map((row) => row.matchId))).toEqual(
      new Set(['match-1', 'match-2']),
    );
    expect(new Set(validationRows.map((row) => row.matchId))).toEqual(
      new Set(['match-3', 'match-4']),
    );

    const model = JSON.parse(
      await readFile(join(outputDirectory, 'model.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(model.modelVersion).toBe(RECOMMENDATION_BEHAVIORAL_V4_MODEL_VERSION);
    expect(model.target).toBe('OBSERVED_EXACT_NEXT_ACTION');

    const evaluation = JSON.parse(
      await readFile(join(outputDirectory, 'evaluation.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(evaluation).toMatchObject({
      validationDecisionCount: 4,
      candidateCoveredDecisionCount: 3,
      candidateCoverageRate: 0.75,
    });

    const audit = JSON.parse(
      await readFile(join(outputDirectory, 'audit.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(audit).toMatchObject({
      passed: true,
      source: {
        actualSha256: sourceSha256,
        sourceRowCount: 9,
        eligibleSourceRowCount: 8,
        excludedSourceRowCount: 1,
      },
      leakage: {
        outcomeUsedForBehavioralTraining: false,
        forbiddenFieldsPresent: [],
      },
    });

    const manifest = JSON.parse(
      await readFile(join(outputDirectory, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      modelVersion: RECOMMENDATION_BEHAVIORAL_V4_MODEL_VERSION,
      source: {
        artifactSha256: sourceSha256,
        sourceRowCount: 9,
        exactActionEligibleRowCount: 8,
      },
      split: {
        trainMatchCount: 2,
        validationMatchCount: 2,
        trainRowCount: 4,
        validationRowCount: 4,
      },
    });

    const restored = new RecommendationBehavioralV4TrainingService();
    await restored.onModuleInit();
    expect(restored.getStatus()).toMatchObject({
      state: 'COMPLETE',
      trainRowCount: 4,
      validationRowCount: 4,
      modelAvailable: true,
    });
  });

  it('fails safely when the expected source hash does not match', async () => {
    await writeSourceArtifacts(createSourceRows(), sourceDirectory);
    const service = new RecommendationBehavioralV4TrainingService();
    await service.onModuleInit();

    await service.start({ expectedSourceSha256: '0'.repeat(64) });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'FAILED',
      error: expect.stringContaining('Source SHA-256 mismatch'),
    });
  });

  it('uses deterministic chronological match-level splitting', () => {
    const split = selectRecommendationBehavioralV4ChronologicalSplit(
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

  it('prepares recorded candidates without leaking observed or outcome fields', () => {
    const prepared = prepareRecommendationBehavioralV4Row(
      createRow({
        decisionId: 'prepare-decision',
        matchId: 'prepare-match',
        occurredAt: '2026-01-01T00:00:00.000Z',
        actualActionKey: 'BUY:2',
        candidateActionKeys: ['BUY:1', 'BUY:2', 'BUY:2'],
      }),
      2,
    );

    expect(prepared.features.candidateActionKeys).toEqual([
      'BUY:1',
      'BUY:2',
    ]);
    expect(prepared.target.actionKey).toBe('BUY:2');
    expect(prepared.features).not.toHaveProperty('observedLabel');
    expect(prepared.features).not.toHaveProperty('outcomeLabel');
    expect(prepared.outcomeLabel).toEqual({ playerWon: true });
  });
});

async function writeSourceArtifacts(
  rows: RecommendationDecisionDatasetV4Row[],
  directory: string,
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
        observedActionEventCount: 8,
        supersededEventCount: 0,
        matchOutcomeEventCount: 4,
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
        exactSingleActionCount: 8,
        multiActionIntervalCount: 0,
        ambiguousActionIntervalCount: 0,
        unresolvedActionCount: 0,
        missingObservedActionCount: 1,
        supersededDecisionCount: 0,
        rowsWithOutcomeCount: 8,
        exactActionEligibleCount: 8,
        outcomeEligibleCount: 8,
      },
      exclusionReasonCounts: { MISSING_OBSERVED_ACTION: 1 },
      warnings: [],
    })}\n`,
    'utf8',
  );
  return sourceSha256;
}

function createSourceRows(): RecommendationDecisionDatasetV4Row[] {
  const rows: RecommendationDecisionDatasetV4Row[] = [];
  for (let matchIndex = 1; matchIndex <= 4; matchIndex += 1) {
    for (let decisionIndex = 1; decisionIndex <= 2; decisionIndex += 1) {
      const actualActionKey =
        matchIndex === 4 && decisionIndex === 2
          ? 'BUY:3'
          : decisionIndex === 1
            ? 'BUY:1'
            : 'BUY:2';
      rows.push(
        createRow({
          decisionId: `decision-${matchIndex}-${decisionIndex}`,
          matchId: `match-${matchIndex}`,
          occurredAt: `2026-01-0${matchIndex}T00:0${decisionIndex}:00.000Z`,
          actualActionKey,
          candidateActionKeys: ['BUY:1', 'BUY:2'],
          inventoryStateKey: decisionIndex === 1 ? 'EMPTY' : '1x1',
          previousActionKeys: decisionIndex === 1 ? [] : ['BUY:1'],
        }),
      );
    }
  }
  rows.push({
    ...createRow({
      decisionId: 'excluded-decision',
      matchId: 'match-4',
      occurredAt: '2026-01-04T00:03:00.000Z',
      actualActionKey: 'BUY:2',
      candidateActionKeys: ['BUY:1', 'BUY:2'],
    }),
    observedLabel: { observedActionKeys: [] },
    trainingEligibility: {
      exactAction: false,
      outcome: false,
      actionExclusionReasons: ['MISSING_OBSERVED_ACTION'],
      outcomeExclusionReasons: [
        'MISSING_OBSERVED_ACTION',
        'MISSING_MATCH_OUTCOME',
      ],
    },
  });
  return rows;
}

function createRow(input: {
  decisionId: string;
  matchId: string;
  occurredAt: string;
  actualActionKey: string;
  candidateActionKeys: string[];
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
    servedActionKey: input.candidateActionKeys[0] ?? 'HOLD',
    candidateActions: input.candidateActionKeys.map((actionKey, index) => ({
      actionKey,
      actionType: 'BUY',
      itemId: Number(actionKey.split(':')[1]),
      score: 1 - index * 0.1,
      confidence: 0.7,
      historicalCount: 100 - index,
      historicalProbability: 0.5,
      predictedStateKey: `${index + 1}x1`,
      matchupSignals: [],
    })),
    elapsedMs: 5,
    observedLabel: {
      observedActionKeys: [input.actualActionKey],
      reconstructionConfidence: 'EXACT_SINGLE_ACTION',
      exactActionKey: input.actualActionKey,
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
      playerWon: true,
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

async function readNdjson(path: string): Promise<Record<string, any>[]> {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
}
