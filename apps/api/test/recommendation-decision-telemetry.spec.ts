import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repository } from 'typeorm';
import { MatchPlayer } from '../src/deadlock-live/entities/match-player.entity';
import { RecommendationDecisionTelemetryService } from '../src/deadlock-live/recommendation-decision-telemetry.service';
import { RecommendationOutcomeLinkerService } from '../src/deadlock-live/recommendation-outcome-linker.service';
import type { HeroBuildRecommendationResponse } from '../src/deadlock-live/hero-build-recommendation.service';

describe('recommendation decision telemetry', () => {
  let outputDirectory = '';

  beforeEach(async () => {
    outputDirectory = await mkdtemp(
      join(tmpdir(), 'deadlock-recommendation-telemetry-'),
    );
    process.env.DEADLOCK_RECOMMENDATION_TELEMETRY_DIR =
      outputDirectory;
  });

  afterEach(async () => {
    delete process.env.DEADLOCK_RECOMMENDATION_TELEMETRY_DIR;
    await rm(outputDirectory, { recursive: true, force: true });
  });

  it('persists decisions, observed actions, and match outcomes', async () => {
    const service = new RecommendationDecisionTelemetryService();
    await service.onModuleInit();
    expect(service.getStatus().outputDirectory).toBe(outputDirectory);
    const context = createContext();
    const decisionId = service.recordDecision({
      context,
      recommendation: createRecommendation(),
      elapsedMs: 12.4,
    });
    service.recordObservedAction({
      decisionId,
      matchId: context.matchId,
      steamId: context.steamId,
      heroId: context.heroId,
      teamId: context.teamId,
      observedActionKeys: ['BUY:999'],
      observedInventoryStateKey: '100x1|999x1',
      observedAtGameTimeS: 25,
      reconstructionConfidence: 'EXACT_SINGLE_ACTION',
    });
    expect(
      service.recordMatchOutcome({
        matchId: context.matchId,
        steamId: context.steamId,
        heroId: context.heroId,
        teamId: context.teamId,
        playerWon: true,
        source: 'MANUAL',
      }),
    ).toBe(true);
    expect(
      service.recordMatchOutcome({
        matchId: context.matchId,
        steamId: context.steamId,
        heroId: context.heroId,
        teamId: context.teamId,
        playerWon: true,
        source: 'MANUAL',
      }),
    ).toBe(false);
    await service.waitForIdle();

    const lines = (
      await readFile(join(outputDirectory, 'events.ndjson'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line.eventType)).toEqual([
      'DECISION_SERVED',
      'ACTION_OBSERVED',
      'MATCH_OUTCOME',
    ]);
    expect(lines[0]).toMatchObject({
      decisionId,
      servedActionKey: 'BUY:999',
      recommendationModel: 'CONTEXTUAL_V3',
    });
    expect(lines[0].candidateActions).toEqual([
      expect.objectContaining({
        actionKey: 'BUY:999',
        matchupSignals: [
          expect.objectContaining({
            contextualPurchaseLiftPercent: 3.2,
          }),
        ],
      }),
    ]);
    expect(service.getStatus()).toMatchObject({
      state: 'READY',
      eventCount: 3,
      decisionCount: 1,
      observedActionCount: 1,
      matchOutcomeCount: 1,
      pendingOutcomeCount: 0,
      writeErrorCount: 0,
    });

    const replayed = new RecommendationDecisionTelemetryService();
    await replayed.onModuleInit();
    expect(replayed.getStatus()).toMatchObject({
      eventCount: 3,
      decisionCount: 1,
      observedActionCount: 1,
      matchOutcomeCount: 1,
      pendingOutcomeCount: 0,
    });
  });

  it('automatically links an unresolved decision to stored match data', async () => {
    const service = new RecommendationDecisionTelemetryService();
    await service.onModuleInit();
    service.recordDecision({
      context: createContext(),
      recommendation: createRecommendation(),
      elapsedMs: 4,
    });
    const findOne = jest.fn(async () => ({ won: false }));
    const linker = new RecommendationOutcomeLinkerService(
      service,
      { findOne } as unknown as Repository<MatchPlayer>,
    );

    await linker.linkPendingOutcomes();
    await service.waitForIdle();

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toMatchObject({
      matchOutcomeCount: 1,
      pendingOutcomeCount: 0,
    });
    const content = await readFile(
      join(outputDirectory, 'events.ndjson'),
      'utf8',
    );
    expect(content).toContain('"source":"HISTORICAL_MATCH_PLAYER"');
    expect(content).toContain('"playerWon":false');
  });
});

function createContext() {
  return {
    matchId: '12345',
    steamId: 'steam-local',
    heroId: 72,
    teamId: 1,
    itemIds: [100],
    alliedHeroIds: [2, 3, 4, 5, 6],
    enemyHeroIds: [13, 14, 15, 16, 17],
    previousActionKeys: ['BUY:100'],
    inventoryStateKey: '100x1',
    gameTimeS: 20,
    timeBucket: 0,
    traversalKey: '12345:steam-local:72:100x1',
  };
}

function createRecommendation(): HeroBuildRecommendationResponse {
  return {
    mode: 'BACKOFF',
    heroId: 72,
    requestedStateKey: '100x1',
    gameTimeS: 20,
    matchedStateKey: '100x1',
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    observationCount: 80,
    candidateStateCount: 128,
    action: {
      type: 'BUY',
      sourceActionType: 'BUY',
      itemId: 999,
      actionKey: 'BUY:999',
      historicalCount: 50,
      historicalProbability: 0.5,
      averageGameTimeS: 20,
      matchedStateKey: '100x1',
      matchedStateObservationCount: 80,
      stateDistance: 0,
      missingItemCount: 0,
      extraItemCount: 0,
      matchedBySubset: true,
      currentOwnedCount: 0,
      observedOwnedCountLimit: 1,
      matchupSignals: [
        {
          heroId: 13,
          direction: 'POSITIVE',
          scoreContribution: 0.02,
          contextualPurchaseLiftPercent: 3.2,
          observationCount: 90,
        },
      ],
      predictedStateKey: '100x1|999x1',
      score: 0.7,
      confidence: 0.7,
    },
    alternatives: [],
    recommendationModel: 'CONTEXTUAL_V3',
    modelVersion: 'TEST_MODEL',
    modelSha256: 'test-sha',
    candidateSetPolicy: 'TEST_POLICY',
    candidateLimit: 128,
    buildArchetypeId: 'TEST_ARCHETYPE',
  } as HeroBuildRecommendationResponse;
}
