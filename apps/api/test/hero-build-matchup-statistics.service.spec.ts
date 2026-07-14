import { applyConservativeMatchupOdds } from '../src/deadlock-live/contextual-hero-build-recommendation.service';
import { calculateGraphMatchupInteraction } from '../src/deadlock-live/hero-build-matchup-statistics.service';

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
});
