import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RecommendationDecisionDatasetV5Service,
  RECOMMENDATION_DECISION_DATASET_V5_VERSION,
} from '../src/deadlock-live/recommendation-decision-dataset-v5.service';
import {
  RECOMMENDATION_DECISION_DATASET_V4_SCHEMA_VERSION,
  RECOMMENDATION_DECISION_DATASET_V4_VERSION,
  type RecommendationDecisionDatasetV4Row,
} from '../src/deadlock-live/recommendation-decision-dataset-v4.service';
import {
  MATCH_TIMELINE_SCHEMA_VERSION,
  MATCH_TIMELINE_VERSION,
  type MatchTimelineObjectiveEvent,
  type MatchTimelinePlayerSnapshot,
} from '../src/deadlock-live/match-timeline-collector.service';

jest.setTimeout(30_000);

describe('Recommendation Dataset V5', () => {
  let sourceDirectory = '';
  let timelineDirectory = '';
  let outputDirectory = '';
  let catalogPath = '';

  beforeEach(async () => {
    sourceDirectory = await mkdtemp(join(tmpdir(), 'deadlock-dataset-v5-source-'));
    timelineDirectory = await mkdtemp(join(tmpdir(), 'deadlock-dataset-v5-timeline-'));
    outputDirectory = await mkdtemp(join(tmpdir(), 'deadlock-dataset-v5-output-'));
    catalogPath = join(outputDirectory, 'catalog.json');
    process.env.DEADLOCK_RECOMMENDATION_DECISION_DATASET_V5_SOURCE_DIR = sourceDirectory;
    process.env.DEADLOCK_TIMELINE_STORAGE_DIR = timelineDirectory;
    process.env.DEADLOCK_RECOMMENDATION_DECISION_DATASET_V5_DIR = outputDirectory;
  });

  afterEach(async () => {
    delete process.env.DEADLOCK_RECOMMENDATION_DECISION_DATASET_V5_SOURCE_DIR;
    delete process.env.DEADLOCK_TIMELINE_STORAGE_DIR;
    delete process.env.DEADLOCK_RECOMMENDATION_DECISION_DATASET_V5_DIR;
    await Promise.all([
      rm(sourceDirectory, { recursive: true, force: true }),
      rm(timelineDirectory, { recursive: true, force: true }),
      rm(outputDirectory, { recursive: true, force: true }),
    ]);
  });

  it('builds leakage-safe trajectory rows and exact bounded outcomes', async () => {
    const rows = createRows();
    const sourceSha256 = await writeSourceArtifacts(rows, sourceDirectory);
    await writeTimelineArtifacts(timelineDirectory);
    await writeFile(
      catalogPath,
      `${JSON.stringify({
        catalogVersionId: 5,
        items: [
          { itemId: 1, name: 'Starter', cost: 500, tier: 1, slotType: 'weapon' },
          { itemId: 2, name: 'Upgrade', cost: 1250, tier: 2, slotType: 'weapon' },
        ],
        recipes: [{ parentItemId: 2, componentItemId: 1 }],
      })}\n`,
      'utf8',
    );
    const service = new RecommendationDecisionDatasetV5Service();
    await service.onModuleInit();

    await service.start({
      expectedSourceSha256: sourceSha256,
      partitionCount: 2,
      catalogSnapshotPath: catalogPath,
      snapshotStalenessS: 60,
      resume: true,
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      phase: 'COMPLETE',
      outputRowCount: 2,
      rowsWithTimelineCount: 2,
      rowsWithComplete3mOutcomeCount: 1,
      manifestAvailable: true,
      auditAvailable: true,
    });
    const outputRows = await readNdjson(join(outputDirectory, 'dataset.ndjson'));
    expect(outputRows).toHaveLength(2);
    const first = outputRows.find((row) => row.decisionId === 'decision-1') as any;
    expect(first.datasetVersion).toBe(RECOMMENDATION_DECISION_DATASET_V5_VERSION);
    expect(first.trajectory.fullPreviousActionKeys).toEqual(['BUY:9', 'SELL:9']);
    expect(first.trajectory.nextObservedActionKey).toBe('BUY:2');
    const second = outputRows.find((row) => row.decisionId === 'decision-2') as any;
    expect(second.trajectory.fullPreviousActionKeys).toEqual([
      'BUY:9',
      'SELL:9',
      'BUY:1',
    ]);
    expect(first.stateBeforeAction.playerTimelineSnapshot).toMatchObject({
      available: true,
      gameTimeS: 95,
      kills: 1,
      deaths: 0,
      netWorth: 1000,
    });
    expect(first.stateBeforeAction.teamEconomy).toMatchObject({
      available: true,
      ownTeamId: 2,
      ownTeam: {
        playerCount: 2,
        netWorth: 2500,
        averageNetWorth: 1250,
        highestNetWorth: 1500,
        lowestNetWorth: 1000,
      },
      enemyTeam: {
        playerCount: 2,
        netWorth: 4500,
        averageNetWorth: 2250,
        highestNetWorth: 2500,
        lowestNetWorth: 2000,
      },
      netWorthDelta: -2000,
      playerNetWorth: 1000,
      playerNetWorthShare: 0.4,
      playerNetWorthRankInTeam: 2,
      completeOwnTeam: true,
      completeEnemyTeam: true,
    });
    expect(first.stateBeforeAction.teamEconomy.relativeNetWorthDelta).toBeCloseTo(
      -2000 / 7000,
    );
    expect(first.shortHorizonOutcomes.windows['3m']).toMatchObject({
      available: true,
      killsDelta: 1,
      deathsDelta: 1,
      assistsDelta: 2,
      netWorthDelta: 1700,
      objectiveEventCount: 1,
      baselineStalenessS: 5,
      targetStalenessS: 5,
      ownObjectiveLossCount: 0,
      enemyObjectiveLossCount: 1,
    });
    expect(first.stateBeforeAction.playerTimelineSnapshot.netWorth).toBe(1000);
    expect(first.stateBeforeAction.playerTimelineSnapshot.netWorth).not.toBe(2700);
    expect(first.itemAndBuildFeatures).toMatchObject({
      available: true,
      catalogVersionId: 5,
      inventory: { totalCost: 0 },
    });

    const audit = service.getAudit() as any;
    expect(audit).toMatchObject({
      passed: true,
      leakage: {
        futureTimelineUsedAsInputFeature: false,
        teamEconomySnapshotsAtOrBeforeDecisionOnly: true,
        horizonWindowLowerBoundExclusive: true,
        horizonWindowUpperBoundInclusive: true,
      },
    });
    const availability = service.getSourceAvailability() as any;
    expect(availability.fields.shortHorizonKdaAndNetWorth.available).toBe(true);
    expect(availability.fields.historicalCompletedMatchShortHorizonBackfill.available).toBe(false);
  });

  it('rejects a stale horizon snapshot instead of treating partial coverage as exact', async () => {
    const rows = [createRows()[0]];
    const sourceSha256 = await writeSourceArtifacts(rows, sourceDirectory);
    await writeTimelineArtifacts(timelineDirectory, [
      createSnapshot(95, 1, 0, 1, 1000),
      createSnapshot(150, 2, 0, 2, 1800),
    ]);
    const service = new RecommendationDecisionDatasetV5Service();
    await service.onModuleInit();
    await service.start({
      expectedSourceSha256: sourceSha256,
      partitionCount: 2,
      snapshotStalenessS: 60,
    });
    await service.waitForIdle();

    const [row] = await readNdjson(join(outputDirectory, 'dataset.ndjson'));
    expect(row.shortHorizonOutcomes.windows['3m']).toMatchObject({
      available: false,
      baselineFresh: true,
      targetAvailable: true,
      targetFresh: false,
      targetStalenessS: 130,
      unavailableReason: 'STALE_SNAPSHOT_AT_HORIZON',
    });
    expect(row.trainingEligibility.shortHorizon3m).toBe(false);
  });

  it('restores a completed build without duplicating rows', async () => {
    const rows = createRows();
    const sourceSha256 = await writeSourceArtifacts(rows, sourceDirectory);
    const service = new RecommendationDecisionDatasetV5Service();
    await service.onModuleInit();
    await service.start({ expectedSourceSha256: sourceSha256, partitionCount: 2, resume: true });
    await service.waitForIdle();
    expect(service.getStatus().state).toBe('COMPLETE');

    const restored = new RecommendationDecisionDatasetV5Service();
    await restored.onModuleInit();
    expect(restored.getStatus()).toMatchObject({ state: 'COMPLETE', outputRowCount: 2 });
    expect(await readNdjson(join(outputDirectory, 'dataset.ndjson'))).toHaveLength(2);
  });
});

function createRows(): RecommendationDecisionDatasetV4Row[] {
  return [
    createRow({ decisionId: 'decision-1', gameTimeS: 100, inventoryStateKey: 'EMPTY', exactActionKey: 'BUY:1', candidateActionKeys: ['BUY:1', 'BUY:2'], previousActionKeys: ['BUY:9', 'SELL:9'] }),
    createRow({ decisionId: 'decision-2', gameTimeS: 220, inventoryStateKey: '1x1', exactActionKey: 'BUY:2', candidateActionKeys: ['BUY:2'] }),
  ];
}

function createRow(input: { decisionId: string; gameTimeS: number; inventoryStateKey: string; exactActionKey: string; candidateActionKeys: string[]; previousActionKeys?: string[] }): RecommendationDecisionDatasetV4Row {
  return {
    schemaVersion: RECOMMENDATION_DECISION_DATASET_V4_SCHEMA_VERSION,
    datasetVersion: RECOMMENDATION_DECISION_DATASET_V4_VERSION,
    decisionId: input.decisionId,
    decisionOccurredAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + input.gameTimeS * 1000).toISOString(),
    matchId: '100',
    steamId: 'player-1',
    heroId: 15,
    teamId: 0,
    itemIds: input.inventoryStateKey === 'EMPTY' ? [] : [1],
    alliedHeroIds: [15, 16],
    enemyHeroIds: [20, 21],
    previousActionKeys: input.previousActionKeys ?? [],
    inventoryStateKey: input.inventoryStateKey,
    gameTimeS: input.gameTimeS,
    timeBucket: Math.floor(input.gameTimeS / 120),
    traversalKey: `test:${input.decisionId}`,
    recommendationModel: 'TEST',
    candidateSetPolicy: 'TEST',
    candidateLimit: 10,
    servedActionKey: input.candidateActionKeys[0],
    candidateActions: input.candidateActionKeys.map((actionKey, index) => ({
      actionKey,
      actionType: 'BUY',
      itemId: Number(actionKey.split(':')[1]),
      score: input.candidateActionKeys.length - index,
      confidence: 1,
      historicalCount: 10,
      historicalProbability: 0.5,
      predictedStateKey: input.inventoryStateKey,
      matchupSignals: [],
    })),
    elapsedMs: 1,
    observedLabel: { observedActionKeys: [input.exactActionKey], reconstructionConfidence: 'EXACT_SINGLE_ACTION', exactActionKey: input.exactActionKey, observedAtGameTimeS: input.gameTimeS, observationDelayS: 0 },
    lifecycle: { superseded: false, supersedeReasons: [], duplicateDecisionCount: 0, observedEventCount: 1 },
    outcomeLabel: { available: true, conflicting: false, playerWon: true, source: 'HISTORICAL_MATCH_PLAYER' },
    trainingEligibility: { exactAction: true, outcome: true, actionExclusionReasons: [], outcomeExclusionReasons: [] },
  };
}

async function writeSourceArtifacts(rows: RecommendationDecisionDatasetV4Row[], directory: string): Promise<string> {
  const content = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const sha256 = createHash('sha256').update(content).digest('hex');
  await writeFile(join(directory, 'dataset.ndjson'), content, 'utf8');
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, datasetVersion: RECOMMENDATION_DECISION_DATASET_V4_VERSION, auditPassed: true, artifact: { fileName: 'dataset.ndjson', sha256, byteLength: Buffer.byteLength(content), rowCount: rows.length } })}\n`, 'utf8');
  await writeFile(join(directory, 'audit.json'), `${JSON.stringify({ passed: true })}\n`, 'utf8');
  return sha256;
}

async function writeTimelineArtifacts(
  root: string,
  snapshots: MatchTimelinePlayerSnapshot[] = [
    createSnapshot(95, 1, 0, 1, 1000),
    createSnapshot(95, 0, 0, 1, 1500, {
      steamId: 'ally-1',
      heroId: 16,
      teamId: 2,
    }),
    createSnapshot(95, 1, 0, 0, 2000, {
      steamId: 'enemy-1',
      heroId: 20,
      teamId: 3,
    }),
    createSnapshot(95, 2, 0, 0, 2500, {
      steamId: 'enemy-2',
      heroId: 21,
      teamId: 3,
    }),
    createSnapshot(275, 2, 1, 3, 2700),
    createSnapshot(395, 3, 1, 4, 3900),
    createSnapshot(695, 4, 2, 5, 7000),
  ],
): Promise<void> {
  const directory = join(root, '100');
  await mkdir(directory, { recursive: true });
  const objective: MatchTimelineObjectiveEvent = {
    schemaVersion: MATCH_TIMELINE_SCHEMA_VERSION,
    timelineVersion: MATCH_TIMELINE_VERSION,
    objectiveEventId: 'o'.repeat(64),
    sourceEventId: 'e'.repeat(64),
    matchId: 100,
    gameTimeS: 250,
    tick: 50,
    eventName: 'destroyable_building_entity_deleted',
    objectiveType: 'destroyable_building',
    entityIndex: 10,
    teamId: 3,
    receivedAt: '2026-01-01T00:04:10.000Z',
  };
  await writeFile(join(directory, 'player-snapshots.ndjson'), `${snapshots.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  await writeFile(join(directory, 'objective-events.ndjson'), `${JSON.stringify(objective)}\n`, 'utf8');
  await writeFile(join(directory, 'events.ndjson'), '{}\n', 'utf8');
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify({ timelineVersion: MATCH_TIMELINE_VERSION, auditPassed: true })}\n`, 'utf8');
  await writeFile(join(directory, 'audit.json'), `${JSON.stringify({ passed: true })}\n`, 'utf8');
}

function createSnapshot(
  gameTimeS: number,
  kills: number,
  deaths: number,
  assists: number,
  netWorth: number,
  overrides: {
    steamId?: string;
    heroId?: number;
    teamId?: number;
  } = {},
): MatchTimelinePlayerSnapshot {
  const steamId = overrides.steamId ?? '7656119';
  const heroId = overrides.heroId ?? 15;
  const teamId = overrides.teamId ?? 2;
  const identity = `${gameTimeS}:${steamId}:${heroId}:${teamId}`;
  return {
    schemaVersion: MATCH_TIMELINE_SCHEMA_VERSION,
    timelineVersion: MATCH_TIMELINE_VERSION,
    snapshotId: createHash('sha256').update(`snapshot:${identity}`).digest('hex'),
    sourceEventId: createHash('sha256').update(`event:${identity}`).digest('hex'),
    matchId: 100,
    gameTimeS,
    tick: gameTimeS,
    steamId,
    heroId,
    teamId,
    kills,
    deaths,
    assists,
    netWorth,
    heroDamage: netWorth * 2,
    receivedAt: new Date(
      Date.parse('2026-01-01T00:00:00.000Z') + gameTimeS * 1000,
    ).toISOString(),
  };
}

async function readNdjson(path: string): Promise<any[]> {
  return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
