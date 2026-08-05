import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createRecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationSerializedHeroBuildPolicy,
} from '../src/deadlock-live/recommendation-candidate-generator-snapshot';
import type {
  RecommendationHistoricalCatalogItem,
  RecommendationHistoricalProReplayRow,
} from '../src/deadlock-live/recommendation-historical-pro-replay';
import { RecommendationProDecisionDatasetV6ArtifactService } from '../src/deadlock-live/recommendation-pro-decision-dataset-v6-artifact.service';
import type { RecommendationProDecisionDatasetV6Row } from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';

const REPLAY_ENV = 'DEADLOCK_RECOMMENDATION_DATASET_V6_REPLAY_DIR';
const REGISTRY_ENV =
  'DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_PATH';
const TIMELINE_ENV = 'DEADLOCK_TIMELINE_STORAGE_DIR';
const OUTPUT_ENV = 'DEADLOCK_RECOMMENDATION_DATASET_V6_DIR';

describe('Recommendation Dataset V6 artifact', () => {
  let root: string;
  const previousEnvironment = new Map<string, string | undefined>();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recommendation-dataset-v6-'));
    for (const name of [REPLAY_ENV, REGISTRY_ENV, TIMELINE_ENV, OUTPUT_ENV]) {
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

  it('builds immutable train, tuning, and future-test rows', async () => {
    const replayDirectory = join(root, 'replay');
    const snapshotDirectory = join(root, 'snapshots');
    const timelineDirectory = join(root, 'timeline');
    const outputDirectory = join(root, 'dataset-v6');
    await Promise.all([
      mkdir(replayDirectory, { recursive: true }),
      mkdir(snapshotDirectory, { recursive: true }),
      mkdir(timelineDirectory, { recursive: true }),
    ]);

    const snapshotArtifact = candidateSnapshot();
    const snapshotRaw = `${JSON.stringify(snapshotArtifact, undefined, 2)}\n`;
    await writeFile(
      join(snapshotDirectory, 'snapshot-1.json'),
      snapshotRaw,
      'utf8',
    );
    await writeJson(join(snapshotDirectory, 'registry.json'), {
      schemaVersion: 1,
      registryVersion:
        'RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_1',
      generatedAt: '2026-07-01T00:00:00.000Z',
      snapshots: [
        {
          fileName: 'snapshot-1.json',
          artifactSha256: sha256(snapshotRaw),
          snapshotId: snapshotArtifact.snapshot.snapshotId,
          trainingWindowEnd: snapshotArtifact.snapshot.trainingWindowEnd,
        },
      ],
    });

    const replayRows = [
      replayRow(snapshotArtifact.snapshot, 'decision-train', 101, '2026-07-05T00:00:00.000Z'),
      replayRow(snapshotArtifact.snapshot, 'decision-tuning', 102, '2026-07-15T00:00:00.000Z'),
      replayRow(snapshotArtifact.snapshot, 'decision-test', 103, '2026-07-25T00:00:00.000Z'),
    ];
    const replayDataset = `${replayRows
      .map((row) => JSON.stringify(row))
      .join('\n')}\n`;
    const replaySha256 = sha256(replayDataset);
    await Promise.all([
      writeFile(join(replayDirectory, 'dataset.ndjson'), replayDataset, 'utf8'),
      writeJson(join(replayDirectory, 'manifest.json'), {
        schemaVersion: 1,
        replayVersion: 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_2',
        artifact: {
          fileName: 'dataset.ndjson',
          rowCount: replayRows.length,
          sha256: replaySha256,
        },
        auditPassed: true,
        trainingArtifactEligible: true,
      }),
      writeJson(join(replayDirectory, 'audit.json'), {
        schemaVersion: 1,
        replayVersion: 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_2',
        passed: true,
        trainingArtifactEligible: true,
      }),
    ]);
    for (const matchId of [101, 102, 103]) {
      await writeTimeline(timelineDirectory, matchId);
    }

    process.env[REPLAY_ENV] = replayDirectory;
    process.env[REGISTRY_ENV] = join(snapshotDirectory, 'registry.json');
    process.env[TIMELINE_ENV] = timelineDirectory;
    process.env[OUTPUT_ENV] = outputDirectory;

    const service = new RecommendationProDecisionDatasetV6ArtifactService();
    await service.onModuleInit();
    await service.start({
      tuningStart: '2026-07-10T00:00:00.000Z',
      futureTestStart: '2026-07-20T00:00:00.000Z',
      expectedReplaySha256: replaySha256,
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      outputRowCount: 3,
      timelineJoinedRowCount: 3,
      missingTimelineRowCount: 0,
      auditPassed: true,
      trainingArtifactEligible: true,
    });
    const datasetRows = (await readFile(
      join(outputDirectory, 'dataset.ndjson'),
      'utf8',
    ))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as RecommendationProDecisionDatasetV6Row);
    expect(datasetRows.map((row) => row.split)).toEqual([
      'TRAIN',
      'TUNING',
      'FUTURE_TEST',
    ]);
    expect(datasetRows.every((row) => row.state.timelineJoined)).toBe(true);
    expect(datasetRows[0].candidates[0]).toMatchObject({
      itemId: 1002,
      cost: 1_250,
      requiredComponentCount: 1,
      ownedComponentCount: 1,
      hasCompleteRecipeComponents: true,
    });

    const manifest = service.getManifest();
    expect(manifest).toMatchObject({
      datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
      source: {
        kind: 'HISTORICAL_REPLAY',
        sha256: replaySha256,
      },
      featureContract: {
        currentGoldAvailable: false,
        netWorthUsedAsCurrentGold: false,
        userLiveUsedAsInput: false,
        futureTestEligibleForSelection: false,
      },
      splitDescriptor: {
        tuningStart: '2026-07-10T00:00:00.000Z',
        futureTestStart: '2026-07-20T00:00:00.000Z',
      },
      auditPassed: true,
      trainingArtifactEligible: true,
    });
    expect(manifest?.splitDescriptor.sha256).toMatch(/^[a-f0-9]{64}$/);

    const audit = service.getAudit();
    expect(audit).toMatchObject({
      passed: true,
      decisionCount: 3,
      matchCount: 3,
      candidateRowCount: 6,
      timelineJoinCoverage: 1,
      candidateMetadataCoverage: 1,
      observedActionInCandidateSetCoverage: 1,
      splitDistribution: {
        TRAIN: 1,
        TUNING: 1,
        FUTURE_TEST: 1,
      },
      trainingArtifactEligible: true,
    });
  });
});

function candidateSnapshot() {
  const items = catalogItems();
  return createRecommendationCandidateGeneratorSnapshotArtifact({
    snapshot: {
      snapshotId: 'snapshot-1',
      generatorVersion: 'HERO_BUILD_CANDIDATE_GENERATOR_V1',
      policyVersion: 'policy-1',
      catalogVersion: 'catalog-1',
      trainingWindowStart: '2026-06-01T00:00:00.000Z',
      trainingWindowEnd: '2026-07-01T00:00:00.000Z',
    },
    generatorOptions: {
      minExactObservations: 3,
      maxBackoffDistance: 4,
      maxBackoffStates: 64,
      limit: 100,
    },
    policies: [policy()],
    catalog: {
      version: 'catalog-1',
      items,
    },
  });
}

function policy(): RecommendationSerializedHeroBuildPolicy {
  return {
    heroId: 1,
    playerCount: 50,
    stateCount: 1,
    transitionCount: 20,
    states: [
      {
        stateKey: '1001x1',
        observationCount: 20,
        nextActionCount: 2,
        nextActions: [
          {
            actionType: 'BUY',
            itemId: 1002,
            actionKey: 'BUY:1002',
            count: 12,
            probability: 0.6,
            averageGameTimeS: 320,
            afterStates: [
              {
                afterStateKey: '1001x1|1002x1',
                count: 12,
                probability: 1,
              },
            ],
          },
          {
            actionType: 'BUY',
            itemId: 1003,
            actionKey: 'BUY:1003',
            count: 8,
            probability: 0.4,
            averageGameTimeS: 340,
            afterStates: [
              {
                afterStateKey: '1001x1|1003x1',
                count: 8,
                probability: 1,
              },
            ],
          },
        ],
      },
    ],
  };
}

function catalogItems(): RecommendationHistoricalCatalogItem[] {
  return [
    {
      itemId: 1001,
      name: 'Component',
      cost: 500,
      tier: 1,
      slotType: 'WEAPON',
      itemType: 'UPGRADE',
      isActiveItem: false,
      tags: ['COMPONENT'],
      componentItemIds: [],
    },
    {
      itemId: 1002,
      name: 'Candidate 1002',
      cost: 1_250,
      tier: 2,
      slotType: 'WEAPON',
      itemType: 'UPGRADE',
      isActiveItem: false,
      tags: ['DAMAGE'],
      componentItemIds: [1001],
    },
    {
      itemId: 1003,
      name: 'Candidate 1003',
      cost: 1_250,
      tier: 2,
      slotType: 'VITALITY',
      itemType: 'UPGRADE',
      isActiveItem: true,
      activationType: 'INSTANT',
      tags: ['VITALITY'],
      componentItemIds: [],
    },
  ];
}

function replayRow(
  generatorSnapshot: ReturnType<typeof candidateSnapshot>['snapshot'],
  decisionId: string,
  matchId: number,
  matchStartTime: string,
): RecommendationHistoricalProReplayRow {
  const catalog = new Map(catalogItems().map((item) => [item.itemId, item]));
  return {
    schemaVersion: 1,
    replayVersion: 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_2',
    dataSource: 'PRO_HISTORICAL',
    decisionId,
    matchId: String(matchId),
    matchStartTime,
    playerId: '76561198000000000',
    heroId: 1,
    team: 0,
    decisionGameTimeS: 300,
    phase: 'EARLY',
    state: {
      inventoryBeforeStateKey: '1001x1',
      previousActionKeys: ['BUY:1001'],
      buildPrefixKey: 'BUY:1001',
      alliedHeroIds: [1, 2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
    },
    observedAction: {
      actionType: 'BUY',
      itemId: 1002,
      actionKey: 'BUY:1002',
      inCandidateSet: true,
    },
    candidates: [
      {
        actionKey: 'BUY:1002',
        actionType: 'BUY',
        itemId: 1002,
        rank: 1,
        generatorScore: 0.6,
        historicalCount: 12,
        historicalProbability: 0.6,
        confidence: 0.8,
        predictedStateKey: '1001x1|1002x1',
        catalogMetadataAvailable: true,
        catalog: catalog.get(1002),
      },
      {
        actionKey: 'BUY:1003',
        actionType: 'BUY',
        itemId: 1003,
        rank: 2,
        generatorScore: 0.4,
        historicalCount: 8,
        historicalProbability: 0.4,
        confidence: 0.7,
        predictedStateKey: '1001x1|1003x1',
        catalogMetadataAvailable: true,
        catalog: catalog.get(1003),
      },
    ],
    shortHorizonOutcomes: [
      { horizon: '3m', complete: true, utility: 0.1, snapshotGameTimeS: 480 },
      { horizon: '5m', complete: true, utility: 0.2, snapshotGameTimeS: 600 },
      { horizon: '10m', complete: true, utility: 0.3, snapshotGameTimeS: 900 },
    ],
    finalOutcomeAuxiliary: {
      playerWon: true,
    },
    generatorSnapshot: { ...generatorSnapshot },
    eligibility: {
      stateModel: true,
      behavioralModel: true,
      actionModel: true,
      exclusionReasons: [],
    },
  };
}

async function writeTimeline(root: string, matchId: number): Promise<void> {
  const directory = join(root, String(matchId));
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeJson(join(directory, 'audit.json'), {
      schemaVersion: 1,
      passed: true,
    }),
    writeFile(
      join(directory, 'player-snapshots.ndjson'),
      `${JSON.stringify({
        schemaVersion: 1,
        timelineVersion: 'MATCH_TIMELINE_V1',
        snapshotId: `snapshot-${matchId}`,
        sourceEventId: `event-${matchId}`,
        matchId,
        gameTimeS: 295,
        tick: 17_700,
        steamId: '76561198000000000',
        heroId: 1,
        teamId: 0,
        kills: 2,
        deaths: 1,
        assists: 4,
        netWorth: 5_000,
        heroDamage: 3_500,
        health: 900,
        maxHealth: 1_200,
        level: 8,
        receivedAt: '2026-07-01T00:04:55.000Z',
      })}\n`,
      'utf8',
    ),
  ]);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
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
