import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  HeroBuildRecommendationAction,
  HeroBuildRecommendationResponse,
} from '../src/deadlock-live/hero-build-recommendation.service';
import { RecommendationValueV6TelemetryService } from '../src/deadlock-live/recommendation-value-v6-telemetry.service';

const ORIGINAL_ENV = { ...process.env };

describe('Recommendation Value V6 telemetry separation', () => {
  let rootDirectory: string;
  let baseDirectory: string;
  let v6Directory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), 'recommendation-v6-telemetry-'));
    baseDirectory = join(rootDirectory, 'pro-training');
    v6Directory = join(rootDirectory, 'user-live');
    process.env.DEADLOCK_RECOMMENDATION_TELEMETRY_DIR = baseDirectory;
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_TELEMETRY_DIR = v6Directory;
  });

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    await rm(rootDirectory, { recursive: true, force: true });
  });

  it('keeps V6 decisions and outcomes out of the pro-training event log', async () => {
    const service = new RecommendationValueV6TelemetryService();
    await service.onModuleInit();

    const decisionId = service.recordDecision({
      context: context(),
      recommendation: v6Recommendation(),
      elapsedMs: 12,
    });
    service.recordObservedAction({
      decisionId,
      matchId: 'match-1',
      steamId: '76561198000000000',
      heroId: 15,
      teamId: 1,
      observedActionKeys: ['BUY:1'],
      observedInventoryStateKey: '1x1',
      observedAtGameTimeS: 610,
      reconstructionConfidence: 'EXACT_SINGLE_ACTION',
    });

    await service.waitForV6TelemetryIdle();
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      decisionCount: 0,
      observedActionCount: 0,
      matchOutcomeCount: 0,
    });
    expect(await readFile(join(baseDirectory, 'events.ndjson'), 'utf8')).toBe('');

    const userLiveEvents = (await readFile(
      join(v6Directory, 'events.ndjson'),
      'utf8',
    ))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(userLiveEvents).toHaveLength(2);
    expect(userLiveEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'V6_DECISION_SERVED',
          dataSource: 'USER_LIVE',
          eligibleForProModelTraining: false,
          rolloutScope: 'ALL_USERS',
        }),
        expect.objectContaining({
          eventType: 'V6_ACTION_OBSERVED',
          dataSource: 'USER_LIVE',
          eligibleForProModelTraining: false,
        }),
      ]),
    );
    expect(userLiveEvents[0]).not.toHaveProperty('steamId');
    expect(userLiveEvents[0]).toHaveProperty('localIdentityReference');
  });

  it('continues to write ordinary baseline decisions to the existing log', async () => {
    const service = new RecommendationValueV6TelemetryService();
    await service.onModuleInit();

    service.recordDecision({
      context: context(),
      recommendation: baselineRecommendation(),
      elapsedMs: 5,
    });
    await service.waitForIdle();

    expect(service.getStatus().decisionCount).toBe(1);
    expect(await readFile(join(baseDirectory, 'events.ndjson'), 'utf8')).toContain(
      'DECISION_SERVED',
    );
  });
});

function context() {
  return {
    matchId: 'match-1',
    steamId: '76561198000000000',
    heroId: 15,
    teamId: 1,
    itemIds: [],
    alliedHeroIds: [20],
    enemyHeroIds: [30],
    previousActionKeys: [],
    inventoryStateKey: 'EMPTY',
    gameTimeS: 600,
    timeBucket: 5,
    traversalKey: 'match-1:player:15:EMPTY:5',
  };
}

function v6Recommendation(): HeroBuildRecommendationResponse {
  return {
    ...baselineRecommendation(),
    recommendationExperiment: {
      source: 'VALUE_V6_CANARY',
      candidateId: 'v6-short-only-20260727',
      modelVersion: 'RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1',
      modelSha256:
        '799803f4882ca2ece436ab1087c41641713377f8a33f9bab0f0f4636a381938e',
      topSeparation: 0.01,
      supportedCandidateCount: 2,
    },
  } as HeroBuildRecommendationResponse;
}

function baselineRecommendation(): HeroBuildRecommendationResponse {
  return {
    mode: 'EXACT',
    heroId: 15,
    requestedStateKey: 'EMPTY',
    gameTimeS: 600,
    matchedStateKey: 'EMPTY',
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    observationCount: 20,
    candidateStateCount: 1,
    action: action(1),
    alternatives: [action(2)],
  };
}

function action(itemId: number): HeroBuildRecommendationAction {
  return {
    type: 'BUY',
    sourceActionType: 'BUY',
    itemId,
    actionKey: `BUY:${itemId}`,
    historicalCount: 10,
    historicalProbability: 0.5,
    averageGameTimeS: 600,
    matchedStateKey: 'EMPTY',
    matchedStateObservationCount: 20,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    predictedStateKey: `${itemId}x1`,
    score: 0.5,
    confidence: 0.5,
  };
}
