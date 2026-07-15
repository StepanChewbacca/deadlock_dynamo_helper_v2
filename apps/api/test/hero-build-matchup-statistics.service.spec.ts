import { applyConservativeMatchupOdds } from '../src/deadlock-live/contextual-hero-build-recommendation.service';
import {
  calculateGraphMatchupInteraction,
  HeroBuildMatchupStatisticsService,
} from '../src/deadlock-live/hero-build-matchup-statistics.service';
import { RecentMatchSnapshot } from '../src/deadlock-live/recent-matches-window.service';

describe('graph matchup statistics', () => {
  it('detects an item action that is specifically stronger against an enemy hero', () => {
    const evidence = calculateGraphMatchupInteraction({
      enemyHeroId: 13,
      actionAgainst: { matches: 100, wins: 80 },
      otherActionsAgainst: { matches: 200, wins: 100 },
      actionWithoutEnemy: { matches: 100, wins: 50 },
      otherActionsWithoutEnemy: { matches: 200, wins: 100 },
    });

    expect(evidence).toBeDefined();
    expect(evidence!.interactionOddsRatio).toBeGreaterThan(1);
    expect(evidence!.lower95InteractionOddsRatio).toBeGreaterThan(1);
    expect(evidence!.actionWinRateAgainst).toBe(0.8);
    expect(evidence!.otherActionsWinRateAgainst).toBe(0.5);
  });

  it('does not claim a situational advantage when relative performance is unchanged', () => {
    const evidence = calculateGraphMatchupInteraction({
      enemyHeroId: 13,
      actionAgainst: { matches: 100, wins: 60 },
      otherActionsAgainst: { matches: 200, wins: 120 },
      actionWithoutEnemy: { matches: 100, wins: 60 },
      otherActionsWithoutEnemy: { matches: 200, wins: 120 },
    });

    expect(evidence).toBeDefined();
    expect(evidence!.interactionLogOddsRatio).toBeCloseTo(0, 10);
    expect(evidence!.lower95InteractionOddsRatio).toBeLessThan(1);
  });

  it('requires both matchup and non-matchup comparison groups', () => {
    const evidence = calculateGraphMatchupInteraction({
      enemyHeroId: 13,
      actionAgainst: { matches: 10, wins: 8 },
      otherActionsAgainst: { matches: 20, wins: 10 },
      actionWithoutEnemy: { matches: 0, wins: 0 },
      otherActionsWithoutEnemy: { matches: 20, wins: 10 },
    });

    expect(evidence).toBeUndefined();
  });

  it('multiplies graph ranking odds by the conservative matchup effect', () => {
    const baseScore = 0.4;
    const contextualScore = applyConservativeMatchupOdds(
      baseScore,
      Math.log(2),
    );

    expect(contextualScore).toBeCloseTo(4 / 7, 10);
    expect(contextualScore).toBeGreaterThan(baseScore);
    expect(applyConservativeMatchupOdds(baseScore, -1)).toBe(baseScore);
  });

  it('rebuilds only matches loaded for the requested canonical hero', async () => {
    const match = createMatchWithPlayers(2);
    const ensureReady = jest.fn(async () => undefined);
    const getSourceVersionMs = jest.fn(() => 1);
    const getMatches = jest.fn(() => [match]);
    const normalizeMatch = jest.fn(() => ({ players: [] }));
    const replayMatch = jest.fn(() => ({ players: [] }));
    const canonicalizeMatch = jest.fn(() => ({ players: [] }));

    const service = new HeroBuildMatchupStatisticsService(
      { ensureReady, getSourceVersionMs, getMatches } as any,
      { normalizeMatch } as any,
      { replayMatch } as any,
      { canonicalizeMatch } as any,
      { refreshRecipes: jest.fn(async () => undefined) } as any,
    );

    await service.evaluate({
      heroId: 80,
      stateKey: 'EMPTY',
      actionKey: 'BUY:1',
      enemyHeroIds: [35],
    });

    expect(ensureReady).toHaveBeenCalledWith(15);
    expect(getSourceVersionMs).toHaveBeenCalledWith(15);
    expect(getMatches).toHaveBeenCalledTimes(1);
    expect(getMatches).toHaveBeenCalledWith(15);
    expect(normalizeMatch).toHaveBeenCalledTimes(1);
    expect(replayMatch).toHaveBeenCalledTimes(1);
    expect(canonicalizeMatch).toHaveBeenCalledTimes(1);
  });

  it('ignores build sequences belonging to other heroes', async () => {
    const match = createMatchWithPlayers(3);
    const service = new HeroBuildMatchupStatisticsService(
      {
        ensureReady: async () => undefined,
        getSourceVersionMs: () => 1,
        getMatches: () => [match],
      } as any,
      { normalizeMatch: () => ({ players: [] }) } as any,
      { replayMatch: () => ({ players: [] }) } as any,
      {
        canonicalizeMatch: () => ({
          players: [
            {
              playerId: 1,
              heroId: 19,
              replayDiagnosticCount: 0,
              steps: [{ beforeStateKey: 'EMPTY', actionKey: 'BUY:OTHER' }],
            },
            {
              playerId: 1,
              heroId: 15,
              replayDiagnosticCount: 0,
              steps: [{ beforeStateKey: 'EMPTY', actionKey: 'BUY:TARGET' }],
            },
          ],
        }),
      } as any,
      { refreshRecipes: jest.fn(async () => undefined) } as any,
    );

    const target = await service.evaluate({
      heroId: 15,
      stateKey: 'EMPTY',
      actionKey: 'BUY:TARGET',
      enemyHeroIds: [35],
    });
    const other = await service.evaluate({
      heroId: 15,
      stateKey: 'EMPTY',
      actionKey: 'BUY:OTHER',
      enemyHeroIds: [35],
    });

    expect(target.stateObservationCount).toBe(1);
    expect(target.actionObservationCount).toBe(1);
    expect(other.stateObservationCount).toBe(1);
    expect(other.actionObservationCount).toBe(0);
  });
});

function createMatchWithPlayers(matchId: number): RecentMatchSnapshot {
  return {
    matchId,
    startTime: new Date(matchId),
    durationS: 0,
    averageBadge: 0,
    winningTeam: 2,
    players: [
      {
        id: 1,
        matchId,
        heroId: 15,
        team: 2,
        won: true,
        kills: 0,
        deaths: 0,
        assists: 0,
        netWorth: 0,
        itemPurchases: [],
        skillUpgrades: [],
      },
      {
        id: 2,
        matchId,
        heroId: 35,
        team: 3,
        won: false,
        kills: 0,
        deaths: 0,
        assists: 0,
        netWorth: 0,
        itemPurchases: [],
        skillUpgrades: [],
      },
    ],
  };
}
