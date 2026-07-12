import {
  CanonicalBuildSequenceService,
  createInventoryStateKey,
} from '../src/deadlock-live/canonical-build-sequence.service';
import {
  InventoryItemInstanceSnapshot,
  MatchInventoryTimelineReplay,
  PlayerInventoryTimelineReplay,
} from '../src/deadlock-live/inventory-timeline-replay.service';
import { CanonicalItemAction } from '../src/deadlock-live/match-timeline-normalization.service';

describe('CanonicalBuildSequenceService', () => {
  const service = new CanonicalBuildSequenceService();

  it('creates sorted multiset state keys without collapsing duplicate items', () => {
    expect(
      createInventoryStateKey([
        createInstance('7:1', 200),
        createInstance('7:2', 100),
        createInstance('7:3', 200),
      ]),
    ).toBe('100x1|200x2');
    expect(createInventoryStateKey([])).toBe('EMPTY');
  });

  it('creates canonical transitions for duplicate purchases and an exact sale', () => {
    const replay = createPlayerReplay([
      createStep(1, createAction(1, 'BUY', 60, 100, '7:1'), [createInstance('7:1', 100)]),
      createStep(2, createAction(2, 'BUY', 90, 100, '7:2'), [
        createInstance('7:1', 100),
        createInstance('7:2', 100),
      ]),
      createStep(3, createAction(3, 'SELL', 120, 100, '7:1'), [createInstance('7:2', 100)]),
    ]);

    const sequence = service.canonicalizePlayer(replay);

    expect(sequence.actionSequenceKey).toBe('BUY:100>BUY:100>SELL:100');
    expect(sequence.steps.map((step) => step.beforeStateKey)).toEqual([
      'EMPTY',
      '100x1',
      '100x2',
    ]);
    expect(sequence.steps.map((step) => step.afterStateKey)).toEqual([
      '100x1',
      '100x2',
      '100x1',
    ]);
    expect(sequence.finalStateKey).toBe('100x1');
  });

  it('produces identical keys for semantically identical builds with different identities and times', () => {
    const first = createPlayerReplay([
      createStep(1, createAction(1, 'BUY', 60, 100, '7:1'), [createInstance('7:1', 100)]),
      createStep(2, createAction(2, 'UPGRADE', 120, 200, '7:2'), [
        createInstance('7:2', 200, 'UPGRADE'),
      ]),
    ]);
    const second = createPlayerReplay(
      [
        createStep(8, createAction(8, 'BUY', 75, 100, '99:500'), [
          createInstance('99:500', 100),
        ]),
        createStep(14, createAction(14, 'UPGRADE', 190, 200, '99:900'), [
          createInstance('99:900', 200, 'UPGRADE'),
        ]),
      ],
      99,
    );

    const firstSequence = service.canonicalizePlayer(first);
    const secondSequence = service.canonicalizePlayer(second);

    expect(secondSequence.actionSequenceKey).toBe(firstSequence.actionSequenceKey);
    expect(secondSequence.sequenceKey).toBe(firstSequence.sequenceKey);
    expect(secondSequence.steps.map((step) => step.transitionKey)).toEqual(
      firstSequence.steps.map((step) => step.transitionKey),
    );
  });

  it('ignores non-build actions but uses their resulting state for the next transition', () => {
    const replay = createPlayerReplay([
      createStep(1, createAction(1, 'BUY', 60, 100, '7:1'), [createInstance('7:1', 100)]),
      createStep(2, createAction(2, 'CONSUME', 90, 100, '7:1'), []),
      createStep(3, createAction(3, 'BUY', 120, 200, '7:2'), [createInstance('7:2', 200)]),
    ]);

    const sequence = service.canonicalizePlayer(replay);

    expect(sequence.canonicalStepCount).toBe(2);
    expect(sequence.ignoredActionCount).toBe(1);
    expect(sequence.actionSequenceKey).toBe('BUY:100>BUY:200');
    expect(sequence.steps[1]).toMatchObject({
      beforeStateKey: 'EMPTY',
      afterStateKey: '200x1',
    });
  });

  it('aggregates match counters and distinct transition sequence keys', () => {
    const first = createPlayerReplay([
      createStep(1, createAction(1, 'BUY', 60, 100, '7:1'), [createInstance('7:1', 100)]),
    ]);
    const second = createPlayerReplay(
      [createStep(1, createAction(1, 'BUY', 80, 100, '8:1'), [createInstance('8:1', 100)])],
      8,
    );
    const third = createPlayerReplay(
      [createStep(1, createAction(1, 'BUY', 90, 200, '9:1'), [createInstance('9:1', 200)])],
      9,
    );
    const match: MatchInventoryTimelineReplay = {
      matchId: 93405163,
      startTime: new Date('2026-07-10T13:07:49.000Z'),
      playerCount: 3,
      actionCount: 3,
      stepCount: 3,
      diagnosticCount: 0,
      finalItemCount: 3,
      players: [first, second, third],
    };

    const sequences = service.canonicalizeMatch(match);

    expect(sequences).toMatchObject({
      playerCount: 3,
      sourceActionCount: 3,
      canonicalStepCount: 3,
      ignoredActionCount: 0,
      replayDiagnosticCount: 0,
      distinctSequenceCount: 2,
    });
  });
});

function createPlayerReplay(
  steps: PlayerInventoryTimelineReplay['steps'],
  playerId = 7,
): PlayerInventoryTimelineReplay {
  const finalInventory = steps.length > 0 ? steps[steps.length - 1].heldInstances : [];
  return {
    matchId: 93405163,
    playerId,
    heroId: 72,
    actionCount: steps.length,
    stepCount: steps.length,
    diagnosticCount: 0,
    finalItemCount: finalInventory.length,
    steps,
    finalInventory,
    diagnostics: [],
  };
}

function createStep(
  sequence: number,
  action: CanonicalItemAction,
  heldInstances: InventoryItemInstanceSnapshot[],
): PlayerInventoryTimelineReplay['steps'][number] {
  return {
    sequence,
    gameTimeS: action.gameTimeS,
    action,
    heldItemCount: heldInstances.length,
    heldInstances,
  };
}

function createAction(
  sequence: number,
  type: CanonicalItemAction['type'],
  gameTimeS: number,
  itemId: number,
  instanceId: string,
): CanonicalItemAction {
  return {
    sequence,
    type,
    gameTimeS,
    itemId,
    instanceId,
    sourceRowId: sequence * 100,
    evidence: type === 'UPGRADE' ? 'recipeGraph' : type === 'SELL' ? 'soldTimeS' : 'purchaseTimeS',
    evidenceLevel: type === 'UPGRADE' ? 'DERIVED' : 'OBSERVED',
    confidence: 1,
  };
}

function createInstance(
  instanceId: string,
  itemId: number,
  acquiredBy: InventoryItemInstanceSnapshot['acquiredBy'] = 'BUY',
): InventoryItemInstanceSnapshot {
  return {
    instanceId,
    itemId,
    sourceRowId: Number(instanceId.split(':').pop()) || 1,
    acquiredAtS: 60,
    acquiredBy,
  };
}
