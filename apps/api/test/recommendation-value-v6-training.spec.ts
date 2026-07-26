import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RECOMMENDATION_DECISION_DATASET_V5_VERSION } from '../src/deadlock-live/recommendation-decision-dataset-v5.service';
import {
  RecommendationValueV6TrainingService,
  prepareRecommendationValueV6Row,
} from '../src/deadlock-live/recommendation-value-v6-training.service';

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

  it('trains, tunes, evaluates, and persists immutable Value V6 artifacts', async () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      datasetRow(index, index % 2 === 0 ? 'BUY:GOOD' : 'BUY:BAD'),
    );
    const sourceSha256 = await writeSource(rows);
    const service = new RecommendationValueV6TrainingService();
    await service.onModuleInit();

    await service.start({
      trainFraction: 0.5,
      tuningFraction: 0.25,
      minimumObservations: 1,
      statePriorStrength: 0,
      actionPriorStrength: 0,
      actionResidualScales: [0, 0.5, 1],
      expectedSourceSha256: sourceSha256,
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      phase: 'COMPLETE',
      sourceRowCount: 8,
      eligibleSourceRowCount: 8,
      trainMatchCount: 4,
      tuningMatchCount: 2,
      testMatchCount: 2,
      manifestAvailable: true,
      auditAvailable: true,
      evaluationAvailable: true,
      modelAvailable: true,
    });
    const audit = service.getAudit() as any;
    expect(audit).toMatchObject({
      passed: true,
      source: {
        datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
        actualSha256: sourceSha256,
        upstreamDatasetV4Sha256: 'a'.repeat(64),
      },
      leakage: {
        shortHorizonOutcomesUsedOnlyAsTargets: true,
        testUsedForTuning: false,
        productionRolloutAuthorized: false,
      },
    });
    const evaluation = service.getEvaluation() as any;
    expect(evaluation.test.metrics.shortHorizonCoverage).toBe(1);
    expect(evaluation.test.ranking.candidateSetCoverage).toBe(1);
    const predictions = await readNdjson(
      join(outputDirectory, 'prediction-evaluation.ndjson'),
    );
    expect(predictions).toHaveLength(2);
    expect(predictions[0].candidateRanking).toHaveLength(2);
    expect(predictions[0].candidateRanking[0]).toHaveProperty('actionAdvantage');

    const restored = new RecommendationValueV6TrainingService();
    await restored.onModuleInit();
    expect(restored.getStatus()).toMatchObject({
      state: 'COMPLETE',
      modelAvailable: true,
    });
  });

  it('adds team-economy state and action interactions', () => {
    const prepared = prepareRecommendationValueV6Row(
      datasetRow(100, 'BUY:GOOD'),
      { finalOutcomeWeight: 0.25 },
    );

    expect(prepared?.stateKeys).toContain('TEAM_ECONOMY_BAND:15|AHEAD');
    expect(prepared?.stateKeys).toContain('PLAYER_TEAM_NET_WORTH_RANK:15|1');
    expect(
      prepared?.candidateActions.find(
        (candidate) => candidate.actionKey === 'BUY:GOOD',
      )?.actionKeys,
    ).toContain('HERO_TEAM_ECONOMY_ACTION:15|AHEAD|BUY:GOOD');
    expect(
      prepared?.candidateActions.find(
        (candidate) => candidate.actionKey === 'BUY:GOOD',
      )?.actionKeys,
    ).toContain('HERO_TEAM_ECONOMY_SLOT:15|AHEAD|vitality');
  });

  async function writeSource(rows: Record<string, unknown>[]): Promise<string> {
    const content = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
    const sha256 = createHash('sha256').update(content).digest('hex');
    await writeFile(join(sourceDirectory, 'dataset.ndjson'), content, 'utf8');
    await writeFile(
      join(sourceDirectory, 'manifest.json'),
      `${JSON.stringify({
        schemaVersion: 3,
        datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
        auditPassed: true,
        source: {
          sha256: 'a'.repeat(64),
        },
        artifact: {
          fileName: 'dataset.ndjson',
          rowCount: rows.length,
          byteLength: Buffer.byteLength(content),
          sha256,
        },
      })}\n`,
      'utf8',
    );
    await writeFile(
      join(sourceDirectory, 'audit.json'),
      `${JSON.stringify({ passed: true })}\n`,
      'utf8',
    );
    return sha256;
  }
});

function datasetRow(index: number, observedActionKey: string): Record<string, unknown> {
  const positive = observedActionKey === 'BUY:GOOD';
  return {
    schemaVersion: 3,
    datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
    decisionId: `decision-${index}`,
    identity: {
      matchId: `match-${index}`,
      heroId: 15,
      teamId: 2,
      decisionGameTimeS: 600,
      decisionOccurredAt: new Date(
        Date.UTC(2026, 6, index + 1),
      ).toISOString(),
    },
    stateBeforeAction: {
      heroId: 15,
      teamId: 2,
      gameTimeS: 600,
      timeBucket: 5,
      inventoryStateKey: '1x1',
      alliedHeroIds: [15, 16],
      enemyHeroIds: [20, 21],
      candidateActions: [
        { actionKey: 'BUY:GOOD' },
        { actionKey: 'BUY:BAD' },
      ],
      playerTimelineSnapshot: {
        available: true,
        kills: 2,
        deaths: 1,
        assists: 3,
        netWorth: 5000,
      },
      teamEconomy: {
        available: true,
        netWorthDelta: positive ? 5000 : -5000,
        relativeNetWorthDelta: positive ? 0.1 : -0.1,
        playerNetWorthShare: 0.25,
        playerNetWorthRankInTeam: positive ? 1 : 4,
      },
    },
    observedAction: { actionKey: observedActionKey },
    trajectory: { fullPreviousActionKeys: ['BUY:1', 'BUY:2'] },
    itemAndBuildFeatures: {
      available: true,
      inventory: { totalCost: 2500, highestTier: 2 },
      observedAction: {
        actionKey: observedActionKey,
        item: {
          slotType: positive ? 'vitality' : 'spirit',
          tier: 2,
          cost: 1250,
          tags: [positive ? 'defensive' : 'offensive'],
        },
        interactionKeys: [`HERO_ITEM:15:${positive ? 1 : 2}`],
      },
      candidates: [
        {
          actionKey: 'BUY:GOOD',
          item: { slotType: 'vitality', tier: 2, cost: 1250, tags: ['defensive'] },
          interactionKeys: ['HERO_ITEM:15:1'],
        },
        {
          actionKey: 'BUY:BAD',
          item: { slotType: 'spirit', tier: 2, cost: 1250, tags: ['offensive'] },
          interactionKeys: ['HERO_ITEM:15:2'],
        },
      ],
    },
    shortHorizonOutcomes: {
      sourceAvailable: true,
      windows: {
        '3m': {
          available: true,
          killsDelta: positive ? 2 : 0,
          deathsDelta: positive ? 0 : 2,
          assistsDelta: positive ? 2 : 0,
          killParticipationDelta: positive ? 4 : 0,
          netWorthDelta: positive ? 1800 : -800,
          heroDamageDelta: positive ? 4000 : 500,
          survived: positive,
          ownObjectiveLossCount: positive ? 0 : 1,
          enemyObjectiveLossCount: positive ? 1 : 0,
        },
        '5m': {
          available: true,
          killsDelta: positive ? 2 : 0,
          deathsDelta: positive ? 0 : 2,
          assistsDelta: positive ? 3 : 0,
          killParticipationDelta: positive ? 5 : 0,
          netWorthDelta: positive ? 2500 : -1000,
          heroDamageDelta: positive ? 6000 : 800,
          survived: positive,
          ownObjectiveLossCount: positive ? 0 : 1,
          enemyObjectiveLossCount: positive ? 1 : 0,
        },
        '10m': { available: false },
      },
    },
    finalOutcome: {
      available: true,
      conflicting: false,
      playerWon: positive,
      auxiliaryTargetOnly: true,
    },
    trainingEligibility: {
      exactAction: true,
      finalOutcome: true,
      shortHorizon3m: true,
      shortHorizon5m: true,
      shortHorizon10m: false,
    },
  };
}

async function readNdjson(path: string): Promise<any[]> {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
