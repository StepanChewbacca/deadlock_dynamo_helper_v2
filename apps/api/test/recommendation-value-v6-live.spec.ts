import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repository } from 'typeorm';
import type { HeroBuildContextualRecommendationRequest } from '../src/deadlock-live/contextual-hero-build-recommendation.service';
import type { Item } from '../src/deadlock-live/entities/item.entity';
import type {
  HeroBuildRecommendationAction,
  HeroBuildRecommendationResponse,
} from '../src/deadlock-live/hero-build-recommendation.service';
import {
  loadRecommendationValueV6Model,
  RecommendationValueV6LiveService,
  type RecommendationValueV6LiveResponse,
} from '../src/deadlock-live/recommendation-value-v6-live.service';
import { RECOMMENDATION_VALUE_V6_MODEL_VERSION } from '../src/deadlock-live/recommendation-value-v6-model';

const ORIGINAL_ENV = { ...process.env };

interface ArtifactOptions {
  auditPassed?: boolean;
  modelVersion?: string;
  actionUtilities?: Record<string, number>;
}

describe('Recommendation Value V6 immutable loader', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'recommendation-v6-live-'));
  });

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    await rm(directory, { recursive: true, force: true });
  });

  it('loads the exact expected model SHA', async () => {
    const artifact = await writeArtifacts(directory);
    const loaded = await loadRecommendationValueV6Model(
      directory,
      artifact.sha256,
    );

    expect(loaded.candidateId).toBe('v6-short-only-20260727');
    expect(loaded.modelVersion).toBe(RECOMMENDATION_VALUE_V6_MODEL_VERSION);
    expect(loaded.modelSha256).toBe(artifact.sha256);
    expect(loaded.model.state).toBeInstanceOf(Map);
    expect(loaded.model.action).toBeInstanceOf(Map);
  });

  it('fails closed for an incorrect expected SHA', async () => {
    await writeArtifacts(directory);

    await expect(
      loadRecommendationValueV6Model(directory, '0'.repeat(64)),
    ).rejects.toThrow('model SHA mismatch');
  });

  it('fails closed for an incorrect model version', async () => {
    const artifact = await writeArtifacts(directory, {
      modelVersion: 'RECOMMENDATION_VALUE_V6_INVALID',
    });

    await expect(
      loadRecommendationValueV6Model(directory, artifact.sha256),
    ).rejects.toThrow('model version is invalid');
  });

  it('fails closed when the audit did not pass', async () => {
    const artifact = await writeArtifacts(directory, { auditPassed: false });

    await expect(
      loadRecommendationValueV6Model(directory, artifact.sha256),
    ).rejects.toThrow('audit did not pass');
  });
});

describe('Recommendation Value V6 production reranking', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'recommendation-v6-rerank-'));
  });

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    await rm(directory, { recursive: true, force: true });
  });

  it('reranks only baseline candidates for every user when supported', async () => {
    const artifact = await writeArtifacts(directory, {
      actionUtilities: {
        'HERO_TIME_ACTION:15|5|BUY:1': 0.8,
        'HERO_TIME_ACTION:15|5|BUY:2': 0.1,
      },
    });
    const repository = createItemRepository();
    const service = await createService(directory, artifact.sha256, repository);
    const baseline = baselineResponse();

    const response = (await service.apply(
      recommendationRequest(),
      baseline,
    )) as RecommendationValueV6LiveResponse;

    expect(response.action.actionKey).toBe('BUY:1');
    expect(response.alternatives.map((action) => action.actionKey)).toEqual([
      'BUY:2',
    ]);
    expect(response.recommendationExperiment).toMatchObject({
      source: 'VALUE_V6_CANARY',
      candidateId: 'v6-short-only-20260727',
      supportedCandidateCount: 2,
    });
    expect(new Set(actionKeys(response))).toEqual(new Set(actionKeys(baseline)));
    expect(service.getStatus()).toMatchObject({
      mode: 'CANARY',
      rolloutScope: 'ALL_USERS',
      allowlistCount: 0,
      canaryResponseCount: 1,
    });
  });

  it('falls back when fewer than two candidates are supported', async () => {
    const artifact = await writeArtifacts(directory, {
      actionUtilities: {
        'HERO_TIME_ACTION:15|5|BUY:1': 0.8,
      },
    });
    const service = await createService(
      directory,
      artifact.sha256,
      createItemRepository(),
    );
    const baseline = baselineResponse();

    const response = (await service.apply(
      recommendationRequest(),
      baseline,
    )) as RecommendationValueV6LiveResponse;

    expect(actionKeys(response)).toEqual(actionKeys(baseline));
    expect(response.recommendationExperiment).toMatchObject({
      source: 'BASELINE',
      fallbackReason: 'INSUFFICIENT_SUPPORTED_CANDIDATES',
    });
  });

  it('falls back when top separation is below the threshold', async () => {
    const artifact = await writeArtifacts(directory, {
      actionUtilities: {
        'HERO_TIME_ACTION:15|5|BUY:1': 0.4,
        'HERO_TIME_ACTION:15|5|BUY:2': 0.4,
      },
    });
    const service = await createService(
      directory,
      artifact.sha256,
      createItemRepository(),
    );
    const baseline = baselineResponse();

    const response = (await service.apply(
      recommendationRequest(),
      baseline,
    )) as RecommendationValueV6LiveResponse;

    expect(actionKeys(response)).toEqual(actionKeys(baseline));
    expect(response.recommendationExperiment).toMatchObject({
      source: 'BASELINE',
      fallbackReason: 'LOW_TOP_SEPARATION',
    });
  });

  it('falls back on a runtime model dependency error', async () => {
    const artifact = await writeArtifacts(directory, {
      actionUtilities: {
        'HERO_TIME_ACTION:15|5|BUY:1': 0.8,
        'HERO_TIME_ACTION:15|5|BUY:2': 0.1,
      },
    });
    const repository = {
      find: jest.fn().mockRejectedValue(new Error('catalog unavailable')),
    } as unknown as Repository<Item>;
    const service = await createService(directory, artifact.sha256, repository);
    const baseline = baselineResponse();

    const response = (await service.apply(
      recommendationRequest(),
      baseline,
    )) as RecommendationValueV6LiveResponse;

    expect(actionKeys(response)).toEqual(actionKeys(baseline));
    expect(response.recommendationExperiment).toMatchObject({
      source: 'BASELINE',
      fallbackReason: 'MODEL_ERROR',
    });
    expect(service.getStatus().modelErrorCount).toBe(1);
  });

  it('does not score in DISABLED mode', async () => {
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_LIVE_MODE = 'DISABLED';
    const repository = createItemRepository();
    const service = new RecommendationValueV6LiveService(repository);
    const baseline = baselineResponse();

    const response = await service.apply(recommendationRequest(), baseline);

    expect(response).toBe(baseline);
    expect(repository.find).not.toHaveBeenCalled();
  });

  it('never changes the returned ranking in SHADOW mode', async () => {
    const artifact = await writeArtifacts(directory, {
      actionUtilities: {
        'HERO_TIME_ACTION:15|5|BUY:1': 0.8,
        'HERO_TIME_ACTION:15|5|BUY:2': 0.1,
      },
    });
    const repository = createItemRepository();
    const service = await createService(
      directory,
      artifact.sha256,
      repository,
      'SHADOW',
    );
    const baseline = baselineResponse();

    const response = await service.apply(recommendationRequest(), baseline);

    expect(response).toBe(baseline);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(service.getStatus().canaryResponseCount).toBe(0);
  });

  it('uses baseline rank as the deterministic advantage tie-breaker', async () => {
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_CANARY_MIN_SEPARATION = '0';
    const artifact = await writeArtifacts(directory, {
      actionUtilities: {
        'HERO_TIME_ACTION:15|5|BUY:1': 0.4,
        'HERO_TIME_ACTION:15|5|BUY:2': 0.4,
      },
    });
    const service = await createService(
      directory,
      artifact.sha256,
      createItemRepository(),
    );
    const baseline = baselineResponse();

    const first = await service.apply(recommendationRequest(), baseline);
    const second = await service.apply(recommendationRequest(), baseline);

    expect(actionKeys(first)).toEqual(['BUY:2', 'BUY:1']);
    expect(actionKeys(second)).toEqual(actionKeys(first));
  });
});

async function createService(
  directory: string,
  sha256: string,
  repository: Repository<Item>,
  mode: 'CANARY' | 'SHADOW' = 'CANARY',
): Promise<RecommendationValueV6LiveService> {
  process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_LIVE_MODE = mode;
  process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_LIVE_MODEL_DIR = directory;
  process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_LIVE_EXPECTED_MODEL_SHA256 =
    sha256;
  if (
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_CANARY_MIN_SEPARATION ===
    undefined
  ) {
    process.env.DEADLOCK_RECOMMENDATION_VALUE_V6_CANARY_MIN_SEPARATION = '0.001';
  }
  const service = new RecommendationValueV6LiveService(repository);
  await service.onModuleInit();
  expect(service.getStatus().model.state).toBe('READY');
  return service;
}

async function writeArtifacts(
  directory: string,
  options: ArtifactOptions = {},
): Promise<{ sha256: string }> {
  const modelVersion =
    options.modelVersion ?? RECOMMENDATION_VALUE_V6_MODEL_VERSION;
  const action = Object.fromEntries(
    Object.entries(options.actionUtilities ?? {}).map(([key, utility]) => [
      key,
      count(utility),
    ]),
  );
  const modelArtifact = {
    schemaVersion: 1,
    modelVersion,
    generatedAt: '2026-07-27T00:00:00.000Z',
    modelKind: 'OBSERVATIONAL_STATE_ACTION_ADVANTAGE',
    target: 'SHORT_HORIZON_UTILITY_ONLY',
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
      requireShortHorizonTarget: true,
      horizons: ['3m', '5m', '10m'],
    },
    counts: {
      version: modelVersion,
      global: count(0),
      state: {},
      action,
    },
  };
  const modelText = `${JSON.stringify(modelArtifact, null, 2)}\n`;
  const sha256 = createHash('sha256').update(modelText).digest('hex');
  await Promise.all([
    writeFile(join(directory, 'model.json'), modelText, 'utf8'),
    writeFile(
      join(directory, 'manifest.json'),
      `${JSON.stringify({ modelVersion }, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(directory, 'audit.json'),
      `${JSON.stringify({ passed: options.auditPassed ?? true }, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(directory, 'promotion.json'),
      `${JSON.stringify(
        {
          candidateId: 'v6-short-only-20260727',
          modelSha256: sha256,
          usage: 'GLOBAL_CANARY_OPERATOR_OVERRIDE',
          productionRolloutAuthorized: true,
          rolloutScope: 'ALL_USERS',
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
  ]);
  return { sha256 };
}

function count(utility: number) {
  return {
    utilitySum: utility * 10,
    utilitySquaredSum: utility ** 2 * 10,
    winWeight: 5,
    totalWeight: 10,
    observations: 10,
  };
}

function createItemRepository(): Repository<Item> {
  return {
    find: jest.fn().mockResolvedValue([
      item(1, 3_000, 3, 'weapon'),
      item(2, 1_500, 2, 'spirit'),
    ]),
  } as unknown as Repository<Item>;
}

function item(
  itemId: number,
  cost: number,
  itemTier: number,
  itemSlotType: string,
): Item {
  return {
    id: itemId,
    itemId,
    name: `Item ${itemId}`,
    className: `item_${itemId}`,
    itemSlotType,
    cost,
    itemTier,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function recommendationRequest(): HeroBuildContextualRecommendationRequest {
  return {
    heroId: 15,
    itemIds: [],
    gameTimeS: 600,
    alliedHeroIds: [20],
    enemyHeroIds: [30],
    previousActionKeys: [],
    limit: 20,
  };
}

function baselineResponse(): HeroBuildRecommendationResponse {
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
    action: action(2, 0.8),
    alternatives: [action(1, 0.2)],
  };
}

function action(itemId: number, score: number): HeroBuildRecommendationAction {
  return {
    type: 'BUY',
    sourceActionType: 'BUY',
    itemId,
    actionKey: `BUY:${itemId}`,
    historicalCount: 10,
    historicalProbability: score,
    averageGameTimeS: 600,
    matchedStateKey: 'EMPTY',
    matchedStateObservationCount: 20,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    predictedStateKey: `${itemId}x1`,
    score,
    confidence: score,
  };
}

function actionKeys(response: HeroBuildRecommendationResponse): string[] {
  return [
    response.action.actionKey,
    ...response.alternatives.map((action) => action.actionKey),
  ];
}
