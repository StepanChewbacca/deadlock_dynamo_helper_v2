import {
  aggregateCanonicalBuildSequences,
  createInventoryStateKeyFromItemIds,
} from '../src/deadlock-live/hero-build-transition-aggregation.service';
import {
  CanonicalBuildActionType,
  CanonicalBuildStep,
  CanonicalPlayerBuildSequence,
} from '../src/deadlock-live/canonical-build-sequence.service';

describe('HeroBuildTransitionAggregationService', () => {
  it('aggregates next action counts and probabilities by hero and inventory state', () => {
    const snapshot = aggregateCanonicalBuildSequences([
      createSequence(1, 72, [
        createStep(1, 'EMPTY', 'BUY', 100, '100x1', 60),
        createStep(2, '100x1', 'BUY', 200, '100x1|200x1', 120),
      ]),
      createSequence(2, 72, [
        createStep(1, 'EMPTY', 'BUY', 100, '100x1', 80),
        createStep(2, '100x1', 'BUY', 300, '100x1|300x1', 140),
      ]),
      createSequence(3, 72, [
        createStep(1, 'EMPTY', 'BUY', 100, '100x1', 90),
        createStep(2, '100x1', 'BUY', 300, '100x1|300x1', 160),
      ]),
    ]);

    const policy = snapshot.policiesByHeroId.get(72)!;
    const emptyState = policy.statesByKey.get('EMPTY')!;
    const oneItemState = policy.statesByKey.get('100x1')!;

    expect(snapshot).toMatchObject({
      sourcePlayerCount: 3,
      includedPlayerCount: 3,
      excludedPlayerCount: 0,
      heroCount: 1,
      stateCount: 2,
      transitionCount: 6,
      actionOptionCount: 3,
    });
    expect(emptyState.nextActions).toEqual([
      expect.objectContaining({
        actionKey: 'BUY:100',
        count: 3,
        probability: 1,
        averageGameTimeS: 230 / 3,
      }),
    ]);
    expect(oneItemState.nextActions).toEqual([
      expect.objectContaining({ actionKey: 'BUY:300', count: 2, probability: 2 / 3 }),
      expect.objectContaining({ actionKey: 'BUY:200', count: 1, probability: 1 / 3 }),
    ]);
  });

  it('keeps policies separated by hero id', () => {
    const snapshot = aggregateCanonicalBuildSequences([
      createSequence(1, 72, [createStep(1, 'EMPTY', 'BUY', 100, '100x1', 60)]),
      createSequence(2, 73, [createStep(1, 'EMPTY', 'BUY', 200, '200x1', 70)]),
    ]);

    expect(snapshot.heroCount).toBe(2);
    expect(snapshot.policiesByHeroId.get(72)?.statesByKey.get('EMPTY')?.nextActions[0].actionKey).toBe(
      'BUY:100',
    );
    expect(snapshot.policiesByHeroId.get(73)?.statesByKey.get('EMPTY')?.nextActions[0].actionKey).toBe(
      'BUY:200',
    );
  });

  it('excludes diagnostic and empty player sequences from the policy', () => {
    const diagnosticSequence = createSequence(1, 72, [
      createStep(1, 'EMPTY', 'BUY', 100, '100x1', 60),
    ]);
    diagnosticSequence.replayDiagnosticCount = 1;

    const snapshot = aggregateCanonicalBuildSequences([
      diagnosticSequence,
      createSequence(2, 72, []),
      createSequence(3, 72, [createStep(1, 'EMPTY', 'BUY', 200, '200x1', 90)]),
    ]);

    expect(snapshot).toMatchObject({
      sourcePlayerCount: 3,
      includedPlayerCount: 1,
      excludedPlayerCount: 2,
      heroCount: 1,
      transitionCount: 1,
    });
    expect(snapshot.policiesByHeroId.get(72)?.statesByKey.get('EMPTY')?.nextActions).toEqual([
      expect.objectContaining({ actionKey: 'BUY:200', count: 1 }),
    ]);
  });

  it('aggregates alternative after states for the same action deterministically', () => {
    const snapshot = aggregateCanonicalBuildSequences([
      createSequence(1, 72, [createStep(1, '100x1', 'UPGRADE', 300, '300x1', 120)]),
      createSequence(2, 72, [createStep(1, '100x1', 'UPGRADE', 300, '300x1', 130)]),
      createSequence(3, 72, [
        createStep(1, '100x1', 'UPGRADE', 300, '200x1|300x1', 140),
      ]),
    ]);

    const action = snapshot.policiesByHeroId.get(72)!.statesByKey.get('100x1')!.nextActions[0];
    expect(action.afterStates).toEqual([
      { afterStateKey: '300x1', count: 2, probability: 2 / 3 },
      { afterStateKey: '200x1|300x1', count: 1, probability: 1 / 3 },
    ]);
  });

  it('creates sorted multiset state keys from item ids', () => {
    expect(createInventoryStateKeyFromItemIds([300, 100, 300, 200])).toBe(
      '100x1|200x1|300x2',
    );
    expect(createInventoryStateKeyFromItemIds([])).toBe('EMPTY');
  });
});

function createSequence(
  playerId: number,
  heroId: number,
  steps: CanonicalBuildStep[],
): CanonicalPlayerBuildSequence {
  return {
    matchId: 93405163,
    playerId,
    heroId,
    sourceActionCount: steps.length,
    canonicalStepCount: steps.length,
    ignoredActionCount: 0,
    replayDiagnosticCount: 0,
    initialStateKey: 'EMPTY',
    finalStateKey: steps.length > 0 ? steps[steps.length - 1].afterStateKey : 'EMPTY',
    actionSequenceKey: steps.map((step) => step.actionKey).join('>'),
    sequenceKey: steps.map((step) => step.transitionKey).join('||'),
    steps,
  };
}

function createStep(
  sequence: number,
  beforeStateKey: string,
  actionType: CanonicalBuildActionType,
  itemId: number,
  afterStateKey: string,
  gameTimeS: number,
): CanonicalBuildStep {
  const actionKey = `${actionType}:${itemId}`;
  return {
    sequence,
    sourceSequence: sequence,
    gameTimeS,
    actionType,
    itemId,
    actionKey,
    beforeStateKey,
    afterStateKey,
    transitionKey: `${beforeStateKey}>${actionKey}>${afterStateKey}`,
  };
}
