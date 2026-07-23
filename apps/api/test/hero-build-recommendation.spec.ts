import {
  calculateDirectionalInventoryDistance,
  calculateInventoryMultisetDistance,
  HeroBuildRecommendationOptions,
  parseInventoryStateKey,
  recommendFromPolicy,
  resolveObservedOwnedCountLimit,
} from '../src/deadlock-live/hero-build-recommendation.service';
import {
  HeroBuildPolicy,
  HeroBuildPolicyNextAction,
  HeroBuildPolicyState,
} from '../src/deadlock-live/hero-build-transition-aggregation.service';

const OPTIONS: HeroBuildRecommendationOptions = {
  minExactObservations: 3,
  maxBackoffDistance: 4,
  maxBackoffStates: 64,
  limit: 5,
};

describe('hero build recommendation', () => {
  it('calculates multiset distance with duplicate item counts', () => {
    const current = parseInventoryStateKey('100x1|200x2');
    const historical = parseInventoryStateKey('100x1|200x1|300x1');

    expect(current).toBeDefined();
    expect(historical).toBeDefined();
    expect(calculateInventoryMultisetDistance(current!, historical!)).toBe(2);
    expect(calculateDirectionalInventoryDistance(current!, historical!)).toEqual({
      distance: 2,
      missingItemCount: 1,
      extraItemCount: 1,
      matchedBySubset: false,
    });
  });

  it('uses an exact state when it has enough observations', () => {
    const state = createState('100x1', 10, [createAction('BUY', 200, 7, 0.7, 180)]);
    const policy = createPolicy(72, [state]);

    const result = recommendFromPolicy(
      { heroId: 72, itemIds: [100], gameTimeS: 180 },
      '100x1',
      policy,
      parseStates([state]),
      () => [],
      OPTIONS,
    );

    expect(result.mode).toBe('EXACT');
    expect(result.action.type).toBe('BUY');
    expect(result.action.itemId).toBe(200);
    expect(result.action.currentOwnedCount).toBe(0);
    expect(result.action.observedOwnedCountLimit).toBe(1);
    expect(result.action.predictedStateKey).toBe('100x1|200x1');
    expect(result.stateDistance).toBe(0);
    expect(result.missingItemCount).toBe(0);
    expect(result.extraItemCount).toBe(0);
    expect(result.matchedBySubset).toBe(true);
    expect(result.backoffReason).toBeUndefined();
  });

  it('prefers a legal subset state over a stronger future state', () => {
    const weakExact = createState('100x1', 1, [createAction('BUY', 900, 1, 1, 180)]);
    const strongFuture = createState(
      '100x1|200x1',
      100,
      [createAction('BUY', 300, 100, 1, 180)],
    );
    const policy = createPolicy(72, [weakExact, strongFuture]);

    const result = recommendFromPolicy(
      { heroId: 72, itemIds: [100], gameTimeS: 180 },
      '100x1',
      policy,
      parseStates([weakExact, strongFuture]),
      () => [],
      OPTIONS,
    );

    expect(result.mode).toBe('BACKOFF');
    expect(result.backoffReason).toBe('SUBSET_STATE');
    expect(result.candidateStateCount).toBe(1);
    expect(result.action.itemId).toBe(900);
    expect(result.action.matchedStateKey).toBe('100x1');
    expect(result.action.stateDistance).toBe(0);
    expect(result.action.missingItemCount).toBe(0);
    expect(result.action.extraItemCount).toBe(0);
    expect(result.action.matchedBySubset).toBe(true);
    expect(result.alternatives.some((action) => action.itemId === 300)).toBe(false);
  });

  it('uses a directional fallback only when subset states have no legal action', () => {
    const subsetState = createState(
      '10x1',
      20,
      [createAction('UPGRADE', 30, 20, 1, 300)],
    );
    const futureState = createState(
      '10x1|20x1',
      50,
      [createAction('BUY', 40, 40, 0.8, 300)],
    );
    const policy = createPolicy(72, [subsetState, futureState]);
    const recipeResolver = (parentItemId: number) => parentItemId === 30 ? [10, 20] : [];

    const result = recommendFromPolicy(
      { heroId: 72, itemIds: [10], gameTimeS: 300 },
      '10x1',
      policy,
      parseStates([subsetState, futureState]),
      recipeResolver,
      OPTIONS,
    );

    expect(result.mode).toBe('BACKOFF');
    expect(result.backoffReason).toBe('DIRECTIONAL_FALLBACK');
    expect(result.action.type).toBe('BUY');
    expect(result.action.itemId).toBe(40);
    expect(result.action.matchedStateKey).toBe('10x1|20x1');
    expect(result.action.missingItemCount).toBe(1);
    expect(result.action.extraItemCount).toBe(0);
    expect(result.action.matchedBySubset).toBe(false);
  });

  it('filters a repeat purchase after the current count reaches observed evidence', () => {
    const state = createState('EMPTY', 100, [
      createAction('BUY', 100, 80, 0.8, 60, ['100x1']),
      createAction('BUY', 200, 20, 0.2, 60, ['200x1']),
    ]);
    const policy = createPolicy(72, [state]);

    const result = recommendFromPolicy(
      { heroId: 72, itemIds: [100, 100], gameTimeS: 180 },
      '100x2',
      policy,
      parseStates([state]),
      () => [],
      OPTIONS,
    );

    expect(result.mode).toBe('BACKOFF');
    expect(result.action.itemId).toBe(200);
    expect(result.action.currentOwnedCount).toBe(0);
    expect(result.action.observedOwnedCountLimit).toBe(1);
    expect(result.alternatives.some((action) => action.itemId === 100)).toBe(false);
  });

  it('allows another copy when the observed transition proves the higher count', () => {
    const action = createAction('BUY', 100, 10, 1, 180, ['100x2']);
    const state = createState('100x1', 10, [action]);
    const policy = createPolicy(72, [state]);

    const result = recommendFromPolicy(
      { heroId: 72, itemIds: [100], gameTimeS: 180 },
      '100x1',
      policy,
      parseStates([state]),
      () => [],
      OPTIONS,
    );

    expect(resolveObservedOwnedCountLimit(action, parseInventoryStateKey('100x1')!)).toBe(2);
    expect(result.mode).toBe('EXACT');
    expect(result.action.itemId).toBe(100);
    expect(result.action.currentOwnedCount).toBe(1);
    expect(result.action.observedOwnedCountLimit).toBe(2);
    expect(result.action.predictedStateKey).toBe('100x2');
  });

  it('filters a sell action when the item is not held', () => {
    const state = createState('100x1', 10, [
      createAction('SELL', 999, 9, 0.9, 200),
      createAction('BUY', 200, 1, 0.1, 200),
    ]);
    const policy = createPolicy(72, [state]);

    const result = recommendFromPolicy(
      { heroId: 72, itemIds: [100], gameTimeS: 200 },
      '100x1',
      policy,
      parseStates([state]),
      () => [],
      OPTIONS,
    );

    expect(result.action.type).toBe('BUY');
    expect(result.action.itemId).toBe(200);
    expect(result.alternatives.some((action) => action.type === 'SELL')).toBe(false);
  });

  it('allows an upgrade only when every recipe component is held', () => {
    const completeState = createState(
      '10x1|20x1',
      10,
      [createAction('UPGRADE', 30, 8, 0.8, 300)],
    );
    const policy = createPolicy(72, [completeState]);
    const recipeResolver = (parentItemId: number) => parentItemId === 30 ? [10, 20] : [];

    const complete = recommendFromPolicy(
      { heroId: 72, itemIds: [10, 20], gameTimeS: 300 },
      '10x1|20x1',
      policy,
      parseStates([completeState]),
      recipeResolver,
      OPTIONS,
    );
    const incomplete = recommendFromPolicy(
      { heroId: 72, itemIds: [10], gameTimeS: 300 },
      '10x1',
      policy,
      parseStates([completeState]),
      recipeResolver,
      OPTIONS,
    );

    expect(complete.action.type).toBe('UPGRADE');
    expect(complete.action.predictedStateKey).toBe('30x1');
    expect(incomplete.mode).toBe('NO_MATCH');
    expect(incomplete.action.type).toBe('HOLD');
    expect(incomplete.noMatchReason).toBe('NO_LEGAL_ACTION');
  });

  it('requires repeated recipe component multiplicity for upgrades', () => {
    const state = createState(
      '10x2',
      10,
      [createAction('UPGRADE', 30, 8, 0.8, 300)],
    );
    const policy = createPolicy(72, [state]);
    const recipeResolver = (parentItemId: number) =>
      parentItemId === 30 ? [10, 10] : [];

    const complete = recommendFromPolicy(
      { heroId: 72, itemIds: [10, 10], gameTimeS: 300 },
      '10x2',
      policy,
      parseStates([state]),
      recipeResolver,
      OPTIONS,
    );
    const incomplete = recommendFromPolicy(
      { heroId: 72, itemIds: [10], gameTimeS: 300 },
      '10x1',
      policy,
      parseStates([state]),
      recipeResolver,
      OPTIONS,
    );

    expect(complete.action.type).toBe('UPGRADE');
    expect(complete.action.predictedStateKey).toBe('30x1');
    expect(incomplete.action.type).toBe('HOLD');
    expect(incomplete.noMatchReason).toBe('NO_LEGAL_ACTION');
  });

  it('normalizes a historical rebuy into a buy recommendation', () => {
    const state = createState('EMPTY', 10, [createAction('REBUY', 100, 10, 1, 60)]);
    const policy = createPolicy(72, [state]);

    const result = recommendFromPolicy(
      { heroId: 72, itemIds: [], gameTimeS: 60 },
      'EMPTY',
      policy,
      parseStates([state]),
      () => [],
      OPTIONS,
    );

    expect(result.action.type).toBe('BUY');
    expect(result.action.sourceActionType).toBe('REBUY');
    expect(result.action.actionKey).toBe('BUY:100');
  });

  it('returns hold when no state is within the backoff distance', () => {
    const state = createState('1x1|2x1|3x1|4x1|5x1', 10, [
      createAction('BUY', 100, 10, 1, 300),
    ]);
    const policy = createPolicy(72, [state]);

    const result = recommendFromPolicy(
      { heroId: 72, itemIds: [], gameTimeS: 300 },
      'EMPTY',
      policy,
      parseStates([state]),
      () => [],
      OPTIONS,
    );

    expect(result.mode).toBe('NO_MATCH');
    expect(result.action.type).toBe('HOLD');
    expect(result.noMatchReason).toBe('NO_NEARBY_STATE');
  });
});

function createPolicy(heroId: number, states: HeroBuildPolicyState[]): HeroBuildPolicy {
  return {
    heroId,
    playerCount: 100,
    stateCount: states.length,
    transitionCount: states.reduce((total, state) => total + state.observationCount, 0),
    statesByKey: new Map(states.map((state) => [state.stateKey, state])),
  };
}

function createState(
  stateKey: string,
  observationCount: number,
  nextActions: HeroBuildPolicyNextAction[],
): HeroBuildPolicyState {
  return {
    heroId: 72,
    stateKey,
    observationCount,
    nextActionCount: nextActions.length,
    nextActions,
  };
}

function createAction(
  actionType: HeroBuildPolicyNextAction['actionType'],
  itemId: number,
  count: number,
  probability: number,
  averageGameTimeS: number,
  afterStateKeys: string[] = [],
): HeroBuildPolicyNextAction {
  return {
    actionType,
    itemId,
    actionKey: `${actionType}:${itemId}`,
    count,
    probability,
    averageGameTimeS,
    afterStates: afterStateKeys.map((afterStateKey) => ({
      afterStateKey,
      count: 1,
      probability: 1 / afterStateKeys.length,
    })),
  };
}

function parseStates(states: HeroBuildPolicyState[]) {
  return states.map((state) => ({
    state,
    itemCounts: parseInventoryStateKey(state.stateKey)!,
  }));
}
