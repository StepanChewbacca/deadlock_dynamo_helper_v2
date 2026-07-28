import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationProDecisionDatasetV6Row,
} from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';
import { RecommendationV6ShortOnlyBaselineExportService } from '../src/deadlock-live/recommendation-v6-short-only-dataset-v6-baseline.service';

const DATASET_ENV = 'DEADLOCK_RECOMMENDATION_V6_BASELINE_DATASET_DIR';
const MODEL_ENV = 'DEADLOCK_RECOMMENDATION_V6_BASELINE_MODEL_PATH';
const OUTPUT_ENV = 'DEADLOCK_RECOMMENDATION_V6_BASELINE_DIR';
const SPLIT_SHA = 'c'.repeat(64);

describe('Frozen V6 short-only Dataset V6 baseline export', () => {
  let root: string;
  const previousEnvironment = new Map<string, string | undefined>();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recommendation-v6-baseline-'));
    for (const name of [DATASET_ENV, MODEL_ENV, OUTPUT_ENV]) {
      previousEnvironment.set(name, process.env[name]);
    }
  });

  afterEach(async () => {
    for (const [name, value] of previousEnvironment) {
      restoreEnvironment(name, value);
    }
    previousEnvironment.clear();
    await rm(root, { recursive: true, force: true });
  });

  it('exports TUNING and FUTURE_TEST predictions without training', async () => {
    const datasetDirectory = join(root, 'dataset');
    const modelDirectory = join(root, 'model');
    const outputDirectory = join(root, 'output');
    await Promise.all([
      mkdir(datasetDirectory, { recursive: true }),
      mkdir(modelDirectory, { recursive: true }),
    ]);

    const rows = [row('TUNING'), row('FUTURE_TEST')];
    const datasetRaw = `${rows.map((value) => JSON.stringify(value)).join('\n')}\n`;
    const datasetSha256 = sha256(datasetRaw);
    await Promise.all([
      writeFile(join(datasetDirectory, 'dataset.ndjson'), datasetRaw, 'utf8'),
      writeJson(join(datasetDirectory, 'manifest.json'), {
        schemaVersion: 1,
        datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_1',
        artifact: {
          fileName: 'dataset.ndjson',
          sha256: datasetSha256,
          rowCount: rows.length,
        },
        splitDescriptor: { sha256: SPLIT_SHA },
        build: { fullCorpus: true },
        featureContract: {
          futureTestEligibleForSelection: false,
          userLiveUsedAsInput: false,
        },
        auditPassed: true,
        trainingArtifactEligible: true,
      }),
      writeJson(join(datasetDirectory, 'audit.json'), {
        passed: true,
        trainingArtifactEligible: true,
        build: { fullCorpus: true },
      }),
    ]);

    const modelPath = join(modelDirectory, 'model.json');
    await writeJson(modelPath, {
      schemaVersion: 1,
      modelVersion: 'RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1',
      generatedAt: '2026-07-28T00:00:00.000Z',
      modelKind: 'OBSERVATIONAL_STATE_ACTION_ADVANTAGE',
      target: 'SHORT_HORIZON_UTILITY_WITH_FINAL_OUTCOME_AUXILIARY',
      weighting: 'EQUAL_TOTAL_WEIGHT_PER_MATCH',
      combination: 'STATE_VALUE_PLUS_TUNED_ACTION_ADVANTAGE',
      actionResidualScale: 1,
      options: {
        statePriorStrength: 10,
        actionPriorStrength: 0.1,
        minimumObservations: 10,
        maximumAbsoluteStateResidual: 1,
        maximumAbsoluteActionResidual: 1,
      },
      targetComposition: {
        finalOutcomeWeight: 0,
        shortHorizonWeight: 1,
        horizons: ['3m', '5m', '10m'],
      },
      counts: {
        version: 'RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1',
        global: count(0.2, 100),
        state: {},
        action: {},
      },
    });

    process.env[DATASET_ENV] = datasetDirectory;
    process.env[MODEL_ENV] = modelPath;
    process.env[OUTPUT_ENV] = outputDirectory;

    const service = new RecommendationV6ShortOnlyBaselineExportService();
    await service.onModuleInit();
    await service.start({ expectedDatasetSha256: datasetSha256 });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      sourceRowCount: 2,
      tuningRowCount: 1,
      futureTestRowCount: 1,
      manifestAvailable: true,
      auditAvailable: true,
    });
    expect(service.getAudit()).toMatchObject({
      passed: true,
      frozen: true,
      trainingPerformed: false,
      output: {
        rowCount: 2,
        tuningRowCount: 1,
        futureTestRowCount: 1,
      },
      adapter: {
        exactSerializedModelCounts: true,
        exactCandidateSet: true,
        exactDecisionAndSplitLineage: true,
      },
    });
    expect(service.getManifest()).toMatchObject({
      productionCommit: '251660f',
      sourceDataset: {
        sha256: datasetSha256,
        splitDescriptorSha256: SPLIT_SHA,
      },
      artifact: { rowCount: 2 },
      auditPassed: true,
      frozen: true,
    });

    const predictions = (await readFile(
      join(outputDirectory, 'predictions.ndjson'),
      'utf8',
    ))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(predictions.map((value) => value.split)).toEqual([
      'TUNING',
      'FUTURE_TEST',
    ]);
    expect(
      predictions.every(
        (value) =>
          Array.isArray(value.candidateRanking) &&
          value.candidateRanking.length === 2,
      ),
    ).toBe(true);
  });
});

function row(
  split: 'TUNING' | 'FUTURE_TEST',
): RecommendationProDecisionDatasetV6Row {
  return {
    schemaVersion: 1,
    datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_1',
    dataSource: 'PRO_HISTORICAL',
    decisionSource: 'HISTORICAL_REPLAY',
    decisionId: `decision-${split}`,
    matchId: `match-${split}`,
    matchStartTime: '2026-07-01T00:00:00.000Z',
    playerId: '1',
    split,
    state: {
      heroId: 1,
      team: 0,
      phase: 'EARLY',
      gameTimeS: 600,
      inventoryStateKey: '50x1',
      inventoryItemCounts: [{ itemId: 50, count: 1 }],
      previousActionKeys: ['BUY:50'],
      alliedHeroIds: [1, 2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
      inventoryTagCounts: { WEAPON: 1 },
      timelineJoined: true,
      timelineSnapshotLagS: 1,
      kills: 2,
      deaths: 1,
      assists: 3,
      netWorth: 8_000,
      heroDamage: 4_000,
      health: 900,
      maxHealth: 1_000,
      level: 8,
    },
    candidates: [
      candidate('BUY:100', 100, 3, 3_000),
      candidate('BUY:200', 200, 1, 500),
    ],
    observedActionKey: 'BUY:100',
    observedActionInCandidateSet: true,
    shortHorizonOutcomes: {
      threeMinutes: 0.5,
      fiveMinutes: 0.5,
      tenMinutes: 0.5,
    },
    finalOutcome: 1,
    versions: {
      catalog: 'catalog-1',
      catalogSha256: 'd'.repeat(64),
      candidateGenerator: 'generator-1',
      candidateGeneratorPolicy: 'policy-1',
      candidateGeneratorPolicySha256: 'e'.repeat(64),
      stateFeatures: 'RECOMMENDATION_STATE_FEATURES_V6_1',
      replay: 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_1',
    },
    eligibility: {
      stateModel: true,
      behavioralModel: true,
      actionModel: true,
      exclusionReasons: [],
    },
  };
}

function candidate(
  actionKey: string,
  itemId: number,
  tier: number,
  cost: number,
): RecommendationDatasetV6CandidateFeatures {
  return {
    actionKey,
    actionType: 'BUY',
    itemId,
    rank: itemId === 100 ? 1 : 2,
    generatorScore: itemId === 100 ? 0.6 : 0.4,
    historicalCount: 100,
    historicalProbability: 0.5,
    confidence: 0.8,
    predictedStateKey: `50x1|${itemId}x1`,
    catalogMetadataAvailable: true,
    cost,
    tier,
    slotType: 'WEAPON',
    itemType: 'UPGRADE',
    isActiveItem: false,
    activationType: 'PASSIVE',
    tags: itemId === 100 ? ['DAMAGE'] : ['UTILITY'],
    componentItemIds: [50, 51],
    requiredComponentCount: 2,
    ownedComponentCount: itemId === 100 ? 2 : 0,
    missingComponentCount: itemId === 100 ? 0 : 2,
    hasAnyOwnedComponent: itemId === 100,
    hasCompleteRecipeComponents: itemId === 100,
    alreadyOwnedCount: 0,
    sameSlotOwnedItemCount: 1,
    inventoryTagOverlapCount: 1,
    previousActionCount: 0,
    currentNetWorth: 8_000,
    costToNetWorthRatio: cost / 8_000,
  };
}

function count(mean: number, observations: number) {
  return {
    utilitySum: mean * observations,
    utilitySquaredSum: mean * mean * observations,
    winWeight: observations / 2,
    totalWeight: observations,
    observations,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
