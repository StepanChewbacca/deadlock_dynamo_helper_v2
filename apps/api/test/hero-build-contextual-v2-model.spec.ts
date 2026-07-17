import type { CanonicalPlayerBuildSequence } from '../src/deadlock-live/canonical-build-sequence.service';
import {
  createHeroBuildContextualV2ValidationGrid,
  HeroBuildContextualV2ActionEvaluation,
  HeroBuildContextualV2Config,
  HeroBuildContextualV2ScopeEvidence,
  HeroBuildNextActionContextIndex,
  rerankHeroBuildActionsV2,
} from '../src/deadlock-live/hero-build-contextual-v2.model';
import type { HeroBuildRecommendationAction } from '../src/deadlock-live/hero-build-recommendation.service';

describe('next-action contextual v2 model', () => {
  it('builds action-selection evidence at hero, phase, and state levels', () => {
    const index = new HeroBuildNextActionContextIndex();
    index.addSequence(createSequence(1, 'BUY:100', 300), [2, 3, 4, 5, 6]);
    index.addSequence(createSequence(2, 'BUY:200', 300), [3, 4, 5, 6, 7]);

    const evaluation = index.evaluate({
      stateKey: 'EMPTY',
      actionKey: 'BUY:100',
      gameTimeS: 300,
      enemyHeroIds: [2, 3],
    });

    expect(evaluation.phase).toBe('EARLY');
    expect(evaluation.evidence).toHaveLength(2);
    expect(evaluation.evidence[0].hero?.actionAgainst).toBe(1);
    expect(evaluation.evidence[0].phase?.actionAgainst).toBe(1);
    expect(evaluation.evidence[0].state?.actionAgainst).toBe(1);
    expect(index.getSummary().observationCount).toBe(6);
  });

  it('aggregates the full enemy roster instead of selecting only the strongest signal', () => {
    const actions = [createAction(100, 0.5), createAction(200, 0.49)];
    const evaluations = new Map<string, HeroBuildContextualV2ActionEvaluation>([
      [
        'BUY:200',
        createEvaluation('BUY:200', [
          createEnemyEvidence(2, 1),
          createEnemyEvidence(3, -1),
        ]),
      ],
    ]);

    const result = rerankHeroBuildActionsV2(actions, evaluations, createConfig());

    expect(result.actions[0].actionKey).toBe('BUY:100');
    expect(result.actions[1].rosterInteractionLogOdds).toBeCloseTo(0, 6);
    expect(result.changedTop1).toBe(false);
  });

  it('preserves baseline top-3 membership and limits promotion to one position', () => {
    const actions = [
      createAction(100, 0.5),
      createAction(200, 0.49),
      createAction(300, 0.48),
      createAction(400, 0.47),
      createAction(500, 0.46),
    ];
    const evaluations = new Map<string, HeroBuildContextualV2ActionEvaluation>([
      ['BUY:300', createEvaluation('BUY:300', [createEnemyEvidence(2, 2)])],
      ['BUY:400', createEvaluation('BUY:400', [createEnemyEvidence(2, 2)])],
    ]);

    const result = rerankHeroBuildActionsV2(actions, evaluations, createConfig());
    const top3 = result.actions.slice(0, 3).map((action) => action.actionKey);
    const action300 = result.actions.find((action) => action.actionKey === 'BUY:300');
    const action400 = result.actions.find((action) => action.actionKey === 'BUY:400');

    expect(new Set(top3)).toEqual(new Set(['BUY:100', 'BUY:200', 'BUY:300']));
    expect(action300?.contextualRank).toBeGreaterThanOrEqual(2);
    expect(action400?.contextualRank).toBeGreaterThanOrEqual(4);
    expect(result.actions.every(
      (action) => action.baseRank - action.contextualRank <= 1,
    )).toBe(true);
  });

  it('includes a no-op baseline control in the validation grid', () => {
    const grid = createHeroBuildContextualV2ValidationGrid();
    const control = grid.find((config) => config.id === 'baseline-control');

    expect(control).toMatchObject({
      lambda: 0,
      maximumLogitBonus: 0,
      maximumPromotionDistance: 0,
    });
    expect(new Set(grid.map((config) => config.id)).size).toBe(grid.length);
  });
});

function createConfig(): HeroBuildContextualV2Config {
  return {
    id: 'test',
    candidateLimit: 5,
    minimumActionObservations: 1,
    minimumContextObservations: 1,
    shrinkageStrength: 1,
    lambda: 1,
    maximumLogitBonus: 1,
    maximumPromotionDistance: 1,
  };
}

function createEnemyEvidence(enemyHeroId: number, effect: number) {
  const scope = createScopeEvidence(effect);
  return {
    enemyHeroId,
    enemyValveHeroId: enemyHeroId,
    hero: scope,
    phase: { ...scope, scope: 'PHASE' as const, phase: 'EARLY' as const },
    state: {
      ...scope,
      scope: 'STATE' as const,
      phase: 'EARLY' as const,
      stateKey: 'EMPTY',
    },
  };
}

function createScopeEvidence(effect: number): HeroBuildContextualV2ScopeEvidence {
  return {
    scope: 'HERO',
    totalAgainst: 200,
    actionAgainst: 100,
    otherActionsAgainst: 100,
    totalWithout: 200,
    actionWithout: 100,
    otherActionsWithout: 100,
    actionObservationCount: 200,
    interactionLogOddsRatio: effect,
    standardError: 0.1,
    lower95InteractionLogOddsRatio: effect - 0.196,
    upper95InteractionLogOddsRatio: effect + 0.196,
  };
}

function createEvaluation(
  actionKey: string,
  evidence: ReturnType<typeof createEnemyEvidence>[],
): HeroBuildContextualV2ActionEvaluation {
  return {
    phase: 'EARLY',
    actionKey,
    enemyHeroIds: evidence.map((value) => value.enemyHeroId),
    evidence,
  };
}

function createAction(itemId: number, score: number): HeroBuildRecommendationAction {
  return {
    type: 'BUY',
    sourceActionType: 'BUY',
    itemId,
    actionKey: `BUY:${itemId}`,
    historicalCount: 100,
    historicalProbability: score,
    averageGameTimeS: 300,
    matchedStateKey: 'EMPTY',
    matchedStateObservationCount: 500,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    predictedStateKey: `${itemId}x1`,
    score,
    confidence: score,
  };
}

function createSequence(
  playerId: number,
  actionKey: string,
  gameTimeS: number,
): CanonicalPlayerBuildSequence {
  const itemId = Number(actionKey.split(':')[1]);
  return {
    matchId: playerId,
    playerId,
    heroId: 1,
    sourceActionCount: 1,
    canonicalStepCount: 1,
    ignoredActionCount: 0,
    replayDiagnosticCount: 0,
    initialStateKey: 'EMPTY',
    finalStateKey: `${itemId}x1`,
    actionSequenceKey: actionKey,
    sequenceKey: `EMPTY>${actionKey}>${itemId}x1`,
    steps: [
      {
        sequence: 1,
        sourceSequence: 1,
        gameTimeS,
        actionType: 'BUY',
        itemId,
        actionKey,
        beforeStateKey: 'EMPTY',
        afterStateKey: `${itemId}x1`,
        transitionKey: `EMPTY>${actionKey}>${itemId}x1`,
      },
    ],
  };
}
