import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createRecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationCandidateGeneratorSnapshotRegistry,
  type RecommendationSerializedHeroBuildPolicy,
} from '../src/deadlock-live/recommendation-candidate-generator-snapshot';
import { RecommendationHistoricalProReplayArtifactService } from '../src/deadlock-live/recommendation-historical-pro-replay-artifact.service';
import type { RecommendationHistoricalCatalogItem } from '../src/deadlock-live/recommendation-historical-pro-replay';
import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import type {
  MatchTimelineObjectiveEvent,
  MatchTimelinePlayerSnapshot,
} from '../src/deadlock-live/match-timeline-collector.service';

const ENV_NAMES = [
  'DEADLOCK_RECOMMENDATION_HISTORICAL_PRO_REPLAY_SOURCE_DIR',
  'DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_PATH',
  'DEADLOCK_TIMELINE_STORAGE_DIR',
  'DEADLOCK_RECOMMENDATION_HISTORICAL_PRO_REPLAY_DIR',
] as const;

describe('Recommendation historical pro replay artifact', () => {
  let root: string;
  let previousEnvironment: Partial<Record<(typeof ENV_NAMES)[number], string>>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recommendation-pro-replay-'));
    previousEnvironment = Object.fromEntries(
      ENV_NAMES.flatMap((name) =>
        process.env[name] === undefined ? [] : [[name, process.env[name]]],
      ),
    );
  });

  afterEach(async () => {
    for (const name of ENV_NAMES) {
      const previous = previousEnvironment[name];
      if (previous === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous;
      }
    }
    await rm(root, { recursive: true, force: true });
  });

  it('builds a training-eligible pro-only replay artifact', async () => {
    const sourceDirectory = join(root, 'source');
    const snapshotDirectory = join(root, 'snapshots');
    const timelineDirectory = join(root, 'timeline');
    const outputDirectory = join(root, 'output');
    await Promise.all([
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(snapshotDirectory, { recursive: true }),
      mkdir(timelineDirectory, { recursive: true }),
    ]);

    await writeSourceArtifact(sourceDirectory);
    const registryPath = await writeSnapshotRegistry(snapshotDirectory);
    await writeTimeline(timelineDirectory);

    process.env.DEADLOCK_RECOMMENDATION_HISTORICAL_PRO_REPLAY_SOURCE_DIR =
      sourceDirectory;
    process.env.DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_PATH =
      registryPath;
    process.env.DEADLOCK_TIMELINE_STORAGE_DIR = timelineDirectory;
    process.env.DEADLOCK_RECOMMENDATION_HISTORICAL_PRO_REPLAY_DIR =
      outputDirectory;

    const service = new RecommendationHistoricalProReplayArtifactService();
    await service.onModuleInit();
    await service.start({
      partitionCount: 2,
      resume: false,
      thresholds: {
        minimumTimelineCoverage: 1,
        minimumCandidateMetadataCoverage: 1,
        minimumObservedActionCandidateCoverage: 1,
      },
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      outputRowCount: 1,
      auditPassed: true,
    });
    expect(service.getManifest()).toMatchObject({
      source: {
        kind: 'POSTGRESQL_CONTEXTUAL_V3_SNAPSHOT',
        selectedRowCount: 1,
      },
      featureContract: {
        observedActionInjectedIntoCandidates: false,
        v5_3UsedAsInput: false,
        userLiveUsedAsInput: false,
      },
      trainingArtifactEligible: true,
    });
    expect(service.getAudit()).toMatchObject({
      passed: true,
      rowCount: 1,
      sourceCounts: {
        PRO_HISTORICAL: 1,
        PRO_FUTURE_HOLDOUT: 0,
        USER_LIVE: 0,
      },
      coverage: {
        timelineCoverage: 1,
        candidateMetadataCoverage: 1,
        observedActionCandidateCoverage: 1,
      },
      trainingArtifactEligible: true,
    });

    const dataset = (await readFile(join(outputDirectory, 'dataset.ndjson'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(dataset).toHaveLength(1);
    expect(dataset[0]).toMatchObject({
      dataSource: 'PRO_HISTORICAL',
      decisionId: 'decision-1',
      observedAction: {
        actionKey: 'BUY:1002',
        inCandidateSet: true,
      },
      eligibility: {
        stateModel: true,
        behavioralModel: true,
        actionModel: true,
      },
    });
  });
});

async function writeSourceArtifact(directory: string): Promise<void> {
  const row = sourceDecision();
  const dataset = `${JSON.stringify(row)}\n`;
  const datasetSha256 = sha256(dataset);
  await Promise.all([
    writeFile(join(directory, 'dataset.ndjson'), dataset, 'utf8'),
    writeJson(join(directory, 'manifest.json'), {
      schemaVersion: 1,
      datasetVersion: 'CONTEXTUAL_V3_DECISION_DATASET_1',
      generatedAt: '2026-07-11T00:00:00.000Z',
      artifact: {
        format: 'NDJSON',
        fileName: 'dataset.ndjson',
        byteLength: Buffer.byteLength(dataset),
        sha256: datasetSha256,
        rowCount: 1,
      },
      auditPassed: true,
    }),
    writeJson(join(directory, 'audit.json'), {
      schemaVersion: 1,
      generatedAt: '2026-07-11T00:00:00.000Z',
      passed: true,
    }),
  ]);
}

async function writeSnapshotRegistry(directory: string): Promise<string> {
  const artifact = createRecommendationCandidateGeneratorSnapshotArtifact({
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
      items: [catalogItem(1001), catalogItem(1002), catalogItem(1003)],
    },
  });
  const artifactFileName = 'snapshot-1.json';
  const artifactRaw = `${JSON.stringify(artifact, undefined, 2)}\n`;
  await writeFile(join(directory, artifactFileName), artifactRaw, 'utf8');

  const registry: RecommendationCandidateGeneratorSnapshotRegistry = {
    schemaVersion: 1,
    registryVersion:
      'RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_1',
    generatedAt: '2026-07-11T00:00:00.000Z',
    snapshots: [
      {
        fileName: artifactFileName,
        artifactSha256: sha256(artifactRaw),
        snapshotId: artifact.snapshot.snapshotId,
        trainingWindowEnd: artifact.snapshot.trainingWindowEnd,
      },
    ],
  };
  const registryPath = join(directory, 'registry.json');
  await writeJson(registryPath, registry);
  return registryPath;
}

async function writeTimeline(root: string): Promise<void> {
  const directory = join(root, '100');
  await mkdir(directory, { recursive: true });
  const snapshots = [
    playerSnapshot(295),
    playerSnapshot(470, {
      kills: 2,
      assists: 4,
      netWorth: 6_000,
      heroDamage: 5_500,
    }),
    playerSnapshot(590, {
      kills: 2,
      assists: 5,
      netWorth: 7_000,
      heroDamage: 7_000,
    }),
    playerSnapshot(890, {
      kills: 3,
      deaths: 1,
      assists: 6,
      netWorth: 9_000,
      heroDamage: 10_000,
    }),
  ];
  const objectives = [objectiveEvent(400, 3), objectiveEvent(550, 2)];
  await Promise.all([
    writeNdjson(join(directory, 'player-snapshots.ndjson'), snapshots),
    writeNdjson(join(directory, 'objective-events.ndjson'), objectives),
    writeJson(join(directory, 'manifest.json'), {
      schemaVersion: 1,
      timelineVersion: 'MATCH_TIMELINE_V1',
      matchId: 100,
    }),
    writeJson(join(directory, 'audit.json'), {
      schemaVersion: 1,
      timelineVersion: 'MATCH_TIMELINE_V1',
      matchId: 100,
      passed: true,
    }),
  ]);
}

function sourceDecision(): HeroBuildDecisionDatasetV3Row {
  return {
    schemaVersion: 1,
    decisionId: 'decision-1',
    matchId: 100,
    matchStartTime: '2026-07-10T12:00:00.000Z',
    playerId: 200,
    heroId: 1,
    team: 0,
    gameTimeS: 300,
    phase: 'EARLY',
    inventoryBeforeStateKey: '1001x1',
    inventoryAfterStateKey: '1001x1|1002x1',
    previousActionKeys: ['BUY:1001'],
    buildPrefixKey: 'BUY:1001',
    alliedHeroIds: [1, 2, 3, 4, 5, 6],
    enemyHeroIds: [7, 8, 9, 10, 11, 12],
    actualActionType: 'BUY',
    actualItemId: 1002,
    actualActionKey: 'BUY:1002',
    outcomeLabel: { playerWon: true },
  };
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

function catalogItem(itemId: number): RecommendationHistoricalCatalogItem {
  return {
    itemId,
    name: `Item ${itemId}`,
    cost: 1_250,
    tier: 2,
    slotType: 'WEAPON',
    itemType: 'UPGRADE',
    isActiveItem: false,
    activationType: 'PASSIVE',
    tags: ['DAMAGE'],
    componentItemIds: [],
  };
}

function playerSnapshot(
  gameTimeS: number,
  overrides: Partial<MatchTimelinePlayerSnapshot> = {},
): MatchTimelinePlayerSnapshot {
  return {
    schemaVersion: 1,
    timelineVersion: 'MATCH_TIMELINE_V1',
    snapshotId: `snapshot-${gameTimeS}`,
    sourceEventId: `event-${gameTimeS}`,
    matchId: 100,
    gameTimeS,
    tick: gameTimeS * 60,
    steamId: '200',
    heroId: 1,
    teamId: 2,
    kills: 1,
    deaths: 0,
    assists: 2,
    netWorth: 5_000,
    heroDamage: 3_000,
    receivedAt: '2026-07-10T12:00:00.000Z',
    ...overrides,
  };
}

function objectiveEvent(
  gameTimeS: number,
  teamId: number,
): MatchTimelineObjectiveEvent {
  return {
    schemaVersion: 1,
    timelineVersion: 'MATCH_TIMELINE_V1',
    objectiveEventId: `objective-${gameTimeS}-${teamId}`,
    sourceEventId: `event-${gameTimeS}-${teamId}`,
    matchId: 100,
    gameTimeS,
    tick: gameTimeS * 60,
    eventName: 'entity_removed',
    objectiveType: 'destroyable_building',
    entityIndex: gameTimeS,
    teamId,
    receivedAt: '2026-07-10T12:00:00.000Z',
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
}

async function writeNdjson(path: string, values: readonly unknown[]): Promise<void> {
  await writeFile(path, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`, 'utf8');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
