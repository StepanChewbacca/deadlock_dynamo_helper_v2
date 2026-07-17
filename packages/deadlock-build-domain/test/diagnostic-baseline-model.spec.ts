import { DiagnosticTrainingExample, ParsedDiagnosticMatch } from '../src/diagnostic-match-parser';
import {
  DiagnosticBaselineModel,
  evaluateDiagnosticBaseline,
  summarizeDiagnosticDataset,
} from '../src/diagnostic-baseline-model';

describe('DiagnosticBaselineModel', () => {
  it('ranks exact-state empirical actions and reports the selected backoff level', () => {
    const model = new DiagnosticBaselineModel([
      example('m1', 72, 'EARLY', 'EMPTY', 'BUY', 100),
      example('m2', 72, 'EARLY', 'EMPTY', 'BUY', 100),
      example('m3', 72, 'EARLY', 'EMPTY', 'BUY', 200),
    ]);

    expect(model.recommend({ heroId: 72, phase: 'EARLY', stateKey: 'EMPTY' })).toEqual([
      expect.objectContaining({
        actionKey: 'BUY:100',
        count: 2,
        support: 3,
        probability: 2 / 3,
        backoffLevel: 'HERO_PHASE_STATE',
      }),
      expect.objectContaining({ actionKey: 'BUY:200', probability: 1 / 3 }),
    ]);
  });

  it('backs off to hero-phase evidence and filters an already owned purchase', () => {
    const model = new DiagnosticBaselineModel([
      example('m1', 72, 'EARLY', 'EMPTY', 'BUY', 100),
      example('m2', 72, 'EARLY', 'EMPTY', 'BUY', 200),
      example('m3', 72, 'EARLY', '100x1', 'SELL', 100),
    ]);

    expect(model.recommend({ heroId: 72, phase: 'EARLY', stateKey: '100x1', minSupport: 2 })).toEqual([
      expect.objectContaining({ actionKey: 'BUY:200', backoffLevel: 'HERO_PHASE' }),
      expect.objectContaining({ actionKey: 'SELL:100', backoffLevel: 'HERO_PHASE' }),
    ]);
  });

  it('evaluates with leave-one-match-out training', () => {
    const matches = [
      match('m1', [example('m1', 72, 'EARLY', 'EMPTY', 'BUY', 100)]),
      match('m2', [example('m2', 72, 'EARLY', 'EMPTY', 'BUY', 100)]),
      match('m3', [example('m3', 72, 'EARLY', 'EMPTY', 'BUY', 100)]),
    ];

    expect(evaluateDiagnosticBaseline(matches)).toMatchObject({
      matchCount: 3,
      exampleCount: 3,
      predictedCount: 3,
      top1Hits: 3,
      top3Hits: 3,
      top1Accuracy: 1,
      top3Accuracy: 1,
      coverage: 1,
    });
  });

  it('does not learn the held-out match action from itself', () => {
    const matches = [
      match('m1', [example('m1', 72, 'EARLY', 'EMPTY', 'BUY', 100)]),
      match('m2', [example('m2', 72, 'EARLY', 'EMPTY', 'BUY', 200)]),
    ];

    expect(evaluateDiagnosticBaseline(matches)).toMatchObject({
      predictedCount: 2,
      top1Hits: 0,
      top3Hits: 0,
    });
  });

  it('summarizes parsed match coverage and marker quality', () => {
    const parsed = match('m1', [example('m1', 72, 'EARLY', 'EMPTY', 'BUY', 100)]);
    parsed.timelines = [
      {
        slot: 12,
        playerKey: 'local',
        player: { slot: 12, playerKey: 'local', heroId: 72, isLocal: true },
        snapshots: [{ observedAtMs: 1, gameTimeSec: 10, itemIds: [], items: [] }],
        actions: [],
        finalStateKey: 'EMPTY',
        diagnostics: [],
      },
    ];
    parsed.markerResults = [
      {
        note: { id: 'a', createdAt: new Date(0).toISOString(), action: 'BUY' },
        status: 'MATCHED',
        matchId: 'm1',
      },
      {
        note: { id: 'b', createdAt: new Date(0).toISOString(), action: 'SELL' },
        status: 'UNMATCHED',
        matchId: 'm1',
      },
    ];

    expect(summarizeDiagnosticDataset([parsed])).toMatchObject({
      matchCount: 1,
      playerTimelineCount: 1,
      localTimelineCount: 1,
      inventorySnapshotCount: 1,
      trainingExampleCount: 1,
      markerCount: 2,
      matchedMarkerCount: 1,
      unmatchedMarkerCount: 1,
      examplesByActionType: { BUY: 1, REBUY: 0, UPGRADE: 0, SELL: 0 },
    });
  });
});

function example(
  matchId: string,
  heroId: number,
  phase: DiagnosticTrainingExample['phase'],
  beforeStateKey: string,
  actionType: DiagnosticTrainingExample['actionType'],
  itemId: number,
): DiagnosticTrainingExample {
  return {
    matchId,
    playerKey: `${matchId}:player`,
    slot: 12,
    isLocal: true,
    heroId,
    teamId: 3,
    enemyHeroIds: [],
    observedAtMs: 1,
    gameTimeSec: phase === 'EARLY' ? 100 : phase === 'MID' ? 900 : 1500,
    phase,
    beforeStateKey,
    afterStateKey: `${itemId}x1`,
    actionType,
    actionKey: `${actionType}:${itemId}`,
    itemId,
    markerConfirmed: false,
  };
}

function match(matchId: string, trainingExamples: DiagnosticTrainingExample[]): ParsedDiagnosticMatch {
  return {
    matchId,
    players: [],
    timelines: [],
    incomingDamage: [],
    teamScores: [],
    markerResults: [],
    trainingExamples,
    diagnostics: [],
  };
}
