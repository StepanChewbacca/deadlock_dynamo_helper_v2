import { InventoryTimelineReplayService } from '../src/deadlock-live/inventory-timeline-replay.service';
import {
  CanonicalItemAction,
  NormalizedMatchItemTimelines,
  NormalizedPlayerItemTimeline,
} from '../src/deadlock-live/match-timeline-normalization.service';

describe('InventoryTimelineReplayService', () => {
  const service = new InventoryTimelineReplayService();

  it('tracks duplicate item ids as separate instances and removes only the sold instance', () => {
    const replay = service.replayPlayer(
      createTimeline([
        createAction(1, 'BUY', 60, 100, '7:1'),
        createAction(2, 'BUY', 90, 100, '7:2'),
        createAction(3, 'SELL', 120, 100, '7:1'),
      ]),
    );

    expect(replay.steps.map((step) => step.heldItemCount)).toEqual([1, 2, 1]);
    expect(replay.finalInventory).toEqual([
      expect.objectContaining({ instanceId: '7:2', itemId: 100, acquiredBy: 'BUY' }),
    ]);
    expect(replay.diagnostics).toEqual([]);
  });

  it('consumes exact component instances and acquires the parent on upgrade', () => {
    const upgrade = createAction(3, 'UPGRADE', 180, 300, '7:3');
    upgrade.consumedComponentItemIds = [100, 200];
    upgrade.consumedComponentInstanceIds = ['7:1', '7:2'];

    const replay = service.replayPlayer(
      createTimeline([
        createAction(1, 'BUY', 60, 100, '7:1'),
        createAction(2, 'BUY', 90, 200, '7:2'),
        upgrade,
      ]),
    );

    expect(replay.finalInventory).toEqual([
      expect.objectContaining({
        instanceId: '7:3',
        itemId: 300,
        acquiredAtS: 180,
        acquiredBy: 'UPGRADE',
      }),
    ]);
    expect(replay.steps[2].heldInstances.map((instance) => instance.instanceId)).toEqual(['7:3']);
    expect(replay.diagnostics).toEqual([]);
  });

  it('records a missing upgrade component but continues with the observed parent', () => {
    const upgrade = createAction(2, 'UPGRADE', 180, 300, '7:3');
    upgrade.consumedComponentItemIds = [100, 200];
    upgrade.consumedComponentInstanceIds = ['7:1', '7:missing'];

    const replay = service.replayPlayer(
      createTimeline([createAction(1, 'BUY', 60, 100, '7:1'), upgrade]),
    );

    expect(replay.finalInventory.map((instance) => instance.instanceId)).toEqual(['7:3']);
    expect(replay.diagnostics).toEqual([
      expect.objectContaining({
        code: 'MISSING_UPGRADE_COMPONENT',
        sequence: 2,
        instanceId: '7:3',
        details: {
          componentInstanceId: '7:missing',
          expectedComponentItemId: 200,
        },
      }),
    ]);
  });

  it('does not overwrite an already-held instance on duplicate acquisition', () => {
    const replay = service.replayPlayer(
      createTimeline([
        createAction(1, 'BUY', 60, 100, '7:1'),
        createAction(2, 'REBUY', 120, 200, '7:1'),
      ]),
    );

    expect(replay.finalInventory).toEqual([
      expect.objectContaining({ instanceId: '7:1', itemId: 100, acquiredAtS: 60 }),
    ]);
    expect(replay.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'DUPLICATE_INSTANCE_ACQUIRE',
    ]);
  });

  it('keeps USE as a no-op and reports unsupported RECONCILE actions', () => {
    const replay = service.replayPlayer(
      createTimeline([
        createAction(1, 'BUY', 60, 100, '7:1'),
        createAction(2, 'USE', 90, 100, '7:1'),
        createAction(3, 'RECONCILE', 120, 100, '7:1'),
      ]),
    );

    expect(replay.steps.map((step) => step.heldItemCount)).toEqual([1, 1, 1]);
    expect(replay.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'UNSUPPORTED_RECONCILE_ACTION',
    ]);
  });

  it('aggregates match replay counters from player replays', () => {
    const match: NormalizedMatchItemTimelines = {
      matchId: 93405163,
      startTime: new Date('2026-07-10T13:07:49.000Z'),
      players: [
        createTimeline([createAction(1, 'BUY', 60, 100, '7:1')]),
        {
          ...createTimeline([createAction(1, 'BUY', 70, 200, '8:1')]),
          playerId: 8,
        },
      ],
      actionCount: 2,
      diagnosticCount: 0,
      upgradeCount: 0,
    };

    const replay = service.replayMatch(match);

    expect(replay).toMatchObject({
      matchId: 93405163,
      playerCount: 2,
      actionCount: 2,
      stepCount: 2,
      diagnosticCount: 0,
      finalItemCount: 2,
    });
  });
});

function createTimeline(actions: CanonicalItemAction[]): NormalizedPlayerItemTimeline {
  return {
    matchId: 93405163,
    playerId: 7,
    heroId: 11,
    actions,
    diagnostics: [],
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
    sourceRowId: sequence,
    evidence: type === 'UPGRADE' ? 'recipeGraph' : type === 'SELL' ? 'soldTimeS' : 'purchaseTimeS',
    evidenceLevel: type === 'UPGRADE' ? 'DERIVED' : 'OBSERVED',
    confidence: 1,
  };
}
