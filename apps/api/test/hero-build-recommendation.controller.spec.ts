import { HeroBuildRecommendationController } from '../src/deadlock-live/hero-build-recommendation.controller';
import { HeroBuildRecommendationPresentationService } from '../src/deadlock-live/hero-build-recommendation-presentation.service';
import {
  HeroBuildRecommendationResponse,
  HeroBuildRecommendationService,
} from '../src/deadlock-live/hero-build-recommendation.service';
import { LiveMatchStateService } from '../src/deadlock-live/live-match-state.service';
import { RecipeAwareTimelineReconciliationService } from '../src/deadlock-live/recipe-aware-timeline-reconciliation.service';

describe('HeroBuildRecommendationController matchup context', () => {
  it('infers enemy heroes from the newest matching live state when omitted', async () => {
    const harness = createHarness();

    await harness.controller.recommend({
      heroId: 72,
      itemIds: [],
      gameTimeS: 0,
    });

    expect(harness.recommend).toHaveBeenCalledWith(
      expect.objectContaining({
        heroId: 72,
        enemyHeroIds: [13, 15],
      }),
    );
  });

  it('keeps an explicit empty enemy roster instead of inferring live context', async () => {
    const harness = createHarness();

    await harness.controller.recommend({
      heroId: 72,
      itemIds: [],
      gameTimeS: 0,
      enemyHeroIds: [],
    });

    expect(harness.recommend).toHaveBeenCalledWith(
      expect.objectContaining({
        enemyHeroIds: [],
      }),
    );
  });
});

function createHarness() {
  const recommend = jest.fn(async () => createRecommendation());
  const present = jest.fn(async (response: HeroBuildRecommendationResponse) => response);
  const getAllStates = jest.fn(() => [
    {
      matchId: 'older',
      gameTimeSec: 100,
      lastUpdatedAt: '2026-07-14T12:00:00.000Z',
      playersBySteamId: {
        local: {
          steamId: 'local',
          playerName: 'Local',
          isLocal: true,
          heroId: 72,
          teamId: 1,
          items: [],
        },
        enemy: {
          steamId: 'enemy',
          playerName: 'Enemy',
          isLocal: false,
          heroId: 7,
          teamId: 2,
          items: [],
        },
      },
    },
    {
      matchId: 'newest',
      gameTimeSec: 200,
      lastUpdatedAt: '2026-07-14T13:00:00.000Z',
      playersBySteamId: {
        local: {
          steamId: 'local',
          playerName: 'Local',
          isLocal: true,
          heroId: 72,
          teamId: 1,
          items: [],
        },
        enemyOne: {
          steamId: 'enemy-1',
          playerName: 'Enemy One',
          isLocal: false,
          heroId: 15,
          teamId: 2,
          items: [],
        },
        enemyTwo: {
          steamId: 'enemy-2',
          playerName: 'Enemy Two',
          isLocal: false,
          heroId: 13,
          teamId: 2,
          items: [],
        },
      },
    },
  ]);

  const getSnapshots = jest.fn(() => []);
  const getComponentItemIds = jest.fn(() => []);
  const controller = new HeroBuildRecommendationController(
    { recommend } as unknown as HeroBuildRecommendationService,
    { present } as unknown as HeroBuildRecommendationPresentationService,
    { getAllStates, getSnapshots } as unknown as LiveMatchStateService,
    { getComponentItemIds } as unknown as RecipeAwareTimelineReconciliationService,
  );

  return { controller, recommend, present, getAllStates };
}

function createRecommendation(): HeroBuildRecommendationResponse {
  return {
    mode: 'NO_MATCH',
    heroId: 72,
    requestedStateKey: 'EMPTY',
    gameTimeS: 0,
    observationCount: 0,
    candidateStateCount: 0,
    action: {
      type: 'HOLD',
      actionKey: 'HOLD',
      historicalCount: 0,
      historicalProbability: 0,
      averageGameTimeS: 0,
      matchedStateKey: 'EMPTY',
      matchedStateObservationCount: 0,
      stateDistance: 0,
      missingItemCount: 0,
      extraItemCount: 0,
      matchedBySubset: true,
      predictedStateKey: 'EMPTY',
      score: 0,
      confidence: 0,
    },
    alternatives: [],
    noMatchReason: 'NO_NEARBY_STATE',
  };
}
