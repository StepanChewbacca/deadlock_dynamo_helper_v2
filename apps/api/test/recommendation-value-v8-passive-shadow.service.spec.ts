import type { MinimalMatchState } from '@deadlock-live-probe/shared';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRecommendationValueV8ActionModel,
  createRecommendationValueV8StateModel,
} from '../src/deadlock-live/recommendation-value-v8-diagnostic';
import {
  recommendationValueV8RuntimeFeatureIndex,
  type RecommendationValueV8RuntimeModelArtifact,
} from '../src/deadlock-live/recommendation-value-v8-passive-shadow';
import {
  RecommendationValueV8PassiveShadowService,
  type RecommendationValueV8PassiveShadowEvent,
} from '../src/deadlock-live/recommendation-value-v8-passive-shadow.service';

const ENV_NAMES = [
  'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_ENABLED',
  'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_KILL_SWITCH',
  'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_ARTIFACT_DIR',
  'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_DIR',
  'DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_EXPECTED_MODEL_SHA256',
] as const;

describe('Recommendation Value V8 passive shadow service', () => {
  let root: string;
  const previousEnvironment = new Map<string, string | undefined>();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recommendation-value-v8-shadow-'));
    for (const name of ENV_NAMES) previousEnvironment.set(name, process.env[name]);
  });

  afterEach(async () => {
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    previousEnvironment.clear();
    await rm(root, { recursive: true, force: true });
  });

  it('writes challenger scores without changing displayed ranking', async () => {
    const artifactDirectory = join(root, 'artifacts');
    const outputDirectory = join(root, 'shadow');
    const telemetryDirectory = join(root, 'telemetry');
    await Promise.all([
      mkdir(artifactDirectory, { recursive: true }),
      mkdir(outputDirectory, { recursive: true }),
      mkdir(telemetryDirectory, { recursive: true }),
    ]);
    const model = modelArtifact();
    const modelRaw = `${JSON.stringify(model, undefined, 2)}\n`;
    const modelSha256 = sha256(modelRaw);
    await Promise.all([
      writeFile(join(artifactDirectory, 'model.json'), modelRaw, 'utf8'),
      writeJson(join(artifactDirectory, 'manifest.json'), {
        schemaVersion: 1,
        evaluationVersion: 'RECOMMENDATION_VALUE_V8_FULL_EVALUATION_1',
        releaseGatePassed: true,
        passiveShadowAuthorized: true,
        randomizedCanaryAuthorized: false,
        selectedConfiguration: model.selectedConfiguration,
        artifacts: { model: { sha256: modelSha256 } },
      }),
      writeJson(join(artifactDirectory, 'audit.json'), {
        schemaVersion: 1,
        evaluationVersion: 'RECOMMENDATION_VALUE_V8_FULL_EVALUATION_1',
        passed: true,
        releaseGatePassed: true,
        passiveShadowAuthorized: true,
        randomizedCanaryAuthorized: false,
        artifacts: { modelSha256 },
      }),
    ]);
    const telemetryPath = join(telemetryDirectory, 'events.ndjson');
    await writeFile(
      telemetryPath,
      `${JSON.stringify(servedDecision())}\n`,
      'utf8',
    );
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_ENABLED = 'true';
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_KILL_SWITCH = 'false';
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_ARTIFACT_DIR =
      artifactDirectory;
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_DIR = outputDirectory;
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_EXPECTED_MODEL_SHA256 =
      modelSha256;

    const telemetry = {
      getStatus: () => ({ eventLogPath: telemetryPath }),
    };
    const catalogVersionRepository = {
      findOne: jest.fn(async () => ({
        id: 1,
        clientVersion: 123,
        contentCatalogVersionId: undefined,
        payloadHash: 'b'.repeat(64),
        isCurrent: true,
        importedAt: new Date('2026-07-28T00:00:00.000Z'),
      })),
    };
    const catalogItemRepository = {
      find: jest.fn(async () => [
        item(50, 'WEAPON', ['WEAPON']),
        item(100, 'WEAPON', ['DAMAGE']),
        item(200, 'SPIRIT', ['UTILITY']),
      ]),
    };
    const catalogRecipeRepository = {
      find: jest.fn(async () => [
        { parentItemId: 100, componentItemId: 50, componentOrder: 0 },
      ]),
    };
    const service = new RecommendationValueV8PassiveShadowService(
      telemetry as never,
      catalogVersionRepository as never,
      catalogItemRepository as never,
      catalogRecipeRepository as never,
    );
    await service.onModuleInit();

    service.schedule({
      decisionId: 'decision-1',
      state: liveState(),
      localPlayer: liveState().playersBySteamId.player,
      previousActionKeys: ['BUY:50'],
      displayedActionKeys: ['BUY:100', 'BUY:200'],
    });
    await service.waitForIdle();

    const events = (await readFile(join(outputDirectory, 'events.ndjson'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as RecommendationValueV8PassiveShadowEvent);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      decisionId: 'decision-1',
      rolloutMode: 'SHADOW',
      displayedActionKeys: ['BUY:100', 'BUY:200'],
      candidateActionKeys: ['BUY:100', 'BUY:200'],
      randomizedCanaryAuthorized: false,
    });
    expect(events[0]).not.toHaveProperty('fallbackReason');
    expect(events[0].challengerScores[0].actionKey).toBe('BUY:100');
    expect(service.getStatus()).toMatchObject({
      state: 'READY',
      releaseAuthorized: true,
      randomizedCanaryAuthorized: false,
      metrics: {
        decisionCount: 1,
        candidateCoverage: 1,
        fallbackRate: 0,
      },
    });

    service.activateKillSwitch('test');
    service.schedule({
      decisionId: 'decision-2',
      state: liveState(),
      localPlayer: liveState().playersBySteamId.player,
      previousActionKeys: ['BUY:50'],
      displayedActionKeys: ['BUY:100', 'BUY:200'],
    });
    await service.waitForIdle();
    expect(service.getStatus().state).toBe('KILLED');
    expect(
      (await readFile(join(outputDirectory, 'events.ndjson'), 'utf8'))
        .trim()
        .split('\n'),
    ).toHaveLength(1);
  });
});

function modelArtifact(): RecommendationValueV8RuntimeModelArtifact {
  const actionModel = createRecommendationValueV8ActionModel(256);
  const feature = recommendationValueV8RuntimeFeatureIndex(
    'action:hero-item:1:100',
    256,
  );
  for (const horizon of ['3m', '5m', '10m'] as const) {
    actionModel.weights[horizon][feature.index] = feature.sign;
  }
  return {
    schemaVersion: 1,
    evaluationVersion: 'RECOMMENDATION_VALUE_V8_FULL_EVALUATION_1',
    generatedAt: '2026-07-28T00:00:00.000Z',
    stateModelVersion: 'RECOMMENDATION_VALUE_V8_HASHED_STATE_1',
    actionModelVersion: 'RECOMMENDATION_VALUE_V8_HASHED_ACTION_RESIDUAL_1',
    featureVersion: 'RECOMMENDATION_VALUE_V8_FEATURES_1',
    selectedConfiguration: { actionScale: 1, policyTemperature: 0.5 },
    selectedOn: 'TUNING_ONLY',
    options: {
      state: { maximumAbsolutePrediction: 1 },
      action: { maximumAbsoluteResidual: 1 },
    },
    finalStateModel: createRecommendationValueV8StateModel(256),
    actionModel,
  };
}

function servedDecision() {
  return {
    schemaVersion: 1,
    eventId: 'event-1',
    eventType: 'DECISION_SERVED',
    occurredAt: '2026-07-28T00:00:00.000Z',
    decisionId: 'decision-1',
    matchId: 'match-1',
    steamId: 'player',
    heroId: 1,
    teamId: 0,
    itemIds: [50],
    alliedHeroIds: [1],
    enemyHeroIds: [2],
    previousActionKeys: ['BUY:50'],
    inventoryStateKey: '50x1',
    gameTimeS: 600,
    timeBucket: 5,
    traversalKey: 'key-1',
    recommendationModel: 'BASELINE',
    modelVersion: 'BASELINE_1',
    modelSha256: 'c'.repeat(64),
    candidateSetPolicy: 'CANDIDATE_POLICY_1',
    candidateLimit: 20,
    servedActionKey: 'BUY:100',
    candidateActions: [
      candidateAction(100, 0.6),
      candidateAction(200, 0.4),
    ],
    elapsedMs: 5,
  };
}

function candidateAction(itemId: number, score: number) {
  return {
    actionKey: `BUY:${itemId}`,
    actionType: 'BUY',
    sourceActionType: 'BUY',
    itemId,
    score,
    confidence: 0.8,
    historicalCount: 100,
    historicalProbability: 0.5,
    predictedStateKey: `50x1|${itemId}x1`,
    matchupSignals: [],
  };
}

function liveState(): MinimalMatchState {
  return {
    matchId: 'match-1',
    gameTimeSec: 600,
    lastUpdatedAt: '2026-07-28T00:00:00.000Z',
    playersBySteamId: {
      player: {
        steamId: 'player',
        playerName: 'Player',
        isLocal: true,
        heroId: 1,
        teamId: 0,
        level: 8,
        souls: 8_000,
        health: 900,
        maxHealth: 1_000,
        kills: 2,
        deaths: 1,
        assists: 3,
        heroDamage: 4_000,
        items: [
          {
            id: 50,
            name: 'Item 50',
            className: 'item_50',
            enhanced: false,
          },
        ],
      },
      enemy: {
        steamId: 'enemy',
        playerName: 'Enemy',
        heroId: 2,
        teamId: 1,
        items: [],
      },
    },
  };
}

function item(itemId: number, slotType: string, tags: string[]) {
  return {
    id: itemId,
    catalogVersionId: 1,
    itemId,
    name: `Item ${itemId}`,
    className: `item_${itemId}`,
    itemType: 'UPGRADE',
    slotType,
    cost: 3_000,
    tier: 3,
    shopable: true,
    disabled: false,
    active: true,
    isActiveItem: false,
    activationType: 'PASSIVE',
    rawPayload: { tags },
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
