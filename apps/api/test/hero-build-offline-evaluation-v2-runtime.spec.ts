import type { CanonicalPlayerBuildSequence } from '../src/deadlock-live/canonical-build-sequence.service';
import {
  createDefaultHeroBuildContextualV2Config,
  HeroBuildContextualV2Config,
} from '../src/deadlock-live/hero-build-contextual-v2.model';
import {
  HeroBuildOfflineV2ComparisonAccumulator,
  buildHeroBuildOfflineV2StatisticalSummary,
} from '../src/deadlock-live/hero-build-offline-evaluation-v2-aggregate';
import { HeroBuildOfflineV2ContextIndex } from '../src/deadlock-live/hero-build-offline-evaluation-v2-context-index';
import { HeroBuildOfflineEvaluationV2Model } from '../src/deadlock-live/hero-build-offline-evaluation-v2.model';
import { normalizeOptions } from '../src/deadlock-live/hero-build-offline-evaluation-v2-resilient.service';
import type { HeroBuildOfflineModelPrediction } from '../src/deadlock-live/hero-build-offline-evaluation.model';
import type { HeroBuildPolicy } from '../src/deadlock-live/hero-build-transition-aggregation.service';

describe('offline evaluation V2 runtime', () => {
  it('keeps Valve hero ids 16 and 27 distinct in offline matchup context', () => {
    const index = new HeroBuildOfflineV2ContextIndex();
    index.addSequence(createSequence(1, 'BUY:100'), [16]);
    index.addSequence(createSequence(2, 'BUY:200'), [27]);

    const evaluation = index.evaluate({
      stateKey: 'EMPTY',
      actionKey: 'BUY:100',
      gameTimeS: 300,
      enemyValveHeroIds: [16, 27],
    });

    expect(evaluation.evidence.map((value) => value.enemyValveHeroId)).toEqual([
      16,
      27,
    ]);
    expect(evaluation.evidence[0].hero?.actionAgainst).toBe(1);
    expect(evaluation.evidence[1].hero?.actionAgainst).toBe(0);
  });

  it('restores compact comparison checkpoints without changing metrics', () => {
    const accumulator = new HeroBuildOfflineV2ComparisonAccumulator();
    accumulator.add(
      1,
      createPrediction(['BUY:100']),
      createPrediction(['BUY:200', 'BUY:100']),
      'BUY:100',
    );
    accumulator.add(
      2,
      createPrediction(['BUY:200']),
      createPrediction(['BUY:100', 'BUY:200']),
      'BUY:100',
    );

    const snapshot = accumulator.buildSnapshot();
    const restored = new HeroBuildOfflineV2ComparisonAccumulator(snapshot);

    expect(restored.buildComparison()).toEqual(accumulator.buildComparison());
    expect(restored.buildSnapshot().clusters).toEqual(snapshot.clusters);
  });

  it('calculates deterministic bootstrap intervals from compact match clusters', () => {
    const accumulator = new HeroBuildOfflineV2ComparisonAccumulator();
    accumulator.add(
      1,
      createPrediction(['BUY:200']),
      createPrediction(['BUY:100']),
      'BUY:100',
    );
    accumulator.add(
      2,
      createPrediction(['BUY:200']),
      createPrediction(['BUY:200']),
      'BUY:100',
    );

    const first = buildHeroBuildOfflineV2StatisticalSummary(
      accumulator.buildSnapshot(),
      500,
      123,
    );
    const second = buildHeroBuildOfflineV2StatisticalSummary(
      accumulator.buildSnapshot(),
      500,
      123,
    );

    expect(first).toEqual(second);
    expect(first.top1.pointEstimatePercentagePoints).toBe(50);
    expect(first.top1.clusterCount).toBe(2);
  });

  it('keeps the baseline control prediction unchanged', () => {
    const policy = createPolicy();
    const contextIndex = new HeroBuildOfflineV2ContextIndex();
    contextIndex.addSequence(createSequence(1, 'BUY:100'), [2, 3, 4, 5, 6]);
    const model = new HeroBuildOfflineEvaluationV2Model(
      new Map([[1, policy]]),
      contextIndex,
      () => [],
    );
    const prepared = model.prepare({
      heroId: 1,
      stateKey: 'EMPTY',
      gameTimeS: 300,
      enemyHeroIds: [2, 3, 4, 5, 6],
    });
    const control: HeroBuildContextualV2Config = {
      ...createDefaultHeroBuildContextualV2Config(),
      id: 'baseline-control',
      lambda: 0,
      maximumLogitBonus: 0,
      maximumPromotionDistance: 0,
    };

    const result = model.predict(prepared, control);

    expect(result.contextual.actionKeys).toEqual(result.baseline.actionKeys);
    expect(result.rerank.changedTop1).toBe(false);
    expect(result.rerank.changedTop3).toBe(false);
  });

  it('normalizes validation defaults and the inspected-holdout cutoff', () => {
    const options = normalizeOptions({});

    expect(options).toMatchObject({
      runMode: 'VALIDATION_ONLY',
      trainFraction: 0.7,
      validationFraction: 0.15,
      maxMatches: 13_000,
      changedPredictionLimit: 100,
      bootstrapIterations: 2_000,
      bootstrapSeed: 20_260_717,
      finalTestNotBefore: '2026-07-17T11:46:14.000Z',
    });
  });
});

function createPrediction(actionKeys: string[]): HeroBuildOfflineModelPrediction {
  return {
    covered: actionKeys.length > 0,
    mode: actionKeys.length > 0 ? 'EXACT' : 'NO_MATCH',
    actionKeys,
    topActionKey: actionKeys[0],
    matchupPromoted: false,
    matchupInserted: false,
    isSituational: false,
  };
}

function createPolicy(): HeroBuildPolicy {
  return {
    heroId: 1,
    playerCount: 20,
    stateCount: 1,
    transitionCount: 20,
    statesByKey: new Map([
      [
        'EMPTY',
        {
          heroId: 1,
          stateKey: 'EMPTY',
          observationCount: 20,
          nextActionCount: 2,
          nextActions: [
            {
              actionType: 'BUY',
              itemId: 100,
              actionKey: 'BUY:100',
              count: 12,
              probability: 0.6,
              averageGameTimeS: 300,
              afterStates: [
                {
                  afterStateKey: '100x1',
                  count: 12,
                  probability: 1,
                },
              ],
            },
            {
              actionType: 'BUY',
              itemId: 200,
              actionKey: 'BUY:200',
              count: 8,
              probability: 0.4,
              averageGameTimeS: 300,
              afterStates: [
                {
                  afterStateKey: '200x1',
                  count: 8,
                  probability: 1,
                },
              ],
            },
          ],
        },
      ],
    ]),
  };
}

function createSequence(
  playerId: number,
  actionKey: string,
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
        gameTimeS: 300,
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
