import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecommendationDecisionDatasetV4HistoricalBootstrapService } from '../src/deadlock-live/recommendation-decision-dataset-v4-historical-bootstrap.service';

const TRAINING_ENV =
  'DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_TRAINING_DIR';
const CANDIDATE_ENV =
  'DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_CANDIDATE_DIR';
const OUTPUT_ENV =
  'DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_OUTPUT_DIR';

describe('RecommendationDecisionDatasetV4HistoricalBootstrapService', () => {
  const previousEnvironment = {
    training: process.env[TRAINING_ENV],
    candidate: process.env[CANDIDATE_ENV],
    output: process.env[OUTPUT_ENV],
  };
  let rootDirectory = '';

  beforeEach(async () => {
    rootDirectory = await mkdtemp(
      join(tmpdir(), 'recommendation-v4-historical-bootstrap-'),
    );
  });

  afterEach(async () => {
    restoreEnvironment(TRAINING_ENV, previousEnvironment.training);
    restoreEnvironment(CANDIDATE_ENV, previousEnvironment.candidate);
    restoreEnvironment(OUTPUT_ENV, previousEnvironment.output);
    await rm(rootDirectory, { recursive: true, force: true });
  });

  it('materializes held-out validation and candidate rows into an auditable V4 dataset', async () => {
    const fixture = await createFixture(rootDirectory);
    setFixtureEnvironment(fixture);

    const service = new RecommendationDecisionDatasetV4HistoricalBootstrapService();
    await service.onModuleInit();
    expect(service.getStatus().state).toBe('IDLE');

    await service.start({
      expectedValidationSha256: fixture.validationSha256,
      expectedCandidateSha256: fixture.candidateSha256,
    });
    await service.waitForIdle();

    const status = service.getStatus();
    expect(status).toMatchObject({
      state: 'COMPLETE',
      phase: 'COMPLETE',
      sourceValidationRowCount: 3,
      sourceCandidateRowCount: 3,
      processedRowCount: 3,
      rowCount: 3,
      candidateCoveredRowCount: 2,
      matchCount: 2,
      datasetAvailable: true,
      manifestAvailable: true,
      auditAvailable: true,
    });

    const rows = await readNdjson(join(fixture.outputDirectory, 'dataset.ndjson'));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      datasetVersion: 'RECOMMENDATION_DECISION_DATASET_V4_1',
      datasetSourceKind: 'HISTORICAL_V3_HELD_OUT_VALIDATION_BOOTSTRAP',
      decisionId: 'decision-1',
      decisionOccurredAt: '2026-07-21T00:00:10.000Z',
      matchId: '1',
      steamId: '101',
      itemIds: [],
      inventoryStateKey: 'EMPTY',
      timeBucket: 0,
      servedActionKey: 'BUY:100',
      observedLabel: {
        exactActionKey: 'BUY:100',
        reconstructionConfidence: 'EXACT_SINGLE_ACTION',
      },
      outcomeLabel: {
        available: true,
        conflicting: false,
        playerWon: true,
      },
      trainingEligibility: {
        exactAction: true,
        outcome: true,
      },
    });
    expect(rows[1].itemIds).toEqual([100]);
    expect(
      rows[1].candidateActions.map((candidate: { actionKey: string }) =>
        candidate.actionKey,
      ),
    ).toEqual(['BUY:300']);
    expect(
      rows[1].candidateActions.some(
        (candidate: { actionKey: string }) =>
          candidate.actionKey === 'BUY:200',
      ),
    ).toBe(false);
    expect(rows[2].itemIds).toEqual([100, 200]);

    const manifest = service.getManifest();
    const audit = service.getAudit();
    expect(manifest).toMatchObject({
      datasetVersion: 'RECOMMENDATION_DECISION_DATASET_V4_1',
      source: {
        kind: 'HISTORICAL_V3_HELD_OUT_VALIDATION_BOOTSTRAP',
        modelVersion: 'CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_1',
      },
      artifact: {
        rowCount: 3,
      },
      auditPassed: true,
    });
    expect(audit).toMatchObject({
      passed: true,
      rows: {
        rowCount: 3,
        exactActionEligibleCount: 3,
        outcomeEligibleCount: 3,
      },
      candidates: {
        coveredRowCount: 2,
        uncoveredRowCount: 1,
        coverageRate: 2 / 3,
      },
      leakage: {
        sourceSplit: 'HELD_OUT_CONTEXTUAL_V3_VALIDATION',
        sourceModelTrainingRowsUsedAsBootstrapRows: false,
        targetUsedForCandidateConstruction: false,
      },
    });

    const restored = new RecommendationDecisionDatasetV4HistoricalBootstrapService();
    await restored.onModuleInit();
    expect(restored.getStatus()).toMatchObject({
      state: 'COMPLETE',
      rowCount: 3,
      candidateCoveredRowCount: 2,
      matchCount: 2,
    });
  });

  it('fails without replacing artifacts when an expected source hash does not match', async () => {
    const fixture = await createFixture(rootDirectory);
    setFixtureEnvironment(fixture);
    await writeFile(
      join(fixture.outputDirectory, 'manifest.json'),
      JSON.stringify({ generatedAt: '2026-01-01T00:00:00.000Z', artifact: { rowCount: 7 } }),
      'utf8',
    );
    await writeFile(
      join(fixture.outputDirectory, 'audit.json'),
      JSON.stringify({ passed: true, source: {}, candidates: {} }),
      'utf8',
    );

    const service = new RecommendationDecisionDatasetV4HistoricalBootstrapService();
    await service.onModuleInit();
    await service.start({ expectedValidationSha256: 'f'.repeat(64) });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'FAILED',
    });
    expect(service.getStatus().error).toContain('validation SHA-256 mismatch');
    const preservedManifest = JSON.parse(
      await readFile(join(fixture.outputDirectory, 'manifest.json'), 'utf8'),
    ) as { artifact: { rowCount: number } };
    expect(preservedManifest.artifact.rowCount).toBe(7);
  });
});

async function createFixture(root: string) {
  const trainingDirectory = join(root, 'training');
  const candidateDirectory = join(root, 'candidates');
  const outputDirectory = join(root, 'output');
  await Promise.all([
    mkdir(trainingDirectory, { recursive: true }),
    mkdir(candidateDirectory, { recursive: true }),
    mkdir(outputDirectory, { recursive: true }),
  ]);

  const validationRows = [
    createValidationRow({
      decisionId: 'decision-1',
      matchId: 1,
      playerId: 101,
      gameTimeS: 10,
      inventoryStateKey: 'EMPTY',
      actionType: 'BUY',
      itemId: 100,
      actionKey: 'BUY:100',
      playerWon: true,
    }),
    createValidationRow({
      decisionId: 'decision-2',
      matchId: 1,
      playerId: 101,
      gameTimeS: 130,
      inventoryStateKey: '100x1',
      actionType: 'BUY',
      itemId: 200,
      actionKey: 'BUY:200',
      playerWon: true,
    }),
    createValidationRow({
      decisionId: 'decision-3',
      matchId: 2,
      playerId: 202,
      gameTimeS: 250,
      inventoryStateKey: '100x1|200x1',
      actionType: 'UPGRADE',
      itemId: 300,
      actionKey: 'UPGRADE:300',
      playerWon: false,
    }),
  ];
  const candidateRows = [
    createCandidateRow('decision-1', ['BUY:100', 'BUY:200'], 'BUY:100', true),
    createCandidateRow('decision-2', ['BUY:300'], 'BUY:200', false),
    createCandidateRow(
      'decision-3',
      ['UPGRADE:300', 'BUY:400'],
      'UPGRADE:300',
      true,
    ),
  ];
  const validationPath = join(trainingDirectory, 'validation.ndjson');
  const candidatePath = join(candidateDirectory, 'candidate-sets.ndjson');
  await Promise.all([
    writeNdjson(validationPath, validationRows),
    writeNdjson(candidatePath, candidateRows),
  ]);
  const [validationSha256, candidateSha256] = await Promise.all([
    hashFile(validationPath),
    hashFile(candidatePath),
  ]);
  const modelSha256 = 'a'.repeat(64);
  await Promise.all([
    writeJson(join(trainingDirectory, 'manifest.json'), {
      artifacts: {
        validation: {
          fileName: 'validation.ndjson',
          sha256: validationSha256,
          rowCount: validationRows.length,
        },
      },
    }),
    writeJson(join(trainingDirectory, 'audit.json'), { passed: true }),
    writeJson(join(candidateDirectory, 'manifest.json'), {
      evaluationReleaseGatePassed: true,
      source: {
        validationSha256,
        modelVersion: 'CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_1',
        modelSha256,
        sourceDataset: {
          datasetVersion: 'CONTEXTUAL_V3_DECISION_DATASET_1',
          datasetSha256: 'b'.repeat(64),
        },
        split: {
          validationWindowStartTime: '2026-07-21T00:00:00.000Z',
          validationWindowEndTime: '2026-07-22T00:00:00.000Z',
        },
      },
      candidatePolicy: {
        name: 'TRAIN_OBSERVED_GLOBAL_BACKOFF_LEGAL_SHORTLIST',
        candidateLimit: 128,
      },
      artifacts: {
        candidates: {
          fileName: 'candidate-sets.ndjson',
          sha256: candidateSha256,
          rowCount: candidateRows.length,
        },
      },
    }),
    writeJson(join(candidateDirectory, 'audit.json'), { passed: true }),
  ]);

  return {
    trainingDirectory,
    candidateDirectory,
    outputDirectory,
    validationSha256,
    candidateSha256,
  };
}

function createValidationRow(input: {
  decisionId: string;
  matchId: number;
  playerId: number;
  gameTimeS: number;
  inventoryStateKey: string;
  actionType: 'BUY' | 'REBUY' | 'UPGRADE';
  itemId: number;
  actionKey: string;
  playerWon: boolean;
}) {
  return {
    schemaVersion: 1,
    decisionId: input.decisionId,
    matchId: input.matchId,
    matchStartTime: '2026-07-21T00:00:00.000Z',
    playerId: input.playerId,
    features: {
      heroId: 10,
      team: 2,
      gameTimeS: input.gameTimeS,
      phase: 'EARLY',
      inventoryBeforeStateKey: input.inventoryStateKey,
      previousActionKeys: [],
      buildPrefixKey: 'EMPTY',
      alliedHeroIds: [10, 11, 12, 13, 14],
      enemyHeroIds: [20, 21, 22, 23, 24, 25],
      buildArchetypeId: 'hero-10-archetype-1',
    },
    target: {
      actionType: input.actionType,
      itemId: input.itemId,
      actionKey: input.actionKey,
    },
    outcomeLabel: {
      playerWon: input.playerWon,
    },
  };
}

function createCandidateRow(
  decisionId: string,
  candidateActionKeys: string[],
  actualActionKey: string,
  actualActionCovered: boolean,
) {
  return {
    schemaVersion: 1,
    decisionId,
    candidateActionKeys,
    actualActionKey,
    actualActionCovered,
    actualActionObservedInTrain: true,
    actualActionLegal: true,
    actualActionRankBeforeLimit: actualActionCovered ? 0 : 200,
  };
}

function setFixtureEnvironment(fixture: {
  trainingDirectory: string;
  candidateDirectory: string;
  outputDirectory: string;
}) {
  process.env[TRAINING_ENV] = fixture.trainingDirectory;
  process.env[CANDIDATE_ENV] = fixture.candidateDirectory;
  process.env[OUTPUT_ENV] = fixture.outputDirectory;
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function writeNdjson(path: string, rows: unknown[]) {
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

async function readNdjson(path: string): Promise<any[]> {
  const content = await readFile(path, 'utf8');
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
}

async function hashFile(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}
